import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { propSchema, propValueProblem, type PropSchema } from '@taleart/contract/tale-document';
import type { ElementChange } from './tale-shapes';
import type { ChoicesField, FieldsInspector, InspectorField, StudioElementType } from './tale-element-types';

/** One choice's label as the inspector shows it (epic interactive components R1). */
interface ChoiceView {
  /** The error key: `<prop>/<index>`. */
  key: string;
  index: number;
  id: string;
  label: string;
  value: string;
}

/** A choices field as the inspector shows it: its items and the label's schema. */
interface ChoicesView extends ChoicesField {
  id: string;
  schema: PropSchema;
  items: ChoiceView[];
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
        @for (item of group.items; track item.key) {
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
          </div>
        }
      </fieldset>
    }
  `,
})
export class TaleFieldsInspector {
  readonly element = input.required<{ id: string; props: unknown }>();
  readonly type = input.required<StudioElementType>();
  readonly locked = input(false);
  readonly changed = output<ElementChange>();

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
        // A choice's error (`options/0`) is kept while its array prop is unchanged.
        Object.entries(previous.value).filter(
          ([key]) => previous.source.props[key.split('/')[0]] === now.props[key.split('/')[0]],
        ),
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
    const array = propSchema(type.schema, choices.prop)?.schema as { items?: { [key: string]: unknown } } | undefined;
    const label = array?.items ? propSchema(array.items, 'label') : null;
    if (!label) return null;
    const value = this.edited().props[choices.prop];
    const items = Array.isArray(value) ? (value as { label?: unknown }[]) : [];
    const id = `field-${type.key}-${choices.prop}-${this.element().id}`;
    return {
      ...choices,
      id,
      schema: label.schema,
      items: items.map((item, index) => ({
        key: `${choices.prop}/${index}`,
        index,
        id: `${id}-${index}`,
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

  private setError(prop: string, problem: string | null): void {
    const next = { ...this.errors() };
    if (problem) next[prop] = problem;
    else delete next[prop];
    this.errors.set(next);
  }
}
