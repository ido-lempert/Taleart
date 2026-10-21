import type { ImportMediaFailure } from '@taleart/contract';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction, type Socket } from 'node:net';
import { retryAfterMs, type RetryPolicy } from './retry';

/**
 * Why a source media file was not copied. The message is written for the log
 * and never holds the URL, which may be signed or carry a secret.
 */
export class MediaFetchError extends Error {
  constructor(
    readonly reason: ImportMediaFailure,
    message: string,
    /** For `httpError`: the status the host answered, and its `Retry-After` in ms (null when none). */
    readonly reply?: { status: number; retryAfterMs: number | null },
  ) {
    super(message);
    this.name = 'MediaFetchError';
  }
}

/** One resolved address of a host name. */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** How media URLs from the source are fetched: the guard against requests to the inside. */
export interface MediaFetchPolicy {
  /**
   * Non-public endpoints the guard lets through, each an exact `address:port`
   * (`IMPORT_MEDIA_ALLOWED_ADDRESSES`, parsed by {@link parseAllowedAddresses}):
   * tests and local reviews against the fake server on 127.0.0.1. Empty by
   * default, so production reaches public addresses only.
   */
  allowedAddresses?: readonly string[];
  /** How long one download may take in all, redirects and body included; 120 s by default. */
  timeoutMs?: number;
  /** How long the connection may stay silent; 30 s by default. */
  idleTimeoutMs?: number;
  /** How long one host name lookup may take; 10 s by default. */
  dnsTimeoutMs?: number;
  /** How many redirects are followed; 3 by default. */
  maxRedirects?: number;
  /** How many media bytes one import may copy in all; 5 GB by default (`IMPORT_MEDIA_MAX_BYTES_PER_JOB`). */
  maxBytesPerJob?: number;
  /** How long one import may spend copying media; 60 min by default (`IMPORT_MEDIA_MAX_SECONDS_PER_JOB`). */
  maxMsPerJob?: number;
  /** Resolves a host name to all its addresses; DNS by default. Tests pass their own. */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Extra trusted certificate authorities for https; tests only (a local TLS server). */
  ca?: string | Buffer;
  /** How a download answered 429 or 5xx is tried again; the importer's default policy when absent. */
  retry?: Partial<RetryPolicy>;
  /**
   * Limits connections per host: a slot of each hop's host is taken before
   * connecting, and the previous hop's is released first (a redirect never
   * holds two), so the limit counts the host actually connected to. The last
   * hop's slot is held until the response is released.
   */
  hostSlots?: { acquire(host: string, signal?: AbortSignal): Promise<() => void> };
}

export const MEDIA_FETCH_TIMEOUT_MS = 120_000;
export const MEDIA_IDLE_TIMEOUT_MS = 30_000;
export const MEDIA_DNS_TIMEOUT_MS = 10_000;
export const MEDIA_MAX_REDIRECTS = 3;
export const MEDIA_MAX_BYTES_PER_JOB = 5 * 1024 ** 3;
export const MEDIA_MAX_MS_PER_JOB = 60 * 60_000;

// IPv4 is public unless it falls in a special-purpose range: this host,
// private networks, shared address space (CGNAT, which also holds some cloud
// metadata addresses), link-local (169.254.169.254), documentation and
// benchmark ranges, multicast, reserved space and broadcast.
const SPECIAL_V4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  SPECIAL_V4.addSubnet(net, prefix, 'ipv4');
}

