import { computed, effect, signal, untracked, type Signal } from '@angular/core';

/**
 * The multi-select state of a list (the reusable selection pattern; the bulk bar and `runLimited`
 * are its other two parts). One is made per list, in an injection context (a component's field
 * initializer), with the list's visible items and the key that names one:
 *
 *   readonly selection = createSelection(() => this.groups(), (group) => group.id);
 *
 * Only the ids of items the list still shows count as selected: an id whose item leaves the list
 * (a filter, a delete, a reload) drops out of `ids`, `count` and `selectedItems` at once, and an
 * effect forgets it, so it does not come back selected if the item returns.
 *
 * Template use: `[checked]="selection.isSelected(row.id)"` and `(change)="selection.toggle(row.id)"`
 * on a row checkbox; `[checked]="selection.allSelected()"`, `[indeterminate]="selection.someSelected()"`
 * and `(change)="selection.toggleAll()"` on the header checkbox.
 */
export interface Selection<T> {
  /** The selected keys that the list still shows. */
  readonly ids: Signal<ReadonlySet<string>>;
  /** How many items are selected. */
  readonly count: Signal<number>;
  /** The selected items, in list order. */
  readonly selectedItems: Signal<readonly T[]>;
  /** Every visible item is selected (false for an empty list). */
  readonly allSelected: Signal<boolean>;
  /** Some, not all, visible items are selected: the header checkbox's indeterminate state. */
  readonly someSelected: Signal<boolean>;
  isSelected(id: string): boolean;
  /** Selects or clears one visible item; an id the list does not show is ignored. */
  toggle(id: string): void;
  /** Sets one visible item's selection; an id the list does not show is ignored. */
  set(id: string, selected: boolean): void;
  /** Selects every visible item, or clears the selection when all are selected already. */
  toggleAll(): void;
  /** Selects exactly these ids (the ones the list shows); used to keep the failures of a bulk action selected. */
  replace(ids: Iterable<string>): void;
  clear(): void;
}

export function createSelection<T>(items: () => readonly T[], key: (item: T) => string): Selection<T> {
  // The ids picked, including any that have left the list until the effect below forgets them.
  const picked = signal<ReadonlySet<string>>(new Set());
  const listed = computed(() => items().map(key));
  const listedSet = computed(() => new Set(listed()));

  const ids = computed(() => {
    const shown = listedSet();
    return new Set([...picked()].filter((id) => shown.has(id)));
  });
  const count = computed(() => ids().size);
  const selectedItems = computed(() => items().filter((item) => ids().has(key(item))));
  const allSelected = computed(() => {
    const all = listed();
    return all.length > 0 && all.every((id) => ids().has(id));
  });
  const someSelected = computed(() => count() > 0 && !allSelected());

  // Forgets the picked ids the list no longer shows, so they stay gone when their item comes back.
  effect(() => {
    const shown = listedSet();
    untracked(() => {
      const current = picked();
      if ([...current].some((id) => !shown.has(id))) picked.set(new Set([...current].filter((id) => shown.has(id))));
    });
  });

  const write = (update: (next: Set<string>) => void) => {
    const next = new Set(picked());
    update(next);
    picked.set(next);
  };

  return {
    ids,
    count,
    selectedItems,
    allSelected,
    someSelected,
    isSelected: (id) => ids().has(id),
    toggle: (id) => {
      if (listedSet().has(id)) write((next) => (next.has(id) ? next.delete(id) : next.add(id)));
    },
    set: (id, selected) => {
      if (!listedSet().has(id)) return;
      write((next) => (selected ? next.add(id) : next.delete(id)));
    },
    toggleAll: () => {
      if (allSelected()) picked.set(new Set());
      else picked.set(new Set(listed()));
    },
    replace: (replacement) => {
      const shown = listedSet();
      picked.set(new Set([...replacement].filter((id) => shown.has(id))));
    },
    clear: () => picked.set(new Set()),
  };
}
