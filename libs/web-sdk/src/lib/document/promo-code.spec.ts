import type { DeliveryTaleElement } from '@taleart/contract';
import { createTranslate } from '../i18n';
import { copyCode, renderPromoCode } from './promo-code';
import { ELEMENT_RENDERERS } from './renderer';

// Components (2026-10-29): the promo code renderer; Copy uses the clipboard, falls back to a selection
// and says what happened; an invalid code draws nothing.
const promoId = '00000000-0000-4000-8000-0000000000f1';
function promo(props: Record<string, unknown> = {}): DeliveryTaleElement {
  return {
    id: promoId,
    type: 'promo-code',
    box: { x: 0.1, y: 0.5, w: 0.8, h: 0.2, rotation: 0 },
    a11y: {},
    props: { code: 'SPRING26', ...props } as DeliveryTaleElement['props'],
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const copyButton = (node: HTMLElement) => node.querySelector<HTMLButtonElement>('.ta-promo-copy') as HTMLButtonElement;
const status = (node: HTMLElement) => node.querySelector('.ta-promo-status')?.textContent ?? '';

function mockClipboard(writeText: ReturnType<typeof vi.fn> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
}

describe('renderPromoCode', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('is the renderer of the promo-code type', () => {
    expect(ELEMENT_RENDERERS.get('promo-code')).toBe(renderPromoCode);
  });

  it('shows the code in a chip, its note and a Copy button, named by its title', () => {
    const node = renderPromoCode(promo({ title: 'Thank you', note: 'Once per visitor', theme: 'dark' }), {
      reducedMotion: false,
    }) as HTMLElement;
    expect(node.getAttribute('aria-label')).toBe('Thank you');
    expect(node.classList).toContain('ta-poll-dark');
    expect(node.querySelector('.ta-promo-chip')?.textContent).toBe('SPRING26');
    expect(node.querySelector('.ta-promo-note')?.textContent).toBe('Once per visitor');
    expect(copyButton(node).textContent).toBe('Copy');
    expect(copyButton(node).type).toBe('button');
    expect(status(node)).toBe('');
  });

  it.each([
    ['a space', 'SPRING 26'],
    ['an empty code', ''],
    ['an accented letter', 'CAFÉ'],
    ['a dot', 'A.B'],
    ['33 characters', 'a'.repeat(33)],
    ['markup', '<b>x</b>'],
  ])('draws nothing for a code with %s', (_name, code) => {
    expect(renderPromoCode(promo({ code }), { reducedMotion: false })).toBeNull();
  });

  it('accepts a code of letters, digits, underscores and hyphens up to 32 characters', () => {
    expect(renderPromoCode(promo({ code: 'a_9-Z'.repeat(6) + 'ab' }), { reducedMotion: false })).not.toBeNull();
    expect(renderPromoCode(promo({ code: 'x'.repeat(32) }), { reducedMotion: false })).not.toBeNull();
  });

  it('copies through the clipboard, says so and reports it with the code', async () => {
    const writeText = vi.fn(async () => undefined);
    mockClipboard(writeText);
    const onComponentEvent = vi.fn();
    const node = renderPromoCode(promo(), { reducedMotion: false, onComponentEvent }) as HTMLElement;
    copyButton(node).click();
    await flush();
    expect(writeText).toHaveBeenCalledWith('SPRING26');
    expect(status(node)).toBe('Copied');
    expect(onComponentEvent).toHaveBeenCalledWith({ component: 'promo-code', action: 'copied', value: 'SPRING26' });
  });

  it('falls back to the selection when the clipboard refuses, and says it could not copy when both refuse', async () => {
    mockClipboard(vi.fn(async () => Promise.reject(new Error('denied'))));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    const onComponentEvent = vi.fn();
    const node = renderPromoCode(promo(), { reducedMotion: false, onComponentEvent }) as HTMLElement;
    document.body.appendChild(node);
    copyButton(node).click();
    await flush();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(window.getSelection()?.toString()).toBe('SPRING26');
    expect(status(node)).toBe('Copied');
    expect(onComponentEvent).toHaveBeenCalledTimes(1);

    execCommand.mockReturnValue(false);
    copyButton(node).click();
    await flush();
    expect(status(node)).toBe('Could not copy. Select the code and copy it yourself.');
    expect(onComponentEvent).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('clears its toast four seconds after it said it', async () => {
    vi.useFakeTimers();
    try {
      mockClipboard(vi.fn(async () => undefined));
      const node = renderPromoCode(promo(), { reducedMotion: false }) as HTMLElement;
      copyButton(node).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(status(node)).toBe('Copied');
      await vi.advanceTimersByTimeAsync(3999);
      expect(status(node)).toBe('Copied');
      await vi.advanceTimersByTimeAsync(1);
      expect(status(node)).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the page strings for its button and status', async () => {
    mockClipboard(vi.fn(async () => undefined));
    const t = createTranslate('de', { de: { 'promo.copy': 'Kopieren', 'promo.copied': 'Kopiert' } });
    const node = renderPromoCode(promo(), { reducedMotion: false, t }) as HTMLElement;
    expect(copyButton(node).textContent).toBe('Kopieren');
    copyButton(node).click();
    await flush();
    expect(status(node)).toBe('Kopiert');
  });
});

describe('copyCode', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('is false when neither the clipboard nor the copy command is there', async () => {
    mockClipboard(undefined);
    const chip = document.createElement('span');
    chip.textContent = 'X1';
    expect(await copyCode('X1', chip)).toBe(false);
  });
});