// IPv6 is public only inside global unicast (2000::/3), and not in its
// special-purpose parts: Teredo and other IETF assignments in 2001::/23
// (2001::/32, 2001:2::/48, 2001:10::/28, 2001:20::/28), documentation
// (2001:db8::/32, 3fff::/20), 6to4 (2002::/16) and SRv6 SIDs (5f00::/16).
// Everything else, IPv4-mapped (::ffff:0:0/96), IPv4-translated
// (::ffff:0:0:0/96), NAT64 (64:ff9b::/96), loopback, link-local, unique-local
// and multicast among them, is outside 2000::/3 and so never public.
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');
const SPECIAL_V6 = new BlockList();
for (const [net, prefix] of [
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['::ffff:0:0:0', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
] as const) {
  SPECIAL_V6.addSubnet(net, prefix, 'ipv6');
}

// The family of a plain IP address; null for anything else, a zone id (`%eth0`) included.
function familyOf(address: string): 'ipv4' | 'ipv6' | null {
  if (address.includes('%')) return null;
  const version = isIP(address);
  return version === 4 ? 'ipv4' : version === 6 ? 'ipv6' : null;
}

/**
 * True only when `address` parses as an IP address of the public internet:
 * IPv4 outside the special-purpose ranges, or IPv6 in global unicast outside
 * its special-purpose ranges. Anything that does not parse is not public.
 */
export function isPublicAddress(address: string): boolean {
  const family = familyOf(address);
  if (family === 'ipv4') return !SPECIAL_V4.check(address, 'ipv4');
  if (family === 'ipv6') return GLOBAL_V6.check(address, 'ipv6') && !SPECIAL_V6.check(address, 'ipv6');
  return false;
}

/** An exempted endpoint: one address and one port. */
interface AllowedEndpoint {
  address: string;
  family: 'ipv4' | 'ipv6';
  port: number;
}

// `address:port` or `[v6]:port`, with a plain IP address that may name one host.
function parseEndpoint(item: string): AllowedEndpoint | null {
  const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(item) ?? /^([^:[\]]+):(\d{1,5})$/.exec(item);
  if (!match) return null;
  const [, address, portText] = match;
  const port = Number(portText);
  const family = familyOf(address);
  if (family === null || port < 1 || port > 65535) return null;
  // Not an endpoint of one host: unspecified, broadcast or multicast.
  const block = new BlockList();
  block.addSubnet('0.0.0.0', 32, 'ipv4');
  block.addSubnet('255.255.255.255', 32, 'ipv4');
  block.addSubnet('224.0.0.0', 4, 'ipv4');
  block.addSubnet('::', 128, 'ipv6');
  block.addSubnet('ff00::', 8, 'ipv6');
  if (block.check(address, family)) return null;
  return { address, family, port };
}

/**
 * Parses `IMPORT_MEDIA_ALLOWED_ADDRESSES`: comma-separated `address:port`
 * entries (`[v6]:port` for IPv6). Host names, ranges, entries without a port,
 * and unspecified, broadcast or multicast addresses are left out and returned
 * in `invalid`.
 */
export function parseAllowedAddresses(value: string | undefined): { addresses: string[]; invalid: string[] } {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return {
    addresses: items.filter((item) => parseEndpoint(item) !== null),
    invalid: items.filter((item) => parseEndpoint(item) === null),
  };
}

/** The policy's check of one endpoint: a public address, or an exempted `address:port`. */
type EndpointGuard = (address: string, port: number) => boolean;

function endpointGuard(allowed: readonly string[] = []): EndpointGuard {
  const endpoints = allowed.flatMap((item) => parseEndpoint(item) ?? []);
  return (address, port) => {
    if (isPublicAddress(address)) return true;
    const family = familyOf(address);
    if (family === null) return false;
    return endpoints.some((e) => {
      if (e.port !== port || e.family !== family) return false;
      const one = new BlockList();
      one.addAddress(e.address, e.family);
      return one.check(address, family);
    });
  };
}

const defaultLookup = async (hostname: string): Promise<ResolvedAddress[]> =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));

