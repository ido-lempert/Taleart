import { MAX_PROJECT_FONT_BYTES, MAX_PROJECT_FONTS } from '@taleart/contract';
import {
  clearPublicFontCache,
  createProjectFont,
  deleteProjectFont,
  FontExistsError,
  FontInUseError,
  FontLimitError,
  FontNotFoundError,
  FontStorageFullError,
  findPublishedFont,
  FONT_SWEEP_MIN_AGE_MS,
  getProjectFontFile,
  PUBLIC_FONT_CACHE_TTL_MS,
  recordTaleFonts,
  sweepUnusedFontFiles,
  withoutProjectFonts,
  type NewProjectFont,
} from './project-fonts';
import type { TransactionalDb } from './tales';

const projectId = '00000000-0000-4000-8000-000000000002';
const taleId = '00000000-0000-4000-8000-000000000010';
const fontId = '0f0e0d0c-0000-4000-8000-00000000000a';

// A fake pool whose one connection answers queries in order; an Error answer is thrown.
function fakeDb(answers: unknown[], failOn?: RegExp) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (failOn?.test(sql)) throw new Error(`failed: ${sql}`);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer ?? { rows: [] };
  });
  const db = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionalDb;
  const statements = () => query.mock.calls.map((c) => c[0] as string);
  return { db, query, release, statements };
}

const face: NewProjectFont = {
  projectId,
  family: 'Brand',
  weight: 400,
  style: 'normal',
  fallback: 'sans',
  storageKey: 'fonts/a.woff2',
  sizeBytes: 64,
  uploader: { id: projectId, name: 'A' },
};
const inserted = {
  rows: [
    { id: fontId, projectId, ...face, uploaderId: projectId, uploaderName: 'A', createdAt: new Date(), inUse: false },
  ],
};
const file = () => ({ put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) });

const text = (font: unknown, hidden = false) => ({ type: 'text', hidden, props: { text: 'x', font } });

