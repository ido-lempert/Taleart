// The poll views other than the sticker (the contract's poll `view`): embed, this-or-that, grid and inline. Their
// own chunk: it loads the first time a tale with one of them is drawn (poll.ts), so the page's core keeps the
// sticker alone. Every view draws the same options and answers as the sticker (poll.ts); this module adds only the
// markup and the look of each view.
import type { ChoiceResult } from '@taleart/contract';
import { onAccent } from '../theme';
import { defaultTranslate, type Translate } from '../i18n';
import type { ChoiceCard, ChoiceDom } from './poll';
import { text } from './poll';

/**
 * The look of the four views: the card's layout, the halves split by `--ta-split` (the first half's share of the
 * box), the VS marker placed by its inline start, the tiles, the inline pills and the stacked bar. Option colours
 * come in `--ta-opt` (the fill) and `--ta-opt-ink` (the text, 4.5:1 on it); both fall back to the theme's tokens.
 * Motion: the split, the marker and the fills move with a spring, the pressed option pops; the renderer's
 * reduced-motion rule stops every one of them.
 */
export const POLL_VIEW_STYLES = `
.ta-poll-v-embed { padding: 2.2cqh; gap: 1.2cqh; }
.ta-poll-v-embed .ta-poll-q { font-size: 1.5em; line-height: 1.1; }
.ta-poll-v-embed .ta-poll-opt { min-block-size: max(2.8em, 44px); border-radius: 0.8em; }
.ta-embed-head { margin: 0; font-size: 0.8em; font-weight: 700; opacity: 0.8; }
.ta-poll-total { margin: 0; font-size: 0.8em; opacity: 0.8; font-variant-numeric: tabular-nums; unicode-bidi: isolate; }
.ta-poll-total:empty { display: none; }
.ta-split {
  --ta-split: 50%;
  position: relative;
  display: flex;
  block-size: 24cqh;
  min-block-size: 44px;
  border-radius: 1.8cqh;
  overflow: hidden;
}
.ta-half {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 0.2em;
  margin: 0;
  padding: 1em 0.8em;
  border: 0;
  background: var(--ta-opt);
  color: var(--ta-opt-ink);
  font: inherit;
  font-weight: 700;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  min-inline-size: 0;
  -webkit-tap-highlight-color: transparent;
}
.ta-half[aria-disabled='true'] { cursor: default; }
.ta-half:focus-visible { outline: 3px solid var(--ta-opt-ink); outline-offset: -6px; }
/* The pressed option is marked by an underline, not a ring: a ring would show its corners outside the rounded box. */
.ta-half[aria-pressed='true'] .ta-poll-label { text-decoration: underline; text-decoration-thickness: 0.12em; text-underline-offset: 0.2em; }
.ta-half-a { flex: 0 0 var(--ta-split); transition: flex-basis 1s cubic-bezier(0.16, 1, 0.3, 1); }
.ta-half-b { flex: 1 1 0; }
.ta-half .ta-poll-label { font-size: 1.1em; overflow-wrap: anywhere; }
.ta-half .ta-poll-pct { font-size: 2.4em; font-weight: 800; line-height: 1; }
.ta-vs {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: var(--ta-split);
  margin-inline-start: -1.6em;
  margin-block-start: -1.6em;
  inline-size: 3.2em;
  block-size: 3.2em;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--ta-paper);
  color: var(--ta-ink);
  font-size: 0.9em;
  font-weight: 800;
  box-shadow: 0 0.4em 1em -0.4em color-mix(in srgb, var(--ta-ink) 50%, transparent);
  pointer-events: none;
  transition: inset-inline-start 1s cubic-bezier(0.16, 1, 0.3, 1);
}
.ta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.2cqh; }
.ta-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  min-block-size: 18cqh;
  margin: 0;
  padding: 1.2cqh;
  border: 0;
  border-radius: 1.8cqh;
  background: var(--ta-opt);
  color: var(--ta-opt-ink);
  font: inherit;
  font-weight: 700;
  text-align: start;
  cursor: pointer;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ta-tile[aria-disabled='true'] { cursor: default; }
.ta-tile:not([aria-disabled='true']):hover { transform: translateY(-3px); }
.ta-tile:focus-visible { outline: 3px solid var(--ta-opt-ink); outline-offset: 2px; }
.ta-tile[aria-pressed='true'] { animation: ta-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
.ta-tile[aria-pressed='true'] .ta-poll-label { text-decoration: underline; text-decoration-thickness: 0.12em; text-underline-offset: 0.2em; }
.ta-tile .ta-poll-fill { background: color-mix(in srgb, var(--ta-opt-ink) 22%, transparent); }
.ta-tile .ta-poll-label { flex: 0 0 auto; font-size: 1.05em; }
.ta-tile .ta-poll-pct { font-size: 1.8em; line-height: 1; }
.ta-poll-v-inline { gap: 0.8cqh; }
.ta-inline-row { display: flex; flex-wrap: wrap; gap: 0.6em; }
.ta-inline-row .ta-poll-opt { inline-size: auto; min-block-size: 44px; padding: 0.3em 1em; border-radius: 999px; }
.ta-poll-bar { display: none; flex-direction: column; gap: 0.5em; }
.ta-poll-v-inline[data-voted] .ta-poll-bar { display: flex; }
.ta-poll-v-inline[data-voted] .ta-inline-row { display: none; }
.ta-stackbar { display: flex; block-size: 1.2cqh; min-block-size: 10px; border-radius: 999px; overflow: hidden; gap: 2px; }
.ta-stackbar > i { display: block; block-size: 100%; min-inline-size: 0; transition: inline-size 1.1s cubic-bezier(0.16, 1, 0.3, 1); }
.ta-legend { display: flex; flex-wrap: wrap; gap: 0.4em 1.2em; margin: 0; font-size: 0.8em; }
.ta-legend .ta-mine { font-weight: 800; }
.ta-legend-item { display: inline-flex; gap: 0.4em; align-items: baseline; }
.ta-legend-item .ta-poll-pct { font-weight: 700; }
@media (forced-colors: active) { .ta-half, .ta-tile { border: 1px solid ButtonText; } }
`;

