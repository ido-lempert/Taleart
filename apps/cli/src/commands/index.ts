import type { CommandSpec, GroupSpec } from '../command';
import { config, login, logout, whoami } from './account';
import { groups } from './groups';
import { imports } from './imports';
import { projects } from './projects';
import { siteKeys } from './site-keys';
import { skill } from './skill';
import { tales } from './tales';
import { userLists } from './user-lists';
import { zones } from './zones';

/** The command groups, in the order help lists them. */
export const GROUPS: readonly GroupSpec[] = [projects, zones, siteKeys, groups, tales, userLists, imports, config, skill];

/** Commands with no group. */
export const TOP_COMMANDS: readonly CommandSpec[] = [login, logout, whoami];
