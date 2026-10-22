import { Route } from '@angular/router';
import { ConceptsPage } from './pages/concepts';
import { GettingStartedPage } from './pages/getting-started';
import { InstallPage } from './pages/install';
import { MovingPage } from './pages/moving';

/** The docs pages, in navigation order. */
export const DOCS_PAGES = [
  { path: '', label: 'Getting started', title: 'Getting started', component: GettingStartedPage },
  { path: 'concepts', label: 'Concepts', title: 'Concepts', component: ConceptsPage },
  { path: 'install', label: 'Install a zone', title: 'Install a zone', component: InstallPage },
  { path: 'moving-from-stages', label: 'Stages and zone keys', title: 'Stages and zone keys', component: MovingPage },
] as const;

export const appRoutes: Route[] = [
  ...DOCS_PAGES.map(({ path, title, component }) => ({ path, title: `${title} · TaleArt docs`, component })),
  { path: '**', redirectTo: '' },
];
