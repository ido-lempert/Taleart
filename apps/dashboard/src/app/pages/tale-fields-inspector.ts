import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { EMOJI_FONT_STACK, propSchema, propValueProblem, type PropSchema } from '@taleart/contract/tale-document';
import { emojiName, TaleEmojiPicker, type ElementChange, type EmojiChoice } from './tale-shapes';
import type { ChoicesField, FieldsInspector, InspectorField, StudioElementType } from './tale-element-types';

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
              @if (!field.required) {
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
  `,
  styles: `
    .fields-emoji { align-items: center; }
    .fields-emoji__glyph { font-size: 1.75rem; line-height: 1; min-width: 2rem; text-align: center; }
    .fields-choice__actions { flex-wrap: wrap; gap: 4px; }
    .fields-choices__add { justify-self: start; }
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
          value: value === undefined || value === null ? '' : String(value),
        },
      ];
    });
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
    return {
      ...choices,
      id,
      schema: label.schema,
      list: min !== max,
      min,
      max,
      correctId: typeof correct === 'string' ? correct : '',
      items: items.map((item, index) => ({
        key: `${choices.prop}/${typeof item?.id === 'string' ? item.id : String(index)}`,
        index,
        id: `${id}-${index}`,
        choiceId: typeof item?.id === 'string' ? item.id : String(index),
        label: choices.itemLabel(index),
        value: typeof item?.label === 'string' ? item.label : '',
      })),
    };
  });

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
