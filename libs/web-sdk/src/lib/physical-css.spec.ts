import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// The Web SDK's styles and inline styles use logical properties, so the page's direction reaches every
// layout (handoff 3.1). This scan fails when a physical direction comes back in the SDK's source. The
// justified ones are in ALLOWED below, each with its reason; an entry that no longer matches any line
// fails too, so the list cannot go stale.

// The physical directions (comment lines are not code, so they are skipped).
const PHYSICAL: readonly { name: string; pattern: RegExp }[] = [
  { name: 'left: / right:', pattern: /(?<![\w-])(left|right)\s*:/ },
  { name: 'margin-left / padding-right / border-left', pattern: /\b(margin|padding|border)-(left|right)\b/ },
  { name: 'text-align: left | right', pattern: /text-align\s*:\s*(left|right)\b/ },
  { name: 'transform-origin: left | right', pattern: /transform-origin\s*:\s*(left|right)\b/ },
  { name: 'float', pattern: /(?<![\w-])float\s*:/ },
  { name: 'style.left / style.right', pattern: /\.style\.(left|right)\s*=/ },
  { name: 'translateX(', pattern: /translateX\(/ },
];

// Each justified line: the file, a text the line contains, and why it stays physical or is mirrored by hand.
const ALLOWED: readonly { file: string; includes: string; reason: string }[] = [
  {
    file: 'lib/document/renderer.ts',
    includes: 'right: env(safe-area-inset-right',
    reason: 'the device safe area: the notches sit on the physical sides whatever the direction.',
  },
  {
    file: 'lib/document/renderer.ts',
    includes: 'left: env(safe-area-inset-left',
    reason: 'the device safe area: the notches sit on the physical sides whatever the direction.',
  },
  {
    file: 'lib/document/renderer.ts',
    includes: 'border-left: 0.16em solid currentColor',
    reason: 'the swipe-up chevron points up in both directions; the arrow is vertical, not directional.',
  },
  {
    file: 'lib/document/renderer.ts',
    includes: 'style.left = `${x * 100}%`',
    reason:
      'an element of a tale sits where its author placed it on the canvas, as the editor shows it; mirroring the canvas would move the author\'s composition.',
  },
  {
    file: 'lib/viewer.ts',
    includes: '.viewer[data-rtl] .fill { transform-origin: right; }',
    reason: 'the progress of a right-to-left viewer grows from the right: the rule the `data-rtl` attribute selects.',
  },
  {
    file: 'lib/viewer.ts',
    includes: 'transform-origin: left;',
    reason: 'transform-origin takes no logical keyword; the next rule (`.viewer[data-rtl] .fill`) turns it to the right.',
  },
  {
    file: 'lib/viewer.ts',
    includes: 'translateX(0px)',
    reason: 'a zero offset (the card in place): no direction in it.',
  },
  {
    file: 'lib/viewer.ts',
    includes: 'translateX(${dir * width * 0.7}px)',
    reason: 'the group change slides the card from the side the group moves to: `dir` is multiplied by -1 when the page is right to left.',
  },
  {
    file: 'lib/viewer.ts',
    includes: 'translateX(${x}px)',
    reason: 'a side card: `slot()` gives its offset sign by `this.rtl`, so the next tale is always on the inline end side.',
  },
  {
    file: 'lib/banner.ts',
    includes: 'translateX(${(isRtl(root) ? 100 : -100) * index}%)',
    reason: 'the slides run from the start of the line: the track moves the way the page reads, by `isRtl`.',
  },
];

const SRC = join(__dirname, '..');
// The entries name files as the scan does: from src, such as `lib/viewer.ts`.

// Every non-spec TypeScript file of the SDK's source, as paths relative to src.
function sources(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.spec-d.ts') ? [relative(SRC, path)] : [];
  });
}

// The physical directions in a file's code lines: [line number, direction name, line text].
function violationsIn(text: string): [number, string, string][] {
  const found: [number, string, string][] = [];
  text.split('\n').forEach((line, index) => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    // A trailing comment is not code: `// ... right to left: ...` says nothing about a direction.
    const body = line.replace(/\s\/\/\s.*$/, '');
    for (const { name, pattern } of PHYSICAL) if (pattern.test(body)) found.push([index + 1, name, code]);
  });
  return found;
}

const allowed = (file: string, line: string) => ALLOWED.find((entry) => entry.file === file && line.includes(entry.includes));

describe('the Web SDK source uses logical directions only', () => {
  it('flags each physical direction it is written to catch', () => {
    expect(violationsIn('.a { margin-left: 2px; }')).toHaveLength(1);
    expect(violationsIn('.a { text-align: right; }')).toHaveLength(1);
    expect(violationsIn('.a { left: 0; }')).toHaveLength(1);
    expect(violationsIn('el.style.right = "0";')).toHaveLength(1);
    expect(violationsIn("track.style.transform = `translateX(${n}%)`;")).toHaveLength(1);
    expect(violationsIn('.a { inset-inline-start: 0; text-align: start; }')).toEqual([]);
    expect(violationsIn('// margin-left: is a comment, not code')).toEqual([]);
  });

  it('has no physical direction in any source file that the allow-list does not justify', () => {
    const unjustified: string[] = [];
    for (const file of sources()) {
      const text = readFileSync(join(SRC, file), 'utf8');
      for (const [line, name, code] of violationsIn(text)) {
        if (!allowed(file.split('\\').join('/'), code)) unjustified.push(`${file}:${line} (${name}): ${code}`);
      }
    }
    expect(unjustified).toEqual([]);
  });

  it('keeps every allow-list entry live, with its reason', () => {
    const lines = sources().flatMap((file) =>
      readFileSync(join(SRC, file), 'utf8')
        .split('\n')
        .map((line) => ({ file: file.split('\\').join('/'), line: line.trim() })),
    );
    for (const entry of ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(lines.some((l) => l.file === entry.file && l.line.includes(entry.includes)), entry.includes).toBe(true);
    }
  });
});