// The style sheet, once in the card's scope (its shadow root or document) or in the card itself when the card is not
// yet in one: a view's rules apply wherever the card is drawn.
function ensureStyles(root: HTMLElement): void {
  const scope = root.getRootNode();
  if ((scope instanceof ShadowRoot || scope instanceof Document) && scope.querySelector('style[data-ta-poll-views]')) return;
  if (root.querySelector(':scope > style[data-ta-poll-views]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-ta-poll-views', '');
  style.textContent = POLL_VIEW_STYLES;
  root.prepend(style);
}

// Option colours: the category colour, its text picked for 4.5:1, or the theme's own pair when the option has none.
// The fallbacks are the accent and an ink tint, which read apart on either colour scheme.
const FALLBACK = [
  { fill: 'var(--ta-accent)', ink: 'var(--ta-on-accent)' },
  { fill: 'color-mix(in srgb, var(--ta-ink) 75%, var(--ta-paper))', ink: 'var(--ta-paper)' },
] as const;

function paint(button: HTMLElement, card: ChoiceCard, index: number): void {
  const color = card.colors?.[index] ?? null;
  const look = color ? { fill: color, ink: onAccent(color) } : FALLBACK[index % FALLBACK.length];
  button.style.setProperty('--ta-opt', look.fill);
  button.style.setProperty('--ta-opt-ink', look.ink);
}

// A button of a view: the label as a text node, the fill bar when it has one, and its colour when the view takes colours
// (this-or-that and grid only: embed and inline draw in the theme).
function option(card: ChoiceCard, index: number, className: string, fill: boolean, coloured = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  if (fill) {
    const bar = text('span', 'ta-poll-fill', '');
    bar.setAttribute('aria-hidden', 'true');
    button.append(bar);
  }
  button.append(text('span', 'ta-poll-label', card.choices[index].label));
  if (coloured) paint(button, card, index);
  return button;
}

// The option's fill bar, if it has one (the option's first span).
const fillOf = (button: HTMLElement): HTMLElement | null => button.querySelector<HTMLElement>('.ta-poll-fill');

/**
 * Draws the poll's options in `root` (the card, after its question) in the view `card.view` names, and returns what the
 * card needs to show a result (see {@link ChoiceDom}). Called once the chunk has loaded.
 */
export function buildPollView(root: HTMLElement, card: ChoiceCard): ChoiceDom {
  ensureStyles(root);
  const t: Translate = card.t ?? defaultTranslate;
  switch (card.view) {
    case 'this-or-that': {
      const box = document.createElement('div');
      box.className = 'ta-split';
      const a = option(card, 0, 'ta-half ta-half-a', false, true);
      const b = option(card, 1, 'ta-half ta-half-b', false, true);
      const vs = text('span', 'ta-vs', 'VS');
      vs.setAttribute('aria-hidden', 'true');
      box.append(a, b, vs);
      root.appendChild(box);
      return {
        options: [{ button: a, fill: null }, { button: b, fill: null }],
        shown(_result, percents) {
          // The split follows the shares; an empty vote keeps the halves even.
          const split = percents[0] + percents[1] > 0 ? percents[0] : 50;
          box.style.setProperty('--ta-split', `${split}%`);
        },
      };
    }
    case 'grid': {
      const grid = document.createElement('div');
      grid.className = 'ta-grid';
      const options = card.choices.map((_, i) => {
        const button = option(card, i, 'ta-tile', true, true);
        grid.appendChild(button);
        return { button, fill: fillOf(button) };
      });
      root.appendChild(grid);
      return { options };
    }
    case 'inline': {
      const row = document.createElement('div');
      row.className = 'ta-inline-row';
      const options = card.choices.map((_, i) => {
        const button = option(card, i, 'ta-poll-opt', true);
        row.appendChild(button);
        return { button, fill: fillOf(button) };
      });
      const bar = document.createElement('div');
      bar.className = 'ta-poll-bar';
      root.append(row, bar);
      return {
        options,
        shown(_result, percents, mine) {
          // The stacked bar and its legend: each share as a segment of the card's ink, the visitor's choice in bold.
          const stack = document.createElement('div');
          stack.className = 'ta-stackbar';
          const legend = document.createElement('p');
          legend.className = 'ta-legend';
          card.choices.forEach((choice, i) => {
            const segment = document.createElement('i');
            segment.style.inlineSize = `${percents[i]}%`;
            segment.style.backgroundColor = `color-mix(in srgb, currentColor ${Math.max(35, 80 - i * 35)}%, transparent)`;
            stack.appendChild(segment);
            const item = document.createElement('span');
            item.className = `ta-legend-item${i === mine ? ' ta-mine' : ''}`;
            item.append(text('span', 'ta-poll-label', choice.label));
            const pct = text('span', 'ta-poll-pct', `${percents[i]}%`);
            pct.dir = 'ltr';
            item.appendChild(pct);
            legend.appendChild(item);
          });
          bar.replaceChildren(stack, legend);
        },
      };
    }
    default: {
      // The embed, and any view this module does not draw otherwise: the options as full-width bars, with a results
      // header and a total line.
      const head = text('p', 'ta-embed-head', t('poll.resultsAfterVote'));
      const total = text('p', 'ta-poll-total', '');
      root.appendChild(head);
      const options = card.choices.map((_, i) => {
        const button = option(card, i, 'ta-poll-opt', true);
        root.appendChild(button);
        return { button, fill: fillOf(button) };
      });
      root.appendChild(total);
      return {
        options,
        shown(result) {
          const votes = (result as Partial<ChoiceResult>).total;
          head.textContent = t('poll.results');
          total.textContent = typeof votes === 'number' ? t(votes === 1 ? 'poll.vote' : 'poll.votes', { count: votes }) : '';
        },
      };
    }
  }
}
