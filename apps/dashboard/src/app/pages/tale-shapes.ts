// Tale Studio's shapes and emoji (epic Tale Studio R6, R12, R13): the emoji picker, with each
// emoji's Unicode name, and the inspectors of a selected shape or emoji.
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  cleanText,
  EMOJI_FONT_STACK,
  LABEL_TEXT_RULE,
  MAX_LABEL_LENGTH,
  MAX_SHAPE_RADIUS,
  MAX_STROKE_WIDTH,
  resolveShapeStyle,
  type EmojiElement,
  type ShapeElement,
  type ShapeKind,
  type TaleElementA11y,
} from '@taleart/contract/tale-document';
import { Drawer } from '../drawer';
import { parseHexColor } from './tale-text-style';

/** One emoji the picker offers, with its Unicode (CLDR) name, the accessible name it starts with. */
export interface EmojiChoice {
  emoji: string;
  name: string;
}

/** A group of the picker. */
export interface EmojiGroup {
  name: string;
  emoji: readonly EmojiChoice[];
}

const group = (name: string, list: string): EmojiGroup => ({
  name,
  emoji: list.split('|').map((entry) => {
    const [emoji, label] = entry.split('=');
    return { emoji, name: label };
  }),
});

/**
 * The emoji the picker offers (R6), each fully qualified and named by its Unicode (CLDR) name. The
 * server accepts any single RGI emoji, so this list can grow without a contract change.
 */
export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  group(
    'Smileys',
    '😀=grinning face|😃=grinning face with big eyes|😄=grinning face with smiling eyes|😁=beaming face with smiling eyes|' +
      '😂=face with tears of joy|🤣=rolling on the floor laughing|😊=smiling face with smiling eyes|😇=smiling face with halo|' +
      '🙂=slightly smiling face|😉=winking face|😍=smiling face with heart-eyes|🥰=smiling face with hearts|' +
      '😘=face blowing a kiss|😋=face savoring food|😜=winking face with tongue|🤩=star-struck|🥳=partying face|' +
      '😎=smiling face with sunglasses|🤔=thinking face|🤗=smiling face with open hands|😮=face with open mouth|' +
      '😱=face screaming in fear|😢=crying face|😭=loudly crying face|😴=sleeping face|🤯=exploding head|' +
      '😅=grinning face with sweat|🙃=upside-down face|🤤=drooling face|😬=grimacing face',
  ),
  group(
    'People and gestures',
    '👍=thumbs up|👎=thumbs down|👏=clapping hands|🙌=raising hands|👋=waving hand|🤝=handshake|🙏=folded hands|' +
      '✌️=victory hand|🤞=crossed fingers|👌=OK hand|👉=backhand index pointing right|👆=backhand index pointing up|' +
      '💪=flexed biceps|👀=eyes|🫶=heart hands|🤙=call me hand',
  ),
  group(
    'Hearts and symbols',
    '❤️=red heart|🧡=orange heart|💛=yellow heart|💚=green heart|💙=blue heart|💜=purple heart|🖤=black heart|' +
      '🤍=white heart|💖=sparkling heart|💯=hundred points|✨=sparkles|⭐=star|🌟=glowing star|🔥=fire|⚡=high voltage|' +
      '💥=collision|✅=check mark button|❌=cross mark|❗=red exclamation mark|❓=red question mark|🆕=NEW button|' +
      '🆓=FREE button|🔔=bell|📣=megaphone|💬=speech balloon',
  ),
  group(
    'Nature',
    '☀️=sun|🌈=rainbow|☁️=cloud|❄️=snowflake|🌊=water wave|🌸=cherry blossom|🌹=rose|🌻=sunflower|🌴=palm tree|' +
      '🍀=four leaf clover|🐶=dog face|🐱=cat face|🦊=fox|🐻=bear|🐼=panda|🦄=unicorn|🐝=honeybee|🦋=butterfly',
  ),
  group(
    'Food and drink',
    '🍕=pizza|🍔=hamburger|🍟=french fries|🌮=taco|🍣=sushi|🍩=doughnut|🍰=shortcake|🎂=birthday cake|🍦=soft ice cream|' +
      '🍓=strawberry|🍉=watermelon|🥑=avocado|☕=hot beverage|🍹=tropical drink|🥂=clinking glasses',
  ),
  group(
    'Celebration and things',
    '🎉=party popper|🎊=confetti ball|🎈=balloon|🎁=wrapped gift|🏆=trophy|🥇=1st place medal|🎵=musical note|' +
      '🎶=musical notes|📸=camera with flash|🛍️=shopping bags|🛒=shopping cart|💰=money bag|💳=credit card|🏷️=label|' +
      '📦=package|🚀=rocket|✈️=airplane|🚗=automobile|⏰=alarm clock|📍=round pushpin|💡=light bulb|🔒=locked|' +
      '🎯=bullseye|⚽=soccer ball|🎮=video game',
  ),
];

