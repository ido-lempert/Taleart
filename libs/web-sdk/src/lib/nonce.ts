import { getConfig } from './config';

/**
 * Gives a style sheet the SDK adds to the page the page's CSP nonce (`init({ nonce })`), so a policy without
 * 'unsafe-inline' for styles still lets it apply. Without a nonce the element is left as it is.
 */
export function applyNonce(style: HTMLStyleElement): void {
  const nonce = getConfig().nonce;
  if (nonce) style.nonce = nonce;
}
