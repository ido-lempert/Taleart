import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { MAX_TALE_ELEMENTS, TALE_DOCUMENT_V1_SCHEMA, TALE_ELEMENT_TYPE_REGISTRY, taleMediaElement } from '@taleart/contract/tale-document';
import { ASSET_NAMES, assetBytes } from './assets';
import { DEMO_GROUPS, DEMO_PROJECT_NAME, demoCounts } from './content';
import { resolveTextStyle, textContrast } from '@taleart/contract/text-style';
import { contrastRatio } from '@taleart/contract/theme';
import { TALE_SAFE_AREA } from '@taleart/contract/tale-document';
import { ElementBuilder, INK, PANEL_COLOR, withElements } from './documents';
import { seedDemo, SeedRefusedError, type SeedClient } from './seed';

const assetsDir = join(__dirname, '../assets');
const NOW = new Date('2026-04-01T09:00:00.000Z');

// The size of a JPEG, read from its start-of-frame marker.
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Not a JPEG marker');
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  throw new Error('No frame header');
}

describe('the demo pictures', () => {
  it('are every file in src/assets and nothing else', () => {
    const files = readdirSync(assetsDir).filter((f) => f.endsWith('.jpg'));
    expect(files.map((f) => f.replace(/\.jpg$/, '')).sort()).toEqual([...ASSET_NAMES].sort());
  });

  it('are JPEGs within the sizes the API takes and the repository keeps small', () => {
    let total = 0;
    for (const name of ASSET_NAMES) {
      const bytes = assetBytes(name);
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(bytes.length).toBeLessThan(200 * 1024);
      const { width, height } = jpegSize(bytes);
      if (name.startsWith('s')) expect({ width, height }).toEqual({ width: 1080, height: 1920 });
      else expect({ width, height }).toEqual({ width: 720, height: 720 });
      total += bytes.length;
    }
    expect(total).toBeLessThan(3 * 1024 * 1024);
    expect(statSync(assetsDir).isDirectory()).toBe(true);
  });

  it('are all named, with their source and licence, in LICENSES.md', () => {
    const licences = readFileSync(join(assetsDir, 'LICENSES.md'), 'utf8');
    for (const name of ASSET_NAMES) expect(licences).toContain(`${name}.jpg`);
  });

  it('are all used, and every picture the content names exists', () => {
    const used = new Set(DEMO_GROUPS.flatMap((g) => [g.cover, ...g.tales.map((t) => t.picture)]));
    expect([...used].sort()).toEqual([...ASSET_NAMES].sort());
  });
});

describe('the demo tale documents', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const document = ajv.compile(TALE_DOCUMENT_V1_SCHEMA);
  const props = new Map(TALE_ELEMENT_TYPE_REGISTRY.map((entry) => [entry.key, ajv.compile(entry.schema)]));

  for (const group of DEMO_GROUPS) {
    for (const tale of group.tales) {
      it(`${tale.title} passes the document schema and its elements' schemas`, () => {
        const builder = new ElementBuilder(INK[tale.ink], 1);
        tale.compose(builder, NOW);
        const base = {
          version: 1 as const,
          canvas: { background: { type: 'color' as const, color: '#000000' } },
          elements: [taleMediaElement('00000000-0000-4000-8000-000000000000', 'tales/picture.jpg', 'image')],
        };
        const doc = withElements(base, builder.elements);
        expect(document(doc), JSON.stringify(document.errors)).toBe(true);
        expect(doc.elements.length).toBeLessThanOrEqual(MAX_TALE_ELEMENTS);
        expect(new Set(doc.elements.map((e) => e.id)).size).toBe(doc.elements.length);
        for (const element of doc.elements) {
          const check = props.get(element.type);
          expect(check, element.type).toBeDefined();
          expect(check?.(element.props), `${element.type}: ${JSON.stringify(check?.errors)}`).toBe(true);
        }
      });
    }
  }

  it('hold at most one poll, rating, quiz and reaction per tale and show each interactive feature somewhere', () => {
    const types = DEMO_GROUPS.flatMap((g) => g.tales).flatMap((t) => {
      const builder = new ElementBuilder(INK[t.ink], 1);
      t.compose(builder, NOW);
      const own = builder.elements.map((e) => e.type);
      for (const single of ['poll', 'rating', 'quiz', 'reaction']) expect(own.filter((x) => x === single).length).toBeLessThanOrEqual(1);
      return own;
    });
    for (const wanted of ['text', 'button', 'swipe-up', 'countdown', 'promo-code', 'poll', 'quiz', 'rating', 'reaction']) {
      expect(types, wanted).toContain(wanted);
    }
  });
});

