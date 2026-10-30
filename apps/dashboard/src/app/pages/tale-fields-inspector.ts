import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { EMOJI_FONT_STACK, propSchema, propValueProblem, type PropSchema } from '@taleart/contract/tale-document';
import { emojiName, TaleEmojiPicker, type ElementChange, type EmojiChoice } from './tale-shapes';
import type {
  ChoiceColorField,
  ChoicesField,
  EmojiListField,
  FieldsInspector,
  InspectorField,
  StudioElementType,
} from './tale-element-types';

/** One choice's label as the inspector shows it (epic interactive components R1). */
interface ChoiceView {
  /** The error key: `<prop>/<choice id>`, so an error moves with its choice. */
  key: string;
  index: number;
  /** Its input's DOM id; its list buttons add `-up`, `-down` and `-remove`. */
  id: string;
  /** The choice's own id, kept as it is edited and moved. */
  choiceId: string;
  label: string;
  value: string;
  /** The choice's colour now, as `#rrggbb`, or '' for none. */
  color: string;
}

/** A choices field as the inspector shows it: its items and the label's schema. */
interface ChoicesView extends ChoicesField {
  id: string;
  schema: PropSchema;
  items: ChoiceView[];
  /** A list field: choices are added, removed and moved (story 4.3). */
  list: boolean;
  /** The fewest and the most choices its schema allows. */
  min: number;
  max: number;
  /** The correct choice's id now, or '' for none. */
  correctId: string;
  /** The colour of each choice, when the colour input shows now (its prop holds one of its values). */
  colorShown: ChoiceColorField | null;
}

/** One emoji of an emoji list as the inspector shows it (components, 2026-10-29). */
interface EmojiItemView {
  index: number;
  /** Its button's DOM id; its list buttons add `-up`, `-down` and `-remove`. */
  id: string;
  /** The name the list gives it, such as "Emoji 1". */
  label: string;
  /** The emoji now. */
  value: string;
}

/** An emoji list as the inspector shows it: its emoji and the counts its array prop allows. */
interface EmojiListView extends EmojiListField {
  id: string;
  /** The fewest and the most emoji its schema allows. */
  min: number;
  max: number;
  items: EmojiItemView[];
}

/** An open emoji picker: for the emoji at `index`, or for a new one (null), and where focus returns. */
interface EmojiPick {
  index: number | null;
  heading: string;
  current: string | null;
  returnFocus: HTMLElement | null;
}

/** One field as the inspector shows it: the descriptor's field with its schema rules. */
interface FieldView extends InspectorField {
  id: string;
  schema: PropSchema;
  required: boolean;
  value: string;
}

/** The element the inspector edits: its id and props, as the document holds them. */
interface Edited {
  id: string;
  props: Readonly<Record<string, unknown>>;
}

// A field's error key is its prop; a choice's is `<prop>/<choice id>`.
const splitKey = (key: string): [string, string | null] => {
  const at = key.indexOf('/');
  return at === -1 ? [key, null] : [key.slice(0, at), key.slice(at + 1)];
};

const propsOf = (element: { props: unknown }): Readonly<Record<string, unknown>> =>
  typeof element.props === 'object' && element.props !== null ? (element.props as Record<string, unknown>) : {};

/**
 * The inspector of an element type registered by configuration (epic Tale Studio R8): one control
 * per field of the type's descriptor, in order. Each value is checked with the type's props schema
 * as it is typed (`propValueProblem`, the rules the server applies again on save), then with the
 * descriptor's own `check`; a refused value is not applied and the field says why in its error
 * line, a polite live region that is always there. An optional field left empty is removed.
 */
