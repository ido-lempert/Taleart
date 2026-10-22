import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ErrorCodes,
  isErrorBody,
  MAX_TALES_PER_GROUP,
  type DuplicateTaleRequest,
  type ProjectTaleGroup,
  type Tale,
  type ZoneTaleGroup,
} from '@taleart/contract/core';
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

/** What to tell the person when the API refused a duplicate, in plain words. */
export function duplicateRefusal(err: unknown, groupName: string): string {
  if (err instanceof HttpErrorResponse && err.status === 0) {
    return 'The tale was not duplicated. Check the connection and try again.';
  }
  const code = err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.code : null;
  switch (code) {
    case ErrorCodes.taleGroupNotFound:
      return 'That tale group is no longer available. Choose another.';
    case ErrorCodes.taleGroupFull:
      return `${groupName} already holds ${MAX_TALES_PER_GROUP} tales. Choose another tale group.`;
    case ErrorCodes.taleNotFound:
      return 'This tale no longer exists, so it cannot be duplicated.';
    case ErrorCodes.forbidden:
      return 'You no longer have access to this project.';
    default:
      return 'The tale was not duplicated. Try again.';
  }
}

/**
 * Reads the project's tale groups again, in the project list and in each of its zones, so a new
 * copy shows without reading everything again. Runs in the background; a failure leaves the lists
 * as they were until the next full read.
 */
async function refreshProjectGroups(http: HttpClient, store: DashboardStore, projectId: string): Promise<void> {
  const zones = store.zones().filter((z) => z.projectId === projectId);
  try {
    const [listed, ...placed] = await Promise.all([
      firstValueFrom(http.get<ProjectTaleGroup[]>(`${API_BASE}/projects/${encodeURIComponent(projectId)}/tale-groups`)),
      ...zones.map((z) =>
        firstValueFrom(http.get<ZoneTaleGroup[]>(`${API_BASE}/zones/${encodeURIComponent(z.id)}/tale-groups`)),
      ),
    ]);
    store.projectTaleGroups.update((all) => ({ ...all, [projectId]: listed }));
    store.taleGroups.update((all) => ({
      ...all,
      ...Object.fromEntries(zones.map((z, i) => [z.id, placed[i] as ZoneTaleGroup[]])),
    }));
  } catch {
    // The lists stay as they were; the next full read brings the copy.
  }
}

interface GroupRow {
  id: string;
  name: string;
  count: number;
  full: boolean;
  own: boolean;
  label: string;
}

/**
 * Duplicates a tale with its content into a tale group of its project (epic Tale Studio R11): a
 * drawer with the group picker (the tale's own group first; the first group with room chosen; a
 * full group cannot be chosen) and Duplicate. Loaded with the pages that use it (the zone page,
 * Tale Studio), so it adds nothing to the dashboard's first load.
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
          <button type="submit" class="btn btn--primary" id="duplicate-submit" [disabled]="saving() || noRoom()">
            Duplicate
          </button>
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
  /** Emitted once the copy exists; the project's groups are read again in the background. */
  readonly duplicated = output<DuplicatedTale>();
  readonly closed = output<void>();

  protected readonly saving = signal(false);
  protected readonly error = signal('');

  /**
   * The tale's project's groups, its own group first, each with its room ("3 / 100"). When the
   * project's list has not been read, the tale's own group is offered from what the zones show.
   */
  protected readonly groups = computed<GroupRow[]>(() => {
    const tale = this.tale();
    const listed = this.store.projectTaleGroupsOf(tale.projectId);
    const own = listed.find((g) => g.id === tale.taleGroupId);
    const ordered = own ? [own, ...listed.filter((g) => g !== own)] : listed;
    const rows = ordered.map((g) => ({ id: g.id, name: g.name, count: g.taleCount, own: g.id === tale.taleGroupId }));
    if (!own) {
      const group = this.store.taleGroup(tale.taleGroupId);
      rows.unshift({ id: tale.taleGroupId, name: group?.name ?? 'This tale group', count: group?.tales.length ?? 0, own: true });
    }
    return rows.map((row) => {
      const full = row.count >= MAX_TALES_PER_GROUP;
      return {
        ...row,
        full,
        label: `${row.name}${row.own ? ' (this group)' : ''}: ${row.count} / ${MAX_TALES_PER_GROUP}${full ? ', full' : ''}`,
      };
    });
  });

  /** True when no group of the project has room for the copy. */
  protected readonly noRoom = computed(() => this.groups().every((g) => g.full));

  /** The chosen group: the person's pick while it has room, else the first group with room. */
  protected readonly groupId = linkedSignal<GroupRow[], string>({
    source: this.groups,
    computation: (groups, previous) => {
      const kept = previous && groups.find((g) => g.id === previous.value && !g.full);
      return kept ? kept.id : (groups.find((g) => !g.full)?.id ?? '');
    },
  });

  protected readonly hint = computed(() => {
    if (this.noRoom()) {
      return `Every tale group of this project already holds ${MAX_TALES_PER_GROUP} tales. Remove a tale from one first.`;
    }
    const chosen = this.groups().find((g) => g.id === this.groupId());
    return chosen?.own ? 'The copy goes right after the original.' : `The copy goes last in ${chosen?.name ?? 'the group'}.`;
  });

  protected pick(groupId: string): void {
    this.groupId.set(groupId);
    this.error.set('');
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving() || this.noRoom()) return;
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
    const tale = this.tale();
    let copy: Tale;
    try {
      const body: DuplicateTaleRequest = { taleGroupId: chosen.id };
      copy = await firstValueFrom(this.http.post<Tale>(`${API_BASE}/tales/${encodeURIComponent(tale.id)}/duplicate`, body));
    } catch (err) {
      this.saving.set(false);
      this.error.set(duplicateRefusal(err, chosen.name));
      return;
    }
    this.saving.set(false);
    // Said and closed at once; the new card shows when the project's groups have been read again.
    this.duplicated.emit({ copy, groupName: chosen.name });
    void refreshProjectGroups(this.http, this.store, tale.projectId);
  }
}
