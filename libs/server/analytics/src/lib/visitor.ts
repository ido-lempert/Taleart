import { createHash } from 'node:crypto';

/**
 * The stored form of a visitor id within a project: SHA-256 of `projectId + ':' + visitorId`, in
 * hex. The same visitor in two projects gets two hashes, so the stored ids do not link projects, and
 * the raw id is never stored (analytics spec, principles).
 */
export function visitorHash(projectId: string, visitorId: string): string {
  return createHash('sha256').update(`${projectId}:${visitorId}`).digest('hex');
}
