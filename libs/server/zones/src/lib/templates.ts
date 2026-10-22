import { ErrorCodes, ZONE_TEMPLATES, type ZoneTemplate } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import type { FrameTypeRegistry } from './frame-types';
import { setDisplay } from './frames';
import { createZone, type StoredZone } from './zones';

/** Thrown when `template` is not a key of the template registry. */
export class UnknownTemplateError extends Error {
  readonly code = ErrorCodes.unknownTemplate;

  constructor(readonly key: unknown) {
    super(`template must be one of: ${ZONE_TEMPLATES.map((t) => t.key).join(', ')}`);
    this.name = 'UnknownTemplateError';
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
 * Creates a zone from a template (epic UX rework R5, D7). The template is checked first
 * ({@link UnknownTemplateError}); then, in one transaction, the zone is created with the template's
 * key as its "created from template" note and given the template's display with its preset
 * settings, validated against the frame type (AD-5). A refused display leaves no zone. Blank sets
 * no display. Without a template the zone is created as {@link createZone} does, with no note.
 *
 * Nothing links the zone to the template afterwards: the display is the zone's own.
 */
export async function createZoneFromTemplate(
  db: TransactionalDb,
  registry: FrameTypeRegistry,
  input: { name: string; projectId: string; slug?: unknown; template?: unknown },
  templates: readonly ZoneTemplate[] = ZONE_TEMPLATES,
): Promise<StoredZone> {
  const { template: key, ...zone } = input;
  if (key === undefined) return createZone(db, zone);
  const template = typeof key === 'string' ? templates.find((t) => t.key === key) : undefined;
  if (!template) throw new UnknownTemplateError(key);
  const { frame } = template;
  if (!frame) return createZone(db, { ...zone, createdFromTemplate: template.key });
  return inTransaction(db, async (tx) => {
    const created = await createZone(tx, { ...zone, createdFromTemplate: template.key });
    const display = await setDisplay(tx, registry, { zoneId: created.id, type: frame.type, settings: frame.settings });
    return { ...created, frame: display };
  });
}
