import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorage } from '@taleart/server-storage';
import type { TransactionalDb } from '@taleart/server-access';
import { copyMedia, importTaleMedia, sourceMediaDigest, type TaleMediaImport } from './media-copy';
import { CommitUncertainError } from './transaction';
import {
  isPublicAddress,
  MediaFetchError,
  pinnedLookup,
  openMedia,
  parseAllowedAddresses,
  type MediaFetchPolicy,
} from './media-fetch';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 3)]);

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

// A local media host: each test sets its routes; every request is counted.
let server: Server;
let origin: string;
let port: number;
let routes: Record<string, Handler> = {};
let hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    const route = routes[req.url ?? ''];
    if (route) route(req, res);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  routes = {};
  hits = [];
});

// The local media host's endpoint, exempted exactly, as IMPORT_MEDIA_ALLOWED_ADDRESSES would.
const local = (): MediaFetchPolicy => ({ allowedAddresses: [`127.0.0.1:${port}`] });
const signal = () => AbortSignal.timeout(5000);
const file =
  (type: string, data: Buffer, extra: Record<string, string> = {}): Handler =>
  (_req, res) => {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': String(data.length),
      ...extra,
    });
    res.end(data);
  };
const redirect =
  (location: string): Handler =>
  (_req, res) => {
    res.writeHead(302, { Location: location }).end();
  };

async function failure(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(MediaFetchError);
  return (err as MediaFetchError).reason;
}

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fe80::1%eth0',
    '2606:4700:4700::1111%1',
    'fc00::1',
    'fd00:ec2::254',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:8.8.8.8',
    '::ffff:0:808:808',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '64:ff9b:1::1',
    '100::1',
    '2001:0:4136:e378::1',
    '2001:2::1',
    '2001:10::1',
    '2001:1f::1',
    '2001:20::1',
    '2001:2f::1',
    '2001:db8::1',
    '2002:7f00:1::1',
    '3fff::1',
    '3fff:fff::1',
    '5f00::1',
    '4000::1',
    'ff02::1',
    'localhost',
    'not an address',
    '',
  ])('refuses %j', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4001::200e',
    '2001:30::1',
  ])('accepts the public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('parseAllowedAddresses', () => {
  it('keeps exact address:port entries and lists the rest as invalid; empty allows none', () => {
    expect(
      parseAllowedAddresses(
        ' 127.0.0.1:4400, [::1]:4400 ,,127.0.0.1, localhost:4400, 10.0.0.0/8:80, 0.0.0.0:80, [::]:80, 255.255.255.255:80, 224.0.0.1:80, [ff02::1]:80, 127.0.0.1:0, 127.0.0.1:70000, [fe80::1%eth0]:80',
      ),
    ).toEqual({
      addresses: ['127.0.0.1:4400', '[::1]:4400'],
      invalid: [
        '127.0.0.1',
        'localhost:4400',
        '10.0.0.0/8:80',
        '0.0.0.0:80',
        '[::]:80',
        '255.255.255.255:80',
        '224.0.0.1:80',
        '[ff02::1]:80',
        '127.0.0.1:0',
        '127.0.0.1:70000',
        '[fe80::1%eth0]:80',
      ],
    });
    expect(parseAllowedAddresses(undefined)).toEqual({ addresses: [], invalid: [] });
  });
});

describe('pinnedLookup', () => {
  it('hands the connection every checked address when it asks for all, else the first', () => {
    const targets = [
      { address: '2606:4700:4700::1111', family: 6 as const },
      { address: '93.184.216.34', family: 4 as const },
    ];
    const lookup = pinnedLookup(targets);
    const all = vi.fn();
    lookup('media.test', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, targets);
    const one = vi.fn();
    lookup('media.test', {}, one);
    expect(one).toHaveBeenCalledWith(null, '2606:4700:4700::1111', 6);
  });
});

