import { computed, DestroyRef, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import type { Appearance } from '@taleart/contract/core';

/** The media query of the device's dark setting. */
export const DARK_DEVICE_QUERY = '(prefers-color-scheme: dark)';

/** What the dashboard shows: an explicit choice as chosen, System as the device's setting. */
export type ShownAppearance = 'light' | 'dark';

/** The appearance shown for a choice, given whether the device is in dark appearance. */
export function shownAppearance(choice: Appearance, deviceDark: boolean): ShownAppearance {
  if (choice === 'light' || choice === 'dark') return choice;
  return deviceDark ? 'dark' : 'light';
}

/**
 * The dashboard's appearance (dashboard dark mode): the signed-in user's choice, System by default, painted as
 * `data-theme` on `<html>` ("light" or "dark"). The colour tokens in styles.css switch on that attribute; with no
 * script running, the same CSS follows the device under System. Live: the device switching between light and dark
 * repaints at once, without a reload. Signed out, the choice is System.
 */
@Injectable({ providedIn: 'root' })
export class AppearanceService {
  private readonly document = inject(DOCUMENT);
  private readonly deviceQuery: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_DEVICE_QUERY) : null;
  private readonly choice = signal<Appearance>('system');
  private readonly deviceDark = signal(this.deviceQuery?.matches ?? false);

  /** The choice the account holds (System until the user chooses, or when signed out). */
  readonly appearance = this.choice.asReadonly();
  /** What is shown now. */
  readonly shown = computed(() => shownAppearance(this.choice(), this.deviceDark()));

  constructor() {
    this.paint();
    const onDeviceChange = (event: MediaQueryListEvent) => {
      this.deviceDark.set(event.matches);
      this.paint();
    };
    this.deviceQuery?.addEventListener('change', onDeviceChange);
    inject(DestroyRef).onDestroy(() => this.deviceQuery?.removeEventListener('change', onDeviceChange));
  }

  /** Shows this choice at once: the profile's control, or the account's saved choice when it loads. */
  set(choice: Appearance): void {
    this.choice.set(choice);
    this.paint();
  }

  private paint(): void {
    this.document.documentElement.dataset['theme'] = this.shown();
  }
}
