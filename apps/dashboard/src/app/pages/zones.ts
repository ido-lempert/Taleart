import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Zone } from '@taleart/contract/core';
import { AuthStore } from '../auth';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { visibilityMark, type VisibilityMark } from '../visibility';
import { StatusMarker } from '../status-marker';
import { zoneInstalled } from '../zone-setup';
import { ZonePreview } from './zone-preview';

/**
 * The selected project's zones as cards (epic UX rework R14): each with its name, indicator (R7),
 * slug, and a summary like the zone page header's: display type, group count, and Installed or Not
 * installed (an active site key, R3), the last left out while the zone's visibility is unknown.
 */
@Component({
  selector: 'app-zones-page',
  imports: [RouterLink, Icon, StatusMarker, ZonePreview],
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
    .zone-card__head {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
    }
    .zone-card__type {
      display: inline-flex;
      flex: none;
      color: var(--text-secondary);
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
    /* Beside the name; above the name's link, which covers the card. */
    .zone-card app-status-marker {
      z-index: 1;
    }
    .zone-card__slug {
      align-self: flex-start;
      overflow-wrap: anywhere;
    }
    .zone-card__summary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin: auto 0 0;
      padding: 0;
      list-style: none;
    }
    .zone-card__summary .pill {
      overflow-wrap: anywhere;
    }
    .pill--muted {
      color: var(--text-secondary);
    }
    /* Above the name's link, which covers the card. */
    .zone-card__preview {
      align-self: flex-start;
      position: relative;
      z-index: 1;
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
              @if (store.firstProjectRefusal(); as refusal) {
                <p class="form-error" role="alert">Your first project was not created: {{ refusal }}</p>
              }
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
                A zone is one spot in your app or site where tales show. Create
                one, then choose its display and add tale groups.
              </p>
              @if (store.can('zones.manage')) {
                <button
                  type="button"
                  class="btn btn--primary"
                  (click)="store.openDrawer({ kind: 'zone' }, $event)"
                >
                  <app-icon name="plus" /> New zone
                </button>
              } @else {
                <p class="muted" id="zones-need-role">{{ store.roleNeeded('zones.manage') }} Ask an admin of the project.</p>
              }
            </section>
          }
        } @else {
          <ul class="card-grid" aria-label="Zones">
            @for (zone of store.projectZones(); track zone.id) {
              <li>
                <div class="card zone-card">
                  <div class="zone-card__head">
                    @if (zone.frame; as frame) {
                      <span
                        class="zone-card__type"
                        role="img"
                        [attr.aria-label]="'Display: ' + store.frameTypeLabel(frame.type)"
                        [attr.title]="store.frameTypeLabel(frame.type)"
                      >
                        <app-icon name="zone" [size]="28" />
                      </span>
                    }
                    <a class="zone-card__name" [routerLink]="['/zones', zone.id]">{{ zone.name }}</a>
                    @if (markOf(zone); as mark) {
                      <app-status-marker [tone]="mark.tone" [text]="mark.text" />
                    }
                  </div>
                  <span class="zone-card__slug"><span class="visually-hidden">Slug </span><code class="key-prefix">{{ zone.slug }}</code></span>
                  <ul class="zone-card__summary" [attr.aria-label]="'Summary of ' + zone.name">
                    @if (!zone.frame) {
                      <li class="pill pill--muted" data-summary="display">
                        <span class="visually-hidden">Display: </span>No display yet
                      </li>
                    }
                    <li class="pill" data-summary="groups">{{ groupCountLabel(zone.id) }}</li>
                    @if (installed(zone); as state) {
                      <li class="pill" data-summary="install" [class.pill--muted]="state === 'Not installed'">
                        <span class="visually-hidden">Install: </span>{{ state }}
                      </li>
                    }
                  </ul>
                  <button
                    type="button"
                    class="btn btn--secondary btn--sm zone-card__preview"
                    [id]="'preview-zone-' + zone.id"
                    [attr.aria-label]="'Preview zone ' + zone.name"
                    [attr.aria-disabled]="zone.frame ? null : 'true'"
                    [attr.title]="zone.frame ? null : 'Set up its display to preview it'"
                    (click)="previewZone(zone, $event)"
                  >
                    <app-icon name="eye" /> Preview
                  </button>
                </div>
              </li>
            }
          </ul>
        }
      }
      @if (preview(); as p) {
        <app-zone-preview
          [zone]="p.zone"
          [groups]="store.taleGroupsOf(p.zone.id)"
          [label]="p.label"
          [returnFocus]="p.opener"
          (closed)="preview.set(null)"
        />
      }
    </div>
  `,
})
export class ZonesPage {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);
  /** The zone preview open, with the button that opened it; one at a time. */
  protected readonly preview = signal<{ zone: Zone; label: string; opener: HTMLElement } | null>(null);

  /** Opens the zone's Preview, as a visitor's page shows its display and groups; a zone with no display is not previewed. */
  protected previewZone(zone: Zone, event: Event): void {
    if (zone.frame) {
      this.preview.set({ zone, label: `Preview of ${zone.name}`, opener: event.currentTarget as HTMLElement });
    }
  }

  /** The marker beside the zone's name: its visibility, as its tooltip says it (R7). */
  protected markOf(zone: Zone): VisibilityMark | null {
    return visibilityMark(zone.visibility, 'zone');
  }

  /** "Installed" or "Not installed", as the zone page header says it; '' while unknown. */
  protected installed(zone: Zone): string {
    const installed = zoneInstalled(zone);
    return installed === null ? '' : installed ? 'Installed' : 'Not installed';
  }

  protected groupCountLabel(zoneId: string): string {
    const count = this.store.taleGroupsOf(zoneId).length;
    return `${count} tale ${count === 1 ? 'group' : 'groups'}`;
  }
}
