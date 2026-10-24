import type { Project, ProjectTaleGroup, UserList, Zone } from '@taleart/contract/core';
import type { ApiClient } from './client';
import { CliError, EXIT } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for an id (a UUID); anything else is a name or a slug. */
export function isId(ref: string): boolean {
  return UUID.test(ref);
}

/**
 * The one item `ref` names: by id, else by exact name (or slug), else by name ignoring case.
 * Nothing is exit 5 (`not_found`); several are exit 6 (`ambiguous`), listing their ids. With `exact`
 * (destructive commands) only an exact id, name or slug counts.
 */
export function pickOne<T extends { id: string }>(
  items: readonly T[],
  ref: string,
  kind: string,
  names: (item: T) => string[],
  exact = false,
): T {
  const byId = items.find((item) => item.id === ref);
  if (byId) return byId;
  let matches = items.filter((item) => names(item).includes(ref));
  if (matches.length === 0 && !exact) matches = items.filter((item) => names(item).some((n) => n.toLowerCase() === ref.toLowerCase()));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new CliError(`No ${kind} named ${ref}`, EXIT.notFound, 'not_found');
  throw new CliError(
    `${matches.length} ${kind}s are named ${ref}: ${matches.map((m) => m.id).join(', ')}`,
    EXIT.conflict,
    'ambiguous',
    undefined,
    'Give the id instead.',
  );
}

/** A project by id (taken as given) or name. */
export async function resolveProjectId(client: ApiClient, ref: string, exact = false): Promise<string> {
  if (isId(ref)) return ref;
  const projects = await client.get<Project[]>('/projects');
  return pickOne(projects, ref, 'project', (p) => [p.name], exact).id;
}

/** A zone by id or slug; a slug within the project when one is chosen, else among every zone the token reaches. */
export async function resolveZone(client: ApiClient, ref: string, projectId: string | null, exact = false): Promise<Zone> {
  const zones = await client.get<Zone[]>('/zones');
  const scoped = isId(ref) || projectId === null ? zones : zones.filter((z) => z.projectId === projectId);
  return pickOne(scoped, ref, 'zone', (z) => (exact ? [z.slug] : [z.slug, z.name]), exact);
}

/** A zone's id: an id as given, else the zone {@link resolveZone} finds. */
export async function resolveZoneId(client: ApiClient, ref: string, projectId: string | null): Promise<string> {
  return isId(ref) ? ref : (await resolveZone(client, ref, projectId)).id;
}

/** A tale group's id: an id as given, else by name in the project (which a name needs). */
export async function resolveGroupId(client: ApiClient, ref: string, projectId: () => Promise<string>): Promise<string> {
  if (isId(ref)) return ref;
  const groups = await client.get<ProjectTaleGroup[]>(`/projects/${await projectId()}/tale-groups`);
  return pickOne(groups, ref, 'tale group', (g) => [g.name]).id;
}

/** A user list of the project, by id or name. */
export async function resolveUserList(client: ApiClient, ref: string, projectId: string, exact = false): Promise<UserList> {
  const lists = await client.get<UserList[]>(`/projects/${projectId}/user-lists`);
  return pickOne(lists, ref, 'user list', (l) => [l.name], exact);
}

/** A path segment, encoded. */
export function seg(value: string): string {
  return encodeURIComponent(value);
}
