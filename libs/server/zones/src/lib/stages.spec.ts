import type { Db } from '@taleart/server-access';
import { ZoneNotFoundError } from './frames';
import {
  createStage,
  deleteStage,
  InvalidStageError,
  listDeliveryStages,
  listStages,
  renameStage,
  StageFrameNotFoundError,
  StageKeyTakenError,
  StageNotFoundError,
} from './stages';

const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const frameId = '00000000-0000-4000-8000-000000000003';
const stageId = '00000000-0000-4000-8000-000000000004';

// A database whose zone exists, answering each later query with `results` in turn.
function fakeDb(...results: unknown[]): { db: Db; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ project_id: projectId }] });
  for (const result of results) {
    if (result instanceof Error) query.mockRejectedValueOnce(result);
    else query.mockResolvedValueOnce(result);
  }
  return { db: { query } as unknown as Db, query };
}

const stage = { id: stageId, zoneId, projectId, frameId, name: 'Top bar', key: 'top-bar' };

describe('stages', () => {
  it('refuses every action on an unknown zone, or a zone id that is not a UUID, before anything else', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db = { query } as unknown as Db;
    await expect(listStages(db, zoneId)).rejects.toBeInstanceOf(ZoneNotFoundError);
    await expect(createStage(db, { zoneId, name: '', key: '', frameId: '' })).rejects.toBeInstanceOf(ZoneNotFoundError);
    await expect(renameStage(db, { zoneId, stageId, name: '' })).rejects.toBeInstanceOf(ZoneNotFoundError);
    await expect(deleteStage(db, { zoneId, stageId })).rejects.toBeInstanceOf(ZoneNotFoundError);
    expect(query).toHaveBeenCalledTimes(4);
    await expect(listStages(db, 'nope')).rejects.toBeInstanceOf(ZoneNotFoundError);
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('lists the zone stages oldest first', async () => {
    const { db, query } = fakeDb({ rows: [stage] });
    expect(await listStages(db, zoneId)).toEqual([stage]);
    expect(query.mock.calls[1][0]).toMatch(/WHERE zone_id = \$1 ORDER BY created_at, id/);
  });

  it('creates a stage with a trimmed name in the zone project', async () => {
    const { db, query } = fakeDb({ rows: [{}] }, { rows: [stage] });
    expect(await createStage(db, { zoneId, name: '  Top bar ', key: 'top-bar', frameId })).toEqual(stage);
    expect(query.mock.calls[1][1]).toEqual([frameId, zoneId]);
    expect(query.mock.calls[2][1]).toEqual([zoneId, projectId, frameId, 'Top bar', 'top-bar']);
  });

  it('refuses a blank name, a bad key or a missing frame without writing', async () => {
    for (const input of [
      { name: '  ', key: 'top', frameId },
      { name: 7, key: 'top', frameId },
      { name: 'Top', key: 'Top Bar', frameId },
      { name: 'Top', key: 'top--bar', frameId },
      { name: 'Top', key: 'a'.repeat(65), frameId },
      { name: 'Top', key: undefined, frameId },
      { name: 'Top', key: 'top', frameId: undefined },
      { name: 'Top', key: 'top', frameId: 3 },
    ]) {
      const { db, query } = fakeDb();
      await expect(createStage(db, { zoneId, ...input })).rejects.toBeInstanceOf(InvalidStageError);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses a frame that is not one of the zone frames', async () => {
    const notUuid = fakeDb();
    await expect(createStage(notUuid.db, { zoneId, name: 'Top', key: 'top', frameId: 'f1' })).rejects.toBeInstanceOf(
      StageFrameNotFoundError,
    );
    expect(notUuid.query).toHaveBeenCalledTimes(1);

    const other = fakeDb({ rows: [] });
    await expect(createStage(other.db, { zoneId, name: 'Top', key: 'top', frameId })).rejects.toBeInstanceOf(
      StageFrameNotFoundError,
    );
    expect(other.query).toHaveBeenCalledTimes(2);
  });

  it('turns the unique key violation into StageKeyTakenError, and a vanished frame into StageFrameNotFoundError', async () => {
    const taken = Object.assign(new Error('duplicate'), { code: '23505', constraint: 'stages_zone_id_key_key' });
    const dup = fakeDb({ rows: [{}] }, taken);
    await expect(createStage(dup.db, { zoneId, name: 'Top', key: 'top', frameId })).rejects.toBeInstanceOf(
      StageKeyTakenError,
    );

    const gone = Object.assign(new Error('fk'), { code: '23503' });
    const vanished = fakeDb({ rows: [{}] }, gone);
    await expect(createStage(vanished.db, { zoneId, name: 'Top', key: 'top', frameId })).rejects.toBeInstanceOf(
      StageFrameNotFoundError,
    );

    const other = new Error('boom');
    const failing = fakeDb({ rows: [{}] }, other);
    await expect(createStage(failing.db, { zoneId, name: 'Top', key: 'top', frameId })).rejects.toBe(other);
  });

  it('renames only the name, within the zone', async () => {
    const { db, query } = fakeDb({ rows: [{ ...stage, name: 'Hero' }] });
    expect(await renameStage(db, { zoneId, stageId, name: ' Hero ' })).toEqual({ ...stage, name: 'Hero' });
    expect(query.mock.calls[1][0]).toMatch(/UPDATE stages SET name = \$3 WHERE id = \$1 AND zone_id = \$2/);
    expect(query.mock.calls[1][1]).toEqual([stageId, zoneId, 'Hero']);
  });

  it('refuses a blank rename, and a stage that is not in the zone', async () => {
    await expect(renameStage(fakeDb().db, { zoneId, stageId, name: ' ' })).rejects.toBeInstanceOf(InvalidStageError);
    await expect(renameStage(fakeDb().db, { zoneId, stageId: 'x', name: 'A' })).rejects.toBeInstanceOf(
      StageNotFoundError,
    );
    await expect(renameStage(fakeDb({ rows: [] }).db, { zoneId, stageId, name: 'A' })).rejects.toBeInstanceOf(
      StageNotFoundError,
    );
  });

  it('deletes a stage of the zone, and refuses one that is not in it', async () => {
    const { db, query } = fakeDb({ rowCount: 1, rows: [] });
    await deleteStage(db, { zoneId, stageId });
    expect(query.mock.calls[1][1]).toEqual([stageId, zoneId]);
    await expect(deleteStage(fakeDb({ rowCount: 0, rows: [] }).db, { zoneId, stageId })).rejects.toBeInstanceOf(
      StageNotFoundError,
    );
    await expect(deleteStage(fakeDb().db, { zoneId, stageId: 'x' })).rejects.toBeInstanceOf(StageNotFoundError);
  });

  it('delivers only the key and frame of each stage', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ key: 'top-bar', frameId }] });
    expect(await listDeliveryStages({ query } as unknown as Db, zoneId)).toEqual([{ key: 'top-bar', frameId }]);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT key, frame_id AS "frameId" FROM stages/);
  });
});
