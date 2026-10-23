import type { ImportCount, TaleGroupTag } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import {
  addTaleGroupTagsByName,
  addTaleGroupTagsByNameIn,
  ensureTags,
  InvalidTagNameError,
} from '@taleart/server-targeting';
import { labelOutcome, MAX_IMPORT_TAGS, type LabelOutcome } from './labels';
import type { ReportText } from './record-shape';

// Storyly labels become the groups' targeting tags. Tag names are public: the Delivery API sends them
// with each group to anyone holding the site key, so the SDK can match the viewer's tags (AD-13,
// owner decision in epic targeting story 5.1).

/** The most label names one merge note quotes; the rest are counted. */
const MERGE_NOTE_NAMES = 5;
/** The most merge notes one report holds; one more note counts the rest. */
export const MAX_MERGE_NOTES = 50;

/**
 * True for an error a label's own text causes in the database (a data
 * exception or a check): the label is not imported, but the job goes on.
 */
export function isLabelError(err: unknown): boolean {
  if (err instanceof InvalidTagNameError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (code.startsWith('22') || code === '23514');
}

/**
 * Brings an import's labels across as tags of its project, through the
 * targeting module (AD-1), and counts them for the report per occurrence:
 * every label read is a source label, imported once a tag of the project
 * carries its name, else skipped. Tags are found by name ignoring case, or
 * created, so a re-run or an existing tag never makes a second one; nothing
 * is ever removed. At most {@link MAX_IMPORT_TAGS} distinct tags per import.
 */
export class LabelImport {
  private source = 0;
  // Each tag name used, with how many label occurrences it stands for.
  private readonly occurrences = new Map<string, number>();
  // The tag that carries each name, once found or created.
  private readonly tagOf = new Map<string, string>();
  // Names refused by the per-import tag limit.
  private readonly refused = new Set<string>();
  // Each tag's name and the distinct label texts it carries, for the merge notes.
  private readonly tags = new Map<string, { name: string; labels: Set<string> }>();

  constructor(
    private readonly db: TransactionalDb,
    private readonly projectId: string,
  ) {}

  /** Counts one label as read and says what it becomes: a tag name, or why it cannot. */
  read(text: string | null): LabelOutcome {
    this.source++;
    return labelOutcome(text);
  }

  /** Counts labels that were not read (past a limit, or a repeated record): source and skipped. */
  uncounted(count: number): void {
    this.source += count;
  }

  /** One read label whose name is to be carried by a tag: it counts as imported once that tag exists. */
  use(name: string): void {
    this.occurrences.set(name, (this.occurrences.get(name) ?? 0) + 1);
  }

  // The names that may be found or created: known ones, and new ones while the import's tag limit allows.
  private allowed(names: readonly string[]): string[] {
    const known = new Set(this.tagOf.keys());
    const allowed: string[] = [];
    for (const name of names) {
      if (known.has(name)) allowed.push(name);
      else if (known.size < MAX_IMPORT_TAGS) {
        known.add(name);
        allowed.push(name);
      } else this.refused.add(name);
    }
    return allowed;
  }

  /** Finds or creates the project's tags for these names. */
  async ensure(names: readonly string[]): Promise<void> {
    const allowed = this.allowed(names);
    if (allowed.length === 0) return;
    this.carried(allowed, await ensureTags(this.db, this.projectId, allowed));
  }

  /**
   * Adds the tags of these names to a tale group, keeping the tags it has.
   * Throws the targeting module's TaleGroupNotFoundError when the group is gone.
   */
  async addToGroup(taleGroupId: string, names: readonly string[]): Promise<void> {
    const allowed = this.allowed(names);
    if (allowed.length === 0) return;
    this.carried(allowed, await addTaleGroupTagsByName(this.db, taleGroupId, allowed));
  }

  /** {@link addToGroup} on the caller's transaction, where a re-import records the tags it gave the group. */
  async addToGroupIn(
    tx: Db,
    taleGroupId: string,
    decide: (current: readonly string[]) => readonly string[],
  ): Promise<{ current: string[]; carried: string[] }> {
    // `decide` sees the group's tags read under its tag lock (compare and set); names past the import's tag
    // limit are not added, and are not reported as carried.
    let asked: string[] = [];
    const { current, added } = await addTaleGroupTagsByNameIn(tx, taleGroupId, (tags) => {
      asked = this.allowed(decide(tags.map((tag) => tag.name)));
      return asked;
    });
    if (asked.length > 0) this.carried(asked, added);
    const currentNames = current.map((tag) => tag.name);
    return { current: currentNames, carried: [...currentNames, ...added.keys()] };
  }

  // Records which tag carries each name, in the order the names were read.
  private carried(names: readonly string[], byName: ReadonlyMap<string, Pick<TaleGroupTag, 'id' | 'name'>>): void {
    for (const name of names) {
      const tag = byName.get(name);
      if (tag === undefined) continue;
      this.tagOf.set(name, tag.id);
      const entry = this.tags.get(tag.id) ?? { name: tag.name, labels: new Set<string>() };
      entry.labels.add(name);
      this.tags.set(tag.id, entry);
    }
  }

  /** The report's tag counts, per occurrence: source = imported + skipped. */
  count(): ImportCount {
    let imported = 0;
    for (const [name, count] of this.occurrences) if (this.tagOf.has(name)) imported += count;
    return { source: this.source, imported, skipped: this.source - imported };
  }

  /** True once any label was read. */
  get anyRead(): boolean {
    return this.source > 0;
  }

  /**
   * One note per tag that carries labels differing only in case (Storyly tells
   * them apart, TaleArt does not), at most {@link MAX_MERGE_NOTES} and one
   * counting the rest; and one note for labels past the import's tag limit.
   */
  notes(text: ReportText): string[] {
    const notes: string[] = [];
    let moreMerged = 0;
    for (const { name, labels } of this.tags.values()) {
      if (labels.size < 2) continue;
      if (notes.length >= MAX_MERGE_NOTES) {
        moreMerged++;
        continue;
      }
      const all = [...labels];
      const quoted = all.slice(0, MERGE_NOTE_NAMES).map((label) => `"${text(label)}"`);
      if (all.length > MERGE_NOTE_NAMES) quoted.push(`${all.length - MERGE_NOTE_NAMES} more`);
      notes.push(`Tag "${text(name)}": labels ${quoted.join(', ')} became one tag, since tag names ignore case`);
    }
    if (moreMerged > 0) {
      notes.push(`Tags: ${moreMerged} more tag(s) each carry labels that differ only in case`);
    }
    if (this.refused.size > 0) {
      let count = 0;
      for (const name of this.refused) count += this.occurrences.get(name) ?? 0;
      notes.push(
        `Tags: ${count} label(s) with ${this.refused.size} more name(s) were not imported, ` +
          `since one import makes at most ${MAX_IMPORT_TAGS} tags`,
      );
    }
    return notes;
  }
}
