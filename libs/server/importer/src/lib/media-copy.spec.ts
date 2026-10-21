import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorage } from '@taleart/server-storage';
import type { TransactionalDb } from '@taleart/server-access';
import { copyMedia, importTaleMedia, type TaleMediaImport } from './media-copy';
import {
  isNonPublicAddress,
  MediaFetchError,
  openMedia,
  parseAllowedAddresses,
  type MediaFetchPolicy,
} from './media-fetch';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 7),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(40, 3),
]);

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
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
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

const local: MediaFetchPolicy = { allowedAddresses: ['127.0.0.1'] };
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

describe('isNonPublicAddress', () => {
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
    'fc00::1',
    'fd00:ec2::254',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '2002:7f00:1::1',
    '2001:0:4136:e378::1',
    '2001:db8::1',
    'ff02::1',
    'localhost',
    'not an address',
  ])('refuses %s', (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '2a00:1450:4001::200e',
  ])('accepts the public address %s', (address) => {
    expect(isNonPublicAddress(address)).toBe(false);
  });
});

describe('parseAllowedAddresses', () => {
  it('keeps IP addresses and lists the rest as invalid; empty allows none', () => {
    expect(
      parseAllowedAddresses(' 127.0.0.1, ::1 ,,localhost, 10.0.0.0/8'),
    ).toEqual({
      addresses: ['127.0.0.1', '::1'],
      invalid: ['localhost', '10.0.0.0/8'],
    });
    expect(parseAllowedAddresses(undefined)).toEqual({
      addresses: [],
      invalid: [],
    });
  });
});

