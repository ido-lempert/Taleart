// Public interface of the zones module (AD-1). It owns the `zones` (with each
// zone's applied playbook key), `frames`, `stages` and `project_themes` tables
// and the frame-type registry, and checks projects only through @taleart/server-access.
export { migrateZones } from './lib/migration';
export { listZones, createZone, renameZoneWhen, ProjectNotFoundError } from './lib/zones';
export {
  listFrames,
  createFrame,
  updateFrameSettings,
  findZone,
  zoneExists,
  zoneProjectId,
  ZoneNotFoundError,
  FrameNotFoundError,
} from './lib/frames';
export {
  listStages,
  createStage,
  renameStage,
  deleteStage,
  listDeliveryStages,
  StageNotFoundError,
  StageFrameNotFoundError,
  StageKeyTakenError,
  InvalidStageError,
} from './lib/stages';
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
