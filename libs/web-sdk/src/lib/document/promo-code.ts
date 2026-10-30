import { cardClass } from './poll';
import { cleanText, LABEL_TEXT_RULE, type DeliveryTaleElement } from '@taleart/contract';
import { defaultTranslate, type Translate } from '../i18n';
import type { RenderContext } from './media';

/**
 * A promo code's look (components, 2026-10-29), on the poll's card: the code in a chip the visitor can
 * select by hand, its note, and a Copy button. The status line under the button says what happened, and
 * clears after two seconds.
 */
export const PROMO_STYLES = `
.ta-promo { align-items: center; }
.ta-promo-chip {
  display: inline-block;
  max-width: 100%;
  padding: 0.4em 0.9em;
  border: 0.25cqh dashed currentColor;
  border-radius: 0.8em;
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
  min-height: 2.4em;
  padding: 0.3em 1.4em;
  border: 0.25cqh solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ta-promo-copy:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
.ta-promo-status { margin: 0; min-height: 1.2em; font-size: 0.8em; font-weight: 600; }
`;

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
 * every visitor, so it is no secret. Copy shows `promo.copied` for two seconds and reports `componentEvent`
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
  const status = text('p', 'ta-promo-status', '');
  status.setAttribute('aria-live', 'polite');
  card.append(chip);
  if (note) card.appendChild(text('p', 'ta-promo-note', note));
  card.append(copy, status);

  let hide: ReturnType<typeof setTimeout> | null = null;
  const say = (message: string) => {
    status.textContent = message;
    if (hide !== null) clearTimeout(hide);
    hide = setTimeout(() => {
      status.textContent = '';
      hide = null;
    }, 2000);
  };

  copy.addEventListener('click', () => {
    void copyCode(code, chip).then((copied) => {
      say(t(copied ? 'promo.copied' : 'promo.copyFailed'));
      if (copied) context.onComponentEvent?.({ component: 'promo-code', action: 'copied', value: code });
    });
  });
  return card;
}