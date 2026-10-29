import { Route } from '@angular/router';
import { ApiReferencePage } from './pages/api-reference';
import { ApiTokensPage } from './pages/api-tokens';
import { ConceptsPage } from './pages/concepts';
import { GettingStartedPage } from './pages/getting-started';
import { InstallPage } from './pages/install';
import { MovingPage } from './pages/moving';
import { NotFoundPage } from './pages/not-found';
import { TargetingPage } from './pages/targeting';
import { GuidesInstallPage } from './pages/guides-install';
import { GuidesCreateCampaignPage } from './pages/guides-create-campaign';
import { GuidesConnectWebsitePage } from './pages/guides-connect-website';
import { ZonesAndDisplaysPage } from './pages/zones-and-displays';
import { TaleGroupsAndTalesPage } from './pages/tale-groups-and-tales';
import { TaleStudioPage } from './pages/tale-studio';
import { InteractiveComponentsPage } from './pages/interactive-components';
import { ThemeAndFontsPage } from './pages/theme-and-fonts';
import { VisibilityPage } from './pages/visibility';
import { ProjectsAndTeamPage } from './pages/projects-and-team';
import { ImportFromAnotherToolPage } from './pages/import-from-another-tool';
import { CliPage } from './pages/cli';
import { CoverageAndLimitsPage } from './pages/coverage-and-limits';

/**
 * The navigation's collapsible groups, in order. No group has a single page.
 */
export const DOCS_GROUPS = ['Introduction', 'Installation', 'Campaigns', 'Workspace', 'SDK guides', 'Reference'] as const;

/**
 * The docs pages, grouped and in navigation order. Each is prerendered (`app.routes.server.ts`), except
 * AI agents and the SDK guides and references, which load on demand: they carry more text than most pages.
 */
