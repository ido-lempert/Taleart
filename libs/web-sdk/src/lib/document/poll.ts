import type { ChoiceResult, DeliveryTaleElement, ResponseResult } from '@taleart/contract';
import type { StoredResponse } from '../responses';
import { defaultTranslate, type Translate } from '../i18n';
import type { RenderContext } from './media';

/**
 * The look of a choice card, a poll's (epic interactive components R2, R10) and a quiz's (R3): a
 * card in the theme's colours, the choices as buttons that fill with their share once the visitor
 * answered. A quiz's right and wrong marks are a glyph and a colour on the button, never colour
 * alone. Only the card takes pointer events, so a tap on it never reaches the viewer's tap zones (C7).
 */
export const POLL_STYLES = `
.ta-poll {
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
.ta-poll-light { background: var(--ta-light); color: var(--ta-light-ink); }
.ta-poll-dark { background: var(--ta-dark); color: var(--ta-dark-ink); }
/* No theme prop: the card follows the colour scheme (THEME_SCHEME_STYLES). */
.ta-poll-auto { background: var(--ta-paper); color: var(--ta-ink); }
.ta-poll-title { margin: 0; font-size: 0.75em; font-weight: 600; opacity: 0.85; }
.ta-poll-q { margin: 0; font-weight: 700; font-size: 1.1em; }
.ta-poll-opt {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5em;
  width: 100%;
  min-height: 2.4em;
  margin: 0;
  padding: 0.4em 0.8em;
  border: 0.25cqh solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: start;
  cursor: pointer;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.ta-poll-opt[aria-disabled='true'] { cursor: default; }
.ta-poll-opt:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
.ta-poll-fill { position: absolute; inset: 0 auto 0 0; width: 0; opacity: 0.22; background: currentColor; transition: width 0.4s ease-out; }
.ta-poll-label, .ta-poll-pct { position: relative; }
.ta-poll-label { flex: 1; }
.ta-poll-mine { border-width: 0.5cqh; }
.ta-poll-mine .ta-poll-fill { opacity: 0.4; }
@media (forced-colors: active) { .ta-poll-opt { border-color: ButtonText; } .ta-poll-fill { background: Highlight; } }
.ta-quiz-mark { position: relative; font-weight: 800; }
.ta-quiz-right { --ta-mark: var(--ta-success-ink); }
.ta-quiz-wrong { --ta-mark: var(--ta-error-ink); }
/* A card drawn light or dark on purpose uses that card's ink, not the scheme's (4.5:1 on each). */
.ta-poll-light:not(.ta-poll-auto) .ta-quiz-right { --ta-mark: var(--ta-success); }
.ta-poll-light:not(.ta-poll-auto) .ta-quiz-wrong { --ta-mark: var(--ta-error); }
.ta-poll-dark .ta-quiz-right { --ta-mark: var(--ta-success-on-dark); }
.ta-poll-dark .ta-quiz-wrong { --ta-mark: var(--ta-error-on-dark); }
.ta-quiz-right, .ta-quiz-wrong { border-width: 0.5cqh; border-color: var(--ta-mark); }
.ta-quiz-right .ta-quiz-mark, .ta-quiz-wrong .ta-quiz-mark { color: var(--ta-mark); }
.ta-quiz-right .ta-poll-fill, .ta-quiz-wrong .ta-poll-fill { opacity: 0.22; }
`;

/**
 * The card's colour class: a light or a dark card when the element says so (its `theme` prop), else
 * one that follows the colour scheme (`ta-poll-auto`, which also keeps `ta-poll-light` for the class's name).
 */
export function cardClass(theme: unknown): string {
  return theme === 'dark' ? 'ta-poll-dark' : theme === 'light' ? 'ta-poll-light' : 'ta-poll-light ta-poll-auto';
}

/** One choice of a choice card: a poll's option or a quiz's answer. */
export interface Choice {
  id: string;
  label: string;
}

/** What a choice card says, in its kind's words. */
export interface ChoiceWords {
  /** The start of the result, such as "You voted Tea." */
  chose(label: string): string;
  /** What a press in the Tale Studio preview says, after the choice. */
  preview: string;
  /** The choice in the preview, when it is worded otherwise than {@link ChoiceWords.chose}. */
  previewChose?(label: string): string;
  /** What a failed post says. */
  failed: string;
}

/** A poll's words, in `t`'s locale. */
export function pollWords(t: Translate): ChoiceWords {
  return {
    chose: (label) => t('poll.voted', { label }),
    preview: t('poll.previewNotRecorded'),
    previewChose: (label) => t('poll.chose', { label }),
    failed: t('poll.failed'),
  };
}

/**
 * The choices in `prop` as the server checked them: `min` to `max` of them, each with its own id and
 * a label that shows; the SDK checks again. Null for anything else.
 */
export function choicesOf(props: unknown, prop: string, min: number, max: number): Choice[] | null {
  const choices = (props as Record<string, unknown> | null)?.[prop];
  if (!Array.isArray(choices) || choices.length < min || choices.length > max) return null;
  const valid = choices.filter(
    (c: Partial<Choice> | null): c is Choice => typeof c?.id === 'string' && typeof c.label === 'string' && c.label.trim() !== '',
  );
  return valid.length === choices.length && new Set(valid.map((c) => c.id)).size === valid.length ? valid : null;
}

