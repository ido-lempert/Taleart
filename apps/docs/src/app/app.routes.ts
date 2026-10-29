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
import { GuidesWebSdkPage } from './pages/guides-web-sdk';
import { GuidesAndroidSdkPage } from './pages/guides-android-sdk';
import { GuidesIosSdkPage } from './pages/guides-ios-sdk';
import { CliPage } from './pages/cli';
import { CoverageAndLimitsPage } from './pages/coverage-and-limits';

/**
 * The docs pages, in navigation order. Each is prerendered (`app.routes.server.ts`). AI agents is
 * loaded on demand: it carries the agent skill's whole text, which no other page needs.
 */
/** The navigation's collapsible groups, in order. */
export const DOCS_GROUPS = ['Introduction', 'Installation', 'Campaigns', 'Targeting and audience', 'Workspace', 'Developers'] as const;

export const DOCS_PAGES: ReadonlyArray<{ path: string; label: string; title: string; group: string } & Pick<Route, 'component' | 'loadComponent'>> = [
  { path: '', label: 'Getting started', title: 'Getting started', group: 'Introduction', component: GettingStartedPage },
  { path: 'concepts', label: 'Concepts', title: 'Concepts', group: 'Introduction', component: ConceptsPage },
  { path: 'coverage-and-limits', label: 'Coverage and limits', title: 'Coverage and limits', group: 'Introduction', component: CoverageAndLimitsPage },
  { path: 'guides-install', label: 'Install TaleArt locally', title: 'Install TaleArt locally', group: 'Installation', component: GuidesInstallPage },
  { path: 'install', label: 'Install a zone', title: 'Install a zone', group: 'Installation', component: InstallPage },
  { path: 'guides-connect-website', label: 'Connect a website', title: 'Connect a website', group: 'Installation', component: GuidesConnectWebsitePage },
  { path: 'guides-web-sdk', label: 'Web SDK', title: 'Web SDK', group: 'Installation', component: GuidesWebSdkPage },
  { path: 'guides-android-sdk', label: 'Android SDK', title: 'Android SDK', group: 'Installation', component: GuidesAndroidSdkPage },
  { path: 'guides-ios-sdk', label: 'iOS SDK', title: 'iOS SDK', group: 'Installation', component: GuidesIosSdkPage },
  { path: 'guides-create-campaign', label: 'Create a campaign', title: 'Create a campaign', group: 'Campaigns', component: GuidesCreateCampaignPage },
  { path: 'zones-and-displays', label: 'Zones and displays', title: 'Zones and displays', group: 'Campaigns', component: ZonesAndDisplaysPage },
  { path: 'tale-groups-and-tales', label: 'Tale groups and tales', title: 'Tale groups and tales', group: 'Campaigns', component: TaleGroupsAndTalesPage },
  { path: 'tale-studio', label: 'Tale Studio', title: 'Tale Studio', group: 'Campaigns', component: TaleStudioPage },
  { path: 'interactive-components', label: 'Interactive components', title: 'Interactive components', group: 'Campaigns', component: InteractiveComponentsPage },
  { path: 'theme-and-fonts', label: 'Theme and fonts', title: 'Theme and fonts', group: 'Campaigns', component: ThemeAndFontsPage },
  { path: 'visibility', label: 'Visibility and troubleshooting', title: 'Visibility and troubleshooting', group: 'Campaigns', component: VisibilityPage },
  { path: 'targeting', label: 'Targeting', title: 'Targeting', group: 'Targeting and audience', component: TargetingPage },
  { path: 'projects-and-team', label: 'Projects, team and sign-in', title: 'Projects, team and sign-in', group: 'Workspace', component: ProjectsAndTeamPage },
  { path: 'import-from-another-tool', label: 'Import from another tool', title: 'Import from another tool', group: 'Workspace', component: ImportFromAnotherToolPage },
  { path: 'api-tokens', label: 'API tokens', title: 'API tokens', group: 'Developers', component: ApiTokensPage },
  { path: 'api-reference', label: 'API reference', title: 'API reference', group: 'Developers', component: ApiReferencePage },
  { path: 'cli', label: 'Command-line tool', title: 'Command-line tool', group: 'Developers', component: CliPage },
  { path: 'guides/web', label: 'Web guide', title: 'Web guide', group: 'Developers', loadComponent: () => import('./pages/web-guide').then((m) => m.WebGuidePage) },
  { path: 'android-guide', label: 'Android guide', title: 'Android guide', group: 'Developers', loadComponent: () => import('./pages/android-guide').then((m) => m.AndroidGuidePage) },
  { path: 'ios-guide', label: 'iOS guide', title: 'iOS guide', group: 'Developers', loadComponent: () => import('./pages/ios-guide').then((m) => m.IosGuidePage) },
  { path: 'reference/web-sdk', label: 'Web SDK reference', title: 'Web SDK reference', group: 'Developers', loadComponent: () => import('./pages/web-sdk-reference').then((m) => m.WebSdkReferencePage) },
  { path: 'reference/performance', label: 'Performance', title: 'Performance', group: 'Developers', loadComponent: () => import('./pages/web-performance').then((m) => m.WebPerformancePage) },
  { path: 'reference/android-sdk', label: 'Android SDK reference', title: 'Android SDK reference', group: 'Developers', loadComponent: () => import('./pages/android-sdk-reference').then((m) => m.AndroidSdkReferencePage) },
  { path: 'reference/ios-sdk', label: 'iOS SDK reference', title: 'iOS SDK reference', group: 'Developers', loadComponent: () => import('./pages/ios-sdk-reference').then((m) => m.IosSdkReferencePage) },
  {
    path: 'ai-agents',
    label: 'AI agents',
    title: 'AI agents',
    group: 'Developers',
    loadComponent: () => import('./pages/ai-agents').then((m) => m.AiAgentsPage),
  },
  { path: 'moving-from-stages', label: 'Stages and zone keys', title: 'Stages and zone keys', group: 'Developers', component: MovingPage },
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
