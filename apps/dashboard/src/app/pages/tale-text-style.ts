import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  type WritableSignal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ProjectFont } from '@taleart/contract/core';
import { fontFaceName, textWeightForFont } from '@taleart/contract/project-fonts';
import type { TextElementProps } from '@taleart/contract/tale-document';
import {
  resolveTextStyle,
  SYSTEM_FONT_STACK_KEYS,
  SYSTEM_FONT_STACK_NAMES,
  TEXT_COLOR_PATTERN,
  TEXT_LINE_HEIGHT_RANGE,
  TEXT_SIZE_PRESETS,
  TEXT_SIZE_RANGE,
  textContrast,
  textSizePreset,
  type SystemFontStack,
  type TextAlign,
  type TextBackdrop,
  type TextBackground,
  type TextContrast,
  type TextDirection,
  type TextSizePreset,
  type TextWeight,
} from '@taleart/contract/text-style';
import { isFontFamily, MAX_FONT_FAMILY_LENGTH } from '@taleart/contract/theme';
import { percent } from './tale-layers';

/** A style change the inspector asks for: one history step, with what the live region says. */
export interface TextStyleChange {
  /** The history label, such as "Font changed". */
  label: string;
  /** The props to merge into the element's props. */
  patch: Partial<TextElementProps>;
  /** What is announced once the change is made, such as "Font set to Serif". */
  said: string;
}

/** The names people read for each system stack (the contract's, shared with the font page). */
const STACK_NAMES = SYSTEM_FONT_STACK_NAMES;
const SIZE_NAMES: Readonly<Record<TextSizePreset | 'custom', string>> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  custom: 'Custom',
};
const WEIGHT_NAMES: Readonly<Record<TextWeight, string>> = { regular: 'Regular', medium: 'Medium', bold: 'Bold' };
const ALIGN_NAMES: Readonly<Record<TextAlign, string>> = { start: 'Start', center: 'Centre', end: 'End' };
const DIRECTION_NAMES: Readonly<Record<TextDirection, string>> = {
  auto: 'Automatic, from the text',
  rtl: 'Right to left',
  ltr: 'Left to right',
};
const BACKGROUND_NAMES: Readonly<Record<TextBackground, string>> = {
  none: 'None',
  box: 'Solid box',
  highlight: 'Highlight behind each line',
};
const AGAINST: Readonly<Record<'box' | 'highlight' | 'canvas' | 'media', string>> = {
  box: 'its box',
  highlight: 'its highlight',
  canvas: 'the canvas colour',
  media: 'the media behind it',
};

/**
 * A font source as the font select lists it: a system stack, the theme's font, a name the page
 * loads, or a project font as `project:<id>`.
 */
type FontChoice = SystemFontStack | 'theme' | 'name' | `project:${string}`;

const PROJECT_CHOICE = 'project:';

/**
 * A contrast ratio as people read it: rounded down to one decimal, so a ratio just under its
 * minimum never reads as the minimum ("4.5:1, below 4.5:1").
 */
export function ratioText(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1);
}

/**
 * What a contrast check says (epic Tale Studio R12): a warning only, never a block. Null when the
 * contrast is enough.
 */
export function contrastWarning(check: TextContrast, backdrop?: TextBackdrop): string | null {
  // Over media, the colours behind it are still being read (they load with the media).
  if (check.kind === 'unknown' && backdrop?.overMedia && backdrop.samples === undefined) {
    return 'Checking the contrast against the media behind it…';
  }
  // Wholly off the canvas, no one sees it: nothing to warn about.
  if (check.kind === 'unknown' && check.reason === 'off-canvas') return null;
  if (check.kind === 'unknown') {
    return (
      "Contrast can't be checked over media or the layers below the text: the media did not load, or cannot be " +
      'read here. Give the text a solid box or highlight, or check it on the preview.'
    );
  }
  if (check.kind === 'ok') return null;
  // Over media the ratio is an estimate from the picture's pixels (the worst strip of the text's
  // box), not a WCAG measurement: a photo has no single background colour.
  if (check.against === 'media') {
    return (
      `Low contrast: about ${ratioText(check.ratio)}:1 against the media behind it, so the text may be hard to ` +
      'read. This is an estimate from the picture: check it on the preview, or give the text a solid box or ' +
      'highlight. You can still save and update the tale.'
    );
  }
  return (
    `Low contrast: ${ratioText(check.ratio)}:1 against ${AGAINST[check.against]}, below the ` +
    `${check.minimum}:1 that WCAG 2.2 AA asks for text this size. You can still save and update the tale.`
  );
}