describe('project fonts', () => {
  beforeEach(() => clearPublicFontCache());

  it('stores the row and then the file in one transaction, under a lock on the project', async () => {
    const { db, statements } = fakeDb([{ rows: [] }, { rows: [{ count: 0, bytes: 0 }] }, inserted]);
    const stored = file();
    expect((await createProjectFont(db, face, stored)).id).toBe(fontId);
    const order = statements();
    expect(order[1]).toMatch(/pg_advisory_xact_lock\(hashtextextended\('project_fonts:'/);
    expect(order.findIndex((s) => /INSERT INTO project_fonts/.test(s))).toBeLessThan(order.indexOf('COMMIT'));
    expect(stored.put).toHaveBeenCalledTimes(1);
    expect(stored.remove).not.toHaveBeenCalled();
  });

  it('refuses a second face, a 51st font and a project over 10 MB, storing no file', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' });
    for (const [answers, error] of [
      [[{ rows: [] }, { rows: [{ count: 0, bytes: 0 }] }, duplicate], FontExistsError],
      [[{ rows: [] }, { rows: [{ count: MAX_PROJECT_FONTS, bytes: 0 }] }], FontLimitError],
      [[{ rows: [] }, { rows: [{ count: 1, bytes: String(MAX_PROJECT_FONT_BYTES - 63) }] }], FontStorageFullError],
    ] as const) {
      const { db, statements } = fakeDb([...answers]);
      const stored = file();
      await expect(createProjectFont(db, face, stored)).rejects.toBeInstanceOf(error);
      expect(stored.put).not.toHaveBeenCalled();
      expect(statements()).toContain('ROLLBACK');
    }
  });

  it('rolls the row back when the file cannot be stored, and removes the file when the commit fails', async () => {
    const failedPut = fakeDb([{ rows: [] }, { rows: [{ count: 0, bytes: 0 }] }, inserted]);
    const broken = { put: vi.fn(async () => Promise.reject(new Error('disk full'))), remove: vi.fn() };
    await expect(createProjectFont(failedPut.db, face, broken)).rejects.toThrow('disk full');
    expect(failedPut.statements()).toContain('ROLLBACK');
    expect(broken.remove).not.toHaveBeenCalled();

    const failedCommit = fakeDb([{ rows: [] }, { rows: [{ count: 0, bytes: 0 }] }, inserted], /^COMMIT$/);
    const stored = file();
    await expect(createProjectFont(failedCommit.db, face, stored)).rejects.toThrow('failed: COMMIT');
    expect(stored.remove).toHaveBeenCalledTimes(1);
  });

  it('reads a file only through its own project, and never queries for ids that are not UUIDs', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    expect(await getProjectFontFile(db, projectId, 'Brand')).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(await getProjectFontFile(db, projectId, fontId)).toBeNull();
    expect(query.mock.calls[0][1]).toEqual([fontId, projectId]);
  });

  it('locks the font row, then refuses the delete when tale_fonts records a use', async () => {
    const used = fakeDb([{ rows: [{ key: 'fonts/a.woff2' }] }, { rows: [{ title: 'Beach' }] }]);
    await expect(deleteProjectFont(used.db, projectId, fontId)).rejects.toBeInstanceOf(FontInUseError);
    const [, lock, check] = used.statements();
    expect(lock).toMatch(/FROM project_fonts WHERE id = \$1 AND project_id = \$2 FOR UPDATE/);
    expect(check).toMatch(/FROM tale_fonts tf JOIN tales t ON t\.id = tf\.tale_id\s+WHERE tf\.font_id = \$1/);
    expect(used.statements()).toContain('ROLLBACK');
    expect(used.statements().some((s) => /DELETE/.test(s))).toBe(false);

    const free = fakeDb([{ rows: [{ key: 'fonts/a.woff2' }] }, { rows: [] }, { rows: [] }]);
    await expect(deleteProjectFont(free.db, projectId, fontId)).resolves.toBe('fonts/a.woff2');
    expect(free.statements()).toContain('COMMIT');

    const missing = fakeDb([{ rows: [] }]);
    await expect(deleteProjectFont(missing.db, projectId, fontId)).rejects.toBeInstanceOf(FontNotFoundError);
    await expect(deleteProjectFont(missing.db, projectId, 'nope')).rejects.toBeInstanceOf(FontNotFoundError);
  });

  it('records the fonts a document uses, delivered only for visible text of a checked published document', async () => {
    const other = '0f0e0d0c-0000-4000-8000-00000000000b';
    const doc = { elements: [text({ source: 'project', fontId }), text({ source: 'project', fontId: other }, true)] };
    const published = fakeDb([]);
    await recordTaleFonts(published.db, taleId, 'published', doc, true);
    expect(published.query.mock.calls[0]).toEqual([
      'DELETE FROM tale_fonts WHERE tale_id = $1 AND document = $2',
      [taleId, 'published'],
    ]);
    // Joined on the tale's project: another project's font is never recorded.
    expect(published.query.mock.calls[1][0]).toMatch(
      /JOIN project_fonts f ON f\.id = x\.id AND f\.project_id = t\.project_id/,
    );
    expect(published.query.mock.calls[1][1]).toEqual([taleId, 'published', [fontId, other], [true, false]]);

    const unchecked = fakeDb([]);
    await recordTaleFonts(unchecked.db, taleId, 'published', doc, false);
    expect(unchecked.query.mock.calls[1][1]).toEqual([taleId, 'published', [fontId, other], [false, false]]);
    const draft = fakeDb([]);
    await recordTaleFonts(draft.db, taleId, 'draft', doc, true);
    expect(draft.query.mock.calls[1][1]).toEqual([taleId, 'draft', [fontId, other], [false, false]]);
    const none = fakeDb([]);
    await recordTaleFonts(none.db, taleId, 'draft', null, false);
    expect(none.query).toHaveBeenCalledTimes(1);
  });

  it('finds a public font through delivered tale_fonts rows of a live tale of a delivered group', async () => {
    const found = fakeDb([{ rows: [{}] }]);
    expect(await findPublishedFont(found.db, 'fonts/a.woff2')).toEqual({
      key: 'fonts/a.woff2',
      contentType: 'font/woff2',
    });
    const sql = found.statements()[0];
    expect(sql).toMatch(/JOIN tale_fonts tf ON tf\.font_id = f\.id AND tf\.document = 'published' AND tf\.delivered/);
    expect(sql).toMatch(/t\.status = 'live'/);
    // The delivered-group rule: live in its window, with a live tale, placed in a zone.
    expect(sql).toMatch(/g\.status = 'live'[\s\S]*FROM tales dt[\s\S]*FROM zone_tale_groups dz/);
    expect(sql).not.toMatch(/jsonb|draft_document/);
    expect(await findPublishedFont(fakeDb([{ rows: [] }]).db, 'fonts/b.woff2')).toBeNull();
  });

  it('keeps public answers for 30 s, at most, until a change in this process clears them', async () => {
    const now = new Date('2026-10-22T10:00:00Z');
    const { db, query } = fakeDb([{ rows: [{}] }, { rows: [] }, { rows: [] }]);
    expect(await findPublishedFont(db, 'fonts/a.woff2', now)).not.toBeNull();
    const later = new Date(now.getTime() + PUBLIC_FONT_CACHE_TTL_MS - 1);
    expect(await findPublishedFont(db, 'fonts/a.woff2', later)).not.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(await findPublishedFont(db, 'fonts/a.woff2', new Date(now.getTime() + PUBLIC_FONT_CACHE_TTL_MS))).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    clearPublicFontCache();
    await findPublishedFont(db, 'fonts/a.woff2', later);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('sweeps old font files that no font names, and keeps young or named ones', async () => {
    const now = Date.now();
    const old = new Date(now - FONT_SWEEP_MIN_AGE_MS - 1);
    const storage = {
      listKeys: vi.fn(async () => [
        { key: 'fonts/orphan.woff2', modifiedAt: old },
        { key: 'fonts/named.woff2', modifiedAt: old },
        { key: 'fonts/young.woff2', modifiedAt: new Date(now) },
      ]),
      delete: vi.fn(async () => undefined),
    };
    const { db } = fakeDb([{ rows: [] }, { rows: [{}] }]);
    expect(await sweepUnusedFontFiles(db, storage, now)).toBe(1);
    expect(storage.delete).toHaveBeenCalledWith('fonts/orphan.woff2');
    expect(storage.listKeys).toHaveBeenCalledWith('fonts');
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
