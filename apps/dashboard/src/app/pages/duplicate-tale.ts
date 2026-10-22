import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isErrorBody, MAX_TALES_PER_GROUP, type DuplicateTaleRequest, type Tale } from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';

/** A finished duplicate: the copy and the name of the group it went to. */
export interface DuplicatedTale {
  copy: Tale;
  groupName: string;
}

/** The words a live region says for a finished duplicate (epic Tale Studio R11). */
export function duplicatedMessage({ copy, groupName }: DuplicatedTale): string {
  return `Duplicated as ${copy.title} in ${groupName}. The copy is hidden until you show it.`;
}

/**
 * Duplicates a tale with its content into a tale group of its project (epic Tale Studio R11): a
 * drawer with the group picker (the tale's own group first chosen; a full group cannot be chosen)
 * and Duplicate. Loaded with the pages that use it (the zone page, Tale Studio), so it adds
 * nothing to the dashboard's first load.
 */
@Component({
  selector: 'app-duplicate-tale',
  imports: [Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-drawer heading="Duplicate tale" [returnFocus]="returnFocus()" [busy]="saving()" (closed)="closed.emit()">
      <form class="drawer__form" (submit)="submit($event)" novalidate>
        <div class="drawer__body">
          <p class="muted">
            A copy of {{ tale().title }} with its content and media. The copy is hidden until you show it.
          </p>
          <div class="field">
            <label class="field__label" for="duplicate-group">Tale group</label>
            <select
              id="duplicate-group"
              class="select"
              name="taleGroupId"
              [value]="groupId()"
              (change)="pick($any($event.target).value)"
              [attr.aria-invalid]="error() ? 'true' : null"
              [attr.aria-describedby]="error() ? 'duplicate-hint duplicate-error' : 'duplicate-hint'"
            >
              @for (group of groups(); track group.id) {
                <option [value]="group.id" [disabled]="group.full" [selected]="group.id === groupId()">
                  {{ group.label }}
                </option>
              }
            </select>
            <p class="field__hint" id="duplicate-hint">{{ hint() }}</p>
          </div>
          @if (error()) {
            <p class="form-error" role="alert" id="duplicate-error">{{ error() }}</p>
          }
        </div>
        <div class="drawer__footer">
          <button type="button" class="btn btn--secondary" [disabled]="saving()" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn btn--primary" id="duplicate-submit" [disabled]="saving()">Duplicate</button>
        </div>
      </form>
    </app-drawer>
  `,
})
export class DuplicateTale {
  private readonly store = inject(DashboardStore);
  private readonly http = inject(HttpClient);
  /** The tale to duplicate. */
  readonly tale = input.required<Tale>();
  /** Where focus goes when the drawer closes. */
  readonly returnFocus = input<HTMLElement | null | (() => HTMLElement | null)>(null);
  /** Emitted once the copy exists, after the store was read again. */
  readonly duplicated = output<DuplicatedTale>();
  readonly closed = output<void>();

  protected readonly saving = signal(false);
  protected readonly error = signal('');
  /** The chosen group: the tale's own until the person picks another. */
  protected readonly groupId = linkedSignal(() => this.tale().taleGroupId);

  /** The tale's project's groups, its own group first, each with its room ("3 / 100"). */
  protected readonly groups = computed(() => {
    const tale = this.tale();
    const listed = this.store.projectTaleGroupsOf(tale.projectId);
    const own = listed.find((g) => g.id === tale.taleGroupId);
    const ordered = own ? [own, ...listed.filter((g) => g !== own)] : listed;
    // A group the project list has not read yet still offers the tale's own group.
    const rows = ordered.map((g) => ({
      id: g.id,
      name: g.name,
      count: g.taleCount,
      full: g.taleCount >= MAX_TALES_PER_GROUP,
      own: g.id === tale.taleGroupId,
    }));
    if (!own) {
      const group = this.store.taleGroup(tale.taleGroupId);
      const count = group?.tales.length ?? 0;
      rows.unshift({
        id: tale.taleGroupId,
        name: group?.name ?? 'This tale group',
        count,
        full: count >= MAX_TALES_PER_GROUP,
        own: true,
      });
    }
    return rows.map((row) => ({
      ...row,
      label: `${row.name}${row.own ? ' (this group)' : ''}: ${row.count} / ${MAX_TALES_PER_GROUP}${row.full ? ', full' : ''}`,
    }));
  });

  protected readonly hint = computed(() => {
    const chosen = this.groups().find((g) => g.id === this.groupId());
    return chosen?.own
      ? 'The copy goes right after the original.'
      : `The copy goes last in ${chosen?.name ?? 'the group'}.`;
  });

  protected pick(groupId: string): void {
    this.groupId.set(groupId);
    this.error.set('');
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    const chosen = this.groups().find((g) => g.id === this.groupId());
    if (!chosen) {
      this.error.set('Choose a tale group.');
      return;
    }
    if (chosen.full) {
      this.error.set(`${chosen.name} already holds ${MAX_TALES_PER_GROUP} tales. Choose another tale group.`);
      return;
    }
    this.saving.set(true);
    this.error.set('');
    let copy: Tale;
    try {
      const body: DuplicateTaleRequest = { taleGroupId: chosen.id };
      copy = await firstValueFrom(
        this.http.post<Tale>(`${API_BASE}/tales/${encodeURIComponent(this.tale().id)}/duplicate`, body),
      );
    } catch (err) {
      this.saving.set(false);
      this.error.set(
        err instanceof HttpErrorResponse && isErrorBody(err.error)
          ? err.error.error.message
          : 'The tale was not duplicated. Try again.',
      );
      return;
    }
    // The new card shows once the store has read the groups again.
    await this.store.refresh();
    this.saving.set(false);
    this.duplicated.emit({ copy, groupName: chosen.name });
  }
}
