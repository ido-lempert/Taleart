// One element of a tale the Delivery API delivers in a zone now (epic interactive components R9):
// what the `interactive` module checks a visitor's response against. Built from the same Delivery
// filter as the zone response (`deliveredPlacement`, `deliveredTale`; AD-6), and from the published
// document as delivered (hidden elements removed; AD-15), so a response is kept only for what the
// visitor could see.
import type { Db } from '@taleart/server-access';
import { deliveredPlacement, deliveredTale } from './delivery-rule';
import { deliverableTaleDocument } from './tale-document';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An element of a delivered tale, with the keys a response row records (AD-10). */
export interface DeliveredTaleElement {
  projectId: string;
  zoneId: string;
  taleGroupId: string;
  taleId: string;
  element: { id: string; type: string; props: Readonly<Record<string, unknown>> };
}

/**
 * The element `elementId` of the tale `taleId` as the Delivery API delivers it in the zone `zoneId`
 * at `now`, with the tale's keys; null when the tale is not delivered there (unknown, of another
 * zone or project, hidden, archived, outside its window, not updated yet, its group off or not
 * placed there, the zone without a display or key) or its published document has no visible
 * element with that id. Ids that are not UUIDs never match.
 */
export async function deliveredTaleElement(
  db: Db,
  zoneId: string,
  taleId: string,
  elementId: string,
  now: Date = new Date(),
): Promise<DeliveredTaleElement | null> {
  if (!UUID.test(zoneId) || !UUID.test(taleId) || !UUID.test(elementId)) return null;
  const { rows } = await db.query<{
    id: string;
    taleGroupId: string;
    projectId: string;
    document: unknown;
    revision: number;
    documentBytes: number | null;
  }>(
    `SELECT tales.id, tales.tale_group_id AS "taleGroupId", tales.project_id AS "projectId", tales.document,
       tales.document_revision AS revision, octet_length(tales.document::text) AS "documentBytes"
     FROM zone_tale_groups
     JOIN tale_groups ON tale_groups.id = zone_tale_groups.tale_group_id
     JOIN tales ON tales.tale_group_id = tale_groups.id
     WHERE zone_tale_groups.zone_id = $1 AND tales.id = $2
       AND ${deliveredPlacement('tale_groups', 'zone_tale_groups.zone_id', '$3')}
       AND ${deliveredTale('tales', '$3')}`,
    [zoneId, taleId, now],
  );
  const tale = rows[0];
  if (!tale) return null;
  // Checked once per tale and revision, as the zone response does (the same cache).
  const document = deliverableTaleDocument(tale.document, `${tale.id}:${tale.revision}`, tale.documentBytes ?? undefined);
  const wanted = elementId.toLowerCase();
  const element = document?.elements.find((e) => typeof e.id === 'string' && e.id.toLowerCase() === wanted);
  if (!element) return null;
  return {
    projectId: tale.projectId,
    zoneId: zoneId.toLowerCase(),
    taleGroupId: tale.taleGroupId,
    taleId: tale.id,
    element: {
      id: element.id.toLowerCase(),
      type: element.type,
      props: (element.props ?? {}) as Readonly<Record<string, unknown>>,
    },
  };
}
