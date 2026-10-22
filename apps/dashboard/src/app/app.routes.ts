import { Route } from '@angular/router';
import { authGuard, setupGuard, signInGuard } from './auth';
import { SignInPage } from './pages/sign-in';

/** Shell data per route: the top bar title and what its "New …" button creates, if anything. */
export interface ShellData {
  heading: string;
  /** What the top bar's "New …" button creates; pages without one leave it out. */
  create?: 'project' | 'zone' | 'taleGroup';
  createLabel?: string;
}

/** Route data of the pages shown without the shell: setup, sign-in and invitations. */
export interface BareData {
  bare: true;
}

export const appRoutes: Route[] = [
  {
    path: 'setup',
    loadComponent: () => import('./pages/setup').then((m) => m.SetupPage),
    title: 'Set up · TaleArt',
    canActivate: [setupGuard],
    data: { bare: true } satisfies BareData,
  },
  {
    path: 'sign-in',
    component: SignInPage,
    title: 'Sign in · TaleArt',
    canActivate: [signInGuard],
    data: { bare: true } satisfies BareData,
  },
  {
    // An invitation link; works without a session (AD-9).
    path: 'invite/:token',
    loadComponent: () => import('./pages/invite').then((m) => m.InvitePage),
    title: 'Join · TaleArt',
    data: { bare: true } satisfies BareData,
  },
  {
    // The shell pages need a signed-in user (AD-9).
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'zones' },
      {
        path: 'zones',
        // Lazy, like every other shell page, to keep the initial bundle under its 500 kB budget.
        loadComponent: () => import('./pages/zones').then((m) => m.ZonesPage),
        title: 'Zones · TaleArt',
        data: { heading: 'Zones', create: 'zone', createLabel: 'New zone' } satisfies ShellData,
      },
      {
        path: 'zones/:zoneId',
        loadComponent: () => import('./pages/zone-detail').then((m) => m.ZoneDetailPage),
        title: 'Zone · TaleArt',
        data: { heading: 'Zone', create: 'taleGroup', createLabel: 'New tale group' } satisfies ShellData,
      },
      {
        // A project's tale groups, placed in zones or not (AD-14).
        path: 'tale-groups',
        loadComponent: () => import('./pages/tale-groups').then((m) => m.TaleGroupsPage),
        title: 'Tale groups · TaleArt',
        data: { heading: 'Tale groups' } satisfies ShellData,
      },
      {
        // Tale Studio: a tale's document on a 9:16 canvas (epic Tale Studio, AD-15), loaded on first visit.
        path: 'tales/:taleId/studio',
        loadComponent: () => import('./pages/tale-studio').then((m) => m.TaleStudioPage),
        // Leaving with unsaved changes saves them first, or asks (epic Tale Studio R9).
        canDeactivate: [(page: { canLeave(): Promise<boolean> }) => page.canLeave()],
        title: 'Tale Studio · TaleArt',
        data: { heading: 'Tale Studio' } satisfies ShellData,
      },
      {
        path: 'projects',
        loadComponent: () => import('./pages/projects').then((m) => m.ProjectsPage),
        title: 'Projects · TaleArt',
        data: { heading: 'Projects', create: 'project', createLabel: 'New project' } satisfies ShellData,
      },
      {
        // The project's theme, for every zone's bar, banner and viewer (epic web zones R9).
        path: 'projects/:projectId/theme',
        loadComponent: () => import('./pages/theme').then((m) => m.ThemePage),
        title: 'Theme · TaleArt',
        data: { heading: 'Projects' } satisfies ShellData,
      },
      {
        // The project's fonts, for text in Tale Studio (epic Tale Studio R18).
        path: 'projects/:projectId/fonts',
        loadComponent: () => import('./pages/fonts').then((m) => m.FontsPage),
        title: 'Fonts · TaleArt',
        data: { heading: 'Projects' } satisfies ShellData,
      },
      {
        // Admins import a Storyly app into this project.
        path: 'projects/:projectId/import',
        loadComponent: () => import('./pages/import').then((m) => m.ImportPage),
        title: 'Import from Storyly · TaleArt',
        data: { heading: 'Projects' } satisfies ShellData,
      },
      {
        // One import of the project: its progress while it runs, then its report.
        path: 'projects/:projectId/import/:importId',
        loadComponent: () => import('./pages/import-job').then((m) => m.ImportJobPage),
        title: 'Import from Storyly · TaleArt',
        data: { heading: 'Projects' } satisfies ShellData,
      },
      { path: '**', redirectTo: 'zones' },
    ],
  },
];
