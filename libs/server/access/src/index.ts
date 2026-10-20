// Public interface of the access module (AD-1). It owns the `projects` table;
// other modules reach projects only through these exports.
export type { Db } from './lib/db';
export { migrateAccess } from './lib/migration';
export { listProjects, createProject, projectExists } from './lib/projects';
