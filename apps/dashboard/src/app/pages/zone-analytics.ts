import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import {
  analyticsPeriodDays,
  DEFAULT_ANALYTICS_PERIOD,
  isAnalyticsPeriod,
  isErrorBody,
  ANALYTICS_PERIODS,
  type AnalyticsDay,
  type AnalyticsGroupRow,
  type AnalyticsPeriod,
  type AnalyticsTaleRow,
  type AnalyticsTotals,
  type ZoneAnalytics,
} from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import {
  ANALYTICS_DEFINITIONS_PATH,
  ANALYTICS_METRIC_DEFINITIONS,
  ANALYTICS_PERIOD_NOTE,
  ANALYTICS_REACH_NOTE,
} from './analytics-definitions';

/** The query parameter that holds the period, such as `?period=7d`; the default is left out. */
export const ANALYTICS_PERIOD_PARAM = 'period';

/** The period labels of the picker. */
const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

/** The chart's drawing box, in SVG user units; the chart scales to its container's width. */
const CHART = { width: 640, height: 240, left: 44, right: 12, top: 12, bottom: 28 };

const COUNT = new Intl.NumberFormat('en-US');
const PERCENT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const DAY_LONG = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** A count, with thousands separators. */
export function formatCount(value: number): string {
  return COUNT.format(value);
}

/** A percentage with one decimal and its sign, such as "33.3%". */
export function formatPercent(value: number): string {
  return `${PERCENT.format(value)}%`;
}

/** The totals are all zero: nothing has been counted in the period, so the empty state shows. */
export function hasNoEvents(totals: AnalyticsTotals): boolean {
  return totals.impressions === 0 && totals.opens === 0 && totals.taleViews === 0 && totals.clicks === 0;
}

/** A UTC day's label, such as "Oct 12", from its `YYYY-MM-DD` date. */
export function dayLabel(date: string): string {
  return DAY.format(new Date(`${date}T00:00:00Z`));
}

/** The upper bound of the chart's y axis: the largest count, rounded up to a 1, 2 or 5 step. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return value;
}

/** One chart point: where a day sits in the SVG, and its counts. */
export interface ChartPoint {
  date: string;
  label: string;
  impressions: number;
  clicks: number;
  x: number;
  impressionsY: number;
  clicksY: number;
  /** The hover band of the day: its left edge and width. */
  bandX: number;
  bandWidth: number;
}

/** The chart's geometry for a daily series, or no points for an empty one. */
export function chartPoints(days: readonly AnalyticsDay[], max: number): ChartPoint[] {
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const count = days.length;
  const band = count > 0 ? plotWidth / count : 0;
  const y = (value: number) => CHART.top + plotHeight - (value / max) * plotHeight;
  return days.map((day, index) => {
    const x = count > 1 ? CHART.left + (index * plotWidth) / (count - 1) : CHART.left + plotWidth / 2;
    return {
      date: day.date,
      label: dayLabel(day.date),
      impressions: day.impressions,
      clicks: day.clicks,
      x,
      impressionsY: y(day.impressions),
      clicksY: y(day.clicks),
      bandX: CHART.left + index * band,
      bandWidth: band,
    };
  });
}

/** An SVG polyline's `points` attribute for one series. */
export function linePath(points: readonly ChartPoint[], key: 'impressions' | 'clicks'): string {
  return points
    .map((p) => `${p.x.toFixed(1)},${(key === 'impressions' ? p.impressionsY : p.clicksY).toFixed(1)}`)
    .join(' ');
}

/** The API's message when it sent the standard error body, else the fallback. */
function readError(err: unknown): string {
  if (err instanceof HttpErrorResponse && err.status === 0)
    return 'The analytics could not be read. Check the connection.';
  if (err instanceof HttpErrorResponse && isErrorBody(err.error)) return err.error.error.message;
  return 'The analytics could not be read. Try again.';
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ZoneAnalytics };

