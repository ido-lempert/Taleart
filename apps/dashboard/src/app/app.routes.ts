import { Route } from '@angular/router';
import { authGuard, setupGuard, signInGuard } from './auth';
import { InvitePage } from './pages/invite';
import { SetupPage } from './pages/setup';
import { SignInPage } from './pages/sign-in';
import { ProjectsPage } from './pages/projects';
import { ZoneDetailPage } from './pages/zone-detail';
import { ZonesPage } from './pages/zones';

/** Shell data per route: the top bar title and what its "New …" button creates. */
export interface ShellData {
  heading: string;
  create: 'project' | 'zone' | 'taleGroup';
  createLabel: string;
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
        path: 'projects',
        component: ProjectsPage,
        title: 'Projects · TaleArt',
        data: { heading: 'Projects', create: 'project', createLabel: 'New project' } satisfies ShellData,
      },
      { path: '**', redirectTo: 'zones' },
    ],
  },
];
