import { createHash } from 'node:crypto';
import express from 'express';

/** Where the API serves its OpenAPI document (epic developer experience 10.2). */
export const OPENAPI_DOCUMENT_PATH = '/api/openapi.json';

/** How long a client may keep the document before it revalidates, in seconds. */
export const OPENAPI_CACHE_SECONDS = 300;

/**
 * `GET /api/openapi.json`: the OpenAPI document (`libs/contract/openapi/openapi.yaml`, generated as
 * JSON by `contract:generate`), for the docs' API reference and any client generator. Public: no
 * session and no token is read, so any credential sent is ignored. Cacheable for five minutes, with a
 * strong ETag that a matching `If-None-Match` answers 304 for. Its relative servers (`/api/v1`,
 * `/delivery/v1`) resolve against this API's origin.
 */
export function openapiRouter(document: unknown): express.Router {
  const body = Buffer.from(JSON.stringify(document), 'utf8');
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;
  const router = express.Router();
  router.get('/', (req, res) => {
    res.setHeader('Cache-Control', `public, max-age=${OPENAPI_CACHE_SECONDS}`);
    res.setHeader('ETag', etag);
    const match = req.headers['if-none-match'];
    if (match && match.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag || tag.trim() === '*')) {
      res.status(304).end();
      return;
    }
    res.type('application/json').send(body);
  });
  return router;
}
