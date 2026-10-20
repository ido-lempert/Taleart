// Types only: nothing from the contract ends up in the bundle (AD-3).
import type { DeliveryZone, ErrorBody } from '@taleart/contract';

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

/**
 * Reads the zone of `zoneKey` from the Delivery API at `apiUrl`, with the key
 * as a bearer token and never a cookie. Throws {@link DeliveryError} for a
 * refused key, any other error status or a network failure.
 */
export async function fetchZone(
  apiUrl: string,
  zoneKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryZone> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}${DELIVERY_PATH}/zone`, {
      headers: { Authorization: `Bearer ${zoneKey}` },
      credentials: 'omit',
    });
  } catch (err) {
    throw new DeliveryError(`Could not reach the TaleArt API: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new DeliveryError(errorMessage(body) ?? `The TaleArt API answered ${res.status}`, res.status);
  }
  if (!isZone(body)) throw new DeliveryError('The TaleArt API sent a response that is not a zone', res.status);
  return body;
}

// True for the shape the renderers rely on; anything else (an HTML fallback page, a partial body) is a failure.
function isZone(body: unknown): body is DeliveryZone {
  const zone = body as Partial<DeliveryZone> | null;
  return (
    typeof zone === 'object' &&
    zone !== null &&
    Array.isArray(zone.frames) &&
    Array.isArray(zone.taleGroups) &&
    zone.taleGroups.every((g) => typeof g === 'object' && g !== null && Array.isArray(g.tales))
  );
}
