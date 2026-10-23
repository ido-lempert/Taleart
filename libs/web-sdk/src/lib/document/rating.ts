import {
  cleanText,
  EMOJI_FONT_STACK,
  LABEL_TEXT_RULE,
  MAX_EMOJI_LENGTH,
  RATING_MAX,
  RATING_MIN,
  RATING_STEP,
  type DeliveryTaleElement,
  type RatingResult,
  type ResponseResult,
} from '@taleart/contract';
import type { RenderContext } from './media';

/**
 * A Rating's look (epic interactive components R5, R10), on the poll's card: a track that fills up
 * to the emoji, its thumb, and once rated a mark at the average. The track takes no touch gestures
 * of the browser's (`touch-action: none`), so a drag on it is the Rating's alone.
 */
export const RATING_STYLES = `
.ta-rate-track {
  position: relative;
  height: 2.4em;
  margin: 0 1.2em;
  touch-action: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.ta-rate-track::before, .ta-rate-fill {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  top: calc(50% - 0.3em);
  height: 0.6em;
  border-radius: 999px;
  background: currentColor;
}
.ta-rate-track::before { width: 100%; opacity: 0.2; }
.ta-rate-fill { opacity: 0.6; }
.ta-rate-thumb, .ta-rate-avg { position: absolute; top: 50%; transform: translateY(-50%); }
.ta-rate-thumb { width: 1em; margin-inline-start: -0.5em; font-size: 1.8em; line-height: 1; text-align: center; }
.ta-rate-avg { width: 0.3em; margin-inline-start: -0.15em; height: 1.4em; border-radius: 999px; background: currentColor; display: none; }
.ta-rated .ta-rate-avg { display: block; }
.ta-rated .ta-rate-track { cursor: default; }
.ta-rate-track:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px #000; border-radius: 999px; }
.ta-rate-out { margin: 0; font-size: 0.85em; font-weight: 600; text-align: center; }
@media (forced-colors: active) { .ta-rate-track::before, .ta-rate-fill, .ta-rate-avg { background: CanvasText; } }
`;

/** The Rating's value after `key` from `value`: arrows and Page keys step by {@link RATING_STEP}, Home and End go to the ends. Null for another key. */
export function ratingKey(value: number, key: string, rtl = false): number | null {
  const up = Math.min(RATING_MAX, value + RATING_STEP);
  const down = Math.max(RATING_MIN, value - RATING_STEP);
  switch (key) {
    case 'ArrowUp':
    case 'PageUp':
      return up;
    case 'ArrowDown':
    case 'PageDown':
      return down;
    // Right to left, the scale runs from the right: the left arrow moves the emoji up it.
    case 'ArrowRight':
      return rtl ? down : up;
    case 'ArrowLeft':
      return rtl ? up : down;
    case 'Home':
      return RATING_MIN;
    case 'End':
      return RATING_MAX;
    default:
      return null;
  }
}

/** What the result says: the average and how many rated. */
export function ratingSummary(result: RatingResult): string {
  return `Average ${result.average} from ${result.total} ${result.total === 1 ? 'rating' : 'ratings'}`;
}

function text(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

// A whole number on the scale; the server answers one, the SDK checks again.
const onScale = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(n))) : RATING_MIN;

// A count: a whole number, never negative, however large.
const countOf = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The result when it is a Rating's: its count (any size) and its average on the scale; else null. */
export function ratingOf(result: ResponseResult | null): RatingResult | null {
  const r = result as Partial<RatingResult> | null;
  return r && typeof r.total === 'number' && typeof r.average === 'number' ? { total: countOf(r.total), average: onScale(r.average) } : null;
}

/**
 * A Rating (epic interactive components R5, R10; AD-16): a group named by its question, holding its
 * title and question as text nodes and a slider (`role="slider"`, 0 to 100) whose thumb is the
 * emoji. The visitor drags the emoji, or presses on the track, by pointer or touch, and the rating is
 * posted on release; or moves it with the arrow keys and Page keys in steps of 10, Home and End, and
 * posts it with Enter. Its pointer, click and key events stop at the Rating, so a drag never swipes
 * to another tale or group, a press never steps, and its keys never step the tale. Once rated, the
 * slider keeps the visitor's value, the track marks the average, and the count and average show and
 * are said in a polite live region; no second rating is taken. A rating this device made before
 * shows at once, as kept (C11). Without a response client (the Tale Studio preview) a release marks
 * the value and records nothing. Null for props it cannot draw.
 */
