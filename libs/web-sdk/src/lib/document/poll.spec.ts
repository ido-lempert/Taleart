import type { DeliveryTaleDocument, DeliveryTaleElement, DeliveryTaleGroup } from '@taleart/contract';
import { TaleViewer } from '../viewer';
import type { ResponseClient, StoredResponse } from '../responses';
import { renderPoll, resultMessage } from './poll';
import { ELEMENT_RENDERERS, renderTaleDocument } from './renderer';

// Epic interactive components story 4.1: the poll renderer (R2, R10, C7, C9, C11; AD-16).
const pollId = '00000000-0000-4000-8000-0000000000aa';
const options = [
  { id: 'tea', label: 'Tea' },
  { id: 'coffee', label: 'Coffee' },
];
function poll(props: Record<string, unknown> = {}): DeliveryTaleElement {
  return {
    id: pollId,
    type: 'poll',
    box: { x: 0.1, y: 0.4, w: 0.8, h: 0.3, rotation: 0 },
    a11y: {},
    props: { question: 'Tea or coffee?', theme: 'light', options, ...props } as DeliveryTaleElement['props'],
  };
}

const voted: StoredResponse = {
  value: 'tea',
  result: {
    total: 3,
    choices: [
      { id: 'tea', count: 2, percent: 67 },
      { id: 'coffee', count: 1, percent: 33 },
    ],
  },
};

