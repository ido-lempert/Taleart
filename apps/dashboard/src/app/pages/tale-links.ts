// Tale Studio's calls to action (epic Tale Studio R7, R12, R13, R14): the inspector of a selected
// button, image button or swipe-up link, with its web address checked as people type by the same
// rule the server applies, and a contrast warning for a label (a warning only, as for text).
import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import {
  BUTTON_VARIANTS,
  cleanText,
  hasAltText,
  isLinkUrl,
  LABEL_TEXT_RULE,
  LINK_URL_MESSAGES,
  linkUrlProblem,
  MAX_LABEL_LENGTH,
  MAX_LINK_LABEL_LENGTH,
  MAX_LINK_RADIUS,
  resolveButtonStyle,
  resolveSwipeUpStyle,
  type ButtonVariant,
  type LinkElement,
  type TaleElementA11y,
} from '@taleart/contract/tale-document';
import {
  isSmallTarget,
  linkLabelStyle,
  MIN_TARGET_PX,
  textContrast,
  type TextBackdrop,
} from '@taleart/contract/text-style';
import type { ElementChange } from './tale-shapes';
import { contrastWarning, parseHexColor } from './tale-text-style';
import { percent } from './tale-layers';

/** How people read each button style. */
export const VARIANT_NAMES: Readonly<Record<ButtonVariant, string>> = { filled: 'Filled', outline: 'Outline' };

/** How people read each link type. */
export const LINK_KIND_NAMES: Readonly<Record<LinkElement['type'], string>> = {
  button: 'Button',
  'image-button': 'Image button',
  'swipe-up': 'Swipe-up link',
};

/**
 * What the web address field says about a typed value: null when it is a destination a link may
 * open, else why not, in the words the server's refusal uses (R7, R14).
 */
export function hrefMessage(value: string): string | null {
  const problem = linkUrlProblem(value);
  return problem === null ? null : LINK_URL_MESSAGES[problem];
}

/** True when the link has no destination that passes the rule: it keeps the tale from being updated (R7). */
export function needsLinkUrl(element: { props: unknown }): boolean {
  return !isLinkUrl((element.props as { href?: unknown }).href);
}

// One line of label text, without the characters a label may not hold, within its limit.
const cleanLine = (value: string, max: number) =>
  [...cleanText(value.replace(/\s+/g, ' '), LABEL_TEXT_RULE)].slice(0, max).join('');

type ColorField = 'color' | 'fill' | 'background';

/**
 * The inspector of a selected link (R7): its web address and whether it opens in a new tab, and
 * per type a button's label, style, colours and corner radius; an image button's alt text (which
 * names the link: it cannot be decorative), image and corner radius; the swipe-up link's label and
 * colours. Each control is labelled and works from the keyboard; a value that breaks a rule is
 * explained and not applied.
 */
