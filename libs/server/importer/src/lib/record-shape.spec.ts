import type { ImportDifference } from '@taleart/contract';
import { checkRecord, MAX_DIFFERENCES_PER_RECORD, REPORT_TEXT_LIMIT, storedText } from './record-shape';

// A clean story as the import expects it: every required field, no value in a field TaleArt does not hold.
const cleanStory = () => ({
  id: 4001,
  story_group_id: 3001,
  account_id: 501,
  title: 'Up to 50% off',
  name: 'Up to 50% off',
  type: 1,
  status: 1,
  sort_order: 0,
  media: 'https://media.example/a.jpg',
  media_raw: null,
  studio_image: null,
  mime_type: 'image/jpeg',
  thumbnail: null,
  deep_link: null,
  outlink: null,
  button_text: null,
  settings: {},
  target_cap: null,
  ts_created: '2026-09-01 10:00:00',
  ts_start: null,
  ts_updated: '2026-09-01 10:00:00',
  ts_end: null,
});

const cleanGroup = () => ({
  id: 3001,
  app_id: 1001,
  instance_id: 2001,
  account_id: 501,
  title: 'Summer sale',
  status: 1,
  sort_order: 2,
  pinned: false,
  segments: [],
  settings: {},
  ts_start: null,
  ts_end: null,
  ts_created: '2026-09-01 10:00:00',
  ts_updated: '2026-09-01 10:00:00',
});

// Each difference as "kind field" (with "<- sourceField" for a rename), for short assertions.
const brief = (differences: ImportDifference[]) =>
  differences.map((d) => [d.kind, d.field, d.sourceField].filter((part) => part !== null).join(' '));

