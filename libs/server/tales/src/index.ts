// Public interface of the tales module (AD-1). It owns the `tale_groups`,
// `zone_tale_groups` (zone placements, AD-14), `tales` (including each tale's
// media key and document, AD-15, kept in step with each other, R16), `project_fonts` and `tale_fonts` (R18), and `project_media` and
// `tale_media` (R5) tables,
// and reads zones only through @taleart/server-zones.
// Tale groups carry no tags here: the targeting module owns them and the API composes them in.
import { clearPublicMediaCache } from './lib/document-media';
import { clearPublicFontCache } from './lib/project-fonts';
import * as tales from './lib/tales';

export { migrateTales, migrateShownStatus } from './lib/migration';
export {
  listTaleGroups,
  getTaleGroup,
  createTaleGroup,
  listProjectTaleGroups,
  renameTaleGroup,
  renameTaleGroupWhen,
  renameTaleWhen,
  createTale,
  copyTaleWithDocument,
  duplicateTale,
  taleGroupExists,
  taleExists,
  getTale,
  taleGroupName,
  taleTitle,
  taleGroupProjectId,
  taleProjectId,
  getTaleMedia,
  getTaleGroupCover,
  setTaleGroupCover,
  isMediaKeyInUse,
  withMediaKeyDeletionGuard,
  orderTaleGroups,
  copyZonePlacements,
  orderTales,
  orderTaleGroupsWhen,
  orderTalesWhen,
  listDeliveryTaleGroups,
  findPublishedMedia,
  SHOWN_STATUS_STEP,
  OrderMismatchError,
  InvalidStatusTransitionError,
  InvalidScheduleError,
  TaleGroupNotFoundError,
  TaleGroupNotInProjectError,
  TaleNotFoundError,
  TaleGroupFullError,
  TaleGroupArchivedError,
  type StoredTaleMedia,
  type StoredCover,
  type DeliveryStoredTale,
  type DeliveryStoredTaleGroup,
  type StoredTaleGroup,
  type StoredWindow,
  type StoredZoneTaleGroup,
  type TransactionalDb,
} from './lib/tales';

// A change that can make a project font or a document's media public or private: once it is done
// (or failed), this process forgets its public answers (R18, R5), so the public route sees it at once.
function thenClearFonts<A extends unknown[], R>(change: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await change(...args);
    } finally {
      clearPublicFontCache();
      clearPublicMediaCache();
    }
  };
}

export const copyTaleGroup = thenClearFonts(tales.copyTaleGroup);
export const placeTaleGroup = thenClearFonts(tales.placeTaleGroup);
export const removeTaleGroup = thenClearFonts(tales.removeTaleGroup);
export const setTaleGroupStatus = thenClearFonts(tales.setTaleGroupStatus);
export const setTaleStatus = thenClearFonts(tales.setTaleStatus);
export const setTaleGroupSchedule = thenClearFonts(tales.setTaleGroupSchedule);
export const setTaleSchedule = thenClearFonts(tales.setTaleSchedule);
// A tale's media is an element of its documents (R16), so setting it can make a key public or private.
export const setTaleMedia = thenClearFonts(tales.setTaleMedia);
// These two run inside the importer's transaction: the importer clears the public caches once it
// commits (clearPublicMediaCache), so no answer read before the commit is kept.
export { setTaleMediaIfNone, replaceTaleMediaIf } from './lib/tales';

export {
  bringTaleMediaInStep,
  classifyMigrationError,
  continueTaleMediaMigration,
  markTaleMediaSeen,
  MIN_POOL_FOR_CONTINUATION,
  withoutStaleTaleMedia,
  mergeTaleMedia,
  migrateTaleMediaDocuments,
  setTaleMediaDocumentsEnabled,
  taleMediaDocument,
  taleMediaDocumentsEnabled,
  type InStepOutcome,
  type SkipReason,
  type TaleMediaContinuation,
  type TaleMediaMigration,
  type TaleMediaMigrationOptions,
} from './lib/tale-media-document';

export {
  listProjectFonts,
  createProjectFont,
  getProjectFontFile,
  deleteProjectFont,
  findPublishedFont,
  clearPublicFontCache,
  sweepUnusedFontFiles,
  withoutProjectFonts,
  FontExistsError,
  FontInUseError,
  FontLimitError,
  FontNotFoundError,
  FontStorageFullError,
  PUBLIC_FONT_CACHE_TTL_MS,
  type ListableStorage,
  type NewProjectFont,
  type StoredFontFile,
} from './lib/project-fonts';
export {
  checkProjectMediaRoom,
  clearPublicMediaCache,
  createProjectMedia,
  DEFAULT_PROJECT_MEDIA_LIMITS,
  MediaLimitError,
  MediaStorageFullError,
  sweepUnusedProjectMediaFiles,
  type ProjectMediaLimits,
  findPublishedDocumentMedia,
  listProjectMedia,
  projectMediaFile,
  PUBLIC_MEDIA_CACHE_TTL_MS,
  type NewProjectMedia,
} from './lib/document-media';
export {
  AltTextRequiredError,
  LinkUrlRequiredError,
  checkDocumentFonts,
  checkDocumentMedia,
  checkPublishableDocument,
  checkPublishRules,
  checkTaleDocument,
  clearDeliveryCache,
  deliverableTaleDocument,
  DELIVERY_CACHE_SIZE,
  pointerSegment,
  getTaleDocument,
  saveTaleDocument,
  publishTaleDocument,
  discardTaleDraft,
  InvalidTaleDocumentError,
  StaleRevisionError,
  NothingToPublishError,
  TaleDocumentTooLargeError,
} from './lib/tale-document';
// "Visible on site / Not visible because…" (epic UX rework R7): from the clauses the Delivery
// filter is made of, so the indicator and the site cannot disagree.
export {
  GROUP_OWN_REASON_CLAUSES,
  GROUP_REASON_CLAUSES,
  TALE_REASON_CLAUSES,
  ZONE_REASON_CLAUSES,
  ZONE_SETUP_CLAUSES,
  deliveredGroup,
  deliveredPlacement,
  deliveredTale,
  groupReasonsSql,
  hasPublishedDocument,
  taleReasonsSql,
  zoneDelivers,
  zoneReasonsSql,
  zoneSetUp,
  type ReasonClause,
} from './lib/delivery-rule';
export { groupVisibilities, taleVisibilities, withVisibility, zoneVisibilities } from './lib/visibility';
