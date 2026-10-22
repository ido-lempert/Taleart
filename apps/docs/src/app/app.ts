import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DOCS_PAGES } from './app.routes';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'docs-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly pages = DOCS_PAGES;
}
