import {
  EMOJI_FONT_STACK,
  isReactionResult,
  MAX_EMOJI_LENGTH,
  reactionEmojis,
  type DeliveryTaleElement,
  type ResponseResult,
} from '@taleart/contract';
import { defaultTranslate, type Translate } from '../i18n';
import type { RenderContext } from './media';
import { text } from './poll';

/**
 * A Reaction's look (components, 2026-10-29), on the poll's card: a question over a row of emoji
 * buttons. Each button shows its emoji; once the visitor tapped one, every button shows its count.
 * The pressed emoji is marked by `aria-pressed` and by a border, never by colour alone.
 */
export const REACTION_STYLES = `
.ta-reaction {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.2cqh;
  padding: 1.6cqh;
  border-radius: 1.8cqh;
  pointer-events: auto;
  overflow: hidden;
  font-size: 2.4cqh;
  line-height: 1.25;
  text-align: start;
  overflow-wrap: anywhere;
}
.ta-reaction-light { background: var(--ta-light); color: var(--ta-light-ink); }
.ta-reaction-dark { background: var(--ta-dark); color: var(--ta-dark-ink); }
.ta-reaction-auto { background: var(--ta-paper); color: var(--ta-ink); }
.ta-reaction-title { margin: 0; font-size: 0.75em; font-weight: 600; opacity: 0.85; }
.ta-reaction-q { margin: 0; font-weight: 700; font-size: 1.1em; unicode-bidi: plaintext; }
.ta-reaction-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 1cqh; }
.ta-reaction-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  min-width: 3.4em;
  margin: 0;
  padding: 0.3em 0.5em;
  border: 0.25cqh solid currentColor;
  border-radius: 1em;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ta-reaction-btn[aria-disabled='true'] { cursor: default; }
.ta-reaction-btn[aria-pressed='true'] { border-width: 0.5cqh; background: color-mix(in srgb, currentColor 30%, transparent); }
.ta-reaction-btn:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
.ta-reaction-emoji { font-size: 2em; line-height: 1.2; }
.ta-reaction-count { min-height: 1.2em; font-size: 0.8em; font-weight: 700; font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
@media (forced-colors: active) { .ta-reaction-btn { border-color: ButtonText; } .ta-reaction-btn[aria-pressed='true'] { background: Highlight; } }
`;

/**
 * The emoji of a Reaction as the server checked them: two to six, each a non-empty emoji of the length
 * the server allows, all different. The SDK checks again and draws nothing else; null for anything else.
 */
export function reactionsOf(props: unknown): string[] | null {
  const raw = (props as { emojis?: unknown } | null)?.emojis;
  const emojis = reactionEmojis(props);
  if (!Array.isArray(raw) || emojis.length !== raw.length) return null;
  const valid =
    emojis.length >= 2 &&
    emojis.length <= 6 &&
    emojis.every((emoji) => emoji.length > 0 && emoji.length <= MAX_EMOJI_LENGTH) &&
    new Set(emojis).size === emojis.length;
  return valid ? emojis : null;
}

// The count of one emoji in a Reaction's result; 0 for a result that is no Reaction's.
function countOf(result: ResponseResult, emoji: string): number {
  if (!isReactionResult(result)) return 0;
  const count = result.reactions.find((r) => r.emoji === emoji)?.count;
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

/**
 * A Reaction (components, 2026-10-29; AD-16): a question and a row of buttons, one per emoji. Tapping
 * one posts it through the context's response client; the row then shows each emoji's count with the
 * tapped one pressed, announces the counts in a polite live region, and takes no second tap. A tap this
 * device made before shows at once, as kept (C11). Without a response client (the Tale Studio preview) a
 * tap marks the emoji and records nothing. Null for props it cannot draw.
 */
export function renderReaction(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const t: Translate = context.t ?? defaultTranslate;
  const props = element.props as { title?: unknown; question?: unknown; theme?: unknown };
  const emojis = reactionsOf(element.props);
  const question = typeof props.question === 'string' ? props.question.trim() : '';
  if (!emojis || !question) return null;

  const root = document.createElement('div');
  root.className = `ta-el ta-reaction ta-interactive ${props.theme === 'dark' ? 'ta-reaction-dark' : props.theme === 'light' ? 'ta-reaction-light' : 'ta-reaction-light ta-reaction-auto'}`;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', question);
  if (typeof props.title === 'string' && props.title.trim()) root.appendChild(text('p', 'ta-reaction-title', props.title));
  root.appendChild(text('p', 'ta-reaction-q', question));

  const row = document.createElement('div');
  row.className = 'ta-reaction-row';
  const buttons = emojis.map((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ta-reaction-btn';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', emoji);
    const glyph = text('span', 'ta-reaction-emoji', emoji);
    glyph.style.fontFamily = EMOJI_FONT_STACK;
    glyph.setAttribute('aria-hidden', 'true');
    const count = text('span', 'ta-reaction-count', '');
    count.setAttribute('aria-hidden', 'true');
    // A count is a number: it reads left to right in a right-to-left text too.
    count.dir = 'ltr';
    button.append(glyph, count);
    row.appendChild(button);
    return { emoji, button, count };
  });
  root.appendChild(row);
  const live = text('p', 'ta-sr', '');
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);
  // A tap anywhere on the card is the card's: it never steps the tale (C7).
  root.addEventListener('click', (e) => e.stopPropagation());

  const responses = context.responses;
  let answered = false;
  let busy = false;

  // Marks the tapped emoji, and with a result shows each emoji's count; no further tap.
  const show = (value: string, result: ResponseResult | null): void => {
    answered = true;
    for (const { emoji, button, count } of buttons) {
      const n = result ? countOf(result, emoji) : 0;
      button.setAttribute('aria-pressed', String(emoji === value));
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-label', result ? `${emoji}, ${t('reaction.count', { count: n })}` : emoji);
      count.textContent = result ? String(n) : '';
    }
  };
  // What the live region says: each emoji with its count.
  const saying = (result: ResponseResult): string =>
    buttons.map(({ emoji }) => `${emoji} ${t('reaction.count', { count: countOf(result, emoji) })}`).join(', ');

  const kept = responses?.client.stored(responses.taleId, element.id) ?? null;
  if (kept) show(kept.value, kept.result);

  for (const { emoji, button } of buttons) {
    button.addEventListener('click', (e) => {
      // A tap on the row is the Reaction's: it never steps the tale (C7).
      e.stopPropagation();
      if (answered || busy) return;
      if (!responses) {
        show(emoji, null);
        return;
      }
      busy = true;
      root.setAttribute('aria-busy', 'true');
      responses.client
        .send(responses.taleId, element.id, emoji)
        .then((response) => {
          show(response.value, response.result);
          live.textContent = saying(response.result);
        })
        .catch(() => {
          live.textContent = t('reaction.failed');
        })
        .finally(() => {
          busy = false;
          root.removeAttribute('aria-busy');
        });
    });
  }
  return root;
}
