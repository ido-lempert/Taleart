import type { Theme as ContractTheme } from '@taleart/contract';
import { describe, expectTypeOf, it } from 'vitest';
import type { RingStyle, Theme } from './public-types';

// Type-level drift test, run by `vitest --typecheck` (see vite.config.mts): the SDK's own copies of the
// public types stay equal to the contract's schema types.
describe('public types', () => {
  it('Theme equals the contract Theme', () => {
    expectTypeOf<Theme>().toEqualTypeOf<ContractTheme>();
  });

  it('RingStyle equals the contract ring style', () => {
    expectTypeOf<RingStyle>().toEqualTypeOf<ContractTheme['ringStyle']>();
  });
});
