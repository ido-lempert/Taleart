import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../auth';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { VisibilityIndicator } from '../visibility';

/** The selected project's zones as cards. */
@Component({
  selector: 'app-zones-page',
  imports: [RouterLink, Icon, VisibilityIndicator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .zone-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      height: 100%;
      padding: var(--space-5);
      color: inherit;
      text-decoration: none;
      transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
    }
    .zone-card:hover {
      border-color: var(--border-strong);
      box-shadow: 0 4px 12px rgb(16 24 40 / 8%);
    }
    .zone-card__name {
      font-size: var(--text-lg);
      font-weight: 600;
      color: inherit;
      text-decoration: none;
    }
    /* The name's link covers the card, so the card opens the zone; the indicator sits above it. */
    .zone-card__name::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
    }
    .zone-card__name:focus-visible {
      outline: none;
    }
    .zone-card:has(.zone-card__name:focus-visible) {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }
    .zone-card app-visibility {
      z-index: 1;
    }
    .zone-card__meta {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-top: auto;
      color: var(--text-muted);
    }
  `,
  template: `
    <div class="page">
      @if (store.loaded()) {
        @if (store.projects().length === 0) {
          @if (!store.apiDown() && !auth.isAdmin()) {
            <section class="card empty" aria-labelledby="empty-projects">
              <span class="empty__icon"><app-icon name="projects" /></span>
              <h2 class="empty__title" id="empty-projects">No projects yet</h2>
              <p class="empty__text">You are not a member of any project. Ask an admin to invite you.</p>
            </section>
          } @else if (!store.apiDown()) {
            <section class="card empty" aria-labelledby="empty-projects">
              <span class="empty__icon"><app-icon name="projects" /></span>
              <h2 class="empty__title" id="empty-projects">
                Create your first project
              </h2>
              <p class="empty__text">
                A project holds your zones, tale groups and tales. Start with
                one for your app or site.
              </p>
              <button
                type="button"
                class="btn btn--primary"
                (click)="store.openDrawer({ kind: 'project' }, $event)"
              >
                <app-icon name="plus" /> New project
              </button>
            </section>
          }
        } @else if (store.projectZones().length === 0) {
          @if (!store.apiDown()) {
            <section class="card empty" aria-labelledby="empty-zones">
              <span class="empty__icon"><app-icon name="zones" /></span>
              <h2 class="empty__title" id="empty-zones">
                No zones in {{ store.selectedProject()?.name }} yet
              </h2>
              <p class="empty__text">
                A zone is a place in your app or site where tales show. Create
                one to add frames and tale groups.
              </p>
              <button
                type="button"
                class="btn btn--primary"
                (click)="store.openDrawer({ kind: 'zone' }, $event)"
              >
                <app-icon name="plus" /> New zone
              </button>
            </section>
          }
        } @else {
          <ul class="card-grid" aria-label="Zones">
            @for (zone of store.projectZones(); track zone.id) {
              <li>
                <div class="card zone-card">
                  <a class="zone-card__name" [routerLink]="['/zones', zone.id]">{{ zone.name }}</a>
                  <app-visibility [visibility]="zone.visibility" viewing="zone" />
                  @if (store.framesOf(zone.id).length > 0) {
                    <ul class="pill-list" aria-label="Frame types">
                      @for (frame of store.framesOf(zone.id); track frame.id) {
                        <li class="pill">
                          {{ store.frameTypeLabel(frame.type) }}
                        </li>
                      }
                    </ul>
                  } @else {
                    <span class="muted">No frames yet</span>
                  }
                  <span class="zone-card__meta">
                    <app-icon name="tales" />
                    {{ groupCountLabel(zone.id) }}
                  </span>
                </div>
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
})
export class ZonesPage {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);

  protected groupCountLabel(zoneId: string): string {
    const count = this.store.taleGroupsOf(zoneId).length;
    return `${count} tale ${count === 1 ? 'group' : 'groups'}`;
  }
}