/** Parses a hex colour field: `#RRGGBB` or `#RRGGBBAA`, the `#` optional; null when it is neither. */
export function parseHexColor(value: string): string | null {
  const trimmed = value.trim();
  const color = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return TEXT_COLOR_PATTERN.test(color) ? color : null;
}

/**
 * The text style inspector of Tale Studio (epic Tale Studio R4, R12, R13, R18): font (a system
 * stack, the project theme's font, a font name the host page loads or a project font, with a
 * fallback stack), size
 * (presets or a custom value), weight, italic, line height, colour, alignment, direction and
 * background, each a named control in a labelled group and usable with the keyboard alone. It
 * asks the studio for each change (one history step each); a typed value that breaks a rule is
 * marked invalid and explained, and not applied. A contrast warning says when the text is hard to
 * read; it never blocks saving.
 */
@Component({
  selector: 'app-tale-text-style',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="text-style" [disabled]="locked()">
      <legend class="field__label">Text style</legend>
      <fieldset class="text-style__group">
        <legend class="field__label">Font and size</legend>
        <div class="field">
          <label class="field__label" for="ts-font">Font</label>
          <select id="ts-font" class="select" (change)="setFont($any($event.target).value)">
            @for (key of stacks; track key) {
              <option [value]="key" [selected]="fontChoice() === key">{{ stackNames[key] }}</option>
            }
            <option value="theme" [selected]="fontChoice() === 'theme'">Project theme font</option>
            <option value="name" [selected]="fontChoice() === 'name'">Font name loaded by the page</option>
            @if (projectFonts()?.length || missingFont()) {
              <optgroup label="Project fonts">
                @for (font of projectFonts() ?? []; track font.id) {
                  <option [value]="'project:' + font.id" [selected]="fontChoice() === 'project:' + font.id">
                    {{ projectFontName(font) }}
                  </option>
                }
                @if (missingFont(); as id) {
                  <option [value]="'project:' + id" selected>Project font (not in this project's list)</option>
                }
              </optgroup>
            }
          </select>
        </div>
        @if (fontChoice() === 'theme') {
          <p class="field__hint" id="ts-theme-hint">{{ themeHint() }}</p>
        }
        @if (isProjectChoice()) {
          <p class="field__hint" id="ts-project-hint">
            Uploaded to this project. A visitor's browser loads it only when this tale opens; the fallback font shows
            until then, and stays if the font takes over 3 seconds.
          </p>
        }
        @if (projectId(); as id) {
          <a class="text-style__link" [routerLink]="['/projects', id, 'fonts']">Manage project fonts</a>
        }
        @if (fontChoice() === 'name') {
          <div class="field">
            <label class="field__label" for="ts-family">Font name</label>
            <input
              id="ts-family"
              class="input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              [attr.maxlength]="maxFamily"
              [attr.aria-describedby]="familyError() ? 'ts-family-hint ts-family-error' : 'ts-family-hint'"
              [attr.aria-invalid]="familyError() ? 'true' : null"
              [value]="family()"
              (change)="setFamily($any($event.target))"
            />
            <span class="field__hint" id="ts-family-hint">
              A font-family the host page loads, such as Inter or "Open Sans". Letters, digits, spaces and hyphens;
              separate names with commas.
            </span>
            @if (familyError()) {
              <span class="field__error" id="ts-family-error">{{ familyError() }}</span>
            }
          </div>
        }
        @if (fontChoice() === 'theme' || fontChoice() === 'name' || isProjectChoice()) {
          <div class="field">
            <label class="field__label" for="ts-fallback">Fallback font</label>
            <select
              id="ts-fallback"
              class="select"
              aria-describedby="ts-fallback-hint"
              (change)="setFallback($any($event.target).value)"
            >
              @for (key of stacks; track key) {
                <option [value]="key" [selected]="look().fallback === key">{{ stackNames[key] }}</option>
              }
            </select>
            <span class="field__hint" id="ts-fallback-hint">Shown until, or if, the font is not available.</span>
          </div>
        }
        <div class="row">
          <div class="field">
            <label class="field__label" for="ts-size">Size</label>
            <select id="ts-size" class="select" (change)="setSizePreset($any($event.target).value)">
              @for (key of sizeKeys; track key) {
                <option [value]="key" [selected]="sizeChoice() === key">{{ sizeNames[key] }}</option>
              }
            </select>
          </div>
          @if (sizeChoice() === 'custom') {
            <div class="field">
              <label class="field__label" for="ts-size-custom">Custom size (% of canvas height)</label>
              <input
                id="ts-size-custom"
                class="input"
                type="number"
                [attr.min]="sizeMin"
                [attr.max]="sizeMax"
                step="0.5"
                [attr.aria-describedby]="sizeError() ? 'ts-size-error' : null"
                [attr.aria-invalid]="sizeError() ? 'true' : null"
                [value]="sizePercent()"
                (change)="setCustomSize($any($event.target))"
              />
              @if (sizeError()) {
                <span class="field__error" id="ts-size-error">{{ sizeError() }}</span>
              }
            </div>
          }
        </div>
        <div class="row">
          <div class="field">
            <label class="field__label" for="ts-weight">Weight</label>
            <select
              id="ts-weight"
              class="select"
              [disabled]="face() !== null"
              [attr.aria-describedby]="face() ? 'ts-face-hint' : null"
              (change)="setWeight($any($event.target).value)"
            >
              @if (look().weight === null) {
                <!-- A text stored before styling keeps its weight until one is chosen. -->
                <option value="" selected disabled>Semibold (as before)</option>
              }
              @for (key of weightKeys; track key) {
                <option [value]="key" [selected]="look().weight === key">{{ weightNames[key] }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="ts-line-height">Line height</label>
            <input
              id="ts-line-height"
              class="input"
              type="number"
              [attr.min]="lineMin"
              [attr.max]="lineMax"
              step="0.05"
              [attr.aria-describedby]="lineError() ? 'ts-line-height-error' : null"
              [attr.aria-invalid]="lineError() ? 'true' : null"
              [value]="look().lineHeight"
              (change)="setLineHeight($any($event.target))"
            />
            @if (lineError()) {
              <span class="field__error" id="ts-line-height-error">{{ lineError() }}</span>
            }
          </div>
        </div>
        <label class="checkbox">
          <input
            id="ts-italic"
            type="checkbox"
            [checked]="look().italic"
            [disabled]="face() !== null"
            [attr.aria-describedby]="face() ? 'ts-face-hint' : null"
            (change)="setItalic($any($event.target))"
          />
          Italic
        </label>
        @if (face(); as f) {
          <p class="field__hint" id="ts-face-hint">
            Weight and italic come from the project font's face, {{ faceName(f) }}, so it is never drawn bolder or
            slanted by the browser. Pick another face of the family to change them.
          </p>
        }
      </fieldset>
      <fieldset class="text-style__group">
        <legend class="field__label">Colour</legend>
        <div class="row">
          <div class="field">
            <label class="field__label" for="ts-color">Text colour</label>
            <input
              id="ts-color"
              class="input"
              type="color"
              [value]="look().color.slice(0, 7).toLowerCase()"
              aria-describedby="ts-contrast"
              (change)="pickColor('color', $any($event.target).value, colorHex)"
            />
          </div>
          <div class="field">
            <label class="field__label" for="ts-color-hex">Text colour hex</label>
            <input
              #colorHex
              id="ts-color-hex"
              class="input input--mono"
              type="text"
              spellcheck="false"
              autocomplete="off"
              [attr.aria-describedby]="
                colorError() ? 'ts-hex-hint ts-color-error ts-contrast' : 'ts-hex-hint ts-contrast'
              "
              [attr.aria-invalid]="colorError() ? 'true' : null"
              [value]="look().color"
              (change)="setHex('color', $any($event.target))"
            />
          </div>
        </div>
        <span class="field__hint" id="ts-hex-hint">As #RRGGBB, or #RRGGBBAA with transparency.</span>
        @if (colorError()) {
          <span class="field__error" id="ts-color-error">{{ colorError() }}</span>
        }
      </fieldset>
      <fieldset class="text-style__group" aria-describedby="ts-align-hint">
        <legend class="field__label">Alignment and direction</legend>
        <div class="text-style__choices">
          @for (key of alignKeys; track key) {
            <label class="checkbox">
              <input
                type="radio"
                name="ts-align"
                [id]="'ts-align-' + key"
                [value]="key"
                [checked]="look().align === key"
                (change)="setAlign(key)"
              />
              {{ alignNames[key] }}
            </label>
          }
        </div>
        <span class="field__hint" id="ts-align-hint">Start and end follow the text direction.</span>
        <div class="field">
          <label class="field__label" for="ts-direction">Text direction</label>
          <select
            id="ts-direction"
            class="select"
            aria-describedby="ts-direction-hint"
            (change)="setDirection($any($event.target).value)"
          >
            @for (key of directionKeys; track key) {
              <option [value]="key" [selected]="look().direction === key">{{ directionNames[key] }}</option>
            }
          </select>
          <span class="field__hint" id="ts-direction-hint">
            Automatic takes each text's direction from its first letter: Hebrew and Arabic read right to left, other
            text left to right.
          </span>
        </div>
      </fieldset>
      <fieldset class="text-style__group">
        <legend class="field__label">Background</legend>
        <div class="field">
          <label class="field__label" for="ts-background">Background</label>
          <select id="ts-background" class="select" (change)="setBackground($any($event.target).value)">
            @for (key of backgroundKeys; track key) {
              <option [value]="key" [selected]="look().background === key">{{ backgroundNames[key] }}</option>
            }
          </select>
        </div>
        @if (look().background !== 'none') {
          <div class="row">
            <div class="field">
              <label class="field__label" for="ts-bg-color">Background colour</label>
              <input
                id="ts-bg-color"
                class="input"
                type="color"
                [value]="look().backgroundColor.slice(0, 7).toLowerCase()"
                (change)="pickColor('backgroundColor', $any($event.target).value, bgHex)"
              />
            </div>
            <div class="field">
              <label class="field__label" for="ts-bg-hex">Background colour hex</label>
              <input
                #bgHex
                id="ts-bg-hex"
                class="input input--mono"
                type="text"
                spellcheck="false"
                autocomplete="off"
                [attr.aria-describedby]="bgError() ? 'ts-hex-hint ts-bg-error' : 'ts-hex-hint'"
                [attr.aria-invalid]="bgError() ? 'true' : null"
                [value]="look().backgroundColor"
                (change)="setHex('backgroundColor', $any($event.target))"
              />
            </div>
          </div>
          @if (bgError()) {
            <span class="field__error" id="ts-bg-error">{{ bgError() }}</span>
          }
        }
      </fieldset>
    </fieldset>
    <!-- Not a live region: the studio says when a change turns the warning on or off. -->
    <p class="text-style__contrast" id="ts-contrast" [class.is-warning]="warning() !== null">
      {{ warning() ?? contrastNote() }}
    </p>
  `,
})
export class TaleTextStyle {
  /** The selected text's id: a new one starts the inspector over. */
  readonly elementId = input.required<string>();
  /** The selected text's props. */
  readonly props = input.required<TextElementProps>();
  /** A locked layer's style cannot be changed. */
  readonly locked = input(false);
  /** The project theme's font-family list; null when the theme sets none; undefined while unknown. */
  readonly themeFont = input<string | null | undefined>(undefined);
  /** What lies behind the text, for the contrast check. */
  readonly backdrop = input.required<TextBackdrop>();
  /** The project's fonts (R18); null while unknown. */
  readonly projectFonts = input<readonly ProjectFont[] | null>(null);
  /** The tale's project, for the link to its fonts. */
  readonly projectId = input<string | null>(null);
  /** A change the studio makes, as one history step. */
  readonly changed = output<TextStyleChange>();
  /** Something to announce that is no change: a typed value refused, or a choice waiting for a value. */
  readonly notice = output<string>();

  protected readonly stacks = SYSTEM_FONT_STACK_KEYS;
  protected readonly stackNames = STACK_NAMES;
  protected readonly sizeKeys = [...(Object.keys(TEXT_SIZE_PRESETS) as TextSizePreset[]), 'custom' as const];
  protected readonly sizeNames = SIZE_NAMES;
  protected readonly weightKeys = Object.keys(WEIGHT_NAMES) as TextWeight[];
  protected readonly weightNames = WEIGHT_NAMES;
  protected readonly alignKeys = Object.keys(ALIGN_NAMES) as TextAlign[];
  protected readonly alignNames = ALIGN_NAMES;
  protected readonly directionKeys = Object.keys(DIRECTION_NAMES) as TextDirection[];
  protected readonly directionNames = DIRECTION_NAMES;
  protected readonly backgroundKeys = Object.keys(BACKGROUND_NAMES) as TextBackground[];
  protected readonly backgroundNames = BACKGROUND_NAMES;
  protected readonly maxFamily = MAX_FONT_FAMILY_LENGTH;
  protected readonly sizeMin = percent(TEXT_SIZE_RANGE.min);
  protected readonly sizeMax = percent(TEXT_SIZE_RANGE.max);
  protected readonly lineMin = TEXT_LINE_HEIGHT_RANGE.min;
  protected readonly lineMax = TEXT_LINE_HEIGHT_RANGE.max;

  /** The text's complete style, defaults filled in. */
  protected readonly look = computed(() => resolveTextStyle(this.props()));
  // "Font name" or "Custom" chosen before a valid name or size is typed: shown, not yet applied.
  private readonly pendingName = signal(false);
  private readonly pendingCustom = signal(false);
  protected readonly familyError = signal('');
  protected readonly sizeError = signal('');
  protected readonly lineError = signal('');
  protected readonly colorError = signal('');
  protected readonly bgError = signal('');

  protected readonly fontChoice = computed<FontChoice>(() => {
    const font = this.look().font;
    if (this.pendingName()) return 'name';
    if (font.source === 'project') return `${PROJECT_CHOICE}${font.fontId}`;
    return font.source === 'system' ? font.stack : font.source;
  });
  protected readonly isProjectChoice = computed(() => this.fontChoice().startsWith(PROJECT_CHOICE));
  /**
   * The project font face the text uses, when the project's list holds it: its weight and italic
   * are tied to the face (no synthetic bold or oblique), so those controls are off.
   */
  protected readonly face = computed(() => {
    const font = this.look().font;
    if (font.source !== 'project' || this.pendingName()) return null;
    return this.projectFonts()?.find((f) => f.id === font.fontId) ?? null;
  });
  /** The text's project font when the project's list (once read) does not hold it. */
  protected readonly missingFont = computed(() => {
    const font = this.look().font;
    const list = this.projectFonts();
    return font.source === 'project' && list !== null && !list.some((f) => f.id === font.fontId) ? font.fontId : null;
  });
  protected readonly family = computed(() => {
    const font = this.look().font;
    return font.source === 'name' ? font.family : '';
  });
  protected readonly sizeChoice = computed(() => (this.pendingCustom() ? 'custom' : textSizePreset(this.look().size)));
  protected readonly sizePercent = computed(() => percent(this.look().size));
  protected readonly themeHint = computed(() => {
    const font = this.themeFont();
    if (font === undefined) return "The project theme's font is shown on the sample page; it could not be read here.";
    return font === null
      ? 'The project theme sets no font, so the fallback font shows.'
      : `The project theme's font: ${font}.`;
  });
  private readonly contrast = computed(() => textContrast(this.look(), this.backdrop()));
  protected readonly warning = computed(() => contrastWarning(this.contrast(), this.backdrop()));
  protected readonly contrastNote = computed(() => {
    const check = this.contrast();
    if (check.kind === 'unknown') return check.reason === 'off-canvas' ? 'The text is outside the canvas: no one sees it.' : '';
    if (check.kind !== 'ok') return '';
    return check.against === 'media'
      ? `Contrast about ${ratioText(check.ratio)}:1 against the media behind it (an estimate from the picture).`
      : `Contrast ${ratioText(check.ratio)}:1 against ${AGAINST[check.against]}.`;
  });

  constructor() {
    // Another text selected: what was pending or refused for the last one is dropped.
    effect(() => {
      this.elementId();
      this.pendingName.set(false);
      this.pendingCustom.set(false);
      this.clearErrors();
    });
  }

  private clearErrors(): void {
    this.familyError.set('');
    this.sizeError.set('');
    this.lineError.set('');
    this.colorError.set('');
    this.bgError.set('');
  }

  private emit(label: string, patch: Partial<TextElementProps>, said: string): void {
    this.changed.emit({ label, patch, said });
  }

  private refuse(error: WritableSignal<string>, message: string): void {
    error.set(message);
    this.notice.emit(message);
  }

  protected faceName(font: ProjectFont): string {
    return fontFaceName(font);
  }

  protected projectFontName(font: ProjectFont): string {
    return `${font.family} ${fontFaceName(font)}`;
  }

  protected setFont(choice: FontChoice): void {
    this.familyError.set('');
    if (choice.startsWith(PROJECT_CHOICE)) {
      this.pendingName.set(false);
      const font = this.projectFonts()?.find((f) => `${PROJECT_CHOICE}${f.id}` === choice);
      if (!font) return;
      // The text takes the face's fallback, weight and style, so the browser draws the face itself.
      this.emit(
        'Font changed',
        {
          font: { source: 'project', fontId: font.id },
          fallback: font.fallback as SystemFontStack,
          weight: textWeightForFont(font.weight),
          italic: font.style === 'italic',
        },
        `Font set to ${this.projectFontName(font)}`,
      );
      return;
    }
    if (choice === 'name') {
      // Applied once a valid name is typed.
      this.pendingName.set(this.look().font.source !== 'name');
      if (this.pendingName()) this.notice.emit('Type a font name the page loads, then leave the field to apply it.');
      return;
    }
    this.pendingName.set(false);
    if (choice === 'theme') {
      this.emit('Font changed', { font: { source: 'theme' } }, 'Font set to the project theme font');
      return;
    }
    const stack = choice as SystemFontStack;
    this.emit('Font changed', { font: { source: 'system', stack } }, `Font set to ${STACK_NAMES[stack]}`);
  }

  protected setFamily(field: HTMLInputElement): void {
    const family = field.value.trim();
    if (!isFontFamily(family)) {
      this.refuse(
        this.familyError,
        'Enter font names of letters, digits, spaces and hyphens, optionally in quotes, separated by commas ' +
          '(not a CSS keyword such as inherit). The font is not changed.',
      );
      return;
    }
    this.familyError.set('');
    this.pendingName.set(false);
    field.value = family;
    this.emit('Font changed', { font: { source: 'name', family } }, `Font set to ${family}`);
  }

  protected setFallback(stack: SystemFontStack): void {
    this.emit('Fallback font changed', { fallback: stack }, `Fallback font set to ${STACK_NAMES[stack]}`);
  }

  protected setSizePreset(choice: TextSizePreset | 'custom'): void {
    this.sizeError.set('');
    if (choice === 'custom') {
      this.pendingCustom.set(true);
      this.notice.emit('Type a custom size in % of the canvas height, then leave the field to apply it.');
      return;
    }
    this.pendingCustom.set(false);
    this.emit('Text size changed', { size: TEXT_SIZE_PRESETS[choice] }, `Size set to ${SIZE_NAMES[choice]}`);
  }

  protected setCustomSize(field: HTMLInputElement): void {
    const value = Number(field.value);
    if (field.value.trim() === '' || !Number.isFinite(value) || value < this.sizeMin || value > this.sizeMax) {
      this.refuse(
        this.sizeError,
        `Enter a size from ${this.sizeMin} to ${this.sizeMax} % of the canvas height. It stays ${this.sizePercent()} %.`,
      );
      return;
    }
    this.sizeError.set('');
    // Kept as a custom size even when it matches a preset, until another preset is chosen.
    this.pendingCustom.set(true);
    const size = Math.round(value * 10) / 1000;
    this.emit('Text size changed', { size }, `Size set to ${percent(size)} % of the canvas height`);
  }

  protected setWeight(weight: TextWeight): void {
    if (this.face()) return;
    this.emit('Text weight changed', { weight }, `Weight set to ${WEIGHT_NAMES[weight]}`);
  }

  protected setItalic(field: HTMLInputElement): void {
    if (this.face()) return;
    this.emit('Italic changed', { italic: field.checked }, field.checked ? 'Italic on' : 'Italic off');
  }

  protected setLineHeight(field: HTMLInputElement): void {
    const value = Number(field.value);
    if (field.value.trim() === '' || !Number.isFinite(value) || value < this.lineMin || value > this.lineMax) {
      this.refuse(
        this.lineError,
        `Enter a line height from ${this.lineMin} to ${this.lineMax}. It stays ${this.look().lineHeight}.`,
      );
      return;
    }
    this.lineError.set('');
    const lineHeight = Math.round(value * 100) / 100;
    this.emit('Line height changed', { lineHeight }, `Line height set to ${lineHeight}`);
  }

  /**
   * The colour picker gives `#rrggbb`; a colour with transparency keeps its alpha. The hex field
   * always shows the picked colour, even after it held a refused value and the colour is unchanged.
   */
  protected pickColor(field: 'color' | 'backgroundColor', picked: string, hex: HTMLInputElement): void {
    const current = this.look()[field];
    const color = current.length === 9 ? `${picked}${current.slice(7)}` : picked;
    hex.value = color;
    this.applyColor(field, color);
  }

  protected setHex(field: 'color' | 'backgroundColor', input: HTMLInputElement): void {
    const color = parseHexColor(input.value);
    const error = field === 'color' ? this.colorError : this.bgError;
    if (color === null) {
      this.refuse(error, `Enter a colour as #RRGGBB or #RRGGBBAA. It stays ${this.look()[field]}.`);
      return;
    }
    input.value = color;
    this.applyColor(field, color);
  }

  private applyColor(field: 'color' | 'backgroundColor', color: string): void {
    (field === 'color' ? this.colorError : this.bgError).set('');
    if (field === 'color') this.emit('Text colour changed', { color }, `Text colour set to ${color}`);
    else this.emit('Text background colour changed', { backgroundColor: color }, `Background colour set to ${color}`);
  }

  protected setAlign(align: TextAlign): void {
    this.emit('Alignment changed', { align }, `Aligned to ${ALIGN_NAMES[align].toLowerCase()}`);
  }

  protected setDirection(direction: TextDirection): void {
    this.emit('Text direction changed', { direction }, `Direction set to ${DIRECTION_NAMES[direction].toLowerCase()}`);
  }

  protected setBackground(background: TextBackground): void {
    const patch: Partial<TextElementProps> = { background };
    // The colour is stored with the choice, so it is explicit and saved.
    if (background !== 'none') patch.backgroundColor = this.look().backgroundColor;
    this.emit('Text background changed', patch, `Background set to ${BACKGROUND_NAMES[background].toLowerCase()}`);
  }
}
