import { ErrorCodes, PLAYBOOKS, type Playbook } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import type { FrameTypeRegistry } from './frame-types';
import { DisplayExistsError, setDisplay, ZoneNotFoundError, zoneProjectId } from './frames';
import { ZONE_COLUMNS, type StoredAppliedPlaybook, type StoredZone } from './zones';

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

/** Thrown when a concurrent change to the zone made the apply fail twice in a row; trying again may succeed. */
export class PlaybookConcurrentChangeError extends Error {
  readonly code = ErrorCodes.concurrentChange;

  constructor() {
    super('The zone changed while the playbook was applied. Try again.');
    this.name = 'PlaybookConcurrentChangeError';
  }
}

// PostgreSQL's deadlock_detected and serialization_failure: the transaction can run again.
const RETRYABLE = new Set(['40P01', '40001']);

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
 * Applies a playbook from the registry to a zone (epic web zones R8, AD-17): in one transaction,
 * with the zone row locked, gives the zone the playbook's display (validated against the frame
 * type's schema, AD-5), then records the playbook's key on the zone. The display stays editable.
 *
 * Applying the zone's own playbook again creates nothing (`applied: false`). A zone that has
 * another playbook is refused, and so is a zone that already has a display (a zone has one);
 * nothing is written then.
 */
export async function applyPlaybook(
  db: TransactionalDb,
  registry: FrameTypeRegistry,
  input: { zoneId: string; key: unknown },
  playbooks: readonly Playbook[] = PLAYBOOKS,
): Promise<StoredAppliedPlaybook> {
  // Zone first (404), then the body (400).
  if ((await zoneProjectId(db, input.zoneId)) === null) throw new ZoneNotFoundError(input.zoneId);
  if (typeof input.key !== 'string' || !input.key) throw new PlaybookKeyRequiredError();
  const playbook = playbooks.find((p) => p.key === input.key);
  if (!playbook) throw new UnknownPlaybookError(input.key);

  // A deadlock or serialization failure rolls everything back; the apply runs once more, then gives up with 409.
  for (let attempt = 1; ; attempt++) {
    try {
      return await applyOnce(db, registry, input.zoneId, playbook);
    } catch (err) {
      if (!RETRYABLE.has((err as { code?: string }).code ?? '')) throw err;
      if (attempt >= 2) throw new PlaybookConcurrentChangeError();
    }
  }
}

function applyOnce(
  db: TransactionalDb,
  registry: FrameTypeRegistry,
  zoneId: string,
  playbook: Playbook,
): Promise<StoredAppliedPlaybook> {
  const input = { zoneId };
  return inTransaction(db, async (tx) => {
    // Locks the zone, so two applies to one zone run one after the other. NO KEY UPDATE leaves
    // the key-share locks of foreign key checks free, so a frame created meanwhile does not wait on it.
    const locked = await tx.query<StoredZone>(`SELECT ${ZONE_COLUMNS} FROM zones WHERE id = $1 FOR NO KEY UPDATE`, [
      input.zoneId,
    ]);
    const zone = locked.rows[0];
    if (!zone) throw new ZoneNotFoundError(input.zoneId);
    if (zone.playbookKey === playbook.key) return { applied: false, zone };
    if (zone.playbookKey !== null) throw new PlaybookAlreadyAppliedError(zone.playbookKey);
    if (zone.frame !== null) throw new DisplayExistsError(input.zoneId);

    await setDisplay(tx, registry, { zoneId: input.zoneId, type: playbook.frame.type, settings: playbook.frame.settings });
    const updated = await tx.query<StoredZone>(`UPDATE zones SET playbook_key = $2 WHERE id = $1 RETURNING ${ZONE_COLUMNS}`, [
      input.zoneId,
      playbook.key,
    ]);
    return { applied: true, zone: updated.rows[0] };
  });
}
