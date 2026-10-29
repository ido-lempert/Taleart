// Types only: nothing from the contract ends up in the bundle (AD-3).
import type { ChoiceResult, InteractiveResponse, RatingResult, ReactionResult, ResponseResult } from '@taleart/contract';
import { DeliveryError, type ZoneRequest } from './delivery-client';
import { VISITOR_HEADER, visitorId } from './visitor';

/** The local storage key of this browser's answers to interactive components (C11), in the host page's origin. */
export const RESPONSES_STORAGE_KEY = 'taleart.responses';

/** The most answers kept; past it the oldest is forgotten. */
export const MAX_STORED_RESPONSES = 200;

/** A visitor's answer as the SDK keeps it: the stored value and the result the server answered then. */
export interface StoredResponse {
  value: string;
  /** A poll's counts and percentages per option, a Rating's count and average, or a Reaction's count per emoji. */
  result: ResponseResult;
}

/**
 * Sends and remembers a visitor's responses to the interactive components of one zone (epic
 * interactive components R9, C11). The viewer gives one to the document renderer; the Tale Studio
 * preview and side cards get none, so they never record anything.
 */
export interface ResponseClient {
  /** The visitor's answer kept on this device, or null. */
  stored(taleId: string, elementId: string): StoredResponse | null;
  /** Posts the answer, keeps what the server stored (the first answer wins, C9) and returns it. */
  send(taleId: string, elementId: string, value: string): Promise<StoredResponse>;
}

interface Kept {
  v: string;
  r: ResponseResult;
  t: number;
}

function readAll(): Record<string, Kept> {
  try {
    const parsed = JSON.parse(localStorage.getItem(RESPONSES_STORAGE_KEY) ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    // Only object entries: anything else (null, a number, written by hand or by another script) is dropped.
    const kept: Record<string, Kept> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) kept[key] = value as Kept;
    }
    return kept;
  } catch {
    // Missing, blocked or not JSON: nothing kept.
    return {};
  }
}

// True for a result a renderer can draw: counts and whole percentages per choice (a poll's), a count
// and an average (a Rating's), or a count per emoji (a Reaction's).
function isResult(value: unknown): value is ResponseResult {
  const result = value as Partial<ChoiceResult & RatingResult & ReactionResult> | null;
  if (typeof result !== 'object' || result === null || typeof result.total !== 'number') return false;
  if (Array.isArray(result.reactions)) {
    return result.reactions.every((r) => typeof r?.emoji === 'string' && typeof r.count === 'number');
  }
  return Array.isArray(result.choices)
    ? result.choices.every((c) => typeof c?.id === 'string' && typeof c.count === 'number' && typeof c.percent === 'number')
    : typeof result.average === 'number';
}

/** The answer this device keeps for the component, or null. */
export function storedResponse(taleId: string, elementId: string): StoredResponse | null {
  const kept = readAll()[`${taleId}:${elementId}`];
  return kept && typeof kept.v === 'string' && isResult(kept.r) ? { value: kept.v, result: kept.r } : null;
}

/** Keeps the answer on this device, forgetting the oldest past {@link MAX_STORED_RESPONSES}. */
export function keepResponse(taleId: string, elementId: string, response: StoredResponse): void {
  const all = readAll();
  all[`${taleId}:${elementId}`] = { v: response.value, r: response.result, t: Date.now() };
  const keys = Object.keys(all).sort((a, b) => (all[a].t ?? 0) - (all[b].t ?? 0));
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STORED_RESPONSES))) delete all[key];
  try {
    localStorage.setItem(RESPONSES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Full or blocked storage: the answer shows until the page is left.
  }
}

/**
 * The response client of the zone `request` (its zone key) at `apiUrl`: posts to
 * `POST /delivery/v1/responses` with the zone key and this device's visitor id (epic UX rework
 * 8.23), never a cookie. Throws {@link DeliveryError} for a refusal or a network failure.
 */
export function responseClient(apiUrl: string, request: ZoneRequest, fetchImpl: typeof fetch = fetch): ResponseClient {
  const url = `${apiUrl.replace(/\/+$/, '')}/delivery/v1/responses`;
  return {
    stored: storedResponse,
    async send(taleId, elementId, value) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${request.key}`,
            'Content-Type': 'application/json',
            [VISITOR_HEADER]: visitorId(),
          },
          body: JSON.stringify({ taleId, elementId, value, clientAt: new Date().toISOString() }),
          credentials: 'omit',
        });
      } catch (err) {
        throw new DeliveryError(`Could not reach the TaleArt API: ${err instanceof Error ? err.message : String(err)}`);
      }
      const body = (await res.json().catch(() => null)) as Partial<InteractiveResponse> | null;
      if (!res.ok || typeof body?.value !== 'string' || !isResult(body.result)) {
        throw new DeliveryError(`The TaleArt API answered ${res.status}`, res.status);
      }
      const response = { value: body.value, result: body.result };
      keepResponse(taleId, elementId, response);
      return response;
    },
  };
}
