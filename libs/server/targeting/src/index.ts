// Public interface of the targeting module (AD-1). It owns the `tags`,
// `tale_group_tags` and `tale_group_tag_matches` tables, and reaches tale groups only through
// @taleart/server-tales. Later targeting stories add audiences here.
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
export { InvalidTagNameError, TagExistsError, TagNotFoundError, TagProjectNotFoundError } from './lib/errors';
