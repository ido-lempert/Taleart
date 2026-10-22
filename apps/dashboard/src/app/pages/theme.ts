import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  checkThemeContrast,
  CORNER_RADIUS_RANGE,
  DEFAULT_THEME,
  isThemeColor,
  isValidThemeValue,
  RING_COLORS_RANGE,
  RING_STYLES,
  RING_WIDTH_RANGE,
  THEME_FIELDS,
  themeSettingsError,
  TRANSPARENT,
  type RingStyle,
  type Theme,
  type ThemeField,
  type ThemeSettings,
} from '@taleart/contract/theme';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { ThemeService } from '../theme.service';

type ColorKey = 'seenRingColor' | 'titleColor' | 'backgroundColor' | 'accentColor';
type NumberKey = 'ringWidth' | 'cornerRadius';

interface ColorField {
  key: ColorKey;
  label: string;
  hint: string;
  /** For a field that can come from the host page: the checkbox label and the colour set when it is cleared. */
  host?: { label: string; explicit: string };
}

/** The single-colour fields, with their labels and hints, in display order. */
const COLOR_FIELDS: readonly ColorField[] = [
  { key: 'seenRingColor', label: 'Seen ring colour', hint: 'The ring of a tale group the visitor has viewed.' },
  {
    key: 'titleColor',
    label: 'Title colour',
    hint: 'Tale group titles in the bar and the banner dots.',
    host: { label: "Host page's text colour", explicit: '#111827' },
  },
  {
    key: 'backgroundColor',
    label: 'Background colour',
    hint: 'Behind the bar and the banner.',
    host: { label: "Transparent: the host page's background shows through", explicit: '#ffffff' },
  },
  { key: 'accentColor', label: 'Accent colour', hint: "The viewer's progress and buttons." },
];

/** The value a field takes when it is set explicitly after coming from the host page or the frame. */
const EXPLICIT_FONT = 'system-ui, sans-serif';
const EXPLICIT_RADIUS = 12;

const RING_STYLE_LABELS: Readonly<Record<RingStyle, string>> = { gradient: 'Gradient', solid: 'Solid', none: 'None' };

// The field a refusal names (`theme.ringWidth must …`), or '' when it names none.
function refusedField(message: string): string {
  return /^theme\.(\w+)/.exec(message)?.[1] ?? '';
}

function copy(theme: Theme): Theme {
  return { ...theme, ringColors: [...theme.ringColors] };
}

function isDefault(field: ThemeField, value: unknown): boolean {
  const fallback = DEFAULT_THEME[field];
  return Array.isArray(fallback) && Array.isArray(value)
    ? fallback.length === value.length && fallback.every((c, i) => c.toLowerCase() === String(value[i]).toLowerCase())
    : typeof value === 'string' && typeof fallback === 'string'
      ? value.toLowerCase() === fallback.toLowerCase()
      : value === fallback;
}

