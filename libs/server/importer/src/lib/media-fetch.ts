import type { ImportMediaFailure } from '@taleart/contract';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction, type Socket } from 'node:net';

/**
 * Why a source media file was not copied. The message is written for the log
 * and never holds the URL, which may be signed or carry a secret.
 */
export class MediaFetchError extends Error {
  constructor(
    readonly reason: ImportMediaFailure,
    message: string,
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
   * IP addresses exempt from the private-address check, exactly as listed
   * (`IMPORT_MEDIA_ALLOWED_ADDRESSES`): tests and local reviews against the
   * fake server on localhost. Empty by default, so production allows none.
   */
  allowedAddresses?: readonly string[];
  /** How long one download may take in all, redirects and body included; 120 s by default. */
  timeoutMs?: number;
  /** How long the connection may stay silent; 30 s by default. */
  idleTimeoutMs?: number;
  /** How many redirects are followed; 3 by default. */
  maxRedirects?: number;
  /** Resolves a host name to all its addresses; DNS by default. Tests pass their own. */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
}

export const MEDIA_FETCH_TIMEOUT_MS = 120_000;
export const MEDIA_IDLE_TIMEOUT_MS = 30_000;
export const MEDIA_MAX_REDIRECTS = 3;

// Every range that is not the public internet: this host, private networks,
// shared address space (CGNAT, which also holds some cloud metadata
// addresses), link-local (169.254.169.254, the usual metadata address),
// documentation and benchmark ranges, multicast and reserved space. An
// IPv4-mapped IPv6 address (::ffff:a.b.c.d) is checked against the IPv4 ranges
// (BlockList maps it); the other IPv6 forms that carry an IPv4 address
// (compatible, NAT64, 6to4, Teredo) are refused whole rather than unpacked.
const BLOCKED = new BlockList();
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
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}
// IPv4-compatible IPv6 (::a.b.c.d, deprecated) and the rest of ::/96.
BLOCKED.addSubnet('::', 96, 'ipv6');

const familyOf = (address: string): 'ipv4' | 'ipv6' | null => {
  const version = isIP(address);
  return version === 4 ? 'ipv4' : version === 6 ? 'ipv6' : null;
};

/** True when `address` is an IP address outside the public internet (or not an IP address at all). */
export function isNonPublicAddress(address: string): boolean {
  const family = familyOf(address);
  return family === null || BLOCKED.check(address, family);
}

/** The policy's check of one address: public, or listed as allowed. */
function addressGuard(
  allowed: readonly string[] = [],
): (address: string) => boolean {
  const allow = new BlockList();
  for (const address of allowed) {
    const family = familyOf(address);
    if (family !== null) allow.addAddress(address, family);
  }
  return (address) => {
    const family = familyOf(address);
    if (family === null) return false;
    return allow.check(address, family) || !BLOCKED.check(address, family);
  };
}

/**
 * Parses `IMPORT_MEDIA_ALLOWED_ADDRESSES`: comma-separated IP addresses. A
 * value that is not an IP address is left out and returned in `invalid`.
 */
export function parseAllowedAddresses(value: string | undefined): {
  addresses: string[];
  invalid: string[];
} {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return {
    addresses: items.filter((item) => isIP(item) !== 0),
    invalid: items.filter((item) => isIP(item) === 0),
  };
}

const defaultLookup = async (hostname: string): Promise<ResolvedAddress[]> =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map(
    ({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    }),
  );

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
    throw new MediaFetchError(
      'invalidUrl',
      'The media URL is not an http or https URL',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new MediaFetchError(
      'invalidUrl',
      'The media URL carries credentials',
    );
  }
  if (url.hostname === '')
    throw new MediaFetchError('invalidUrl', 'The media URL has no host');
  return url;
}

// The host's address to connect to, after checking every address it resolves to.
async function checkedAddress(
  url: URL,
  allowedAddress: (address: string) => boolean,
  lookup: (hostname: string) => Promise<ResolvedAddress[]>,
): Promise<ResolvedAddress> {
  // URL keeps IPv6 hosts in brackets; IPv4 in any notation is already dotted-decimal.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const literal = isIP(host);
  let addresses: ResolvedAddress[];
  if (literal !== 0) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new MediaFetchError(
        'unreachable',
        'The media host name could not be resolved',
      );
    }
    if (addresses.length === 0)
      throw new MediaFetchError(
        'unreachable',
        'The media host name has no address',
      );
  }
  // Every address must pass, so a name that also points inside is refused whatever order DNS answers in.
  if (!addresses.every(({ address }) => allowedAddress(address))) {
    throw new MediaFetchError(
      'blockedAddress',
      'The media URL leads to a private or non-public address',
    );
  }
  return addresses[0];
}