// Settles with `work`, or fails when the deadline or the signal comes first: a
// resolver that never answers cannot hold the import.
function bounded<T>(work: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = () => reject(new MediaFetchError('timeout', 'The media host name took too long to resolve'));
    const timer = setTimeout(timeout, ms);
    timer.unref?.();
    const onAbort = () => timeout();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) timeout();
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/** An opened media response: its status was 2xx. */
export interface MediaResponse {
  /** The `Content-Type` without parameters, lower-cased; null when absent. */
  contentType: string | null;
  /** The declared `Content-Length`, or null. */
  contentLength: number | null;
  /** The body. Read it before the signal's deadline; destroy it when done early. */
  body: IncomingMessage;
  /** Why the guard cut the connection (idle timeout, address check), once it has; null before. */
  failure(): MediaFetchError | null;
  /** Releases the host slot the response holds ({@link MediaFetchPolicy.hostSlots}); call it once the body is done. */
  release(): void;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// The URL as one we fetch, or an invalidUrl failure: http or https, a host, no credentials.
function parseMediaUrl(raw: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new MediaFetchError('invalidUrl', 'The media URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MediaFetchError('invalidUrl', 'The media URL is not an http or https URL');
  }
  if (url.username !== '' || url.password !== '') {
    throw new MediaFetchError('invalidUrl', 'The media URL carries credentials');
  }
  if (url.hostname === '') throw new MediaFetchError('invalidUrl', 'The media URL has no host');
  return url;
}

const portOf = (url: URL): number => (url.port !== '' ? Number(url.port) : url.protocol === 'https:' ? 443 : 80);

// Every address the host resolves to, each checked: one that fails refuses the URL.
async function checkedAddresses(
  url: URL,
  guard: EndpointGuard,
  lookup: (hostname: string) => Promise<ResolvedAddress[]>,
  dnsTimeoutMs: number,
  signal: AbortSignal,
): Promise<ResolvedAddress[]> {
  // URL keeps IPv6 hosts in brackets; IPv4 in any notation is already dotted-decimal.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const literal = familyOf(host);
  let addresses: ResolvedAddress[];
  if (literal !== null) {
    addresses = [{ address: host, family: literal === 'ipv6' ? 6 : 4 }];
  } else if (isIP(host) !== 0) {
    throw new MediaFetchError('invalidUrl', 'The media URL host is not a plain address');
  } else {
    try {
      addresses = await bounded(lookup(host), dnsTimeoutMs, signal);
    } catch (err) {
      if (err instanceof MediaFetchError) throw err;
      throw new MediaFetchError('unreachable', 'The media host name could not be resolved');
    }
    if (addresses.length === 0) throw new MediaFetchError('unreachable', 'The media host name has no address');
  }
  // Every address must pass, so a name that also points inside is refused whatever order DNS answers in.
  const port = portOf(url);
  if (!addresses.every(({ address }) => guard(address, port))) {
    throw new MediaFetchError('blockedAddress', 'The media URL leads to a private or non-public address');
  }
  return addresses;
}

/**
 * A lookup for the connection that hands it the checked addresses instead of
 * resolving the name again (DNS rebinding): every one of them when the
 * connection asks for all (happy eyeballs), else the first.
 */
export function pinnedLookup(targets: readonly ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (err: null, addresses: { address: string; family: number }[]) => void)(
        null,
        targets.map(({ address, family }) => ({ address, family })),
      );
    } else {
      callback(null, targets[0].address, targets[0].family);
    }
  };
}