describe('openMedia: the guard', () => {
  it('opens an allowed address and reports type and length', async () => {
    routes['/a.png'] = file('image/png; charset=binary', PNG);
    const res = await openMedia(`${origin}/a.png`, local(), signal());
    expect(res.contentType).toBe('image/png');
    expect(res.contentLength).toBe(PNG.length);
    res.body.destroy();
  });

  it.each([
    ['ftp://127.0.0.1/a.png'],
    ['file:///etc/passwd'],
    ['data:image/png;base64,iVBORw0KGgo='],
    ['javascript:alert(1)'],
    ['http://user:secret@127.0.0.1/a.png'],
    ['not a url'],
    [''],
  ])('refuses %j as invalidUrl without a request', async (url) => {
    expect(await failure(openMedia(url, local(), signal()))).toBe('invalidUrl');
    expect(hits).toEqual([]);
  });

  it('refuses loopback, by name or in any notation, unless the exact address is allowed', async () => {
    routes['/a.png'] = file('image/png', PNG);
    for (const url of [
      `${origin}/a.png`,
      `http://2130706433:${port}/a.png`,
      `http://0x7f.1:${port}/a.png`,
      `http://[::1]:${port}/a.png`,
    ]) {
      expect(await failure(openMedia(url, {}, signal()))).toBe('blockedAddress');
    }
    // Allowing 127.0.0.1 does not allow ::1.
    expect(await failure(openMedia(`http://[::1]:${port}/a.png`, local(), signal()))).toBe('blockedAddress');
    expect(hits).toEqual([]);
  });

  it('refuses a host name that resolves to any non-public address, in whatever order', async () => {
    const answers = [
      [{ address: '10.0.0.5', family: 4 as const }],
      [
        { address: '93.184.216.34', family: 4 as const },
        { address: '169.254.169.254', family: 4 as const },
      ],
      [{ address: 'fd00::1', family: 6 as const }],
    ];
    for (const answer of answers) {
      const lookup = vi.fn(async () => answer);
      expect(await failure(openMedia('http://media.test/a.png', { lookup }, signal()))).toBe('blockedAddress');
      expect(lookup).toHaveBeenCalledWith('media.test');
    }
  });

  it('connects to the address it checked and resolves the name once (no DNS rebinding)', async () => {
    routes['/a.png'] = file('image/png', PNG);
    // A rebinding name: allowed the first time, private after.
    const answers = [[{ address: '127.0.0.1', family: 4 as const }], [{ address: '10.0.0.1', family: 4 as const }]];
    const lookup = vi.fn(async () => answers.shift() ?? []);
    const res = await openMedia(`http://media.test:${port}/a.png`, { ...local(), lookup }, signal());
    res.body.destroy();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(hits).toEqual(['/a.png']);
  });

  it('turns a name that does not resolve and a refused connection into unreachable', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND media.test');
    });
    expect(await failure(openMedia('http://media.test/a.png', { lookup }, signal()))).toBe('unreachable');
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', () => resolve()));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(
      await failure(
        openMedia(`http://127.0.0.1:${closedPort}/a.png`, { allowedAddresses: [`127.0.0.1:${closedPort}`] }, signal()),
      ),
    ).toBe('unreachable');
  });

  it('follows a redirect, checking each hop: a private hop is refused before it is requested', async () => {
    routes['/moved.png'] = redirect('/a.png');
    routes['/a.png'] = file('image/png', PNG);
    const res = await openMedia(`${origin}/moved.png`, local(), signal());
    res.body.destroy();
    expect(hits).toEqual(['/moved.png', '/a.png']);

    routes['/meta.png'] = redirect('http://169.254.169.254/latest/meta-data/');
    expect(await failure(openMedia(`${origin}/meta.png`, local(), signal()))).toBe('blockedAddress');
    routes['/v6.png'] = redirect(`http://[::1]:${port}/a.png`);
    expect(await failure(openMedia(`${origin}/v6.png`, local(), signal()))).toBe('blockedAddress');
    routes['/scheme.png'] = redirect('file:///etc/passwd');
    expect(await failure(openMedia(`${origin}/scheme.png`, local(), signal()))).toBe('invalidUrl');
  });

  it('stops after the redirect limit, and refuses an error status or a redirect without a location', async () => {
    routes['/loop.png'] = redirect('/loop.png');
    expect(await failure(openMedia(`${origin}/loop.png`, { ...local(), maxRedirects: 2 }, signal()))).toBe(
      'tooManyRedirects',
    );
    expect(hits).toHaveLength(3);
    expect(await failure(openMedia(`${origin}/missing.png`, local(), signal()))).toBe('httpError');
    routes['/nowhere.png'] = (_req, res) => res.writeHead(301).end();
    expect(await failure(openMedia(`${origin}/nowhere.png`, local(), signal()))).toBe('httpError');
  });

  it('sends no credential, cookie or token', async () => {
    let headers: IncomingMessage['headers'] = {};
    routes['/a.png'] = (req, res) => {
      headers = req.headers;
      file('image/png', PNG)(req, res);
    };
    (await openMedia(`${origin}/a.png`, local(), signal())).body.destroy();
    expect(headers['authorization']).toBeUndefined();
    expect(headers['cookie']).toBeUndefined();
  });
});

