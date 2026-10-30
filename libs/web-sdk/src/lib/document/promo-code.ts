import { cardClass } from './poll';
import { cleanText, LABEL_TEXT_RULE, type DeliveryTaleElement } from '@taleart/contract';
import { defaultTranslate, type Translate } from '../i18n';
import type { RenderContext } from './media';

/**
 * A promo code's look (components, 2026-10-29), on the poll's card: the code on a ticket, the code in its chip
 * (the visitor can select it by hand) on one side and a Copy stub on the other, with notches cut at the tear
 * line. A short shine crosses the ticket; the status is a toast at the top inline-end corner, shown for four
 * seconds. Every colour is a theme token, and the code reads left to right in any direction.
 */
export const PROMO_STYLES = `
@keyframes ta-shine { 0%, 60% { inset-inline-start: -60%; } 100% { inset-inline-start: 130%; } }
@keyframes ta-toast-in { from { opacity: 0; translate: 0 -0.6em; scale: 0.9; } to { opacity: 1; translate: 0 0; scale: 1; } }
.ta-promo { align-items: center; position: relative; }
.ta-promo-ticket {
  --ta-cut-x: calc(100% - 6em);
  position: relative;
  display: flex;
  align-items: stretch;
  inline-size: 100%;
  max-inline-size: 100%;
  border-radius: 0.8em;
  background: color-mix(in srgb, currentColor 10%, transparent);
  overflow: hidden;
  -webkit-mask: radial-gradient(circle 0.7em at var(--ta-cut-x) 0, #0000 98%, #000) , radial-gradient(circle 0.7em at var(--ta-cut-x) 100%, #0000 98%, #000);
  mask: radial-gradient(circle 0.7em at var(--ta-cut-x) 0, #0000 98%, #000), radial-gradient(circle 0.7em at var(--ta-cut-x) 100%, #0000 98%, #000);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
}
.ta-promo-ticket:dir(rtl) { --ta-cut-x: 6em; }
.ta-promo-ticket::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: -60%;
  inline-size: 40%;
  background: linear-gradient(100deg, transparent, color-mix(in srgb, var(--ta-paper) 45%, transparent), transparent);
  animation: ta-shine 2.8s ease-in-out infinite;
  pointer-events: none;
}
.ta-promo-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 44px;
  padding: 0.4em 0.9em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 1.3em;
  font-weight: 700;
  direction: ltr;
  unicode-bidi: isolate;
  overflow-wrap: anywhere;
  user-select: all;
  -webkit-user-select: all;
}
.ta-promo-note { margin: 0; font-size: 0.8em; opacity: 0.8; }
.ta-promo-copy {
  flex: 0 0 6em;
  min-block-size: 44px;
  padding: 0.3em 0.6em;
  margin: 0;
  border: 0;
  border-inline-start: 0.2cqh dashed color-mix(in srgb, currentColor 45%, transparent);
  border-radius: 0;
  background: color-mix(in srgb, currentColor 14%, transparent);
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ta-promo-copy:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
.ta-promo-status {
  position: absolute;
  inset-block-start: 0.6cqh;
  inset-inline-end: 0.6cqh;
  margin: 0;
  padding: 0.35em 0.9em;
  border-radius: 999px;
  background: var(--ta-ink);
  color: var(--ta-paper);
  font-size: 0.8em;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
}
.ta-promo-status:empty { display: none; }
.ta-promo-status:not(:empty) { animation: ta-toast-in 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
`;

// How long the toast stays: four seconds.
export const PROMO_TOAST_MS = 4000;

// A code as the server checks it: 1 to 32 letters, digits, underscores or hyphens.
const CODE = /^[A-Za-z0-9_-]{1,32}$/;

function text(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

// Selects the chip's text, so the visitor can copy it by hand when the clipboard refuses.
function selectText(node: HTMLElement): void {
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Copies the code: the clipboard API first, then the selected chip with the browser's copy command, for a
 * page or browser that refuses the clipboard. Resolves true when the code reached the clipboard.
 */
export async function copyCode(code: string, chip: HTMLElement): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(code);
      return true;
    }
  } catch {
    // Refused (no permission, no focus): the selection below is the fallback.
  }
  try {
    selectText(chip);
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  }
}

/**
 * A promo code (components, 2026-10-29): a chip with the code and a Copy button. The code is visible to
 * every visitor, so it is no secret. Copy shows `promo.copied` in a toast for four seconds and reports `componentEvent`
 * `copied` with the code; when the clipboard and the selection both refuse, it shows `promo.copyFailed`.
 * The card is interactive (the viewer leaves its button to the visitor). Null for a code it cannot show.
 */
export function renderPromoCode(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const t: Translate = context.t ?? defaultTranslate;
  const props = element.props as { title?: unknown; code?: unknown; note?: unknown; theme?: unknown };
  const code = typeof props.code === 'string' ? props.code : '';
  if (!CODE.test(code)) return null;
  const title = typeof props.title === 'string' ? cleanText(props.title, LABEL_TEXT_RULE).trim() : '';
  const note = typeof props.note === 'string' ? cleanText(props.note, LABEL_TEXT_RULE).trim() : '';

  const card = document.createElement('div');
  card.className = `ta-el ta-poll ta-interactive ta-promo ${cardClass(props.theme)}`;
  card.setAttribute('role', 'group');
  if (title) {
    card.setAttribute('aria-label', title);
    card.appendChild(text('p', 'ta-poll-title', title));
  }
  const chip = text('span', 'ta-promo-chip', code);
  // A code reads left to right, whatever the text around it (handoff 3.5).
  chip.dir = 'ltr';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'ta-promo-copy';
  copy.textContent = t('promo.copy');
  const ticket = document.createElement('div');
  ticket.className = 'ta-promo-ticket';
  ticket.append(chip, copy);
  // The toast: the status a copy sets, announced politely, and shown four seconds.
  const status = text('p', 'ta-promo-status', '');
  status.setAttribute('aria-live', 'polite');
  card.append(ticket);
  if (note) card.appendChild(text('p', 'ta-promo-note', note));
  card.append(status);

  let hide: ReturnType<typeof setTimeout> | null = null;
  const say = (message: string) => {
    status.textContent = message;
    if (hide !== null) clearTimeout(hide);
    hide = setTimeout(() => {
      status.textContent = '';
      hide = null;
    }, PROMO_TOAST_MS);
  };

  copy.addEventListener('click', () => {
    void copyCode(code, chip).then((copied) => {
      say(t(copied ? 'promo.copied' : 'promo.copyFailed'));
      if (copied) context.onComponentEvent?.({ component: 'promo-code', action: 'copied', value: code });
    });
  });
  return card;
}