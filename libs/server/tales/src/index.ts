// Public interface of the tales module (AD-1). It owns the `tale_groups` and
// `tales` tables (including each tale's media key), and reads zones only through @taleart/server-zones.
// Tale groups carry no tags here: the targeting module owns them and the API composes them in.
export { migrateTales } from './lib/migration';
export {
  listTaleGroups,
  getTaleGroup,
  createTaleGroup,
  createTale,
  taleGroupExists,
  taleExists,
  taleGroupProjectId,
  taleProjectId,
  getTaleMedia,
  setTaleMedia,
  orderTaleGroups,
  orderTales,
  listDeliveryTaleGroups,
  findPublishedMedia,
  OrderMismatchError,
  TaleGroupNotFoundError,
  TaleNotFoundError,
  TaleGroupFullError,
  type StoredTaleMedia,
  type DeliveryStoredTale,
  type DeliveryStoredTaleGroup,
  type StoredTaleGroup,
  type TransactionalDb,
} from './lib/tales';
