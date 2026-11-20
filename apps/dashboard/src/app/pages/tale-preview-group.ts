import type {
  DeliveryCover,
  DeliveryFont,
  DeliveryTale,
  DeliveryTaleGroup,
  DeliveryZone,
  ProjectFont,
  Zone,
  ZoneTaleGroup,
} from '@taleart/contract/core';
import { projectFontIds } from '@taleart/contract/project-fonts';
import type { TaleDocument } from '@taleart/contract/tale-document';
import { previewDocument } from '@taleart/web-sdk/preview';
import { projectFontFileUrl } from '../project-fonts.service';
import { projectMediaSrc } from '../project-media.service';

// An absolute URL, as the Delivery API sends them and the SDK requires: the dashboard's media, font and cover URLs
// are paths on its own origin.
export function absolute(url: string): string {
  return new URL(url, globalThis.location?.href ?? 'http://localhost/').href;
}

/** What the group preview is drawn from: the studio's data, as it stands. */
export interface GroupPreviewSource {
  projectId: string;
  /** The zone the group is shown in, with its display (its frame). */
  zone: Zone;
  /** The zone's tale groups, as the studio reads them (each with its tales). */
  groups: readonly ZoneTaleGroup[];
  /** The group being edited: the viewer opens on it. */
  groupId: string;
  /** The tale being edited, which the preview draws from `draft` in place of its published document (none: ''). */
  taleId: string;
  /** The unsaved document of the tale being edited; left out when no tale is being edited (a page's preview). */
  draft?: TaleDocument;
  /** Each other tale's published document, by tale id (null: it has none). A tale without one is not delivered. */
  published: ReadonlyMap<string, TaleDocument | null>;
  /** The project's complete theme, as the Delivery API sends it, or null before it loads. */
  theme: unknown;
  /** The project's fonts; each tale gets the ones its document uses. */
  fonts: readonly ProjectFont[];
}

/**
 * The zone the Web SDK renders for the group preview (epic Tale Studio R10, story 7.10): the zone as the Delivery API
 * would send it, with its display and the tale groups it lists, each tale's document as delivered. Visitors see the
 * groups and tales that are visible on the site, so the other groups and tales are left out when they are not, and the
 * group and tale being edited are always in: the edited tale is drawn from its unsaved draft. No targeting applies: the
 * preview shows the zone's whole display. Null when the zone has no display, which shows no group to a visitor.
 */
export function groupPreviewZone(source: GroupPreviewSource): DeliveryZone | null {
  const frame = source.zone.frame;
  if (!frame) return null;
  const mediaUrl = (key: string) => absolute(projectMediaSrc(source.projectId, key));
  const fontsOf = (doc: TaleDocument): DeliveryFont[] => {
    const used = projectFontIds(doc);
    return source.fonts
      .filter((font) => used.includes(font.id))
      .map((font) => ({
        id: font.id,
        family: font.family,
        url: absolute(projectFontFileUrl(source.projectId, font.id)),
        weight: font.weight,
        style: font.style,
      })) as unknown as DeliveryFont[];
  };
  const deliveredTale = (tale: ZoneTaleGroup['tales'][number], doc: TaleDocument): DeliveryTale => ({
    id: tale.id,
    title: tale.title,
    media: tale.media
      ? { kind: tale.media.kind, contentType: tale.media.contentType, url: absolute(tale.media.url) }
      : null,
    document: previewDocument(doc, mediaUrl),
    fonts: fontsOf(doc),
  });
  const taleGroups: DeliveryTaleGroup[] = [];
  for (const group of source.groups) {
    const editing = group.id === source.groupId;
    if (!editing && !group.visibility.visible) continue;
    const tales: DeliveryTale[] = [];
    for (const tale of group.tales) {
      if (source.draft && tale.id === source.taleId) {
        tales.push(deliveredTale(tale, source.draft));
        continue;
      }
      if (!tale.visibility.visible) continue;
      const doc = source.published.get(tale.id);
      if (doc) tales.push(deliveredTale(tale, doc));
    }
    const cover: DeliveryCover | null = group.cover
      ? {
          kind: group.cover.kind,
          contentType: group.cover.contentType,
          animated: group.cover.animated,
          url: absolute(group.cover.url),
        }
      : null;
    taleGroups.push({
      id: group.id,
      name: group.name,
      tags: [],
      tagMatch: 'any',
      audience: null,
      cover,
      tales,
    } as unknown as DeliveryTaleGroup);
  }
  return {
    id: source.zone.id,
    name: source.zone.name,
    slug: source.zone.slug,
    theme: source.theme,
    frame: { id: frame.id, type: frame.type, settings: frame.settings },
    taleGroups,
  } as unknown as DeliveryZone;
}

/**
 * The tales whose published documents the group preview reads: the visible tales of the zone's visible groups, and of
 * the group being edited, other than the tale being edited (its draft is drawn). A tale that is not visible is not
 * delivered, so its document is not read.
 */
export function previewPublishedTaleIds(groups: readonly ZoneTaleGroup[], groupId: string, taleId: string): string[] {
  return groups
    .filter((group) => group.id === groupId || group.visibility.visible)
    .flatMap((group) => group.tales)
    .filter((tale) => tale.id !== taleId && tale.visibility.visible)
    .map((tale) => tale.id);
}
