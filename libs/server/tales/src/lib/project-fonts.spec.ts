import {
  createProjectFont,
  deleteProjectFont,
  FontExistsError,
  FontInUseError,
  FontNotFoundError,
  findPublishedFont,
  getProjectFontFile,
  withoutProjectFonts,
} from './project-fonts';
import type { TransactionalDb } from './tales';

const projectId = '00000000-0000-4000-8000-000000000002';
const fontId = '0f0e0d0c-0000-4000-8000-00000000000a';

function fakeDb(answers: unknown[]) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer ?? { rows: [] };
  });
  const db = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionalDb;
  const statements = () => query.mock.calls.map((c) => c[0] as string);
  return { db, query, release, statements };
}

describe('project fonts', () => {
  it('refuses a second face of a family, weight and style', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { db } = fakeDb([duplicate]);
    await expect(
      createProjectFont(db, {
        projectId,
        family: 'Brand',
        weight: 400,
        style: 'normal',
        fallback: 'sans',
        storageKey: 'fonts/a.woff2',
        sizeBytes: 64,
        uploader: { id: projectId, name: 'A' },
      }),
    ).rejects.toBeInstanceOf(FontExistsError);
  });

  it('reads a file only through its own project, and never queries for ids that are not UUIDs', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    expect(await getProjectFontFile(db, projectId, 'Brand')).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(await getProjectFontFile(db, projectId, fontId)).toBeNull();
    expect(query.mock.calls[0][1]).toEqual([fontId, projectId]);
  });

  it('locks the font row before checking whether a draft or published document uses it', async () => {
    const used = fakeDb([{ rows: [{ key: 'fonts/a.woff2' }] }, { rows: [{ title: 'Beach' }] }]);
    await expect(deleteProjectFont(used.db, projectId, fontId)).rejects.toBeInstanceOf(FontInUseError);
    const [, lock, check] = used.statements();
    expect(lock).toMatch(/FROM project_fonts WHERE id = \$1 AND project_id = \$2 FOR UPDATE/);
    expect(check).toMatch(/jsonb_path_exists\(t\.draft_document[\s\S]*OR jsonb_path_exists\(t\.document/);
    expect(used.statements()).toContain('ROLLBACK');
    expect(used.statements().some((s) => /DELETE/.test(s))).toBe(false);

    const free = fakeDb([{ rows: [{ key: 'fonts/a.woff2' }] }, { rows: [] }, { rows: [] }]);
    await expect(deleteProjectFont(free.db, projectId, fontId)).resolves.toBe('fonts/a.woff2');
    expect(free.statements()).toContain('COMMIT');

    const missing = fakeDb([{ rows: [] }]);
    await expect(deleteProjectFont(missing.db, projectId, fontId)).rejects.toBeInstanceOf(FontNotFoundError);
    await expect(deleteProjectFont(missing.db, projectId, 'nope')).rejects.toBeInstanceOf(FontNotFoundError);
  });

  it('finds a public font only through a live tale of a delivered group whose published, visible text uses it', async () => {
    const found = fakeDb([{ rows: [{}] }]);
    expect(await findPublishedFont(found.db, 'fonts/a.woff2')).toEqual({
      key: 'fonts/a.woff2',
      contentType: 'font/woff2',
    });
    const sql = found.statements()[0];
    expect(sql).toMatch(/t\.status = 'live'/);
    // The delivered-group rule: live in its window, with a live tale, placed in a zone.
    expect(sql).toMatch(/g\.status = 'live'[\s\S]*FROM tales dt[\s\S]*FROM zone_tale_groups dz/);
    // The published document only, never the draft; hidden elements do not count.
    expect(sql).toMatch(/jsonb_path_exists\(t\.document, '[^']*!exists\(@\.hidden \? \(@ == true\)\)/);
    expect(sql).not.toMatch(/draft_document/);
    expect(await findPublishedFont(fakeDb([{ rows: [] }]).db, 'fonts/b.woff2')).toBeNull();
  });

  it('replaces project fonts with the fallback stack, keeping a document without any as it is', () => {
    const plain = { elements: [{ type: 'text', props: { text: 'x', font: { source: 'theme' } } }] };
    expect(withoutProjectFonts(plain)).toBe(plain);
    expect(withoutProjectFonts(null)).toBeNull();
    const doc = {
      version: 1,
      elements: [
        { type: 'text', props: { text: 'a', font: { source: 'project', fontId }, fallback: 'serif' } },
        { type: 'text', props: { text: 'b', font: { source: 'project', fontId }, fallback: 'cursive' } },
        { type: 'text', props: { text: 'c', font: { source: 'name', family: 'Inter' } } },
      ],
    };
    expect(withoutProjectFonts(doc).elements.map((e) => e.props.font)).toEqual([
      { source: 'system', stack: 'serif' },
      { source: 'system', stack: 'sans' },
      { source: 'name', family: 'Inter' },
    ]);
  });
});
