import type { DeliveryTaleElement } from '@taleart/contract';
import type { ResponseClient, StoredResponse } from '../responses';
import { createTranslate } from '../i18n';
import { REACTION_STYLES, reactionsOf, renderReaction } from './reaction';
import { ELEMENT_RENDERERS, renderTaleDocument } from './renderer';

// Components (2026-10-29): the reaction renderer. It follows the poll's contract: taps are posted through
// the response client, counts show after the tap, a tap this device kept shows at once, and failures are
// said in words.
const reactionId = '00000000-0000-4000-8000-0000000000ee';
const emojis = ['❤️', '😂', '😮'];

function reaction(props: Record<string, unknown> = {}): DeliveryTaleElement {
  return {
    id: reactionId,
    type: 'reaction',
    box: { x: 0.1, y: 0.4, w: 0.8, h: 0.3, rotation: 0 },
    a11y: {},
    props: { question: 'How was it?', emojis, theme: 'light', ...props } as DeliveryTaleElement['props'],
  };
}

const tapped: StoredResponse = {
  value: '😂',
  result: {
    total: 3,
    reactions: [
      { emoji: '❤️', count: 1 },
      { emoji: '😂', count: 2 },
      { emoji: '😮', count: 0 },
    ],
  },
};

function fakeClient(kept: StoredResponse | null = null, answer: () => Promise<StoredResponse> = async () => tapped) {
  const send = vi.fn<ResponseClient['send']>(() => answer());
  const stored = vi.fn<ResponseClient['stored']>(() => kept);
  return { client: { send, stored } satisfies ResponseClient, send, stored };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttons = (node: HTMLElement) => [...node.querySelectorAll<HTMLButtonElement>('button.ta-reaction-btn')];
const live = (node: HTMLElement) => node.querySelector('[aria-live]')?.textContent;

describe('renderReaction', () => {
  it('is the renderer of the reaction type and has styles', () => {
    expect(ELEMENT_RENDERERS.get('reaction')).toBe(renderReaction);
    expect(REACTION_STYLES).toContain('.ta-reaction-btn');
  });

  it('renders a group named by its question, the title and question as text and one button per emoji', () => {
    const node = renderReaction(reaction({ title: 'Your mood' }), { reducedMotion: false }) as HTMLElement;
    expect(node.getAttribute('role')).toBe('group');
    expect(node.getAttribute('aria-label')).toBe('How was it?');
    expect(node.classList).toContain('ta-interactive');
    expect(node.classList).toContain('ta-reaction-light');
    expect(node.querySelector('.ta-reaction-title')?.textContent).toBe('Your mood');
    expect(node.querySelector('.ta-reaction-q')?.textContent).toBe('How was it?');
    expect(buttons(node).map((b) => [b.type, b.getAttribute('aria-pressed'), b.getAttribute('aria-label')])).toEqual([
      ['button', 'false', '❤️'],
      ['button', 'false', '😂'],
      ['button', 'false', '😮'],
    ]);
    expect(buttons(node).map((b) => b.querySelector('.ta-reaction-count')?.textContent)).toEqual(['', '', '']);
    expect(node.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(renderReaction(reaction({ theme: 'dark' }), { reducedMotion: false })?.classList).toContain('ta-reaction-dark');
  });

  it('shows markup in its question as literal text (AD-16)', () => {
    const node = renderReaction(reaction({ question: '<img src=x onerror=alert(1)>' }), { reducedMotion: false }) as HTMLElement;
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('.ta-reaction-q')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('renders nothing for props it cannot draw', () => {
    const context = { reducedMotion: false };
    expect(renderReaction(reaction({ question: ' ' }), context)).toBeNull();
    expect(renderReaction(reaction({ emojis: ['❤️'] }), context)).toBeNull();
    expect(renderReaction(reaction({ emojis: ['❤️', '❤️'] }), context)).toBeNull();
    expect(renderReaction(reaction({ emojis: ['❤️', 3] }), context)).toBeNull();
    expect(renderReaction(reaction({ emojis: ['👍', '👎', '🤔', '🔥', '🎉', '👏', '😮'] }), context)).toBeNull();
    expect(renderReaction(reaction({ emojis: undefined }), context)).toBeNull();
  });

  it('posts a tap, then presses it, shows each count, announces them and takes no second tap', async () => {
    const { client, send } = fakeClient();
    const node = renderReaction(reaction(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const [heart, laugh, wow] = buttons(node);
    laugh.click();
    expect(send).toHaveBeenCalledWith('t1', reactionId, '😂');
    expect(node.getAttribute('aria-busy')).toBe('true');
    await flush();
    expect(node.hasAttribute('aria-busy')).toBe(false);
    expect([heart, laugh, wow].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect([heart, laugh, wow].map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true']);
    expect([heart, laugh, wow].map((b) => b.querySelector('.ta-reaction-count')?.textContent)).toEqual(['1', '2', '0']);
    expect(laugh.getAttribute('aria-label')).toBe('😂, Reactions: 2');
    expect(live(node)).toBe('❤️ Reactions: 1, 😂 Reactions: 2, 😮 Reactions: 0');
    heart.click();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows the server's stored value when it differs from the tap (C9)", async () => {
    const { client } = fakeClient(null, async () => ({ ...tapped, value: '❤️' }));
    const node = renderReaction(reaction(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[1].click();
    await flush();
    expect(buttons(node).map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('shows a tap this device kept at once, without posting again (C11)', () => {
    const { client, send, stored } = fakeClient(tapped);
    const node = renderReaction(reaction(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    expect(stored).toHaveBeenCalledWith('t1', reactionId);
    expect(buttons(node).map((b) => b.querySelector('.ta-reaction-count')?.textContent)).toEqual(['1', '2', '0']);
    buttons(node)[1].click();
    expect(send).not.toHaveBeenCalled();
  });

  it('says when the tap could not be sent and lets the visitor try again', async () => {
    let fail = true;
    const { client, send } = fakeClient(null, async () => {
      if (fail) throw new Error('offline');
      return tapped;
    });
    const node = renderReaction(reaction(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[0].click();
    await flush();
    expect(live(node)).toBe('Your reaction could not be sent. Try again.');
    expect(buttons(node)[0].getAttribute('aria-pressed')).toBe('false');
    fail = false;
    buttons(node)[1].click();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(buttons(node)[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('marks a tap and records nothing without a response client (the Tale Studio preview)', () => {
    const node = renderReaction(reaction(), { reducedMotion: false }) as HTMLElement;
    const [heart] = buttons(node);
    heart.click();
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(heart.querySelector('.ta-reaction-count')?.textContent).toBe('');
  });

  it('takes its words from the page locale', () => {
    const t = createTranslate('he', { he: { 'reaction.count': '{count} תגובות', 'reaction.failed': 'לא נשלח' } });
    const { client } = fakeClient(tapped);
    const node = renderReaction(reaction(), { reducedMotion: false, t, responses: { client, taleId: 't1' } }) as HTMLElement;
    expect(buttons(node)[1].getAttribute('aria-label')).toBe('😂, 2 תגובות');
  });

  it('is drawn inside a whole tale document, and its emoji are text nodes', () => {
    const doc = { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [reaction({ emojis: ['<b>x</b>', '👍'] })] };
    const node = renderTaleDocument(doc as never, { inertLinks: true });
    expect(node.querySelector('b')).toBeNull();
    expect(node.querySelector('.ta-reaction-emoji')?.textContent).toBe('<b>x</b>');
  });
});

describe('reactionsOf', () => {
  it('takes two to six distinct emoji of the length the server allows', () => {
    expect(reactionsOf({ emojis: ['👍', '👎'] })).toEqual(['👍', '👎']);
    expect(reactionsOf({ emojis: ['1', '2', '3', '4', '5', '6'] })).toHaveLength(6);
    expect(reactionsOf({ emojis: ['👍', ''] })).toBeNull();
    expect(reactionsOf({ emojis: ['👍', 'x'.repeat(65)] })).toBeNull();
  });
});
