import { Route } from '@angular/router';
import { ProjectsPage } from './pages/projects';
import { ZoneDetailPage } from './pages/zone-detail';
import { ZonesPage } from './pages/zones';

/** Shell data per route: the top bar title and what its "New …" button creates. */
export interface ShellData {
  heading: string;
  create: 'project' | 'zone' | 'taleGroup';
  createLabel: string;
}

export const appRoutes: Route[] = [
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
];
