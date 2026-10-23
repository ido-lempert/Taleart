import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Page not found</h1>
    <p class="lede">There is no docs page at this address.</p>
    <p>Start from <a routerLink="/">Getting started</a>, or pick a page from the list.</p>
  `,
})
export class NotFoundPage {}
