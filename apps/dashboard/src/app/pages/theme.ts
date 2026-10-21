import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CORNER_RADIUS_RANGE,
  DEFAULT_THEME,
  isThemeColor,
  RING_COLORS_RANGE,
  RING_STYLES,
  RING_WIDTH_RANGE,
  themeContrastIssues,
  themeSettingsError,
  type RingStyle,
  type Theme,
  type ThemeField,
} from '@taleart/contract';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { ThemeService } from '../theme.service';

/** The single-colour fields, with their labels and hints, in display order. */
const COLOR_FIELDS: readonly { key: 'seenRingColor' | 'titleColor' | 'backgroundColor' | 'accentColor'; label: string; hint: string }[] = [
  { key: 'seenRingColor', label: 'Seen ring colour', hint: 'The ring of a tale group the visitor has viewed.' },
  { key: 'titleColor', label: 'Title colour', hint: 'Tale group titles in the bar and the banner dots.' },
  { key: 'backgroundColor', label: 'Background colour', hint: 'Behind the bar and the banner.' },
  { key: 'accentColor', label: 'Accent colour', hint: "The viewer's progress and buttons, on black." },
];

const RING_STYLE_LABELS: Readonly<Record<RingStyle, string>> = { gradient: 'Gradient', solid: 'Solid', none: 'None' };

// The field a refusal names (`theme.ringWidth must …`), or '' when it names none.
function refusedField(message: string): string {
  return /^theme\.(\w+)/.exec(message)?.[1] ?? '';
}

function copy(theme: Theme): Theme {
  return { ...theme, ringColors: [...theme.ringColors] };
}

/**
 * A project's theme (epic web zones R9): one per project, styling every
 * zone's bar, banner and viewer through the Web SDK. Colour pickers with a hex
 * field each, the ring style and width, the corner radius and the font; a
 * warning names every colour pair that fails WCAG 2.2 AA contrast. Saving
 * replaces the theme; "Reset to TaleArt default" clears it.
 */
