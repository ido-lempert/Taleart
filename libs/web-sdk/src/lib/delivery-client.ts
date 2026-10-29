// Types and the header name only from the contract (AD-3).
import { EXTERNAL_USER_ID_HEADER, type DeliveryZone, type ErrorBody } from '@taleart/contract';
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

/** How an element names its zone: the zone key (`tak_…`), which names one zone. */
export interface ZoneRequest {
  /** The zone key, sent as the bearer token. */
  key: string;
}

// A response read once and shared by every element that asked for the same zone at the same time.
interface SharedResponse {
  ok: boolean;
  status: number;
  text: string;
}

// The requests in flight, by URL, key and external user ID header: elements on one page that share
// a zone key and a viewer send one request. An entry leaves when its request settles, so a later load
// (after a change on the page) asks the API again.
const inFlight = new Map<string, Promise<SharedResponse>>();

/**
 * Reads the zone of `request` from the Delivery API at `apiUrl` (`GET /delivery/v1/zone`), with the
 * zone key as a bearer token and never a cookie, and this browser's visitor id. With
 * `externalUserIdHeader` (the viewer's external user ID, already encoded), it is sent in its own
 * header, never in the URL, and the browser is told to keep no copy (epic targeting R4, R5). Throws
 * {@link DeliveryError} for a refused key or slug, any other error status or a network failure.
 */
export async function fetchZone(
  apiUrl: string,
  request: ZoneRequest,
  fetchImpl: typeof fetch = fetch,
  externalUserIdHeader: string | null = null,
): Promise<DeliveryZone> {
  const url = `${apiUrl.replace(/\/+$/, '')}${DELIVERY_PATH}/zone`;
  const id = `${url}\n${request.key}\n${externalUserIdHeader ?? ''}`;
  let shared = inFlight.get(id);
  if (!shared) {
    const started = read(url, request.key, fetchImpl, externalUserIdHeader);
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

async function read(
  url: string,
  key: string,
  fetchImpl: typeof fetch,
  externalUserIdHeader: string | null,
): Promise<SharedResponse> {
  let res: Response;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, [VISITOR_HEADER]: visitorId() };
  const init: RequestInit = { headers, credentials: 'omit' };
  if (externalUserIdHeader !== null) {
    headers[EXTERNAL_USER_ID_HEADER] = externalUserIdHeader;
    // A per-viewer answer is never kept by the browser either (the API answers no-store too).
    init.cache = 'no-store';
  }
  try {
    res = await fetchImpl(url, init);
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
