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
import { RolesAndPermissionsPage } from './pages/roles-and-permissions';
import { DockerPage } from './pages/docker';
import { DemoDataPage } from './pages/demo-data';
import { CliPage } from './pages/cli';
import { CoverageAndLimitsPage } from './pages/coverage-and-limits';

/**
 * The navigation's collapsible groups, in order. No group has a single page.
 */
export const DOCS_GROUPS = [
  'Introduction',
  'Installation',
  'Campaigns',
  'Workspace',
  'SDK guides',
  'Reference',
  'Legal',
] as const;

/**
 * The docs pages, grouped and in navigation order. Each is prerendered (`app.routes.server.ts`), except
 * AI agents and the SDK guides and references, which load on demand: they carry more text than most pages.
 */
export const DOCS_PAGES: ReadonlyArray<
  { path: string; label: string; title: string; group: (typeof DOCS_GROUPS)[number]; file: string } & Pick<
    Route,
    'component' | 'loadComponent'
  >
> = [
  {
    path: '',
    label: 'Getting started',
    title: 'Getting started',
    group: 'Introduction',
    file: 'getting-started',
    component: GettingStartedPage,
  },
  {
    path: 'concepts',
    label: 'Concepts',
    title: 'Concepts',
    group: 'Introduction',
    file: 'concepts',
    component: ConceptsPage,
  },
  {
    path: 'coverage-and-limits',
    label: 'Coverage and limits',
    title: 'Coverage and limits',
    group: 'Introduction',
    file: 'coverage-and-limits',
    component: CoverageAndLimitsPage,
  },
  {
    path: 'guides-install',
    label: 'Install TaleArt locally',
    title: 'Install TaleArt locally',
    group: 'Installation',
    file: 'guides-install',
    component: GuidesInstallPage,
  },
  {
    path: 'docker',
    label: 'Install with Docker',
    title: 'Install with Docker',
    group: 'Installation',
    file: 'docker',
    component: DockerPage,
  },
  {
    path: 'demo-data',
    label: 'Demo data',
    title: 'Demo data',
    group: 'Installation',
    file: 'demo-data',
    component: DemoDataPage,
  },
  {
    path: 'install',
    label: 'Install a zone',
    title: 'Install a zone',
    group: 'Installation',
    file: 'install',
    component: InstallPage,
  },
  {
    path: 'guides-connect-website',
    label: 'Connect a website',
    title: 'Connect a website',
    group: 'Installation',
    file: 'guides-connect-website',
    component: GuidesConnectWebsitePage,
  },
  {
    path: 'guides-create-campaign',
    label: 'Create a campaign',
    title: 'Create a campaign',
    group: 'Campaigns',
    file: 'guides-create-campaign',
    component: GuidesCreateCampaignPage,
  },
  {
    path: 'zones-and-displays',
    label: 'Zones and displays',
    title: 'Zones and displays',
    group: 'Campaigns',
    file: 'zones-and-displays',
    component: ZonesAndDisplaysPage,
  },
  {
    path: 'tale-groups-and-tales',
    label: 'Tale groups and tales',
    title: 'Tale groups and tales',
    group: 'Campaigns',
    file: 'tale-groups-and-tales',
    component: TaleGroupsAndTalesPage,
  },
  {
    path: 'tale-studio',
    label: 'Tale Studio',
    title: 'Tale Studio',
    group: 'Campaigns',
    file: 'tale-studio',
    component: TaleStudioPage,
  },
  {
    path: 'interactive-components',
    label: 'Interactive components',
    title: 'Interactive components',
    group: 'Campaigns',
    file: 'interactive-components',
    component: InteractiveComponentsPage,
  },
  {
    path: 'theme-and-fonts',
    label: 'Theme and fonts',
    title: 'Theme and fonts',
    group: 'Campaigns',
    file: 'theme-and-fonts',
    component: ThemeAndFontsPage,
  },
  {
    path: 'visibility',
    label: 'Visibility and troubleshooting',
    title: 'Visibility and troubleshooting',
    group: 'Campaigns',
    file: 'visibility',
    component: VisibilityPage,
  },
  {
    path: 'targeting',
    label: 'Targeting',
    title: 'Targeting',
    group: 'Campaigns',
    file: 'targeting',
    component: TargetingPage,
  },
  {
    path: 'guides/analytics',
    label: 'Read your analytics',
    title: 'Read your analytics',
    group: 'Campaigns',
    file: 'analytics-guide',
    loadComponent: () => import('./pages/analytics-guide').then((m) => m.AnalyticsGuidePage),
  },
  {
    path: 'projects-and-team',
    label: 'Projects, team and sign-in',
    title: 'Projects, team and sign-in',
    group: 'Workspace',
    file: 'projects-and-team',
    component: ProjectsAndTeamPage,
  },
  {
    path: 'roles-and-permissions',
    label: 'Roles and permissions',
    title: 'Roles and permissions',
    group: 'Workspace',
    file: 'roles-and-permissions',
    component: RolesAndPermissionsPage,
  },
  {
    path: 'guides/sign-in-methods',
    label: 'Sign-in methods',
    title: 'Sign-in methods',
    group: 'Workspace',
    file: 'sign-in-methods-guide',
    loadComponent: () => import('./pages/sign-in-methods-guide').then((m) => m.SignInMethodsGuidePage),
  },
  {
    path: 'guides/web',
    label: 'Web guide',
    title: 'Web guide',
    group: 'SDK guides',
    file: 'web-guide',
    loadComponent: () => import('./pages/web-guide').then((m) => m.WebGuidePage),
  },
  {
    path: 'android-guide',
    label: 'Android guide',
    title: 'Android guide',
    group: 'SDK guides',
    file: 'android-guide',
    loadComponent: () => import('./pages/android-guide').then((m) => m.AndroidGuidePage),
  },
  {
    path: 'ios-guide',
    label: 'iOS guide',
    title: 'iOS guide',
    group: 'SDK guides',
    file: 'ios-guide',
    loadComponent: () => import('./pages/ios-guide').then((m) => m.IosGuidePage),
  },
  {
    path: 'reference/web-sdk',
    label: 'Web SDK reference',
    title: 'Web SDK reference',
    group: 'Reference',
    file: 'web-sdk-reference',
    loadComponent: () => import('./pages/web-sdk-reference').then((m) => m.WebSdkReferencePage),
  },
  {
    path: 'reference/performance',
    label: 'Performance',
    title: 'Performance',
    group: 'Reference',
    file: 'web-performance',
    loadComponent: () => import('./pages/web-performance').then((m) => m.WebPerformancePage),
  },
  {
    path: 'reference/android-sdk',
    label: 'Android SDK reference',
    title: 'Android SDK reference',
    group: 'Reference',
    file: 'android-sdk-reference',
    loadComponent: () => import('./pages/android-sdk-reference').then((m) => m.AndroidSdkReferencePage),
  },
  {
    path: 'reference/ios-sdk',
    label: 'iOS SDK reference',
    title: 'iOS SDK reference',
    group: 'Reference',
    file: 'ios-sdk-reference',
    loadComponent: () => import('./pages/ios-sdk-reference').then((m) => m.IosSdkReferencePage),
  },
  {
    path: 'reference/analytics',
    label: 'Analytics reference',
    title: 'Analytics reference',
    group: 'Reference',
    file: 'analytics-reference',
    loadComponent: () => import('./pages/analytics-reference').then((m) => m.AnalyticsReferencePage),
  },
  {
    path: 'reference/sign-in-methods',
    label: 'Sign-in methods reference',
    title: 'Sign-in methods reference',
    group: 'Reference',
    file: 'sign-in-methods-reference',
    loadComponent: () => import('./pages/sign-in-methods-reference').then((m) => m.SignInMethodsReferencePage),
  },
  {
    path: 'api-reference',
    label: 'API reference',
    title: 'API reference',
    group: 'Reference',
    file: 'api-reference',
    component: ApiReferencePage,
  },
  {
    path: 'api-tokens',
    label: 'API tokens',
    title: 'API tokens',
    group: 'Reference',
    file: 'api-tokens',
    component: ApiTokensPage,
  },
  {
    path: 'cli',
    label: 'Command-line tool',
    title: 'Command-line tool',
    group: 'Reference',
    file: 'cli',
    component: CliPage,
  },
  {
    path: 'ai-agents',
    label: 'AI agents',
    title: 'AI agents',
    group: 'Reference',
    file: 'ai-agents',
    loadComponent: () => import('./pages/ai-agents').then((m) => m.AiAgentsPage),
  },
  {
    path: 'moving-from-stages',
    label: 'Stages and zone keys',
    title: 'Stages and zone keys',
    group: 'Reference',
    file: 'moving',
    component: MovingPage,
  },
  {
    path: 'legal/terms',
    label: 'Terms of service',
    title: 'Terms of service',
    group: 'Legal',
    file: 'legal-terms',
    loadComponent: () => import('./pages/legal-terms').then((m) => m.LegalTermsPage),
  },
  {
    path: 'legal/privacy',
    label: 'Privacy policy',
    title: 'Privacy policy',
    group: 'Legal',
    file: 'legal-privacy',
    loadComponent: () => import('./pages/legal-privacy').then((m) => m.LegalPrivacyPage),
  },
  {
    path: 'legal/accessibility',
    label: 'Accessibility statement',
    title: 'Accessibility statement',
    group: 'Legal',
    file: 'legal-accessibility',
    loadComponent: () => import('./pages/legal-accessibility').then((m) => m.LegalAccessibilityPage),
  },
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