describe('copyMedia', () => {
  let root: string;
  let storage: LocalDiskStorage;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'taleart-import-media-'));
    storage = new LocalDiskStorage(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const stored = () => (existsSync(join(root, 'tales')) ? readdirSync(join(root, 'tales')) : []);

  it('streams an accepted file into storage under a new key, with its hash', async () => {
    routes['/a.png'] = file('image/png', PNG);
    const copied = await copyMedia(storage, `${origin}/a.png`, 'image/jpeg', local());
    expect(copied.key).toMatch(/^tales\/imported-[0-9a-f-]{36}\.png$/);
    expect(copied.contentType).toBe('image/png');
    expect(copied.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(await storage.get(copied.key)).toEqual(PNG);
  });

  it("takes the story's mime_type when the host names only a generic type or none", async () => {
    routes['/octet'] = file('application/octet-stream', JPEG);
    expect((await copyMedia(storage, `${origin}/octet`, 'image/jpeg', local())).contentType).toBe('image/jpeg');
    routes['/none'] = (_req, res) => {
      res.removeHeader('Content-Type');
      res.end(JPEG);
    };
    expect((await copyMedia(storage, `${origin}/none`, 'image/jpeg', local())).contentType).toBe('image/jpeg');
    expect(await failure(copyMedia(storage, `${origin}/octet`, null, local()))).toBe('unsupportedType');
    expect(stored()).toHaveLength(2);
  });

  it('refuses a type that is not accepted, and bytes that do not match the declared type', async () => {
    routes['/page'] = file('text/html', Buffer.from('<!doctype html>'));
    routes['/fake.png'] = file('image/png', JPEG);
    routes['/empty.png'] = file('image/png', Buffer.alloc(0));
    routes['/short.png'] = file('image/png', PNG.subarray(0, 3));
    for (const path of ['/page', '/fake.png', '/empty.png', '/short.png']) {
      expect(await failure(copyMedia(storage, `${origin}${path}`, 'image/png', local()))).toBe('unsupportedType');
    }
    expect(stored()).toEqual([]);
  });

  it('checks the leading bytes when they arrive one at a time', async () => {
    routes['/slow.png'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      let at = 0;
      const next = () => {
        if (at >= PNG.length) {
          res.end();
          return;
        }
        res.write(PNG.subarray(at, at + 1));
        at++;
        setImmediate(next);
      };
      next();
    };
    const copied = await copyMedia(storage, `${origin}/slow.png`, null, local());
    expect(await storage.get(copied.key)).toEqual(PNG);
  });

  it('refuses a declared length over the limit before reading, and cuts a stream at the limit', async () => {
    routes['/declared.png'] = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': String(10 * 1024 * 1024 + 1),
      });
      res.write(PNG);
    };
    expect(await failure(copyMedia(storage, `${origin}/declared.png`, null, local()))).toBe('tooLarge');
    routes['/endless.png'] = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      const chunk = Buffer.alloc(256 * 1024, 1);
      PNG.copy(chunk);
      let open = true;
      req.on('close', () => (open = false));
      const pump = () => {
        while (open && res.write(chunk));
        if (open) res.once('drain', pump);
      };
      pump();
    };
    expect(await failure(copyMedia(storage, `${origin}/endless.png`, null, local()))).toBe('tooLarge');
    expect(stored()).toEqual([]);
  });

  it('times out a silent host and a download that takes too long, leaving nothing stored', async () => {
    routes['/silent.png'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.write(PNG.subarray(0, 4));
    };
    expect(
      await failure(
        copyMedia(storage, `${origin}/silent.png`, null, {
          ...local(),
          idleTimeoutMs: 100,
        }),
      ),
    ).toBe('timeout');
    routes['/trickle.png'] = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.write(PNG);
      const timer = setInterval(() => res.write(Buffer.from([0])), 20);
      req.on('close', () => clearInterval(timer));
    };
    expect(
      await failure(
        copyMedia(storage, `${origin}/trickle.png`, null, {
          ...local(),
          timeoutMs: 200,
        }),
      ),
    ).toBe('timeout');
    expect(stored()).toEqual([]);
  });

  it('passes a storage failure on as it is', async () => {
    routes['/a.png'] = file('image/png', PNG);
    const broken = Object.assign(Object.create(storage) as LocalDiskStorage, {
      putStream: async () => {
        throw new Error('disk full');
      },
    });
    const err = await copyMedia(broken, `${origin}/a.png`, null, local()).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(MediaFetchError);
    expect((err as Error).message).toBe('disk full');
  });

  it('never puts the URL in its failure messages', async () => {
    const url = `${origin}/missing.png?signature=very-secret`;
    const err = (await copyMedia(storage, url, null, local()).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('very-secret');
    expect(err.message).not.toContain(origin);
  });
});

