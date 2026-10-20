import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';

/** Every project as a card; opening one makes it the selected project. */
@Component({
  selector: 'app-projects-page',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .project-card {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      padding: var(--space-5);
      text-align: left;
      cursor: pointer;
      transition: border-color 120ms ease;
    }
    .project-card:hover {
      border-color: var(--border-strong);
    }
    .project-card[aria-current='true'] {
      border-color: var(--ember);
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
              <li>
                <button
                  type="button"
                  class="card project-card"
                  [attr.aria-current]="project.id === store.selectedProjectId() ? 'true' : null"
                  (click)="open(project.id)"
                >
                  <span class="avatar avatar--lg" aria-hidden="true">{{ project.name.charAt(0) }}</span>
                  <span>
                    <span class="project-card__name">{{ project.name }}</span>
                    <span class="muted">{{ zoneCountLabel(project.id) }}</span>
                  </span>
                </button>
              </li>
            }
          </ul>
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
