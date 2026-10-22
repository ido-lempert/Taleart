import { RenderMode, ServerRoute } from '@angular/ssr';
import { DOCS_PAGES, NOT_FOUND_PATH } from './app.routes';

// Every docs page is static text: each is prerendered to its own HTML file at build time
// (`outputMode: 'static'`), so it reads without JavaScript. Any other path renders the
// not-found page in the browser.
export const serverRoutes: ServerRoute[] = [
  ...DOCS_PAGES.map(({ path }) => ({ path, renderMode: RenderMode.Prerender as const })),
  { path: NOT_FOUND_PATH, renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
