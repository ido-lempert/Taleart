// Public interface of the importer module (AD-1). It owns the `import_jobs`
// `import_links` and `import_media` tables, reads Storyly through its own
// client (the only place Storyly appears, AD-12), writes zones, tale groups
// and tales only through @taleart/server-zones and @taleart/server-tales, and
// tags only through @taleart/server-targeting, and copies tale media through
// the storage port (AD-8, AD-11). Source ids live only in `import_links` (AD-7).
export { migrateImporter } from './lib/migration';
export { parseTokenKey, encryptToken, decryptToken } from './lib/crypto';
export {
  StorylyClient,
  DEFAULT_STORYLY_API_URL,
  type SourceApp,
  type SourceInstance,
  type SourceLabel,
  type SourceStoryGroup,
  type SourceStory,
} from './lib/storyly-client';
export { StorylyTokenInvalidError, StorylyUnavailableError } from './lib/errors';
export {
  previewApp,
  signSelectionKey,
  verifySelectionKey,
  PREVIEW_MAX_COUNT_REQUESTS,
  PREVIEW_COUNT_DEADLINE_MS,
  PREVIEW_REQUEST_TIMEOUT_MS,
  SELECTION_KEY_TTL_MS,
  type AppPreview,
  type ImportJobSelection,
  type PreviewLimits,
  type PreviewSource,
  type SelectionScope,
} from './lib/preview';
export {
  createImportJob,
  getImportJob,
  listImportJobs,
  recoverStaleJobs,
  progressOf,
  IMPORT_LIST_LIMIT,
  type ClaimedJob,
} from './lib/jobs';
export {
  startImportWorker,
  runImportJob,
  IMPORT_POLL_INTERVAL_MS,
  IMPORT_HEARTBEAT_MS,
  IMPORT_STALE_AFTER_MS,
  IMPORT_MAX_ATTEMPTS,
  type ImportWorker,
  type ImportWorkerOptions,
  type ImportRunOptions,
  type ImportLog,
} from './lib/worker';
export {
  parseAllowedAddresses,
  isPublicAddress,
  MediaFetchError,
  MEDIA_MAX_BYTES_PER_JOB,
  MEDIA_MAX_MS_PER_JOB,
  type MediaFetchPolicy,
} from './lib/media-fetch';
export {
  importTaleMedia,
  sweepImportedMedia,
  isSweepable,
  IMPORTED_MEDIA_PREFIX,
  MEDIA_SWEEP_MIN_AGE_MS,
  type CopiedMedia,
  type TaleMediaImport,
} from './lib/media-copy';
