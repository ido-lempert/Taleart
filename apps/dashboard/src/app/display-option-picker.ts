import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { displayOptionSetting, selectedOption, type DisplayOption, type DisplayOptionSetting } from './display-options';
import type { Settings } from './settings-form';

/**
 * The layout or variant of a display, as a group of radio options, each with a small drawn
 * thumbnail, its name and what it looks like (end-user redesign P4, P5). The thumbnails are inline
 * SVG in the dashboard's own colours, labelled for screen readers; the words carry the meaning.
 */
@Component({
  selector: 'app-display-option-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (setting(); as setting) {
      <fieldset class="field display-options" [attr.aria-describedby]="setting.key + '-picker-hint'">
        <legend class="field__label">{{ setting.label }}</legend>
        <span class="field__hint" [id]="setting.key + '-picker-hint'">
          Each option draws the tale groups or slides another way. Settings an option does not use are shown dimmed.
        </span>
        <div class="display-options__list">
          @for (option of setting.options; track option.value) {
            <label class="display-option" [class.display-option--on]="option.value === chosen().value">
              <input
                type="radio"
                class="display-option__input"
                [name]="'display-' + setting.key"
                [value]="option.value"
                [checked]="option.value === chosen().value"
                (change)="choose(setting, option)"
              />
              <span class="display-option__thumb">
                @switch (option.value) {
                  @case ('ring') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <circle class="thumb-ring" cx="16" cy="20" r="11" />
                      <circle class="thumb-fill" cx="16" cy="20" r="8" />
                      <circle class="thumb-ring" cx="40" cy="20" r="11" />
                      <circle class="thumb-fill" cx="40" cy="20" r="8" />
                    </svg>
                  }
                  @case ('chip') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <rect class="thumb-pill" x="4" y="10" width="56" height="20" rx="10" />
                      <circle class="thumb-fill" cx="16" cy="20" r="6" />
                      <rect class="thumb-line" x="26" y="17" width="24" height="6" rx="3" />
                    </svg>
                  }
                  @case ('poster') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <rect class="thumb-fill" x="18" y="3" width="28" height="34" rx="4" />
                      <rect class="thumb-band" x="18" y="26" width="28" height="11" rx="2" />
                    </svg>
                  }
                  @case ('stack') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <rect class="thumb-fill thumb-back" x="8" y="8" width="20" height="24" rx="10" />
                      <rect class="thumb-fill thumb-mid" x="20" y="8" width="20" height="24" rx="10" />
                      <rect class="thumb-ring" x="32" y="8" width="20" height="24" rx="10" />
                    </svg>
                  }
                  @case ('coverflow') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <rect class="thumb-fill thumb-back" x="2" y="10" width="14" height="20" rx="2" />
                      <rect class="thumb-fill thumb-back" x="48" y="10" width="14" height="20" rx="2" />
                      <rect class="thumb-ring" x="19" y="5" width="26" height="30" rx="3" />
                    </svg>
                  }
                  @case ('peek') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <rect class="thumb-fill thumb-back" x="-6" y="8" width="14" height="24" rx="2" />
                      <rect class="thumb-fill thumb-back" x="56" y="8" width="14" height="24" rx="2" />
                      <rect class="thumb-ring" x="14" y="5" width="36" height="30" rx="3" />
                    </svg>
                  }
                  @case ('deck') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <rect
                        class="thumb-fill thumb-back"
                        x="12"
                        y="6"
                        width="24"
                        height="28"
                        rx="3"
                        transform="rotate(-12 24 20)"
                      />
                      <rect
                        class="thumb-fill thumb-mid"
                        x="20"
                        y="6"
                        width="24"
                        height="28"
                        rx="3"
                        transform="rotate(-4 32 20)"
                      />
                      <rect class="thumb-ring" x="28" y="6" width="24" height="28" rx="3" transform="rotate(6 40 20)" />
                    </svg>
                  }
                  @case ('sticky') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <rect class="thumb-ring" x="4" y="3" width="56" height="12" rx="2" />
                      <rect class="thumb-line" x="4" y="20" width="56" height="4" rx="2" />
                      <rect class="thumb-line" x="4" y="28" width="38" height="4" rx="2" />
                    </svg>
                  }
                  @case ('strip') {
                    <svg viewBox="0 0 64 40" role="img" [attr.aria-label]="option.label + ' preview'">
                      <rect class="thumb-fill" x="2" y="12" width="20" height="16" rx="2" />
                      <rect class="thumb-ring" x="24" y="12" width="20" height="16" rx="2" />
                      <rect class="thumb-fill" x="46" y="12" width="20" height="16" rx="2" />
                    </svg>
                  }
                }
              </span>
              <span class="display-option__text">
                <span class="display-option__name">{{ option.label }}</span>
                <span class="display-option__summary">{{ option.summary }}</span>
                @if (option.ignores.length > 0) {
                  <span class="display-option__ignores">Dims {{ ignoredNames(option) }}.</span>
                }
              </span>
            </label>
          }
        </div>
      </fieldset>
    }
  `,
  styles: `
    .display-options__list {
      display: grid;
      gap: 8px;
    }
    .display-option {
      display: grid;
      grid-template-columns: auto 72px 1fr;
      align-items: center;
      gap: 12px;
      min-height: 44px;
      padding: 8px 12px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-card, 8px);
      background: var(--surface);
      cursor: pointer;
    }
    .display-option--on {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary) inset;
    }
    .display-option__input {
      width: 20px;
      height: 20px;
      margin: 0;
    }
    .display-option__thumb svg {
      display: block;
      width: 72px;
      height: 45px;
    }
    .display-option__thumb .thumb-fill {
      fill: var(--surface-sunken);
    }
    .display-option__thumb .thumb-back {
      opacity: 0.6;
    }
    .display-option__thumb .thumb-mid {
      opacity: 0.85;
    }
    .display-option__thumb .thumb-ring {
      fill: var(--surface-sunken);
      stroke: var(--primary);
      stroke-width: 2.5;
    }
    .display-option__thumb .thumb-pill {
      fill: var(--surface-sunken);
      stroke: var(--border-strong);
      stroke-width: 1;
    }
    .display-option__thumb .thumb-band {
      fill: var(--primary);
    }
    .display-option__thumb .thumb-line {
      fill: var(--text-muted);
    }
    .display-option__text {
      display: grid;
      gap: 2px;
    }
    .display-option__name {
      font-weight: 600;
    }
    .display-option__summary {
      color: var(--text-muted);
      font-size: var(--text-sm, 0.875rem);
    }
    .display-option__ignores {
      color: var(--text-muted);
      font-size: var(--text-sm, 0.875rem);
      font-style: italic;
    }
  `,
})
export class DisplayOptionPicker {
  /** The frame type whose option setting this picks: `bar` or `banner`. Other types show nothing. */
  readonly type = input.required<string>();
  /** The settings being edited; the chosen option is written to the setting's key. */
  readonly value = model.required<Settings>();

  /** The option setting of the type, or null for a type without one. */
  protected readonly setting = computed<DisplayOptionSetting | null>(() => displayOptionSetting(this.type()));

  /** The option the settings choose now (the default when they hold none). */
  protected readonly chosen = computed<DisplayOption>(() => {
    const setting = this.setting();
    return setting ? selectedOption(setting, this.value()) : { value: '', label: '', summary: '', ignores: [] };
  });

  protected choose(setting: DisplayOptionSetting, option: DisplayOption): void {
    this.value.update((settings) => ({ ...settings, [setting.key]: option.value }));
  }

  protected ignoredNames(option: DisplayOption): string {
    return option.ignores.map((key) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()).join(', ');
  }
}
