// The playbook registry (epic web zones R8): registry data, like the
// frame-type registry, not a table. A zone records the key of the playbook
// applied to it; applying one gives the zone its display (AD-17). Story 8.8
// turns playbooks into templates picked when a zone is created.
import type { BannerSettings, BarSettings } from './core';

/** The display a playbook gives a zone: its frame type and its settings. */
export type PlaybookFrame = { type: 'bar'; settings: BarSettings } | { type: 'banner'; settings: BannerSettings };

/** A preset display, with its settings, for a goal. Sets no theme (R9). */
export interface Playbook {
  /** Registry key, recorded on the zone as `playbookKey`. */
  key: string;
  /** Name shown to dashboard users. */
  label: string;
  /** What the playbook is for, shown to dashboard users. */
  goal: string;
  /** The display it gives the zone. */
  frame: PlaybookFrame;
}

/** The playbooks the MVP ships (epic web zones R8, user decision 2026-10-20). */
export const PLAYBOOKS: readonly Playbook[] = [
  {
    key: 'home-stories-bar',
    label: 'Home page stories bar',
    goal: 'Show the zone’s tale groups as a row of circles at the top of a home page.',
    frame: {
      type: 'bar',
      settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
    },
  },
  {
    key: 'promo-banner',
    label: 'Promo banner',
    goal: 'Promote the zone’s tale groups in a wide banner that rotates on its own.',
    frame: {
      type: 'banner',
      settings: { aspectRatio: '3:1', autoplay: true, intervalSeconds: 5, showDots: true, loop: true },
    },
  },
];

/** The playbook with this key, or undefined. */
export function findPlaybook(key: unknown): Playbook | undefined {
  return typeof key === 'string' ? PLAYBOOKS.find((p) => p.key === key) : undefined;
}
