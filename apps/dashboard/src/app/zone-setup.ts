import type { VisibilityReasonCode, Zone } from '@taleart/contract/core';

/** The zone page's tabs (epic UX rework R9), in their order; `groups` is the default. */
export const ZONE_TABS = [
  { id: 'groups', label: 'Tale groups' },
  { id: 'display', label: 'Display' },
  { id: 'install', label: 'Install' },
] as const;

export type ZoneTab = (typeof ZONE_TABS)[number]['id'];

/** The query parameter that holds the selected tab, such as `?tab=display`. */
export const ZONE_TAB_PARAM = 'tab';

/** The tab a `?tab=` value names; the default tab for none or an unknown value. */
export function zoneTab(value: string | null | undefined): ZoneTab {
  return ZONE_TABS.find((tab) => tab.id === value)?.id ?? 'groups';
}

/** One step of the zone's setup checklist: what it asks, whether it is done and which tab does it. */
export interface ZoneSetupStep {
  id: 'display' | 'install' | 'group';
  label: string;
  done: boolean;
  tab: ZoneTab;
}

// Whether the zone's visibility holds none of `codes`; false while its visibility is unknown.
function without(zone: Pick<Zone, 'visibility'>, ...codes: VisibilityReasonCode[]): boolean {
  const reasons = zone.visibility?.reasons;
  return !!reasons && !reasons.some((reason) => codes.includes(reason.code));
}

/**
 * The setup checklist of a zone (epic UX rework R9), from the reasons the zone is not visible
 * (R7), which the Delivery API's rule computes: a display, an installed site key, and a tale group
 * that is On with a shown tale, delivered in this zone. All three done is exactly "visible".
 * `admin` words the install step for someone who can issue the key.
 */
export function zoneSetupSteps(zone: Pick<Zone, 'visibility' | 'frame'>, admin = true): ZoneSetupStep[] {
  return [
    {
      id: 'display',
      label: 'Choose a display',
      done: !!zone.frame,
      tab: 'display',
    },
    {
      id: 'install',
      // Only admins issue zone keys (AD-9); a content manager asks one.
      label: admin ? 'Install (issue a zone key)' : 'Ask an admin to issue a zone key',
      done: without(zone, 'zone-not-installed'),
      tab: 'install',
    },
    {
      id: 'group',
      label: 'Turn a tale group On with a shown tale',
      done: without(zone, 'no-tale-groups', 'no-visible-groups'),
      tab: 'groups',
    },
  ];
}

/**
 * Whether the zone page shows the setup checklist: only until the zone is first visible. Once the
 * API has recorded that (`firstVisibleAt`), it stays gone for every user, also when the zone later
 * stops being visible.
 */
export function showsSetup(zone: Pick<Zone, 'visibility' | 'firstVisibleAt'>): boolean {
  return !zone.firstVisibleAt && !zone.visibility?.visible;
}

/**
 * Whether a host page can read the zone: no "zone not installed" reason (epic UX rework R3, R7);
 * null while its visibility is unknown.
 */
export function zoneInstalled(zone: Pick<Zone, 'visibility'>): boolean | null {
  return zone.visibility ? without(zone, 'zone-not-installed') : null;
}
