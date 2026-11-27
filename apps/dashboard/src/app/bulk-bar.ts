import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * The bar above a list that has a selection (see `createSelection`): shown only while `count` is
 * above 0, sticky at the top of the list, with "{n} selected", the page's action buttons projected
 * into it, and "Clear selection". Its role is a region named "Actions on the selection".
 *
 * The count is also announced politely through a visually hidden live region that stays in the
 * DOM, so the announcement is read when the first item is picked (a region inserted with its text
 * is often not announced). Escape clears the selection when focus is in the list: the page binds
 * `(keydown.escape)` on the list's wrapper to `selection.clear()`.
 *
 * Adopting it in a list (about ten lines in the page):
 *
 *   readonly selection = createSelection(() => this.rows(), (row) => row.id);
 *
 *   <div (keydown.escape)="selection.clear()">
 *     <app-bulk-bar [count]="selection.count()" (cleared)="selection.clear()">
 *       <button type="button" class="btn btn--danger btn--sm" (click)="askDelete()">Delete</button>
 *     </app-bulk-bar>
 *     <ul> @for (row of rows(); track row.id) { <li> <label class="checkbox">
 *       <input type="checkbox" [attr.aria-label]="'Select ' + row.name"
 *              [checked]="selection.isSelected(row.id)" (change)="selection.toggle(row.id)" />
 *     </label> … </li> } </ul>
 *   </div>
 *
 * Only show the bar and its checkboxes to a role that may run the action (`store.can(...)`).
 */
@Component({
  selector: 'app-bulk-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    app-bulk-bar {
      display: block;
    }
    /* Sticks under the page's sticky top bar (app.css), which takes two rows on the smallest phones. */
    .bulk-bar {
      position: sticky;
      top: calc(var(--topbar-height) + var(--space-2));
      z-index: 2;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      margin: 0 0 var(--space-3);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--brand);
      border-radius: var(--radius-control);
      background: var(--surface);
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.08);
    }
    @media (max-width: 374.98px) {
      .bulk-bar {
        top: calc(2 * var(--topbar-height) + var(--space-2));
      }
    }
    .bulk-bar__count {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .bulk-bar__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-inline-start: auto;
    }
    .bulk-bar__clear {
      white-space: nowrap;
    }
  `,
  template: `
    <span class="visually-hidden" aria-live="polite" aria-atomic="true">{{ status() }}</span>
    @if (count() > 0) {
      <div class="bulk-bar" role="region" aria-label="Actions on the selection">
        <p class="bulk-bar__count">{{ status() }}</p>
        <div class="bulk-bar__actions"><ng-content /></div>
        <button type="button" class="btn btn--ghost btn--sm bulk-bar__clear" (click)="cleared.emit()">Clear selection</button>
      </div>
    }
  `,
})
export class BulkBar {
  /** How many items are selected; the bar shows above 0. */
  readonly count = input.required<number>();
  /** Clear selection was pressed. */
  readonly cleared = output<void>();

  protected readonly status = computed(() => `${this.count()} selected`);
}
