// Public interface of the tales module (AD-1). It owns the `tale_groups`,
// `zone_tale_groups` (zone placements, AD-14), `tales` (including each tale's
// media key and document, AD-15), `project_fonts` and `tale_fonts` (R18) tables,
// and reads zones only through @taleart/server-zones.
// Tale groups carry no tags here: the targeting module owns them and the API composes them in.
import { clearPublicFontCache } from './lib/project-fonts';
import * as tales from './lib/tales';

export { migrateTales } from './lib/migration';
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
  taleGroupExists,
  taleExists,
  taleGroupName,
  taleTitle,
  taleGroupProjectId,
  taleProjectId,
  getTaleMedia,
  setTaleMedia,
  setTaleMediaIfNone,
  replaceTaleMediaIf,
  getTaleGroupCover,
  setTaleGroupCover,
  isMediaKeyInUse,
  orderTaleGroups,
  orderTales,
  orderTaleGroupsWhen,
  orderTalesWhen,
  listDeliveryTaleGroups,
  findPublishedMedia,
  OrderMismatchError,
  InvalidStatusTransitionError,
  InvalidScheduleError,
  TaleGroupNotFoundError,
  TaleGroupNotInProjectError,
  TaleNotFoundError,
  TaleGroupFullError,
  type StoredTaleMedia,
  type StoredCover,
  type DeliveryStoredTale,
  type DeliveryStoredTaleGroup,
  type StoredTaleGroup,
  type StoredWindow,
  type StoredZoneTaleGroup,
  type TransactionalDb,
} from './lib/tales';

// A change that can make a project font public or private: once it is done (or failed), this
// process forgets its public font answers (R18), so the public route sees it at once.
function thenClearFonts<A extends unknown[], R>(change: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await change(...args);
    } finally {
      clearPublicFontCache();
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
  checkDocumentFonts,
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