// A stand-in for the Management API: it answers what the seed asks and records every call.
function fakeApi(existing: { id: string; name: string }[] = []) {
  const calls: { method: string; path: string; json?: unknown; type?: string }[] = [];
  let n = 0;
  const media = new Map<string, boolean>();
  const client: SeedClient = {
    async request<T>(method: string, path: string, options: { json?: unknown; body?: Blob; contentType?: string } = {}): Promise<T> {
      calls.push({ method, path, json: options.json, type: options.contentType });
      if (method === 'GET' && path === '/projects') return existing as T;
      if (method === 'POST' && path === '/projects') return { id: 'project-1', name: (options.json as { name: string }).name } as T;
      if (method === 'PUT' && /\/tales\/[^/]+\/media$/.test(path)) {
        media.set(path.split('/')[2], true);
        return {} as T;
      }
      if (method === 'GET' && /\/tales\/[^/]+\/document$/.test(path)) {
        return {
          document: { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [] },
          revision: 1,
          published: { revision: 0 },
        } as T;
      }
      if (method === 'PUT' && /\/tales\/[^/]+\/document$/.test(path)) return { revision: 2, published: { revision: 0 } } as T;
      if (method === 'POST' && /\/zones\/[^/]+\/key$/.test(path)) return { key: `tak_${++n}` } as T;
      if (method === 'POST' && path === '/zones') return { id: `id-${++n}`, slug: `zone-${n}` } as T;
      return { id: `id-${++n}` } as T;
    },
  };
  return { client, calls };
}

// What the canvas is 9:16 wide, as a fraction of its height.
const CANVAS_RATIO = 9 / 16;

