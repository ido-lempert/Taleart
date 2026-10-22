import { join } from 'node:path';
import { PLAYBOOKS } from '@taleart/contract';
import type { TransactionalDb } from '@taleart/server-access';
import { loadFrameTypeRegistry } from './frame-types';
import { DisplayExistsError, ZoneNotFoundError } from './frames';
import {
  applyPlaybook,
  PlaybookAlreadyAppliedError,
  PlaybookConcurrentChangeError,
  PlaybookKeyRequiredError,
  UnknownPlaybookError,
} from './playbooks';

const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const frameId = '00000000-0000-4000-8000-000000000003';

// The shipped frame-type registry, as the API loads it.
const registry = loadFrameTypeRegistry(join(__dirname, '../../../../contract/frame-types'));

/**
 * A fake pool whose zone records `playbookKey` and has a display when `display` is set.
 * Every statement, on the pool or the transaction's connection, lands in `sql`.
 */
function fakeDb(state: { zone?: boolean; playbookKey?: string | null; display?: boolean } = {}) {
  const { zone = true, playbookKey = null, display = false } = state;
  const sql: string[] = [];
  const params: unknown[][] = [];
  let frame: unknown = display ? { id: frameId, zoneId, projectId, type: 'bar', settings: {} } : null;
  const zoneRow = (key: string | null) => ({ id: zoneId, name: 'Home', slug: 'home', projectId, playbookKey: key, frame });
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    sql.push(text.trim());
    params.push(values);
    if (/^SELECT project_id FROM zones/.test(text)) return { rows: zone ? [{ project_id: projectId }] : [] };
    if (/FROM zones WHERE id = \$1 FOR NO KEY UPDATE/.test(text)) return { rows: zone ? [zoneRow(playbookKey)] : [] };
    if (/^INSERT INTO frames/.test(text)) {
      frame = { id: frameId, zoneId, projectId, type: values[2], settings: JSON.parse(values[3] as string) };
      return { rows: [frame] };
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
      expect(() => registry.validate(playbook.frame.type, playbook.frame.settings)).not.toThrow();
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

  it('gives the zone the preset display and records the key, all in one transaction', async () => {
    const { db, sql, params, release } = fakeDb();
    const result = await applyPlaybook(db, registry, { zoneId, key: 'home-stories-bar' });
    const frame = {
      id: frameId,
      zoneId,
      projectId,
      type: 'bar',
      settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
    };
    expect(result).toEqual({
      applied: true,
      zone: { id: zoneId, name: 'Home', slug: 'home', projectId, playbookKey: 'home-stories-bar', frame },
    });
    const begin = sql.indexOf('BEGIN');
    const commit = sql.indexOf('COMMIT');
    expect(begin).toBeGreaterThan(-1);
    expect(sql.slice(begin + 1, commit).map((s) => s.split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'SELECT zones.id,',
      'SELECT project_id',
      'INSERT INTO',
      'UPDATE zones',
    ]);
    expect(sql[begin + 1]).toMatch(/FOR NO KEY UPDATE$/);
    expect(params[sql.findIndex((s) => s.startsWith('UPDATE zones'))]).toEqual([zoneId, 'home-stories-bar']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('creates nothing when the zone already has the playbook', async () => {
    const { db, sql } = fakeDb({ playbookKey: 'promo-banner', display: true });
    const result = await applyPlaybook(db, registry, { zoneId, key: 'promo-banner' });
    expect(result.applied).toBe(false);
    expect(result.zone.playbookKey).toBe('promo-banner');
    expect(sql.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
    expect(sql).toContain('COMMIT');
  });

  it('refuses a zone with another playbook, and a zone that has a display, writing nothing', async () => {
    const other = fakeDb({ playbookKey: 'home-stories-bar' });
    await expect(applyPlaybook(other.db, registry, { zoneId, key: 'promo-banner' })).rejects.toBeInstanceOf(
      PlaybookAlreadyAppliedError,
    );
    const shown = fakeDb({ display: true });
    await expect(applyPlaybook(shown.db, registry, { zoneId, key: 'promo-banner' })).rejects.toBeInstanceOf(
      DisplayExistsError,
    );
    for (const { sql, release } of [other, shown]) {
      expect(sql.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
      expect(sql).toContain('ROLLBACK');
      expect(release).toHaveBeenCalledTimes(1);
    }
  });

  it('rolls back when a write inside the transaction fails', async () => {
    const { db, sql } = fakeDb();
    const query = (db as unknown as { query: ReturnType<typeof vi.fn> }).query;
    const original = query.getMockImplementation();
    query.mockImplementation(async (text: string, values?: unknown[]) => {
      if (/^\s*UPDATE zones SET playbook_key/.test(text)) throw new Error('boom');
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
});
