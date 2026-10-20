import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MAX_TALES_PER_GROUP } from '@taleart/contract';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';

const TONES = 6;

/** One zone: its frames and its tale groups, each a row of 9:16 tale cards. */
@Component({
  selector: 'app-zone-detail-page',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './zone-detail.html',
  styles: `
    .group {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      min-width: 0;
      padding: var(--space-4) 0;
      border-top: 1px solid var(--border);
    }
    .group:first-child {
      padding-top: 0;
      border-top: 0;
    }
    .group__header {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .group__name {
      font-size: var(--text-md);
      font-weight: 600;
    }
    .groups {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .zone-section {
      min-width: 0;
    }
  `,
})
export class ZoneDetailPage {
  protected readonly store = inject(DashboardStore);
  /** Bound from the `:zoneId` route parameter. */
  readonly zoneId = input.required<string>();

  protected readonly maxTales = MAX_TALES_PER_GROUP;
  protected readonly zone = computed(() => this.store.zone(this.zoneId()));
  protected readonly frames = computed(() => this.store.framesOf(this.zoneId()));
  protected readonly groups = computed(() => this.store.taleGroupsOf(this.zoneId()));

  /** A stable placeholder tone for a tale, derived from its id. */
  protected tone(id: string): number {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % TONES;
  }
}