describe('the demo texts and components read well', () => {
  const tales = DEMO_GROUPS.flatMap((g) => g.tales).map((tale) => {
    const builder = new ElementBuilder(INK[tale.ink], 1);
    tale.compose(builder, NOW);
    return { tale, elements: builder.elements };
  });

  for (const { tale, elements } of tales) {
    it(`${tale.title}: texts wrap inside their card and the safe area, with enough contrast`, () => {
      for (const element of elements) {
        const { x, y, w, h } = element.box;
        if (element.type !== 'swipe-up') {
          expect(x).toBeGreaterThanOrEqual(TALE_SAFE_AREA.side);
          expect(x + w).toBeLessThanOrEqual(1 - TALE_SAFE_AREA.side);
          expect(y).toBeGreaterThanOrEqual(TALE_SAFE_AREA.top);
          expect(y + h).toBeLessThanOrEqual(1 - TALE_SAFE_AREA.bottom + 1e-9);
        }
        if (element.type === 'text') {
          const props = element.props as { text: string; size: number; lineHeight: number };
          // A character is at most 0.6 em wide in bold, 0.55 in regular; the card keeps 3% of the box as padding on each side.
          const lineWidth = w * CANVAS_RATIO * 0.94;
          const lines = Math.ceil((props.text.length * (props.size > 0.03 ? 0.6 : 0.55) * props.size) / lineWidth);
          expect(lines * props.size * props.lineHeight, `${props.text}: ${lines} lines`).toBeLessThanOrEqual(h);
          expect(props.size).toBeGreaterThanOrEqual(0.026);
          const verdict = textContrast(resolveTextStyle(props as never), { canvasColor: '#000000', overMedia: true });
          expect(verdict.kind, props.text).toBe('ok');
        }
        if (element.type === 'button' || element.type === 'swipe-up') {
          const p = element.props as { color: string; fill?: string; background?: string };
          expect(contrastRatio(p.color, (p.fill ?? p.background) as string)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${tale.title}: each interactive component sits on a dark panel and its Studio stand-in fits on one line`, () => {
      elements.forEach((element, i) => {
        if (!['poll', 'quiz', 'rating', 'reaction', 'countdown', 'promo-code'].includes(element.type)) return;
        const panel = elements[i - 1];
        expect(panel.type).toBe('shape');
        expect(panel.box).toEqual(element.box);
        expect((panel.props as { fill: string }).fill).toBe(PANEL_COLOR);
        // The Studio draws a stand-in in white on one line: no wrapping, so it must fit (tale-studio.ts configuredView).
        expect(contrastRatio('#ffffff', PANEL_COLOR)).toBeGreaterThanOrEqual(4.5);
        const props = element.props as Record<string, string>;
        const standIn = element.type === 'promo-code' ? props['code'] : element.type === 'countdown' ? props['title'] : [props['emoji'], props['question']].filter(Boolean).join(' ');
        const size = Math.min(element.box.h * 0.45, 0.05);
        expect([...standIn].length * 0.6 * size, standIn).toBeLessThanOrEqual(element.box.w * CANVAS_RATIO);
        expect(props['theme']).toBe('dark');
      });
    });
  }
});

describe('seedDemo', () => {
  it('makes the project, its zones, groups and tales on an empty install, and says what it made', async () => {
    const { client, calls } = fakeApi();
    const logged: string[] = [];
    const result = await seedDemo(client, { now: NOW, log: (m) => logged.push(m) });
    expect(result).toMatchObject({ status: 'created', project: { name: DEMO_PROJECT_NAME }, counts: demoCounts() });
    const count = (method: string, pattern: RegExp) => calls.filter((c) => c.method === method && pattern.test(c.path)).length;
    expect(count('POST', /^\/zones$/)).toBe(3);
    expect(count('POST', /^\/zones\/[^/]+\/tale-groups$/)).toBe(5);
    expect(count('POST', /^\/tale-groups\/[^/]+\/tales$/)).toBe(13);
    expect(count('PUT', /^\/tales\/[^/]+\/media$/)).toBe(13);
    expect(count('PUT', /^\/tale-groups\/[^/]+\/cover$/)).toBe(5);
    expect(calls.every((c) => c.type === undefined || c.type === 'image/jpeg' || c.type === 'text/plain')).toBe(true);
    expect(logged[0]).toBe(`Created project ${DEMO_PROJECT_NAME}`);
    expect(count('POST', /^\/zones\/[^/]+\/key$/)).toBe(3);
    if (result.status === 'created') expect(result.zoneKeys.map((k) => k.key)).toHaveLength(3);
  });

  it('counts its dates from now: the countdown and the schedules', async () => {
    const { client, calls } = fakeApi();
    await seedDemo(client, { now: NOW });
    const saved = calls.filter((c) => c.method === 'PUT' && /\/document$/.test(c.path));
    const countdown = JSON.stringify(saved.map((c) => c.json)).match(/"endsAt":"([^"]+)"/);
    expect(countdown?.[1]).toBe('2026-04-08T09:00:00.000Z');
    const schedules = calls.filter((c) => /\/schedule$/.test(c.path)).map((c) => c.json);
    expect(schedules).toContainEqual({ startsAt: '2026-04-03T09:00:00.000Z', endsAt: '2026-04-10T09:00:00.000Z' });
    expect(schedules).toContainEqual({ startsAt: '2026-04-04T09:00:00.000Z', endsAt: null });
  });

  it('is a no-op when the demo project exists', async () => {
    const { client, calls } = fakeApi([{ id: 'p', name: DEMO_PROJECT_NAME }]);
    expect(await seedDemo(client)).toEqual({ status: 'exists', project: { id: 'p', name: DEMO_PROJECT_NAME } });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /projects']);
  });

  it('refuses an install that already has other projects, writing nothing', async () => {
    const { client, calls } = fakeApi([{ id: 'p', name: 'Our site' }]);
    await expect(seedDemo(client)).rejects.toBeInstanceOf(SeedRefusedError);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('with force adds the demo anyway, as a second copy when one exists', async () => {
    const { client } = fakeApi([
      { id: 'p', name: DEMO_PROJECT_NAME },
      { id: 'q', name: 'Our site' },
    ]);
    const result = await seedDemo(client, { force: true, now: NOW });
    expect(result).toMatchObject({ status: 'created', project: { name: `${DEMO_PROJECT_NAME} 2` } });
  });

  it('changes nothing with dryRun', async () => {
    const { client, calls } = fakeApi();
    expect(await seedDemo(client, { dryRun: true })).toEqual({ status: 'dry-run', name: DEMO_PROJECT_NAME, counts: demoCounts() });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('runs afterProject once the project exists', async () => {
    const { client } = fakeApi();
    const seen: string[] = [];
    await seedDemo(client, { now: NOW, afterProject: async (p) => void seen.push(p.id) });
    expect(seen).toEqual(['project-1']);
  });
});
