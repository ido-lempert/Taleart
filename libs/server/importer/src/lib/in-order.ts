/**
 * Applies effects in the order they are added, while the work they wait for
 * runs concurrently (importer story 10). The import adds its report writes
 * (differences, notes, the difference budget) in reading order; a tale's
 * media outcome is an effect that waits for its copy. So the report is the
 * one a run without concurrency writes, while the copies overlap.
 *
 * An effect added while nothing waits runs at once, and so does one added from
 * inside a running effect (it belongs to that effect's place). As soon as a
 * work fails, whatever its place, no effect runs any more: the failure is
 * kept, `onFailure` is called once (the import stops its other work), and
 * `check`, `room` and `drain` throw it.
 */
export class InOrder {
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;
  private inEffect = false;
  private failed = false;
  private failure: unknown = undefined;
  private readonly settledWaiters: (() => void)[] = [];
  private readonly works = new Set<Promise<unknown>>();

  constructor(private readonly onFailure: (err: unknown) => void = () => undefined) {}

  /** How many effects wait for their turn. */
  get pending(): number {
    return this.waiting;
  }

  /** Runs `effect` now when nothing waits ahead of it, else after the effects added before it. */
  run(effect: () => void): void {
    if (this.inEffect || (this.waiting === 0 && !this.failed)) {
      // In its place already: a failure is the caller's to handle, as without this class.
      this.applyNow(effect);
      return;
    }
    this.chain(Promise.resolve(undefined), () => effect());
  }

  /** Runs `effect` with `work`'s value once `work` settles and every effect added before it ran. */
  after<T>(work: Promise<T>, effect: (value: T) => void): void {
    this.works.add(work);
    const forget = () => this.works.delete(work);
    work.then(forget, (err: unknown) => {
      forget();
      this.fail(err);
    });
    this.chain(work, effect);
  }

  /** Waits until at most `max` effects wait; throws the failure once a work failed. */
  async room(max: number): Promise<void> {
    this.check();
    while (this.waiting > max) {
      await new Promise<void>((resolve) => this.settledWaiters.push(resolve));
      this.check();
    }
  }

  /** Throws the failure once a work failed. */
  check(): void {
    if (this.failed) throw this.failure;
  }

  /** Waits for every effect added so far; throws the failure once a work failed. */
  async drain(): Promise<void> {
    await this.tail.catch(() => undefined);
    this.check();
  }

  /** Waits for every work still running, whether it succeeds or fails, and applies nothing more. */
  async settle(): Promise<void> {
    this.fail(new Error('The import stopped'));
    await Promise.allSettled([...this.works]);
    await this.tail.catch(() => undefined);
  }

  private chain<T>(work: Promise<T>, effect: (value: T) => void): void {
    this.waiting++;
    const step = this.tail.then(async () => {
      try {
        const value = await work;
        if (this.failed) return;
        this.applyNow(() => effect(value));
      } catch (err) {
        this.fail(err);
      } finally {
        this.waiting--;
        this.settledWaiters.splice(0).forEach((resolve) => resolve());
      }
    });
    this.tail = step;
  }

  // Keeps the first failure and calls onFailure for it.
  private fail(err: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.failure = err;
    this.settledWaiters.splice(0).forEach((resolve) => resolve());
    this.onFailure(err);
  }

  private applyNow(effect: () => void): void {
    const outer = this.inEffect;
    this.inEffect = true;
    try {
      effect();
    } finally {
      this.inEffect = outer;
    }
  }
}
