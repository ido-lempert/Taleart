import { runLimited } from './bulk-run';

describe('runLimited', () => {
  it('runs at most the limit at a time and reports each finished item', async () => {
    let inFlight = 0;
    let most = 0;
    const progress: number[] = [];
    const outcome = await runLimited(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return '';
      },
      (done) => progress.push(done),
    );
    expect(most).toBe(3);
    expect(outcome.succeeded).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(outcome.failed).toEqual([]);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('sorts successes and failures, keeping the list order and each message', async () => {
    const outcome = await runLimited(['a', 'b', 'c', 'd'], 2, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item === 'a' ? 5 : 0));
      return item === 'b' ? 'Nope' : item === 'd' ? 'Also nope' : '';
    });
    expect(outcome.succeeded).toEqual(['a', 'c']);
    expect(outcome.failed).toEqual([
      { item: 'b', message: 'Nope' },
      { item: 'd', message: 'Also nope' },
    ]);
  });

  it('counts a thrown error as a failure and carries on with the rest', async () => {
    const outcome = await runLimited([1, 2], 3, async (item) => {
      if (item === 1) throw new Error('boom');
      return '';
    });
    expect(outcome.succeeded).toEqual([2]);
    expect(outcome.failed).toEqual([{ item: 1, message: 'The request failed. Try again.' }]);
  });

  it('resolves at once for no items', async () => {
    const run = vi.fn(async () => '');
    expect(await runLimited([], 3, run)).toEqual({ succeeded: [], failed: [] });
    expect(run).not.toHaveBeenCalled();
  });
});