/** The number of emoji in a row of the picker, for the up and down arrows. */
export const EMOJI_COLUMNS = 8;

/** The picker's emoji whose name holds every word of `query`, in order of the groups. */
export function searchEmoji(query: string): EmojiChoice[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return EMOJI_GROUPS.flatMap((g) => g.emoji).filter((choice) =>
    words.every((word) => choice.name.toLowerCase().includes(word) || choice.emoji === word),
  );
}

/** The Unicode name the picker knows for an emoji, or null. */
export function emojiName(emoji: string): string | null {
  for (const g of EMOJI_GROUPS) {
    const found = g.emoji.find((choice) => choice.emoji === emoji);
    if (found) return found.name;
  }
  return null;
}

/**
 * The emoji picker (R6, R13), in a drawer: a search by name and the emoji in groups, each a button
 * named by its Unicode name. The list is one tab stop: the arrow keys move between emoji (up and
 * down by a row), Home and End go to the first and last, and Enter or Space picks one.
 */
@Component({
  selector: 'app-tale-emoji-picker',
  imports: [Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .emoji-group {
      margin: 0 0 var(--space-4);
    }
    .emoji-grid {
      display: grid;
      grid-template-columns: repeat(8, minmax(0, 1fr));
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .emoji-choice {
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 1;
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--radius-control);
      background: transparent;
      font-size: 1.5rem;
      line-height: 1;
      cursor: pointer;
    }
    .emoji-choice:hover {
      border-color: var(--line, #ccc);
    }
    .emoji-choice:focus-visible {
      outline: 3px solid var(--ember);
      outline-offset: 1px;
    }
    .emoji-choice[aria-current='true'] {
      border-color: var(--ember);
    }
  `,
  template: `
    <app-drawer [heading]="heading()" [returnFocus]="returnFocus()" (closed)="closed.emit()">
      <div class="drawer__body">
        <div class="field">
          <label class="field__label" for="emoji-search">Search emoji by name</label>
          <input
            id="emoji-search"
            class="input"
            type="search"
            autocomplete="off"
            aria-describedby="emoji-hint"
            [value]="query()"
            (input)="search($any($event.target).value)"
          />
          <span class="field__hint" id="emoji-hint">
            The arrow keys move between emoji, Enter adds one. Its name is what screen readers say; you can edit it.
          </span>
        </div>
        <p class="visually-hidden" role="status">{{ status() }}</p>
        @if (groups().length === 0) {
          <p class="muted">No emoji has that name.</p>
        }
        @for (g of groups(); track g.name) {
          <section class="emoji-group" [attr.aria-labelledby]="'emoji-group-' + $index">
            <h3 class="field__label" [id]="'emoji-group-' + $index">{{ g.name }}</h3>
            <ul class="emoji-grid" [attr.aria-labelledby]="'emoji-group-' + $index">
              @for (choice of g.emoji; track choice.emoji) {
                @let i = indexOf(choice);
                <li>
                  <button
                    type="button"
                    class="emoji-choice"
                    [id]="'emoji-choice-' + i"
                    [attr.aria-label]="choice.name"
                    [attr.aria-current]="choice.emoji === current() ? 'true' : null"
                    [attr.tabindex]="i === active() ? 0 : -1"
                    [style.font-family]="emojiFont"
                    (focus)="active.set(i)"
                    (keydown)="move($event, i)"
                    (click)="chosen.emit(choice)"
                  >
                    {{ choice.emoji }}
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      </div>
    </app-drawer>
  `,
})
export class TaleEmojiPicker {
  readonly heading = input('Add an emoji');
  /** The emoji in use now, marked in the list. */
  readonly current = input<string | null>(null);
  readonly returnFocus = input<HTMLElement | null>(null);
  readonly chosen = output<EmojiChoice>();
  readonly closed = output<void>();

  protected readonly emojiFont = EMOJI_FONT_STACK;
  protected readonly query = signal('');
  /** The emoji shown, in order: every emoji, or those whose name matches the search. */
  private readonly shown = computed(() => searchEmoji(this.query()));
  protected readonly groups = computed(() => {
    const shown = new Set(this.shown());
    return EMOJI_GROUPS.map((g) => ({ name: g.name, emoji: g.emoji.filter((e) => shown.has(e)) })).filter(
      (g) => g.emoji.length > 0,
    );
  });
  /** The list's one tab stop. */
  protected readonly active = signal(0);
  protected readonly status = computed(() => (this.query().trim() ? `${this.shown().length} emoji found` : ''));

  protected indexOf(choice: EmojiChoice): number {
    return this.shown().indexOf(choice);
  }

  protected search(value: string): void {
    this.query.set(value);
    this.active.set(0);
  }

  protected move(event: KeyboardEvent, index: number): void {
    const last = this.shown().length - 1;
    const steps: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + EMOJI_COLUMNS,
      ArrowUp: index - EMOJI_COLUMNS,
      Home: 0,
      End: last,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = Math.min(last, Math.max(0, steps[event.key]));
    this.active.set(next);
    (event.currentTarget as HTMLElement).ownerDocument.getElementById(`emoji-choice-${next}`)?.focus();
  }
}

/**
 * A change an inspector asks for: one history step, with what the live region says. A prop set
 * to `undefined` is removed (a shape with no fill, no stroke).
 */
export interface ElementChange {
  label: string;
  props?: Readonly<Record<string, unknown>>;
  a11y?: TaleElementA11y;
  said: string;
}

/** The names people read for each shape. */
export const SHAPE_NAMES: Readonly<Record<ShapeKind, string>> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
};

const percent = (fraction: number) => Math.round(fraction * 1000) / 10;

// One line of label text, without the characters a label may not hold, within its limit.
const cleanLabel = (value: string) =>
  [...cleanText(value.replace(/\n/g, ' '), LABEL_TEXT_RULE)].slice(0, MAX_LABEL_LENGTH).join('');

/**
 * The inspector of a selected shape (R6, R12): fill and stroke colours (a rectangle or ellipse may
 * have none of either; a line has a stroke only), stroke width, a rectangle's corner radius,
 * opacity, and whether it is decorative (new shapes are) or named for screen readers. Values are
 * checked here as the server checks them; a value out of range is put back with a message.
 */
@Component({
  selector: 'app-tale-shape-style',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let id = element().id;
    @if (look().shape !== 'line') {
      <div class="row">
        <div class="field">
          <label class="field__label" [for]="'shape-fill-' + id">Fill colour</label>
          <input
            class="input"
            type="color"
            [id]="'shape-fill-' + id"
            [disabled]="locked() || look().fill === null"
            [value]="(look().fill ?? '#ffffff').slice(0, 7).toLowerCase()"
            (change)="pick('fill', $any($event.target).value)"
          />
        </div>
        <div class="field">
          <label class="field__label" [for]="'shape-fill-hex-' + id">Fill hex</label>
          <input
            class="input input--mono"
            type="text"
            spellcheck="false"
            autocomplete="off"
            [id]="'shape-fill-hex-' + id"
            [readOnly]="locked() || look().fill === null"
            [value]="look().fill ?? ''"
            (change)="setHex('fill', $any($event.target))"
          />
        </div>
      </div>
      <label class="checkbox">
        <input
          type="checkbox"
          [id]="'shape-no-fill-' + id"
          [checked]="look().fill === null"
          [disabled]="locked()"
          (change)="toggle('fill', !$any($event.target).checked)"
        />
        No fill
      </label>
    }
    <div class="row">
      <div class="field">
        <label class="field__label" [for]="'shape-stroke-' + id">{{
          look().shape === 'line' ? 'Colour' : 'Stroke colour'
        }}</label>
        <input
          class="input"
          type="color"
          [id]="'shape-stroke-' + id"
          [disabled]="locked() || look().stroke === null"
          [value]="(look().stroke ?? '#ffffff').slice(0, 7).toLowerCase()"
          (change)="pick('stroke', $any($event.target).value)"
        />
      </div>
      <div class="field">
        <label class="field__label" [for]="'shape-stroke-hex-' + id">{{
          look().shape === 'line' ? 'Colour hex' : 'Stroke hex'
        }}</label>
        <input
          class="input input--mono"
          type="text"
          spellcheck="false"
          autocomplete="off"
          [id]="'shape-stroke-hex-' + id"
          [readOnly]="locked() || look().stroke === null"
          [value]="look().stroke ?? ''"
          (change)="setHex('stroke', $any($event.target))"
        />
      </div>
      <div class="field">
        <label class="field__label" [for]="'shape-stroke-width-' + id">{{
          look().shape === 'line' ? 'Thickness (%)' : 'Stroke width (%)'
        }}</label>
        <input
          class="input"
          type="number"
          [min]="look().shape === 'line' ? 0.1 : 0"
          [max]="maxStroke"
          step="0.1"
          [id]="'shape-stroke-width-' + id"
          [readOnly]="locked() || look().stroke === null"
          [value]="percent(look().strokeWidth)"
          (change)="setStrokeWidth($any($event.target))"
        />
      </div>
    </div>
    @if (look().shape !== 'line') {
      <label class="checkbox">
        <input
          type="checkbox"
          [id]="'shape-no-stroke-' + id"
          [checked]="look().stroke === null"
          [disabled]="locked()"
          (change)="toggle('stroke', !$any($event.target).checked)"
        />
        No stroke
      </label>
    }
    @if (hexError()) {
      <span class="field__error" role="alert">{{ hexError() }}</span>
    }
    <div class="row">
      @if (look().shape === 'rectangle') {
        <div class="field">
          <label class="field__label" [for]="'shape-radius-' + id">Corner radius (%)</label>
          <input
            class="input"
            type="number"
            min="0"
            [max]="maxRadius"
            step="0.5"
            [id]="'shape-radius-' + id"
            [readOnly]="locked()"
            [value]="percent(look().radius)"
            (change)="setRadius($any($event.target))"
          />
        </div>
      }
      <div class="field">
        <label class="field__label" [for]="'shape-opacity-' + id">Opacity (%)</label>
        <input
          class="input"
          type="number"
          min="0"
          max="100"
          step="5"
          [id]="'shape-opacity-' + id"
          [readOnly]="locked()"
          [value]="opacity()"
          (change)="setOpacity($any($event.target))"
        />
      </div>
    </div>
    <span class="field__hint">Widths and the corner radius are shares of the canvas height.</span>
    <label class="checkbox">
      <input
        type="checkbox"
        [id]="'shape-decorative-' + id"
        [checked]="decorative()"
        [disabled]="locked()"
        (change)="setDecorative($any($event.target))"
      />
      Decorative: screen readers skip it
    </label>
    @if (!decorative()) {
      <div class="field">
        <label class="field__label" [for]="'shape-label-' + id">What it shows</label>
        <input
          class="input"
          type="text"
          [id]="'shape-label-' + id"
          [attr.aria-describedby]="'shape-label-hint-' + id"
          [readOnly]="locked()"
          [maxLength]="maxLabel"
          [value]="element().a11y.label ?? ''"
          (change)="setLabel($any($event.target))"
        />
        <span class="field__hint" [id]="'shape-label-hint-' + id">
          Screen readers announce the shape by this name. Without one, they skip it.
        </span>
      </div>
    }
  `,
})
export class TaleShapeStyle {
  readonly element = input.required<ShapeElement>();
  readonly locked = input(false);
  readonly changed = output<ElementChange>();
  readonly notice = output<string>();

  protected readonly maxStroke = percent(MAX_STROKE_WIDTH);
  protected readonly maxRadius = percent(MAX_SHAPE_RADIUS);
  protected readonly maxLabel = MAX_LABEL_LENGTH;
  protected readonly percent = percent;
  protected readonly hexError = signal('');
  protected readonly look = computed(
    () =>
      resolveShapeStyle(this.element().props) ?? {
        shape: 'rectangle' as const,
        fill: null,
        stroke: null,
        strokeWidth: 0,
        radius: 0,
        opacity: 1,
      },
  );
  protected readonly opacity = computed(() => Math.round(this.look().opacity * 100));
  protected readonly decorative = computed(() => this.element().a11y.decorative === true);
  private readonly kind = computed(() => SHAPE_NAMES[this.look().shape]);

  private fieldName(field: 'fill' | 'stroke'): string {
    if (field === 'fill') return 'Fill';
    return this.look().shape === 'line' ? 'Line colour' : 'Stroke colour';
  }

  protected pick(field: 'fill' | 'stroke', picked: string): void {
    const current = this.look()[field] ?? '';
    // The colour input has no alpha: a translucent colour keeps its alpha.
    this.applyColor(field, current.length === 9 ? `${picked}${current.slice(7)}` : picked);
  }

  protected setHex(field: 'fill' | 'stroke', input: HTMLInputElement): void {
    const color = parseHexColor(input.value);
    if (color === null) {
      input.value = this.look()[field] ?? '';
      this.hexError.set(`Enter the ${this.fieldName(field).toLowerCase()} as #RRGGBB or #RRGGBBAA.`);
      return;
    }
    input.value = color;
    this.applyColor(field, color);
  }

  private applyColor(field: 'fill' | 'stroke', color: string): void {
    if (this.locked()) return;
    this.hexError.set('');
    const name = this.fieldName(field);
    this.changed.emit({ label: `${name} changed`, props: { [field]: color }, said: `${name} set to ${color}` });
  }

  /** Turns the fill or the stroke on (white, and a thin stroke) or off. */
  protected toggle(field: 'fill' | 'stroke', on: boolean): void {
    if (this.locked()) return;
    const name = field === 'fill' ? 'Fill' : 'Stroke';
    const props: Record<string, unknown> =
      field === 'fill'
        ? { fill: on ? '#FFFFFF' : undefined }
        : { stroke: on ? '#FFFFFF' : undefined, strokeWidth: on ? 0.005 : undefined };
    this.changed.emit({
      label: on ? `${name} added` : `${name} removed`,
      props,
      said: on ? `${name} added` : `No ${name.toLowerCase()}`,
    });
  }

  protected setStrokeWidth(field: HTMLInputElement): void {
    const line = this.look().shape === 'line';
    const min = line ? 0.001 : 0;
    const requested = Number(field.value);
    if (this.locked() || field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(percent(this.look().strokeWidth));
      if (!this.locked()) this.notice.emit(`Enter a number up to ${this.maxStroke}; it stays at ${field.value}%`);
      return;
    }
    const value = Math.min(MAX_STROKE_WIDTH, Math.max(min, Math.round(requested * 10) / 1000));
    field.value = String(percent(value));
    const name = line ? 'Line thickness' : 'Stroke width';
    this.changed.emit({
      label: `${name} changed`,
      props: { strokeWidth: value },
      said: `${name} set to ${percent(value)}%`,
    });
  }

  protected setRadius(field: HTMLInputElement): void {
    const requested = Number(field.value);
    if (this.locked() || field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(percent(this.look().radius));
      if (!this.locked()) this.notice.emit(`Enter a number from 0 to ${this.maxRadius}; it stays at ${field.value}%`);
      return;
    }
    const value = Math.min(MAX_SHAPE_RADIUS, Math.max(0, Math.round(requested * 10) / 1000));
    field.value = String(percent(value));
    this.changed.emit({
      label: 'Corner radius changed',
      props: { radius: value || undefined },
      said: `Corner radius set to ${percent(value)}%`,
    });
  }

  protected setOpacity(field: HTMLInputElement): void {
    const requested = Number(field.value);
    if (this.locked() || field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(this.opacity());
      if (!this.locked()) this.notice.emit(`Enter a number from 0 to 100; it stays at ${field.value}%`);
      return;
    }
    const value = Math.min(1, Math.max(0, Math.round(requested) / 100));
    field.value = String(Math.round(value * 100));
    this.changed.emit({
      label: 'Opacity changed',
      props: { opacity: value === 1 ? undefined : value },
      said: `Opacity set to ${Math.round(value * 100)}%`,
    });
  }

  protected setDecorative(box: HTMLInputElement): void {
    if (this.locked()) {
      box.checked = this.decorative();
      return;
    }
    const a11y: TaleElementA11y = { ...this.element().a11y };
    if (box.checked) a11y.decorative = true;
    else delete a11y.decorative;
    this.changed.emit({
      label: box.checked ? 'Marked decorative' : 'Decorative mark removed',
      a11y,
      said: box.checked
        ? `${this.kind()} marked decorative: screen readers skip it`
        : `${this.kind()} no longer decorative. Name it for screen readers.`,
    });
  }

  protected setLabel(field: HTMLInputElement): void {
    if (this.locked()) return;
    const label = cleanLabel(field.value);
    field.value = label;
    const a11y: TaleElementA11y = { ...this.element().a11y };
    if (label.trim()) a11y.label = label;
    else delete a11y.label;
    this.changed.emit({
      label: 'Shape name changed',
      a11y,
      said: label.trim() ? `${this.kind()} named ${label}` : `${this.kind()} name removed; screen readers skip it`,
    });
  }
}

/**
 * The inspector of a selected emoji (R6, R12): its name for screen readers, which starts as the
 * emoji's Unicode name and can be edited, the decorative mark, and a way to choose another emoji.
 */
@Component({
  selector: 'app-tale-emoji-style',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let id = element().id;
    <div class="field">
      <label class="field__label" [for]="'emoji-label-' + id">Name read by screen readers</label>
      <input
        class="input"
        type="text"
        [id]="'emoji-label-' + id"
        [attr.aria-describedby]="'emoji-label-hint-' + id"
        [readOnly]="locked()"
        [disabled]="decorative()"
        [maxLength]="maxLabel"
        [value]="element().a11y.label ?? ''"
        (change)="setLabel($any($event.target))"
      />
      <span class="field__hint" [id]="'emoji-label-hint-' + id">
        Starts as the emoji's Unicode name{{ unicodeName() ? ' (' + unicodeName() + ')' : '' }}; say what it means here.
        Left empty, screen readers read the emoji's own name.
      </span>
    </div>
    <label class="checkbox">
      <input
        type="checkbox"
        [id]="'emoji-decorative-' + id"
        [checked]="decorative()"
        [disabled]="locked()"
        (change)="setDecorative($any($event.target))"
      />
      Decorative: it adds nothing to the tale, and screen readers skip it
    </label>
    <div class="row">
      <button
        type="button"
        class="btn btn--secondary btn--sm"
        [id]="'emoji-replace-' + id"
        [attr.aria-disabled]="locked() ? 'true' : null"
        (click)="locked() ? notice.emit(lockedHint()) : replace.emit()"
      >
        Choose another emoji…
      </button>
    </div>
  `,
})
export class TaleEmojiStyle {
  readonly element = input.required<EmojiElement>();
  readonly locked = input(false);
  readonly lockedHint = input('');
  readonly changed = output<ElementChange>();
  readonly notice = output<string>();
  readonly replace = output<void>();

  protected readonly maxLabel = MAX_LABEL_LENGTH;
  protected readonly decorative = computed(() => this.element().a11y.decorative === true);
  protected readonly unicodeName = computed(() => emojiName(this.element().props.emoji));

  protected setLabel(field: HTMLInputElement): void {
    if (this.locked()) return;
    const label = cleanLabel(field.value);
    field.value = label;
    const a11y: TaleElementA11y = { ...this.element().a11y };
    if (label.trim()) a11y.label = label;
    else delete a11y.label;
    this.changed.emit({
      label: 'Emoji name changed',
      a11y,
      said: label.trim() ? `Emoji named ${label}` : "Emoji name removed; screen readers read the emoji's own name",
    });
  }

  protected setDecorative(box: HTMLInputElement): void {
    if (this.locked()) {
      box.checked = this.decorative();
      return;
    }
    const a11y: TaleElementA11y = { ...this.element().a11y };
    if (box.checked) a11y.decorative = true;
    else delete a11y.decorative;
    this.changed.emit({
      label: box.checked ? 'Marked decorative' : 'Decorative mark removed',
      a11y,
      said: box.checked ? 'Emoji marked decorative: screen readers skip it' : 'Emoji no longer decorative',
    });
  }
}
