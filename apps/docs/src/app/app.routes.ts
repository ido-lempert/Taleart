import { Route } from '@angular/router';
import { ApiReferencePage } from './pages/api-reference';
import { ApiTokensPage } from './pages/api-tokens';
import { ConceptsPage } from './pages/concepts';
import { GettingStartedPage } from './pages/getting-started';
import { InstallPage } from './pages/install';
import { MovingPage } from './pages/moving';
import { NotFoundPage } from './pages/not-found';
import { TargetingPage } from './pages/targeting';
import { WebGuidePage } from './pages/web-guide';
import { WebSdkReferencePage } from './pages/web-sdk-reference';
import { AndroidGuidePage } from './pages/android-guide';
import { AndroidSdkReferencePage } from './pages/android-sdk-reference';
import { IosGuidePage } from './pages/ios-guide';
import { IosSdkReferencePage } from './pages/ios-sdk-reference';

/**
 * The docs pages, in navigation order. Each is prerendered (`app.routes.server.ts`). AI agents is
 * loaded on demand: it carries the agent skill's whole text, which no other page needs.
 */
export const DOCS_PAGES: ReadonlyArray<{ path: string; label: string; title: string } & Pick<Route, 'component' | 'loadComponent'>> = [
  { path: '', label: 'Getting started', title: 'Getting started', component: GettingStartedPage },
  { path: 'concepts', label: 'Concepts', title: 'Concepts', component: ConceptsPage },
  { path: 'install', label: 'Install a zone', title: 'Install a zone', component: InstallPage },
  { path: 'guides/web', label: 'Web guide', title: 'Web guide', component: WebGuidePage },
  { path: 'android-guide', label: 'Android guide', title: 'Android guide', component: AndroidGuidePage },
  { path: 'ios-guide', label: 'iOS guide', title: 'iOS guide', component: IosGuidePage },
  { path: 'targeting', label: 'Targeting', title: 'Targeting', component: TargetingPage },
  { path: 'api-tokens', label: 'API tokens', title: 'API tokens', component: ApiTokensPage },
  { path: 'api-reference', label: 'API reference', title: 'API reference', component: ApiReferencePage },
  { path: 'reference/web-sdk', label: 'Web SDK reference', title: 'Web SDK reference', component: WebSdkReferencePage },
  { path: 'reference/android-sdk', label: 'Android SDK reference', title: 'Android SDK reference', component: AndroidSdkReferencePage },
  { path: 'reference/ios-sdk', label: 'iOS SDK reference', title: 'iOS SDK reference', component: IosSdkReferencePage },
  {
    path: 'ai-agents',
    label: 'AI agents',
    title: 'AI agents',
    loadComponent: () => import('./pages/ai-agents').then((m) => m.AiAgentsPage),
  },
  { path: 'moving-from-stages', label: 'Stages and zone keys', title: 'Stages and zone keys', component: MovingPage },
];

/** The prerendered "not found" page, which a static host serves for any other path. */
export const NOT_FOUND_PATH = 'not-found';

export const appRoutes: Route[] = [
  ...DOCS_PAGES.map(({ path, title, component, loadComponent }) => ({
    path,
    title: `${title} · TaleArt docs`,
    ...(component ? { component } : { loadComponent }),
  })),
  { path: NOT_FOUND_PATH, title: 'Page not found · TaleArt docs', component: NotFoundPage },
  { path: '**', title: 'Page not found · TaleArt docs', component: NotFoundPage },
];
