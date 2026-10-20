// Public interface of the tales module (AD-1). It owns the `tale_groups` and
// `tales` tables, and reads zones only through @taleart/server-zones.
export { migrateTales } from './lib/migration';
export {
  listTaleGroups,
  createTaleGroup,
  createTale,
  taleGroupExists,
  TaleGroupNotFoundError,
  TaleGroupFullError,
  type TransactionalDb,
} from './lib/tales';
