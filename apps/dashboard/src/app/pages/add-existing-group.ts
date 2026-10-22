import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import type { ProjectTaleGroup } from '@taleart/contract/core';
import { DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';

/**
 * The tale groups of the zone's project that "Add existing group" can place in the zone: those not
 * in it already and not archived, by name as the project lists them (AD-14, epic UX rework R10).
 */
export function addableGroups(store: DashboardStore, zoneId: string): ProjectTaleGroup[] {
  const zone = store.zone(zoneId);
  if (!zone) return [];
  return store
    .projectTaleGroupsOf(zone.projectId)
    .filter((group) => !group.zoneIds.includes(zoneId) && group.storedStatus !== 'archived');
}

/**
 * "Add existing group" on the zone page (epic UX rework R10): a drawer to pick a tale group of the
 * zone's project that is not in the zone yet, and place it last. The group keeps its tales, tags
 * and status, shared with every zone it is in. Loaded with the zone page only, so it adds nothing
 * to the dashboard's first load.
 */
@Component({
  selector: 'app-add-existing-group',
  imports: [Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-drawer heading="Add existing group" [returnFocus]="returnFocus()" [busy]="saving()" (closed)="closed.emit()">
      <form class="drawer__form" (submit)="submit($event)" novalidate>
        <div class="drawer__body">
          @if (groups().length > 0) {
            <fieldset
              class="tag-options"
              [attr.aria-describedby]="error() ? 'add-existing-hint add-existing-error' : 'add-existing-hint'"
            >
              <legend class="field__label">Tale group</legend>
              @for (group of groups(); track group.id) {
                <label class="checkbox add-existing__option">
                  <input
                    type="radio"
                    name="existingGroup"
                    [value]="group.id"
                    [checked]="picked() === group.id"
                    (change)="picked.set(group.id)"
                  />
                  <span>
                    {{ group.name }}
                    <span class="add-existing__about muted">{{ about(group) }}</span>
                  </span>
                </label>
              }
            </fieldset>
            <p class="field__hint" id="add-existing-hint">
              The zone shows the group last. Its tales and tags are shared: a change shows in every zone it is in.
            </p>
          } @else {
            <p class="muted">Every tale group of this project is already in this zone.</p>
          }
          @if (error()) {
            <p class="form-error" role="alert" id="add-existing-error">{{ error() }}</p>
          }
        </div>
        <div class="drawer__footer">
          <button type="button" class="btn btn--secondary" [disabled]="saving()" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn btn--primary" [disabled]="saving() || !picked()">Add</button>
        </div>
      </form>
    </app-drawer>
  `,
  styles: `
    .add-existing__option > span {
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow-wrap: break-word;
    }
    .add-existing__about {
      font-size: var(--text-sm);
    }
  `,
})
export class AddExistingGroup {
  private readonly store = inject(DashboardStore);
  /** The zone the group goes into. */
  readonly zoneId = input.required<string>();
  /** Where focus goes when the drawer closes. */
  readonly returnFocus = input<HTMLElement | null>(null);
  /** Emitted with the group's name once the zone holds it. */
  readonly added = output<string>();
  readonly closed = output<void>();

  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly groups = computed(() => addableGroups(this.store, this.zoneId()));
  /** The group picked: the first one until another is chosen. */
  protected readonly picked = linkedSignal(() => this.groups()[0]?.id ?? '');

  /** "3 tales · Not in a zone" or "1 tale · In Checkout, Home". */
  protected about(group: ProjectTaleGroup): string {
    const tales = `${group.taleCount} tale${group.taleCount === 1 ? '' : 's'}`;
    const zones = group.zoneIds.flatMap((id) => this.store.zone(id)?.name ?? []);
    return `${tales} · ${zones.length > 0 ? `In ${zones.join(', ')}` : 'Not in a zone'}`;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const group = this.groups().find((g) => g.id === this.picked());
    if (!group || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    const message = await this.store.placeTaleGroup(this.zoneId(), group.id);
    this.saving.set(false);
    if (message) {
      this.error.set(message);
      return;
    }
    this.added.emit(group.name);
  }
}
