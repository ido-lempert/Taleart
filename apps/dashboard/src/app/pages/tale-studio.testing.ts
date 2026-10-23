// Helpers shared by the Tale Studio specs (test code only: no page imports this file).
import type { ComponentFixture } from '@angular/core/testing';

/** Lets the fixture finish its pending work and one timer turn, then renders it. */
export async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

/** Autosave timing under test: it waits for the test to ask; tests of its timing shorten it. */
export const WAIT_FOR_TEST = { debounceMs: 3_600_000, maxWaitMs: 3_600_000, retryDelaysMs: [3_600_000] };
