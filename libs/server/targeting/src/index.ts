// Public interface of the targeting module (AD-1). It owns the `tags` and
// `tale_group_tags` tables, and reaches tale groups only through
// @taleart/server-tales. Later targeting stories add audiences here.
export { migrateTargeting } from './lib/migration';
export { createTag, listTags, setTaleGroupTags, tagsForTaleGroups } from './lib/tags';
export { InvalidTagNameError, TagExistsError, TagNotFoundError } from './lib/errors';
