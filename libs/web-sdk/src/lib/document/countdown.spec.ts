import type { DeliveryTaleElement } from '@taleart/contract';
import { createTranslate } from '../i18n';
import { renderCountdown, timeLeft } from './countdown';
import { ELEMENT_RENDERERS } from './renderer';

// Components (2026-10-29): the countdown renderer; it ticks by the visitor's clock, reports its end once,
// and draws nothing for an instant it cannot read.
const NOW = Date.parse('2026-10-29T12:00:00Z');
const countdownId = '00000000-0000-4000-8000-0000000000c1';
function countdown(props: Record<string, unknown> = {}): DeliveryTaleElement {
  return {
    id: countdownId,
    type: 'countdown',
    box: { x: 0.1, y: 0.1, w: 0.8, h: 0.2, rotation: 0 },
    a11y: {},
    props: { endsAt: '2026-10-29T12:00:10Z', ...props } as DeliveryTaleElement['props'],
  };
}

const units = (node: HTMLElement) => [...node.querySelectorAll('.ta-cd-num')].map((n) => n.textContent);
const live = (node: HTMLElement) => node.querySelector('[aria-live="polite"]')?.textContent ?? '';

describe('timeLeft', () => {
  it('splits the time left into days, hours, minutes and seconds, rounded up to the second', () => {
    expect(timeLeft(NOW + 1, NOW)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1 });
    expect(timeLeft(NOW + 90_061_000, NOW)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
  });

  it('is null at and after the instant', () => {
    expect(timeLeft(NOW, NOW)).toBeNull();
    expect(timeLeft(NOW, NOW + 5000)).toBeNull();
  });
});

