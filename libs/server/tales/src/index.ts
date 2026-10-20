// Public interface of the tales module (AD-1). It owns the `tale_groups` and
// `tales` tables (including each tale's media key), and reads zones only through @taleart/server-zones.
export { migrateTales } from './lib/migration';
export {
  listTaleGroups,
  createTaleGroup,
  createTale,
  taleGroupExists,
  taleExists,
  getTaleMedia,
  setTaleMedia,
  orderTaleGroups,
  orderTales,
  OrderMismatchError,
  TaleGroupNotFoundError,
  TaleNotFoundError,
  TaleGroupFullError,
  type StoredTaleMedia,
  type TransactionalDb,
} from './lib/tales';
