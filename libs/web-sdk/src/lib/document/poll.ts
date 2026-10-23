import type { ChoiceResult, DeliveryTaleElement } from '@taleart/contract';
import type { StoredResponse } from '../responses';
import type { RenderContext } from './media';

/**
 * A poll's look (epic interactive components R2, R10): a card in the theme's colours, the options
 * as buttons that fill with their share once the visitor voted. Only the card takes pointer events,
 * so a tap on it never reaches the viewer's tap zones (C7).
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
.ta-poll-light { background: #ffffff; color: #111827; }
.ta-poll-dark { background: #111827; color: #ffffff; }
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
.ta-poll-opt:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px #000; }
.ta-poll-fill { position: absolute; inset: 0 auto 0 0; width: 0; opacity: 0.22; background: currentColor; transition: width 0.4s ease-out; }
.ta-poll-label, .ta-poll-pct { position: relative; }
.ta-poll-label { flex: 1; }
.ta-poll-mine { border-width: 0.5cqh; }
.ta-poll-mine .ta-poll-fill { opacity: 0.4; }
@media (forced-colors: active) { .ta-poll-opt { border-color: ButtonText; } .ta-poll-fill { background: Highlight; } }
`;

interface PollOption {
  id: string;
  label: string;
}

// The poll's options as the server checked them: two, each with an id and a label; the SDK checks again.
function pollOptions(props: unknown): PollOption[] | null {
  const options = (props as { options?: unknown } | null)?.options;
  if (!Array.isArray(options) || options.length < 2) return null;
  const valid = options.filter(
    (o: Partial<PollOption> | null): o is PollOption =>
      typeof o?.id === 'string' && typeof o.label === 'string' && o.label.trim() !== '',
  );
  return valid.length === options.length ? valid : null;
}

function text(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

/** What the live region says once the result shows: the visitor's choice, then each share. */
export function resultMessage(options: readonly PollOption[], response: StoredResponse): string {
  const mine = options.find((o) => o.id === response.value);
  const shares = options.map((o) => `${o.label} ${percentOf(response.result, o.id)}%`).join(', ');
  return `${mine ? `You voted ${mine.label}. ` : ''}${shares}`;
}

function percentOf(result: ChoiceResult, id: string): number {
  const percent = result.choices.find((c) => c.id === id)?.percent;
  return typeof percent === 'number' && Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0;
}

/**
 * A poll (epic interactive components R2, R10; AD-16): a group named by its question, holding its
 * title and question as text nodes and one button per option. Pressing an option, by pointer or by
 * keyboard, posts the vote through the context's response client; the poll then shows each
 * option's percentage with the visitor's choice marked, announces the result in a polite live
 * region, and takes no second vote. A vote this device made before shows at once, as kept (C11).
 * Without a response client (the Tale Studio preview) a press marks the choice and records nothing.
 * Colours come from its theme and widths through CSSOM only. Null for props it cannot draw.
 */
export function renderPoll(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const props = element.props as { question?: unknown; title?: unknown; theme?: unknown };
  const options = pollOptions(element.props);
  const question = typeof props.question === 'string' ? props.question.trim() : '';
  if (!options || !question) return null;
  const card = document.createElement('div');
  card.className = `ta-el ta-poll ta-interactive ta-poll-${props.theme === 'dark' ? 'dark' : 'light'}`;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', question);
  if (typeof props.title === 'string' && props.title.trim()) card.appendChild(text('p', 'ta-poll-title', props.title));
  card.appendChild(text('p', 'ta-poll-q', question));
  const live = text('p', 'ta-sr', '');
  live.setAttribute('aria-live', 'polite');

  const buttons = options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ta-poll-opt';
    const fill = text('span', 'ta-poll-fill', '');
    fill.setAttribute('aria-hidden', 'true');
    button.append(fill, text('span', 'ta-poll-label', option.label));
    card.appendChild(button);
    return { option, button, fill };
  });
  card.appendChild(live);

  const responses = context.responses;
  let answered = false;
  let busy = false;

  // Marks the visitor's choice and, with a result, every option's share; no further vote.
  const show = (value: string, result: ChoiceResult | null) => {
    answered = true;
    for (const { option, button, fill } of buttons) {
      const mine = option.id === value;
      button.classList.toggle('ta-poll-mine', mine);
      button.setAttribute('aria-pressed', String(mine));
      button.setAttribute('aria-disabled', 'true');
      button.querySelector('.ta-poll-pct')?.remove();
      if (result) {
        const percent = percentOf(result, option.id);
        button.appendChild(text('span', 'ta-poll-pct', `${percent}%`));
        fill.style.width = `${percent}%`;
      }
    }
  };

  const kept = responses?.client.stored(responses.taleId, element.id) ?? null;
  if (kept) show(kept.value, kept.result);

  for (const { option, button } of buttons) {
    button.addEventListener('click', (e) => {
      // A press on the poll is the poll's: it never steps the tale (C7).
      e.stopPropagation();
      if (answered || busy) return;
      if (!responses) {
        show(option.id, null);
        live.textContent = `You chose ${option.label}. Votes are not recorded in the preview.`;
        return;
      }
      busy = true;
      card.setAttribute('aria-busy', 'true');
      responses.client
        .send(responses.taleId, element.id, option.id)
        .then((response) => {
          show(response.value, response.result);
          live.textContent = resultMessage(options, response);
        })
        .catch(() => {
          live.textContent = 'Your vote could not be sent. Try again.';
        })
        .finally(() => {
          busy = false;
          card.removeAttribute('aria-busy');
        });
    });
  }
  return card;
}