export const DOCS_PAGES: ReadonlyArray<{ path: string; label: string; title: string; group: (typeof DOCS_GROUPS)[number] } & Pick<Route, 'component' | 'loadComponent'>> = [
  { path: '', label: 'Getting started', title: 'Getting started', group: 'Introduction', component: GettingStartedPage },
  { path: 'concepts', label: 'Concepts', title: 'Concepts', group: 'Introduction', component: ConceptsPage },
  { path: 'coverage-and-limits', label: 'Coverage and limits', title: 'Coverage and limits', group: 'Introduction', component: CoverageAndLimitsPage },
  { path: 'guides-install', label: 'Install TaleArt locally', title: 'Install TaleArt locally', group: 'Installation', component: GuidesInstallPage },
  { path: 'install', label: 'Install a zone', title: 'Install a zone', group: 'Installation', component: InstallPage },
  { path: 'guides-connect-website', label: 'Connect a website', title: 'Connect a website', group: 'Installation', component: GuidesConnectWebsitePage },
  { path: 'guides-create-campaign', label: 'Create a campaign', title: 'Create a campaign', group: 'Campaigns', component: GuidesCreateCampaignPage },
  { path: 'zones-and-displays', label: 'Zones and displays', title: 'Zones and displays', group: 'Campaigns', component: ZonesAndDisplaysPage },
  { path: 'tale-groups-and-tales', label: 'Tale groups and tales', title: 'Tale groups and tales', group: 'Campaigns', component: TaleGroupsAndTalesPage },
  { path: 'tale-studio', label: 'Tale Studio', title: 'Tale Studio', group: 'Campaigns', component: TaleStudioPage },
  { path: 'interactive-components', label: 'Interactive components', title: 'Interactive components', group: 'Campaigns', component: InteractiveComponentsPage },
  { path: 'theme-and-fonts', label: 'Theme and fonts', title: 'Theme and fonts', group: 'Campaigns', component: ThemeAndFontsPage },
  { path: 'visibility', label: 'Visibility and troubleshooting', title: 'Visibility and troubleshooting', group: 'Campaigns', component: VisibilityPage },
  { path: 'targeting', label: 'Targeting', title: 'Targeting', group: 'Campaigns', component: TargetingPage },
  { path: 'guides/analytics', label: 'Read your analytics', title: 'Read your analytics', group: 'Campaigns', loadComponent: () => import('./pages/analytics-guide').then((m) => m.AnalyticsGuidePage) },
  { path: 'projects-and-team', label: 'Projects, team and sign-in', title: 'Projects, team and sign-in', group: 'Workspace', component: ProjectsAndTeamPage },
  { path: 'guides/sign-in-methods', label: 'Sign-in methods', title: 'Sign-in methods', group: 'Workspace', loadComponent: () => import('./pages/sign-in-methods-guide').then((m) => m.SignInMethodsGuidePage) },
  { path: 'import-from-another-tool', label: 'Import from another tool', title: 'Import from another tool', group: 'Workspace', component: ImportFromAnotherToolPage },
  { path: 'guides/web', label: 'Web guide', title: 'Web guide', group: 'SDK guides', loadComponent: () => import('./pages/web-guide').then((m) => m.WebGuidePage) },
  { path: 'android-guide', label: 'Android guide', title: 'Android guide', group: 'SDK guides', loadComponent: () => import('./pages/android-guide').then((m) => m.AndroidGuidePage) },
  { path: 'ios-guide', label: 'iOS guide', title: 'iOS guide', group: 'SDK guides', loadComponent: () => import('./pages/ios-guide').then((m) => m.IosGuidePage) },
  { path: 'reference/web-sdk', label: 'Web SDK reference', title: 'Web SDK reference', group: 'Reference', loadComponent: () => import('./pages/web-sdk-reference').then((m) => m.WebSdkReferencePage) },
  { path: 'reference/performance', label: 'Performance', title: 'Performance', group: 'Reference', loadComponent: () => import('./pages/web-performance').then((m) => m.WebPerformancePage) },
  { path: 'reference/android-sdk', label: 'Android SDK reference', title: 'Android SDK reference', group: 'Reference', loadComponent: () => import('./pages/android-sdk-reference').then((m) => m.AndroidSdkReferencePage) },
  { path: 'reference/ios-sdk', label: 'iOS SDK reference', title: 'iOS SDK reference', group: 'Reference', loadComponent: () => import('./pages/ios-sdk-reference').then((m) => m.IosSdkReferencePage) },
  { path: 'reference/analytics', label: 'Analytics reference', title: 'Analytics reference', group: 'Reference', loadComponent: () => import('./pages/analytics-reference').then((m) => m.AnalyticsReferencePage) },
  { path: 'reference/sign-in-methods', label: 'Sign-in methods reference', title: 'Sign-in methods reference', group: 'Reference', loadComponent: () => import('./pages/sign-in-methods-reference').then((m) => m.SignInMethodsReferencePage) },
  { path: 'api-reference', label: 'API reference', title: 'API reference', group: 'Reference', component: ApiReferencePage },
  { path: 'api-tokens', label: 'API tokens', title: 'API tokens', group: 'Reference', component: ApiTokensPage },
  { path: 'cli', label: 'Command-line tool', title: 'Command-line tool', group: 'Reference', component: CliPage },
  { path: 'ai-agents', label: 'AI agents', title: 'AI agents', group: 'Reference', loadComponent: () => import('./pages/ai-agents').then((m) => m.AiAgentsPage) },
  { path: 'moving-from-stages', label: 'Stages and zone keys', title: 'Stages and zone keys', group: 'Reference', component: MovingPage },
];

/**
 * The short SDK guides were replaced by the detailed guides above. Their old addresses redirect to them.
 * Angular redirects inside the app; a static host without a route for an old path serves the not-found page,
 * which boots the app and follows the redirect (see `finish-pages.mjs`).
 */
export const RETIRED_PAGES: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'guides-web-sdk', to: 'guides/web' },
  { from: 'guides-android-sdk', to: 'android-guide' },
  { from: 'guides-ios-sdk', to: 'ios-guide' },
];

/** The prerendered "not found" page, which a static host serves for any other path. */
export const NOT_FOUND_PATH = 'not-found';

export const appRoutes: Route[] = [
  ...DOCS_PAGES.map(({ path, title, component, loadComponent }) => ({
    path,
    title: `${title} · TaleArt docs`,
    ...(component ? { component } : { loadComponent }),
  })),
  ...RETIRED_PAGES.map(({ from, to }) => ({ path: from, redirectTo: to, pathMatch: 'full' as const })),
  { path: NOT_FOUND_PATH, title: 'Page not found · TaleArt docs', component: NotFoundPage },
  { path: '**', title: 'Page not found · TaleArt docs', component: NotFoundPage },
];
