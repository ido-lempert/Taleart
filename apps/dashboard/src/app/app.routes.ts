import { Route } from '@angular/router';
import { authGuard, setupGuard, signInGuard } from './auth';
import { ImportPage } from './pages/import';
import { ImportJobPage } from './pages/import-job';
import { InvitePage } from './pages/invite';
import { SetupPage } from './pages/setup';
import { SignInPage } from './pages/sign-in';
import { TaleStudioPage } from './pages/tale-studio';
import { ProjectsPage } from './pages/projects';
import { TaleGroupsPage } from './pages/tale-groups';
import { ThemePage } from './pages/theme';
import { ZoneDetailPage } from './pages/zone-detail';
import { ZonesPage } from './pages/zones';

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
    component: SetupPage,
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
    component: InvitePage,
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
        component: ZonesPage,
        title: 'Zones · TaleArt',
        data: { heading: 'Zones', create: 'zone', createLabel: 'New zone' } satisfies ShellData,
      },
      {
        path: 'zones/:zoneId',
        component: ZoneDetailPage,
        title: 'Zone · TaleArt',
        data: { heading: 'Zone', create: 'taleGroup', createLabel: 'New tale group' } satisfies ShellData,
      },
      {
        // A project's tale groups, placed in zones or not (AD-14).
        path: 'tale-groups',
        component: TaleGroupsPage,
        title: 'Tale groups · TaleArt',
        data: { heading: 'Tale groups' } satisfies ShellData,
      },
      {
        // Tale Studio: a tale's document on a 9:16 canvas (epic Tale Studio, AD-15).
        path: 'tales/:taleId/studio',
        component: TaleStudioPage,
        title: 'Tale Studio · TaleArt',
        data: { heading: 'Tale Studio' } satisfies ShellData,
      },
      {
        path: 'projects',
        component: ProjectsPage,
        title: 'Projects · TaleArt',
        data: { heading: 'Projects', create: 'project', createLabel: 'New project' } satisfies ShellData,
      },
      {
        // The project's theme, for every zone's bar, banner and viewer (epic web zones R9).
        path: 'projects/:projectId/theme',
        component: ThemePage,
        title: 'Theme · TaleArt',
        data: { heading: 'Projects' } satisfies ShellData,
      },
      {
        // Admins import a another tool app into this project.
        path: 'projects/:projectId/import',
        component: ImportPage,
        title: 'Import from another tool · TaleArt',
        data: { heading: 'Projects' } satisfies ShellData,
      },
      {
        // One import of the project: its progress while it runs, then its report.
        path: 'projects/:projectId/import/:importId',
        component: ImportJobPage,
        title: 'Import from another tool · TaleArt',
        data: { heading: 'Projects' } satisfies ShellData,
      },
      { path: '**', redirectTo: 'zones' },
    ],
  },
];
