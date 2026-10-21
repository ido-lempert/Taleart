// Public interface of the zones module (AD-1). It owns the `zones`, `frames`
// and `stages` tables and the frame-type registry, and checks projects only
// through @taleart/server-access.
export { migrateZones } from './lib/migration';
export { listZones, createZone, ProjectNotFoundError } from './lib/zones';
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
  FrameTypeRegistry,
  loadFrameTypeRegistry,
  UnknownFrameTypeError,
  InvalidFrameSettingsError,
  type FrameTypeDefinition,
} from './lib/frame-types';