describe('importTaleMedia', () => {
  const db = { query: vi.fn(), connect: vi.fn() } as unknown as TransactionalDb;
  const media: TaleMediaImport = {
    storage: new LocalDiskStorage(tmpdir()),
    copy: vi.fn(),
  };

  it('does nothing for a story without media, and refuses a media value that is not text', async () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(await importTaleMedia(db, media, 'p', 't', { media: value })).toEqual({ kind: 'none' });
    }
    expect(await importTaleMedia(db, media, 'p', 't', { media: { url: 'x' } })).toEqual({
      kind: 'failed',
      reason: 'invalidUrl',
      keptEarlier: false,
    });
    expect(media.copy).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('openMedia: exempted endpoints, DNS and HTTPS', () => {
  it('lets through an exempted address only on its exact port', async () => {
    routes['/a.png'] = file('image/png', PNG);
    const otherPort = { allowedAddresses: [`127.0.0.1:${port + 1}`] };
    expect(await failure(openMedia(`${origin}/a.png`, otherPort, signal()))).toBe('blockedAddress');
    const wholeHost = { allowedAddresses: ['127.0.0.1'] };
    expect(await failure(openMedia(`${origin}/a.png`, wholeHost, signal()))).toBe('blockedAddress');
    expect(hits).toEqual([]);
    (await openMedia(`${origin}/a.png`, local(), signal())).body.destroy();
    expect(hits).toEqual(['/a.png']);
  });

  it('gives up on a resolver that never answers, at the DNS deadline or the download deadline', async () => {
    const hanging = vi.fn(() => new Promise<never>(() => undefined));
    const began = Date.now();
    expect(await failure(openMedia('http://media.test/a.png', { lookup: hanging, dnsTimeoutMs: 50 }, signal()))).toBe(
      'timeout',
    );
    expect(Date.now() - began).toBeLessThan(2000);
    expect(await failure(openMedia('http://media.test/a.png', { lookup: hanging }, AbortSignal.timeout(50)))).toBe(
      'timeout',
    );
  });

  describe('over https', () => {
    const tlsDir = join(__dirname, 'test-tls');
    const cert = readFileSync(join(tlsDir, 'cert.pem'));
    const key = readFileSync(join(tlsDir, 'key.pem'));
    let tlsServer: HttpsServer;
    let tlsPort: number;
    let seen: { servername: string | false | null; host: string | undefined }[] = [];

    beforeAll(async () => {
      tlsServer = createHttpsServer({ cert, key }, (req, res) => {
        seen.push({ servername: (req.socket as TLSSocket).servername, host: req.headers.host });
        file('image/png', PNG)(req, res);
      });
      await new Promise<void>((resolve) => tlsServer.listen(0, '127.0.0.1', () => resolve()));
      tlsPort = (tlsServer.address() as AddressInfo).port;
    });

    afterAll(async () => {
      tlsServer.closeAllConnections();
      await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
    });

    beforeEach(() => {
      seen = [];
    });

    // The test certificate names media.test; it is trusted only through the policy's test-only `ca`.
    const lookup = async () => [{ address: '127.0.0.1', family: 4 as const }];

    it('connects to the pinned address while SNI and Host keep the host name', async () => {
      const policy = { allowedAddresses: [`127.0.0.1:${tlsPort}`], lookup, ca: cert };
      const res = await openMedia(`https://media.test:${tlsPort}/a.png`, policy, signal());
      expect(res.contentType).toBe('image/png');
      res.body.destroy();
      expect(seen).toEqual([{ servername: 'media.test', host: `media.test:${tlsPort}` }]);
    });

    it('still verifies the certificate, and still applies the guard', async () => {
      const untrusted = { allowedAddresses: [`127.0.0.1:${tlsPort}`], lookup };
      expect(await failure(openMedia(`https://media.test:${tlsPort}/a.png`, untrusted, signal()))).toBe('unreachable');
      const notExempted = { lookup, ca: cert };
      expect(await failure(openMedia(`https://media.test:${tlsPort}/a.png`, notExempted, signal()))).toBe(
        'blockedAddress',
      );
      const privateName = { lookup: async () => [{ address: '10.0.0.7', family: 4 as const }], ca: cert };
      expect(await failure(openMedia(`https://media.test:${tlsPort}/a.png`, privateName, signal()))).toBe(
        'blockedAddress',
      );
      expect(seen).toEqual([]);
    });
  });
});

describe('copyMedia: the per-import budget', () => {
  let root: string;
  let storage: LocalDiskStorage;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'taleart-import-budget-'));
    storage = new LocalDiskStorage(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const stored = () => (existsSync(join(root, 'tales')) ? readdirSync(join(root, 'tales')) : []);

  it('takes the bytes read from the budget, and stops a download that would pass it', async () => {
    routes['/a.png'] = file('image/png', PNG);
    const budget = { bytesLeft: PNG.length + 10, deadline: Date.now() + 60_000 };
    await copyMedia(storage, `${origin}/a.png`, null, local(), budget);
    expect(budget.bytesLeft).toBe(10);
    // Declared too long for what is left: refused before reading.
    expect(await failure(copyMedia(storage, `${origin}/a.png`, null, local(), budget))).toBe('jobBudgetExceeded');
    // No length declared: cut while streaming, nothing stored.
    routes['/chunked.png'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG);
    };
    expect(await failure(copyMedia(storage, `${origin}/chunked.png`, null, local(), budget))).toBe('jobBudgetExceeded');
    expect(stored()).toHaveLength(1);
    expect(budget.bytesLeft).toBeLessThanOrEqual(0);
    // Spent: the next media is not even requested.
    hits = [];
    expect(await failure(copyMedia(storage, `${origin}/a.png`, null, local(), budget))).toBe('jobBudgetExceeded');
    expect(hits).toEqual([]);
  });

  it('stops at the import media deadline, before a request or during one', async () => {
    routes['/a.png'] = file('image/png', PNG);
    const past = { bytesLeft: 1e9, deadline: Date.now() - 1 };
    expect(await failure(copyMedia(storage, `${origin}/a.png`, null, local(), past))).toBe('jobBudgetExceeded');
    expect(hits).toEqual([]);
    routes['/trickle.png'] = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.write(PNG);
      const timer = setInterval(() => res.write(Buffer.from([0])), 20);
      req.on('close', () => clearInterval(timer));
    };
    const budget = { bytesLeft: 1e9, deadline: Date.now() + 200 };
    expect(await failure(copyMedia(storage, `${origin}/trickle.png`, null, local(), budget))).toBe('jobBudgetExceeded');
    expect(stored()).toEqual([]);
  });
});

