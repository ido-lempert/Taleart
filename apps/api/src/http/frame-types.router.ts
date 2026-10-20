import type { FrameTypeRegistry } from '@taleart/server-zones';
import { Router } from 'express';

export function frameTypesRouter(registry: FrameTypeRegistry): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json(registry.list());
  });
  return router;
}
