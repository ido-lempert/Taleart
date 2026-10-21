import type { ImportCount, TaleGroupTag } from '@taleart/contract';
import type { TransactionalDb } from '@taleart/server-access';
import { addTaleGroupTagsByName, ensureTags } from '@taleart/server-targeting';
import { labelOutcome, type LabelOutcome } from './labels';
import type { ReportText } from './record-shape';

/** The most label names one merge note quotes; the rest are counted. */
const MERGE_NOTE_NAMES = 5;

/**
 * Brings an import's labels across as tags of its project, through the
 * targeting module (AD-1), and counts them for the report. A label is counted
 * once per distinct text (trimmed, in its case), and a value that is not text
 * once per occurrence; it is imported once a tag of the project carries it.
 * Tags are found by name ignoring case, or created, so a re-run or an
 * existing tag never makes a second one; nothing is ever removed.
 */
export class LabelImport {
  // Each distinct label text read, with the id of the tag that carries it once known.
  private readonly texts = new Map<string, string | null>();
  private notText = 0;
  // Each tag's name and the distinct label texts it carries, for the merge notes.
  private readonly tags = new Map<string, { name: string; labels: Set<string> }>();

  constructor(
    private readonly db: TransactionalDb,
    private readonly projectId: string,
  ) {}

  /** Counts one label as read and says what it becomes: a tag name, or why it cannot. */
  read(text: string | null): LabelOutcome {
    if (text === null) this.notText++;
    else if (!this.texts.has(text.trim())) this.texts.set(text.trim(), null);
    return labelOutcome(text);
  }

  /** Finds or creates the project's tags for these names. */
  async ensure(names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    this.carried(names, await ensureTags(this.db, this.projectId, names));
  }

  /**
   * Adds the tags of these names to a tale group, keeping the tags it has.
   * Throws the targeting module's TaleGroupNotFoundError when the group is gone.
   */
  async addToGroup(taleGroupId: string, names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    this.carried(names, await addTaleGroupTagsByName(this.db, taleGroupId, names));
  }

  // Records which tag carries each name, in the order the names were read.
  private carried(names: readonly string[], byName: ReadonlyMap<string, Pick<TaleGroupTag, 'id' | 'name'>>): void {
    for (const name of names) {
      const tag = byName.get(name);
      if (tag === undefined) continue;
      this.texts.set(name, tag.id);
      const entry = this.tags.get(tag.id) ?? { name: tag.name, labels: new Set<string>() };
      entry.labels.add(name);
      this.tags.set(tag.id, entry);
    }
  }

  /** The report's tag counts: source = imported + skipped. */
  count(): ImportCount {
    const source = this.texts.size + this.notText;
    const imported = [...this.texts.values()].filter((tagId) => tagId !== null).length;
    return { source, imported, skipped: source - imported };
  }

  /** True once any label was read. */
  get anyRead(): boolean {
    return this.texts.size + this.notText > 0;
  }

  /** One note per tag that carries labels differing only in case: Storyly tells them apart, TaleArt does not. */
  mergeNotes(text: ReportText): string[] {
    const notes: string[] = [];
    for (const { name, labels } of this.tags.values()) {
      if (labels.size < 2) continue;
      const all = [...labels];
      const quoted = all.slice(0, MERGE_NOTE_NAMES).map((label) => `"${text(label)}"`);
      if (all.length > MERGE_NOTE_NAMES) quoted.push(`${all.length - MERGE_NOTE_NAMES} more`);
      notes.push(`Tag "${text(name)}": labels ${quoted.join(', ')} became one tag, since tag names ignore case`);
    }
    return notes;
  }
}
