import { RenderMode, ServerRoute } from '@angular/ssr';

// Every page reads the Management API, so pages render in the browser; prerendering would call the API at build time.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
