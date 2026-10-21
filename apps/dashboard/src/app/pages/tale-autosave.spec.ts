import type { TaleDocument } from '@taleart/contract';
import type { TaleDocumentResult } from '../tale-document.service';
import { isRetryable, TaleAutosaver, type AutosaveState, type AutosaveTiming } from './tale-autosave';

const timing: AutosaveTiming = { debounceMs: 1000, maxWaitMs: 5000, retryDelaysMs: [2000, 4000] };

function doc(n: number): TaleDocument {
  return {
    version: 1,
    canvas: { background: { type: 'color', color: `#${String(n).padStart(6, '0')}` } },
    elements: [],
  };
}

const ok = (revision: number): TaleDocumentResult => ({
  value: { document: null, revision, published: { document: null, revision: 0 } },
  message: '',
  stale: false,
  code: '',
  pointer: '',
  status: 200,
});
const failed = (status: number, code = ''): TaleDocumentResult => ({
  value: null,
  message: `failed ${status}`,
  stale: code === 'stale_revision',
  code,
  pointer: '',
  status,
});

// A save the test answers by hand: each call waits until `answer` is called.
function harness(start = doc(0), revision = 0) {
  const calls: { document: TaleDocument; revision: number; answer: (r: TaleDocumentResult) => void }[] = [];
  const states: AutosaveState['kind'][] = [];
  const send = vi.fn(
    (document: TaleDocument, rev: number) =>
      new Promise<TaleDocumentResult>((resolve) => calls.push({ document, revision: rev, answer: resolve })),
  );
  const saver = new TaleAutosaver(start, revision, send, (s) => states.push(s.kind), timing);
  return { saver, send, calls, states, last: () => states.at(-1) };
}

// Lets answered saves settle.
const flushPromises = () => vi.advanceTimersByTimeAsync(0);