// One GET, connected to the checked address only. The socket's remote address is
// checked again once connected, so the connection cannot land anywhere else.
function getOnce(
  url: URL,
  target: ResolvedAddress,
  allowedAddress: (address: string) => boolean,
  idleTimeoutMs: number,
  signal: AbortSignal,
): Promise<{ res: IncomingMessage; failure: () => MediaFetchError | null }> {
  return new Promise((resolve, reject) => {
    // Hands the already checked address to the connection instead of resolving the name again (DNS rebinding).
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if ((options as { all?: boolean }).all) {
        (
          callback as unknown as (
            err: null,
            addresses: { address: string; family: number }[],
          ) => void
        )(null, [{ address: target.address, family: target.family }]);
      } else {
        callback(null, target.address, target.family);
      }
    };
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    let req: ReturnType<typeof httpRequest>;
    try {
      req = request(url, {
        method: 'GET',
        // A fresh connection per request: no pooled socket to some other address, and no proxy.
        agent: false,
        lookup: pinned,
        signal,
        headers: {
          Accept: 'image/*, video/*',
          'Accept-Encoding': 'identity',
          'User-Agent': 'TaleArt-importer',
        },
      });
    } catch {
      // Node's own message may quote the URL: never pass it on.
      reject(
        new MediaFetchError(
          'invalidUrl',
          'The media request could not be made',
        ),
      );
      return;
    }
    let failed: MediaFetchError | null = null;
    const fail = (err: MediaFetchError) => {
      failed = err;
      req.destroy(err);
    };
    req.setTimeout(idleTimeoutMs, () =>
      fail(new MediaFetchError('timeout', 'The media host stopped answering')),
    );
    req.on('socket', (socket: Socket) => {
      const check = () => {
        // A dual-stack socket may name an IPv4 peer in its mapped form.
        const remote = socket.remoteAddress?.replace(
          /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i,
          '$1',
        );
        if (remote === undefined || !allowedAddress(remote)) {
          fail(
            new MediaFetchError(
              'blockedAddress',
              'The media connection reached a non-public address',
            ),
          );
        }
      };
      if (socket.remoteAddress !== undefined && !socket.connecting) check();
      else socket.once('connect', check);
    });
    req.on('response', (res) => resolve({ res, failure: () => failed }));
    req.on('error', (err) => {
      if (failed) reject(failed);
      else if (signal.aborted)
        reject(
          new MediaFetchError('timeout', 'The media download took too long'),
        );
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
 * host checked to resolve to public addresses (or allowed ones) and connected
 * to the checked address, redirects followed up to the policy's limit, all
 * within `signal`. Resolves to a 2xx response; anything else is a
 * {@link MediaFetchError}. No credential, cookie or token is ever sent.
 */
export async function openMedia(
  rawUrl: string,
  policy: MediaFetchPolicy,
  signal: AbortSignal,
): Promise<MediaResponse> {
  const allowedAddress = addressGuard(policy.allowedAddresses);
  const lookup = policy.lookup ?? defaultLookup;
  const maxRedirects = policy.maxRedirects ?? MEDIA_MAX_REDIRECTS;
  const idleTimeoutMs = policy.idleTimeoutMs ?? MEDIA_IDLE_TIMEOUT_MS;
  let url = parseMediaUrl(rawUrl);
  for (let redirects = 0; ; redirects++) {
    if (signal.aborted)
      throw new MediaFetchError('timeout', 'The media download took too long');
    const target = await checkedAddress(url, allowedAddress, lookup);
    const { res, failure } = await getOnce(
      url,
      target,
      allowedAddress,
      idleTimeoutMs,
      signal,
    );
    const status = res.statusCode ?? 0;
    if (REDIRECTS.has(status)) {
      const location = res.headers.location;
      res.destroy();
      if (!location)
        throw new MediaFetchError(
          'httpError',
          `The media host answered ${status} without a location`,
        );
      if (redirects >= maxRedirects)
        throw new MediaFetchError(
          'tooManyRedirects',
          'The media URL redirects too many times',
        );
      url = parseMediaUrl(location, url);
      continue;
    }
    if (status < 200 || status > 299) {
      res.destroy();
      throw new MediaFetchError(
        'httpError',
        `The media host answered ${status}`,
      );
    }
    const type = res.headers['content-type'];
    const length = Number(res.headers['content-length']);
    return {
      contentType: type ? type.split(';')[0].trim().toLowerCase() : null,
      contentLength:
        res.headers['content-length'] !== undefined &&
        Number.isSafeInteger(length) &&
        length >= 0
          ? length
          : null,
      body: res,
      failure,
    };
  }
}
