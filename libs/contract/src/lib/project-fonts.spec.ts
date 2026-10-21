import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clearProjectFontLoads,
  FONT_LOAD_TIMEOUT_MS,
  FONT_RETRY_AFTER_MS,
  FONT_WEIGHTS,
  isFontWeight,
  isProjectFontFamily,
  isProjectFontStyle,
  fontFaceName,
  isWoff2,
  isWoff2Header,
  loadProjectFont,
  MAX_FONT_BYTES,
  projectFontAlias,
  projectFontFamilyError,
  projectFontIds,
  projectFontRefs,
  textWeightForFont,
  type FontLoadEnvironment,
} from '../index';

/**
 * A structurally sound WOFF2 file of `size` bytes: a TrueType flavour, one `cmap` table of 16
 * bytes, untransformed, and compressed data filling the rest. `edit` changes it before it is read.
 */
function woff2Bytes(size = 64, edit?: (view: DataView, data: Uint8Array) => void): Uint8Array {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  data.set([0x77, 0x4f, 0x46, 0x32]);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, size);
  view.setUint16(12, 1);
  view.setUint32(16, 1024);
  view.setUint32(20, size - 50);
  data[48] = 0x00; // cmap (known tag 0), version 0: no transform
  data[49] = 0x10; // origLength 16, as UIntBase128
  edit?.(view, data);
  return data;
}

const FONT_ID = '0f0e0d0c-0000-4000-8000-00000000000a';

