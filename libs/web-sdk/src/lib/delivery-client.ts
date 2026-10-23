// Types only: nothing from the contract ends up in the bundle (AD-3).
import type { DeliveryZone, ErrorBody } from '@taleart/contract';
import { VISITOR_HEADER, visitorId } from './visitor';

// The Delivery API base path (AD-2), as `DELIVERY_API_BASE` in the contract.
const DELIVERY_PATH = '/delivery/v1';

/** A refused or failed Delivery API call, with the API's message when it sent one. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

// The standard error body's message, or null for any other body.
function errorMessage(body: unknown): string | null {
  const error = (body as Partial<ErrorBody> | null)?.error;
  return typeof error?.message === 'string' ? error.message : null;
}

/** How an element names its zone: the project's site key with the zone's slug (epic UX rework R3). */
export interface ZoneRequest {
  /** The project's site key. */
  key: string;
  /** The zone's slug. */
  zone: string;
}

// A response read once and shared by every element that asked for the same zone at the same time.
interface SharedResponse {
  ok: boolean;
  status: number;
  text: string;
}

// The requests in flight, by URL and key: elements on one page that share a site key and a slug
// send one request. An entry leaves when its request settles, so a later load
// (after a change on the page) asks the API again.
const inFlight = new Map<string, Promise<SharedResponse>>();

/**
 * Reads a zone from the Delivery API at `apiUrl`, with the key as a bearer token and never a
 * cookie, the slug as the `zone` query parameter, and this browser's visitor id. Throws
 * {@link DeliveryError} for a refused key or slug, any other error status or a network failure.
 */
export async function fetchZone(
  apiUrl: string,
  request: ZoneRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryZone> {
  const url = `${apiUrl.replace(/\/+$/, '')}${DELIVERY_PATH}/zone?zone=${encodeURIComponent(request.zone)}`;
  const id = `${url}\n${request.key}`;
  let shared = inFlight.get(id);
  if (!shared) {
    const started = read(url, request.key, fetchImpl);
    shared = started;
    inFlight.set(id, started);
    const forget = () => {
      if (inFlight.get(id) === started) inFlight.delete(id);
    };
    started.then(forget, forget);
  }
  const res = await shared;
  // Each caller parses its own copy, so no element can change what another renders.
  let body: unknown = null;
  try {
    body = JSON.parse(res.text);
  } catch {
    // Not JSON: an HTML fallback page or an empty body.
  }
  if (!res.ok) {
    throw new DeliveryError(errorMessage(body) ?? `The TaleArt API answered ${res.status}`, res.status);
  }
  if (!isZone(body)) throw new DeliveryError('The TaleArt API sent a response that is not a zone', res.status);
  return body;
}

async function read(url: string, key: string, fetchImpl: typeof fetch): Promise<SharedResponse> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${key}`, [VISITOR_HEADER]: visitorId() },
      credentials: 'omit',
    });
  } catch (err) {
    throw new DeliveryError(`Could not reach the TaleArt API: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

// True for the shape the renderers rely on; anything else (an HTML fallback page, a partial body) is a failure.
function isZone(body: unknown): body is DeliveryZone {
  const zone = body as Partial<DeliveryZone> | null;
  return (
    typeof zone === 'object' &&
    zone !== null &&
    typeof zone.frame === 'object' &&
    Array.isArray(zone.taleGroups) &&
    zone.taleGroups.every((g) => typeof g === 'object' && g !== null && Array.isArray(g.tales))
  );
}
