import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  MAX_HITS,
  prepareIndex,
  PreparedIndex,
  queryTerms,
  search,
  SearchIndex,
  Segment,
  segments,
  snippet,
} from './search';

/** One result as the template shows it: the section's heading and snippet, with the matching words marked. */
interface ResultView {
  /** The option's id in the listbox, and its place in the flat list (the keyboard order). */
  id: string;
  index: number;
  route: string;
  anchor: string;
  heading: Segment[];
  text: Segment[];
}

/** The results of one page, under the page's title. */
interface ResultGroup {
  labelId: string;
  title: string;
  group: string;
  hits: ResultView[];
}

/** Whether a key press is typed into a field, so `/` is text there and not a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * The search: a button in the header ("Search", with the "/" hint) and a command-palette dialog that opens with
 * "/" (outside fields) or Ctrl/Cmd+K. The index loads on the first open. Results are grouped by page, the
 * matches marked; Up and Down (Home and End) move through them, Enter opens the section, Escape closes the
 * dialog and returns the focus to where it was. Nothing is stored: the query lives while the page is open.
 */
@Component({
  selector: 'docs-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #trigger class="search-button" type="button" aria-label="Search" aria-haspopup="dialog" (click)="show()">
      <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4.5 4.5" />
      </svg>
      <span class="search-button__label" aria-hidden="true">Search</span>
      <kbd class="search-button__hint" aria-hidden="true">/</kbd>
    </button>
    <dialog
      #dialog
      class="search"
      aria-labelledby="docs-search-title"
      (mousedown)="onBackdropClick($event)"
      (close)="onClosed()"
    >
      <div class="search__panel">
        <h2 id="docs-search-title" class="visually-hidden">Search the docs</h2>
        <div class="search__bar">
          <svg class="ui-icon search__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <input
            #input
            class="search__input"
            type="text"
            role="combobox"
            aria-label="Search the docs"
            aria-autocomplete="list"
            aria-controls="docs-search-results"
            [attr.aria-expanded]="flat().length > 0"
            [attr.aria-activedescendant]="flat().length > 0 ? optionId(active()) : null"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Search titles, headings and text"
            [value]="query()"
            (input)="onInput($event)"
            (keydown)="onInputKey($event)"
          />
          <button class="search__close" type="button" aria-label="Close search" (click)="close()">
            <span aria-hidden="true">Esc</span>
          </button>
        </div>
        <p class="search__status" role="status">{{ status() }}</p>
        <div id="docs-search-results" class="search__results" role="listbox" aria-label="Results">
          @for (group of groups(); track group.labelId) {
            <div class="search__group" role="group" [attr.aria-labelledby]="group.labelId">
              <p class="search__page" [id]="group.labelId">
                <span class="search__page-title">{{ group.title }}</span>
                <span class="search__page-group">{{ group.group }}</span>
              </p>
              @for (hit of group.hits; track hit.id) {
                <div
                  class="search__option"
                  tabindex="-1"
                  role="option"
                  [id]="hit.id"
                  [class.is-active]="hit.index === active()"
                  [attr.aria-selected]="hit.index === active()"
                  (mousedown)="$event.preventDefault()"
                  (click)="choose(hit)"
                  (keydown.enter)="choose(hit)"
                >
                  <span class="search__heading">
                    @for (part of hit.heading; track $index) {
                      @if (part.mark) {
                        <mark>{{ part.text }}</mark>
                      } @else {
                        <span>{{ part.text }}</span>
                      }
                    }
                  </span>
                  @if (hit.text.length > 0) {
                    <span class="search__snippet">
                      @for (part of hit.text; track $index) {
                        @if (part.mark) {
                          <mark>{{ part.text }}</mark>
                        } @else {
                          <span>{{ part.text }}</span>
                        }
                      }
                    </span>
                  }
                </div>
              }
            </div>
          }
        </div>
        @if (!query().trim()) {
          <p class="search__empty">Type a word to find a page, a heading or a sentence in the docs.</p>
        }
        <p class="search__keys" aria-hidden="true">
          <kbd>↑</kbd> <kbd>↓</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close
        </p>
      </div>
    </dialog>
  `,
})
export class DocsSearch {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  /** Whether the dialog is open (the keys below depend on it). */
  private readonly isOpen = signal(false);
  protected readonly query = signal('');
  /** The index, once loaded: the first open fetches it; `loadState` says where that stands. */
  private readonly prepared = signal<PreparedIndex | null>(null);
  private readonly loadState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** The flat index of the highlighted result (the one Enter opens). */
  protected readonly active = signal(0);
  /** Where the focus was before the dialog opened; it goes back there on close. */
  private returnFocus: HTMLElement | null = null;
  /** False when the dialog closes because a result was chosen: the new page takes the focus then. */
  private restoreFocus = true;
  private loading: Promise<void> | null = null;

  protected readonly groups = computed<ResultGroup[]>(() => {
    const prepared = this.prepared();
    const terms = queryTerms(this.query());
    if (!prepared || terms.length === 0) return [];
    const byPage = new Map<number, ResultGroup>();
    let index = 0;
    for (const hit of search(prepared, this.query())) {
      const pageIndex = hit.section.i;
      let group = byPage.get(pageIndex);
      if (!group) {
        group = {
          labelId: `docs-search-page-${pageIndex}`,
          title: hit.page.t,
          group: hit.page.g,
          hits: [],
        };
        byPage.set(pageIndex, group);
      }
      const heading = hit.section.h || hit.page.t;
      group.hits.push({
        id: this.optionId(index),
        index,
        route: hit.page.p,
        anchor: hit.section.a,
        heading: segments(heading, terms),
        text: hit.section.x ? snippet(hit.section.x, terms) : [],
      });
      index++;
    }
    return [...byPage.values()];
  });

  /** The results in the order the keyboard moves through them. */
  protected readonly flat = computed(() => this.groups().flatMap((group) => group.hits));

  protected readonly status = computed(() => {
    const state = this.loadState();
    if (state === 'error') return 'The search could not be loaded. Reload the page to try again.';
    if (state === 'loading' || state === 'idle') return this.query().trim() ? 'Loading the search…' : '';
    const q = this.query().trim();
    if (!q) return '';
    const count = this.flat().length;
    if (count === 0) return `No results for “${q}”.`;
    if (count === 1) return '1 result';
    // The index search stops at MAX_HITS: say so rather than imply the count is complete.
    return count >= MAX_HITS ? `More than ${MAX_HITS} results: refine the words` : `${count} results`;
  });

  protected optionId(index: number): string {
    return `docs-search-option-${index}`;
  }

  /** "/" opens the search where no field has the focus; Ctrl/Cmd+K opens it or closes it from anywhere. */
  @HostListener('document:keydown', ['$event'])
  protected onGlobalKey(event: KeyboardEvent): void {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (this.isOpen()) this.close();
      else this.show();
      return;
    }
    if (event.key === '/' && !modifier && !event.altKey && !this.isOpen() && !isTyping(event.target)) {
      event.preventDefault();
      this.show();
    }
  }

  protected show(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    this.returnFocus =
      this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : this.trigger().nativeElement;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    this.isOpen.set(true);
    this.input().nativeElement.focus();
    this.load();
  }

  /** Closes the dialog; the focus returns to where it was, unless `restoreFocus` is false (a result took it). */
  protected close(restoreFocus = true): void {
    this.restoreFocus = restoreFocus;
    const dialog = this.dialog().nativeElement;
    if (dialog.open) dialog.close();
  }

  /** The dialog's close event, however it closed (Escape, the button, a result, the backdrop). */
  protected onClosed(): void {
    this.isOpen.set(false);
    const back = this.returnFocus;
    this.returnFocus = null;
    if (!this.restoreFocus) return;
    (back?.isConnected ? back : this.trigger().nativeElement).focus({ preventScroll: true });
  }

  protected onBackdropClick(event: MouseEvent): void {
    // A click on the dialog itself (not its panel) is a click on the backdrop.
    if (event.target === this.dialog().nativeElement) this.close();
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(0);
  }

  protected onInputKey(event: KeyboardEvent): void {
    const count = this.flat().length;
    switch (event.key) {
      case 'ArrowDown':
        if (count === 0) return;
        event.preventDefault();
        this.move((this.active() + 1) % count);
        return;
      case 'ArrowUp':
        if (count === 0) return;
        event.preventDefault();
        this.move((this.active() - 1 + count) % count);
        return;
      case 'Home':
        if (count === 0) return;
        event.preventDefault();
        this.move(0);
        return;
      case 'End':
        if (count === 0) return;
        event.preventDefault();
        this.move(count - 1);
        return;
      case 'Enter': {
        const hit = this.flat()[this.active()];
        if (!hit) return;
        event.preventDefault();
        this.choose(hit);
        return;
      }
    }
  }

  private move(index: number): void {
    this.active.set(index);
    this.doc.getElementById(this.optionId(index))?.scrollIntoView?.({ block: 'nearest' });
  }

  /** Opens the section: its page by the router, then the section's heading at the top of the window. */
  protected choose(hit: ResultView): void {
    this.close(false);
    const url = `/${hit.route}${hit.anchor ? `#${hit.anchor}` : ''}`;
    void this.router.navigateByUrl(url).then(() => {
      // After the app moves the focus to the page's heading, so the section is scrolled to last.
      setTimeout(() => {
        if (hit.anchor) this.doc.getElementById(hit.anchor)?.scrollIntoView?.({ block: 'start' });
      });
    });
  }

  /** Fetches the index once, when the dialog first opens; relative to the base href (the site may be under /Taleart/). */
  private load(): void {
    if (this.prepared() || this.loading) return;
    this.loadState.set('loading');
    this.loading = fetch(new URL('search-index.json', this.doc.baseURI))
      .then((response) => {
        if (!response.ok) throw new Error(`search-index.json: ${response.status}`);
        return response.json() as Promise<SearchIndex>;
      })
      .then((index) => {
        this.prepared.set(prepareIndex(index));
        this.loadState.set('ready');
      })
      .catch(() => {
        this.loadState.set('error');
        this.loading = null;
      });
  }
}
