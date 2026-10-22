// The template registry (epic UX rework R5, owner decision D7): registry data, like the
// frame-type registry, not a table. A template is picked when a zone is created: it sets the
// zone's display and its settings once, and its key is kept on the zone only as a
// "created from template" note (`Zone.createdFromTemplate`). Nothing links them afterwards.
import { createZoneRequestTemplateValues } from '../generated/api';
import type { BannerSettings, BarSettings } from './core';

/** The display a template gives a new zone: its frame type and its settings. */
export type TemplateFrame = { type: 'bar'; settings: BarSettings } | { type: 'banner'; settings: BannerSettings };

/** A template key, as `POST /zones` takes it in `template`. */
export type ZoneTemplateKey = (typeof createZoneRequestTemplateValues)[number];

/** A preset for a new zone: a display with its settings, or none (Blank). Sets no theme. */
export interface ZoneTemplate {
  /** Registry key, sent as `template` and recorded on the zone as `createdFromTemplate`. */
  key: ZoneTemplateKey;
  /** Name shown to dashboard users. */
  label: string;
  /** What the template is for, in one short sentence shown to dashboard users. */
  description: string;
  /** The display it gives the zone, or null for none. */
  frame: TemplateFrame | null;
}

/** The templates the dashboard offers in the New zone drawer, in that order. */
export const ZONE_TEMPLATES: readonly ZoneTemplate[] = [
  {
    key: 'stories-bar',
    label: 'Stories bar',
    description: 'A row of circles, one per tale group, at the top of a page.',
    frame: {
      type: 'bar',
      settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
    },
  },
  {
    key: 'promo-banner',
    label: 'Promo banner',
    description: 'A wide banner that rotates through the tale groups on its own.',
    frame: {
      type: 'banner',
      settings: { aspectRatio: '3:1', autoplay: true, intervalSeconds: 5, showDots: true, loop: true },
    },
  },
  {
    key: 'blank',
    label: 'Blank',
    description: 'No display yet: choose a bar or a banner on the zone page.',
    frame: null,
  },
];

/** The template with this exact key, or undefined. */
export function findTemplate(key: unknown): ZoneTemplate | undefined {
  return typeof key === 'string' ? ZONE_TEMPLATES.find((t) => t.key === key) : undefined;
}
