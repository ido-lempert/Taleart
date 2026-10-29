import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import type { ZoneAnalytics } from '@taleart/contract/core';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { ANALYTICS_METRIC_DEFINITIONS, ANALYTICS_REACH_NOTE } from './analytics-definitions';
import { chartPoints, formatCount, formatPercent, hasNoEvents, niceMax, ZoneAnalyticsPanel } from './zone-analytics';

// Mock data: a zone's analytics as the Management API answers them (contract ZoneAnalytics).
function analyticsDay(date: string, impressions: number, clicks: number) {
  return { date, impressions, clicks, opens: 0, taleViews: 0 };
}

function analyticsFixture(overrides: Partial<ZoneAnalytics> = {}): ZoneAnalytics {
  const daily = [
    analyticsDay('2026-10-22', 100, 4),
    analyticsDay('2026-10-23', 0, 0),
    analyticsDay('2026-10-24', 250, 20),
    analyticsDay('2026-10-25', 80, 6),
    analyticsDay('2026-10-26', 90, 9),
    analyticsDay('2026-10-27', 300, 30),
    analyticsDay('2026-10-28', 1234, 100),
  ];
  return {
    period: '7d',
    totals: {
      impressions: 1234,
      reach: 456,
      opens: 789,
      taleViews: 300,
      clicks: 75,
      engagementRate: 33.3,
      ctr: 25,
    },
    daily,
    groups: [
      {
        groupId: 'g1',
        name: 'Summer sale',
        impressions: 1000,
        reach: 400,
        opens: 700,
        taleViews: 250,
        clicks: 60,
        engagementRate: 40.5,
        ctr: 24,
      },
      {
        groupId: 'g2',
        name: 'Winter',
        impressions: 234,
        reach: 56,
        opens: 89,
        taleViews: 50,
        clicks: 15,
        engagementRate: 0,
        ctr: 30,
      },
    ],
    tales: [
      {
        taleId: 't1',
        name: 'Hello tale',
        groupId: 'g1',
        impressions: null,
        reach: null,
        opens: null,
        taleViews: 200,
        clicks: 50,
        engagementRate: null,
        ctr: 25,
      },
      {
        taleId: 't2',
        name: 'Second tale',
        groupId: 'g2',
        impressions: null,
        reach: null,
        opens: null,
        taleViews: 100,
        clicks: 25,
        engagementRate: null,
        ctr: 25,
      },
    ],
    ...overrides,
  };
}

const emptyFixture = (): ZoneAnalytics =>
  analyticsFixture({
    period: '30d',
    totals: { impressions: 0, reach: 0, opens: 0, taleViews: 0, clicks: 0, engagementRate: 0, ctr: 0 },
    daily: [analyticsDay('2026-10-28', 0, 0)],
    groups: [],
    tales: [],
  });

