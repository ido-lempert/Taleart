import { cardClass } from './poll';
import { cleanText, isUtcInstant, LABEL_TEXT_RULE, type DeliveryTaleElement } from '@taleart/contract';
import { defaultTranslate, type StringKey } from '../i18n';
import type { RenderContext } from './media';

/**
 * A countdown's look (components, 2026-10-29): a card on the poll's colours, the four units with their
 * numbers over their names, and the ended text in their place. Its numbers do not take pointer events:
 * a tap on the countdown reaches the tale.
 */
export const COUNTDOWN_STYLES = `
.ta-countdown {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.2cqh;
  padding: 1.6cqh;
  border-radius: 1.8cqh;
  overflow: hidden;
  font-size: 2.4cqh;
  line-height: 1.25;
  text-align: center;
  overflow-wrap: anywhere;
}
.ta-cd-title { margin: 0; font-size: 0.75em; font-weight: 600; opacity: 0.85; }
.ta-cd-units:not([hidden]) {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.2cqh;
  font-variant-numeric: tabular-nums;
}
/* A number is one line, two digits wide at most in its column: 3.2em of the card's size, capped by the canvas width
   so four columns fit at 320 to 420 px wide. Digits take equal widths, so the numbers do not jiggle as they tick. */
.ta-cd-unit { display: flex; flex-direction: column; align-items: center; min-width: 0; }
.ta-cd-num {
  font-size: min(7.68cqh, 11cqw);
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ta-cd-label { font-size: 0.9em; opacity: 0.75; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ta-cd-ended { margin: 0; font-size: 1.6em; font-weight: 700; }
`;

/** The time left to an instant, in whole units, rounded up to the second so the last one shows until the end. */
export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** The time from `now` to `endsAt` (both in milliseconds since the epoch); null at and after `endsAt`. */
export function timeLeft(endsAt: number, now: number): TimeLeft | null {
  const ms = endsAt - now;
  if (ms <= 0) return null;
  const total = Math.ceil(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const UNIT_KEYS = {
  days: 'countdown.days',
  hours: 'countdown.hours',
  minutes: 'countdown.minutes',
  seconds: 'countdown.seconds',
} as const satisfies Record<keyof TimeLeft, StringKey>;
const UNITS = Object.keys(UNIT_KEYS) as (keyof TimeLeft)[];

function text(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

/**
 * A countdown (components, 2026-10-29): days, hours, minutes and seconds left until `endsAt`, the
 * instant the server checked, by the visitor's clock. It ticks each second in a timer
 * (`role="timer"`), which is not announced: a polite region says the days, hours and minutes once a
 * minute. A changing number turns over, unless the visitor prefers reduced motion. At and after
 * `endsAt` the units give way to the ended text, and `componentEvent` `ended` is reported once per
 * render. The timer stops when the countdown leaves the page. Null for an instant it cannot read.
 */
export function renderCountdown(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const t = context.t ?? defaultTranslate;
  const props = element.props as { title?: unknown; endsAt?: unknown; endedText?: unknown; theme?: unknown };
  if (!isUtcInstant(props.endsAt)) return null;
  const endsAt = Date.parse(props.endsAt);
  const title = typeof props.title === 'string' ? cleanText(props.title, LABEL_TEXT_RULE).trim() : '';
  const endedLabel =
    (typeof props.endedText === 'string' ? cleanText(props.endedText, LABEL_TEXT_RULE).trim() : '') || t('countdown.ended');

  const card = document.createElement('div');
  card.className = `ta-el ta-countdown ${cardClass(props.theme)}`;
  if (title) {
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', title);
    card.appendChild(text('p', 'ta-cd-title', title));
  }

  // The timer: a number over its name for each unit, read as a timer, never announced second by second.
  const units = document.createElement('div');
  units.className = 'ta-cd-units';
  units.setAttribute('role', 'timer');
  const numbers = new Map<keyof TimeLeft, HTMLElement>();
  const labels = new Map<keyof TimeLeft, HTMLElement>();
  for (const unit of UNITS) {
    const box = document.createElement('div');
    box.className = 'ta-cd-unit';
    box.setAttribute('role', 'group');
    const number = text('span', 'ta-cd-num', '00');
    const label = t(UNIT_KEYS[unit]);
    // The number over its unit label, which is also the unit's accessible name, such as "03 Hours".
    box.append(number, text('span', 'ta-cd-label', label));
    box.setAttribute('aria-label', `00 ${label}`);
    numbers.set(unit, number);
    labels.set(unit, box);
    units.appendChild(box);
  }
  const ended = text('p', 'ta-cd-ended', endedLabel);
  ended.hidden = true;
  // The days, hours and minutes, said once a minute; the ended text is said when it comes.
  const live = text('p', 'ta-sr', '');
  live.setAttribute('aria-live', 'polite');
  card.append(units, ended, live);

  let announced = '';
  let shown = false;
  let done = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const turn = (node: HTMLElement) => {
    if (context.reducedMotion || typeof node.animate !== 'function') return;
    node.animate(
      [
        { transform: 'rotateX(-90deg)', opacity: 0 },
        { transform: 'rotateX(0deg)', opacity: 1 },
      ],
      { duration: 350, easing: 'ease-out' },
    );
  };

  // Shows the time left, or, once it has ended, the ended text, and reports the end once.
  const update = (): void => {
    const left = timeLeft(endsAt, Date.now());
    if (!left) {
      if (done) return;
      done = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      units.hidden = true;
      ended.hidden = false;
      live.textContent = endedLabel;
      context.onComponentEvent?.({ component: 'countdown', action: 'ended' });
      return;
    }
    for (const unit of UNITS) {
      const number = numbers.get(unit);
      const value = String(left[unit]).padStart(2, '0');
      if (!number || number.textContent === value) continue;
      number.textContent = value;
      labels.get(unit)?.setAttribute('aria-label', `${value} ${t(UNIT_KEYS[unit])}`);
      // The first numbers show as they are; only a change after that turns.
      if (shown) turn(number);
    }
    shown = true;
    const minute = `${left.days}:${left.hours}:${left.minutes}`;
    if (announced !== '' && minute !== announced) {
      live.textContent = `${left.days} ${t('countdown.days')} ${left.hours} ${t('countdown.hours')} ${left.minutes} ${t('countdown.minutes')}`;
    }
    announced = minute;
  };

  update();
  if (!done) {
    timer = setInterval(() => {
      // A countdown that has left the page (a viewer closed, the tale moved on) stops ticking.
      if (!card.isConnected) {
        if (timer !== null) clearInterval(timer);
        timer = null;
        return;
      }
      update();
    }, 1000);
  }
  return card;
}