import type { Health } from '@taleart/contract';
import express from 'express';
import type { FrameTypeRegistry } from '@taleart/server-zones';
import type { Pool } from 'pg';
import { frameTypesRouter } from './http/frame-types.router';
import { errorHandler, notFoundHandler } from './http/errors';
import { projectsRouter } from './http/projects.router';
import { taleGroupsRouter, zoneTaleGroupsRouter } from './http/tale-groups.router';
import { zonesRouter } from './http/zones.router';

/** Management API base path (AD-2, versioned per the spine conventions). */
export const MANAGEMENT_API_BASE = '/api/v1';

// Builds the API. Takes its pool and frame-type registry so tests can point it
// at a real database and register their own frame types.
export function createApp(pool: Pool, frameTypes: FrameTypeRegistry): express.Express {
  const app = express();
  app.use(express.json());

  // The dashboard runs on another origin during development.
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
  });
  app.options(`${MANAGEMENT_API_BASE}/*`, (_req, res) => res.sendStatus(204));

  const v1 = express.Router();
  v1.get('/health', (_req, res) => {
    const body: Health = { status: 'ok' };
    res.json(body);
  });
  v1.use('/projects', projectsRouter(pool));
  v1.use('/frame-types', frameTypesRouter(frameTypes));
  v1.use('/zones', zonesRouter(pool, frameTypes));
  v1.use('/zones', zoneTaleGroupsRouter(pool));
  v1.use('/tale-groups', taleGroupsRouter(pool));
  app.use(MANAGEMENT_API_BASE, v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
