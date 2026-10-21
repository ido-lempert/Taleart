// The playbook registry (epic web zones R8): registry data, like the
// frame-type registry, not a table. A zone records the key of the playbook
// applied to it; applying one creates its frames and a stage per frame.
import type { BannerSettings, BarSettings } from '../index';

/** One frame a playbook creates: its frame type, its settings, and the stage that shows it. */
export type PlaybookFrame = (
  | { type: 'bar'; settings: BarSettings }
  | { type: 'banner'; settings: BannerSettings }
) & {
  /** The stage created for the frame; its key must be free in the zone. */
  stage: { key: string; name: string };
};

/** A preset set of frames, with their settings and a stage per frame, for a goal. Sets no theme (R9). */
export interface Playbook {
  /** Registry key, recorded on the zone as `playbookKey`. */
  key: string;
  /** Name shown to dashboard users. */
  label: string;
  /** What the playbook is for, shown to dashboard users. */
  goal: string;
  /** The frames it creates, in order. */
  frames: readonly PlaybookFrame[];
}

/** The playbooks the MVP ships (epic web zones R8, user decision 2026-10-20). */
export const PLAYBOOKS: readonly Playbook[] = [
  {
    key: 'home-stories-bar',
    label: 'Home page stories bar',
    goal: 'Show the zone’s tale groups as a row of circles at the top of a home page.',
    frames: [
      {
        type: 'bar',
        settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
        stage: { key: 'home-stories-bar', name: 'Home page stories bar' },
      },
    ],
  },
  {
    key: 'promo-banner',
    label: 'Promo banner',
    goal: 'Promote the zone’s tale groups in a wide banner that rotates on its own.',
    frames: [
      {
        type: 'banner',
        settings: { aspectRatio: '3:1', autoplay: true, intervalSeconds: 5, showDots: true, loop: true },
        stage: { key: 'promo-banner', name: 'Promo banner' },
      },
    ],
  },
];

/** The playbook with this key, or undefined. */
export function findPlaybook(key: unknown): Playbook | undefined {
  return typeof key === 'string' ? PLAYBOOKS.find((p) => p.key === key) : undefined;
}
