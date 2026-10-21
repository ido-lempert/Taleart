import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../auth';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';

/**
 * The caller's projects as cards; opening one makes it the selected project.
 * Admins also get "Invite" and "Import from Storyly" on each card and can create projects.
 */
@Component({
  selector: 'app-projects-page',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .project-card {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4) var(--space-3) var(--space-2);
      transition: border-color 120ms ease;
    }
    .project-card__open {
      display: flex;
      flex: 1;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
      padding: var(--space-2) var(--space-3);
      border: 0;
      border-radius: var(--radius-control);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .project-card:hover {
      border-color: var(--border-strong);
    }
    .project-card:has([aria-current='true']) {
      border-color: var(--ember);
    }
    .project-card__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--space-2);
    }
    .project-card__name {
      display: block;
      font-size: var(--text-lg);
      font-weight: 600;
    }
  `,
  template: `
    <div class="page">
      @if (store.loaded()) {
        @if (store.projects().length > 0) {
          <ul class="card-grid" aria-label="Projects">
            @for (project of store.projects(); track project.id) {
              <li class="card project-card">
                <button
                  type="button"
                  class="project-card__open"
                  [attr.aria-current]="project.id === store.selectedProjectId() ? 'true' : null"
                  (click)="open(project.id)"
                >
                  <span class="avatar avatar--lg" aria-hidden="true">{{ project.name.charAt(0) }}</span>
                  <span>
                    <span class="project-card__name">{{ project.name }}</span>
                    <span class="muted">{{ zoneCountLabel(project.id) }}</span>
                  </span>
                </button>
                <span class="project-card__actions">
                  <a
                    class="btn btn--secondary btn--sm"
                    [routerLink]="['/projects', project.id, 'theme']"
                    [attr.aria-label]="'Theme of ' + project.name"
                  >
                    Theme
                  </a>
                  <a
                    class="btn btn--secondary btn--sm"
                    [routerLink]="['/projects', project.id, 'fonts']"
                    [attr.aria-label]="'Fonts of ' + project.name"
                  >
                    Fonts
                  </a>
                  @if (auth.isAdmin()) {
                    <button
                      type="button"
                      class="btn btn--secondary btn--sm"
                      [attr.aria-label]="'Invite to ' + project.name"
                      (click)="store.openDrawer({ kind: 'invite', projectId: project.id }, $event)"
                    >
                      Invite
                    </button>
                    <a
                      class="btn btn--secondary btn--sm"
                      [routerLink]="['/projects', project.id, 'import']"
                      [attr.aria-label]="'Import from Storyly into ' + project.name"
                    >
                      Import from Storyly
                    </a>
                  }
                </span>
              </li>
            }
          </ul>
        } @else if (!store.apiDown() && !auth.isAdmin()) {
          <section class="card empty" aria-labelledby="empty-projects">
            <span class="empty__icon"><app-icon name="projects" /></span>
            <h2 class="empty__title" id="empty-projects">No projects yet</h2>
            <p class="empty__text">You are not a member of any project. Ask an admin to invite you.</p>
          </section>
        } @else if (!store.apiDown()) {
          <section class="card empty" aria-labelledby="empty-projects">
            <span class="empty__icon"><app-icon name="projects" /></span>
            <h2 class="empty__title" id="empty-projects">Create your first project</h2>
            <p class="empty__text">A project holds your zones, tale groups and tales. Start with one for your app or site.</p>
            <button type="button" class="btn btn--primary" (click)="store.openDrawer({ kind: 'project' }, $event)">
              <app-icon name="plus" /> New project
            </button>
          </section>
        }
      }
    </div>
  `,
})
export class ProjectsPage {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected zoneCountLabel(projectId: string): string {
    const count = this.store.zones().filter((z) => z.projectId === projectId).length;
    return `${count} ${count === 1 ? 'zone' : 'zones'}`;
  }

  protected open(projectId: string): void {
    this.store.selectProject(projectId);
    void this.router.navigateByUrl('/zones');
  }
}
