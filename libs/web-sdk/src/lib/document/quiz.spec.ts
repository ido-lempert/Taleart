import type { DeliveryTaleDocument, DeliveryTaleElement, DeliveryTaleGroup } from '@taleart/contract';
import { TaleViewer } from '../viewer';
import type { ResponseClient, StoredResponse } from '../responses';
import { renderQuiz } from './quiz';
import { ELEMENT_RENDERERS, renderTaleDocument } from './renderer';

// Epic interactive components story 4.3: the quiz renderer (R3, R10, C7, C9, C10, C11; AD-16).
const quizId = '00000000-0000-4000-8000-0000000000cc';
const answers = [
  { id: 'a', label: 'Mercury' },
  { id: 'b', label: 'Venus' },
  { id: 'c', label: 'Earth' },
  { id: 'd', label: 'Mars' },
];
function quiz(props: Record<string, unknown> = {}): DeliveryTaleElement {
  return {
    id: quizId,
    type: 'quiz',
    box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
    a11y: {},
    props: { question: 'Which planet is hottest?', theme: 'light', answers, correctAnswerId: 'b', ...props } as DeliveryTaleElement['props'],
  };
}

const result = (value: string): StoredResponse => ({
  value,
  result: {
    total: 4,
    choices: [
      { id: 'a', count: 0, percent: 0 },
      { id: 'b', count: 2, percent: 50 },
      { id: 'c', count: 1, percent: 25 },
      { id: 'd', count: 1, percent: 25 },
    ],
  },
});

