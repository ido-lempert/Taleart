import { ErrorCodes, findPlaybook, type AppliedPlaybook, type Frame, type Stage, type Zone } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import type { FrameTypeRegistry } from './frame-types';
import { createFrame, ZoneNotFoundError, zoneProjectId } from './frames';
import { createStage, StageKeyTakenError } from './stages';
import { ZONE_COLUMNS } from './zones';

/** Thrown when an apply request names no playbook key. */
export class PlaybookKeyRequiredError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor() {
    super('key is required');
    this.name = 'PlaybookKeyRequiredError';
  }
}

/** Thrown when a key is not in the playbook registry. */
export class UnknownPlaybookError extends Error {
  readonly code = ErrorCodes.unknownPlaybook;

  constructor(readonly key: string) {
    super(`"${key}" is not a playbook`);
    this.name = 'UnknownPlaybookError';
  }
}

/** Thrown when the zone already records another playbook: a zone records one. */
export class PlaybookAlreadyAppliedError extends Error {
  readonly code = ErrorCodes.playbookAlreadyApplied;

  constructor(readonly applied: string) {
    super(`This zone already has the playbook "${applied}"; a zone has one playbook`);
    this.name = 'PlaybookAlreadyAppliedError';
  }
}

// Runs `work` in one transaction on one connection; rolls back on any error.
async function inTransaction<T>(db: TransactionalDb, work: (tx: Db) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    tx.release();
    return result;
  } catch (err) {
    try {
      await tx.query('ROLLBACK');
      tx.release();
    } catch (rollbackErr) {
      // A connection that cannot roll back is not returned to the pool.
      tx.release(rollbackErr as Error);
    }
    throw err;
  }
}

/**
 * Applies a playbook from the registry to a zone (epic web zones R8): in one
 * transaction, with the zone row locked, creates each of its frames (validated
 * against the frame type's schema, AD-5) and the stage that shows it, then
 * records the playbook's key on the zone. The frames and stages are ordinary
 * rows and stay editable.
 *
 * Applying the zone's own playbook again creates nothing (`applied: false`).
 * A zone that has another playbook is refused, and so is a playbook whose
 * stage key the zone already uses; nothing is written then.
 */
export async function applyPlaybook(
  db: TransactionalDb,
  registry: FrameTypeRegistry,
  input: { zoneId: string; key: unknown },
): Promise<AppliedPlaybook> {
  // Zone first (404), then the body (400).
  if ((await zoneProjectId(db, input.zoneId)) === null) throw new ZoneNotFoundError(input.zoneId);
  if (typeof input.key !== 'string' || !input.key) throw new PlaybookKeyRequiredError();
  const playbook = findPlaybook(input.key);
  if (!playbook) throw new UnknownPlaybookError(input.key);

  return inTransaction(db, async (tx) => {
    // Locks the zone, so two applies to one zone run one after the other.
    const locked = await tx.query<Zone>(`SELECT ${ZONE_COLUMNS} FROM zones WHERE id = $1 FOR UPDATE`, [input.zoneId]);
    const zone = locked.rows[0];
    if (!zone) throw new ZoneNotFoundError(input.zoneId);
    if (zone.playbookKey === playbook.key) return { applied: false, zone, frames: [], stages: [] };
    if (zone.playbookKey !== null) throw new PlaybookAlreadyAppliedError(zone.playbookKey);

    // Every stage key is checked before anything is created, so the refusal names the first one taken.
    const stageKeys = playbook.frames.map((f) => f.stage.key);
    const taken = await tx.query<{ key: string }>('SELECT key FROM stages WHERE zone_id = $1 AND key = ANY($2::text[])', [
      input.zoneId,
      stageKeys,
    ]);
    const firstTaken = stageKeys.find((key) => taken.rows.some((row) => row.key === key));
    if (firstTaken !== undefined) throw new StageKeyTakenError(firstTaken);

    const frames: Frame[] = [];
    const stages: Stage[] = [];
    for (const preset of playbook.frames) {
      const frame = await createFrame(tx, registry, { zoneId: input.zoneId, type: preset.type, settings: preset.settings });
      frames.push(frame);
      stages.push(
        await createStage(tx, { zoneId: input.zoneId, name: preset.stage.name, key: preset.stage.key, frameId: frame.id }),
      );
    }
    const updated = await tx.query<Zone>(`UPDATE zones SET playbook_key = $2 WHERE id = $1 RETURNING ${ZONE_COLUMNS}`, [
      input.zoneId,
      playbook.key,
    ]);
    return { applied: true, zone: updated.rows[0], frames, stages };
  });
}