@Component({
  selector: 'app-tale-link-style',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let id = element().id;
    @let el = element();
    <div class="field">
      <label class="field__label" [for]="'link-href-' + id">Web address</label>
      <input
        class="input input--mono"
        type="url"
        inputmode="url"
        spellcheck="false"
        autocomplete="off"
        placeholder="https://"
        aria-required="true"
        [id]="'link-href-' + id"
        [attr.aria-describedby]="
          hrefError() ? 'link-href-hint-' + id + ' link-href-error-' + id : 'link-href-hint-' + id
        "
        [attr.aria-invalid]="hrefError() || missingHref() ? 'true' : null"
        [readOnly]="locked()"
        [value]="href()"
        (input)="checkHref($any($event.target))"
        (change)="setHref($any($event.target))"
      />
      <span class="field__hint" [id]="'link-href-hint-' + id">
        @if (missingHref()) {
          Needs a web address before the tale can be updated.
        }
        A full address starting with https:// or http://.
      </span>
      @if (hrefError()) {
        <span class="field__error" [id]="'link-href-error-' + id">{{ hrefError() }}</span>
      }
    </div>
    <label class="checkbox">
      <input
        type="checkbox"
        [id]="'link-new-tab-' + id"
        [checked]="el.props.newTab === true"
        [disabled]="locked()"
        (change)="setNewTab($any($event.target))"
      />
      Open in a new tab
    </label>
    @if (el.type === 'image-button') {
      <div class="field">
        <label class="field__label" [for]="'link-alt-' + id">Alt text</label>
        <input
          class="input"
          type="text"
          aria-required="true"
          [id]="'link-alt-' + id"
          [attr.aria-describedby]="'link-alt-hint-' + id"
          [attr.aria-invalid]="missingAlt() ? 'true' : null"
          [readOnly]="locked()"
          [maxLength]="maxAlt"
          [value]="el.a11y.label ?? ''"
          (change)="setAlt($any($event.target))"
        />
        <span class="field__hint" [id]="'link-alt-hint-' + id">
          @if (missingAlt()) {
            Needs alt text before the tale can be updated.
          }
          Screen readers announce the button by it: say where it leads, such as "Shop the summer collection".
        </span>
      </div>
      <div class="row">
        <button
          type="button"
          class="btn btn--secondary btn--sm"
          [id]="'link-image-' + id"
          [attr.aria-disabled]="locked() ? 'true' : null"
          (click)="locked() ? notice.emit(lockedHint()) : replace.emit()"
        >
          Choose another image…
        </button>
      </div>
    } @else {
      <div class="field">
        <label class="field__label" [for]="'link-label-' + id">Label</label>
        <input
          class="input"
          type="text"
          [id]="'link-label-' + id"
          [attr.aria-describedby]="'link-label-hint-' + id"
          [readOnly]="locked()"
          [maxLength]="maxLabel"
          [value]="el.props.label"
          (change)="setLabel($any($event.target))"
        />
        <span class="field__hint" [id]="'link-label-hint-' + id">
          One line, up to {{ maxLabel }} characters. Screen readers announce the link by it.
        </span>
      </div>
    }
    @if (el.type === 'button') {
      <div class="field">
        <label class="field__label" [for]="'link-variant-' + id">Style</label>
        <select
          class="input"
          [id]="'link-variant-' + id"
          [disabled]="locked()"
          (change)="setVariant($any($event.target).value)"
        >
          @for (variant of variants; track variant) {
            <option [value]="variant" [selected]="variant === button().variant">{{ variantNames[variant] }}</option>
          }
        </select>
      </div>
    }
    @if (el.type !== 'image-button') {
      @for (field of colorFields(); track field.key) {
        <div class="row">
          <div class="field">
            <label class="field__label" [for]="'link-' + field.key + '-' + id">{{ field.name }}</label>
            <input
              class="input"
              type="color"
              [id]="'link-' + field.key + '-' + id"
              [attr.aria-describedby]="'link-contrast-' + id"
              [disabled]="locked()"
              [value]="field.value.slice(0, 7).toLowerCase()"
              (change)="pick(field.key, $any($event.target).value)"
            />
          </div>
          <div class="field">
            <label class="field__label" [for]="'link-' + field.key + '-hex-' + id">{{ field.name }} hex</label>
            <input
              class="input input--mono"
              type="text"
              spellcheck="false"
              autocomplete="off"
              [id]="'link-' + field.key + '-hex-' + id"
              [readOnly]="locked()"
              [value]="field.value"
              (change)="setHex(field.key, $any($event.target))"
            />
          </div>
        </div>
      }
      @if (hexError()) {
        <span class="field__error" role="alert">{{ hexError() }}</span>
      }
    }
    @if (el.type !== 'swipe-up') {
      <div class="field">
        <label class="field__label" [for]="'link-radius-' + id">Corner radius (%)</label>
        <input
          class="input"
          type="number"
          min="0"
          [max]="maxRadius"
          step="0.5"
          [id]="'link-radius-' + id"
          [attr.aria-describedby]="'link-radius-hint-' + id"
          [readOnly]="locked()"
          [value]="radius()"
          (change)="setRadius($any($event.target))"
        />
        <span class="field__hint" [id]="'link-radius-hint-' + id">A share of the canvas height.</span>
      </div>
    } @else {
      <p class="field__hint" [id]="'link-pinned-' + id">
        Pinned to the bottom of the tale; a tale holds one. Visitors open it by swiping up, by clicking it, or by
        pressing Enter on it.
      </p>
    }
    @if (smallTarget()) {
      <!-- A warning only, as for contrast: saving and updating the tale stay allowed. -->
      <p class="text-style__contrast is-warning" [id]="'link-target-' + id">
        Small target: under {{ minTarget }} px on the smallest phone, which is hard to tap. Make it larger. You can
        still save and update the tale.
      </p>
    }
    @if (el.type !== 'image-button') {
      <!-- Not a live region: the studio says when a change turns the warning on or off. -->
      <p class="text-style__contrast" [id]="'link-contrast-' + id" [class.is-warning]="warning() !== null">
        {{ warning() ?? '' }}
      </p>
    }
  `,
})
export class TaleLinkStyle {
  readonly element = input.required<LinkElement>();
  readonly locked = input(false);
  readonly lockedHint = input('');
  /** What lies behind the link, for its label's contrast check. */
  readonly backdrop = input<TextBackdrop>({ canvasColor: '#000000', overMedia: false });
  readonly changed = output<ElementChange>();
  readonly notice = output<string>();
  /** The image button asks for another image. */
  readonly replace = output<void>();

  protected readonly maxLabel = MAX_LINK_LABEL_LENGTH;
  protected readonly maxAlt = MAX_LABEL_LENGTH;
  protected readonly minTarget = MIN_TARGET_PX;
  /** The button or image button is smaller than a 24 px target on the smallest phone (WCAG 2.5.8): a warning. */
  protected readonly smallTarget = computed(
    () => this.element().type !== 'swipe-up' && isSmallTarget(this.element().box),
  );
  protected readonly maxRadius = percent(MAX_LINK_RADIUS);
  protected readonly variants = BUTTON_VARIANTS;
  protected readonly variantNames = VARIANT_NAMES;
  protected readonly hexError = signal('');
  protected readonly href = computed(() => {
    const href = (this.element().props as { href?: unknown }).href;
    return typeof href === 'string' ? href : '';
  });
  /** Why the address typed is refused, shown under the field; reset when another link is selected. */
  protected readonly hrefError = linkedSignal<string, string>({
    source: () => this.element().id,
    computation: () => '',
  });
  protected readonly missingHref = computed(() => needsLinkUrl(this.element()) && !this.hrefError());
  protected readonly missingAlt = computed(() => this.element().type === 'image-button' && !hasAltText(this.element()));
  protected readonly button = computed(() => resolveButtonStyle(this.element().props));
  private readonly kind = computed(() => LINK_KIND_NAMES[this.element().type]);
  protected readonly radius = computed(() => {
    const r = (this.element().props as { radius?: unknown }).radius;
    return percent(typeof r === 'number' ? r : 0);
  });
  protected readonly colorFields = computed<{ key: ColorField; name: string; value: string }[]>(() => {
    const el = this.element();
    if (el.type === 'button') {
      const look = this.button();
      return [
        { key: 'color', name: 'Label colour', value: look.color },
        { key: 'fill', name: look.variant === 'filled' ? 'Button colour' : 'Edge colour', value: look.fill },
      ];
    }
    const look = resolveSwipeUpStyle(el.props);
    return [
      { key: 'color', name: 'Label colour', value: look.color },
      { key: 'background', name: 'Background colour', value: look.background },
    ];
  });
  /** The label's contrast warning (R12): a warning only, never a block. */
  protected readonly warning = computed(() => {
    const style = linkLabelStyle(this.element());
    return style ? contrastWarning(textContrast(style, this.backdrop()), this.backdrop()) : null;
  });

  private value(field: ColorField): string {
    return this.colorFields().find((f) => f.key === field)?.value ?? '';
  }

  private fieldName(field: ColorField): string {
    return this.colorFields().find((f) => f.key === field)?.name ?? 'Colour';
  }

  /** Checks the address as it is typed: an error shows only once the value is not empty. */
  protected checkHref(field: HTMLInputElement): void {
    const value = field.value.trim();
    this.hrefError.set(value === '' ? '' : (hrefMessage(value) ?? ''));
  }

  /** Applies the address when it passes the rule the server applies; otherwise it stays in the field, explained. */
  protected setHref(field: HTMLInputElement): void {
    if (this.locked()) {
      field.value = this.href();
      return;
    }
    const value = field.value.trim();
    if (value === '') {
      this.hrefError.set('');
      if (this.href() === '') return;
      this.changed.emit({
        label: 'Web address removed',
        props: { href: undefined },
        said: `Web address removed. The ${this.kind().toLowerCase()} needs one before the tale can be updated.`,
      });
      return;
    }
    const message = hrefMessage(value);
    if (message) {
      this.hrefError.set(message);
      this.notice.emit(`Web address not saved: ${message}`);
      return;
    }
    this.hrefError.set('');
    field.value = value;
    if (value === this.href()) return;
    this.changed.emit({ label: 'Web address changed', props: { href: value }, said: `Web address set to ${value}` });
  }

  protected setNewTab(box: HTMLInputElement): void {
    if (this.locked()) {
      box.checked = this.element().props.newTab === true;
      return;
    }
    this.changed.emit({
      label: box.checked ? 'Opens in a new tab' : 'Opens in the same tab',
      props: { newTab: box.checked ? true : undefined },
      said: box.checked ? 'Opens in a new tab' : 'Opens in the same tab',
    });
  }

  protected setLabel(field: HTMLInputElement): void {
    const el = this.element();
    if (this.locked() || el.type === 'image-button') return;
    const label = cleanLine(field.value, MAX_LINK_LABEL_LENGTH).trim();
    if (!label) {
      field.value = el.props.label;
      this.notice.emit(`A label needs some text; it stays "${el.props.label}"`);
      return;
    }
    field.value = label;
    this.changed.emit({ label: 'Label changed', props: { label }, said: `Label set to ${label}` });
  }

  protected setAlt(field: HTMLInputElement): void {
    if (this.locked()) return;
    const label = cleanLine(field.value, MAX_LABEL_LENGTH).trim();
    field.value = label;
    const a11y: TaleElementA11y = { ...this.element().a11y };
    delete a11y.decorative;
    if (label) a11y.label = label;
    else delete a11y.label;
    this.changed.emit({
      label: 'Alt text changed',
      a11y,
      said: label
        ? `Alt text set to ${label}`
        : 'Alt text removed. The image button needs some before the tale can be updated.',
    });
  }

  protected setVariant(value: string): void {
    if (this.locked() || !(BUTTON_VARIANTS as readonly string[]).includes(value)) return;
    const variant = value as ButtonVariant;
    this.changed.emit({
      label: 'Button style changed',
      props: { variant },
      said: `Button style set to ${VARIANT_NAMES[variant]}`,
    });
  }

  protected pick(field: ColorField, picked: string): void {
    const current = this.value(field);
    // The colour input has no alpha: a translucent colour keeps its alpha.
    this.applyColor(field, current.length === 9 ? `${picked}${current.slice(7)}` : picked);
  }

  protected setHex(field: ColorField, input: HTMLInputElement): void {
    const color = parseHexColor(input.value);
    if (color === null) {
      input.value = this.value(field);
      this.hexError.set(`Enter the ${this.fieldName(field).toLowerCase()} as #RRGGBB or #RRGGBBAA.`);
      return;
    }
    input.value = color;
    this.applyColor(field, color);
  }

  private applyColor(field: ColorField, color: string): void {
    if (this.locked()) return;
    this.hexError.set('');
    const name = this.fieldName(field);
    this.changed.emit({ label: `${name} changed`, props: { [field]: color }, said: `${name} set to ${color}` });
  }

  protected setRadius(field: HTMLInputElement): void {
    const requested = Number(field.value);
    if (this.locked() || field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(this.radius());
      if (!this.locked()) this.notice.emit(`Enter a number from 0 to ${this.maxRadius}; it stays at ${field.value}%`);
      return;
    }
    const value = Math.min(MAX_LINK_RADIUS, Math.max(0, Math.round(requested * 10) / 1000));
    field.value = String(percent(value));
    this.changed.emit({
      label: 'Corner radius changed',
      props: { radius: value || undefined },
      said: `Corner radius set to ${percent(value)}%`,
    });
  }
}
