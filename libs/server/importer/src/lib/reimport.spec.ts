import type { Db } from '@taleart/server-access';
import {
  countChange,
  deleteRecord,
  emptyChanges,
  givenTags,
  lockRecord,
  mergeOrder,
  mergeTags,
  mergeValue,
  saveRecord,
  sweepImportRecords,
} from './reimport';

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
    expect(mergeTags(null, ['VIP'], ['vip', 'summer'])).toEqual({ add: ['summer'], removed: [], removedAtSource: [] });
  });

  it('adds names new at the source, never one a person removed, and reports names the source dropped', () => {
    const baseline = { tags: ['summer', 'vip', 'old'] };
    expect(mergeTags(baseline, ['old', 'manual'], ['summer', 'vip', 'new'])).toEqual({
      add: ['new'],
      removed: ['old'],
      removedAtSource: ['old'],
    });
  });

  it('keeps reporting a dropped name on later runs while the group carries it, and forgets it once back', () => {
    const later = { tags: ['summer'], removedTags: ['old'] };
    expect(mergeTags(later, ['old', 'summer'], ['summer'])).toEqual({
      add: [],
      removed: ['old'],
      removedAtSource: ['old'],
    });
    // Not carried any more: remembered, not reported.
    expect(mergeTags(later, ['summer'], ['summer'])).toEqual({ add: [], removed: ['old'], removedAtSource: [] });
    // Back at the source: no longer removed, and added again like a label new at the source.
    expect(mergeTags(later, ['summer'], ['summer', 'old'])).toEqual({ add: ['old'], removed: [], removedAtSource: [] });
  });
});

describe('givenTags', () => {
  it('remembers only names the group carries now or was given before, so a refused name can be added later', () => {
    // "capped" was refused by a limit: neither carried nor given before.
    expect(givenTags({ tags: ['vip'] }, ['summer'], ['summer', 'vip', 'capped'])).toEqual(['summer', 'vip']);
    expect(givenTags(null, ['Summer'], ['summer', 'capped'])).toEqual(['summer']);
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

  it('serializes on an advisory lock and writes no row for a record without a baseline', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await lockRecord({ query } as unknown as Db, 'tale', target)).toBeNull();
    const sql = query.mock.calls.map((c) => (c as unknown[])[0] as string);
    expect(sql[0]).toMatch(/pg_advisory_xact_lock\(hashtextextended\('import_records:'/);
    expect(sql.some((s) => /INSERT/.test(s))).toBe(false);
  });

  it('reads an existing baseline under a row lock', async () => {
    const query = vi.fn(async (sql: string) =>
      /FOR UPDATE/.test(sql) ? { rows: [{ fields: { name: 'A' } }] } : { rows: [] },
    );
    expect(await lockRecord({ query } as unknown as Db, 'tale', target)).toEqual({ name: 'A' });
    expect(query.mock.calls[1][0]).toMatch(
      /FROM import_records WHERE target_type = \$1 AND target_id = \$2 FOR UPDATE/,
    );
  });

  it('merges new fields into the recorded ones, and deletes a baseline', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await saveRecord({ query } as unknown as Db, 'taleGroup', target, project, { name: 'A', order: [target] });
    expect((query.mock.calls[0] as unknown[])[0]).toMatch(/SET fields = import_records\.fields \|\| EXCLUDED\.fields/);
    expect((query.mock.calls[0] as unknown[])[1]).toEqual([
      'taleGroup',
      target,
      project,
      JSON.stringify({ name: 'A', order: [target] }),
    ]);
    await deleteRecord({ query } as unknown as Db, 'tale', target);
    expect((query.mock.calls[1] as unknown[])[0]).toMatch(/DELETE FROM import_records/);
  });

  it('sweeps the baselines of records gone from TaleArt, checking each through its module, in batches', async () => {
    const gone = '00000000-0000-4000-8000-0000000000bb';
    const deleted: unknown[][] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/^DELETE/.test(sql)) {
        deleted.push(params);
        return { rows: [] };
      }
      // One page: (tale, target) exists, (tale, gone) does not, (zone, gone) has an unknown checker kind.
      return params[0] === ''
        ? {
            rows: [
              { type: 'tale', id: target },
              { type: 'tale', id: gone },
            ],
          }
        : { rows: [] };
    });
    const exists = {
      zone: vi.fn(async () => true),
      taleGroup: vi.fn(async () => true),
      tale: vi.fn(async (id: string) => id === target),
    };
    expect(await sweepImportRecords({ query } as unknown as Db, exists)).toBe(1);
    expect(deleted).toEqual([['tale', gone]]);
  });
});
