import { APPEARANCES, ErrorCodes, type Appearance, type PreferencesRequest } from '@taleart/contract';
import { setAppearance } from '@taleart/server-access';
import { Router } from 'express';
import type { Pool } from 'pg';
import { caller } from './authorize';
import { sessionOnly } from './credentials';
import { HttpError } from './errors';

/**
 * The signed-in user's own preferences (dashboard dark mode): mounted at `/me`, a passkey session only, so
 * a token never changes what a person sees. The API checks the value; the browser's check is for the form only.
 */
export function meRouter(pool: Pool): Router {
  const router = Router();

  // PUT /me/preferences: { appearance }; answers the user as now stored.
  router.put('/preferences', sessionOnly, async (req, res, next) => {
    try {
      const body = req.body as Partial<PreferencesRequest> | null;
      const appearance = typeof body === 'object' && body !== null ? body.appearance : undefined;
      if (!APPEARANCES.includes(appearance as Appearance)) {
        throw new HttpError(400, ErrorCodes.validationFailed, 'appearance is system, light or dark');
      }
      const updated = await setAppearance(pool, caller(res).id, appearance as Appearance);
      if (!updated) throw new HttpError(401, ErrorCodes.unauthenticated, 'Sign in to continue');
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