function fakeClient(kept: StoredResponse | null = null, answer: (value: string) => Promise<StoredResponse> = async (v) => result(v)) {
  const send = vi.fn((_taleId: string, _elementId: string, value: string) => answer(value));
  const stored = vi.fn((_taleId: string, _elementId: string) => kept);
  return { client: { send, stored } satisfies ResponseClient, send, stored };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttons = (node: HTMLElement) => [...node.querySelectorAll<HTMLButtonElement>('button.ta-poll-opt')];
// What a screen reader reads for each button: its text without the hidden glyphs.
const names = (node: HTMLElement) =>
  buttons(node).map((b) =>
    [...b.querySelectorAll('span')]
      .filter((s) => s.getAttribute('aria-hidden') !== 'true')
      .map((s) => s.textContent)
      .join(''),
  );
const marks = (node: HTMLElement) =>
  buttons(node).map((b) => (b.classList.contains('ta-quiz-right') ? 'right' : b.classList.contains('ta-quiz-wrong') ? 'wrong' : '-'));
const live = (node: HTMLElement) => node.querySelector('[aria-live]')?.textContent;

describe('renderQuiz', () => {
  it('is the renderer of the quiz type', () => {
    expect(ELEMENT_RENDERERS.get('quiz')).toBe(renderQuiz);
  });

  it('renders a group named by its question, its title as text and one button per answer, nothing marked', () => {
    const node = renderQuiz(quiz({ title: 'Space', theme: 'dark' }), { reducedMotion: false }) as HTMLElement;
    expect(node.getAttribute('role')).toBe('group');
    expect(node.getAttribute('aria-label')).toBe('Which planet is hottest?');
    expect([...node.classList]).toEqual(expect.arrayContaining(['ta-interactive', 'ta-quiz', 'ta-poll-dark']));
    expect(node.querySelector('.ta-poll-title')?.textContent).toBe('Space');
    expect(buttons(node).map((b) => [b.type, b.textContent])).toEqual(answers.map((a) => ['button', a.label]));
    expect(marks(node)).toEqual(['-', '-', '-', '-']);
    expect(buttons(node).some((b) => b.hasAttribute('aria-pressed'))).toBe(false);
  });

  it('shows markup in its text as literal text (AD-16)', () => {
    const node = renderQuiz(quiz({ answers: [{ id: 'a', label: '<b>x</b>' }, answers[1]] }), { reducedMotion: false }) as HTMLElement;
    expect(node.querySelector('b')).toBeNull();
    expect(buttons(node)[0].textContent).toBe('<b>x</b>');
  });

  it('renders nothing for props it cannot draw', () => {
    expect(renderQuiz(quiz({ question: '' }), { reducedMotion: false })).toBeNull();
    expect(renderQuiz(quiz({ answers: [answers[0]] }), { reducedMotion: false })).toBeNull();
    expect(renderQuiz(quiz({ answers: [...answers, { id: 'e', label: 'Jupiter' }] }), { reducedMotion: false })).toBeNull();
    expect(renderQuiz(quiz({ answers: [answers[0], { id: 'a', label: 'Again' }] }), { reducedMotion: false })).toBeNull();
    expect(renderQuiz(quiz({ answers: [answers[0], { id: 'b', label: ' ' }] }), { reducedMotion: false })).toBeNull();
  });

  it('a wrong answer: marks it wrong and the correct one right, shows the percentages and says so', async () => {
    const { client, send } = fakeClient();
    const node = renderQuiz(quiz(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[2].click();
    expect(send).toHaveBeenCalledWith('t1', quizId, 'c');
    await flush();
    expect(marks(node)).toEqual(['-', 'right', 'wrong', '-']);
    expect(buttons(node).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false']);
    expect(buttons(node).map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true', 'true']);
    expect(buttons(node).map((b) => b.textContent)).toEqual([
      'Mercury0%',
      'Venus✓ correct answer50%',
      'Earth✗ wrong25%',
      'Mars25%',
    ]);
    // The glyphs are hidden from screen readers; the words name the marks (not colour alone).
    expect(names(node)).toEqual(['Mercury0%', 'Venus correct answer50%', 'Earth wrong25%', 'Mars25%']);
    expect((buttons(node)[1].querySelector('.ta-poll-fill') as HTMLElement).style.width).toBe('50%');
    expect(live(node)).toBe(
      'Wrong: you answered Earth. The correct answer is Venus. Mercury 0%, Venus 50%, Earth 25%, Mars 25%',
    );
    buttons(node)[1].click();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a right answer: marks only it, and says it was right', async () => {
    const { client } = fakeClient();
    const node = renderQuiz(quiz(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[1].click();
    await flush();
    expect(marks(node)).toEqual(['-', 'right', '-', '-']);
    expect(live(node)).toBe('Right! You answered Venus. Mercury 0%, Venus 50%, Earth 25%, Mars 25%');
  });

  it('a quiz without a correct answer shows only the percentages', async () => {
    const { client } = fakeClient();
    const node = renderQuiz(quiz({ correctAnswerId: undefined }), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[2].click();
    await flush();
    expect(marks(node)).toEqual(['-', '-', '-', '-']);
    expect(node.querySelector('.ta-quiz-mark')).toBeNull();
    expect(buttons(node).map((b) => b.textContent)).toEqual(['Mercury0%', 'Venus50%', 'Earth25%', 'Mars25%']);
    expect(live(node)).toBe('You answered Earth. Mercury 0%, Venus 50%, Earth 25%, Mars 25%');
  });

  it('reads a correct answer id that is none of its answers as none', async () => {
    const { client } = fakeClient();
    const node = renderQuiz(quiz({ correctAnswerId: 'z' }), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[0].click();
    await flush();
    expect(marks(node)).toEqual(['-', '-', '-', '-']);
  });

  it("shows the server's stored answer when it differs from the press (C9), marked against it", async () => {
    const { client } = fakeClient(null, async () => result('d'));
    const node = renderQuiz(quiz(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[1].click();
    await flush();
    expect(buttons(node).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true']);
    expect(marks(node)).toEqual(['-', 'right', '-', 'wrong']);
  });

  it('shows an answer this device kept at once, marked, without posting again (C11)', () => {
    const { client, send } = fakeClient(result('c'));
    const node = renderQuiz(quiz(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    expect(marks(node)).toEqual(['-', 'right', 'wrong', '-']);
    expect(buttons(node)[2].getAttribute('aria-pressed')).toBe('true');
    expect(buttons(node).filter((b) => b.querySelectorAll('.ta-quiz-mark').length > 1)).toEqual([]);
    buttons(node)[1].click();
    expect(send).not.toHaveBeenCalled();
  });

  it('says when the answer could not be sent and lets the visitor try again', async () => {
    let fail = true;
    const { client, send } = fakeClient(null, async (v) => {
      if (fail) throw new Error('offline');
      return result(v);
    });
    const node = renderQuiz(quiz(), { reducedMotion: false, responses: { client, taleId: 't1' } }) as HTMLElement;
    buttons(node)[0].click();
    await flush();
    expect(live(node)).toBe('Your answer could not be sent. Try again.');
    expect(marks(node)).toEqual(['-', '-', '-', '-']);
    fail = false;
    buttons(node)[0].click();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(marks(node)).toEqual(['wrong', 'right', '-', '-']);
  });

  it('marks the answer in the Tale Studio preview and records nothing', () => {
    const node = renderTaleDocument(
      { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [quiz()] },
      { inertLinks: true },
    );
    const [mercury] = buttons(node);
    mercury.click();
    expect(mercury.getAttribute('aria-pressed')).toBe('true');
    expect(mercury.querySelector('.ta-poll-pct')).toBeNull();
    expect(marks(node)).toEqual(['wrong', 'right', '-', '-']);
    expect(node.querySelector('.ta-quiz [aria-live]')?.textContent).toBe(
      'Wrong: you answered Mercury. The correct answer is Venus. Answers are not recorded in the preview.',
    );
  });
});

describe('TaleViewer with a quiz (C7)', () => {
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
  const answer = (i: number) => dialog().querySelectorAll<HTMLButtonElement>('.ta-quiz button.ta-poll-opt')[i];
  const space = (target: Element) => {
    const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };

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
          { id: 't1', title: 'One', media: null, document: doc([quiz()]) },
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

  it('passes the tale being shown to the quiz, and a press on an answer does not step', () => {
    answer(2).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(fake.send).toHaveBeenCalledWith('t1', quizId, 'c');
    expect(position()).toBe('1');
  });

  it('pauses while focus is inside the quiz; Space presses an answer, and pauses again once answered', async () => {
    answer(2).focus();
    expect(dialog().hasAttribute('data-paused')).toBe(true);
    expect(space(answer(2)).defaultPrevented).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(position()).toBe('1');
    answer(2).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(answer(2).getAttribute('aria-disabled')).toBe('true');
    // Answered: Space on an answer goes back to the viewer, as on any other part of the tale.
    expect(space(answer(2)).defaultPrevented).toBe(true);
    expect(fake.send).toHaveBeenCalledTimes(1);
  });
});
