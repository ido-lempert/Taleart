import type { DeliveryTaleDocument, DeliveryTaleElement, DeliveryTaleGroup } from '@taleart/contract';
import { TaleViewer } from '../viewer';
import type { ResponseClient, StoredResponse } from '../responses';
import { ratingKey, ratingOf, ratingSummary, renderRating } from './rating';
import { ELEMENT_RENDERERS, renderTaleDocument } from './renderer';

// Epic interactive components story 4.2: the Rating renderer (R5, R10, C7, C9, C11; AD-16).
const ratingId = '00000000-0000-4000-8000-0000000000dd';
function rating(props: Record<string, unknown> = {}): DeliveryTaleElement {
  return {
    id: ratingId,
    type: 'rating',
    box: { x: 0.1, y: 0.6, w: 0.8, h: 0.25, rotation: 0 },
    a11y: {},
    props: { question: 'How was it?', emoji: '❤️', theme: 'dark', ...props } as DeliveryTaleElement['props'],
  };
}

const rated: StoredResponse = { value: '80', result: { total: 2, average: 60 } };

function fakeClient(kept: StoredResponse | null = null, answer: (value: string) => Promise<StoredResponse> = async () => rated) {
  const send = vi.fn((_taleId: string, _elementId: string, value: string) => answer(value));
  const stored = vi.fn((_taleId: string, _elementId: string) => kept);
  return { client: { send, stored } satisfies ResponseClient, send, stored };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const slider = (node: HTMLElement) => node.querySelector('[role="slider"]') as HTMLElement;
const press = (target: Element, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};
// A track 200 px wide from x = 0, so x / 2 is the value under the pointer.
function sized(track: HTMLElement): HTMLElement {
  track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 40, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
  return track;
}
function drag(track: Element, type: string, x: number, pointerId = 1): PointerEvent {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 20, pointerId });
  track.dispatchEvent(e);
  return e;
}

