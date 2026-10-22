// Tale Studio's history (epic Tale Studio R9): every change to the document is one step, kept as
// the document before and after it. Documents are immutable values, so a step costs only the
// parts that changed, and undoing back to a saved document gives that very object again.
import type { TaleDocument } from '@taleart/contract/tale-document';

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

// The value as JSON with object keys sorted, so two documents compare by content, whatever order
// their keys came in (the database returns JSONB keys in its own order).
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** True when two documents hold the same content (null for none), whatever the order of their keys. */
export function sameDocument(a: TaleDocument | null, b: TaleDocument | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return canonical(a) === canonical(b);
}

// Each layer's canonical form, kept per layer object: documents are immutable values, so a layer
// that did not change keeps its object, and is not written out again on each count.
const layerForms = new WeakMap<object, string>();
function layerForm(layer: object): string {
  let form = layerForms.get(layer);
  if (form === undefined) {
    form = canonical(layer);
    layerForms.set(layer, form);
  }
  return form;
}

/** The version on the site, ready to count changes against (see {@link changeCount}). */
export interface SiteVersion {
  /** Each layer's canonical form, by id, in the site's order. */
  readonly layers: ReadonlyMap<string, string>;
  /** The tale itself, without its layers: its canvas, duration and version. */
  readonly rest: string;
}

/** The version on the site, ready to count changes against; null when nothing is on the site. */
export function siteVersion(site: TaleDocument | null): SiteVersion | null {
  if (site === null) return null;
  return {
    layers: new Map(site.elements.map((element) => [element.id, layerForm(element)])),
    rest: canonical({ ...site, elements: [] }),
  };
}

/**
 * How many changes the draft holds against the version on the site (epic UX rework R15): each
 * layer added, removed or changed is one, a new layer order is one, and a change to the tale
 * itself (its canvas or duration) is one. Against nothing on the site, each of the draft's layers
 * is one, and a draft with none is one change. 0 when the two are the same.
 */
export function changeCount(draft: TaleDocument | null, site: SiteVersion | null): number {
  if (draft === null) return site === null ? 0 : Math.max(site.layers.size, 1);
  if (site === null) return Math.max(draft.elements.length, 1);
  let count = 0;
  const draftIds = new Set<string>();
  for (const element of draft.elements) {
    draftIds.add(element.id);
    if (site.layers.get(element.id) !== layerForm(element)) count++;
  }
  for (const id of site.layers.keys()) if (!draftIds.has(id)) count++;
  const draftOrder = draft.elements.filter((element) => site.layers.has(element.id)).map((element) => element.id);
  const siteOrder = [...site.layers.keys()].filter((id) => draftIds.has(id));
  if (draftOrder.join(',') !== siteOrder.join(',')) count++;
  if (canonical({ ...draft, elements: [] }) !== site.rest) count++;
  return count;
}
