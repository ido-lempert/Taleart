import { join } from 'node:path';
import { PLAYBOOKS, type Playbook } from '@taleart/contract';
import type { TransactionalDb } from '@taleart/server-access';
import { loadFrameTypeRegistry } from './frame-types';
import { ZoneNotFoundError } from './frames';
import {
  applyPlaybook,
  PlaybookAlreadyAppliedError,
  PlaybookConcurrentChangeError,
  PlaybookKeyRequiredError,
  UnknownPlaybookError,
} from './playbooks';
import { StageKeyTakenError } from './stages';

const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const frameId = '00000000-0000-4000-8000-000000000003';
const stageId = '00000000-0000-4000-8000-000000000004';

// The shipped frame-type registry, as the API loads it.
const registry = loadFrameTypeRegistry(join(__dirname, '../../../../contract/frame-types'));

/**
 * A fake pool whose zone records `playbookKey` and whose stages use `stageKeys`.
 * Every statement, on the pool or the transaction's connection, lands in `sql`.
 */
function fakeDb(state: { zone?: boolean; playbookKey?: string | null; stageKeys?: string[] } = {}) {
  const { zone = true, playbookKey = null, stageKeys = [] } = state;
  const sql: string[] = [];
  const params: unknown[][] = [];
  const zoneRow = (key: string | null) => ({ id: zoneId, name: 'Home', projectId, playbookKey: key });
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    sql.push(text.trim());
    params.push(values);
    if (/^SELECT project_id FROM zones/.test(text)) return { rows: zone ? [{ project_id: projectId }] : [] };
    if (/FROM zones WHERE id = \$1 FOR NO KEY UPDATE/.test(text)) return { rows: zone ? [zoneRow(playbookKey)] : [] };
    if (/^SELECT key FROM stages/.test(text)) {
      return { rows: stageKeys.filter((k) => (values[1] as string[]).includes(k)).map((key) => ({ key })) };
    }
    if (/^INSERT INTO frames/.test(text)) {
      return { rows: [{ id: frameId, zoneId, projectId, type: values[2], settings: JSON.parse(values[3] as string) }] };
    }
    if (/^SELECT 1 FROM frames/.test(text)) return { rows: [{}] };
    if (/^INSERT INTO stages/.test(text)) {
      return { rows: [{ id: stageId, zoneId, projectId, frameId: values[2], name: values[3], key: values[4] }] };
    }
    if (/^UPDATE zones SET playbook_key/.test(text)) return { rows: [zoneRow(values[1] as string)] };
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { db: { query, connect } as unknown as TransactionalDb, sql, params, connect, release };
}

