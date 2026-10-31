import {
  PROJECT_PERMISSIONS,
  PROJECT_ROLE_PERMISSIONS,
  PROJECT_ROLES,
  roleHasPermission,
  type ProjectAuditEntry,
  type ProjectPermission,
  type ProjectRole,
} from '@taleart/contract/core';
import type { MenuItem } from './menu-button';

/** A role's name as people read it. */
export const ROLE_LABELS: Record<ProjectRole, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  publisher: 'Publisher',
  admin: 'Admin',
};

/** "an Editor", "a Publisher": the role with its article, for sentences. */
export function roleWithArticle(role: ProjectRole): string {
  return `${role === 'editor' || role === 'admin' ? 'an' : 'a'} ${ROLE_LABELS[role]}`;
}

/** What a permission lets someone do, as a row of the roles matrix. */
export const CAPABILITY_LABELS: Record<ProjectPermission, string> = {
  'project.view': 'See the project, its zones, tale groups and tales',
  'analytics.view': 'See analytics',
  'content.edit': 'Create and edit tale groups and tales, and save drafts',
  'content.publish': 'Publish: turn content on, set visibility and schedules',
  'zones.manage': 'Create and edit zones and their displays',
  'keys.manage': 'Reveal and rotate zone keys and the site key',
  'members.manage': 'Manage the team: invite people, change roles, remove access',
};

// Short phrases for the one-sentence role description, "can" and "cannot".
const CAN_PHRASES: Partial<Record<ProjectPermission, string>> = {
  'content.edit': 'edit content and save drafts',
  'content.publish': 'publish content',
  'zones.manage': 'manage zones',
  'keys.manage': 'manage keys',
  'members.manage': 'manage the team',
};
const CANNOT_PHRASES: Partial<Record<ProjectPermission, string>> = {
  'content.edit': 'change content',
  'content.publish': 'publish',
  'zones.manage': 'manage zones',
  'keys.manage': 'manage keys',
  'members.manage': 'manage the team',
};

function list(parts: string[], conjunction: 'and' | 'or'): string {
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts[parts.length - 1]}`
    : (parts[0] ?? '');
}

/**
 * What a role can and cannot do in plain words, built from the shared matrix:
 * "Editor: see everything (analytics included), edit content and save drafts. Cannot publish, manage zones, manage keys or manage the team."
 */
export function describeRole(role: ProjectRole): string {
  const granted = PROJECT_ROLE_PERMISSIONS[role];
  const can = [
    ...(granted.includes('project.view') && granted.includes('analytics.view')
      ? ['see everything (analytics included)']
      : granted.includes('project.view')
        ? ['see the project']
        : []),
    ...Object.entries(CAN_PHRASES)
      .filter(([permission]) => granted.includes(permission as ProjectPermission))
      .map(([, phrase]) => phrase as string),
  ];
  const cannot = Object.entries(CANNOT_PHRASES)
    .filter(([permission]) => !granted.includes(permission as ProjectPermission))
    .map(([, phrase]) => phrase as string);
  return `${ROLE_LABELS[role]}: ${list(can, 'and')}.${cannot.length > 0 ? ` Cannot ${list(cannot, 'or')}.` : ''}`;
}

/** The matrix as rows for a table: each permission with whether each role has it, roles lowest first. */
export function roleMatrixRows(): {
  permission: ProjectPermission;
  label: string;
  roles: Record<ProjectRole, boolean>;
}[] {
  return PROJECT_PERMISSIONS.map((permission) => ({
    permission,
    label: CAPABILITY_LABELS[permission],
    roles: Object.fromEntries(PROJECT_ROLES.map((role) => [role, roleHasPermission(role, permission)])) as Record<
      ProjectRole,
      boolean
    >,
  }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date as "12 Dec 2026" (the UTC day, which is how access end dates are stored). */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** A moment in the viewer's own time zone, as "12 Dec 2026, 14:05". */
export function shortDateTime(iso: string): string {
  const date = new Date(iso);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${time}`;
}

/** How long access lasts: "Permanent", "Until 12 Dec 2026" or "Expired". */
export function accessText(expiresAt: string | null, expired: boolean): string {
  if (expired) return expiresAt ? `Expired ${shortDate(expiresAt)}` : 'Expired';
  return expiresAt ? `Until ${shortDate(expiresAt)}` : 'Permanent';
}

function roleOf(value: unknown): string {
  return typeof value === 'string' && value in ROLE_LABELS ? ROLE_LABELS[value as ProjectRole] : 'a role';
}

function accessOf(value: unknown): string {
  return typeof value === 'string' ? `until ${shortDate(value)}` : 'permanent';
}

/**
 * One audit entry as a sentence ("Dana changed Sam from Editor to Publisher"). `nameOf` resolves the
 * target user's id to a name when the member is still listed; the entry's email, else "a former
 * member", stands in otherwise.
 */
export function describeAudit(entry: ProjectAuditEntry, nameOf: (userId: string) => string | undefined): string {
  const actor = entry.actorName || 'Someone';
  const target =
    (entry.targetUserId ? nameOf(entry.targetUserId) : undefined) ?? entry.targetEmail ?? 'a former member';
  const detail = entry.detail ?? {};
  switch (entry.action) {
    case 'invited':
      return `${actor} created an invitation link for ${roleWithArticle((detail['role'] as ProjectRole) ?? 'editor')}`;
    case 'invitation_revoked':
      return `${actor} revoked an invitation link`;
    case 'joined':
      return `${actor} joined as ${roleOf(detail['role'])}`;
    case 'member_added':
      return `${actor} added ${target} as ${roleOf(detail['role'])}`;
    case 'role_changed':
      return `${actor} changed ${target} from ${roleOf(detail['from'])} to ${roleOf(detail['to'])}`;
    case 'expiry_changed':
      return `${actor} changed the access of ${target} from ${accessOf(detail['from'])} to ${accessOf(detail['to'])}`;
    case 'removed':
      return `${actor} removed ${target}`;
    default:
      return `${actor} changed the team`;
  }
}

/** What each ⋯ menu item needs; items not listed (such as "Edit in Tale Studio") need nothing. */
const MENU_PERMISSIONS: Record<string, ProjectPermission> = {
  rename: 'content.edit',
  cover: 'content.edit',
  tags: 'content.edit',
  place: 'content.edit',
  copy: 'content.edit',
  remove: 'content.edit',
  media: 'content.edit',
  duplicate: 'content.edit',
  delete: 'content.edit',
  schedule: 'content.publish',
};

/** The permission a ⋯ menu item needs, or null when it needs none. */
export function menuPermission(id: string): ProjectPermission | null {
  if (id.startsWith('status:')) return 'content.publish';
  return MENU_PERMISSIONS[id] ?? null;
}

/**
 * The items with those the caller's role cannot use disabled and explained (never hidden, so the
 * reason is findable). `can` and `needed` come from the store.
 */
export function gateMenu(
  items: readonly MenuItem[],
  can: (permission: ProjectPermission) => boolean,
  needed: (permission: ProjectPermission) => string,
): MenuItem[] {
  return items.map((item) => {
    const permission = menuPermission(item.id);
    if (!permission || can(permission) || item.disabledReason) return item;
    return { ...item, disabledReason: needed(permission) };
  });
}