@Component({
  selector: 'app-tale-fields-inspector',
  imports: [TaleEmojiPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (field of fields(); track field.prop) {
      @let invalid = errors()[field.prop] ? 'true' : null;
      <div class="field">
        <label class="field__label" [for]="field.id">{{ field.label }}</label>
        @switch (field.control) {
          @case ('select') {
            <select
              class="input"
              [id]="field.id"
              [disabled]="locked()"
              [attr.aria-describedby]="describedBy(field)"
              [attr.aria-invalid]="invalid"
              [attr.aria-required]="field.required ? 'true' : null"
              (change)="apply(field, $any($event.target).value)"
            >
              @if (!field.required && !field.shows) {
                <option value="" [selected]="field.value === ''">None</option>
              }
              @for (option of field.options ?? []; track option.value) {
                <option [value]="option.value" [selected]="option.value === field.value">{{ option.label }}</option>
              }
            </select>
          }
          @case ('color') {
            <div class="row">
              <input
                class="input"
                type="color"
                [id]="field.id"
                [disabled]="locked()"
                [attr.aria-describedby]="describedBy(field)"
                [attr.aria-invalid]="invalid"
                [value]="(field.value || '#000000').toLowerCase()"
                (change)="apply(field, $any($event.target).value.toUpperCase())"
              />
              <input
                class="input input--mono"
                type="text"
                spellcheck="false"
                autocomplete="off"
                [id]="field.id + '-hex'"
                [attr.aria-label]="field.label + ' hex'"
                [attr.aria-invalid]="invalid"
                [attr.aria-required]="field.required ? 'true' : null"
                [attr.aria-describedby]="describedBy(field)"
                [readOnly]="locked()"
                [value]="field.value"
                (input)="check(field, $any($event.target).value)"
                (change)="apply(field, $any($event.target).value)"
              />
            </div>
          }
          @case ('emoji') {
            <div class="row fields-emoji">
              <span class="fields-emoji__glyph" aria-hidden="true" [style.font-family]="emojiFont">{{ field.value }}</span>
              <button
                type="button"
                class="btn btn--secondary btn--sm"
                [id]="field.id"
                [attr.aria-label]="emojiButtonName(field)"
                [attr.aria-describedby]="describedBy(field)"
                [attr.aria-disabled]="locked() ? 'true' : null"
                (click)="openEmoji(field, $event)"
              >
                Choose emoji…
              </button>
            </div>
          }
          @default {
            <input
              class="input"
              [type]="field.control === 'number' ? 'number' : 'text'"
              [id]="field.id"
              [attr.min]="field.schema.minimum ?? null"
              [attr.max]="field.schema.maximum ?? null"
              [attr.step]="field.schema.type === 'integer' ? 1 : null"
              [attr.aria-invalid]="invalid"
              [attr.aria-describedby]="describedBy(field)"
              [attr.aria-required]="field.required ? 'true' : null"
              [readOnly]="locked()"
              [value]="field.value"
              (input)="check(field, $any($event.target).value)"
              (change)="apply(field, $any($event.target).value)"
            />
          }
        }
        @if (field.hint) {
          <span class="field__hint" [id]="field.id + '-hint'">{{ field.hint }}</span>
        }
        <span class="field__error" aria-live="polite" [id]="field.id + '-error'">{{ errors()[field.prop] ?? '' }}</span>
      </div>
    }
    @if (emojiList(); as list) {
      <fieldset class="field fields-choices" [attr.aria-describedby]="list.hint ? list.id + '-hint' : null">
        <legend class="field__label">{{ list.label }}</legend>
        @if (list.hint) {
          <span class="field__hint" [id]="list.id + '-hint'">{{ list.hint }}</span>
        }
        @for (item of list.items; track item.index) {
          <div class="field">
            <div class="row fields-emoji">
              <span class="fields-emoji__glyph" aria-hidden="true" [style.font-family]="emojiFont">{{ item.value }}</span>
              <button
                type="button"
                class="btn btn--secondary btn--sm"
                [id]="item.id"
                [attr.aria-label]="emojiItemName(item)"
                [attr.aria-describedby]="list.id + '-error'"
                [attr.aria-disabled]="locked() ? 'true' : null"
                (click)="openEmojiItem(item, $event)"
              >
                Choose emoji…
              </button>
            </div>
            <!-- Each button's name starts with its visible text (WCAG 2.5.3), then names the emoji. -->
            <div class="row fields-choice__actions">
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                [id]="item.id + '-up'"
                [attr.aria-disabled]="locked() || $first ? 'true' : null"
                (click)="moveEmoji(list, item, -1)"
              >
                Move up<span class="visually-hidden">: {{ item.label }}</span>
              </button>
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                [id]="item.id + '-down'"
                [attr.aria-disabled]="locked() || $last ? 'true' : null"
                (click)="moveEmoji(list, item, 1)"
              >
                Move down<span class="visually-hidden">: {{ item.label }}</span>
              </button>
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                [id]="item.id + '-remove'"
                [attr.aria-disabled]="locked() || list.items.length <= list.min ? 'true' : null"
                (click)="removeEmoji(list, item)"
              >
                Remove<span class="visually-hidden">: {{ item.label }}</span>
              </button>
            </div>
          </div>
        }
        <div class="field">
          <button
            type="button"
            class="btn btn--secondary btn--sm fields-choices__add"
            [id]="list.id + '-add'"
            [attr.aria-describedby]="list.id + '-count'"
            [attr.aria-disabled]="locked() || list.items.length >= list.max ? 'true' : null"
            (click)="openEmojiAdd(list, $event)"
          >
            Add emoji
          </button>
          <span class="field__hint" [id]="list.id + '-count'">{{ emojiCountHint(list) }}</span>
        </div>
        <span class="field__error" aria-live="polite" [id]="list.id + '-error'">{{ errors()[list.prop] ?? '' }}</span>
      </fieldset>
    }
    @if (choices(); as group) {
      <fieldset class="field fields-choices" [attr.aria-describedby]="group.hint ? group.id + '-hint' : null">
        <legend class="field__label">{{ group.label }}</legend>
        @if (group.hint) {
          <span class="field__hint" [id]="group.id + '-hint'">{{ group.hint }}</span>
        }
        @for (item of group.items; track item.choiceId) {
          @let invalid = errors()[item.key] ? 'true' : null;
          <div class="field">
            <label class="field__label" [for]="item.id">{{ item.label }}</label>
            <input
              class="input"
              type="text"
              [id]="item.id"
              aria-required="true"
              [attr.aria-invalid]="invalid"
              [attr.aria-describedby]="item.id + '-error'"
              [readOnly]="locked()"
              [value]="item.value"
              (input)="checkChoice(group, item, $any($event.target).value)"
              (change)="applyChoice(group, item, $any($event.target).value)"
            />
            <span class="field__error" aria-live="polite" [id]="item.id + '-error'">{{ errors()[item.key] ?? '' }}</span>
            @if (group.colorShown; as color) {
              @let colorInvalid = errors()[item.key + '#color'] ? 'true' : null;
              <div class="row fields-choice__color">
                <label class="field__label" [for]="item.id + '-color'">{{ color.label }}: {{ item.label }}</label>
                <input
                  class="input"
                  type="color"
                  [id]="item.id + '-color'"
                  [disabled]="locked()"
                  [attr.aria-invalid]="colorInvalid"
                  [attr.aria-describedby]="item.id + '-color-hint ' + item.id + '-color-error'"
                  [value]="item.color || '#000000'"
                  (change)="applyChoiceColor(group, item, $any($event.target).value)"
                />
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  [id]="item.id + '-color-clear'"
                  [attr.aria-disabled]="locked() || !item.color ? 'true' : null"
                  (click)="applyChoiceColor(group, item, null)"
                >
                  No colour<span class="visually-hidden">: {{ item.label }}</span>
                </button>
              </div>
              <span class="field__hint" [id]="item.id + '-color-hint'">{{ color.hint ?? '' }}</span>
              <span class="field__error" aria-live="polite" [id]="item.id + '-color-error'">{{ errors()[item.key + '#color'] ?? '' }}</span>
            }
            @if (group.list) {
              <!-- Each button's name starts with its visible text (WCAG 2.5.3), then names the answer. -->
              <div class="row fields-choice__actions">
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  [id]="item.id + '-up'"
                  [attr.aria-disabled]="locked() || $first ? 'true' : null"
                  (click)="moveChoice(group, item, -1)"
                >
                  Move up<span class="visually-hidden">: {{ item.label }}</span>
                </button>
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  [id]="item.id + '-down'"
                  [attr.aria-disabled]="locked() || $last ? 'true' : null"
                  (click)="moveChoice(group, item, 1)"
                >
                  Move down<span class="visually-hidden">: {{ item.label }}</span>
                </button>
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  [id]="item.id + '-remove'"
                  [attr.aria-disabled]="locked() || group.items.length <= group.min ? 'true' : null"
                  (click)="removeChoice(group, item)"
                >
                  Remove<span class="visually-hidden">: {{ item.label }}</span>
                </button>
              </div>
            }
          </div>
        }
        @if (group.list) {
          <div class="field">
            <button
              type="button"
              class="btn btn--secondary btn--sm fields-choices__add"
              [id]="group.id + '-add'"
              [attr.aria-describedby]="group.id + '-count'"
              [attr.aria-disabled]="locked() || group.items.length >= group.max ? 'true' : null"
              (click)="addChoice(group)"
            >
              {{ group.addLabel }}
            </button>
            <span class="field__hint" [id]="group.id + '-count'">{{ countHint(group) }}</span>
          </div>
        }
        @if (group.correct; as correct) {
          <div class="field">
            <label class="field__label" [for]="group.id + '-correct'">{{ correct.label }}</label>
            <select
              class="input"
              [id]="group.id + '-correct'"
              [disabled]="locked()"
              [attr.aria-describedby]="correct.hint ? group.id + '-correct-hint ' + group.id + '-correct-error' : group.id + '-correct-error'"
              (change)="pickCorrect(group, $any($event.target).value)"
            >
              <option value="" [selected]="group.correctId === ''">{{ correct.none }}</option>
              @for (item of group.items; track item.choiceId) {
                <option [value]="item.choiceId" [selected]="item.choiceId === group.correctId">{{ item.label }}: {{ item.value }}</option>
              }
            </select>
            @if (correct.hint) {
              <span class="field__hint" [id]="group.id + '-correct-hint'">{{ correct.hint }}</span>
            }
            <span class="field__error" aria-live="polite" [id]="group.id + '-correct-error'">{{ errors()[correct.prop] ?? '' }}</span>
          </div>
        }
      </fieldset>
    }
    @if (picking(); as open) {
      <app-tale-emoji-picker
        [heading]="'Choose the ' + open.field.label.toLowerCase()"
        [current]="open.field.value || null"
        [returnFocus]="open.returnFocus"
        (chosen)="pickedEmoji(open.field, $event)"
        (closed)="picking.set(null)"
      />
    }
    @if (emojiPick(); as pick) {
      <app-tale-emoji-picker
        [heading]="pick.heading"
        [current]="pick.current"
        [returnFocus]="pick.returnFocus"
        (chosen)="pickedListEmoji($event)"
        (closed)="emojiPick.set(null)"
      />
    }
  `,
  styles: `
    .fields-emoji { align-items: center; }
    .fields-emoji__glyph { font-size: 1.75rem; line-height: 1; min-width: 2rem; text-align: center; }
    .fields-choice__actions { flex-wrap: wrap; gap: 4px; }
    .fields-choices__add { justify-self: start; }
    .fields-choice__color { align-items: center; flex-wrap: wrap; gap: 8px; }
  `,
})
export class TaleFieldsInspector {
  readonly element = input.required<{ id: string; props: unknown }>();
  readonly type = input.required<StudioElementType>();
  readonly locked = input(false);
  readonly changed = output<ElementChange>();

  protected readonly emojiFont = EMOJI_FONT_STACK;
  /** The emoji picker, while it is open for an emoji field, and the control focus returns to. */
  protected readonly picking = signal<{ field: FieldView; returnFocus: HTMLElement | null } | null>(null);
  /** The emoji picker, while it is open for an emoji list's item or to add one. */
  protected readonly emojiPick = signal<EmojiPick | null>(null);

  private readonly edited = computed<Edited>(() => ({ id: this.element().id, props: propsOf(this.element()) }));

  /**
   * What is wrong with each field's typed value, by prop. Cleared for another element, and for a
   * prop whose value changed under it (an undo, a redo): the field then shows the document's value.
   */
  protected readonly errors = linkedSignal<Edited, Readonly<Record<string, string>>>({
    source: this.edited,
    computation: (now, previous) => {
      if (!previous || previous.source.id !== now.id) return {};
      return Object.fromEntries(
        // A field's error is kept while its prop is unchanged; a choice's (`answers/<id>`) while that
        // choice is still there with the same label, wherever it moved, so its input (tracked by the
        // choice's id, still showing the refused text) and its error stay together.
        Object.entries(previous.value).filter(([key]) => {
          const [prop, choiceId] = splitKey(key);
          if (choiceId === null) return previous.source.props[prop] === now.props[prop];
          const label = (props: Readonly<Record<string, unknown>>) => {
            const items = props[prop];
            const found = Array.isArray(items) ? (items as { id?: unknown; label?: unknown }[]).find((c) => c?.id === choiceId) : undefined;
            return found ? found.label : undefined;
          };
          const before = label(previous.source.props);
          return before !== undefined && before === label(now.props);
        }),
      );
    },
  });

  protected readonly fields = computed<FieldView[]>(() => {
    const type = this.type();
    const props = this.edited().props;
    const inspector = type.inspector as FieldsInspector;
    return inspector.fields.flatMap((field) => {
      const found = propSchema(type.schema, field.prop);
      if (!found) return [];
      const value = props[field.prop];
      return [
        {
          ...field,
          id: `field-${type.key}-${field.prop}-${this.element().id}`,
          schema: found.schema,
          required: found.required,
          value: value === undefined || value === null ? (field.shows ?? '') : String(value),
        },
      ];
    });
  });

  /** The descriptor's emoji list now, or null for a type without one (components, 2026-10-29). */
  protected readonly emojiList = computed<EmojiListView | null>(() => {
    const type = this.type();
    const list = (type.inspector as FieldsInspector).emojis;
    if (!list) return null;
    const array = propSchema(type.schema, list.prop)?.schema as { minItems?: number; maxItems?: number } | undefined;
    const emojis = this.currentEmojis(list.prop);
    const id = `field-${type.key}-${list.prop}-${this.element().id}`;
    return {
      ...list,
      id,
      min: array?.minItems ?? emojis.length,
      max: array?.maxItems ?? emojis.length,
      items: emojis.map((value, index) => ({ index, id: `${id}-${index}`, label: list.itemLabel(index), value })),
    };
  });

  /** The descriptor's choices with their labels now, or null for a type without choices. */
  protected readonly choices = computed<ChoicesView | null>(() => {
    const type = this.type();
    const choices = (type.inspector as FieldsInspector).choices;
    if (!choices) return null;
    const array = propSchema(type.schema, choices.prop)?.schema as
      | { items?: { [key: string]: unknown }; minItems?: number; maxItems?: number }
      | undefined;
    const label = array?.items ? propSchema(array.items, 'label') : null;
    if (!label) return null;
    const props = this.edited().props;
    const value = props[choices.prop];
    const items = Array.isArray(value) ? (value as { id?: unknown; label?: unknown }[]) : [];
    const id = `field-${type.key}-${choices.prop}-${this.element().id}`;
    const min = array?.minItems ?? items.length;
    const max = array?.maxItems ?? items.length;
    const correct = choices.correct ? props[choices.correct.prop] : undefined;
    const colorWhen = choices.color ? this.colorVisible(choices.color) : false;
    return {
      ...choices,
      id,
      schema: label.schema,
      list: min !== max,
      min,
      max,
      correctId: typeof correct === 'string' ? correct : '',
      colorShown: colorWhen ? (choices.color ?? null) : null,
      items: items.map((item, index) => ({
        key: `${choices.prop}/${typeof item?.id === 'string' ? item.id : String(index)}`,
        index,
        id: `${id}-${index}`,
        choiceId: typeof item?.id === 'string' ? item.id : String(index),
        label: choices.itemLabel(index),
        value: typeof item?.label === 'string' ? item.label : '',
        color: typeof (item as { color?: unknown } | null)?.color === 'string' ? (item as { color: string }).color : '',
      })),
    };
  });

  // Whether a choice colour input shows now: its `when` prop holds one of its values, the schema's default when unset.
  private colorVisible(color: ChoiceColorField): boolean {
    const type = this.type();
    const found = propSchema(type.schema, color.when.prop);
    const props = this.edited().props;
    const value = props[color.when.prop] ?? (found?.schema as { default?: unknown } | undefined)?.default;
    return color.when.values.includes(String(value));
  }

  // The props with the choice at `index` relabelled: a copy of the array, ids untouched.
  private withChoice(group: ChoicesView, index: number, label: string): Record<string, unknown> {
    const items = this.edited().props[group.prop] as Record<string, unknown>[];
    return {
      ...this.edited().props,
      [group.prop]: items.map((item, i) => (i === index ? { ...item, label } : item)),
    };
  }

  // Why the typed label is refused: the label's schema, then the descriptor's own check; or null.
  private choiceProblem(group: ChoicesView, item: ChoiceView, raw: string): string | null {
    return (
      propValueProblem(group.schema, raw, true) ?? this.type().check?.(this.withChoice(group, item.index, raw)) ?? null
    );
  }

  /** Checks a choice's label as it is typed, and says what is wrong, without applying it. */
  protected checkChoice(group: ChoicesView, item: ChoiceView, raw: string): void {
    this.setError(item.key, this.choiceProblem(group, item, raw));
  }

  /** Applies a choice's label the schema accepts as one history step; its id, and so its count, stay. */
  protected applyChoice(group: ChoicesView, item: ChoiceView, raw: string): void {
    if (this.locked()) return;
    const problem = this.choiceProblem(group, item, raw);
    this.setError(item.key, problem);
    if (problem || raw === item.value) return;
    // Only this choice's label: the studio applies it to the element's current options.
    this.changed.emit({
      label: `${item.label} changed`,
      choice: { prop: group.prop, index: item.index, label: raw },
      said: `${item.label} set`,
    });
  }

  /**
   * Sets or clears one choice's colour (a poll option's `color`) as one history step, once the schema
   * accepts it; null clears it. A refused colour stays unapplied and says why.
   */
  protected applyChoiceColor(group: ChoicesView, item: ChoiceView, raw: string | null): void {
    if (this.locked() || !group.colorShown) return;
    const key = `${item.key}#color`;
    const list = propSchema(this.type().schema, group.prop)?.schema as { items?: Record<string, unknown> } | undefined;
    const colorSchema = list?.items ? propSchema(list.items, 'color')?.schema : undefined;
    const next = raw === null || raw === '' ? null : raw.toUpperCase();
    const problem = next === null || !colorSchema ? null : propValueProblem(colorSchema, next, false);
    this.setError(key, problem);
    if (problem || (next ?? '') === item.color.toUpperCase()) return;
    this.changed.emit({
      label: `${item.label} colour changed`,
      choice: { prop: group.prop, index: item.index, color: next },
      said: next === null ? `${item.label} colour cleared` : `${item.label} colour set to ${next}`,
    });
  }

  /** What the list field's Add button is described by: how many choices it holds, of how many. */
  protected countHint(group: ChoicesView): string {
    const n = group.items.length;
    if (n >= group.max) return `${n} of ${group.max}: the most it holds.`;
    if (n <= group.min) return `${n} of ${group.max}: it needs at least ${group.min}.`;
    return `${n} of ${group.max}.`;
  }

  /** Adds a choice at the end of a list field, with a new id, and moves focus to its text. */
  protected addChoice(group: ChoicesView): void {
    if (this.locked() || !group.newLabel || group.items.length >= group.max) return;
    const index = group.items.length;
    const name = group.itemLabel(index);
    this.changed.emit({
      label: `${name} added`,
      choice: { prop: group.prop, add: { id: crypto.randomUUID(), label: group.newLabel(index, group.items.map((i) => i.value)) }, max: group.max },
      said: `${name} added. ${index + 1} of ${group.max}.`,
    });
    this.focusSoon(`${group.id}-${index}`);
  }

  /**
   * Removes a choice of a list field by its id, down to the fewest its schema allows; its count no
   * longer shows. Removing the correct choice leaves none correct. Focus moves to the choice now in
   * its place, or the one before it.
   */
  protected removeChoice(group: ChoicesView, item: ChoiceView): void {
    if (this.locked() || group.items.length <= group.min) return;
    const wasCorrect = !!group.correct && group.correctId === item.choiceId;
    this.changed.emit({
      label: `${item.label} removed`,
      choice: { prop: group.prop, remove: item.choiceId, min: group.min, clears: group.correct?.prop },
      said: `${item.label} removed${wasCorrect ? `; no ${group.correct?.label.toLowerCase()} now` : ''}. ${group.items.length - 1} of ${group.max}.`,
    });
    this.focusSoon(`${group.id}-${Math.min(item.index, group.items.length - 2)}`);
  }

  /** Moves a choice of a list field one place up (-1) or down (1) by its id; its count goes with it. */
  protected moveChoice(group: ChoicesView, item: ChoiceView, by: -1 | 1): void {
    const to = item.index + by;
    if (this.locked() || to < 0 || to >= group.items.length) return;
    this.changed.emit({
      label: `${item.label} moved`,
      choice: { prop: group.prop, move: item.choiceId, by },
      said: `${item.label} moved ${by < 0 ? 'up' : 'down'}; it is now ${group.itemLabel(to).toLowerCase()}.`,
    });
    // The same button on the moved choice, or the other one once it reaches an end.
    const end = by < 0 ? to === 0 : to === group.items.length - 1;
    const button = by < 0 ? (end ? 'down' : 'up') : end ? 'up' : 'down';
    this.focusSoon(`${group.id}-${to}-${button}`);
  }

  /** Picks the correct choice, or none, as one history step. */
  protected pickCorrect(group: ChoicesView, value: string): void {
    const correct = group.correct;
    if (this.locked() || !correct || value === group.correctId) return;
    const props: Record<string, unknown> = { ...this.edited().props, [correct.prop]: value };
    if (!value) delete props[correct.prop];
    const problem = this.type().check?.(props) ?? null;
    this.setError(correct.prop, problem);
    if (problem) return;
    const item = group.items.find((i) => i.choiceId === value);
    this.changed.emit({
      label: `${correct.label} changed`,
      props: { [correct.prop]: value || undefined },
      said: item ? `${correct.label}: ${item.label.toLowerCase()}, ${item.value}` : `No ${correct.label.toLowerCase()}`,
    });
  }

  // The strings an emoji list's prop holds now; anything else is left out.
  private currentEmojis(prop: string): string[] {
    const value = this.edited().props[prop];
    return Array.isArray(value) ? value.filter((e): e is string => typeof e === 'string') : [];
  }

  /** The emoji list's counts, as the Add button is described: how many it holds, of how many. */
  protected emojiCountHint(list: EmojiListView): string {
    const n = list.items.length;
    if (n >= list.max) return `${n} of ${list.max}: the most it holds.`;
    if (n <= list.min) return `${n} of ${list.max}: it needs at least ${list.min}.`;
    return `${n} of ${list.max}.`;
  }

  /** An emoji item's button name: its visible text first, then the emoji now by its Unicode name. */
  protected emojiItemName(item: EmojiItemView): string {
    return `Choose emoji… ${item.label}. Current: ${emojiName(item.value) ?? item.value}`;
  }

  /** Opens the picker for the emoji at an item, unless the inspector is locked. */
  protected openEmojiItem(item: EmojiItemView, event: Event): void {
    if (this.locked()) return;
    this.emojiPick.set({
      index: item.index,
      heading: `Choose ${item.label.toLowerCase()}`,
      current: item.value,
      returnFocus: event.currentTarget instanceof HTMLElement ? event.currentTarget : null,
    });
  }

  /** Opens the picker to add an emoji at the end, while the list holds fewer than its most. */
  protected openEmojiAdd(list: EmojiListView, event: Event): void {
    if (this.locked() || list.items.length >= list.max) return;
    this.emojiPick.set({
      index: null,
      heading: 'Add an emoji',
      current: null,
      returnFocus: event.currentTarget instanceof HTMLElement ? event.currentTarget : null,
    });
  }

  // Applies the emoji list as `emojis`, one history step, when the descriptor's check accepts it.
  private applyEmojis(list: EmojiListView, emojis: string[], label: string, said: string): boolean {
    const problem = this.type().check?.({ ...this.edited().props, [list.prop]: emojis }) ?? null;
    this.setError(list.prop, problem);
    if (problem) return false;
    this.changed.emit({ label, props: { [list.prop]: emojis }, said });
    return true;
  }

  /** The picker's emoji: replaces the one at its item, or is added at the end. */
  protected pickedListEmoji(choice: EmojiChoice): void {
    const pick = this.emojiPick();
    this.emojiPick.set(null);
    const list = this.emojiList();
    if (!pick || !list || this.locked()) return;
    const emojis = this.currentEmojis(list.prop);
    if (pick.index === null) {
      if (emojis.length >= list.max) return;
      const name = list.itemLabel(emojis.length);
      if (this.applyEmojis(list, [...emojis, choice.emoji], `${name} added`, `${name} added. ${emojis.length + 1} of ${list.max}.`)) {
        this.focusSoon(`${list.id}-${emojis.length}`);
      }
      return;
    }
    if (emojis[pick.index] === choice.emoji) return;
    const name = list.itemLabel(pick.index);
    this.applyEmojis(
      list,
      emojis.map((e, i) => (i === pick.index ? choice.emoji : e)),
      `${name} changed`,
      `${name} set`,
    );
  }

  /** Removes an emoji from an emoji list, down to the fewest its schema allows. */
  protected removeEmoji(list: EmojiListView, item: EmojiItemView): void {
    if (this.locked() || list.items.length <= list.min) return;
    const emojis = this.currentEmojis(list.prop);
    const applied = this.applyEmojis(
      list,
      emojis.filter((_, i) => i !== item.index),
      `${item.label} removed`,
      `${item.label} removed. ${emojis.length - 1} of ${list.max}.`,
    );
    if (applied) this.focusSoon(`${list.id}-${Math.min(item.index, emojis.length - 2)}`);
  }

  /** Moves an emoji one place up (-1) or down (1) in an emoji list. */
  protected moveEmoji(list: EmojiListView, item: EmojiItemView, by: -1 | 1): void {
    const to = item.index + by;
    const emojis = this.currentEmojis(list.prop);
    if (this.locked() || to < 0 || to >= emojis.length) return;
    const moved = [...emojis];
    [moved[item.index], moved[to]] = [moved[to], moved[item.index]];
    const applied = this.applyEmojis(list, moved, `${item.label} moved`, `${item.label} moved ${by < 0 ? 'up' : 'down'}; it is now ${list.itemLabel(to).toLowerCase()}.`);
    if (!applied) return;
    const end = by < 0 ? to === 0 : to === emojis.length - 1;
    const button = by < 0 ? (end ? 'down' : 'up') : end ? 'up' : 'down';
    this.focusSoon(`${list.id}-${to}-${button}`);
  }

  // Focuses a control of the inspector once the change has drawn it.
  private focusSoon(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }

  /** The field's hint, then its error line: both stay described, so the rule is heard with the problem. */
  protected describedBy(field: FieldView): string {
    return field.hint ? `${field.id}-hint ${field.id}-error` : `${field.id}-error`;
  }

  // The typed text as the prop's value: a number for a number field, undefined when left empty.
  private parse(field: FieldView, raw: string): unknown {
    const text = field.control === 'number' || field.control === 'color' ? raw.trim() : raw;
    if (text === '' && (field.control === 'number' || !field.required)) return undefined;
    if (field.schema.type === 'integer' || field.schema.type === 'number') {
      const n = Number(text);
      return text === '' || Number.isNaN(n) ? Number.NaN : n;
    }
    return text;
  }

  // Why the typed value is refused: the schema's rule, then the descriptor's own check; or null.
  private problem(field: FieldView, raw: string): string | null {
    const value = this.parse(field, raw);
    const problem = propValueProblem(field.schema, value, field.required);
    if (problem || !this.type().check) return problem;
    const props: Record<string, unknown> = { ...this.edited().props, [field.prop]: value };
    if (value === undefined) delete props[field.prop];
    return this.type().check?.(props) ?? null;
  }

  /** Checks the value as it is typed, and says what is wrong, without applying it. */
  protected check(field: FieldView, raw: string): void {
    this.setError(field.prop, this.problem(field, raw));
  }

  /** Applies a value the schema accepts as one history step; a refused one stays unapplied. */
  protected apply(field: FieldView, raw: string): void {
    if (this.locked()) return;
    const problem = this.problem(field, raw);
    this.setError(field.prop, problem);
    if (problem) return;
    const value = this.parse(field, raw);
    if (value === this.edited().props[field.prop]) return;
    this.changed.emit({
      label: `${field.label} changed`,
      props: { [field.prop]: value },
      said: value === undefined ? `${field.label} cleared` : `${field.label} set`,
    });
  }

  /**
   * The emoji field's button name: its visible text first (WCAG 2.5.3, so voice control finds it by
   * what it shows), then the emoji now by its Unicode name.
   */
  protected emojiButtonName(field: FieldView): string {
    const name = field.value ? (emojiName(field.value) ?? field.value) : 'none';
    return `Choose emoji… Current: ${name}`;
  }

  /** Opens the emoji picker for an emoji field (epic interactive components story 4.2); not while locked. */
  protected openEmoji(field: FieldView, event: Event): void {
    if (this.locked()) return;
    this.picking.set({ field, returnFocus: event.currentTarget instanceof HTMLElement ? event.currentTarget : null });
  }

  /** The picker's emoji, applied to the field as one history step, as a typed value is. */
  protected pickedEmoji(field: FieldView, choice: EmojiChoice): void {
    this.picking.set(null);
    this.apply(field, choice.emoji);
  }

  private setError(prop: string, problem: string | null): void {
    const next = { ...this.errors() };
    if (problem) next[prop] = problem;
    else delete next[prop];
    this.errors.set(next);
  }
}