describe('renderCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('is the renderer of the countdown type', () => {
    expect(ELEMENT_RENDERERS.get('countdown')).toBe(renderCountdown);
  });

  it('shows the days, hours, minutes and seconds left, in a timer that is not announced each second', () => {
    const node = renderCountdown(countdown({ endsAt: '2026-10-31T13:02:03Z' }), { reducedMotion: false }) as HTMLElement;
    expect(node.querySelector('[role="timer"]')).not.toBeNull();
    expect(units(node)).toEqual(['02', '01', '02', '03']);
    expect([...node.querySelectorAll('.ta-cd-label')].map((n) => n.textContent)).toEqual(['Days', 'Hours', 'Min', 'Sec']);
    expect([...node.querySelectorAll('.ta-cd-unit')].map((n) => n.getAttribute('aria-label'))).toEqual([
      '02 Days',
      '01 Hours',
      '02 Min',
      '03 Sec',
    ]);
    expect(node.querySelector('[role="timer"]')?.getAttribute('aria-live')).toBeNull();
  });

  it('ticks each second', () => {
    const node = renderCountdown(countdown(), { reducedMotion: false }) as HTMLElement;
    document.body.appendChild(node);
    expect(units(node)).toEqual(['00', '00', '00', '10']);
    vi.advanceTimersByTime(1000);
    expect(units(node)).toEqual(['00', '00', '00', '09']);
    vi.advanceTimersByTime(4000);
    expect(units(node)).toEqual(['00', '00', '00', '05']);
  });

  it('turns a changing number only when motion is allowed', () => {
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    try {
      const moving = renderCountdown(countdown(), { reducedMotion: false }) as HTMLElement;
      document.body.appendChild(moving);
      expect(animate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(animate).toHaveBeenCalledTimes(1);

      moving.remove();
      animate.mockClear();
      const still = renderCountdown(countdown(), { reducedMotion: true }) as HTMLElement;
      document.body.appendChild(still);
      vi.advanceTimersByTime(1000);
      expect(animate).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('announces the days, hours and minutes politely once a minute, and nothing else', () => {
    const node = renderCountdown(countdown({ endsAt: '2026-10-29T12:02:00Z' }), { reducedMotion: false }) as HTMLElement;
    document.body.appendChild(node);
    expect(live(node)).toBe('');
    vi.advanceTimersByTime(1000);
    expect(live(node)).toBe('0 Days 0 Hours 1 Min');
    vi.advanceTimersByTime(20_000);
    expect(units(node)[3]).toBe('39');
    expect(node.querySelectorAll('.ta-cd-unit')[3].getAttribute('aria-label')).toBe('39 Sec');
    expect(live(node)).toBe('0 Days 0 Hours 1 Min');
  });

  it('shows the ended text at the instant, reports ended once and stops ticking', () => {
    const onComponentEvent = vi.fn();
    const node = renderCountdown(countdown({ endsAt: '2026-10-29T12:00:02Z', endedText: 'Sale over' }), {
      reducedMotion: false,
      onComponentEvent,
    }) as HTMLElement;
    document.body.appendChild(node);
    vi.advanceTimersByTime(1000);
    expect(onComponentEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    const ended = node.querySelector<HTMLElement>('.ta-cd-ended');
    expect(ended?.textContent).toBe('Sale over');
    expect(ended?.hidden).toBe(false);
    expect((node.querySelector('.ta-cd-units') as HTMLElement).hidden).toBe(true);
    expect(live(node)).toBe('Sale over');
    expect(onComponentEvent).toHaveBeenCalledTimes(1);
    expect(onComponentEvent).toHaveBeenCalledWith({ component: 'countdown', action: 'ended' });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(onComponentEvent).toHaveBeenCalledTimes(1);
  });

  it('shows the ended text and reports the end at once for an instant already past, the default text when none is set', () => {
    const onComponentEvent = vi.fn();
    const node = renderCountdown(countdown({ endsAt: '2026-01-01T00:00:00Z' }), {
      reducedMotion: false,
      onComponentEvent,
    }) as HTMLElement;
    expect(node.querySelector('.ta-cd-ended')?.textContent).toBe(createTranslate('en', undefined)('countdown.ended'));
    expect(node.querySelector('.ta-cd-ended')?.textContent).toBe('Ended');
    expect(onComponentEvent).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the page strings for its units and ended text', () => {
    const t = createTranslate('he', { he: { 'countdown.ended': 'נגמר', 'countdown.days': 'ימים' } });
    const node = renderCountdown(countdown({ endsAt: '2026-10-30T12:00:00Z' }), { reducedMotion: false, t }) as HTMLElement;
    expect(node.querySelector('.ta-cd-label')?.textContent).toBe('ימים');
    expect(units(node)[0]).toBe('01');
  });

  it('names a titled countdown and shows its title as text', () => {
    const node = renderCountdown(countdown({ title: 'Sale ends <b>soon</b>', theme: 'dark' }), { reducedMotion: false }) as HTMLElement;
    expect(node.getAttribute('role')).toBe('group');
    expect(node.getAttribute('aria-label')).toBe('Sale ends <b>soon</b>');
    expect(node.querySelector('b')).toBeNull();
    expect(node.querySelector('.ta-cd-title')?.textContent).toBe('Sale ends <b>soon</b>');
    expect(node.classList).toContain('ta-poll-dark');
  });

  it('stops ticking once the countdown leaves the page', () => {
    const node = renderCountdown(countdown({ endsAt: '2026-10-31T12:00:00Z' }), { reducedMotion: false }) as HTMLElement;
    document.body.appendChild(node);
    vi.advanceTimersByTime(1000);
    node.remove();
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('draws nothing for an instant it cannot read', () => {
    for (const endsAt of ['2026-10-29T12:00:00+02:00', '2026-02-30T00:00:00Z', '2026-10-29 12:00:00Z', undefined, 42]) {
      expect(renderCountdown(countdown({ endsAt }), { reducedMotion: false })).toBeNull();
    }
  });

  it('shows markup in its text as literal text, and strips control characters from it', () => {
    const node = renderCountdown(countdown({ endedText: '<img src=x>\u0007Over' }), { reducedMotion: false }) as HTMLElement;
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('.ta-cd-ended')?.textContent).toBe('<img src=x>Over');
  });
});
