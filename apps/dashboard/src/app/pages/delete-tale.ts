import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import type { Tale } from '@taleart/contract/core';
import { DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';

/** A finished delete: the tale's title and the name of the group it was in. */
export interface DeletedTale {
  taleId: string;
  title: string;
  groupName: string;
}

/** The words a live region says for a finished delete (story 8.20). */
export function deletedMessage({ title, groupName }: DeletedTale): string {
  return `${title} deleted from ${groupName}.`;
}

/**
 * Asks before deleting a tale for good (epic UX rework R11, story 8.20): an alert dialog that names
 * the tale and its group and says it cannot be undone, with Cancel (focused on open, so Enter does
 * not delete by accident) and Delete tale. Escape, the backdrop and Cancel close it, except while
 * the delete is being saved; a refusal shows in it, announced. Loaded with the group view.
 */
@Component({
  selector: 'app-delete-tale',
  imports: [Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-drawer
      heading="Delete tale"
      dialogRole="alertdialog"
      describedBy="delete-tale-text"
      initialFocus="#delete-tale-cancel"
      [returnFocus]="returnFocus()"
      [busy]="saving()"
      (closed)="closed.emit()"
    >
      <div class="drawer__body">
        <p id="delete-tale-text">
          Delete <strong>{{ tale().title }}</strong> from {{ groupName() }}? It stops showing on your site, and its
          content goes with it. This cannot be undone.
        </p>
        <p class="muted">Copies of this tale and the project's uploaded media are kept.</p>
        @if (error()) {
          <p class="form-error" role="alert" id="delete-tale-error">{{ error() }}</p>
        }
      </div>
      <div class="drawer__footer">
        <button type="button" class="btn btn--secondary" id="delete-tale-cancel" [disabled]="saving()" (click)="closed.emit()">
          Cancel
        </button>
        <button type="button" class="btn btn--danger" id="delete-tale-submit" [disabled]="saving()" (click)="confirm()">
          {{ saving() ? 'Deleting…' : 'Delete tale' }}
        </button>
      </div>
    </app-drawer>
  `,
})
export class DeleteTale {
  private readonly store = inject(DashboardStore);
  /** The tale to delete. */
  readonly tale = input.required<Tale>();
  /** The name of its group, for the question and the announcement. */
  readonly groupName = input.required<string>();
  /** Where focus goes when the dialog closes: read when it closes, as the tale's card may be gone. */
  readonly returnFocus = input<HTMLElement | null | (() => HTMLElement | null)>(null);
  /** Emitted once the tale is deleted; the dialog's owner closes it. */
  readonly deleted = output<DeletedTale>();
  readonly closed = output<void>();

  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected async confirm(): Promise<void> {
    if (this.saving()) return;
    const tale = this.tale();
    this.saving.set(true);
    this.error.set('');
    const message = await this.store.deleteTale(tale.id);
    this.saving.set(false);
    if (message) {
      this.error.set(message);
      return;
    }
    this.deleted.emit({ taleId: tale.id, title: tale.title, groupName: this.groupName() });
  }
}
