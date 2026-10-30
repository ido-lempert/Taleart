// The reading direction (handoff 3.1): the page's own, inherited by the Shadow DOM, or the SDK's override
// (the `dir` attribute on `<taleart-view>`, or `Taleart.init({ dir })`).

import type { DirOption } from './public-types';

export type { DirOption };

/** The values a direction option takes. */
export const DIR_OPTIONS: readonly DirOption[] = ['auto', 'ltr', 'rtl'];

/** The option's value, or undefined for anything else (the caller warns and ignores it). Pure: it never logs. */
export function parseDir(value: unknown): DirOption | undefined {
  return typeof value === 'string' && (DIR_OPTIONS as readonly string[]).includes(value) ? (value as DirOption) : undefined;
}

/**
 * True when `node` lays out right to left. A `dir` attribute on the node or an ancestor decides it
 * (the Shadow DOM's host included); else the computed direction does, as the browser resolves it.
 */
export function isRtl(node: Element): boolean {
  for (let current: Element | null = node; current; ) {
    const dir = current.getAttribute('dir');
    if (dir === 'rtl') return true;
    if (dir === 'ltr') return false;
    if (dir === 'auto') break;
    current = current.parentElement ?? ((current.parentNode as ShadowRoot | null)?.host ?? null);
  }
  return typeof getComputedStyle === 'function' && getComputedStyle(node).direction === 'rtl';
}
