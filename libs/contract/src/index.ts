// Public surface of the TaleArt contract (AD-3): everything, for the API, the
// server libs and the SDKs. The dashboard imports the narrow entry points
// instead, so its initial bundle does not carry code only its lazy pages use:
// `@taleart/contract/core` (this barrel without the four below),
// `@taleart/contract/theme`, `@taleart/contract/tale-document`,
// `@taleart/contract/text-style` and `@taleart/contract/project-fonts`.
export * from './lib/core';
export * from './lib/theme';
export * from './lib/tale-document';
export * from './lib/text-style';
export * from './lib/project-fonts';