describe('renderRating', () => {
  it('is the renderer of the rating type', () => {
    expect(ELEMENT_RENDERERS.get('rating')).toBe(renderRating);
  });

  it('renders a group named by its question, holding a slider from 0 to 100 with the emoji as its thumb', () => {
    const node = renderRating(rating({ title: 'Quick one' }), { reducedMotion: false }) as HTMLElement;
    expect(node.getAttribute('role')).toBe('group');
    expect(node.getAttribute('aria-label')).toBe('How was it?');
    expect(node.classList).toContain('ta-interactive');
    expect(node.classList).toContain('ta-poll-dark');
    expect(node.querySelector('.ta-poll-title')?.textContent).toBe('Quick one');
    expect(node.querySelector('.ta-poll-q')?.textContent).toBe('How was it?');
    const track = slider(node);
    expect(track.tabIndex).toBe(0);
    expect(track.getAttribute('aria-label')).toBe('Your rating');
    expect(['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'].map((a) => track.getAttribute(a))).toEqual([
      '0',
      '100',
      '50',
      '50 out of 100',
    ]);
    const thumb = track.querySelector('.ta-rate-thumb') as HTMLElement;
    expect(thumb.textContent).toBe('❤️');
    expect(thumb.getAttribute('aria-hidden')).toBe('true');
    expect(thumb.style.insetInlineStart).toBe('50%');
    expect(node.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(renderRating(rating({ theme: 'light' }), { reducedMotion: false })?.classList).toContain('ta-poll-light');
  });

  it('shows markup in its text as literal text (AD-16) and draws nothing for props it cannot draw', () => {
    const node = renderRating(rating({ question: '<img src=x onerror=alert(1)>' }), { reducedMotion: false }) as HTMLElement;
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('.ta-poll-q')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(renderRating(rating({ question: ' ' }), { reducedMotion: false })).toBeNull();
    expect(renderRating(rating({ emoji: '' }), { reducedMotion: false })).toBeNull();
    expect(renderRating(rating({ emoji: 7 }), { reducedMotion: false })).toBeNull();
  });

  it('moves by 10 with the arrow and Page keys, to the ends with Home and End, and posts on Enter', async () => {
    const { client, send } = fakeClient(null, async (value) => ({ value, result: { total: 1, average: Number(value) } }));
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const track = slider(node);
    const now = () => track.getAttribute('aria-valuenow');
    expect(press(track, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(now()).toBe('40');
    press(track, 'ArrowDown');
    expect(now()).toBe('30');
    press(track, 'End');
    expect(now()).toBe('100');
    press(track, 'ArrowRight');
    expect(now()).toBe('100');
    press(track, 'Home');
    expect(now()).toBe('0');
    press(track, 'ArrowLeft');
    expect(now()).toBe('0');
    press(track, 'PageUp');
    press(track, 'ArrowUp');
    press(track, 'ArrowRight');
    press(track, 'ArrowRight');
    expect(now()).toBe('40');
    expect(send).not.toHaveBeenCalled();
    expect(press(track, 'Tab').defaultPrevented).toBe(false);
    press(track, 'Enter');
    expect(send).toHaveBeenCalledWith('t1', ratingId, '40');
    expect(node.getAttribute('aria-busy')).toBe('true');
    await flush();
    expect(node.hasAttribute('aria-busy')).toBe(false);
    expect(track.getAttribute('aria-disabled')).toBe('true');
    expect(track.getAttribute('aria-valuetext')).toBe('You rated 40 out of 100');
    expect(node.querySelector('.ta-rate-out')?.textContent).toBe('Average 40 from 1 rating');
    expect(node.querySelector('[aria-live]')?.textContent).toBe('You rated 40. Average 40 from 1 rating.');
    // No second rating: the read-only slider lets its keys through to the viewer, and changes nothing.
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter']) expect(press(track, k).defaultPrevented).toBe(false);
    expect(now()).toBe('40');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('shows a count of any size, from the server and as kept (C11)', async () => {
    const { client } = fakeClient(null, async () => ({ value: '80', result: { total: 250, average: 60 } }));
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    press(slider(node), 'Enter');
    await flush();
    expect(node.querySelector('.ta-rate-out')?.textContent).toBe('Average 60 from 250 ratings');
    const kept = fakeClient({ value: '30', result: { total: 12_345, average: 41 } });
    const again = renderRating(rating(), { reducedMotion: false, responses: { client: kept.client, taleId: 't1' } }) as HTMLElement;
    expect(again.querySelector('.ta-rate-out')?.textContent).toBe('Average 41 from 12345 ratings');
    expect(ratingOf({ total: 7.9, average: 140 })).toEqual({ total: 7, average: 100 });
    expect(ratingOf({ total: -3, average: -1 })).toEqual({ total: 0, average: 0 });
    expect(ratingOf({ total: 2, choices: [] })).toBeNull();
  });

  it('takes a release outside the track as the nearest end', () => {
    const { client, send } = fakeClient();
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const track = sized(slider(node));
    drag(track, 'pointerdown', 100);
    // With the pointer captured, the release comes to the track wherever it happens.
    drag(track, 'pointermove', -80);
    drag(track, 'pointerup', -80);
    expect(send).toHaveBeenCalledWith('t1', ratingId, '0');
  });

  it('ends a drag whose capture was lost without posting, and keeps the cancel from the viewer', () => {
    const { client, send } = fakeClient();
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const outer = document.createElement('div');
    outer.appendChild(node);
    const heard: string[] = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      outer.addEventListener(type, () => heard.push(type));
    }
    const track = sized(slider(node));
    drag(track, 'pointerdown', 100);
    drag(track, 'lostpointercapture', 100);
    drag(track, 'pointermove', 180);
    drag(track, 'pointerup', 180);
    expect(track.getAttribute('aria-valuenow')).toBe('50');
    drag(track, 'pointerdown', 100);
    drag(track, 'pointercancel', 100);
    drag(track, 'pointerup', 100);
    expect(send).not.toHaveBeenCalled();
    expect(heard).toEqual([]);
  });

  it('ignores a second pointer while one drags', () => {
    const { client, send } = fakeClient();
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const track = sized(slider(node));
    drag(track, 'pointerdown', 60, 1);
    drag(track, 'pointerdown', 180, 2);
    expect(track.getAttribute('aria-valuenow')).toBe('30');
    drag(track, 'pointermove', 190, 2);
    drag(track, 'pointerup', 190, 2);
    expect(send).not.toHaveBeenCalled();
    drag(track, 'pointermove', 140, 1);
    drag(track, 'pointerup', 140, 1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('t1', ratingId, '70');
  });

  it('follows a drag by pointer or touch and posts on release, marking the average', async () => {
    const { client, send } = fakeClient();
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const track = sized(slider(node));
    drag(track, 'pointerdown', 20);
    expect(track.getAttribute('aria-valuenow')).toBe('10');
    drag(track, 'pointermove', 120);
    expect(track.getAttribute('aria-valuenow')).toBe('60');
    expect((track.querySelector('.ta-rate-fill') as HTMLElement).style.width).toBe('60%');
    // Past the end stays on the scale.
    drag(track, 'pointermove', 400);
    expect(track.getAttribute('aria-valuenow')).toBe('100');
    expect(send).not.toHaveBeenCalled();
    drag(track, 'pointerup', 161);
    expect(send).toHaveBeenCalledWith('t1', ratingId, '81');
    await flush();
    // The server's stored rating shows (C9).
    expect(track.getAttribute('aria-valuenow')).toBe('80');
    expect(node.classList).toContain('ta-rated');
    expect((track.querySelector('.ta-rate-avg') as HTMLElement).style.insetInlineStart).toBe('60%');
    expect(node.querySelector('.ta-rate-out')?.textContent).toBe('Average 60 from 2 ratings');
    // A new drag after rating changes nothing.
    drag(track, 'pointerdown', 10);
    drag(track, 'pointerup', 10);
    expect(track.getAttribute('aria-valuenow')).toBe('80');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reads the scale from the right in a right-to-left page', () => {
    const { client } = fakeClient();
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const wrapper = document.createElement('div');
    wrapper.dir = 'rtl';
    // jsdom does not inherit `direction`: the card's own computed style says it here.
    node.style.direction = 'rtl';
    wrapper.appendChild(node);
    document.body.appendChild(wrapper);
    try {
      const track = sized(slider(node));
      drag(track, 'pointerdown', 40);
      expect(track.getAttribute('aria-valuenow')).toBe('80');
      press(track, 'ArrowLeft');
      expect(track.getAttribute('aria-valuenow')).toBe('90');
    } finally {
      wrapper.remove();
    }
  });

  it('forgets a drag the browser cancelled without posting', () => {
    const { client, send } = fakeClient();
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const track = sized(slider(node));
    drag(track, 'pointerdown', 100);
    drag(track, 'pointercancel', 100);
    drag(track, 'pointerup', 100);
    expect(send).not.toHaveBeenCalled();
  });

  it('shows a rating this device kept at once, without posting again (C11)', () => {
    const { client, send, stored } = fakeClient(rated);
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    expect(stored).toHaveBeenCalledWith('t1', ratingId);
    const track = slider(node);
    expect(track.getAttribute('aria-valuenow')).toBe('80');
    expect(track.getAttribute('aria-disabled')).toBe('true');
    expect(node.querySelector('.ta-rate-out')?.textContent).toBe('Average 60 from 2 ratings');
    press(track, 'Enter');
    expect(send).not.toHaveBeenCalled();
  });

  it('says when the rating could not be sent and lets the visitor try again', async () => {
    let fail = true;
    const { client, send } = fakeClient(null, async () => {
      if (fail) throw new Error('offline');
      return rated;
    });
    const node = renderRating(rating(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    press(slider(node), 'Enter');
    await flush();
    expect(node.querySelector('[aria-live]')?.textContent).toBe('Your rating could not be sent. Try again.');
    expect(slider(node).hasAttribute('aria-disabled')).toBe(false);
    fail = false;
    press(slider(node), 'Enter');
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(slider(node).getAttribute('aria-disabled')).toBe('true');
  });

  it('records nothing without a response client (the Tale Studio preview)', () => {
    const node = renderTaleDocument(
      { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [rating()] },
      { inertLinks: true },
    );
    const track = slider(node);
    press(track, 'ArrowRight');
    press(track, 'Enter');
    expect(track.getAttribute('aria-valuenow')).toBe('60');
    expect(track.getAttribute('aria-disabled')).toBe('true');
    expect(node.querySelector('.ta-rating [aria-live]')?.textContent).toBe(
      'You rated 60. Ratings are not recorded in the preview.',
    );
  });

  it('words the keys and the summary', () => {
    expect(ratingKey(50, 'ArrowRight', true)).toBe(40);
    expect(ratingKey(50, 'a')).toBeNull();
    expect(ratingSummary({ total: 1, average: 7 })).toBe('Average 7 from 1 rating');
  });
});

describe('TaleViewer with a Rating (R5, C7)', () => {
  const doc = (elements: DeliveryTaleElement[]): DeliveryTaleDocument => ({
    version: 1,
    canvas: { background: { type: 'color', color: '#112233' } },
    elements,
  });
  let host: HTMLElement;
  let viewer: TaleViewer;
  let fake: ReturnType<typeof fakeClient>;
  const dialog = () => host.querySelector('dialog') as HTMLDialogElement;
  const where = () => `${dialog().getAttribute('aria-label')} ${dialog().querySelectorAll('.segment.done').length + 1}`;
  const track = () => sized(dialog().querySelector('[role="slider"]') as HTMLElement);

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    fake = fakeClient();
    const groups: DeliveryTaleGroup[] = [
      {
        id: 'g1',
        name: 'First',
        cover: null,
        tales: [
          { id: 't1', title: 'One', media: null, document: doc([rating()]) },
          { id: 't2', title: 'Two', media: null, document: doc([]) },
        ],
      },
      { id: 'g2', name: 'Second', cover: null, tales: [{ id: 't3', title: 'Three', media: null, document: doc([]) }] },
    ];
    viewer = new TaleViewer(host, groups, { responses: fake.client });
    viewer.open('g1');
  });

  afterEach(() => {
    viewer.close();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('a sideways drag on the slider rates and neither swipes to another group nor steps', () => {
    const before = where();
    const slider = track();
    // A long, quick drag toward the start of the line: on the stage it would show the next group.
    drag(slider, 'pointerdown', 190);
    drag(slider, 'pointermove', 100);
    const up = drag(slider, 'pointerup', 10);
    slider.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(up.defaultPrevented).toBe(false);
    expect(where()).toBe(before);
    expect(fake.send).toHaveBeenCalledWith('t1', ratingId, '5');
  });

  it('once rated, lets the arrow keys step the tale again', async () => {
    vi.useRealTimers();
    const slider = track();
    slider.focus();
    press(slider, 'Enter');
    await flush();
    expect(slider.getAttribute('aria-disabled')).toBe('true');
    const before = where();
    expect(press(slider, 'ArrowRight').defaultPrevented).toBe(true);
    expect(where()).not.toBe(before);
  });

  it('pauses while the slider has focus, and its arrow keys move the emoji, never the tale', async () => {
    const before = where();
    const slider = track();
    slider.focus();
    expect(dialog().hasAttribute('data-paused')).toBe(true);
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'End', 'Home', 'ArrowRight']) press(slider, k);
    expect(where()).toBe(before);
    expect(slider.getAttribute('aria-valuenow')).toBe('10');
    vi.advanceTimersByTime(20_000);
    expect(where()).toBe(before);
    // Space on the slider is the slider's while rating: it does not toggle the pause.
    const live = press(slider, ' ');
    expect(live.defaultPrevented).toBe(false);
    expect(dialog().querySelector('.pause')?.getAttribute('aria-label')).toBe('Pause');
    press(slider, 'Enter');
    expect(fake.send).toHaveBeenCalledWith('t1', ratingId, '10');
    await vi.advanceTimersByTimeAsync(0);
    expect(slider.getAttribute('aria-disabled')).toBe('true');
    // Rated: Space does nothing on the slider, neither a press nor a pause (story 4.3).
    const space = press(slider, ' ');
    expect(space.defaultPrevented).toBe(true);
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    slider.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(dialog().hasAttribute('data-paused')).toBe(true);
    expect(dialog().querySelector('.pause')?.getAttribute('aria-label')).toBe('Pause');
    slider.blur();
    expect(dialog().hasAttribute('data-paused')).toBe(false);
    slider.focus();
    // Escape still closes the viewer from the slider.
    press(slider, 'Escape');
    expect(dialog()?.open ?? false).toBe(false);
  });
});
