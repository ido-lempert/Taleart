import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { PageOutline } from './page-outline';

/**
 * "On this page": the current page's h2 and h3 headings, with the one the reader is in marked. As a column
 * beside the article on wide screens (`column`), or a collapsed details above it (`inline`); the CSS shows
 * one of the two by the width. Nothing shows for a page with fewer than two headings.
 */
@Component({
  selector: 'docs-on-this-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (outline.headings().length > 1) {
      @if (variant() === 'column') {
        <aside class="toc" aria-label="On this page">
          <p class="toc__title">On this page</p>
          <ul>
            @for (heading of outline.headings(); track heading.id) {
              <li [class.toc__item--sub]="heading.level === 3">
                <a
                  [href]="heading.href"
                  [class.is-current]="outline.current() === heading.id"
                  [attr.aria-current]="outline.current() === heading.id ? 'location' : null"
                  >{{ heading.text }}</a
                >
              </li>
            }
          </ul>
        </aside>
      } @else {
        <details class="toc-details">
          <summary>On this page</summary>
          <nav aria-label="On this page">
            <ul>
              @for (heading of outline.headings(); track heading.id) {
                <li [class.toc__item--sub]="heading.level === 3">
                  <a
                    [href]="heading.href"
                    [class.is-current]="outline.current() === heading.id"
                    [attr.aria-current]="outline.current() === heading.id ? 'location' : null"
                    >{{ heading.text }}</a
                  >
                </li>
              }
            </ul>
          </nav>
        </details>
      }
    }
  `,
})
export class OnThisPage {
  protected readonly outline = inject(PageOutline);
  readonly variant = input<'column' | 'inline'>('column');
}