const url = (period: string) => `${API_BASE}/zones/z1/analytics?period=${period}`;

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('ZoneAnalyticsPanel: the Analytics tab (analytics epic, spec Dashboard)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ZoneAnalyticsPanel>;
  let router: Router;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const tile = (key: string) => root().querySelector<HTMLElement>(`[data-metric="${key}"]`);
  const tileValue = (key: string) => tile(key)?.querySelector('.analytics-tile__value')?.textContent?.trim();
  const select = () => root().querySelector<HTMLSelectElement>('#analytics-period');
  const picker = () => select() as HTMLSelectElement;

  async function open(
    options: { period?: string; active?: boolean; answer?: ZoneAnalytics | null; status?: number } = {},
  ): Promise<TestRequest> {
    fixture = TestBed.createComponent(ZoneAnalyticsPanel);
    fixture.componentRef.setInput('zoneId', 'z1');
    fixture.componentRef.setInput('period', options.period);
    fixture.componentRef.setInput('active', options.active ?? true);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
    const request = http.expectOne((req) => req.url === `${API_BASE}/zones/z1/analytics`);
    expect(request.request.params.get('period')).toBe(
      options.period && ['7d', '90d'].includes(options.period) ? options.period : '30d',
    );
    if (options.status) {
      request.flush(
        { error: { code: 'internal', message: 'The analytics are down.' } },
        { status: options.status, statusText: 'Error' },
      );
    } else {
      request.flush(options.answer === undefined ? analyticsFixture() : options.answer);
    }
    await settle(fixture);
    return request;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ZoneAnalyticsPanel],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  describe('metric tiles', () => {
    it('shows seven tiles in a grid, with counts and percentages formatted', async () => {
      await open();
      const tiles = root().querySelectorAll('.analytics-tile');
      expect(tiles.length).toBe(7);
      expect(tileValue('impressions')).toBe('1,234');
      expect(tileValue('reach')).toBe('456');
      expect(tileValue('opens')).toBe('789');
      expect(tileValue('taleViews')).toBe('300');
      expect(tileValue('clicks')).toBe('75');
      expect(tileValue('engagementRate')).toBe('33.3%');
      expect(tileValue('ctr')).toBe('25.0%');
    });

    it('names each tile by its label, with the definition as a disclosure', async () => {
      await open();
      expect([...root().querySelectorAll('.analytics-tile__label')].map((el) => el.textContent?.trim())).toEqual([
        'Impressions',
        'Reach',
        'Opens',
        'Tale views',
        'Clicks',
        'Engagement rate',
        'CTR (click-through rate)',
      ]);
      const summary = tile('reach')?.querySelector('summary');
      expect(summary?.textContent?.trim()).toBe('Definition of Reach');
    });

    it('carries the published definition text of every metric, verbatim from the shared constants', async () => {
      await open();
      for (const metric of Object.keys(ANALYTICS_METRIC_DEFINITIONS) as (keyof typeof ANALYTICS_METRIC_DEFINITIONS)[]) {
        const definition = ANALYTICS_METRIC_DEFINITIONS[metric].definition;
        expect(text(), metric).toContain(definition);
      }
      expect(ANALYTICS_METRIC_DEFINITIONS.reach.definition).toBe(
        'Distinct visitors with at least one impression in the period.',
      );
      expect(ANALYTICS_METRIC_DEFINITIONS.engagementRate.definition).toContain('the rate never exceeds 100');
      expect(ANALYTICS_METRIC_DEFINITIONS.ctr.definition).toBe(
        'Clicks ÷ Tale views, as a percentage, one decimal. 0 when there are no views.',
      );
    });

    it('says Reach is not summed across rows, under the tables', async () => {
      await open();
      expect(text()).toContain(ANALYTICS_REACH_NOTE);
    });

    it('links to the published definitions in the docs', async () => {
      await open();
      const links = [...root().querySelectorAll<HTMLAnchorElement>('a[href="/reference/analytics"]')];
      expect(links.length).toBeGreaterThan(0);
      expect(links[0].textContent?.trim()).toBe('Metric definitions in the docs');
    });
  });

  describe('period', () => {
    it('defaults to 30 days, with the picker labelled Period', async () => {
      await open({ period: undefined });
      expect(select()?.value).toBe('30d');
      expect(root().querySelector('label[for="analytics-period"]')?.textContent?.trim()).toBe('Period');
    });

    it('reads the period named in the URL', async () => {
      await open({ period: '7d' });
      expect(select()?.value).toBe('7d');
    });

    it('reads the default for an unknown period in the URL', async () => {
      await open({ period: 'forever' });
      expect(select()?.value).toBe('30d');
    });

    it('reads the zone again for the period picked, and puts it in the URL', async () => {
      await open({ period: undefined });
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      picker().value = '90d';
      picker().dispatchEvent(new Event('change'));
      fixture.detectChanges();
      http.expectOne(url('90d')).flush(analyticsFixture({ period: '90d' }));
      await settle(fixture);
      expect(navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { period: '90d' }, queryParamsHandling: 'merge' }),
      );
      expect(text()).toContain('Last 90 days');
    });

    it('leaves the default out of the URL', async () => {
      await open({ period: '7d' });
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      picker().value = '30d';
      picker().dispatchEvent(new Event('change'));
      fixture.detectChanges();
      http.expectOne(url('30d')).flush(analyticsFixture({ period: '30d' }));
      await settle(fixture);
      expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { period: null } }));
    });

    it('reads the zone again when the period in the URL changes', async () => {
      const first = await open({ period: undefined });
      expect(first.request.params.get('period')).toBe('30d');
      fixture.componentRef.setInput('period', '7d');
      fixture.detectChanges();
      http.expectOne(url('7d')).flush(analyticsFixture({ period: '7d' }));
      await settle(fixture);
      expect(select()?.value).toBe('7d');
    });
  });

  describe('reading', () => {
    it('reads nothing while the tab is not shown, and reads once it is', async () => {
      fixture = TestBed.createComponent(ZoneAnalyticsPanel);
      fixture.componentRef.setInput('zoneId', 'z1');
      fixture.componentRef.setInput('active', false);
      fixture.detectChanges();
      await settle(fixture);
      http.expectNone(url('30d'));
      fixture.componentRef.setInput('active', true);
      fixture.detectChanges();
      await settle(fixture);
      http.expectOne(url('30d')).flush(analyticsFixture({ period: '30d' }));
      await settle(fixture);
      expect(tileValue('impressions')).toBe('1,234');
    });

    it('reads the zone again after an error, from Try again', async () => {
      await open({ status: 500 });
      const retry = root().querySelector<HTMLButtonElement>('#analytics-retry');
      expect(retry).not.toBeNull();
      (retry as HTMLButtonElement).click();
      fixture.detectChanges();
      http.expectOne(url('30d')).flush(analyticsFixture());
      await settle(fixture);
      expect(tileValue('clicks')).toBe('75');
    });
  });

  describe('loading and error states', () => {
    it('says it is loading before the answer comes, with the live region announcing it', async () => {
      fixture = TestBed.createComponent(ZoneAnalyticsPanel);
      fixture.componentRef.setInput('zoneId', 'z1');
      fixture.componentRef.setInput('active', true);
      document.body.appendChild(root());
      fixture.detectChanges();
      await settle(fixture);
      expect(root().querySelector('[data-state=loading]')?.textContent?.trim()).toBe('Loading analytics…');
      expect(root().querySelector('[aria-live=polite]')?.textContent?.trim()).toBe('Loading analytics');
      expect(tile('impressions')).toBeNull();
      http.expectOne(url('30d')).flush(analyticsFixture());
      await settle(fixture);
      expect(root().querySelector('[data-state=loading]')).toBeNull();
      expect(root().querySelector('[aria-live=polite]')?.textContent?.trim()).toBe('Analytics for the 30 days loaded');
    });

    it('shows the API message in an alert, with Try again, and no tiles', async () => {
      await open({ status: 500 });
      const alert = root().querySelector('[role=alert]');
      expect(alert?.textContent).toContain('The analytics are down.');
      expect(root().querySelector('#analytics-retry')?.textContent?.trim()).toBe('Try again');
      expect(tile('impressions')).toBeNull();
    });

    it('explains a failed read without a message from the API', async () => {
      fixture = TestBed.createComponent(ZoneAnalyticsPanel);
      fixture.componentRef.setInput('zoneId', 'z1');
      fixture.componentRef.setInput('active', true);
      document.body.appendChild(root());
      fixture.detectChanges();
      await settle(fixture);
      http.expectOne(url('30d')).flush('down', { status: 503, statusText: 'Unavailable' });
      await settle(fixture);
      expect(root().querySelector('[role=alert]')?.textContent).toContain(
        'The analytics could not be read. Try again.',
      );
    });
  });

  describe('empty state', () => {
    it('shows when every total is zero: how data arrives, and how to turn it off', async () => {
      await open({ answer: emptyFixture() });
      expect(root().querySelector('[data-state=empty]')).not.toBeNull();
      expect(tile('impressions')).toBeNull();
      expect(text()).toContain(
        'Analytics arrive from the Web SDK once this zone is placed on a page and visitors see it.',
      );
      const code = [...root().querySelectorAll('code')].map((el) => el.textContent);
      expect(code).toContain('analytics="off"');
      expect(code).toContain('Taleart.init({ analytics: false })');
      expect(root().querySelector('[data-state=empty]')?.querySelector('a')?.getAttribute('href')).toBe(
        '/reference/analytics',
      );
    });

    it('is not shown when a total is above zero', async () => {
      await open({
        answer: analyticsFixture({
          totals: {
            ...analyticsFixture().totals,
            clicks: 0,
            taleViews: 0,
            opens: 0,
            impressions: 5,
            reach: 1,
            engagementRate: 0,
            ctr: 0,
          },
        }),
      });
      expect(root().querySelector('[data-state=empty]')).toBeNull();
      expect(tileValue('impressions')).toBe('5');
    });

    it('hasNoEvents looks at impressions, opens, tale views and clicks', () => {
      const zero = emptyFixture().totals;
      expect(hasNoEvents(zero)).toBe(true);
      expect(hasNoEvents({ ...zero, opens: 1 })).toBe(false);
      expect(hasNoEvents({ ...zero, taleViews: 1 })).toBe(false);
    });
  });

  describe('tables', () => {
    it('shows a tale row with a dash in each metric the tale does not count', async () => {
      TestBed.inject(DashboardStore).taleGroups.set({
        z1: [
          { id: 'g1', name: 'Summer sale' },
          { id: 'g2', name: 'Winter' },
        ] as never[],
      });
      await open();
      const rows = [...root().querySelectorAll('#analytics-tales-title ~ .analytics-table-scroll tbody tr')];
      expect(rows.length).toBe(2);
      const cells = [...rows[0].querySelectorAll('th, td')].map((cell) => cell.textContent?.trim());
      expect(cells).toEqual(['Hello tale', 'Summer sale', '–', '–', '–', '200', '50', '–', '25.0%']);
    });

    it('shows every group column for a tale group', async () => {
      await open();
      const rows = [...root().querySelectorAll('#analytics-groups-title ~ .analytics-table-scroll tbody tr')];
      expect(rows.length).toBe(2);
      expect([...rows[0].querySelectorAll('th, td')].map((cell) => cell.textContent?.trim())).toEqual([
        'Summer sale',
        '1,000',
        '400',
        '700',
        '250',
        '60',
        '40.5%',
        '24.0%',
      ]);
    });

    it('names each table, with its headers as column headers', async () => {
      await open();
      const tables = [...root().querySelectorAll('table.analytics-table')];
      expect(tables.length).toBe(2);
      expect(tables.map((table) => table.getAttribute('aria-labelledby'))).toEqual([
        'analytics-groups-title',
        'analytics-tales-title',
      ]);
      const headers = [...tables[1].querySelectorAll('thead th')].map((th) => th.textContent?.trim());
      expect(headers).toEqual([
        'Tale',
        'Tale group',
        'Impressions',
        'Reach',
        'Opens',
        'Tale views',
        'Clicks',
        'Engagement rate',
        'CTR',
      ]);
    });

    it('says so when no tale group or tale has events', async () => {
      await open({ answer: analyticsFixture({ groups: [], tales: [] }) });
      expect(text()).toContain('No tale group has events in this period.');
      expect(text()).toContain('No tale has views or clicks in this period.');
    });
  });

  describe('chart', () => {
    it('is an image with a name, a legend and a visually hidden table of the daily counts', async () => {
      await open();
      const svg = root().querySelector('svg.analytics-chart__svg');
      expect(svg?.getAttribute('role')).toBe('img');
      expect(svg?.getAttribute('aria-label')).toBe('Line chart of daily impressions and clicks, Oct 22 to Oct 28');
      expect(root().querySelector('.analytics-legend')?.getAttribute('aria-label')).toBe('Chart key');
      expect(root().querySelectorAll('.analytics-chart__line').length).toBe(2);
      const table = root().querySelector('figure table');
      expect(table?.classList.contains('visually-hidden')).toBe(true);
      expect(table?.querySelector('caption')?.textContent?.trim()).toBe('Daily impressions and clicks');
      const rows = [...(table as HTMLTableElement).querySelectorAll('tbody tr')];
      expect(rows.length).toBe(7);
      expect([...rows[6].querySelectorAll('th, td')].map((cell) => cell.textContent?.trim())).toEqual([
        'Wed, Oct 28',
        '1,234',
        '100',
      ]);
    });

    it('shows the day under the pointer as a tooltip', async () => {
      await open();
      const bands = root().querySelectorAll('.analytics-chart__band');
      expect(bands.length).toBe(7);
      bands[2].dispatchEvent(new Event('pointerenter'));
      fixture.detectChanges();
      const tooltip = root().querySelector('.analytics-tooltip');
      expect(tooltip?.textContent).toContain('Oct 24');
      expect(tooltip?.textContent).toContain('Impressions: 250');
      expect(tooltip?.textContent).toContain('Clicks: 20');
      expect(tooltip?.getAttribute('aria-hidden')).toBe('true');
      (root().querySelector('svg.analytics-chart__svg') as SVGElement).dispatchEvent(new Event('pointerleave'));
      fixture.detectChanges();
      expect(root().querySelector('.analytics-tooltip')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('has a labelled region, a live region, and a labelled period picker', async () => {
      await open();
      const region = root().querySelector('section[aria-labelledby=analytics-title]');
      expect(region?.querySelector('h3')?.textContent?.trim()).toBe('Analytics');
      expect(root().querySelector('[aria-live=polite]')).not.toBeNull();
      expect(select()?.id).toBe('analytics-period');
    });

    it('gives every series, chart and table a name for a screen reader', async () => {
      await open();
      for (const table of root().querySelectorAll('table')) {
        const named = table.getAttribute('aria-labelledby') || table.querySelector('caption');
        expect(named).toBeTruthy();
      }
    });
  });
});

describe('zone analytics helpers', () => {
  it('formats counts with separators and percentages with one decimal', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(33.333)).toBe('33.3%');
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('rounds the chart maximum up to a 1, 2 or 5 step, at least 1', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(1234)).toBe(2000);
    expect(niceMax(4300)).toBe(5000);
  });

  it('places one point per day, the first and last at the plot edges', () => {
    const points = chartPoints(analyticsFixture().daily, 2000);
    expect(points.length).toBe(7);
    expect(points[0].x).toBe(44);
    expect(points[6].x).toBe(640 - 12);
    expect(points[0].label).toBe('Oct 22');
    expect(points[6].impressionsY).toBeLessThan(points[0].impressionsY);
  });
});