export function renderRating(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const props = element.props as { question?: unknown; title?: unknown; theme?: unknown; emoji?: unknown };
  const question = typeof props.question === 'string' ? props.question.trim() : '';
  const emoji =
    typeof props.emoji === 'string' ? [...cleanText(props.emoji, LABEL_TEXT_RULE)].slice(0, MAX_EMOJI_LENGTH).join('') : '';
  if (!question || !emoji.trim()) return null;
  const card = document.createElement('div');
  card.className = `ta-el ta-poll ta-interactive ta-rating ta-poll-${props.theme === 'dark' ? 'dark' : 'light'}`;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', question);
  if (typeof props.title === 'string' && props.title.trim()) card.appendChild(text('p', 'ta-poll-title', props.title));
  card.appendChild(text('p', 'ta-poll-q', question));

  const track = document.createElement('div');
  track.className = 'ta-rate-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', 'Your rating');
  track.setAttribute('aria-valuemin', String(RATING_MIN));
  track.setAttribute('aria-valuemax', String(RATING_MAX));
  track.setAttribute('aria-orientation', 'horizontal');
  const fill = text('span', 'ta-rate-fill', '');
  const average = text('span', 'ta-rate-avg', '');
  const thumb = text('span', 'ta-rate-thumb', emoji);
  thumb.style.fontFamily = EMOJI_FONT_STACK;
  for (const part of [fill, average, thumb]) part.setAttribute('aria-hidden', 'true');
  track.append(fill, average, thumb);
  const out = text('p', 'ta-rate-out', '');
  const live = text('p', 'ta-sr', '');
  live.setAttribute('aria-live', 'polite');
  card.append(track, out, live);

  const responses = context.responses;
  const rtl = () => typeof getComputedStyle === 'function' && getComputedStyle(card).direction === 'rtl';
  let value = 50;
  let answered = false;
  let busy = false;
  let dragging: number | null = null;

  // Moves the emoji to `next` and says where it is.
  const set = (next: number) => {
    value = onScale(next);
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', `${answered ? 'You rated ' : ''}${value} out of ${RATING_MAX}`);
    thumb.style.insetInlineStart = `${value}%`;
    fill.style.width = `${value}%`;
  };
  set(value);

  // Keeps the visitor's value and, with a result, marks the average and says it; no further rating.
  const show = (rated: number, result: RatingResult | null) => {
    answered = true;
    card.classList.add('ta-rated');
    track.setAttribute('aria-disabled', 'true');
    set(rated);
    if (result) {
      average.style.insetInlineStart = `${result.average}%`;
      out.textContent = ratingSummary(result);
    }
  };

  const kept = responses?.client.stored(responses.taleId, element.id) ?? null;
  if (kept) show(Number(kept.value), ratingOf(kept.result));

  const submit = () => {
    if (answered || busy) return;
    const rated = value;
    if (!responses) {
      show(rated, null);
      live.textContent = `You rated ${rated}. Ratings are not recorded in the preview.`;
      return;
    }
    busy = true;
    card.setAttribute('aria-busy', 'true');
    responses.client
      .send(responses.taleId, element.id, String(rated))
      .then((response) => {
        const result = ratingOf(response.result);
        show(Number(response.value), result);
        live.textContent = `You rated ${value}. ${result ? `${ratingSummary(result)}.` : ''}`;
      })
      .catch(() => {
        live.textContent = 'Your rating could not be sent. Try again.';
      })
      .finally(() => {
        busy = false;
        card.removeAttribute('aria-busy');
      });
  };

  // The value under the pointer, along the scale's direction.
  const at = (e: PointerEvent) => {
    const box = track.getBoundingClientRect();
    const share = box.width > 0 ? (e.clientX - box.left) / box.width : 0.5;
    return (rtl() ? 1 - share : share) * RATING_MAX;
  };

  // A press, drag and release on the track are the Rating's: the viewer never sees them, so they
  // neither step, pause by holding, nor swipe between groups (R5).
  track.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    // A second pointer while one drags (a second finger) is ignored: the first one's drag goes on.
    if (e.button !== 0 || answered || busy || dragging !== null) return;
    e.preventDefault();
    track.focus({ preventScroll: true });
    dragging = e.pointerId;
    try {
      track.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
    set(at(e));
  });
  track.addEventListener('pointermove', (e) => {
    if (dragging !== e.pointerId) return;
    e.stopPropagation();
    set(at(e));
  });
  track.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    if (dragging !== e.pointerId) return;
    dragging = null;
    set(at(e));
    submit();
  });
  // A drag the browser cancelled, or whose capture was lost, ends without a rating; the viewer never
  // sees it, as it never saw the press.
  const cancel = (e: PointerEvent) => {
    e.stopPropagation();
    if (dragging === e.pointerId) dragging = null;
  };
  track.addEventListener('pointercancel', cancel);
  track.addEventListener('lostpointercapture', cancel);
  card.addEventListener('click', (e) => e.stopPropagation());
  track.addEventListener('keydown', (e) => {
    // Once rated the slider is read-only: its keys go to the viewer again, as on any other part of the tale.
    if (answered || e.altKey || e.ctrlKey || e.metaKey) return;
    const next = e.key === 'Enter' ? value : ratingKey(value, e.key, rtl());
    if (next === null) return;
    // The slider's keys are its own: they never step the tale (R10).
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (e.key === 'Enter') submit();
    else set(next);
  });
  return card;
}