// One GET, connected only to the addresses checked. The socket's peer is checked
// again once connected, so the connection cannot land anywhere else.
function getOnce(
  url: URL,
  targets: ResolvedAddress[],
  guard: EndpointGuard,
  policy: MediaFetchPolicy,
  signal: AbortSignal,
): Promise<{ res: IncomingMessage; failure: () => MediaFetchError | null }> {
  return new Promise((resolve, reject) => {
    const pinned = pinnedLookup(targets);
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    let req: ReturnType<typeof httpRequest>;
    try {
      req = request(url, {
        method: 'GET',
        // A fresh connection per request: no pooled socket to some other address, and no proxy.
        agent: false,
        lookup: pinned,
        signal,
        ...(policy.ca !== undefined ? { ca: policy.ca } : {}),
        headers: { Accept: 'image/*, video/*', 'Accept-Encoding': 'identity', 'User-Agent': 'TaleArt-importer' },
      });
    } catch {
      // Node's own message may quote the URL: never pass it on.
      reject(new MediaFetchError('invalidUrl', 'The media request could not be made'));
      return;
    }
    let failed: MediaFetchError | null = null;
    const fail = (err: MediaFetchError) => {
      failed = err;
      req.destroy(err);
    };
    req.setTimeout(policy.idleTimeoutMs ?? MEDIA_IDLE_TIMEOUT_MS, () =>
      fail(new MediaFetchError('timeout', 'The media host stopped answering')),
    );
    const port = portOf(url);
    req.on('socket', (socket: Socket) => {
      const check = () => {
        // A dual-stack socket names an IPv4 peer in its mapped form.
        const remote = (socket.remoteAddress ?? '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
        const pinnedOne = targets.some(({ address }) => address === remote);
        if (!pinnedOne || !guard(remote, socket.remotePort ?? port)) {
          fail(new MediaFetchError('blockedAddress', 'The media connection reached a non-public address'));
        }
      };
      if (socket.remoteAddress !== undefined && !socket.connecting) check();
      else socket.once('connect', check);
    });
    req.on('response', (res) => resolve({ res, failure: () => failed }));
    req.on('error', (err) => {
      if (failed) reject(failed);
      else if (signal.aborted) reject(new MediaFetchError('timeout', 'The media download took too long'));
      else
        reject(
          new MediaFetchError(
            'unreachable',
            `The media host could not be reached (${(err as NodeJS.ErrnoException).code ?? err.name})`,
          ),
        );
    });
    req.end();
  });
}

/**
 * Opens a source media URL under the policy: http or https only, every hop's
 * host checked to resolve only to public addresses (or exempted endpoints)
 * and connected only to those, redirects followed up to the policy's limit,
 * all within `signal`. Resolves to a 2xx response; anything else is a
 * {@link MediaFetchError}. No credential, cookie or token is ever sent.
 */
export async function openMedia(rawUrl: string, policy: MediaFetchPolicy, signal: AbortSignal): Promise<MediaResponse> {
  const guard = endpointGuard(policy.allowedAddresses);
  const lookup = policy.lookup ?? defaultLookup;
  const maxRedirects = policy.maxRedirects ?? MEDIA_MAX_REDIRECTS;
  const dnsTimeoutMs = policy.dnsTimeoutMs ?? MEDIA_DNS_TIMEOUT_MS;
  let url = parseMediaUrl(rawUrl);
  // The host slot held now: one hop's at a time, released before the next hop takes its own.
  let release: () => void = () => undefined;
  try {
    for (let redirects = 0; ; redirects++) {
      if (signal.aborted) throw new MediaFetchError('timeout', 'The media download took too long');
      release();
      release = () => undefined;
      if (policy.hostSlots) {
        try {
          release = await policy.hostSlots.acquire(url.host.toLowerCase(), signal);
        } catch {
          throw new MediaFetchError('timeout', 'The media download took too long');
        }
      }
      const targets = await checkedAddresses(url, guard, lookup, dnsTimeoutMs, signal);
      const { res, failure } = await getOnce(url, targets, guard, policy, signal);
      const status = res.statusCode ?? 0;
      if (REDIRECTS.has(status)) {
        const location = res.headers.location;
        res.destroy();
        if (!location) throw new MediaFetchError('httpError', `The media host answered ${status} without a location`);
        if (redirects >= maxRedirects) {
          throw new MediaFetchError('tooManyRedirects', 'The media URL redirects too many times');
        }
        url = parseMediaUrl(location, url);
        continue;
      }
      if (status < 200 || status > 299) {
        const retryAfter = retryAfterMs(res.headers['retry-after']);
        res.destroy();
        throw new MediaFetchError('httpError', `The media host answered ${status}`, {
          status,
          retryAfterMs: retryAfter,
        });
      }
      const type = res.headers['content-type'];
      const length = Number(res.headers['content-length']);
      const held = release;
      release = () => undefined;
      return {
        contentType: type ? type.split(';')[0].trim().toLowerCase() : null,
        contentLength:
          res.headers['content-length'] !== undefined && Number.isSafeInteger(length) && length >= 0 ? length : null,
        body: res,
        failure,
        release: held,
      };
    }
  } finally {
    release();
  }
}
