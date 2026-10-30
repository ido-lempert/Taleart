import type { DeliveryTaleElement } from '@taleart/contract';
import { renderButton } from './links';
import { POLL_STYLES } from './poll';
import { PROMO_STYLES, renderPromoCode } from './promo-code';
import { RATING_STYLES, renderRating } from './rating';
import { REACTION_STYLES, renderReaction } from './reaction';
import { COUNTDOWN_STYLES } from './countdown';
import { DOCUMENT_STYLES } from './renderer';

// The end-user redesign, P6a: the stickers' look and motion (quiz marks, rating thumb, reaction fly, countdown digits,
// promo ticket and toast, the CTA fallbacks), with theme tokens and motion that reduced motion stops.
function el(type: string, props: Record<string, unknown>): DeliveryTaleElement {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    type,
    box: { x: 0.1, y: 0.4, w: 0.8, h: 0.3, rotation: 0 },
    a11y: {},
    props: props as DeliveryTaleElement['props'],
  } as DeliveryTaleElement;
}

describe('the sticker stylesheets', () => {
  it('draws the quiz marks in the success and error inks, a wrong answer shakes, and a right one pops', () => {
    expect(POLL_STYLES).toContain('--ta-mark: var(--ta-success-ink)');
    expect(POLL_STYLES).toContain('--ta-mark: var(--ta-error-ink)');
    expect(POLL_STYLES).toMatch(/\.ta-quiz-wrong \{[^}]*animation: ta-shake/);
    expect(POLL_STYLES).toMatch(/\.ta-poll-mine \{[^}]*animation: ta-pop/);
  });

  it('keeps the motion of the stickers in keyframes the renderer stops under reduced motion', () => {
    expect(REACTION_STYLES).toContain('@keyframes ta-fly');
    expect(COUNTDOWN_STYLES).toContain('.ta-cd-num');
    expect(PROMO_STYLES).toContain('@keyframes ta-shine');
    expect(PROMO_STYLES).toContain('@keyframes ta-toast-in');
    expect(DOCUMENT_STYLES).toContain('@media (prefers-reduced-motion: reduce) { .ta-canvas * { animation: none !important; transition: none !important; } }');
  });

  it('grows the rating thumb with its value, through a custom property the slider sets', () => {
    expect(RATING_STYLES).toContain('font-size: calc(1.6em + var(--ta-v, 50) * 0.012em)');
  });

  it('gives the CTA fallback a pill, and the swipe-up chevron bobs (translate, not transform)', () => {
    expect(DOCUMENT_STYLES).toContain('.ta-button { padding: 0 0.8em; border-radius: 99px;');
    expect(DOCUMENT_STYLES).toMatch(/\.ta-swipe-arrow \{[^}]*animation: ta-bob/);
  });

  it('uses no hard-coded colour in the sticker stylesheets', () => {
    // The promo ticket's notches are alpha masks (transparent and opaque), not colours: they are the only literals.
    for (const css of [POLL_STYLES, RATING_STYLES, REACTION_STYLES, PROMO_STYLES]) {
      const colours = css.split('\n').filter((line) => !/\bmask(-composite)?\s*:|-webkit-mask/.test(line)).join('\n');
      expect(colours).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});

describe('the rating thumb', () => {
  it('sets its value on the thumb, which moves and grows with the slider', () => {
    const node = renderRating(el('rating', { question: 'Hype?', emoji: '🔥', theme: 'light' }), { reducedMotion: false }) as HTMLElement;
    const thumb = node.querySelector<HTMLElement>('.ta-rate-thumb');
    expect(thumb?.style.getPropertyValue('--ta-v')).toBe('50');
    node.querySelector<HTMLElement>('.ta-rate-track')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(thumb?.style.getPropertyValue('--ta-v')).toBe('60');
  });
});

describe('the reaction fly', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the tapped emoji up over its button, once, and removes it when it has flown', () => {
    const node = renderReaction(el('reaction', { question: 'Feel?', emojis: ['❤️', '😂'], theme: 'light' }), { reducedMotion: false }) as HTMLElement;
    document.body.appendChild(node);
    const button = node.querySelector('.ta-reaction-btn') as HTMLButtonElement;
    button.click();
    const fly = button.querySelector<HTMLElement>('.ta-reaction-fly');
    expect(fly?.textContent).toBe('❤️');
    expect(fly?.getAttribute('aria-hidden')).toBe('true');
    vi.advanceTimersByTime(1200);
    expect(button.querySelector('.ta-reaction-fly')).toBeNull();
    node.remove();
  });
});

describe('the promo ticket', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is a ticket: the code and its Copy stub side by side, with the toast in its own element', () => {
    const node = renderPromoCode(el('promo-code', { code: 'SPRING26', title: 'Gift', theme: 'light' }), { reducedMotion: false }) as HTMLElement;
    const ticket = node.querySelector('.ta-promo-ticket');
    expect(ticket?.querySelector('.ta-promo-chip')?.textContent).toBe('SPRING26');
    expect(ticket?.querySelector('.ta-promo-copy')?.textContent).toBe('Copy');
    expect(node.querySelector('.ta-promo-status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the toast for four seconds, and not less', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const node = renderPromoCode(el('promo-code', { code: 'SPRING26' }), { reducedMotion: false }) as HTMLElement;
      (node.querySelector('.ta-promo-copy') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(0);
      const status = node.querySelector('.ta-promo-status');
      expect(status?.textContent).toBe('Copied');
      await vi.advanceTimersByTimeAsync(3999);
      expect(status?.textContent).toBe('Copied');
      await vi.advanceTimersByTimeAsync(1);
      expect(status?.textContent).toBe('');
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});

describe('the CTA fallbacks', () => {
  it('leaves a button its own corner radius when it has one, and the pill when it has none', () => {
    const square = renderButton(el('button', { label: 'Go', href: 'https://example.com', radius: 0, variant: 'filled' }), { reducedMotion: false }) as HTMLElement;
    expect(square.style.borderRadius).toBe('0cqh');
    const unset = renderButton(el('button', { label: 'Go', href: 'https://example.com', variant: 'filled' }), { reducedMotion: false }) as HTMLElement;
    expect(unset.style.borderRadius).toBe('');
    expect(unset.classList).toContain('ta-button');
  });
});