/**
 * The zone page's Analytics tab (analytics epic, spec "Dashboard"): a period picker (the period is
 * in the URL, `?period=`), seven metric tiles with each published definition, a daily chart of
 * impressions and clicks with a table alternative, tables by tale group and by tale, and an empty
 * state while nothing has been counted. It reads the zone's analytics only while the tab is shown,
 * and again when the period changes; a reply that comes late for an earlier period is dropped.
 */
@Component({
  selector: 'app-zone-analytics',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './zone-analytics.html',
  styleUrls: ['./zone-analytics.css'],
})
export class ZoneAnalyticsPanel {
  private readonly http = inject(HttpClient);
  private readonly store = inject(DashboardStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** The zone whose analytics are read. */
  readonly zoneId = input.required<string>();
  /** The `?period=` query parameter, as typed in the URL; an unknown value reads as the default. */
  readonly period = input<string | undefined>();
  /** Whether the tab is shown: nothing is read while it is not. */
  readonly active = input(false);

  protected readonly periods = ANALYTICS_PERIODS;
  protected readonly periodLabels = PERIOD_LABELS;
  protected readonly periodNote = ANALYTICS_PERIOD_NOTE;
  protected readonly reachNote = ANALYTICS_REACH_NOTE;
  protected readonly definitionsPath = ANALYTICS_DEFINITIONS_PATH;
  protected readonly definitions = ANALYTICS_METRIC_DEFINITIONS;
  protected readonly chart = CHART;
  protected readonly formatCount = formatCount;
  protected readonly formatPercent = formatPercent;
  protected readonly dayLabel = dayLabel;
  protected readonly dayLong = (date: string) => DAY_LONG.format(new Date(`${date}T00:00:00Z`));

  /** The period shown: the URL's, changed at once by the picker. */
  protected readonly picked = linkedSignal<AnalyticsPeriod>(() => {
    const value = this.period();
    return isAnalyticsPeriod(value) ? value : DEFAULT_ANALYTICS_PERIOD;
  });
  protected readonly state = signal<LoadState>({ status: 'loading' });
  /** What the polite live region last said about the analytics; cleared when the zone changes. */
  protected readonly announcement = signal('');
  /** The day under the pointer on the chart, or null. */
  protected readonly hovered = signal<number | null>(null);

  /** The tale group names, by id, for the tale table's group column. */
  private readonly groupNames = computed(
    () => new Map(this.store.taleGroupsOf(this.zoneId()).map((group) => [group.id, group.name] as const)),
  );

  protected readonly data = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? state.data : null;
  });
  protected readonly empty = computed(() => {
    const data = this.data();
    return !!data && hasNoEvents(data.totals);
  });
  /** The seven tiles, in the order the spec names them. */
  protected readonly tiles = computed(() => {
    const data = this.data();
    if (!data) return [];
    const t = data.totals;
    const d = this.definitions;
    return [
      { key: 'impressions', ...d.impressions, value: formatCount(t.impressions) },
      { key: 'reach', ...d.reach, value: formatCount(t.reach) },
      { key: 'opens', ...d.opens, value: formatCount(t.opens) },
      { key: 'taleViews', ...d.taleViews, value: formatCount(t.taleViews) },
      { key: 'clicks', ...d.clicks, value: formatCount(t.clicks) },
      { key: 'engagementRate', ...d.engagementRate, value: formatPercent(t.engagementRate) },
      { key: 'ctr', ...d.ctr, value: formatPercent(t.ctr) },
    ];
  });
  protected readonly points = computed(() => {
    const days = this.data()?.daily ?? [];
    const max = niceMax(Math.max(0, ...days.map((day) => Math.max(day.impressions, day.clicks))));
    return { max, list: chartPoints(days, max) };
  });
  protected readonly yTicks = computed(() => {
    const max = this.points().max;
    const plotHeight = CHART.height - CHART.top - CHART.bottom;
    return [0, 1, 2, 3, 4].map((step) => {
      const value = (max * step) / 4;
      return { value: formatCount(value), y: CHART.top + plotHeight - (step / 4) * plotHeight };
    });
  });
  protected readonly xLabelIndexes = computed(() => {
    const count = this.points().list.length;
    return new Set([0, Math.floor((count - 1) / 2), count - 1].filter((i) => i >= 0));
  });
  protected readonly errorMessage = computed(() => {
    const state = this.state();
    return state.status === 'error' ? state.message : '';
  });
  protected readonly impressionsLine = computed(() => linePath(this.points().list, 'impressions'));
  protected readonly clicksLine = computed(() => linePath(this.points().list, 'clicks'));
  protected readonly chartLabel = computed(() => {
    const days = this.data()?.daily ?? [];
    if (days.length === 0) return 'Line chart of daily impressions and clicks: no days';
    return `Line chart of daily impressions and clicks, ${dayLabel(days[0].date)} to ${dayLabel(days[days.length - 1].date)}`;
  });
  /** The hovered day's tooltip, placed at its x as a share of the chart's width. */
  protected readonly tooltip = computed(() => {
    const index = this.hovered();
    const point = index === null ? undefined : this.points().list[index];
    if (!point) return null;
    return {
      x: point.x,
      left: (point.x / CHART.width) * 100,
      alignEnd: point.x > CHART.width * 0.7,
      label: this.dayLong(point.date),
      impressions: formatCount(point.impressions),
      clicks: formatCount(point.clicks),
    };
  });

  /** The tale group rows, most impressions first, as the API sends them. */
  protected readonly groupRows = computed<AnalyticsGroupRow[]>(() => this.data()?.groups ?? []);
  /** The tale rows; a tale's impressions, reach, opens and engagement are null, shown as a dash. */
  protected readonly taleRows = computed<AnalyticsTaleRow[]>(() => this.data()?.tales ?? []);
  protected groupName(groupId: string): string {
    return this.groupNames().get(groupId) ?? '';
  }

  /** The zone and period last read: a second read of the same pair is skipped while it shows. */
  private loadedKey = '';
  /** Bumped per read, so a reply to an earlier read is dropped. */
  private requestId = 0;

  constructor() {
    effect(() => {
      const zoneId = this.zoneId();
      const period = this.picked();
      if (!this.active()) return;
      const key = `${zoneId}|${period}`;
      if (key === this.loadedKey) return;
      untracked(() => void this.load(zoneId, period));
    });
  }

  /** Changes the period: the picker's value, then the URL (`?period=`, the default left out). */
  protected changePeriod(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isAnalyticsPeriod(value) || value === this.picked()) return;
    this.picked.set(value);
    this.announcement.set(`Showing ${PERIOD_LABELS[value].toLowerCase()}`);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [ANALYTICS_PERIOD_PARAM]: value === DEFAULT_ANALYTICS_PERIOD ? null : value },
      queryParamsHandling: 'merge',
    });
  }

  /** Reads the analytics again, after an error. */
  protected retry(): void {
    this.loadedKey = '';
    void this.load(this.zoneId(), this.picked());
  }

  private async load(zoneId: string, period: AnalyticsPeriod): Promise<void> {
    const id = ++this.requestId;
    this.loadedKey = `${zoneId}|${period}`;
    this.state.set({ status: 'loading' });
    this.hovered.set(null);
    this.announcement.set('Loading analytics');
    try {
      const data = await firstValueFrom(
        this.http.get<ZoneAnalytics>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/analytics`, {
          params: { period },
        }),
      );
      if (id !== this.requestId) return;
      this.state.set({ status: 'ready', data });
      this.announcement.set(`Analytics for the ${analyticsPeriodDays(period)} days loaded`);
    } catch (err) {
      if (id !== this.requestId) return;
      this.loadedKey = '';
      const message = readError(err);
      this.state.set({ status: 'error', message });
      this.announcement.set(message);
    }
  }
}
