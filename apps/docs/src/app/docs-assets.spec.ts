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

/** Every <video> tag in the templates: its file, poster and declared size, the flags it sets, and whether a caption follows it. */
const videos = templates.flatMap(({ name, text }) =>
  [...text.matchAll(/<video\b[^>]*>/g)].map((m) => {
    const tag = m[0];
    const at = m.index ?? 0;
    const value = (key: string) => new RegExp(`\\b${key}="([^"]*)"`).exec(tag)?.[1];
    const flag = (key: string) => new RegExp(`\\s${key}(?=[\\s>])`).test(tag);
    const after = text.slice(at + tag.length, at + tag.length + 700);
    return {
      template: name,
      // The file is on the tag, or on the <source> inside it.
      src: value('src') ?? /<source\b[^>]*\bsrc="([^"]*)"/.exec(after)?.[1] ?? '',
      poster: value('poster') ?? '',
      width: Number(value('width')),
      height: Number(value('height')),
      muted: flag('muted'),
      loop: flag('loop'),
      playsinline: flag('playsinline'),
      controls: flag('controls'),
      autoplay: flag('autoplay'),
      preload: value('preload'),
      captioned: /<figcaption\b/.test(after),
    };
  }),
);

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

describe('docs video clips', () => {
  it('finds the clips the pages embed', () => {
    expect(videos.length).toBeGreaterThanOrEqual(3);
  });

  it('plays only when the visitor asks: muted, looping, with controls, and no autoplay (also under reduced motion)', () => {
    for (const v of videos) {
      expect({ clip: v.src, muted: v.muted, loop: v.loop, playsinline: v.playsinline, controls: v.controls, preload: v.preload, autoplay: v.autoplay }).toEqual({
        clip: v.src,
        muted: true,
        loop: true,
        playsinline: true,
        controls: true,
        preload: 'metadata',
        autoplay: false,
      });
    }
  });

  it('points at a clip file that exists, with the exact case, and keeps it under 400 KB (WebM) or 600 KB (MP4)', () => {
    const problems = videos.flatMap((v) => {
      const out: string[] = [];
      if (!/^images\/[\w.-]+\.(webm|mp4)$/.test(v.src)) out.push(`${v.template}: src "${v.src}" is not a local WebM or MP4 in images/`);
      else if (!existsExact(join(PUBLIC, v.src))) out.push(`${v.template}: ${v.src} does not exist`);
      else if (readFileSync(join(PUBLIC, v.src)).length > (v.src.endsWith('.mp4') ? 600 : 400) * 1024)
        out.push(`${v.template}: ${v.src} is over ${v.src.endsWith('.mp4') ? 600 : 400} KB`);
      return out;
    });
    expect(problems).toEqual([]);
  });

  it('declares its width and height, and a poster image of the same frame ratio', () => {
    const problems = videos.flatMap((v) => {
      const out: string[] = [];
      if (!(v.width > 0) || !(v.height > 0)) out.push(`${v.template}: ${v.src} declares no width and height`);
      if (!/^images\/[\w.-]+\.png$/.test(v.poster) || !existsExact(join(PUBLIC, v.poster))) {
        out.push(`${v.template}: ${v.src} has no poster image in images/`);
      } else {
        const poster = intrinsicSize(join(PUBLIC, v.poster));
        if (Math.abs(poster.width / poster.height - v.width / v.height) > 0.02) {
          out.push(`${v.template}: ${v.src} is ${v.width}x${v.height} but its poster ${v.poster} is ${poster.width}x${poster.height}`);
        }
      }
      return out;
    });
    expect(problems).toEqual([]);
  });

  it('captions every clip in a figure', () => {
    expect(videos.filter((v) => !v.captioned).map((v) => `${v.template}: ${v.src}`)).toEqual([]);
  });
});