describe('importTaleMedia: writing the tale', () => {
  const taleId = '00000000-0000-4000-8000-0000000000aa';
  const copied = { key: 'tales/imported-new.jpg', contentType: 'image/jpeg' as const, sha256: 'abc' };

  // A fake pool: each statement is answered by `answer`; COMMIT may fail.
  function fakeDb(answer: (sql: string) => unknown, commitFails = false) {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'COMMIT' && commitFails) throw new Error('connection lost during commit');
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      return answer(sql) ?? { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    return { db: { query, connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionalDb, query };
  }
  const storage = () => ({ put: vi.fn(), putStream: vi.fn(), get: vi.fn(), delete: vi.fn(async () => undefined) });

  it('keeps media a person set meanwhile, deleting only its own copy', async () => {
    let checked = false;
    const { db, query } = fakeDb((sql) => {
      if (/SELECT media_key AS key/.test(sql)) {
        // Empty at the first check; the upload is there by the time the import writes.
        const rows = checked
          ? [{ key: 'tales/upload.png', contentType: 'image/png' }]
          : [{ key: null, contentType: null }];
        checked = true;
        return { rows };
      }
      if (/UPDATE tales SET media_key/.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT 1 FROM tales/.test(sql)) return { rows: [{}] };
      if (/FROM import_media/.test(sql)) return { rows: [] };
      return undefined;
    });
    const store = storage();
    const outcome = await importTaleMedia(db, { storage: store, copy: async () => copied }, 'p', taleId, {
      media: 'https://media.example/a.jpg',
    });
    expect(outcome).toEqual({ kind: 'keptOwn', sourceChanged: false });
    expect(store.delete).toHaveBeenCalledTimes(1);
    expect(store.delete).toHaveBeenCalledWith(copied.key);
    expect(query.mock.calls.map((c) => c[0] as string).some((sql) => /INSERT INTO import_media/.test(sql))).toBe(false);
  });

  it('keeps its copy when the commit outcome is unknown, and passes the failure on', async () => {
    const { db } = fakeDb((sql) => {
      if (/SELECT media_key AS key/.test(sql)) return { rows: [{ key: null, contentType: null }] };
      if (/UPDATE tales SET media_key/.test(sql)) return { rows: [], rowCount: 1 };
      return undefined;
    }, true);
    const store = storage();
    const err = await importTaleMedia(db, { storage: store, copy: async () => copied }, 'p', taleId, {
      media: 'https://media.example/a.jpg',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommitUncertainError);
    expect(store.delete).not.toHaveBeenCalled();
  });
});

describe('importTaleMedia: re-imports', () => {
  const taleId = '00000000-0000-4000-8000-0000000000aa';
  const url = 'https://media.example/a.jpg';
  const oldKey = 'tales/imported-old.jpg';
  const copied = { key: 'tales/imported-new.jpg', contentType: 'image/jpeg' as const, sha256: 'new-bytes' };

  // The tale holds `holds`; import_media recorded the import's copy with `digest` and `sha256`.
  function fakeDb(opts: { holds: string; digest: string | null; sha256?: string; replaceWins?: boolean }) {
    let holds = opts.holds;
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (/SELECT media_key AS key/.test(sql)) return { rows: [{ key: holds, contentType: 'image/jpeg' }] };
      if (/FROM import_media WHERE tale_id/.test(sql)) {
        return { rows: [{ key: oldKey, sha256: opts.sha256 ?? 'old-bytes', digest: opts.digest }] };
      }
      if (/UPDATE tales SET media_key = \$3/.test(sql)) {
        if (opts.replaceWins === false) {
          holds = 'tales/upload.png';
          return { rows: [], rowCount: 0 };
        }
        holds = params[2] as string;
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT 1 FROM tales/.test(sql)) return { rows: [{}] };
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const statements = () => query.mock.calls.map((c) => c[0] as string);
    return {
      db: { query, connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionalDb,
      statements,
      setHolds: (key: string) => {
        holds = key;
      },
    };
  }
  const store = () => ({ put: vi.fn(), putStream: vi.fn(), get: vi.fn(), delete: vi.fn(async () => undefined) });
  const digest = sourceMediaDigest(url, 'image/jpeg');

  it('downloads nothing while the source names the same media and the tale holds the import copy', async () => {
    const { db } = fakeDb({ holds: oldKey, digest });
    const copy = vi.fn(async () => copied);
    const outcome = await importTaleMedia(db, { storage: store(), copy }, 'p', taleId, {
      media: url,
      mimeType: 'image/jpeg',
    });
    expect(outcome).toEqual({ kind: 'imported', change: 'unchanged' });
    expect(copy).not.toHaveBeenCalled();
  });

  it('replaces the media when the source names other media, only while the tale holds the import copy', async () => {
    const { db, statements } = fakeDb({ holds: oldKey, digest: 'another' });
    const storage = store();
    const outcome = await importTaleMedia(db, { storage, copy: async () => copied }, 'p', taleId, {
      media: url,
      mimeType: 'image/jpeg',
    });
    expect(outcome).toEqual({ kind: 'imported', change: 'updated' });
    expect(statements().find((s) => /UPDATE tales SET media_key = \$3/.test(s))).toMatch(/AND media_key = \$2/);
    expect(statements().some((s) => /source_digest = EXCLUDED.source_digest/.test(s))).toBe(true);
    // The earlier copy is left to the sweep: copies of the tale may share it (AD-14).
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('reports media a person set during a same-bytes download as kept, not as the import copy', async () => {
    const { db, statements, setHolds } = fakeDb({ holds: oldKey, digest: 'another', sha256: copied.sha256 });
    const storage = store();
    const copy = async () => {
      setHolds('tales/upload.png');
      return copied;
    };
    const outcome = await importTaleMedia(db, { storage, copy }, 'p', taleId, { media: url, mimeType: 'image/jpeg' });
    expect(outcome).toEqual({ kind: 'keptOwn', sourceChanged: true });
    expect(statements().some((s) => /UPDATE import_media SET source_digest/.test(s))).toBe(false);
    expect(storage.delete).toHaveBeenCalledWith(copied.key);
  });

  it('keeps the copy in place when the new download holds the same bytes, recording the new fingerprint', async () => {
    const { db, statements } = fakeDb({ holds: oldKey, digest: null, sha256: copied.sha256 });
    const storage = store();
    const outcome = await importTaleMedia(db, { storage, copy: async () => copied }, 'p', taleId, { media: url });
    expect(outcome).toEqual({ kind: 'imported', change: 'unchanged' });
    expect(storage.delete).toHaveBeenCalledWith(copied.key);
    expect(statements().some((s) => /UPDATE import_media SET source_digest/.test(s))).toBe(true);
    expect(statements().some((s) => /UPDATE tales SET media_key/.test(s))).toBe(false);
  });

  it("keeps media a person set: a kept local edit when the source's media changed since the import copied it", async () => {
    const copy = vi.fn(async () => copied);
    const changed = await importTaleMedia(
      fakeDb({ holds: 'tales/upload.png', digest: 'another' }).db,
      { storage: store(), copy },
      'p',
      taleId,
      {
        media: url,
        mimeType: 'image/jpeg',
      },
    );
    expect(changed).toEqual({ kind: 'keptOwn', sourceChanged: true });
    const same = await importTaleMedia(
      fakeDb({ holds: 'tales/upload.png', digest }).db,
      { storage: store(), copy },
      'p',
      taleId,
      {
        media: url,
        mimeType: 'image/jpeg',
      },
    );
    expect(same).toEqual({ kind: 'keptOwn', sourceChanged: false });
    expect(copy).not.toHaveBeenCalled();
  });

  it('keeps media a person set while the new media downloaded, deleting only its own copy', async () => {
    const { db } = fakeDb({ holds: oldKey, digest: 'another', replaceWins: false });
    const storage = store();
    const outcome = await importTaleMedia(db, { storage, copy: async () => copied }, 'p', taleId, {
      media: url,
      mimeType: 'image/jpeg',
    });
    expect(outcome).toEqual({ kind: 'keptOwn', sourceChanged: true });
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(copied.key);
  });

  it('keeps the earlier media when the new media cannot be downloaded', async () => {
    const { db } = fakeDb({ holds: oldKey, digest: 'another' });
    const copy = async () => {
      throw new MediaFetchError('httpError', 'The media host answered with an error');
    };
    expect(await importTaleMedia(db, { storage: store(), copy }, 'p', taleId, { media: url })).toEqual({
      kind: 'failed',
      reason: 'httpError',
      keptEarlier: true,
    });
  });

  it('never stores the URL, only its fingerprint', () => {
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('media.example');
    expect(sourceMediaDigest(url, 'image/png')).not.toBe(digest);
  });
});