describe('checkRecord', () => {
  it("finds no difference in a clean record and maps id, title and sort_order, and a story's media and mime_type", () => {
    expect(checkRecord('tale', cleanStory(), 1)).toEqual({
      record: {
        id: '4001',
        name: 'Up to 50% off',
        sortOrder: 0,
        media: 'https://media.example/a.jpg',
        mimeType: 'image/jpeg',
      },
      differences: [],
      omitted: 0,
    });
    expect(checkRecord('taleGroup', cleanGroup(), 1).differences).toEqual([]);
    expect(checkRecord('taleGroup', cleanGroup(), 1).record).not.toHaveProperty('media');
    expect(checkRecord('zone', { id: 2001, app_id: 1001, title: 'Home', platform: 'web' }, 1).differences).toEqual([]);
    expect(checkRecord('app', { id: 1001, title: 'Shop', token: 'app-token', settings: {} }, 1).differences).toEqual([]);
  });

  it('uses a renamed title and lists the rename', () => {
    const { record, differences } = checkRecord('zone', { id: 2101, name: 'Odd home' }, 1);
    expect(record).toMatchObject({ id: '2101', name: 'Odd home' });
    expect(differences).toEqual([
      {
        entity: 'zone',
        record: { sourceId: '2101', name: 'Odd home', within: null, withinSourceId: null, position: 1 },
        kind: 'renamed',
        field: 'title',
        sourceField: 'name',
      },
    ]);
  });

  it('finds a field spelled in another case or with other separators, and the documented cap misspelling', () => {
    const story = { ...cleanStory(), sortOrder: 3 } as Record<string, unknown>;
    delete story['sort_order'];
    const checked = checkRecord('tale', story, 1);
    expect(checked.record?.sortOrder).toBe(3);
    expect(brief(checked.differences)).toEqual(['renamed sort_order sortOrder']);

    const group = { ...cleanGroup(), click_target_cap: 5 };
    expect(brief(checkRecord('taleGroup', group, 1).differences)).toEqual([
      'renamed clicked_target_cap click_target_cap',
      'notHeld clicked_target_cap',
    ]);
  });

  it('lists an unexpected field, and a field TaleArt does not hold only when it has a value', () => {
    const story = {
      ...cleanStory(),
      deep_link: 'https://shop.example/x',
      button_text: 'Shop now',
      outlink: '',
      settings: { theme: 'dark' },
      thumbnail: false,
      cta_macro: 'x',
    };
    expect(brief(checkRecord('tale', story, 1).differences)).toEqual([
      'notHeld deep_link',
      'notHeld button_text',
      'notHeld settings',
      'unexpected cta_macro',
    ]);
    const group = { ...cleanGroup(), pinned: true, media: 'https://media.example/cover.png', theme: 'dark' };
    expect(brief(checkRecord('taleGroup', group, 1).differences)).toEqual([
      'notHeld media',
      'notHeld pinned',
      'unexpected theme',
    ]);
    expect(brief(checkRecord('zone', { id: 1, title: 'A', token: 'instance-token' }, 1).differences)).toEqual([
      'notHeld token',
    ]);
    expect(brief(checkRecord('app', { id: 1, title: 'A', settings: { a: 1 } }, 1).differences)).toEqual([
      'notHeld settings',
    ]);
  });

  it("lists a story's internal name only when it is not its title", () => {
    expect(checkRecord('tale', { ...cleanStory(), name: '' }, 1).differences).toEqual([]);
    expect(brief(checkRecord('tale', { ...cleanStory(), name: 'Internal' }, 1).differences)).toEqual(['notHeld name']);
  });

  it('lists a missing field and a field of the wrong type, with the fallbacks for title and position', () => {
    const group = { ...cleanGroup(), title: 42, sort_order: 'first' } as Record<string, unknown>;
    delete group['status'];
    const checked = checkRecord('taleGroup', group, 2);
    expect(checked.record).toMatchObject({ id: '3001', name: '', sortOrder: null });
    expect(brief(checked.differences)).toEqual(['wrongType title', 'wrongType sort_order', 'missing status']);
    expect(checked.differences[0].record).toEqual({ sourceId: '3001', name: null, within: null, withinSourceId: null, position: 2 });

    const story = { ...cleanStory(), media: null } as Record<string, unknown>;
    delete story['title'];
    expect(brief(checkRecord('tale', story, 1).differences)).toEqual(['missing title', 'wrongType media', 'notHeld name']);
  });

  it('rejects a record that is not an object or has no usable id', () => {
    for (const raw of ['oops', null, [1], 7]) {
      expect(checkRecord('zone', raw, 3)).toEqual({
        record: null,
        differences: [
          {
            entity: 'zone',
            record: { sourceId: null, name: null, within: null, withinSourceId: null, position: 3 },
            kind: 'invalidRecord',
            field: null,
            sourceField: null,
          },
        ],
        omitted: 0,
      });
    }
    for (const id of [undefined, {}, '  ', Number.NaN]) {
      const checked = checkRecord('tale', { ...cleanStory(), id }, 4);
      expect(checked.record).toBeNull();
      expect(checked.differences).toEqual([
        expect.objectContaining({ kind: 'invalidRecord', record: expect.objectContaining({ name: 'Up to 50% off' }) }),
      ]);
    }
  });

  it('never carries a field value, and cuts long names', () => {
    const secret = 'value-that-must-not-appear';
    const long = 'x'.repeat(REPORT_TEXT_LIMIT + 50);
    const { differences } = checkRecord('tale', { ...cleanStory(), title: long, name: long, deep_link: secret, [long]: secret }, 1);
    expect(JSON.stringify(differences)).not.toContain(secret);
    for (const d of differences) {
      expect((d.record.name ?? '').length).toBeLessThanOrEqual(REPORT_TEXT_LIMIT);
      expect((d.field ?? '').length).toBeLessThanOrEqual(REPORT_TEXT_LIMIT);
    }
    expect(brief(differences).map((b) => b.slice(0, 16))).toEqual(['notHeld deep_lin', 'unexpected xxxxx']);
  });

  it('removes the token from the whole text before cutting it, so no part of it is left', () => {
    const token = 'tok-' + 'S'.repeat(40);
    // The token straddles the cut at REPORT_TEXT_LIMIT characters.
    const straddling = 'a'.repeat(REPORT_TEXT_LIMIT - 10) + token + 'tail';
    expect(storedText(straddling, token)).toBe(`${'a'.repeat(REPORT_TEXT_LIMIT - 10)}[token]tail`.slice(0, REPORT_TEXT_LIMIT - 1) + '…');
    const text = (value: string) => storedText(value, token);
    const { differences } = checkRecord('tale', { ...cleanStory(), title: straddling, name: straddling, [straddling]: 1 }, 1, { text });
    const stored = JSON.stringify(differences);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain('SSSSS');
    expect(differences.map((d) => d.kind)).toEqual(['unexpected']);
    expect(differences[0].record.name).toContain('[token]');
    expect(differences[0].field).toContain('[token]');
  });

  it(`builds at most ${MAX_DIFFERENCES_PER_RECORD} differences per record and counts the rest`, () => {
    const extra = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`extra_${i}`, i]));
    const checked = checkRecord('tale', { ...cleanStory(), ...extra }, 1);
    expect(checked.differences).toHaveLength(MAX_DIFFERENCES_PER_RECORD);
    expect(checked.omitted).toBe(80 - MAX_DIFFERENCES_PER_RECORD);
  });

  it('builds no difference once the budget is spent, and only counts them', () => {
    const budget = { remaining: 2 };
    const story = { ...cleanStory(), deep_link: 'x', button_text: 'y', outlink: 'z' };
    const first = checkRecord('tale', story, 1, { budget });
    expect(first.differences.map((d) => d.field)).toEqual(['deep_link', 'outlink']);
    expect(first.omitted).toBe(1);
    expect(budget.remaining).toBe(0);
    const second = checkRecord('tale', 'oops', 2, { budget });
    expect(second).toEqual({ record: null, differences: [], omitted: 1 });
  });

  it('checks a record of 100,000 fields in one pass, building only the capped differences', () => {
    const raw: Record<string, unknown> = { ...cleanStory() };
    for (let i = 0; i < 100_000; i++) raw[`Field_${i}`] = i;
    // Spellings of expected fields hide among them: each is found by its normalized name.
    delete raw['sort_order'];
    raw['SORT-ORDER'] = 4;
    const checked = checkRecord('tale', raw, 1);
    expect(checked.record?.sortOrder).toBe(4);
    expect(checked.differences).toHaveLength(MAX_DIFFERENCES_PER_RECORD);
    expect(checked.differences[0]).toMatchObject({ kind: 'renamed', field: 'sort_order', sourceField: 'SORT-ORDER' });
    expect(checked.differences.length + checked.omitted).toBe(1 + 100_000);
  });
});
