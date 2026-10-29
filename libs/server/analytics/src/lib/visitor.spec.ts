import { createHash } from 'node:crypto';
import { visitorHash } from './visitor';

describe('visitorHash', () => {
  const visitor = '0f0e0d0c-0b0a-4908-8706-050403020100';

  it('is the SHA-256 of the project id, a colon and the visitor id, in hex', () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    const expected = createHash('sha256').update(`${projectId}:${visitor}`).digest('hex');
    expect(visitorHash(projectId, visitor)).toBe(expected);
    expect(visitorHash(projectId, visitor)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs between projects, so one visitor does not link two projects', () => {
    expect(visitorHash('00000000-0000-4000-8000-000000000001', visitor)).not.toBe(
      visitorHash('00000000-0000-4000-8000-000000000002', visitor),
    );
  });

  it('never equals the raw visitor id', () => {
    expect(visitorHash('00000000-0000-4000-8000-000000000001', visitor)).not.toContain(visitor);
  });
});