@Component({
  selector: 'app-theme-page',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .theme-section {
      max-width: 640px;
    }
    .theme-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .theme-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .theme-group legend {
      margin-bottom: var(--space-2);
      padding: 0;
      font-size: var(--text-md);
      font-weight: 600;
    }
    .color-field {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .color-field .input {
      flex: 1;
      min-width: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .color-swatch {
      flex: none;
      width: var(--control-height);
      height: var(--control-height);
      padding: 2px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-control);
      background: var(--surface);
      cursor: pointer;
    }
    .color-swatch:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 0;
    }
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--space-4);
    }
    .contrast {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border: 1px solid #fedf89;
      border-radius: var(--radius-control);
      background: #fffaeb;
      color: #93370d;
    }
    .contrast ul {
      margin: 0;
      padding-left: var(--space-5);
    }
    .theme-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .theme-saved {
      margin: 0;
      color: var(--text-secondary);
    }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <a class="back-link" routerLink="/projects"><app-icon name="back" /> Projects</a>
        <h2 class="page-header__title">Theme</h2>
        @if (store.loaded()) {
          <p class="page-header__meta">of {{ store.projectName(projectId()) }}, for every zone's bar, banner and viewer</p>
        }
      </header>

      <section class="card section theme-section" aria-labelledby="theme-title">
        <h3 class="section__title" id="theme-title">Project theme</h3>
        @if (theme(); as t) {
          <form class="theme-form" (submit)="$event.preventDefault(); save()" novalidate>
            <fieldset class="theme-group">
              <legend>Ring</legend>
              <div class="field">
                <label class="field__label" for="theme-ringStyle">Ring style</label>
                <select
                  id="theme-ringStyle"
                  class="select"
                  [attr.aria-invalid]="invalid('ringStyle')"
                  [attr.aria-describedby]="describedBy('ringStyle')"
                  (change)="set('ringStyle', $any($event.target).value)"
                >
                  @for (style of ringStyles; track style) {
                    <option [value]="style" [selected]="t.ringStyle === style">{{ ringStyleLabel[style] }}</option>
                  }
                </select>
              </div>

              <div class="field" role="group" aria-labelledby="theme-ringColors-label">
                <span class="field__label" id="theme-ringColors-label">Ring colours</span>
                <span class="field__hint" id="theme-ringColors-hint">
                  {{ t.ringStyle === 'solid' ? 'A solid ring uses the first colour.' : 'A gradient runs through 1 to 3 colours.' }}
                </span>
                @for (color of t.ringColors; track $index; let i = $index) {
                  <div class="color-field">
                    <input
                      type="color"
                      class="color-swatch"
                      [attr.aria-label]="'Ring colour ' + (i + 1) + ' picker'"
                      [value]="swatch(color)"
                      (input)="setRingColor(i, $any($event.target).value)"
                    />
                    <input
                      class="input"
                      type="text"
                      spellcheck="false"
                      autocomplete="off"
                      [id]="'theme-ringColors-' + i"
                      [attr.aria-label]="'Ring colour ' + (i + 1)"
                      [value]="color"
                      [attr.aria-invalid]="invalid('ringColors')"
                      [attr.aria-describedby]="describedBy('ringColors')"
                      (input)="setRingColor(i, $any($event.target).value)"
                    />
                    @if (t.ringColors.length > ringColorsRange.min) {
                      <button
                        type="button"
                        class="btn btn--ghost btn--sm"
                        [attr.aria-label]="'Remove ring colour ' + (i + 1)"
                        (click)="removeRingColor(i)"
                      >
                        Remove
                      </button>
                    }
                  </div>
                }
                @if (t.ringColors.length < ringColorsRange.max) {
                  <div>
                    <button type="button" class="btn btn--secondary btn--sm" (click)="addRingColor()">
                      <app-icon name="plus" /> Add colour
                    </button>
                  </div>
                }
              </div>

              <div class="theme-grid">
                <div class="field">
                  <label class="field__label" for="theme-ringWidth">Ring width (px)</label>
                  <input
                    id="theme-ringWidth"
                    class="input"
                    type="number"
                    inputmode="numeric"
                    [attr.min]="ringWidthRange.min"
                    [attr.max]="ringWidthRange.max"
                    step="1"
                    [value]="t.ringWidth"
                    [attr.aria-invalid]="invalid('ringWidth')"
                    [attr.aria-describedby]="describedBy('ringWidth', 'theme-ringWidth-hint')"
                    (input)="setNumber('ringWidth', $any($event.target).value)"
                  />
                  <span class="field__hint" id="theme-ringWidth-hint">From {{ ringWidthRange.min }} to {{ ringWidthRange.max }}.</span>
                </div>
                <div class="field">
                  <label class="field__label" for="theme-cornerRadius">Corner radius (px)</label>
                  <input
                    id="theme-cornerRadius"
                    class="input"
                    type="number"
                    inputmode="numeric"
                    [attr.min]="cornerRadiusRange.min"
                    [attr.max]="cornerRadiusRange.max"
                    step="1"
                    [value]="t.cornerRadius"
                    [attr.aria-invalid]="invalid('cornerRadius')"
                    [attr.aria-describedby]="describedBy('cornerRadius', 'theme-cornerRadius-hint')"
                    (input)="setNumber('cornerRadius', $any($event.target).value)"
                  />
                  <span class="field__hint" id="theme-cornerRadius-hint">
                    Rounded-square bar items and banner slides, {{ cornerRadiusRange.min }} to {{ cornerRadiusRange.max }}.
                  </span>
                </div>
              </div>
            </fieldset>

            <fieldset class="theme-group">
              <legend>Colours</legend>
              <div class="theme-grid">
                @for (field of colorFields; track field.key) {
                  <div class="field">
                    <label class="field__label" [for]="'theme-' + field.key">{{ field.label }}</label>
                    <div class="color-field">
                      <input
                        type="color"
                        class="color-swatch"
                        [attr.aria-label]="field.label + ' picker'"
                        [value]="swatch(t[field.key])"
                        (input)="set(field.key, $any($event.target).value)"
                      />
                      <input
                        class="input"
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        [id]="'theme-' + field.key"
                        [value]="t[field.key]"
                        [attr.aria-invalid]="invalid(field.key)"
                        [attr.aria-describedby]="describedBy(field.key, 'theme-' + field.key + '-hint')"
                        (input)="set(field.key, $any($event.target).value)"
                      />
                    </div>
                    <span class="field__hint" [id]="'theme-' + field.key + '-hint'">{{ field.hint }}</span>
                  </div>
                }
              </div>
            </fieldset>

            <div class="field">
              <label class="field__label" for="theme-fontFamily">Font</label>
              <input
                id="theme-fontFamily"
                class="input"
                type="text"
                spellcheck="false"
                autocomplete="off"
                [value]="t.fontFamily"
                [attr.aria-invalid]="invalid('fontFamily')"
                [attr.aria-describedby]="describedBy('fontFamily', 'theme-fontFamily-hint')"
                (input)="set('fontFamily', $any($event.target).value)"
              />
              <span class="field__hint" id="theme-fontFamily-hint">
                A CSS font-family list, such as Georgia, serif. The host page loads the font.
              </span>
            </div>

            <div role="status">
              @if (contrastIssues().length > 0) {
                <div class="contrast">
                  <strong>Some colours fail WCAG 2.2 AA contrast:</strong>
                  <ul>
                    @for (issue of contrastIssues(); track issue.pair) {
                      <li>{{ issue.pair }}: {{ issue.ratio.toFixed(2) }}:1, needs {{ issue.minimum }}:1</li>
                    }
                  </ul>
                  <span>You can still save; visitors may find these hard to see.</span>
                </div>
              }
            </div>

            @if (error()) {
              <p class="form-error" id="theme-error" role="alert">{{ error() }}</p>
            }

            <div class="theme-actions">
              <button type="submit" class="btn btn--primary" [disabled]="busy()">Save theme</button>
              <button type="button" class="btn btn--secondary" [disabled]="busy()" (click)="reset()">
                Reset to TaleArt default
              </button>
            </div>
            <p class="theme-saved" role="status">{{ saved() }}</p>
          </form>
        } @else if (error()) {
          <p class="form-error" role="alert">{{ error() }}</p>
        } @else {
          <p class="muted">Loading the theme…</p>
        }
      </section>
    </div>
  `,
})
export class ThemePage implements OnInit {
  protected readonly store = inject(DashboardStore);
  private readonly themes = inject(ThemeService);

  /** The project whose theme this is, bound from the route's `:projectId`. */
  readonly projectId = input.required<string>();

  /** The theme being edited, every field filled; null until read. */
  protected readonly theme = signal<Theme | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** The field the last refusal named, marked invalid until it changes. */
  protected readonly errorField = signal('');
  protected readonly saved = signal('');

  protected readonly colorFields = COLOR_FIELDS;
  protected readonly ringStyles = RING_STYLES;
  protected readonly ringStyleLabel = RING_STYLE_LABELS;
  protected readonly ringColorsRange = RING_COLORS_RANGE;
  protected readonly ringWidthRange = RING_WIDTH_RANGE;
  protected readonly cornerRadiusRange = CORNER_RADIUS_RANGE;

  /** The colour pairs that fail WCAG 2.2 AA, once every colour is a valid #rrggbb. */
  protected readonly contrastIssues = computed(() => {
    const t = this.theme();
    if (!t) return [];
    const colors = [...t.ringColors, t.seenRingColor, t.titleColor, t.backgroundColor, t.accentColor];
    return colors.every(isThemeColor) ? themeContrastIssues(t) : [];
  });

  ngOnInit(): void {
    this.store.selectProject(this.projectId());
    void this.load();
  }

  private async load(): Promise<void> {
    const { value, message } = await this.themes.load(this.projectId());
    if (value === null) {
      this.error.set(message);
      return;
    }
    this.theme.set(copy(value.resolved));
  }

  /** The colour picker's value: the field's colour, lowercased, or the default while the hex field is not a colour. */
  protected swatch(color: string): string {
    return isThemeColor(color) ? color.toLowerCase() : '#000000';
  }

  protected invalid(field: ThemeField): 'true' | null {
    return this.errorField() === field ? 'true' : null;
  }

  protected describedBy(field: ThemeField, hint = ''): string | null {
    const ids = [hint, field === 'ringColors' ? 'theme-ringColors-hint' : '', this.errorField() === field ? 'theme-error' : ''];
    return ids.filter(Boolean).join(' ') || null;
  }

  private update(field: ThemeField, change: (theme: Theme) => Theme): void {
    const t = this.theme();
    if (!t) return;
    this.theme.set(change(copy(t)));
    this.saved.set('');
    if (this.errorField() === field) {
      this.errorField.set('');
      this.error.set('');
    }
  }

  protected set(field: 'ringStyle' | 'fontFamily' | (typeof COLOR_FIELDS)[number]['key'], value: string): void {
    this.update(field, (t) => ({ ...t, [field]: value }));
  }

  // A number field keeps what was typed; the save check names a value out of range or not whole.
  protected setNumber(field: 'ringWidth' | 'cornerRadius', value: string): void {
    this.update(field, (t) => ({ ...t, [field]: value.trim() === '' ? Number.NaN : Number(value) }));
  }

  protected setRingColor(index: number, value: string): void {
    this.update('ringColors', (t) => ({ ...t, ringColors: t.ringColors.map((c, i) => (i === index ? value : c)) }));
  }

  protected addRingColor(): void {
    this.update('ringColors', (t) => ({
      ...t,
      ringColors: [...t.ringColors, DEFAULT_THEME.ringColors[t.ringColors.length] ?? DEFAULT_THEME.ringColors[0]],
    }));
  }

  protected removeRingColor(index: number): void {
    this.update('ringColors', (t) => ({ ...t, ringColors: t.ringColors.filter((_, i) => i !== index) }));
  }

  protected async save(): Promise<void> {
    const t = this.theme();
    if (!t || this.busy()) return;
    // The same check as the API's, so an invalid value is named before anything is sent.
    const problem = themeSettingsError(t);
    if (problem) {
      this.refuse(problem);
      return;
    }
    await this.send(t, 'Theme saved. Reload a page with the Web SDK to see it.');
  }

  protected async reset(): Promise<void> {
    if (this.busy()) return;
    await this.send({}, "Theme reset to TaleArt's default.");
  }

  private refuse(message: string): void {
    this.error.set(message);
    this.errorField.set(refusedField(message));
    this.saved.set('');
  }

  private async send(theme: Partial<Theme>, done: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.errorField.set('');
    this.saved.set('');
    const { value, message } = await this.themes.save(this.projectId(), theme);
    this.busy.set(false);
    if (value === null) {
      this.refuse(message);
      return;
    }
    this.theme.set(copy(value.resolved));
    this.saved.set(done);
  }
}
