import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ANALYTICS_EVENT_TYPES } from '@taleart/contract/core';
import { appRoutes } from '../app.routes';

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

// The dashboard's constants file is the one place the definitions are written. The docs page copies them; this spec reads
// that file as text (the docs project cannot import another project) and checks each copy is in it, word for word.
const DASHBOARD_DEFINITIONS = readFileSync(
  join(workspaceRoot(), 'apps/dashboard/src/app/pages/analytics-definitions.ts'),
  'utf8',
);

describe('the Analytics reference page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/reference/analytics');
    page = harness.routeNativeElement as HTMLElement;
  });

  const rows = (table: string) => [...page.querySelectorAll(`#${table} tbody tr`)];

  it('shows every metric definition of the dashboard, word for word, with its label', () => {
    const metrics = rows('metrics').map((row) => [row.querySelector('th')?.textContent?.trim(), row.querySelector('td')?.textContent?.trim()]);
    const dashboardLabels = [...DASHBOARD_DEFINITIONS.matchAll(/^ {4}label: '(.+)',$/gm)].map((m) => m[1]);
    expect(metrics.length).toBe(dashboardLabels.length);
    metrics.forEach(([label, definition]) => {
      expect(DASHBOARD_DEFINITIONS, label).toContain(`label: '${label}'`);
      expect(DASHBOARD_DEFINITIONS, label).toContain(definition);
    });
  });

  it('shows the period note and the Reach note of the dashboard, word for word', () => {
    expect(DASHBOARD_DEFINITIONS).toContain("'UTC days, today included.'");
    expect(page.textContent).toContain('(UTC days, today included.)');
    const reachNote = 'Reach is distinct per row: the Reach of a total is not the sum of its rows.';
    expect(DASHBOARD_DEFINITIONS).toContain(`'${reachNote}'`);
    expect(page.textContent).toContain(reachNote);
  });

  it('lists every event type the contract accepts, and no other', () => {
    const events = rows('events').map((row) => row.querySelector('code')?.textContent?.trim());
    expect(events).toEqual([...ANALYTICS_EVENT_TYPES]);
  });

  it('states the privacy rules: what is never sent and the per-project hash', () => {
    const text = page.textContent ?? '';
    for (const phrase of ['external user id', 'tags', 'IP address', 'user agent', 'SHA-256', '400 days']) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it('shows the opt-out in both forms', () => {
    const text = page.textContent ?? '';
    expect(text).toContain('Taleart.init({ analytics: false });');
    expect(text).toContain('analytics="off"');
  });

  it('documents the Delivery and Management endpoints, their limits and the response fields', () => {
    const text = page.textContent ?? '';
    expect(text).toContain('POST /delivery/v1/events');
    expect(text).toContain('GET /zones/{zoneId}/analytics');
    expect(text).toContain('202');
    expect(text).toMatch(/At most 50/);
    expect(rows('response-fields').map((row) => row.querySelector('code')?.textContent?.trim())).toEqual([
      'period',
      'totals',
      'daily',
      'groups',
      'tales',
    ]);
  });

  it('says that Reach is not the sum of its rows, and that the mobile SDKs send no events yet', () => {
    const text = page.textContent ?? '';
    expect(text).toContain('not the sum of its rows');
    expect(text).toMatch(/Android and iOS SDKs do not send analytics events yet/);
  });

  it('gives every table a caption and a labelled scrollable region', () => {
    for (const table of page.querySelectorAll('table')) {
      expect(table.querySelector('caption')?.textContent?.trim(), table.id).toBeTruthy();
      expect(table.parentElement?.getAttribute('role'), table.id).toBe('region');
    }
  });
});
