// Project roles and permissions: the one matrix the API, the dashboard and the docs share. Pure TS.
import type { components } from '../generated/api';
import { projectPermissionValues, projectRoleValues } from '../generated/api';

type Schemas = components['schemas'];

/** A member's role in one project. A global admin is `admin` in every project. */
export type ProjectRole = Schemas['ProjectRole'];
/** One thing a project role may do; the API checks a permission on every project route. */
export type ProjectPermission = Schemas['ProjectPermission'];

/** Every project role, lowest to highest. */
export const PROJECT_ROLES: readonly ProjectRole[] = ['viewer', 'editor', 'publisher', 'admin'] satisfies readonly ProjectRole[];

/** Every project permission. */
export const PROJECT_PERMISSIONS: readonly ProjectPermission[] = projectPermissionValues;

/** The role an invitation gives when none is named (least privilege that still lets someone work). */
export const DEFAULT_INVITATION_ROLE: ProjectRole = 'editor';

/** The role a membership had before roles existed (the closest to its power then). */
export const LEGACY_MEMBER_ROLE: ProjectRole = 'publisher';

/**
 * What each role may do. `viewer` reads and sees analytics; `editor` also changes content and saves
 * drafts; `publisher` also makes content live and manages zones; `admin` also manages keys and members.
 */
export const PROJECT_ROLE_PERMISSIONS: Readonly<Record<ProjectRole, readonly ProjectPermission[]>> = {
  viewer: ['project.view', 'analytics.view'],
  editor: ['project.view', 'analytics.view', 'content.edit'],
  publisher: ['project.view', 'analytics.view', 'content.edit', 'content.publish', 'zones.manage'],
  admin: [
    'project.view',
    'analytics.view',
    'content.edit',
    'content.publish',
    'zones.manage',
    'keys.manage',
    'members.manage',
  ],
};

/** True when the string is a project role. */
export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (projectRoleValues as readonly string[]).includes(value);
}

/** True when the role grants the permission. */
export function roleHasPermission(role: ProjectRole | null | undefined, permission: ProjectPermission): boolean {
  return !!role && PROJECT_ROLE_PERMISSIONS[role].includes(permission);
}

/** The lowest role that grants the permission, for messages and the UI. */
export function lowestRoleWith(permission: ProjectPermission): ProjectRole {
  return PROJECT_ROLES.find((role) => roleHasPermission(role, permission)) ?? 'admin';
}
