import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

/** Frame settings as the API stores them: a JSON object validated by the frame type's schema (AD-5). */
export type Settings = Record<string, unknown>;

/** One editable field of a settings schema. */
export type SettingsField =
  | (FieldBase & { kind: 'choice'; choices: { value: string; label: string }[] })
  | (FieldBase & { kind: 'toggle' })
  | (FieldBase & { kind: 'number'; min?: number; max?: number; step: number });

interface FieldBase {
  key: string;
  label: string;
  hint: string;
  default: unknown;
}

interface PropertySchema {
  type?: unknown;
  enum?: unknown;
  title?: unknown;
  description?: unknown;
  default?: unknown;
  minimum?: unknown;
  maximum?: unknown;
}

/** "rounded-square" → "Rounded square", "showTitles" → "Show titles". */
export function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The fields a form can edit, in schema order: a string `enum` is a choice,
 * a `boolean` a toggle, an `integer` or `number` a number with its range.
 * Other properties are not editable here; the form keeps their values as they are.
 */
export function settingsFields(schema: unknown): SettingsField[] {
  const properties = (schema as { properties?: unknown } | null)?.properties;
  if (typeof properties !== 'object' || properties === null) return [];
  const fields: SettingsField[] = [];
  for (const [key, raw] of Object.entries(properties as Record<string, PropertySchema>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const base: FieldBase = {
      key,
      label: typeof raw.title === 'string' ? raw.title : humanize(key),
      hint: typeof raw.description === 'string' ? raw.description : '',
      default: raw.default,
    };
    if (Array.isArray(raw.enum) && raw.enum.every((v): v is string => typeof v === 'string')) {
      fields.push({ ...base, kind: 'choice', choices: raw.enum.map((value) => ({ value, label: humanize(value) })) });
    } else if (raw.type === 'boolean') {
      fields.push({ ...base, kind: 'toggle' });
    } else if (raw.type === 'integer' || raw.type === 'number') {
      fields.push({
        ...base,
        kind: 'number',
        min: typeof raw.minimum === 'number' ? raw.minimum : undefined,
        max: typeof raw.maximum === 'number' ? raw.maximum : undefined,
        step: raw.type === 'integer' ? 1 : 0.1,
      });
    }
  }
  return fields;
}

/** The stored settings with each editable field they leave out set to its schema default. */
export function initialSettings(schema: unknown, stored: Settings | null | undefined): Settings {
  const settings: Settings = { ...(stored ?? {}) };
  for (const field of settingsFields(schema)) {
    if (!(field.key in settings) && field.default !== undefined) settings[field.key] = field.default;
  }
  return settings;
}

/**
 * A settings form built from a frame type's JSON Schema, so a new frame type
 * or field needs no dashboard code. It edits `value` in place; the drawer
 * around it saves, and the API validates (the field it names is `invalidField`).
 */
@Component({
  selector: 'app-settings-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (field of fields(); track field.key) {
      @switch (field.kind) {
        @case ('choice') {
          <div class="field">
            <label class="field__label" [for]="id(field)">{{ field.label }}</label>
            <select
              class="select"
              [id]="id(field)"
              [attr.aria-invalid]="invalid(field) ? 'true' : null"
              [attr.aria-describedby]="describedBy(field)"
              (change)="set(field, $any($event.target).value)"
            >
              @for (choice of $any(field).choices; track choice.value) {
                <option [value]="choice.value" [selected]="value()[field.key] === choice.value">
                  {{ choice.label }}
                </option>
              }
            </select>
            @if (field.hint) {
              <p class="field__hint" [id]="id(field) + '-hint'">{{ field.hint }}</p>
            }
          </div>
        }
        @case ('toggle') {
          <div class="field">
            <label class="checkbox">
              <input
                type="checkbox"
                [id]="id(field)"
                [checked]="value()[field.key] === true"
                [attr.aria-invalid]="invalid(field) ? 'true' : null"
                [attr.aria-describedby]="describedBy(field)"
                (change)="set(field, $any($event.target).checked)"
              />
              {{ field.label }}
            </label>
            @if (field.hint) {
              <p class="field__hint" [id]="id(field) + '-hint'">{{ field.hint }}</p>
            }
          </div>
        }
        @case ('number') {
          <div class="field">
            <label class="field__label" [for]="id(field)">{{ field.label }}</label>
            <input
              class="input"
              type="number"
              inputmode="numeric"
              [id]="id(field)"
              [attr.min]="$any(field).min ?? null"
              [attr.max]="$any(field).max ?? null"
              [attr.step]="$any(field).step"
              [value]="value()[field.key] ?? ''"
              [attr.aria-invalid]="invalid(field) ? 'true' : null"
              [attr.aria-describedby]="describedBy(field)"
              (input)="setNumber(field, $any($event.target).value)"
            />
            @if (field.hint) {
              <p class="field__hint" [id]="id(field) + '-hint'">{{ field.hint }}</p>
            }
          </div>
        }
      }
    } @empty {
      <p class="muted">This frame type has no settings yet.</p>
    }
  `,
})
export class SettingsForm {
  /** The frame type's JSON Schema. */
  readonly schema = input.required<unknown>();
  /** The settings being edited. */
  readonly value = model.required<Settings>();
  /** Prefixes the field ids, so two forms on a page do not clash. */
  readonly idPrefix = input('settings');
  /** The field the API refused, marked invalid. */
  readonly invalidField = input('');
  /** The id of the message that explains the refusal. */
  readonly errorId = input('');

  protected readonly fields = computed(() => settingsFields(this.schema()));

  protected id(field: SettingsField): string {
    return `${this.idPrefix()}-${field.key}`;
  }

  protected invalid(field: SettingsField): boolean {
    return this.invalidField() === field.key;
  }

  protected describedBy(field: SettingsField): string | null {
    const ids = [field.hint ? `${this.id(field)}-hint` : '', this.invalid(field) ? this.errorId() : ''].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }

  protected set(field: SettingsField, next: unknown): void {
    this.value.update((settings) => ({ ...settings, [field.key]: next }));
  }

  /** An emptied number leaves the field out, so the schema default applies; anything else goes to the API as typed. */
  protected setNumber(field: SettingsField, text: string): void {
    this.value.update((settings) => {
      const next = { ...settings };
      if (text.trim() === '') delete next[field.key];
      else next[field.key] = Number(text);
      return next;
    });
  }
}
