// Public interface of the targeting module (AD-1). It owns the `tags`, `tale_group_tags`,
// `tale_group_tag_matches`, `user_list_secrets`, `user_lists`, `user_list_ids`, `tale_group_user_lists` and
// `tale_group_audience_holds` and `tale_group_audiences` tables, and reaches
// tale groups only through @taleart/server-tales.
export { migrateTargeting } from './lib/migration';
// A tale group's audience rule (epic viewer properties): stored and read here; the Delivery API hands it to each SDK.
export { audienceRulesForTaleGroups, copyTaleGroupAudience, setTaleGroupAudience } from './lib/audience';
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
  InvalidAudienceRuleError,
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
export type { StoredUserList, UserListTarget, UserListUploadOptions } from './lib/user-lists';
export { readUserListCsv } from './lib/user-list-csv';
// The user lists a tale group is targeted to, and the Delivery API's match of a viewer's external
// user ID against them (epic targeting R4): the ID is hashed here and never kept.
export {
  copyTaleGroupUserLists,
  passesUserLists,
  releaseAudienceHold,
  setTaleGroupUserLists,
  taleGroupIdsForUserLists,
  userListAudiences,
  userListsForTaleGroups,
} from './lib/group-user-lists';
export type { UserListAudiences } from './lib/group-user-lists';
export type { NumberedUserListRow, UserListCsvOptions } from './lib/user-list-csv';