describe('isWoff2', () => {
  it('accepts the wOF2 signature with a whole header whose length is the file size', () => {
    expect(isWoff2(woff2Bytes())).toBe(true);
    expect(isWoff2(woff2Bytes(MAX_FONT_BYTES))).toBe(true);
  });

  it('refuses TrueType, OpenType, WOFF 1, SVG and HTML, whatever they are called', () => {
    const ttf = new Uint8Array(64);
    ttf.set([0x00, 0x01, 0x00, 0x00]);
    const otf = new Uint8Array(64);
    otf.set([...'OTTO'].map((c) => c.charCodeAt(0)));
    const woff = woff2Bytes();
    woff[3] = 0x46; // wOFF
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = new TextEncoder().encode('<!doctype html><html><body>wOF2</body></html>                         ');
    for (const bytes of [ttf, otf, woff, svg, html]) expect(isWoff2(bytes)).toBe(false);
  });

  it('refuses a truncated header or a length that is not the file size', () => {
    expect(isWoff2(woff2Bytes().subarray(0, 40))).toBe(false);
    const longer = new Uint8Array(80);
    longer.set(woff2Bytes(64));
    expect(isWoff2(longer)).toBe(false);
  });

  it('accepts a real WOFF2 font', () => {
    const file = readFileSync(
      resolve(__dirname, '../../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
    );
    expect(isWoff2(new Uint8Array(file))).toBe(true);
  });

  it.each<[string, (view: DataView, data: Uint8Array) => void]>([
    ['an unknown flavour', (v) => v.setUint32(4, 0x12345678)],
    ['a reserved field that is not 0', (v) => v.setUint16(14, 1)],
    ['no table', (v) => v.setUint16(12, 0)],
    ['over 256 tables', (v) => v.setUint16(12, 257)],
    ['a decoded size over 30 MB', (v) => v.setUint32(16, 30 * 1024 * 1024 + 1)],
    ['compressed data past the end', (v, d) => v.setUint32(20, d.length - 49)],
    ['metadata past the end', (v, d) => (v.setUint32(28, d.length - 2), v.setUint32(32, 4))],
    ['a metadata offset without a length', (v) => v.setUint32(28, 52)],
    ['private data past the end', (v, d) => (v.setUint32(40, d.length), v.setUint32(44, 1))],
    ['a table directory past the end', (v, d) => (v.setUint16(12, 200), v.setUint32(20, d.length - 50))],
    ['a UIntBase128 with a leading zero byte', (_, d) => (d[49] = 0x80)],
    ['a UIntBase128 over 5 bytes', (v, d) => (d.set([0x81, 0x81, 0x81, 0x81, 0x81, 0x01], 49), v.setUint32(20, 0))],
    ['a UIntBase128 over 32 bits', (v, d) => (d.set([0x90, 0x80, 0x80, 0x80, 0x00], 49), v.setUint32(20, 0))],
    ['a table larger than 30 MB', (v, d) => (d.set([0x90, 0x80, 0x80, 0x00], 49), v.setUint32(20, 0))],
    ['a reserved glyf transform', (_, d) => (d[48] = 0x40 | 10)],
    ['an undefined transform of another table', (_, d) => (d[48] = 0x40 | 1)],
    ['a transformed loca with a length', (v, d) => (d.set([11, 0x10, 0x01], 48), v.setUint32(20, d.length - 51))],
    ['a collection without fonts', (v) => v.setUint32(4, 0x74746366)],
    [
      'a collection index out of range',
      (v, d) => (v.setUint32(4, 0x74746366), d.set([0, 0, 2, 0, 1, 1, 0, 1, 0, 0, 1], 50), v.setUint32(20, 0)),
    ],
  ])('refuses %s', (_, edit) => {
    expect(isWoff2(woff2Bytes(128, edit))).toBe(false);
  });

  it('accepts a sound collection, a transformed glyf with loca, hmtx and an arbitrary tag', () => {
    // A collection of one font with one table, index 0.
    const collection = (v: DataView, d: Uint8Array) => {
      v.setUint32(4, 0x74746366);
      d.set([0, 0, 2, 0, 1, 1, 0, 1, 0, 0, 0], 50);
      v.setUint32(20, d.length - 61);
    };
    expect(isWoff2(woff2Bytes(128, collection))).toBe(true);
    const tables = (v: DataView, d: Uint8Array) => {
      v.setUint16(12, 4);
      // glyf transformed (version 0) with a length; loca transformed with length 0; hmtx version 1; tag 'ABCD'.
      d.set([10, 0x20, 0x10, 11, 0x08, 0x00, 0x40 | 3, 0x10, 0x08, 0x3f, 0x41, 0x42, 0x43, 0x44, 0x04], 48);
      v.setUint32(20, d.length - 63);
    };
    expect(isWoff2(woff2Bytes(128, tables))).toBe(true);
  });

  it('checks a header against the size of its file, for a browser that reads only the start', () => {
    const head = woff2Bytes(4096).subarray(0, 48);
    expect(isWoff2Header(head, 4096)).toBe(true);
    expect(isWoff2Header(head, 4097)).toBe(false);
    expect(isWoff2Header(head.subarray(0, 47), 4096)).toBe(false);
  });
});

describe('fontFaceName', () => {
  it('names a face by its weight and style', () => {
    expect(fontFaceName({ weight: 700, style: 'italic' })).toBe('Bold italic');
    expect(fontFaceName({ weight: 400, style: 'normal' })).toBe('Regular');
    expect(fontFaceName({ weight: 450, style: 'normal' })).toBe('450');
  });
});

describe('project font records', () => {
  it('takes one bare font name that passes the font-list rules as a family', () => {
    for (const ok of ['Brand Sans', 'Inter', 'Noto Sans 3D', 'A-B']) expect(isProjectFontFamily(ok)).toBe(true);
    for (const bad of [
      'inherit',
      'Initial',
      'default',
      'A, B',
      '"Quoted"',
      "'Quoted'",
      'x;y',
      ' Lead',
      'Trail ',
      '3D',
      '',
    ]) {
      expect(projectFontFamilyError(bad)).not.toBeNull();
    }
    expect(isProjectFontFamily('a'.repeat(100))).toBe(true);
    expect(projectFontFamilyError('a'.repeat(101))).toMatch(/at most 100/);
    expect(projectFontFamilyError(undefined)).toBe('family is required');
  });

  it('takes weights 100 to 900 in steps of 100 and two styles', () => {
    expect(FONT_WEIGHTS.every(isFontWeight)).toBe(true);
    for (const bad of [0, 50, 150, 950, 1000, '400', 400.5]) expect(isFontWeight(bad)).toBe(false);
    expect(isProjectFontStyle('normal') && isProjectFontStyle('italic')).toBe(true);
    expect(isProjectFontStyle('oblique')).toBe(false);
  });

  it("names a font's alias after its id, never its family", () => {
    expect(projectFontAlias(FONT_ID.toUpperCase())).toBe(`taleart-font-${FONT_ID}`);
    expect(projectFontAlias('Brand Sans')).toBeNull();
    expect(projectFontAlias('x"; color: red')).toBeNull();
  });

  it('maps a face weight to the closest text weight', () => {
    expect([100, 400, 500, 600, 900].map(textWeightForFont)).toEqual(['regular', 'regular', 'medium', 'bold', 'bold']);
  });

  it("lists a document's project fonts with their pointers, visible ones only when asked", () => {
    const other = '0f0e0d0c-0000-4000-8000-00000000000b';
    const text = (font: unknown, hidden = false) => ({ type: 'text', hidden, props: { text: 'x', font } });
    const doc = {
      elements: [
        text({ source: 'system', stack: 'serif' }),
        text({ source: 'project', fontId: FONT_ID.toUpperCase() }),
        text({ source: 'project', fontId: other }, true),
        text({ source: 'project', fontId: 'nope' }),
        { type: 'sticker', props: { font: { source: 'project', fontId: other } } },
        text({ source: 'project', fontId: FONT_ID }),
      ],
    };
    expect(projectFontRefs(doc)).toEqual([
      { fontId: FONT_ID, pointer: '/elements/1/props/font/fontId' },
      { fontId: other, pointer: '/elements/2/props/font/fontId' },
      { fontId: FONT_ID, pointer: '/elements/5/props/font/fontId' },
    ]);
    expect(projectFontIds(doc)).toEqual([FONT_ID, other]);
    expect(projectFontIds(doc, { visibleOnly: true })).toEqual([FONT_ID]);
    expect(projectFontIds(null)).toEqual([]);
  });
});

describe('loadProjectFont', () => {
  const face = {
    id: FONT_ID,
    url: 'https://api.example.com/media/fonts/a.woff2',
    weight: 700,
    style: 'italic' as const,
  };

  function environment(answer: () => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>) {
    const added: unknown[] = [];
    const made: { family: string; descriptors: unknown }[] = [];
    const env: FontLoadEnvironment = {
      fetch: vi.fn(() => answer()),
      FontFace: class {
        constructor(family: string, _source: ArrayBuffer, descriptors: unknown) {
          made.push({ family, descriptors });
        }
        async load() {
          return this;
        }
      },
      fonts: { add: (f) => added.push(f) },
    };
    return { env, added, made };
  }
  const ok = (bytes: Uint8Array = woff2Bytes()) =>
    Promise.resolve({ ok: true, arrayBuffer: async () => bytes.slice().buffer });

  beforeEach(() => clearProjectFontLoads());
  afterEach(() => vi.useRealTimers());

  it('fetches the bytes and adds a FontFace under the alias with the face descriptors', async () => {
    const { env, added, made } = environment(() => ok());
    await expect(loadProjectFont(face, { env })).resolves.toBe(true);
    expect(env.fetch).toHaveBeenCalledWith(face.url, expect.objectContaining({ credentials: 'omit', mode: 'cors' }));
    expect(made).toEqual([{ family: `taleart-font-${FONT_ID}`, descriptors: { weight: '700', style: 'italic' } }]);
    expect(added).toHaveLength(1);
  });

  it('fetches each face once per page', async () => {
    const { env, added } = environment(() => ok());
    await Promise.all([loadProjectFont(face, { env }), loadProjectFont(face, { env })]);
    await loadProjectFont(face, { env });
    expect(env.fetch).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(1);
  });

  it('keeps the fallback when the fetch fails, answers an error or is not WOFF2', async () => {
    for (const answer of [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }),
      () => ok(new TextEncoder().encode('<svg></svg>'.padEnd(64))),
    ]) {
      clearProjectFontLoads();
      const { env, added } = environment(answer);
      await expect(loadProjectFont(face, { env })).resolves.toBe(false);
      expect(added).toHaveLength(0);
    }
  });

  it('remembers a failed face: no fetch again until the backoff passes or a retry is asked for', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    const { env } = environment(() => Promise.reject(new Error('offline')));
    await loadProjectFont(face, { env });
    // An editor renders again and again: the failed face is not fetched each time.
    for (let i = 0; i < 5; i++) await loadProjectFont(face, { env });
    expect(env.fetch).toHaveBeenCalledTimes(1);
    await loadProjectFont(face, { env, retry: true });
    expect(env.fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(Date.now() + FONT_RETRY_AFTER_MS - 1));
    await loadProjectFont(face, { env });
    expect(env.fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(Date.now() + 1));
    await loadProjectFont(face, { env });
    expect(env.fetch).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 s and never adds a face that arrives later', async () => {
    vi.useFakeTimers();
    let deliver: (value: { ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }) => void = () => undefined;
    let signal: AbortSignal | undefined;
    const { env, added } = environment(() => new Promise((done) => (deliver = done)));
    (env.fetch as ReturnType<typeof vi.fn>).mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      signal = init.signal;
      return new Promise((done) => (deliver = done));
    });
    const loading = loadProjectFont(face, { env });
    await vi.advanceTimersByTimeAsync(FONT_LOAD_TIMEOUT_MS - 1);
    expect(added).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await expect(loading).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    deliver({ ok: true, arrayBuffer: async () => woff2Bytes().buffer as ArrayBuffer });
    await vi.runAllTimersAsync();
    expect(added).toHaveLength(0);
  });

  it('sends the session for the studio and refuses a face whose id is not one', async () => {
    const { env } = environment(() => ok());
    await loadProjectFont(face, { env, credentials: 'same-origin' });
    expect(env.fetch).toHaveBeenCalledWith(face.url, expect.objectContaining({ credentials: 'same-origin' }));
    await expect(loadProjectFont({ ...face, id: 'Brand Sans' }, { env })).resolves.toBe(false);
  });

  it('does nothing without a browser', async () => {
    await expect(loadProjectFont(face)).resolves.toBe(false);
  });
});
