import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardStore } from './dashboard.store';

/**
 * "New tale group": makes the group with its draft first tale, then opens Tale Studio on that tale.
 * The group's options (name, zone) come after the studio is left, see `pendingGroupOptions`.
 */
@Injectable({ providedIn: 'root' })
export class NewTaleGroupFlow {
  private readonly store = inject(DashboardStore);
  private readonly router = inject(Router);
  private starting = false;

  /**
   * Starts a group in `zoneId`, or in no zone of `projectId` when `zoneId` is ''. `from` is the
   * Tale groups page, where the studio's back link returns. A failure stays on the page as
   * `newGroupNotice`; a second press while one is starting does nothing.
   */
  async start(projectId: string, zoneId = '', from?: 'tale-groups'): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.store.newGroupNotice.set('');
    try {
      const started = await this.store.startNewTaleGroup(projectId, zoneId);
      if (typeof started === 'string') {
        this.store.newGroupNotice.set(started);
        return;
      }
      await this.router.navigate(['/tales', started.taleId, 'studio'], {
        queryParams: { newGroup: started.taleGroupId, zone: zoneId || null, from: from ?? null },
      });
    } finally {
      this.starting = false;
    }
  }
}