describe('openMedia: the guard', () => {
  it('opens an allowed address and reports type and length', async () => {
    routes['/a.png'] = file('image/png; charset=binary', PNG);
    const res = await openMedia(`${origin}/a.png`, local, signal());
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
    expect(await failure(openMedia(url, local, signal()))).toBe('invalidUrl');
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
      expect(await failure(openMedia(url, {}, signal()))).toBe(
        'blockedAddress',
      );
    }
    // Allowing 127.0.0.1 does not allow ::1.
    expect(
      await failure(openMedia(`http://[::1]:${port}/a.png`, local, signal())),
    ).toBe('blockedAddress');
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
      expect(
        await failure(
          openMedia('http://media.test/a.png', { lookup }, signal()),
        ),
      ).toBe('blockedAddress');
      expect(lookup).toHaveBeenCalledWith('media.test');
    }
  });

  it('connects to the address it checked and resolves the name once (no DNS rebinding)', async () => {
    routes['/a.png'] = file('image/png', PNG);
    // A rebinding name: allowed the first time, private after.
    const answers = [
      [{ address: '127.0.0.1', family: 4 as const }],
      [{ address: '10.0.0.1', family: 4 as const }],
    ];
    const lookup = vi.fn(async () => answers.shift() ?? []);
    const res = await openMedia(
      `http://media.test:${port}/a.png`,
      { ...local, lookup },
      signal(),
    );
    res.body.destroy();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(hits).toEqual(['/a.png']);
  });

  it('turns a name that does not resolve and a refused connection into unreachable', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND media.test');
    });
    expect(
      await failure(openMedia('http://media.test/a.png', { lookup }, signal())),
    ).toBe('unreachable');
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', () => resolve()),
    );
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(
      await failure(
        openMedia(`http://127.0.0.1:${closedPort}/a.png`, local, signal()),
      ),
    ).toBe('unreachable');
  });

  it('follows a redirect, checking each hop: a private hop is refused before it is requested', async () => {
    routes['/moved.png'] = redirect('/a.png');
    routes['/a.png'] = file('image/png', PNG);
    const res = await openMedia(`${origin}/moved.png`, local, signal());
    res.body.destroy();
    expect(hits).toEqual(['/moved.png', '/a.png']);

    routes['/meta.png'] = redirect('http://169.254.169.254/latest/meta-data/');
    expect(
      await failure(openMedia(`${origin}/meta.png`, local, signal())),
    ).toBe('blockedAddress');
    routes['/v6.png'] = redirect(`http://[::1]:${port}/a.png`);
    expect(await failure(openMedia(`${origin}/v6.png`, local, signal()))).toBe(
      'blockedAddress',
    );
    routes['/scheme.png'] = redirect('file:///etc/passwd');
    expect(
      await failure(openMedia(`${origin}/scheme.png`, local, signal())),
    ).toBe('invalidUrl');
  });

  it('stops after the redirect limit, and refuses an error status or a redirect without a location', async () => {
    routes['/loop.png'] = redirect('/loop.png');
    expect(
      await failure(
        openMedia(
          `${origin}/loop.png`,
          { ...local, maxRedirects: 2 },
          signal(),
        ),
      ),
    ).toBe('tooManyRedirects');
    expect(hits).toHaveLength(3);
    expect(
      await failure(openMedia(`${origin}/missing.png`, local, signal())),
    ).toBe('httpError');
    routes['/nowhere.png'] = (_req, res) => res.writeHead(301).end();
    expect(
      await failure(openMedia(`${origin}/nowhere.png`, local, signal())),
    ).toBe('httpError');
  });

  it('sends no credential, cookie or token', async () => {
    let headers: IncomingMessage['headers'] = {};
    routes['/a.png'] = (req, res) => {
      headers = req.headers;
      file('image/png', PNG)(req, res);
    };
    (await openMedia(`${origin}/a.png`, local, signal())).body.destroy();
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

  const stored = () =>
    existsSync(join(root, 'tales')) ? readdirSync(join(root, 'tales')) : [];

  it('streams an accepted file into storage under a new key, with its hash', async () => {
    routes['/a.png'] = file('image/png', PNG);
    const copied = await copyMedia(
      storage,
      `${origin}/a.png`,
      'image/jpeg',
      local,
    );
    expect(copied.key).toMatch(/^tales\/[0-9a-f-]{36}\.png$/);
    expect(copied.contentType).toBe('image/png');
    expect(copied.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(await storage.get(copied.key)).toEqual(PNG);
  });

  it("takes the story's mime_type when the host names only a generic type or none", async () => {
    routes['/octet'] = file('application/octet-stream', JPEG);
    expect(
      (await copyMedia(storage, `${origin}/octet`, 'image/jpeg', local))
        .contentType,
    ).toBe('image/jpeg');
    routes['/none'] = (_req, res) => {
      res.removeHeader('Content-Type');
      res.end(JPEG);
    };
    expect(
      (await copyMedia(storage, `${origin}/none`, 'image/jpeg', local))
        .contentType,
    ).toBe('image/jpeg');
    expect(
      await failure(copyMedia(storage, `${origin}/octet`, null, local)),
    ).toBe('unsupportedType');
    expect(stored()).toHaveLength(2);
  });

  it('refuses a type that is not accepted, and bytes that do not match the declared type', async () => {
    routes['/page'] = file('text/html', Buffer.from('<!doctype html>'));
    routes['/fake.png'] = file('image/png', JPEG);
    routes['/empty.png'] = file('image/png', Buffer.alloc(0));
    routes['/short.png'] = file('image/png', PNG.subarray(0, 3));
    for (const path of ['/page', '/fake.png', '/empty.png', '/short.png']) {
      expect(
        await failure(
          copyMedia(storage, `${origin}${path}`, 'image/png', local),
        ),
      ).toBe('unsupportedType');
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
    const copied = await copyMedia(storage, `${origin}/slow.png`, null, local);
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
    expect(
      await failure(copyMedia(storage, `${origin}/declared.png`, null, local)),
    ).toBe('tooLarge');
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
    expect(
      await failure(copyMedia(storage, `${origin}/endless.png`, null, local)),
    ).toBe('tooLarge');
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
          ...local,
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
          ...local,
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
    const err = await copyMedia(broken, `${origin}/a.png`, null, local).catch(
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(MediaFetchError);
    expect((err as Error).message).toBe('disk full');
  });

  it('never puts the URL in its failure messages', async () => {
    const url = `${origin}/missing.png?signature=very-secret`;
    const err = (await copyMedia(storage, url, null, local).catch(
      (e: unknown) => e,
    )) as Error;
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
      expect(
        await importTaleMedia(db, media, 'p', 't', { id: '1', media: value }),
      ).toEqual({ kind: 'none' });
    }
    expect(
      await importTaleMedia(db, media, 'p', 't', {
        id: '1',
        media: { url: 'x' },
      }),
    ).toEqual({
      kind: 'failed',
      reason: 'invalidUrl',
    });
    expect(media.copy).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});
