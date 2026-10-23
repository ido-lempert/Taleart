import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import {
  pollOptionIds,
  ratingResult,
  type ElementResponseCounts,
  type TaleResponses,
} from '@taleart/contract/tale-document';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from '../dashboard.store';

/** One choice's count as the inspector lists it. */
interface ChoiceCountView {
  id: string;
  label: string;
  count: number;
}

/** How the panel names one kind of component's responses. */
interface ResponseWords {
  /** The panel's heading, such as "Votes". */
  heading: string;
  one: string;
  many: string;
  /** What it says while the component has responses, before its props are edited. */
  note: string;
}

const POLL_WORDS: ResponseWords = {
  heading: 'Votes',
  one: 'vote',
  many: 'votes',
  note: "This poll already has votes. Editing an option's text keeps its count; votes stay with the option.",
};

const RATING_WORDS: ResponseWords = {
  heading: 'Ratings',
  one: 'rating',
  many: 'ratings',
  note: 'This rating already has ratings. Editing its question or emoji keeps them.',
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/**
 * The responses of the selected interactive component (epic interactive components R11, C8), read
 * from the Management API for the tale: for a poll, its votes per option as the site recorded them,
 * listed as the draft holds the options now, so an edited label keeps its count and a removed option
 * drops out; for a Rating (story 4.2), how many rated it and their average. While the component has
 * responses it says so, before it is edited. The studio preview records none. Read when the
 * component is selected, and again on Refresh.
 */
@Component({
  selector: 'app-tale-responses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .responses { display: grid; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border, #e5e7eb); }
    .responses__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .responses__title { margin: 0; font-size: 0.95rem; font-weight: 600; }
    .responses__list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .responses__item { display: flex; justify-content: space-between; gap: 12px; }
    .responses__count { font-variant-numeric: tabular-nums; font-weight: 600; }
    .responses__note { margin: 0; }
  `,
  template: `
    <section class="responses" aria-labelledby="studio-responses-title">
      <div class="responses__head">
        <h3 class="responses__title" id="studio-responses-title">{{ words().heading }}</h3>
        <button type="button" class="btn btn--ghost btn--sm" id="studio-responses-refresh" (click)="reload()">Refresh</button>
      </div>
      <span class="visually-hidden" aria-live="polite">{{ status() }}</span>
      @if (failed()) {
        <p class="field__error responses__note">Could not read the {{ words().many }}. Try Refresh.</p>
      } @else if (counts(); as view) {
        @if (view.choices.length) {
          <ul class="responses__list" id="studio-responses">
            @for (choice of view.choices; track choice.id) {
              <li class="responses__item">
                <span>{{ choice.label }}</span>
                <span class="responses__count">{{ choice.count }}</span>
              </li>
            }
          </ul>
        }
        <p class="muted responses__note" id="studio-responses-total">{{ view.total }}</p>
        @if (view.hasResponses) {
          <p class="field__hint responses__note" id="studio-responses-note" role="note">{{ words().note }}</p>
        }
      } @else {
        <p class="muted responses__note">Reading {{ words().many }}…</p>
      }
      <p class="field__hint responses__note">{{ words().heading }} come from the site only: the preview records none.</p>
    </section>
  `,
})
export class TaleResponsesPanel {
  private readonly http = inject(HttpClient);
  /** The tale being edited. */
  readonly taleId = input.required<string>();
  /** The selected component: its id, type and props as the draft holds them. */
  readonly element = input.required<{ id: string; type: string; props: unknown }>();

  private readonly read = signal<{ taleId: string; elementId: string; responses: TaleResponses } | null>(null);
  protected readonly failed = signal(false);
  protected readonly status = signal('');
  private generation = 0;
  // The selected component's id: an edit to its props does not read the counts again.
  private readonly elementId = computed(() => this.element().id);
  protected readonly words = computed(() => (this.element().type === 'rating' ? RATING_WORDS : POLL_WORDS));

  constructor() {
    // Read again whenever another component, or another tale, is selected.
    effect(() => {
      const taleId = this.taleId();
      const elementId = this.elementId();
      void this.load(taleId, elementId, false);
    });
  }

  /** Reads the counts again, as the Refresh button does. */
  reload(): Promise<void> {
    return this.load(this.taleId(), this.element().id, true);
  }

  private async load(taleId: string, elementId: string, announce: boolean): Promise<void> {
    const generation = ++this.generation;
    this.failed.set(false);
    try {
      const responses = await firstValueFrom(
        this.http.get<TaleResponses>(`${API_BASE}/tales/${encodeURIComponent(taleId)}/responses`),
      );
      if (generation !== this.generation) return;
      this.read.set({ taleId, elementId, responses });
      if (announce) this.status.set(`${this.words().heading} updated: ${this.counts()?.total ?? ''}`);
    } catch {
      if (generation !== this.generation) return;
      this.read.set(null);
      this.failed.set(true);
    }
  }

  protected readonly counts = computed(() => {
    const read = this.read();
    const element = this.element();
    if (!read || read.taleId !== this.taleId() || read.elementId !== element.id) return null;
    const recorded: ElementResponseCounts | undefined = read.responses.elements.find((e) => e.elementId === element.id);
    const byValue = new Map((recorded?.values ?? []).map((v) => [v.value, v.count]));
    const hasResponses = (recorded?.total ?? 0) > 0;
    if (element.type === 'rating') {
      // A Rating's count and average, as visitors see them (R5).
      const result = ratingResult(byValue);
      return {
        choices: [] as ChoiceCountView[],
        total: result.total ? `${plural(result.total, 'rating', 'ratings')}, average ${result.average}` : '0 ratings',
        hasResponses,
      };
    }
    const labels = new Map(
      (((element.props as { options?: unknown } | null)?.options ?? []) as { id?: unknown; label?: unknown }[]).map(
        (o) => [o?.id, typeof o?.label === 'string' ? o.label : ''],
      ),
    );
    const choices: ChoiceCountView[] = pollOptionIds(element.props).map((id) => ({
      id,
      label: labels.get(id) || id,
      count: byValue.get(id) ?? 0,
    }));
    const total = choices.reduce((sum, c) => sum + c.count, 0);
    return { choices, total: plural(total, 'vote', 'votes'), hasResponses };
  });
}
