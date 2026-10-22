// Tale Studio's autosave (epic Tale Studio R9): saves the document a while after the last change,
// one save at a time, and keeps trying through network trouble, so no edit is lost silently.
import { InjectionToken } from '@angular/core';
import type { TaleDocument } from '@taleart/contract/tale-document';
import type { TaleDocumentFailure, TaleDocumentResult } from '../tale-document.service';

/** When autosave saves and retries. */
export interface AutosaveTiming {
  /** How long after the last change a save starts (ms). */
  debounceMs: number;
  /** The longest that changes wait while editing goes on (ms), so a long burst of typing is saved too. */
  maxWaitMs: number;
  /** The waits before each retry of a save that failed on the network or the server (ms); the last repeats. */
  retryDelaysMs: readonly number[];
}

export const DEFAULT_AUTOSAVE_TIMING: AutosaveTiming = {
  debounceMs: 1000,
  maxWaitMs: 5000,
  retryDelaysMs: [2000, 4000, 8000, 16000, 30000],
};

/** The autosave timing Tale Studio uses; tests provide shorter ones. */
export const AUTOSAVE_TIMING = new InjectionToken<AutosaveTiming>('AUTOSAVE_TIMING', {
  providedIn: 'root',
  factory: () => DEFAULT_AUTOSAVE_TIMING,
});

/**
 * Where saving stands: everything saved; changes waiting to be saved; a save on its way; a save
 * that failed on the network or the server and is retried at `retryAt`; a save the API refused
 * (it waits for the next change or a retry); or a save refused as stale (409), after which
 * autosave stops until the person chooses what to do.
 */
export type AutosaveState =
  | { kind: 'saved' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'retrying'; failure: TaleDocumentFailure; retryAt: number }
  | { kind: 'refused'; failure: TaleDocumentFailure }
  | { kind: 'conflict'; failure: TaleDocumentFailure };

type Failed = Extract<AutosaveState, { failure: TaleDocumentFailure }>;

/** True for a failure worth trying again by itself: no answer, a timeout, rate limiting or a server error. */
export function isRetryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * Saves one tale's document as it changes. Changes are debounced; a save never starts while
 * another is on its way, and changes made meanwhile go out together in the next one, based on
 * the revision the last save returned. Undoing back to the saved document needs no save.
 */
export class TaleAutosaver {
  private current: TaleDocument;
  private saved: TaleDocument;
  private revision: number;
  private failure: Failed | null = null;
  // The document the API refused, not sent again until it changes or a retry is asked for.
  private refused: TaleDocument | null = null;
  // Why it was refused, shown again when the content comes back to it.
  private refusedFailure: TaleDocumentFailure | null = null;
  // Paused (while the tale is updated or the draft discarded): changes are kept and nothing is sent.
  private paused = false;
  private inFlight: Promise<void> | null = null;
  // A save was due while another was on its way.
  private again = false;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private pendingSince: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  // Raised by reset(): the answer to a save sent before it is ignored.
  private generation = 0;
  private disposed = false;

  constructor(
    document: TaleDocument,
    revision: number,
    private readonly send: (document: TaleDocument, revision: number) => Promise<TaleDocumentResult>,
    private readonly onState: (state: AutosaveState) => void,
    private readonly timing: AutosaveTiming = DEFAULT_AUTOSAVE_TIMING,
    private readonly now: () => number = Date.now,
  ) {
    this.current = document;
    this.saved = document;
    this.revision = revision;
  }

  /** Where saving stands. */
  get state(): AutosaveState {
    if (this.failure) return this.failure;
    if (this.inFlight) return { kind: 'saving' };
    return this.current === this.saved ? { kind: 'saved' } : { kind: 'pending' };
  }

  /** True while the document on screen is not the one last saved. */
  get unsaved(): boolean {
    return this.current !== this.saved;
  }

  /** The document last saved: the draft Update tale or a discard acts on. */
  get savedDocument(): TaleDocument {
    return this.saved;
  }

  /** The revision of the document last saved, which updating and discarding are based on. */
  get savedRevision(): number {
    return this.revision;
  }

  /** Another change came first (a 409 elsewhere, such as on updating): autosave stops, as after a stale save. */
  conflict(failure: TaleDocumentFailure): void {
    this.clearTimers();
    this.failure = { kind: 'conflict', failure };
    this.emit();
  }

  /**
   * Stops sending: changes are kept, and no save starts until {@link resume}. Used while the
   * tale is updated or the draft discarded, so no save of the draft is on its way meanwhile.
   */
  pause(): void {
    this.paused = true;
    this.clearTimers();
    this.emit();
  }

