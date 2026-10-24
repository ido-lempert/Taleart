// Public interface of the targeting module (AD-1). It owns the `tags`, `tale_group_tags`,
// `tale_group_tag_matches`, `user_list_secrets`, `user_lists` and `user_list_ids` tables, and reaches
// tale groups only through @taleart/server-tales.
export { migrateTargeting } from './lib/migration';
export {
  addTaleGroupTagsByName,
  addTaleGroupTagsByNameIn,
  copyTaleGroupTags,
  createTag,
  ensureTags,
  listTags,
  setTaleGroupTags,
  tagMatchesForTaleGroups,
  tagRulesForTaleGroups,
  tagsForTaleGroups,
} from './lib/tags';
export type { TaleGroupTagRule } from './lib/tags';
export {
  InvalidTagNameError,
  InvalidUserListNameError,
  TagExistsError,
  TagNotFoundError,
  TagProjectNotFoundError,
  UserListExistsError,
  UserListFileNotUtf8Error,
  UserListFileTooLargeError,
  UserListLimitError,
  UserListNotFoundError,
  UserListProjectNotFoundError,
} from './lib/errors';
// User lists (epic targeting R3, R5): the IDs are stored only as keyed hashes. `createUserList` and
// `addUserListIds` are the interface the importer uses (story 2.12).
export {
  addUserListIds,
  addUserListRows,
  createUserList,
  deleteUserList,
  getUserList,
  listUserLists,
  renameUserList,
  USER_LIST_INSERT_BATCH,
  USER_LIST_UPLOAD_DATABASE_IDLE_TIMEOUT,
} from './lib/user-lists';
export type { UserListTarget, UserListUploadOptions } from './lib/user-lists';
export { readUserListCsv } from './lib/user-list-csv';
export type { NumberedUserListRow, UserListCsvOptions } from './lib/user-list-csv';