function fakeClient(kept: StoredResponse | null = null, answer: () => Promise<StoredResponse> = async () => voted) {
  const send = vi.fn((_taleId: string, _elementId: string, _value: string) => answer());
  const stored = vi.fn((_taleId: string, _elementId: string) => kept);
  return { client: { send, stored } satisfies ResponseClient, send, stored };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttons = (node: HTMLElement) => [...node.querySelectorAll<HTMLButtonElement>('button.ta-poll-opt')];

describe('renderPoll', () => {
  it('is the renderer of the poll type', () => {
    expect(ELEMENT_RENDERERS.get('poll')).toBe(renderPoll);
  });

  it('renders a group named by its question, its title and question as text and one button per option', () => {
    const node = renderPoll(poll({ title: 'Morning' }), { reducedMotion: false }) as HTMLElement;
    expect(node.getAttribute('role')).toBe('group');
    expect(node.getAttribute('aria-label')).toBe('Tea or coffee?');
    expect(node.classList).toContain('ta-interactive');
    expect(node.classList).toContain('ta-poll-light');
    expect(node.querySelector('.ta-poll-title')?.textContent).toBe('Morning');
    expect(node.querySelector('.ta-poll-q')?.textContent).toBe('Tea or coffee?');
    expect(buttons(node).map((b) => [b.type, b.textContent])).toEqual([
      ['button', 'Tea'],
      ['button', 'Coffee'],
    ]);
    expect(node.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(renderPoll(poll({ theme: 'dark' }), { reducedMotion: false })?.classList).toContain('ta-poll-dark');
  });

  it('shows markup in its text as literal text (AD-16)', () => {
    const node = renderPoll(poll({ question: '<img src=x onerror=alert(1)>' }), { reducedMotion: false }) as HTMLElement;
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('.ta-poll-q')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('renders nothing for props it cannot draw', () => {
    expect(renderPoll(poll({ question: ' ' }), { reducedMotion: false })).toBeNull();
    expect(renderPoll(poll({ options: [options[0]] }), { reducedMotion: false })).toBeNull();
    expect(renderPoll(poll({ options: [options[0], { id: 'x' }] }), { reducedMotion: false })).toBeNull();
  });

  it('posts a vote, then marks the choice, shows the percentages, announces them and takes no second vote', async () => {
    const { client, send } = fakeClient();
    const node = renderPoll(poll(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    const [tea, coffee] = buttons(node);
    tea.click();
    expect(send).toHaveBeenCalledWith('t1', pollId, 'tea');
    expect(node.getAttribute('aria-busy')).toBe('true');
    await flush();
    expect(node.hasAttribute('aria-busy')).toBe(false);
    expect(tea.getAttribute('aria-pressed')).toBe('true');
    expect(coffee.getAttribute('aria-pressed')).toBe('false');
    expect(tea.classList).toContain('ta-poll-mine');
    expect([tea, coffee].map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    expect([tea, coffee].map((b) => b.textContent)).toEqual(['Tea67%', 'Coffee33%']);
    expect((tea.querySelector('.ta-poll-fill') as HTMLElement).style.width).toBe('67%');
    expect(node.querySelector('[aria-live]')?.textContent).toBe('You voted Tea. Tea 67%, Coffee 33%');
    coffee.click();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows the server's stored vote when it differs from the press (C9)", async () => {
    const { client } = fakeClient(null, async () => voted);
    const node = renderPoll(poll(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[1].click();
    await flush();
    expect(buttons(node).map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('shows a vote this device kept at once, without posting again (C11)', () => {
    const { client, send, stored } = fakeClient(voted);
    const node = renderPoll(poll(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    expect(stored).toHaveBeenCalledWith('t1', pollId);
    expect(buttons(node).map((b) => b.textContent)).toEqual(['Tea67%', 'Coffee33%']);
    buttons(node)[1].click();
    expect(send).not.toHaveBeenCalled();
  });

  it('says when the vote could not be sent and lets the visitor try again', async () => {
    let fail = true;
    const { client, send } = fakeClient(null, async () => {
      if (fail) throw new Error('offline');
      return voted;
    });
    const node = renderPoll(poll(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[0].click();
    await flush();
    expect(node.querySelector('[aria-live]')?.textContent).toBe('Your vote could not be sent. Try again.');
    expect(buttons(node)[0].hasAttribute('aria-pressed')).toBe(false);
    fail = false;
    buttons(node)[0].click();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(buttons(node)[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('records nothing without a response client (the Tale Studio preview)', () => {
    const node = renderTaleDocument(
      { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [poll()] },
      { inertLinks: true },
    );
    const [tea] = buttons(node);
    tea.click();
    expect(tea.getAttribute('aria-pressed')).toBe('true');
    expect(tea.querySelector('.ta-poll-pct')).toBeNull();
    expect(node.querySelector('.ta-poll [aria-live]')?.textContent).toBe(
      'You chose Tea. Votes are not recorded in the preview.',
    );
  });

  it('words the result for the live region', () => {
    expect(resultMessage(options, { value: 'gone', result: voted.result })).toBe('Tea 67%, Coffee 33%');
  });
});

describe('TaleViewer with a poll (C7)', () => {
  const doc = (elements: DeliveryTaleElement[]): DeliveryTaleDocument => ({
    version: 1,
    canvas: { background: { type: 'color', color: '#112233' } },
    elements,
  });
  let host: HTMLElement;
  let viewer: TaleViewer;
  let fake: ReturnType<typeof fakeClient>;
  const dialog = () => host.querySelector('dialog') as HTMLDialogElement;
  const position = () => `${dialog().querySelectorAll('.segment.done').length + 1}`;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    fake = fakeClient();
    const groups: DeliveryTaleGroup[] = [
      {
        id: 'g',
        name: 'G',
        cover: null,
        tales: [
          { id: 't1', title: 'One', media: null, document: doc([poll()]) },
          { id: 't2', title: 'Two', media: null, document: doc([]) },
        ],
      },
    ];
    viewer = new TaleViewer(host, groups, { responses: fake.client });
    viewer.open('g');
  });

  afterEach(() => {
    viewer.close();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('passes the tale being shown to the poll, and a press on an option does not step', () => {
    const tea = dialog().querySelector('button.ta-poll-opt') as HTMLButtonElement;
    expect(tea.closest('.stage')).toBeNull();
    tea.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(fake.send).toHaveBeenCalledWith('t1', pollId, 'tea');
    expect(position()).toBe('1');
  });

  it('pauses while focus is inside the poll, and Space presses the option rather than pausing', () => {
    const tea = dialog().querySelector('button.ta-poll-opt') as HTMLButtonElement;
    tea.focus();
    expect(dialog().hasAttribute('data-paused')).toBe(true);
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    tea.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    // The tale does not move on while the poll has focus.
    vi.advanceTimersByTime(20_000);
    expect(position()).toBe('1');
    tea.blur();
    expect(dialog().hasAttribute('data-paused')).toBe(false);
  });

  it('gives Space back to the viewer once voted (story 4.3), as the Rating does', async () => {
    const tea = dialog().querySelector('button.ta-poll-opt') as HTMLButtonElement;
    tea.focus();
    tea.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(tea.getAttribute('aria-disabled')).toBe('true');
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    tea.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(fake.send).toHaveBeenCalledTimes(1);
  });
});
