// Public interface of the interactive module (AD-1; epic interactive components). It owns the
// `interactive_responses` table: visitors' responses to the interactive components of tale
// documents (polls first), one per visitor, component and interaction kind. It reaches tales only
// through @taleart/server-tales (which says what a zone delivers) and zones through
// @taleart/server-zones. epic-analytics reads the rows through here.
export { migrateInteractive } from './lib/migration';
export { recordResponse, taleResponseCounts, type NewResponse, type RecordedResponse } from './lib/responses';
export { InvalidResponseValueError, ResponseTargetNotFoundError, VisitorIdRequiredError } from './lib/errors';