  /** Sends again after {@link pause}: changes kept meanwhile are saved, based on the revision saved last. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.current !== this.saved && this.failure === null) this.changed(this.current);
    else this.emit();
  }

  /** Starts over from a document just read, at its revision: nothing to save, no failure. */
  reset(document: TaleDocument, revision: number): void {
    this.clearTimers();
    this.generation++;
    this.paused = false;
    this.current = document;
    this.saved = document;
    this.revision = revision;
    this.failure = null;
    this.refused = null;
    this.refusedFailure = null;
    this.again = false;
    this.attempt = 0;
    this.emit();
  }

  /** The document changed: a save follows once changes pause. */
  changed(document: TaleDocument): void {
    this.current = document;
    if (this.disposed || this.failure?.kind === 'conflict') return this.emit();
    if (document === this.saved && !this.inFlight) {
      // Back to what is saved: nothing to send, and nothing to retry.
      this.clearTimers();
      this.failure = null;
      this.attempt = 0;
      return this.emit();
    }
    // While retrying, the retry sends the latest document.
    if (this.failure?.kind === 'retrying') return this.emit();
    // Back to the document the API refused: it stays refused, with its reason, and is not sent again.
    if (document === this.refused && this.refusedFailure && !this.inFlight) {
      this.clearTimers();
      this.failure = { kind: 'refused', failure: this.refusedFailure };
      return this.emit();
    }
    if (this.failure?.kind === 'refused') this.failure = null;
    if (this.paused) return this.emit();
    this.pendingSince ??= this.now();
    if (this.debounce !== null) clearTimeout(this.debounce);
    const wait = Math.max(0, Math.min(this.timing.debounceMs, this.pendingSince + this.timing.maxWaitMs - this.now()));
    this.debounce = setTimeout(() => this.fire(), wait);
    this.emit();
  }

  /** Saves now, as "Retry now" asks; after a stale refusal it does nothing. */
  retryNow(): void {
    if (this.disposed || this.paused || this.failure?.kind === 'conflict') return;
    this.refused = null;
    this.refusedFailure = null;
    this.fire();
  }

  /** The browser is back online: a failed save is tried again at once. */
  online(): void {
    if (this.failure?.kind === 'retrying') this.retryNow();
  }

  /**
   * Saves what is unsaved now, waiting for a save on its way, and tries once. True when everything
   * is saved; false when it could not be (a failure, a stale refusal, or a document the API
   * refused, which is not sent again by itself).
   */
  async flush(): Promise<boolean> {
    let tried = false;
    for (;;) {
      if (this.disposed || this.failure?.kind === 'conflict') return false;
      if (this.inFlight) {
        await this.inFlight;
        continue;
      }
      if (this.current === this.saved) return true;
      if (tried || this.current === this.refused) return false;
      tried = true;
      this.clearTimers();
      this.start();
    }
  }

  /** Stops every timer; answers still on their way are ignored. */
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.debounce !== null) clearTimeout(this.debounce);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.debounce = null;
    this.retryTimer = null;
    this.pendingSince = null;
  }

  private fire(): void {
    this.clearTimers();
    if (this.disposed || this.paused || this.failure?.kind === 'conflict') return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    if (this.current === this.saved || this.current === this.refused) return this.emit();
    this.start();
  }

  private start(): void {
    this.failure = null;
    const document = this.current;
    const generation = this.generation;
    this.inFlight = this.run(document, generation);
    this.emit();
  }

  private async run(document: TaleDocument, generation: number): Promise<void> {
    let result: TaleDocumentResult;
    try {
      result = await this.send(document, this.revision);
    } catch {
      result = { value: null, message: '', stale: false, code: '', pointer: '', status: 0 };
    }
    this.inFlight = null;
    if (this.disposed) return;
    if (generation === this.generation) this.settle(document, result);
    if (this.again && this.failure === null) {
      this.again = false;
      return this.fire();
    }
    this.again = false;
    this.emit();
  }

  private settle(document: TaleDocument, result: TaleDocumentResult): void {
    if (result.value !== null) {
      this.revision = result.value.revision;
      this.saved = document;
      this.attempt = 0;
      if (this.current === this.refused) this.refused = null;
      // Changes made while it was on its way are already waiting for their own save.
      return;
    }
    if (result.stale) {
      this.clearTimers();
      this.failure = { kind: 'conflict', failure: result };
    } else if (isRetryable(result.status)) {
      const delays = this.timing.retryDelaysMs;
      const delay = delays[Math.min(this.attempt, delays.length - 1)];
      this.attempt++;
      this.clearTimers();
      this.failure = { kind: 'retrying', failure: result, retryAt: this.now() + delay };
      this.retryTimer = setTimeout(() => this.fire(), delay);
    } else {
      this.failure = { kind: 'refused', failure: result };
      this.refused = document;
      this.refusedFailure = result;
      // A change made while it was on its way may fix it, and gets its own save.
      if (this.current !== document) {
        this.failure = null;
        this.again = true;
      }
    }
  }

  private emit(): void {
    this.onState(this.state);
  }
}