/** An element of `tag` and `className` holding `value` as a text node (AD-16). */
export function text(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

/**
 * What the live region says once the result shows: the visitor's choice in the card's words (a
 * poll's by default), then each share.
 */
export function resultMessage(
  choices: readonly Choice[],
  response: StoredResponse,
  words: Pick<ChoiceWords, 'chose'> = pollWords(defaultTranslate),
): string {
  const mine = choices.find((o) => o.id === response.value);
  return saying(mine ? words.chose(mine.label) : '', choices, response.result);
}

// `start`, then each choice's share.
function saying(start: string, choices: readonly Choice[], result: ResponseResult): string {
  const shares = choices.map((o) => `${o.label} ${percentOf(result, o.id)}%`).join(', ');
  return start ? `${start} ${shares}` : shares;
}

// The choice's share; 0 for a result that is no choice result (never a poll's or a quiz's).
function percentOf(result: ResponseResult, id: string): number {
  const percent = (result as Partial<ChoiceResult>).choices?.find((c) => c.id === id)?.percent;
  return typeof percent === 'number' && Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0;
}

/** How a card is drawn: its choices, its words, and how a chosen answer is marked (a quiz's). */
export interface ChoiceCard {
  choices: readonly Choice[];
  words: ChoiceWords;
  /**
   * Marks the buttons once answered (a quiz's right and wrong); the start of what the live region
   * says, in place of {@link ChoiceWords.chose}. None for a poll.
   */
  mark?(value: string, button: (id: string) => HTMLButtonElement | undefined): string | undefined;
}

/**
 * A choice card (epic interactive components R2, R3, R10; AD-16): a group named by its question,
 * holding its title and question as text nodes and one button per choice. Pressing a choice, by
 * pointer or by keyboard, posts it through the context's response client; the card then shows each
 * choice's percentage with the visitor's choice pressed (and a quiz's marks), announces the result
 * in a polite live region, and takes no second answer. An answer this device made before shows at
 * once, as kept (C11). Without a response client (the Tale Studio preview) a press marks the choice
 * and records nothing. Colours come from its theme and widths through CSSOM only.
 */
export function renderChoiceCard(element: DeliveryTaleElement, context: RenderContext, card: ChoiceCard, question: string): HTMLElement {
  const props = element.props as { title?: unknown; theme?: unknown };
  const { choices, words } = card;
  const root = document.createElement('div');
  root.className = `ta-el ta-poll ta-interactive ${cardClass(props.theme)}`;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', question);
  if (typeof props.title === 'string' && props.title.trim()) root.appendChild(text('p', 'ta-poll-title', props.title));
  root.appendChild(text('p', 'ta-poll-q', question));
  const live = text('p', 'ta-sr', '');
  live.setAttribute('aria-live', 'polite');

  const buttons = choices.map((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ta-poll-opt';
    const fill = text('span', 'ta-poll-fill', '');
    fill.setAttribute('aria-hidden', 'true');
    button.append(fill, text('span', 'ta-poll-label', choice.label));
    root.appendChild(button);
    return { choice, button, fill };
  });
  root.appendChild(live);
  // A tap anywhere on the card (its question, its padding) is the card's: it never steps the tale (C7).
  root.addEventListener('click', (e) => e.stopPropagation());
  const buttonOf = (id: string) => buttons.find((b) => b.choice.id === id)?.button;

  const responses = context.responses;
  let answered = false;
  let busy = false;

  // Presses the visitor's choice, marks it (a quiz) and, with a result, shows every choice's share;
  // no further answer. Answers the start of what the live region says.
  // `chose` words the visitor's choice when the card has no marks of its own.
  const show = (value: string, result: ResponseResult | null, chose = words.chose): string => {
    answered = true;
    for (const { choice, button, fill } of buttons) {
      const mine = choice.id === value;
      button.classList.toggle('ta-poll-mine', mine);
      button.setAttribute('aria-pressed', String(mine));
      button.setAttribute('aria-disabled', 'true');
      button.querySelector('.ta-poll-pct')?.remove();
      if (result) {
        const percent = percentOf(result, choice.id);
        button.appendChild(text('span', 'ta-poll-pct', `${percent}%`));
        fill.style.width = `${percent}%`;
      }
    }
    const mine = choices.find((c) => c.id === value);
    return card.mark?.(value, buttonOf) ?? (mine ? chose(mine.label) : '');
  };

  const kept = responses?.client.stored(responses.taleId, element.id) ?? null;
  if (kept) show(kept.value, kept.result);

  for (const { choice, button } of buttons) {
    button.addEventListener('click', (e) => {
      // A press on the card is the card's: it never steps the tale (C7).
      e.stopPropagation();
      if (answered || busy) return;
      if (!responses) {
        const start = show(choice.id, null, words.previewChose);
        live.textContent = start ? `${start} ${words.preview}` : words.preview;
        return;
      }
      busy = true;
      root.setAttribute('aria-busy', 'true');
      responses.client
        .send(responses.taleId, element.id, choice.id)
        .then((response) => {
          live.textContent = saying(show(response.value, response.result), choices, response.result);
        })
        .catch(() => {
          live.textContent = words.failed;
        })
        .finally(() => {
          busy = false;
          root.removeAttribute('aria-busy');
        });
    });
  }
  return root;
}

/**
 * A poll (epic interactive components R2, R10; AD-16): a choice card of its two options, which
 * shows their percentages once voted, with the vote marked. Null for props it cannot draw.
 */
export function renderPoll(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const t = context.t ?? defaultTranslate;
  const props = element.props as { question?: unknown };
  const options = choicesOf(element.props, 'options', 2, 2);
  const question = typeof props.question === 'string' ? props.question.trim() : '';
  if (!options || !question) return null;
  return renderChoiceCard(element, context, { choices: options, words: pollWords(t) }, question);
}
