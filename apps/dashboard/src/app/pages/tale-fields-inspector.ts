import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { propSchema, propValueProblem, type PropSchema } from '@taleart/contract/tale-document';
import type { ElementChange } from './tale-shapes';
import type { FieldsInspector, InspectorField, StudioElementType } from './tale-element-types';

/** One field as the inspector shows it: the descriptor's field with its schema rules. */
interface FieldView extends InspectorField {
  id: string;
  schema: PropSchema;
  required: boolean;
  value: string;
}

/**
 * The inspector of an element type registered by configuration (epic Tale Studio R8): one control
 * per field of the type's descriptor, in order. Each value is checked with the type's props schema
 * as it is typed (`propValueProblem`, the rules the server applies again on save); a value the
 * schema refuses is not applied and the field says why. An optional field left empty is removed.
 */
@Component({
  selector: 'app-tale-fields-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (field of fields(); track field.prop) {
      <div class="field">
        <label class="field__label" [for]="field.id">{{ field.label }}</label>
        @switch (field.control) {
          @case ('select') {
            <select
              class="input"
              [id]="field.id"
              [disabled]="locked()"
              [attr.aria-describedby]="describedBy(field)"
              (change)="apply(field, $any($event.target).value)"
            >
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
                [value]="field.value.toLowerCase()"
                (change)="apply(field, $any($event.target).value.toUpperCase())"
              />
              <input
                class="input input--mono"
                type="text"
                spellcheck="false"
                autocomplete="off"
                [id]="field.id + '-hex'"
                [attr.aria-label]="field.label + ' hex'"
                [attr.aria-invalid]="errors()[field.prop] ? 'true' : null"
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
              [attr.aria-invalid]="errors()[field.prop] ? 'true' : null"
              [attr.aria-describedby]="describedBy(field)"
              [attr.aria-required]="field.required ? 'true' : null"
              [readOnly]="locked()"
              [value]="field.value"
              (input)="check(field, $any($event.target).value)"
              (change)="apply(field, $any($event.target).value)"
            />
          }
        }
        @if (errors()[field.prop]; as error) {
          <span class="field__error" role="alert" [id]="field.id + '-error'">{{ error }}</span>
        } @else if (field.hint) {
          <span class="field__hint" [id]="field.id + '-hint'">{{ field.hint }}</span>
        }
      </div>
    }
  `,
})
export class TaleFieldsInspector {
  readonly element = input.required<{ id: string; props: unknown }>();
  readonly type = input.required<StudioElementType>();
  readonly locked = input(false);
  readonly changed = output<ElementChange>();
  readonly notice = output<string>();

  /** What is wrong with each field's typed value, by prop; empty when every value passes, and for another element. */
  protected readonly errors = linkedSignal<string, Readonly<Record<string, string>>>({
    source: () => this.element().id,
    computation: () => ({}),
  });

  protected readonly fields = computed<FieldView[]>(() => {
    const type = this.type();
    const props = (this.element().props ?? {}) as Record<string, unknown>;
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

  protected describedBy(field: FieldView): string | null {
    if (this.errors()[field.prop]) return `${field.id}-error`;
    return field.hint ? `${field.id}-hint` : null;
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

  // Why the typed value is refused, or null.
  private problem(field: FieldView, raw: string): string | null {
    return propValueProblem(field.schema, this.parse(field, raw), field.required);
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
    if (problem) {
      this.notice.emit(`${field.label}: ${problem} Not applied.`);
      return;
    }
    const value = this.parse(field, raw);
    if (value === (this.element().props as Record<string, unknown> | null)?.[field.prop]) return;
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
