import { Route } from '@angular/router';
import { ConceptsPage } from './pages/concepts';
import { GettingStartedPage } from './pages/getting-started';
import { InstallPage } from './pages/install';
import { MovingPage } from './pages/moving';
import { NotFoundPage } from './pages/not-found';
import { TargetingPage } from './pages/targeting';

/** The docs pages, in navigation order. Each is prerendered (`app.routes.server.ts`). */
export const DOCS_PAGES = [
  { path: '', label: 'Getting started', title: 'Getting started', component: GettingStartedPage },
  { path: 'concepts', label: 'Concepts', title: 'Concepts', component: ConceptsPage },
  { path: 'install', label: 'Install a zone', title: 'Install a zone', component: InstallPage },
  { path: 'targeting', label: 'Targeting', title: 'Targeting', component: TargetingPage },
  { path: 'moving-from-stages', label: 'Stages and zone keys', title: 'Stages and zone keys', component: MovingPage },
] as const;

/** The prerendered "not found" page, which a static host serves for any other path. */
export const NOT_FOUND_PATH = 'not-found';

export const appRoutes: Route[] = [
  ...DOCS_PAGES.map(({ path, title, component }) => ({ path, title: `${title} · TaleArt docs`, component })),
  { path: NOT_FOUND_PATH, title: 'Page not found · TaleArt docs', component: NotFoundPage },
  { path: '**', title: 'Page not found · TaleArt docs', component: NotFoundPage },
];
