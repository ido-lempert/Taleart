// Public interface of the zones module (AD-1). It owns the `zones` (with each
// zone's slug and applied playbook key), `frames` (a zone's one display, AD-17)
// and `project_themes` tables and the frame-type registry, and checks projects
// only through @taleart/server-access.
export { migrateZones } from './lib/migration';
export { foldStagesIntoZones, type FoldOptions, type FoldReport } from './lib/fold';
export {
  listZones,
  createZone,
  updateZone,
  renameZoneWhen,
  ProjectNotFoundError,
  InvalidZoneError,
  SlugTakenError,
  type StoredZone,
  type StoredAppliedPlaybook,
} from './lib/zones';
export {
  setDisplay,
  updateDisplay,
  findZone,
  zoneExists,
  zoneProjectId,
  zoneHasDisplaySql,
  ZoneNotFoundError,
  DisplayNotFoundError,
  DisplayExistsError,
  EmptyDisplayChangeError,
} from './lib/frames';
export {
  applyPlaybook,
  PlaybookKeyRequiredError,
  UnknownPlaybookError,
  PlaybookAlreadyAppliedError,
  PlaybookConcurrentChangeError,
} from './lib/playbooks';
export {
  FrameTypeRegistry,
  loadFrameTypeRegistry,
  UnknownFrameTypeError,
  InvalidFrameSettingsError,
  type FrameTypeDefinition,
} from './lib/frame-types';
export { getProjectTheme, setProjectTheme, InvalidThemeError } from './lib/theme';
