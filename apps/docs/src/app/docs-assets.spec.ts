import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

// The docs are served from the root ("/") and, on GitHub Pages, from "/Taleart/". Every page sets a
// <base href> to that root, so an image reference must be relative ("images/x.png") and never
// absolute ("/images/x.png", which the Pages site resolves to the host root and 404s).

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

const root = workspaceRoot();
const PUBLIC = join(root, 'apps/docs/public');
const PAGES = join(root, 'apps/docs/src/app/pages');

/** The page templates: every non-spec source under pages/ (they hold the inline HTML). */
const templates = readdirSync(PAGES)
  .filter((name) => name.endsWith('.ts') && !/\.spec\.ts$/.test(name))
  .map((name) => ({ name: relative(root, join(PAGES, name)), text: readFileSync(join(PAGES, name), 'utf8') }));

/** Every <img> tag in the templates, with its file name relative to apps/docs/public. */
const images = templates.flatMap(({ name, text }) =>
  [...text.matchAll(/<img\b[^>]*>/g)].map((m) => {
    const tag = m[0];
    const src = /\bsrc="([^"]*)"/.exec(tag)?.[1] ?? '';
    const attr = (key: string) => {
      const value = new RegExp(`\\b${key}="([^"]*)"`).exec(tag)?.[1];
      return value === undefined ? undefined : Number(value);
    };
    return { template: name, src, width: attr('width'), height: attr('height') };
  }),
);

/** Case-sensitive existence: macOS file systems compare names without case, so ask the directory. */
function existsExact(path: string): boolean {
  const dir = dirname(path);
  return existsSync(dir) && readdirSync(dir).includes(basename(path));
}

/** Intrinsic size of a PNG (IHDR), a lossless WebP (VP8L) or an SVG (viewBox). */
function intrinsicSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  if (file.endsWith('.png')) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (file.endsWith('.webp')) {
    if (bytes.toString('ascii', 12, 16) !== 'VP8L') throw new Error(`${file}: only lossless WebP (VP8L) is checked`);
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  const viewBox = /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/.exec(bytes.toString('utf8'));
  if (!viewBox) throw new Error(`${file}: no viewBox`);
  return { width: Number(viewBox[3]), height: Number(viewBox[4]) };
}

describe('docs image references', () => {
  it('reads every page template and finds the images they use', () => {
    expect(templates.length).toBeGreaterThan(30);
    expect(images.length).toBeGreaterThan(100);
  });

  it('never uses an absolute src or an absolute image href (GitHub Pages serves under /Taleart/)', () => {
    const ABSOLUTE = /\bsrc="\/|\bhref="\/(?:guides\/)?images\//g;
    const offenders = templates.flatMap(({ name, text }) => [...text.matchAll(ABSOLUTE)].map((m) => `${name}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });

  it('points only at image files that exist in apps/docs/public, with the exact case', () => {
    const missing = images
      .filter((img) => img.src.startsWith('images/') || img.src.startsWith('guides/images/'))
      .filter((img) => !existsExact(join(PUBLIC, img.src)))
      .map((img) => `${img.template}: ${img.src}`);
    expect(missing).toEqual([]);
  });

  it('gives every local image the width and height its file has', () => {
    const local = images.filter((img) => /^(?:guides\/)?images\//.test(img.src));
    const wrong = local
      .map((img) => {
        const size = intrinsicSize(join(PUBLIC, img.src));
        return { ...img, size };
      })
      .filter((img) => img.width !== img.size.width || img.height !== img.size.height)
      .map((img) => `${img.template}: ${img.src} is ${img.size.width}x${img.size.height}, tag says ${img.width ?? '-'}x${img.height ?? '-'}`);
    expect(wrong).toEqual([]);
  });

  it('keeps every image under 400 KB', () => {
    const big = [...new Set(images.map((img) => img.src))]
      .filter((src) => /^(?:guides\/)?images\//.test(src))
      .filter((src) => readFileSync(join(PUBLIC, src)).length > 400 * 1024)
      .map((src) => src);
    expect(big).toEqual([]);
  });
});
