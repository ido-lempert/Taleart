// Types of the test page's script (test-page.js), for its tests.
export function apiBaseUrl(scriptUrl: string): string;
export function keyFromHash(hash: string): string;
export function start(
  doc: Document,
  loc: Pick<Location, 'search' | 'hash' | 'pathname'>,
  hist: Pick<History, 'replaceState'>,
  scriptUrl: string,
): void;
