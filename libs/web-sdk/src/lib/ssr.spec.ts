// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('importing the SDK where there is no DOM (a server)', () => {
  it('loads without throwing and defines nothing', async () => {
    const sdk = await import('../index');
    expect(typeof sdk.init).toBe('function');
    expect(typeof customElements).toBe('undefined');
  });
});