describe('TaleAutosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces changes into one save of the latest document, then reads saved', async () => {
    const { saver, send, calls, last } = harness();
    saver.changed(doc(1));
    await vi.advanceTimersByTimeAsync(500);
    saver.changed(doc(2));
    await vi.advanceTimersByTimeAsync(500);
    const latest = doc(3);
    saver.changed(latest);
    expect(last()).toBe('pending');
    expect(saver.unsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls[0].document).toBe(latest);
    expect(calls[0].revision).toBe(0);
    expect(last()).toBe('saving');
    calls[0].answer(ok(1));
    await flushPromises();
    expect(last()).toBe('saved');
    expect(saver.unsaved).toBe(false);
  });

  it('saves within the longest wait while changes keep coming', async () => {
    const { saver, send } = harness();
    for (let i = 1; i <= 12; i++) {
      saver.changed(doc(i));
      await vi.advanceTimersByTimeAsync(450);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never sends two saves at once: edits made meanwhile go out in one next save, on the new revision', async () => {
    const { saver, send, calls, last } = harness(doc(0), 4);
    saver.changed(doc(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    saver.changed(doc(2));
    await vi.advanceTimersByTimeAsync(1000);
    const latest = doc(3);
    saver.changed(latest);
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(last()).toBe('saving');
    calls[0].answer(ok(5));
    await flushPromises();
    expect(send).toHaveBeenCalledTimes(2);
    expect(calls[1]).toMatchObject({ document: latest, revision: 5 });
    calls[1].answer(ok(6));
    await flushPromises();
    expect(last()).toBe('saved');
  });

  it('needs no save when undone back to the saved document', async () => {
    const start = doc(0);
    const { saver, send, last } = harness(start);
    saver.changed(doc(1));
    saver.changed(start);
    expect(last()).toBe('saved');
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).not.toHaveBeenCalled();
  });

  it('retries a save that failed on the network with growing waits, sending the latest document', async () => {
    const { saver, send, calls, last } = harness();
    saver.changed(doc(1));
    await vi.advanceTimersByTimeAsync(1000);
    calls[0].answer(failed(0));
    await flushPromises();
    expect(last()).toBe('retrying');
    expect(saver.state).toMatchObject({ kind: 'retrying', retryAt: expect.any(Number) });
    // Changes while retrying wait for the retry.
    const latest = doc(2);
    saver.changed(latest);
    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(calls[1].document).toBe(latest);
    calls[1].answer(failed(503));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    calls[2].answer(failed(502));
    await flushPromises();
    // The last wait repeats.
    await vi.advanceTimersByTimeAsync(4000);
    expect(send).toHaveBeenCalledTimes(4);
    calls[3].answer(ok(1));
    await flushPromises();
    expect(last()).toBe('saved');
  });

  it('retries at once when the browser is back online, or when asked', async () => {
    const { saver, send, calls } = harness();
    saver.changed(doc(1));
    await vi.advanceTimersByTimeAsync(1000);
    calls[0].answer(failed(0));
    await flushPromises();
    saver.online();
    expect(send).toHaveBeenCalledTimes(2);
    calls[1].answer(failed(0));
    await flushPromises();
    saver.retryNow();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not retry a refused save by itself, but does after the next change or when asked', async () => {
    const { saver, send, calls, last } = harness();
    const bad = doc(1);
    saver.changed(bad);
    await vi.advanceTimersByTimeAsync(1000);
    calls[0].answer(failed(400, 'invalid_tale_document'));
    await flushPromises();
    expect(last()).toBe('refused');
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(1);
    saver.retryNow();
    expect(send).toHaveBeenCalledTimes(2);
    calls[1].answer(failed(400, 'invalid_tale_document'));
    await flushPromises();
    saver.changed(doc(2));
    expect(last()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stops after a stale refusal, keeping the edits, until reset', async () => {
    const { saver, send, calls, last } = harness();
    saver.changed(doc(1));
    await vi.advanceTimersByTimeAsync(1000);
    calls[0].answer(failed(409, 'stale_revision'));
    await flushPromises();
    expect(last()).toBe('conflict');
    saver.changed(doc(2));
    saver.retryNow();
    saver.online();
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(last()).toBe('conflict');
    expect(saver.unsaved).toBe(true);
    expect(await saver.flush()).toBe(false);

    saver.reset(doc(9), 7);
    expect(last()).toBe('saved');
    saver.changed(doc(10));
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls[1].revision).toBe(7);
  });

  it('ignores the answer to a save sent before a reset, and still sends one save at a time', async () => {
    const { saver, send, calls, last } = harness();
    saver.changed(doc(1));
    await vi.advanceTimersByTimeAsync(1000);
    saver.reset(doc(5), 3);
    saver.changed(doc(6));
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    calls[0].answer(failed(409, 'stale_revision'));
    await flushPromises();
    expect(send).toHaveBeenCalledTimes(2);
    expect(calls[1].revision).toBe(3);
    calls[1].answer(ok(4));
    await flushPromises();
    expect(last()).toBe('saved');
  });

  it('flushes for leaving: saves at once and says whether everything is saved', async () => {
    const { saver, send, calls } = harness();
    saver.changed(doc(1));
    const leaving = saver.flush();
    expect(send).toHaveBeenCalledTimes(1);
    calls[0].answer(ok(1));
    expect(await leaving).toBe(true);
    expect(await saver.flush()).toBe(true);

    saver.changed(doc(2));
    const failing = saver.flush();
    calls[1].answer(failed(0));
    expect(await failing).toBe(false);
  });

  it('tells the saved revision, and stops on a conflict found elsewhere (such as on publishing)', async () => {
    const { saver, send, calls, last } = harness(doc(0), 3);
    expect(saver.savedRevision).toBe(3);
    saver.changed(doc(1));
    await vi.advanceTimersByTimeAsync(1000);
    calls[0].answer(ok(4));
    await flushPromises();
    expect(saver.savedRevision).toBe(4);
    saver.changed(doc(2));
    saver.conflict({ value: null, message: 'stale', stale: true, code: 'stale_revision', pointer: '', status: 409 });
    expect(last()).toBe('conflict');
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps a refused document refused when the content comes back to it, and flush does not resend it', async () => {
    const { saver, send, calls, last } = harness();
    const bad = doc(1);
    saver.changed(bad);
    await vi.advanceTimersByTimeAsync(1000);
    calls[0].answer(failed(400, 'invalid_tale_document'));
    await flushPromises();
    saver.changed(doc(2));
    expect(last()).toBe('pending');
    // Undone back to the refused document: refused again, with its reason, and not sent.
    saver.changed(bad);
    expect(saver.state).toMatchObject({ kind: 'refused', failure: { code: 'invalid_tale_document' } });
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await saver.flush()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while paused, keeping changes, and saves them on resume on the same revision', async () => {
    const { saver, send, calls, last } = harness(doc(0), 6);
    saver.pause();
    const kept = doc(1);
    saver.changed(kept);
    expect(last()).toBe('pending');
    saver.retryNow();
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).not.toHaveBeenCalled();
    saver.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls[0]).toMatchObject({ document: kept, revision: 6 });
  });

  it('stops its timers when disposed', async () => {
    const { saver, send } = harness();
    saver.changed(doc(1));
    saver.dispose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).not.toHaveBeenCalled();
  });

  it('retries only failures that may pass by themselves', () => {
    expect([0, 408, 429, 500, 503].every(isRetryable)).toBe(true);
    expect([400, 401, 403, 404, 409, 413].some(isRetryable)).toBe(false);
  });
});
