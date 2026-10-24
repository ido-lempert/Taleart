import {
  groupShownStatus,
  SHOWN_STATUS_LABELS,
  taleShownStatus,
  type ContentStatus,
  type Tale,
  type TaleGroup,
  type Visibility,
  type Zone,
} from '@taleart/contract/core';
import { record, table } from '../output';

/** On, Off or Archived, as the dashboard's switch reads (`scheduled`/`expired` noted when they apply). */
export function groupStatus(group: { storedStatus: ContentStatus; status: ContentStatus }): string {
  const shown = SHOWN_STATUS_LABELS[groupShownStatus(group.storedStatus)];
  return group.status !== group.storedStatus ? `${shown} (${group.status})` : shown;
}

/** Shown, Hidden or Archived, as Tale Studio's switch reads. */
export function taleStatus(tale: { storedStatus: ContentStatus; status: ContentStatus }): string {
  const shown = SHOWN_STATUS_LABELS[taleShownStatus(tale.storedStatus)];
  return tale.status !== tale.storedStatus ? `${shown} (${tale.status})` : shown;
}

/** `yes`, or `no: <reason codes>`. */
export function visible(visibility: Visibility): string {
  return visibility.visible ? 'yes' : `no: ${visibility.reasons.map((r) => r.code).join(', ')}`;
}

export function zoneText(zone: Zone): string {
  return record([
    ['id', zone.id],
    ['name', zone.name],
    ['slug', zone.slug],
    ['project', zone.projectId],
    ['display', zone.frame?.type ?? null],
    ['settings', zone.frame?.settings ?? null],
    ['visible', visible(zone.visibility)],
  ]);
}

export function talesTable(tales: readonly Tale[]): string {
  return table(
    tales,
    [
      { label: 'position', value: (t) => t.position },
      { label: 'id', value: (t) => t.id },
      { label: 'title', value: (t) => t.title },
      { label: 'status', value: (t) => taleStatus(t) },
      { label: 'media', value: (t) => t.media?.contentType ?? null },
      { label: 'visible', value: (t) => visible(t.visibility) },
    ],
    'No tales.',
  );
}

export function groupText(group: TaleGroup & { position?: number }): string {
  const lines = record([
    ['id', group.id],
    ['name', group.name],
    ['status', groupStatus(group)],
    ['project', group.projectId],
    ['zones', group.zoneIds.join(', ') || null],
    ...(group.position !== undefined ? [['position', group.position] as [string, unknown]] : []),
    ['tags', group.tags.map((t) => t.name).join(', ') || null],
    ['tag match', group.tagMatch],
    ['visible', visible(group.visibility)],
  ]);
  return `${lines}\n\n${talesTable(group.tales)}`;
}

export function taleText(tale: Tale): string {
  return record([
    ['id', tale.id],
    ['title', tale.title],
    ['group', tale.taleGroupId],
    ['position', tale.position],
    ['status', taleStatus(tale)],
    ['media', tale.media ? `${tale.media.kind} ${tale.media.contentType}` : null],
    ['visible', visible(tale.visibility)],
  ]);
}