/**
 * A project's theme (epic web zones R9): one per project, styling every
 * zone's bar, banner and viewer through the Web SDK. Colour pickers with a hex
 * field each, the ring style and width, the corner radius and the font. The
 * title colour, font, corner radius and background can come from the host
 * page or the frame, as before themes. A warning names every colour pair that
 * fails WCAG 2.2 AA contrast and the pairs it cannot check. Saving sends only
 * the fields the project sets; "Reset to TaleArt default" clears them all.
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
    .contrast--note {
      border-color: var(--border);
      background: var(--surface-sunken);
      color: var(--text-secondary);
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
                    [value]="numberText().ringWidth"
                    [attr.aria-invalid]="invalid('ringWidth')"
                    [attr.aria-describedby]="describedBy('ringWidth', 'theme-ringWidth-hint')"
                    (input)="setNumber('ringWidth', $any($event.target).value)"
                    (blur)="settleNumber('ringWidth', $any($event.target))"
                  />
                  <span class="field__hint" id="theme-ringWidth-hint">From {{ ringWidthRange.min }} to {{ ringWidthRange.max }}.</span>
                </div>
                <div class="field">
                  <label class="field__label" [for]="t.cornerRadius === null ? 'theme-cornerRadius-host' : 'theme-cornerRadius'">Corner radius (px)</label>
                  <label class="checkbox">
                    <input
                      type="checkbox"
                      id="theme-cornerRadius-host"
                      [checked]="t.cornerRadius === null"
                      (change)="setHost('cornerRadius', $any($event.target).checked)"
                    />
                    The display's own (a quarter of the item size, 12 px on a banner)
                  </label>
                  @if (t.cornerRadius !== null) {
                    <input
                      id="theme-cornerRadius"
                      class="input"
                      type="number"
                      inputmode="numeric"
                      [attr.min]="cornerRadiusRange.min"
                      [attr.max]="cornerRadiusRange.max"
                      step="1"
                      [value]="numberText().cornerRadius"
                      [attr.aria-invalid]="invalid('cornerRadius')"
                      [attr.aria-describedby]="describedBy('cornerRadius', 'theme-cornerRadius-hint')"
                      (input)="setNumber('cornerRadius', $any($event.target).value)"
                      (blur)="settleNumber('cornerRadius', $any($event.target))"
                    />
                  }
                  <span class="field__hint" id="theme-cornerRadius-hint">
                    Rounded-square bar items and banner slides, {{ cornerRadiusRange.min }} to {{ cornerRadiusRange.max }} px.
                  </span>
                </div>
              </div>
            </fieldset>

            <fieldset class="theme-group">
              <legend>Colours</legend>
              <div class="theme-grid">
                @for (field of colorFields; track field.key) {
                  <div class="field">
                    <label class="field__label" [for]="'theme-' + field.key + (fromHost(field.key) ? '-host' : '')">{{ field.label }}</label>
                    @if (field.host) {
                      <label class="checkbox">
                        <input
                          type="checkbox"
                          [id]="'theme-' + field.key + '-host'"
                          [checked]="fromHost(field.key)"
                          (change)="setHost($any(field.key), $any($event.target).checked)"
                        />
                        {{ field.host.label }}
                      </label>
                    }
                    @if (!fromHost(field.key)) {
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
                    }
                    <span class="field__hint" [id]="'theme-' + field.key + '-hint'">{{ field.hint }}</span>
                  </div>
                }
              </div>
            </fieldset>

            <div class="field">
              <label class="field__label" [for]="t.fontFamily === null ? 'theme-fontFamily-host' : 'theme-fontFamily'">Font</label>
              <label class="checkbox">
                <input
                  type="checkbox"
                  id="theme-fontFamily-host"
                  [checked]="t.fontFamily === null"
                  (change)="setHost('fontFamily', $any($event.target).checked)"
                />
                Host page's font
              </label>
              @if (t.fontFamily !== null) {
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
              }
              <span class="field__hint" id="theme-fontFamily-hint">
                A CSS font-family list, such as Georgia, serif. The host page loads the font.
              </span>
            </div>

            <div role="status">
              @if (contrast().issues.length > 0) {
                <div class="contrast">
                  <strong>Some colours fail WCAG 2.2 AA contrast:</strong>
                  <ul>
                    @for (issue of contrast().issues; track issue.pair) {
                      <li>{{ issue.pair }}: {{ issue.ratio.toFixed(2) }}:1, needs {{ issue.minimum }}:1</li>
                    }
                  </ul>
                  <span>You can still save; visitors may find these hard to see.</span>
                </div>
              }
              @if (contrast().skipped.length > 0) {
                <div class="contrast contrast--note">
                  <strong>Not checked, because a colour comes from the host page:</strong>
                  <ul>
                    @for (note of contrast().skipped; track note) {
                      <li>{{ note }}</li>
                    }
                  </ul>
                  <span>Check these on the host page.</span>
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

  /** The theme being edited, every field present; null until read. */
  protected readonly theme = signal<Theme | null>(null);
  /** The fields the project sets: stored ones, and the ones changed to other than TaleArt's default. */
  private readonly touched = signal<ReadonlySet<ThemeField>>(new Set());
  /** What each number field shows: the text as typed, kept while it is not a number. */
  protected readonly numberText = signal<Record<NumberKey, string>>({ ringWidth: '', cornerRadius: '' });
  // The last valid value of each number field, restored when one is left invalid.
  private readonly lastValid: Record<NumberKey, number> = { ringWidth: 2, cornerRadius: EXPLICIT_RADIUS };
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

  /** The failing colour pairs and the ones not checked, once every colour set is a valid #rrggbb. */
  protected readonly contrast = computed(() => {
    const t = this.theme();
    if (!t) return { issues: [], skipped: [] };
    const valid =
      t.ringColors.every(isThemeColor) &&
      ['seenRingColor', 'titleColor', 'backgroundColor', 'accentColor'].every((key) =>
        isValidThemeValue(key as ThemeField, t[key as ColorKey]),
      );
    return valid ? checkThemeContrast(t) : { issues: [], skipped: [] };
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
    this.show(value.resolved, value.theme);
  }

  // Shows a theme read from or saved to the API.
  private show(resolved: Theme, stored: ThemeSettings): void {
    this.theme.set(copy(resolved));
    this.touched.set(new Set(Object.keys(stored) as ThemeField[]));
    this.lastValid.ringWidth = resolved.ringWidth;
    if (resolved.cornerRadius !== null) this.lastValid.cornerRadius = resolved.cornerRadius;
    this.numberText.set({ ringWidth: String(resolved.ringWidth), cornerRadius: String(resolved.cornerRadius ?? this.lastValid.cornerRadius) });
  }

  /** The colour picker's value: the field's colour, lowercased, or black while the hex field is not a colour. */
  protected swatch(color: string | null): string {
    return isThemeColor(color) ? color.toLowerCase() : '#000000';
  }

  /** True when a colour field takes the host page's value. */
  protected fromHost(key: ColorKey): boolean {
    const value = this.theme()?.[key];
    return value === null || value === TRANSPARENT;
  }

  protected invalid(field: ThemeField): 'true' | null {
    return this.errorField() === field ? 'true' : null;
  }

  protected describedBy(field: ThemeField, hint = ''): string | null {
    const ids = [hint, field === 'ringColors' ? 'theme-ringColors-hint' : '', this.errorField() === field ? 'theme-error' : ''];
    return ids.filter(Boolean).join(' ') || null;
  }

  // Changes one field; it counts as set unless it is back at TaleArt's default.
  private update(field: ThemeField, change: (theme: Theme) => Theme): void {
    const t = this.theme();
    if (!t) return;
    const next = change(copy(t));
    this.theme.set(next);
    const touched = new Set(this.touched());
    if (isDefault(field, next[field])) touched.delete(field);
    else touched.add(field);
    this.touched.set(touched);
    this.saved.set('');
    if (this.errorField() === field) {
      this.errorField.set('');
      this.error.set('');
    }
  }

  protected set(field: 'ringStyle' | 'fontFamily' | ColorKey, value: string): void {
    this.update(field, (t) => ({ ...t, [field]: value }));
  }

  /** Takes a value from the host page or the frame (checked), or sets an explicit one to edit. */
  protected setHost(field: 'titleColor' | 'backgroundColor' | 'fontFamily' | 'cornerRadius', host: boolean): void {
    const explicit: Record<typeof field, string | number> = {
      titleColor: COLOR_FIELDS[1].host?.explicit ?? '#111827',
      backgroundColor: COLOR_FIELDS[2].host?.explicit ?? '#ffffff',
      fontFamily: EXPLICIT_FONT,
      cornerRadius: this.lastValid.cornerRadius,
    };
    const value = host ? DEFAULT_THEME[field] : explicit[field];
    this.update(field, (t) => ({ ...t, [field]: value }));
    if (field === 'cornerRadius' && !host) this.numberText.update((text) => ({ ...text, cornerRadius: String(value) }));
  }

  // The typed text stays as it is. A number, even out of range, goes to the theme (the save check names it);
  // text that is not a number leaves the theme at its last value.
  protected setNumber(field: NumberKey, text: string): void {
    this.numberText.update((all) => ({ ...all, [field]: text }));
    const n = text.trim() === '' ? Number.NaN : Number(text);
    if (!Number.isFinite(n)) return;
    if (isValidThemeValue(field, n)) this.lastValid[field] = n;
    this.update(field, (t) => ({ ...t, [field]: n }));
  }

  // Leaving a number field with a value that is not valid restores its last valid number.
  protected settleNumber(field: NumberKey, input: HTMLInputElement): void {
    const t = this.theme();
    const text = this.numberText()[field];
    const n = text.trim() === '' ? Number.NaN : Number(text);
    if (t && Number.isFinite(n) && isValidThemeValue(field, n) && t[field] === n) return;
    const restore = this.lastValid[field];
    this.update(field, (theme) => ({ ...theme, [field]: restore }));
    this.numberText.update((all) => ({ ...all, [field]: String(restore) }));
    input.value = String(restore);
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

  /** Only the fields the project sets, in schema order. */
  private settings(t: Theme): ThemeSettings {
    const touched = this.touched();
    return Object.fromEntries(THEME_FIELDS.filter((f) => touched.has(f)).map((f) => [f, t[f]])) as ThemeSettings;
  }

  protected async save(): Promise<void> {
    const t = this.theme();
    if (!t || this.busy()) return;
    const settings = this.settings(t);
    // The same check as the API's, so an invalid value is named before anything is sent.
    const problem = themeSettingsError(settings);
    if (problem) {
      this.refuse(problem);
      return;
    }
    await this.send(settings, 'Theme saved. Reload a page with the Web SDK to see it.');
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

  private async send(theme: ThemeSettings, done: string): Promise<void> {
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
    this.show(value.resolved, value.theme);
    this.saved.set(done);
  }
}
