import {
  clearProjectFontLoads,
  FONT_LOAD_TIMEOUT_MS,
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

/** A file with a WOFF2 header whose total length is its size. */
function woff2Bytes(size = 64): Uint8Array {
  const data = new Uint8Array(size);
  data.set([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
  data[8] = (size >>> 24) & 0xff;
  data[9] = (size >>> 16) & 0xff;
  data[10] = (size >>> 8) & 0xff;
  data[11] = size & 0xff;
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

  it('keeps the fallback when the fetch fails, answers an error or is not WOFF2, and tries again later', async () => {
    for (const answer of [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }),
      () => ok(new TextEncoder().encode('<svg></svg>'.padEnd(64))),
    ]) {
      const { env, added } = environment(answer);
      await expect(loadProjectFont(face, { env })).resolves.toBe(false);
      expect(added).toHaveLength(0);
      await loadProjectFont(face, { env });
      expect(env.fetch).toHaveBeenCalledTimes(2);
    }
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
