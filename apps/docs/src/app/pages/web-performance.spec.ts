import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../app.routes';
import { SDK_BUDGET } from './sdk-budget.generated';

// The page reads its numbers from sdk-budget.generated.ts, the file `nx run web-sdk:measure-budget` writes;
// this spec checks that the table shows them.

describe('the performance page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/reference/performance');
    page = harness.routeNativeElement as HTMLElement;
  });

  /** The budget table's cells of the row whose first cell starts with `label`: [label, budget, measured]. */
  function row(label: string): string[] {
    const tr = [...page.querySelectorAll('#budget tbody tr')].find((r) => r.querySelector('td')?.textContent?.trim().startsWith(label));
    if (!tr) throw new Error(`no budget row "${label}"`);
    return [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '');
  }

  it('states the budget the generated file holds', () => {
    expect(row('ES module build')[1]).toBe(`${SDK_BUDGET.budgetKb} KB`);
    expect(row('UMD build')[1]).toBe(`${SDK_BUDGET.budgetKb} KB`);
  });

  it('shows the measured ES module size, exactly as the generated file has it', () => {
    expect(row('ES module build')[2]).toBe(`${SDK_BUDGET.esmGzipKb.toFixed(2)} KB`);
  });

  it('shows the measured UMD size, exactly as the generated file has it', () => {
    expect(row('UMD build')[2]).toBe(`${SDK_BUDGET.umdGzipKb.toFixed(2)} KB`);
  });

  it('measures both builds within the budget', () => {
    expect(SDK_BUDGET.esmGzipKb).toBeLessThanOrEqual(SDK_BUDGET.budgetKb);
    expect(SDK_BUDGET.umdGzipKb).toBeLessThanOrEqual(SDK_BUDGET.budgetKb);
  });

  it('states the request budget: two scripts (the entry and its core chunk), one zone call, no third-party calls', () => {
    expect(row('Script requests')).toEqual(['Script requests per page', '2', '2']);
    expect(row('Zone requests')).toEqual(['Zone requests per zone', '1', '1']);
    expect(row('Third-party requests')).toEqual(['Third-party requests', 'None', 'None']);
  });

  it('gives the verify commands', () => {
    const text = page.textContent ?? '';
    expect(text).toContain('pnpm nx run web-sdk:measure-budget');
    expect(text).toContain('pnpm nx run web-sdk:size');
    expect(text).toContain('pnpm nx test docs');
  });
});
