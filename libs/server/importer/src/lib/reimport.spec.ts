import type { Db } from '@taleart/server-access';
import { countChange, emptyChanges, lockRecord, mergeOrder, mergeTags, mergeValue, saveRecord } from './reimport';

describe('mergeValue', () => {
  it('writes the source value while nobody changed the field in TaleArt', () => {
    expect(mergeValue('Old', 'Old', 'New')).toEqual({ write: 'New', keptLocalEdit: false, baseline: 'New' });
  });

  it('writes nothing when TaleArt already holds the source value', () => {
    expect(mergeValue('Old', 'Same', 'Same')).toEqual({ write: null, keptLocalEdit: false, baseline: 'Same' });
    expect(mergeValue(undefined, 'Same', 'Same')).toEqual({ write: null, keptLocalEdit: false, baseline: 'Same' });
  });

  it("keeps a person's value: a kept local edit only when the source changed too", () => {
    expect(mergeValue('Old', 'Mine', 'Old')).toEqual({ write: null, keptLocalEdit: false, baseline: 'Old' });
    expect(mergeValue('Old', 'Mine', 'New')).toEqual({ write: null, keptLocalEdit: true, baseline: 'Old' });
  });

  it('keeps a differing value of a record imported before baselines, and records the source value', () => {
    expect(mergeValue(undefined, 'Earlier', 'New')).toEqual({ write: null, keptLocalEdit: true, baseline: 'New' });
  });
});

describe('mergeOrder', () => {
  it('writes the source order while nobody re-ordered in TaleArt, keeping other records in their places', () => {
    // x was added in TaleArt; a, b, c are imported, and the source swapped a and c.
    expect(mergeOrder(['a', 'b', 'c'], ['a', 'x', 'b', 'c'], ['c', 'b', 'a'])).toEqual({
      write: ['c', 'x', 'b', 'a'],
      keptLocalEdit: false,
      baseline: ['c', 'b', 'a'],
    });
  });

  it('writes nothing when the order already follows the source', () => {
    expect(mergeOrder(['a', 'b'], ['a', 'x', 'b'], ['a', 'b'])).toEqual({
      write: null,
      keptLocalEdit: false,
      baseline: ['a', 'b'],
    });
  });

  it("keeps a person's re-order: a kept local edit only when the source re-ordered too", () => {
    expect(mergeOrder(['a', 'b', 'c'], ['b', 'a', 'c'], ['a', 'b', 'c'])).toEqual({
      write: null,
      keptLocalEdit: false,
      baseline: ['a', 'b', 'c'],
    });
    expect(mergeOrder(['a', 'b', 'c'], ['b', 'a', 'c'], ['c', 'b', 'a'])).toEqual({
      write: null,
      keptLocalEdit: true,
      baseline: ['a', 'b', 'c'],
    });
  });

  it('moves a record new at the source to its source place, and ignores records not in the container', () => {
    // n was created at the end; gone is imported but no longer in this container.
    expect(mergeOrder(['a', 'b'], ['a', 'b', 'n'], ['n', 'a', 'gone', 'b'])).toEqual({
      write: ['n', 'a', 'b'],
      keptLocalEdit: false,
      baseline: ['n', 'a', 'b'],
    });
  });

  it('keeps a differing order of a container imported before baselines', () => {
    expect(mergeOrder(undefined, ['b', 'a'], ['a', 'b'])).toEqual({
      write: null,
      keptLocalEdit: true,
      baseline: ['a', 'b'],
    });
  });
});

describe('mergeTags', () => {
  it('adds every source name without a baseline, except names the group carries in any case', () => {
    expect(mergeTags(undefined, ['VIP'], ['vip', 'summer'])).toEqual({
      add: ['summer'],
      removedAtSource: [],
      baseline: ['vip', 'summer'],
    });
  });

  it('adds names new at the source, never one a person removed, and reports names the source dropped', () => {
    expect(mergeTags(['summer', 'vip', 'old'], ['old', 'manual'], ['summer', 'vip', 'new'])).toEqual({
      add: ['new'],
      removedAtSource: ['old'],
      baseline: ['summer', 'vip', 'new'],
    });
  });

  it('does not report a dropped name the group no longer carries', () => {
    expect(mergeTags(['old'], [], [])).toEqual({ add: [], removedAtSource: [], baseline: [] });
  });
});

describe('change counts', () => {
  it('counts an outcome and a kept local edit on top of it', () => {
    const count = emptyChanges();
    countChange(count, 'unchanged', true);
    countChange(count, 'updated', false);
    expect(count).toEqual({ created: 0, updated: 1, unchanged: 1, keptLocalEdit: 1, removedAtSource: 0 });
  });
});

describe('baselines', () => {
  const target = '00000000-0000-4000-8000-0000000000aa';
  const project = '00000000-0000-4000-8000-000000000002';

  it('locks the row, creating an empty one for a record without a baseline', async () => {
    const query = vi.fn(async (sql: string) =>
      /RETURNING fields/.test(sql) ? { rows: [{ fields: {} }] } : { rows: [] },
    );
    expect(await lockRecord({ query } as unknown as Db, 'tale', target, project)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reads an existing baseline under a row lock', async () => {
    const query = vi.fn(async (sql: string) =>
      /FOR UPDATE/.test(sql) ? { rows: [{ fields: { name: 'A' } }] } : { rows: [] },
    );
    expect(await lockRecord({ query } as unknown as Db, 'tale', target, project)).toEqual({ name: 'A' });
    expect(query.mock.calls[1][0]).toMatch(
      /FROM import_records WHERE target_type = \$1 AND target_id = \$2 FOR UPDATE/,
    );
  });

  it('merges new fields into the recorded ones', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await saveRecord({ query } as unknown as Db, 'taleGroup', target, project, { name: 'A', order: [target] });
    expect(query.mock.calls[0]).toEqual([
      expect.stringMatching(/SET fields = import_records\.fields \|\| EXCLUDED\.fields/),
      ['taleGroup', target, project, JSON.stringify({ name: 'A', order: [target] })],
    ]);
  });
});
