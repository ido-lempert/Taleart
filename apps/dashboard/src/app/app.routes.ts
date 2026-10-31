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
    // A password reset link an admin issued (the server's link is /password-reset/<token>); no session needed.
    path: 'password-reset/:token',
    loadComponent: () => import('./pages/password-reset').then((m) => m.PasswordResetPage),
    title: 'Set a new password · TaleArt',
    data: { bare: true } satisfies BareData,
  },
  {
    // The same page under the short path the task brief names.
    path: 'reset/:token',
    loadComponent: () => import('./pages/password-reset').then((m) => m.PasswordResetPage),
    title: 'Set a new password · TaleArt',
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
        // The selected project's audience: its user lists (epic targeting R3), later its segments.
        path: 'audience',
        loadComponent: () => import('./pages/audience').then((m) => m.AudiencePage),
        title: 'Audience · TaleArt',
        data: { heading: 'Audience' } satisfies ShellData,
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
      { path: 'settings', pathMatch: 'full', redirectTo: 'settings/api-tokens' },
      {
        // Settings > Sign-in methods (admins only): the passkey and password methods, and the providers.
        path: 'settings/sign-in-methods',
        loadComponent: () => import('./pages/sign-in-methods').then((m) => m.SignInMethodsPage),
        title: 'Sign-in methods · Settings · TaleArt',
        data: { heading: 'Settings' } satisfies ShellData,
      },
      {
        // Settings > Users (admins only): who can sign in, how, and reset links for them.
        path: 'settings/users',
        loadComponent: () => import('./pages/users').then((m) => m.UsersPage),
        title: 'Users · Settings · TaleArt',
        data: { heading: 'Settings' } satisfies ShellData,
      },
      {
        // Settings > My sign-in methods: the signed-in user's passkeys, password and linked providers.
        path: 'settings/my-sign-in-methods',
        loadComponent: () => import('./pages/my-sign-in-methods').then((m) => m.MySignInMethodsPage),
        title: 'My sign-in methods · Settings · TaleArt',
        data: { heading: 'Settings' } satisfies ShellData,
      },
      {
        // Settings > Team: the selected project's members, invitations, roles and activity.
        path: 'settings/team',
        loadComponent: () => import('./pages/team').then((m) => m.TeamPage),
        title: 'Team · Settings · TaleArt',
        data: { heading: 'Settings' } satisfies ShellData,
      },
      {
        // Personal API tokens for scripts and the CLI (epic developer experience 10.1).
        path: 'settings/api-tokens',
        loadComponent: () => import('./pages/api-tokens').then((m) => m.ApiTokensPage),
        title: 'API tokens · Settings · TaleArt',
        data: { heading: 'Settings' } satisfies ShellData,
      },
      { path: '**', redirectTo: 'zones' },
    ],
  },
];
