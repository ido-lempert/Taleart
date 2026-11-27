import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { Appearance } from '@taleart/contract/core';
import { AppearanceService } from '../appearance';
import { AuthStore } from '../auth';
import { SettingsTabs } from './settings-tabs';

/** The Appearance choices, in the order the page offers them. */
const CHOICES: readonly { value: Appearance; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: "Follows this device: dark when the device is in dark appearance" },
  { value: 'light', label: 'Light', hint: 'Always light, on every device' },
  { value: 'dark', label: 'Dark', hint: 'Always dark, on every device' },
];

/**
 * Settings > Profile: the signed-in user's own dashboard settings. Appearance is System (the default), Light or
 * Dark. A choice shows at once and is kept on the account; when the save fails the previous choice comes back
 * with the message.
 */
@Component({
  selector: 'app-profile-page',
  imports: [SettingsTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .appearance-choices {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .appearance-choices legend {
      margin-bottom: var(--space-2);
      padding: 0;
    }
  `,
  template: `
    <div class="page">
      <app-settings-tabs />
      <header class="page-header">
        <h2 class="page-header__title">Profile</h2>
        <p class="page-header__meta">Your own settings. They follow you to every device you sign in on.</p>
      </header>

      <section class="card section" aria-labelledby="appearance-title">
        <h3 class="section__title" id="appearance-title" tabindex="-1">Appearance</h3>
        <fieldset class="appearance-choices" [disabled]="busy()">
          <legend class="field__label">Show TaleArt in</legend>
          @for (choice of choices; track choice.value) {
            <label class="checkbox">
              <input
                type="radio"
                name="appearance"
                id="appearance-{{ choice.value }}"
                [value]="choice.value"
                [checked]="appearance() === choice.value"
                (change)="choose(choice.value)"
              />
              {{ choice.label }}
              <span class="muted">: {{ choice.hint }}</span>
            </label>
          }
        </fieldset>
        @if (message(); as text) {
          <p class="form-error" role="alert">{{ text }}</p>
        }
      </section>
    </div>
  `,
})
export class ProfilePage {
  private readonly auth = inject(AuthStore);
  protected readonly appearance = inject(AppearanceService).appearance;
  protected readonly choices = CHOICES;
  protected readonly busy = signal(false);
  protected readonly message = signal('');

  /** Saves the choice; the control shows it at once and goes back when the save fails. */
  async choose(value: Appearance): Promise<void> {
    if (value === this.appearance()) return;
    this.busy.set(true);
    this.message.set('');
    const error = await this.auth.saveAppearance(value);
    this.busy.set(false);
    if (error) this.message.set(error);
  }
}
