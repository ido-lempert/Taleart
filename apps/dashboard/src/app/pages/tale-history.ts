// Tale Studio's history (epic Tale Studio R9): every change to the document is one step, kept as
// the document before and after it. Documents are immutable values, so a step costs only the
// parts that changed, and undoing back to a saved document gives that very object again.
import type { TaleDocument } from '@taleart/contract';

/** How many steps the history keeps; the oldest is dropped past it (the epic asks for at least 100). */
export const HISTORY_LIMIT = 200;

/** Changes with the same merge key this close together (ms) are one step, such as typing a word. */
export const MERGE_WINDOW_MS = 1000;

interface Step {
  /** What the step did, as people read it: "Text moved". */
  label: string;
  before: TaleDocument;
  after: TaleDocument;
  mergeKey: string | null;
  at: number;
}

/** A document undone or redone to, and the label of the step. */
export interface HistoryMove {
  document: TaleDocument;
  label: string;
}

/** An undo and redo stack of document changes for one editing session. */
export class TaleHistory {
  private past: Step[] = [];
  private future: Step[] = [];
  // The last step takes no more merges: the person undid, redid or left the field.
  private sealed = false;

  constructor(private readonly limit = HISTORY_LIMIT) {}

  /**
   * Records a change from `before` to `after`. A change with the same `mergeKey` as the last step,
   * following straight on from it within {@link MERGE_WINDOW_MS}, joins that step. Recording
   * clears what could be redone. A change that changes nothing is not recorded.
   */
  record(
    label: string,
    before: TaleDocument,
    after: TaleDocument,
    mergeKey: string | null = null,
    now = Date.now(),
  ): void {
    if (before === after) return;
    const last = this.past.at(-1);
    if (
      mergeKey !== null &&
      !this.sealed &&
      last?.mergeKey === mergeKey &&
      last.after === before &&
      now - last.at <= MERGE_WINDOW_MS
    ) {
      last.after = after;
      last.at = now;
    } else {
      this.past.push({ label, before, after, mergeKey, at: now });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.sealed = false;
  }

  /** Ends merging into the last step, so the next change is a step of its own. */
  seal(): void {
    this.sealed = true;
  }

  /** The document before the last step, or null when there is nothing to undo. */
  undo(): HistoryMove | null {
    const step = this.past.pop();
    if (!step) return null;
    this.future.push(step);
    this.sealed = true;
    return { document: step.before, label: step.label };
  }

  /** The document after the last undone step, or null when there is nothing to redo. */
  redo(): HistoryMove | null {
    const step = this.future.pop();
    if (!step) return null;
    this.past.push(step);
    this.sealed = true;
    return { document: step.after, label: step.label };
  }

  /** The label of the step an undo would undo, or null. */
  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  /** The label of the step a redo would redo, or null. */
  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  /** How many steps can be undone. */
  get depth(): number {
    return this.past.length;
  }

  /** Forgets every step, as when another version of the document is loaded. */
  clear(): void {
    this.past = [];
    this.future = [];
    this.sealed = false;
  }
}