describe('applyPlaybook', () => {
  it('ships presets whose settings the frame-type registry accepts', () => {
    for (const playbook of PLAYBOOKS) {
      for (const frame of playbook.frames) expect(() => registry.validate(frame.type, frame.settings)).not.toThrow();
    }
  });

  it('refuses an unknown zone, then a missing or unknown key, before opening a transaction', async () => {
    const missing = fakeDb({ zone: false });
    await expect(applyPlaybook(missing.db, registry, { zoneId, key: 'promo-banner' })).rejects.toBeInstanceOf(
      ZoneNotFoundError,
    );
    await expect(applyPlaybook(missing.db, registry, { zoneId: 'nope', key: 'promo-banner' })).rejects.toBeInstanceOf(
      ZoneNotFoundError,
    );
    const { db, connect } = fakeDb();
    for (const key of [undefined, '', 3, null]) {
      await expect(applyPlaybook(db, registry, { zoneId, key })).rejects.toBeInstanceOf(PlaybookKeyRequiredError);
    }
    await expect(applyPlaybook(db, registry, { zoneId, key: 'nope' })).rejects.toBeInstanceOf(UnknownPlaybookError);
    expect(connect).not.toHaveBeenCalled();
    expect(missing.connect).not.toHaveBeenCalled();
  });

  it('creates the preset frame and its stage, records the key, all in one transaction', async () => {
    const { db, sql, params, release } = fakeDb();
    const result = await applyPlaybook(db, registry, { zoneId, key: 'home-stories-bar' });
    expect(result).toEqual({
      applied: true,
      zone: { id: zoneId, name: 'Home', projectId, playbookKey: 'home-stories-bar' },
      frames: [
        {
          id: frameId,
          zoneId,
          projectId,
          type: 'bar',
          settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
        },
      ],
      stages: [{ id: stageId, zoneId, projectId, frameId, name: 'Home page stories bar', key: 'home-stories-bar' }],
    });
    const begin = sql.indexOf('BEGIN');
    const commit = sql.indexOf('COMMIT');
    expect(begin).toBeGreaterThan(-1);
    expect(sql.slice(begin + 1, commit).map((s) => s.split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'SELECT id, name,',
      'SELECT key FROM',
      'SELECT project_id FROM',
      'INSERT INTO frames',
      'SELECT project_id FROM',
      'SELECT 1 FROM',
      'INSERT INTO stages',
      'UPDATE zones SET',
    ]);
    expect(sql[begin + 1]).toMatch(/FOR NO KEY UPDATE$/);
    expect(params[sql.findIndex((s) => s.startsWith('UPDATE zones'))]).toEqual([zoneId, 'home-stories-bar']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('creates nothing when the zone already has the playbook', async () => {
    const { db, sql } = fakeDb({ playbookKey: 'promo-banner', stageKeys: ['promo-banner'] });
    expect(await applyPlaybook(db, registry, { zoneId, key: 'promo-banner' })).toEqual({
      applied: false,
      zone: { id: zoneId, name: 'Home', projectId, playbookKey: 'promo-banner' },
      frames: [],
      stages: [],
    });
    expect(sql.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
    expect(sql).toContain('COMMIT');
  });

  it('refuses a zone with another playbook, and a stage key the zone uses, writing nothing', async () => {
    const other = fakeDb({ playbookKey: 'home-stories-bar' });
    await expect(applyPlaybook(other.db, registry, { zoneId, key: 'promo-banner' })).rejects.toBeInstanceOf(
      PlaybookAlreadyAppliedError,
    );
    const taken = fakeDb({ stageKeys: ['promo-banner'] });
    const err = await applyPlaybook(taken.db, registry, { zoneId, key: 'promo-banner' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageKeyTakenError);
    expect((err as StageKeyTakenError).key).toBe('promo-banner');
    for (const { sql, release } of [other, taken]) {
      expect(sql.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
      expect(sql).toContain('ROLLBACK');
      expect(sql).not.toContain('COMMIT');
      expect(release).toHaveBeenCalledTimes(1);
    }
  });

  it('rolls back when a write inside the transaction fails', async () => {
    const { db, sql } = fakeDb();
    const query = (db as unknown as { query: ReturnType<typeof vi.fn> }).query;
    const original = query.getMockImplementation();
    query.mockImplementation(async (text: string, values?: unknown[]) => {
      if (/^\s*INSERT INTO stages/.test(text)) throw new Error('boom');
      return original?.(text, values);
    });
    await expect(applyPlaybook(db, registry, { zoneId, key: 'home-stories-bar' })).rejects.toThrow('boom');
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
  });

  // Makes the zone's lock fail with `code` on the first `failures` attempts.
  function failingLock(db: TransactionalDb, code: string, failures: number): void {
    const query = (db as unknown as { query: ReturnType<typeof vi.fn> }).query;
    const original = query.getMockImplementation();
    let left = failures;
    query.mockImplementation(async (text: string, values?: unknown[]) => {
      if (/FOR NO KEY UPDATE/.test(text) && left-- > 0) throw Object.assign(new Error(code), { code });
      return original?.(text, values);
    });
  }

  it('runs the apply once more after a deadlock or serialization failure', async () => {
    for (const code of ['40P01', '40001']) {
      const { db, sql } = fakeDb();
      failingLock(db, code, 1);
      expect((await applyPlaybook(db, registry, { zoneId, key: 'promo-banner' })).applied).toBe(true);
      expect(sql.filter((s) => s === 'BEGIN')).toHaveLength(2);
      expect(sql.filter((s) => s === 'ROLLBACK')).toHaveLength(1);
      expect(sql.filter((s) => s === 'COMMIT')).toHaveLength(1);
    }
  });

  it('gives up with a concurrent change after the second failure, and never retries other errors', async () => {
    const twice = fakeDb();
    failingLock(twice.db, '40P01', 2);
    await expect(applyPlaybook(twice.db, registry, { zoneId, key: 'promo-banner' })).rejects.toBeInstanceOf(
      PlaybookConcurrentChangeError,
    );
    expect(twice.sql.filter((s) => s === 'BEGIN')).toHaveLength(2);
    const other = fakeDb();
    failingLock(other.db, '23505', 1);
    await expect(applyPlaybook(other.db, registry, { zoneId, key: 'promo-banner' })).rejects.toThrow('23505');
    expect(other.sql.filter((s) => s === 'BEGIN')).toHaveLength(1);
  });

  it('creates the frames and stages of a playbook in its order', async () => {
    const twoFrames: Playbook = {
      key: 'two',
      label: 'Two',
      goal: 'Test',
      frames: [
        {
          type: 'banner',
          settings: PLAYBOOKS[1].frames[0].settings,
          stage: { key: 'first', name: 'First' },
        } as Playbook['frames'][number],
        {
          type: 'bar',
          settings: PLAYBOOKS[0].frames[0].settings,
          stage: { key: 'second', name: 'Second' },
        } as Playbook['frames'][number],
      ],
    };
    const { db, sql, params } = fakeDb();
    const result = await applyPlaybook(db, registry, { zoneId, key: 'two' }, [twoFrames]);
    expect(result.frames.map((f) => f.type)).toEqual(['banner', 'bar']);
    expect(result.stages.map((s) => s.key)).toEqual(['first', 'second']);
    const inserts = sql.flatMap((s, i) =>
      /^INSERT INTO (frames|stages)/.test(s)
        ? [[s.split(' ')[2], params[i][s.startsWith('INSERT INTO frames') ? 2 : 4]]]
        : [],
    );
    expect(inserts).toEqual([
      ['frames', 'banner'],
      ['stages', 'first'],
      ['frames', 'bar'],
      ['stages', 'second'],
    ]);
    await expect(applyPlaybook(db, registry, { zoneId, key: 'home-stories-bar' }, [twoFrames])).rejects.toBeInstanceOf(
      UnknownPlaybookError,
    );
  });
});
