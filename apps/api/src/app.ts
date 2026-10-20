import express from 'express';
import type { Pool } from 'pg';

// Builds the API. Takes its pool so tests can point it at a real database.
export function createApp(pool: Pool): express.Express {
  const app = express();
  app.use(express.json());

  // The dashboard runs on another origin during development.
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
  });
  app.options('/api/*', (_req, res) => res.sendStatus(204));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/projects', async (_req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT id, name FROM projects ORDER BY created_at');
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects', async (req, res, next) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const { rows } = await pool.query(
        'INSERT INTO projects (name) VALUES ($1) RETURNING id, name',
        [name],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/zones', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, name, project_id AS "projectId" FROM zones ORDER BY created_at',
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/zones', async (req, res, next) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }
    try {
      const { rows: projects } = await pool.query('SELECT id FROM projects WHERE id = $1', [projectId]);
      if (projects.length === 0) {
        res.status(400).json({ error: 'projectId does not match a project' });
        return;
      }
      const { rows } = await pool.query(
        'INSERT INTO zones (name, project_id) VALUES ($1, $2) RETURNING id, name, project_id AS "projectId"',
        [name, projectId],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
