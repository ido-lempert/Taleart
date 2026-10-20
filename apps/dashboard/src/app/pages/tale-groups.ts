import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MAX_TALES_PER_GROUP, type ProjectTaleGroup, type Zone } from '@taleart/contract';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { StatusBadge } from '../status';

/**
 * The selected project's tale groups by name, with the zones each is placed
 * in. A group belongs to the project, not to a zone (AD-14), so a group placed
 * in no zone is listed too, and each can be added to another zone, or copied
 * to a zone of any project the user can access, from here.
 */
@Component({
  selector: 'app-tale-groups-page',
  imports: [RouterLink, Icon, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .group-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .group-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4) 0;
      border-top: 1px solid var(--border);
    }
    .group-row:first-child {
      padding-top: 0;
      border-top: 0;
    }
    .group-row__name {
      flex: 1;
      min-width: 12rem;
    }
    .group-row__name h3 {
      font-size: var(--text-md);
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .group-row__zones {
      margin: 0;
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <div class="page">
      @if (store.loaded()) {
        @if (store.selectedProject(); as project) {
          <section class="card section" aria-labelledby="tale-groups-title">
            <div class="section__header">
              <h2 class="section__title" id="tale-groups-title">Tale groups in {{ project.name }}</h2>
            </div>
            @if (groups().length > 0) {
              <ul class="group-list" [attr.aria-label]="'Tale groups in ' + project.name">
                @for (group of groups(); track group.id) {
                  <li class="group-row">
                    <span class="ring" aria-hidden="true">{{ group.name.charAt(0) }}</span>
                    <div class="group-row__name">
                      <h3 [id]="'project-group-' + group.id">{{ group.name }}</h3>
                      <p class="muted">
                        <app-status-badge [status]="group.status" />
                        <span class="visually-hidden">Tales: </span>{{ group.taleCount }} / {{ maxTales }}
                      </p>
                      <p class="group-row__zones muted">
                        @if (zonesOf(group); as zones) {
                          @if (zones.length > 0) {
                            In:
                            @for (zone of zones; track zone.id; let last = $last) {
                              <a [routerLink]="['/zones', zone.id]">{{ zone.name }}</a>@if (!last) {<span>, </span>}
                            }
                          } @else {
                            Not in any zone
                          }
                        }
                      </p>
                    </div>
                    @if (store.zonesToPlace(group.id).length > 0) {
                      <button
                        type="button"
                        class="btn btn--secondary btn--sm"
                        [attr.aria-describedby]="'project-group-' + group.id"
                        (click)="store.openDrawer({ kind: 'placeTaleGroup', taleGroupId: group.id }, $event)"
                      >
                        Add to zone…
                      </button>
                    } @else {
                      <span class="muted">In every zone</span>
                    }
                    <button
                      type="button"
                      class="btn btn--secondary btn--sm"
                      [attr.aria-describedby]="'project-group-' + group.id"
                      (click)="store.openDrawer({ kind: 'copyTaleGroup', taleGroupId: group.id }, $event)"
                    >
                      Copy to zone…
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <div class="empty">
                <span class="empty__icon"><app-icon name="tales" /></span>
                <p class="empty__title">No tale groups yet</p>
                <p class="empty__text">Create a tale group in a zone; it then shows here, with every zone it is in.</p>
                <a class="btn btn--secondary" routerLink="/zones">Go to zones</a>
              </div>
            }
          </section>
        } @else if (!store.apiDown()) {
          <section class="card empty" aria-labelledby="empty-projects">
            <span class="empty__icon"><app-icon name="projects" /></span>
            <h2 class="empty__title" id="empty-projects">No projects yet</h2>
            <p class="empty__text">Tale groups belong to a project. Create or join a project first.</p>
          </section>
        }
      }
    </div>
  `,
})
export class TaleGroupsPage {
  protected readonly store = inject(DashboardStore);
  protected readonly maxTales = MAX_TALES_PER_GROUP;

  protected readonly groups = computed(() => this.store.projectTaleGroupsOf(this.store.selectedProjectId()));

  /** The zones a group is placed in, in the order it was placed. */
  protected zonesOf(group: ProjectTaleGroup): Zone[] {
    return group.zoneIds.flatMap((id) => {
      const zone = this.store.zone(id);
      return zone ? [zone] : [];
    });
  }
}
