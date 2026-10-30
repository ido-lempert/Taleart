import type { Theme as ContractTheme, ViewerProperties as ContractViewerProperties, ViewerPropertyValue as ContractViewerPropertyValue } from '@taleart/contract';
import { describe, expectTypeOf, it } from 'vitest';
import type { RingStyle, Theme, ViewerProperties, ViewerPropertyValue } from './public-types';

// Type-level drift test, run by `vitest --typecheck` (see vite.config.mts): the SDK's own copies of the
// public types stay equal to the contract's schema types.
describe('public types', () => {
  it('Theme equals the contract Theme', () => {
    expectTypeOf<Theme>().toEqualTypeOf<ContractTheme>();
  });

  it('ViewerProperties and ViewerPropertyValue equal the contract types', () => {
    expectTypeOf<ViewerProperties>().toEqualTypeOf<ContractViewerProperties>();
    expectTypeOf<ViewerPropertyValue>().toEqualTypeOf<ContractViewerPropertyValue>();
  });

  it('RingStyle equals the contract ring style', () => {
    expectTypeOf<RingStyle>().toEqualTypeOf<ContractTheme['ringStyle']>();
  });
});
