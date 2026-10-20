// Public interface of the zones module (AD-1). It owns the `zones` and
// `frames` tables and the frame-type registry, and checks projects only
// through @taleart/server-access.
export { migrateZones } from './lib/migration';
export { listZones, createZone, ProjectNotFoundError } from './lib/zones';
export { listFrames, createFrame, findZone, zoneExists, zoneProjectId, ZoneNotFoundError } from './lib/frames';
export {
  FrameTypeRegistry,
  loadFrameTypeRegistry,
  UnknownFrameTypeError,
  InvalidFrameSettingsError,
  type FrameTypeDefinition,
} from './lib/frame-types';
