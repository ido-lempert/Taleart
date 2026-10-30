import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { MAX_AUDIENCE_CONDITIONS, type AudienceMatch, type AudienceOperator, type AudienceRule } from '@taleart/contract/core';
import { checkRows, emptyRow, OPERATOR_OPTIONS, rowReason, rowsFromRule, tryAudience, valueShape, type DraftRow, type ValueKind } from './audience-rule-draft';
import { DashboardStore, type TaleGroupSummary } from './dashboard.store';

/**
 * The "Audience rule" section of a tale group's Audience drawer (epic viewer properties): the
 * conditions a viewer's properties must meet, on top of the tags and user lists. Saved on its own,
 * with Save audience rule or Clear audience rule, so the drawer's Save keeps the tags and lists.
 * A "Try it" box tests the draft against sample properties typed as JSON, in this browser only.
 * Bar and banner groups alike: a banner slide is a tale group too.
 */
@Component({
  selector: 'app-audience-rule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .audience-rule {
      display: grid;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .audience-rule__legend {
      padding: 0;
    }
    .audience-row {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
      margin: 0;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
    }
    .audience-row__legend {
      padding: 0 var(--space-1);
      font-size: var(--text-sm);
      color: var(--text-secondary);
    }
    .audience-row__fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
      gap: var(--space-2);
      align-items: end;
    }
    .audience-row__remove {
      justify-self: start;
    }
    .audience-rule__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .audience-try {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      background: var(--surface-sunken);
    }
    .audience-try__result {
      margin: 0;
      font-weight: 600;
    }
  `,
  template: `
    <fieldset class="audience-rule" aria-describedby="audience-rule-hint">
      <legend class="field__label audience-rule__legend">Audience rule</legend>
      <p class="field__hint" id="audience-rule-hint">
        Show this group only to viewers whose properties meet these conditions. The host page passes the properties; they are
        checked in the browser and never sent. A banner slide is a tale group too, so the rule applies to bar and banner
        groups alike.
      </p>
      <div class="field">
        <label class="field__label" for="audience-match">Match</label>
        <select id="audience-match" class="input" (change)="setMatch($event)">
          <option value="all" [selected]="match() === 'all'">All of the conditions</option>
          <option value="any" [selected]="match() === 'any'">Any of the conditions</option>
        </select>
      </div>
      @for (row of rows(); track row.key; let i = $index) {
        <fieldset class="audience-row">
          <legend class="audience-row__legend">Condition {{ i + 1 }}</legend>
          <div class="audience-row__fields">
            <div class="field">
              <label class="field__label" [for]="'ar-prop-' + row.key">Property</label>
              <input
                [id]="'ar-prop-' + row.key"
                class="input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="plan"
                [value]="row.property"
                [attr.aria-invalid]="shown(i) ? 'true' : null"
                [attr.aria-describedby]="shown(i) ? 'ar-err-' + row.key : null"
                (input)="setField(i, { property: text($event) })"
                (keydown.enter)="$event.preventDefault()"
              />
            </div>
            <div class="field">
              <label class="field__label" [for]="'ar-op-' + row.key">Operator</label>
              <select [id]="'ar-op-' + row.key" class="input" (change)="setField(i, { operator: operatorOf($event) })">
                @for (option of operators; track option.value) {
                  <option [value]="option.value" [selected]="option.value === row.operator">{{ option.label }}</option>
                }
              </select>
            </div>
            @if (row.operator === 'eq' || row.operator === 'neq') {
              <div class="field">
                <label class="field__label" [for]="'ar-kind-' + row.key">Value type</label>
                <select [id]="'ar-kind-' + row.key" class="input" (change)="setKind(i, kindOf($event))">
                  <option value="text" [selected]="row.kind === 'text'">Text</option>
                  <option value="number" [selected]="row.kind === 'number'">Number</option>
                  <option value="boolean" [selected]="row.kind === 'boolean'">true or false</option>
                </select>
              </div>
            }
            @switch (shape(row)) {
              @case ('list') {
                <div class="field">
                  <label class="field__label" [for]="'ar-value-' + row.key">Values, separated by commas</label>
                  <input
                    [id]="'ar-value-' + row.key"
                    class="input"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="pro, team"
                    [value]="row.value"
                    [attr.aria-invalid]="shown(i) ? 'true' : null"
                    [attr.aria-describedby]="shown(i) ? 'ar-err-' + row.key : null"
                    (input)="setField(i, { value: text($event) })"
                    (keydown.enter)="$event.preventDefault()"
                  />
                </div>
              }
              @case ('boolean') {
                <div class="field">
                  <label class="field__label" [for]="'ar-value-' + row.key">Value</label>
                  <select [id]="'ar-value-' + row.key" class="input" (change)="setField(i, { value: text($event) })">
                    <option value="true" [selected]="row.value !== 'false'">true</option>
                    <option value="false" [selected]="row.value === 'false'">false</option>
                  </select>
                </div>
              }
              @case ('none') {}
              @default {
                <div class="field">
                  <label class="field__label" [for]="'ar-value-' + row.key">Value</label>
                  <input
                    [id]="'ar-value-' + row.key"
                    class="input"
                    [type]="shape(row) === 'number' ? 'number' : 'text'"
                    [attr.inputmode]="shape(row) === 'number' ? 'decimal' : null"
                    autocomplete="off"
                    [value]="row.value"
                    [attr.aria-invalid]="shown(i) ? 'true' : null"
                    [attr.aria-describedby]="shown(i) ? 'ar-err-' + row.key : null"
                    (input)="setField(i, { value: text($event) })"
                    (keydown.enter)="$event.preventDefault()"
                  />
                </div>
              }
            }
          </div>
          @if (shown(i); as reason) {
            <p class="field__error" [id]="'ar-err-' + row.key">{{ reason }}</p>
          }
          <div>
            <button type="button" class="btn btn--secondary btn--sm audience-row__remove" (click)="removeRow(i)">
              Remove condition {{ i + 1 }}
            </button>
          </div>
        </fieldset>
      }
      <div class="audience-rule__actions">
        <button type="button" class="btn btn--secondary btn--sm" id="audience-add" #addButton [disabled]="rows().length >= maxConditions" (click)="addRow()">
          Add condition
        </button>
        <span class="field__hint">
          @if (rows().length >= maxConditions) {
            A rule holds at most {{ maxConditions }} conditions.
          } @else {
            Up to {{ maxConditions }} conditions.
          }
        </span>
      </div>
      @if (error(); as message) {
        <p class="banner banner--inline" role="alert" id="audience-rule-error" tabindex="-1">{{ message }}</p>
      }
      <div class="audience-rule__actions">
        <button type="button" class="btn btn--primary btn--sm" id="audience-save" [disabled]="saving()" (click)="save()">
          Save audience rule
        </button>
        <button
          type="button"
          class="btn btn--secondary btn--sm"
          id="audience-clear"
          [disabled]="saving() || (!group().audience && rows().length === 0)"
          (click)="clear()"
        >
          Clear audience rule
        </button>
        <span class="field__hint" role="status" aria-live="polite" id="audience-rule-status">{{ status() }}</span>
      </div>
      <div class="audience-try">
        <div class="field">
          <label class="field__label" for="audience-sample">Try it: sample viewer properties, as JSON</label>
          <textarea
            id="audience-sample"
            class="input"
            rows="4"
            spellcheck="false"
            autocomplete="off"
            placeholder='{"plan": "pro", "age": 34}'
            aria-describedby="audience-sample-hint"
            [value]="sample()"
            (input)="sample.set(text($event))"
          ></textarea>
          <p class="field__hint" id="audience-sample-hint">
            Type the properties a viewer has, as one JSON object. They stay in this browser. Leave the box empty for a viewer
            with no properties: the group shows, whatever the rule says. Tags and user lists also apply on the site.
          </p>
        </div>
        <p class="audience-try__result" role="status" aria-live="polite" id="audience-try-result">{{ tryText() }}</p>
      </div>
    </fieldset>
  `,
})
export class AudienceRuleSection implements OnInit {
  /** The tale group whose rule is edited, with its saved rule. */
  readonly group = input.required<TaleGroupSummary>();

  private readonly store = inject(DashboardStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');

  protected readonly maxConditions = MAX_AUDIENCE_CONDITIONS;
  protected readonly operators = OPERATOR_OPTIONS;

  /** The draft: match mode, and the condition rows as they are typed. */
  protected readonly match = signal<AudienceMatch>('all');
  protected readonly rows = signal<DraftRow[]>([]);
  private nextKey = 1;

  /** True after a Save that was refused: then every row's reason shows, not only the ones typed in. */
  protected readonly attempted = signal(false);
  /** The reason Save or Clear was refused, or the API's refusal; '' for none. */
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  /** What a saved rule said last, for the polite live region. */
  protected readonly status = signal('');
  /** The sample viewer properties, as typed in "Try it". */
  protected readonly sample = signal('');

  /** Why each row is not valid, in words, or null: from the draft as it is now. */
  private readonly reasons = computed(() => this.rows().map((_, i) => rowReason(this.match(), this.rows(), i)));

  /** What "Try it" says about the draft for the sample properties. */
  protected readonly tryText = computed((): string => {
    let rule: AudienceRule | null = null;
    if (this.rows().length > 0) {
      const checked = checkRows(this.match(), this.rows());
      if (!checked.ok) return 'Fix the rule above to test it.';
      rule = checked.rule;
    }
    const result = tryAudience(rule, this.sample());
    switch (result.kind) {
      case 'invalid-json':
        return `The sample is not valid JSON (${result.message}), so the rule cannot be tested.`;
      case 'hidden':
        return 'This group would be hidden: the audience rule fails for these properties.';
      case 'shown':
        if (result.noRule) return 'This group would show: it has no audience rule.';
        if (result.noProperties) return 'This group would show: no properties were passed, so every rule passes.';
        return 'This group would show: the audience rule passes for these properties.';
    }
  });

  ngOnInit(): void {
    const seed = rowsFromRule(this.group().audience);
    this.match.set(seed.match);
    this.rows.set(seed.rows);
    this.nextKey = seed.rows.length + 1;
  }

  /** The value shape of a row, for the value field. */
  protected shape(row: DraftRow): ReturnType<typeof valueShape> {
    return valueShape(row);
  }

  /** Whether a row's reason shows: after a refused Save, or once the row was edited. */
  protected shown(index: number): string | null {
    const row = this.rows()[index];
    if (!row || !(row.touched || this.attempted())) return null;
    return this.reasons()[index] ?? null;
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected operatorOf(event: Event): AudienceOperator {
    return (event.target as HTMLSelectElement).value as AudienceOperator;
  }

  protected kindOf(event: Event): ValueKind {
    return (event.target as HTMLSelectElement).value as ValueKind;
  }

  protected setMatch(event: Event): void {
    this.match.set((event.target as HTMLSelectElement).value === 'any' ? 'any' : 'all');
  }

  protected setField(index: number, patch: Partial<DraftRow>): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch, touched: true } : row)));
    this.error.set('');
  }

  /** Changes a row's value type; a boolean row starts at true, so its select shows a value. */
  protected setKind(index: number, kind: ValueKind): void {
    this.rows.update((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const value = kind === 'boolean' && row.value !== 'true' && row.value !== 'false' ? 'true' : row.value;
        return { ...row, kind, value, touched: true };
      }),
    );
    this.error.set('');
  }

  protected addRow(): void {
    if (this.rows().length >= MAX_AUDIENCE_CONDITIONS) return;
    const row = emptyRow(this.nextKey++);
    this.rows.update((rows) => [...rows, row]);
    this.status.set('');
    // The new row is rendered by the time the click returns to Angular: focus its property field.
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`#ar-prop-${row.key}`)?.focus());
  }

  protected removeRow(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
    this.error.set('');
    this.status.set('');
    this.addButton()?.nativeElement.focus();
  }

  /** Saves the draft as the group's rule; a refused draft shows its reason, with focus on the row it is in. */
  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.attempted.set(true);
    const checked = checkRows(this.match(), this.rows());
    if (!checked.ok) {
      this.error.set(checked.reason);
      this.status.set('');
      const row = checked.index === null ? undefined : this.rows()[checked.index];
      queueMicrotask(() => {
        const target = row
          ? this.host.nativeElement.querySelector<HTMLElement>(`#ar-prop-${row.key}`)
          : this.host.nativeElement.querySelector<HTMLElement>('#audience-rule-error');
        target?.focus();
      });
      return;
    }
    await this.write(checked.rule, 'Audience rule saved.');
  }

  /** Clears the group's rule and the draft: the group shows to every viewer its tags and lists allow. */
  protected async clear(): Promise<void> {
    if (this.saving()) return;
    await this.write(null, 'Audience rule cleared.');
    if (!this.error()) {
      this.rows.set([]);
      this.match.set('all');
      this.attempted.set(false);
    }
  }

  private async write(rule: Parameters<DashboardStore['setTaleGroupAudience']>[1], done: string): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    const message = await this.store.setTaleGroupAudience(this.group().id, rule);
    this.saving.set(false);
    this.error.set(message);
    this.status.set(message ? '' : done);
  }
}
