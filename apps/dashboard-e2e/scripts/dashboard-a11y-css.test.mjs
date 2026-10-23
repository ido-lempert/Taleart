// `nx run dashboard-e2e:test`: the dashboard CSS fixes of the WCAG 2.2 AA scan (story 8.17), checked
// in the stylesheets, whatever their whitespace and comments. `nx run dashboard-e2e:a11y` checks them
// in the browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

/** CSS without comments, with runs of whitespace as one space and none around punctuation. */
export function normalize(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,()>])\s*/g, '$1')
    .trim();
}

const src = resolve(import.meta.dirname, '../../dashboard/src');
const styles = normalize(readFileSync(`${src}/styles.css`, 'utf8'));
const appCss = normalize(readFileSync(`${src}/app/app.css`, 'utf8'));
const studio = normalize(readFileSync(`${src}/app/pages/tale-studio.ts`, 'utf8'));

/** The value of a custom property of `:root`. */
function token(name) {
  const match = styles.match(new RegExp(`${name}:(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, `${name} is defined`);
  return match[1];
}

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The declarations of the first rule whose selector is exactly `selector` (normalized CSS). */
function rule(css, selector) {
  const head = `${normalize(selector)}{`;
  let at = css.indexOf(head);
  // A selector must start the rule: after `}`, `{`, `;` or at the start.
  while (at > 0 && !'{};'.includes(css[at - 1])) at = css.indexOf(head, at + 1);
  assert.ok(at >= 0, `${selector} has a rule`);
  return css.slice(at + head.length, css.indexOf('}', at));
}

/** The body of the `@media` block for `query` (normalized CSS). */
function media(css, query) {
  const head = `@media${normalize(query)}{`;
  const at = css.indexOf(head);
  assert.ok(at >= 0, `@media ${query} exists`);
  let depth = 0;
  for (let i = at + head.length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(at + head.length, i);
  }
  return css.slice(at);
}

test('normalize ignores whitespace and comments', () => {
  assert.equal(normalize('a  {\n  color : red ; /* x */\n}'), 'a{color:red;}');
  assert.equal(rule('x{a:b;}y{c:d;}', 'y'), 'c:d;');
});

test('a template description is readable on the chosen option (1.4.3)', () => {
  assert.match(rule(styles, '.template-option__desc'), /color:var\(--text-secondary\)/);
  assert.match(rule(styles, '.template-option:has(input:checked)'), /background:var\(--surface-sunken\)/);
  assert.ok(contrast(token('--text-secondary'), token('--surface-sunken')) >= 4.5);
  // Why the change: the muted grey is under 4.5:1 on the chosen option's background.
  assert.ok(contrast(token('--text-muted'), token('--surface-sunken')) < 4.5);
});

test('focus scrolls clear of the sticky top bar and the phone bottom bar (2.4.11)', () => {
  assert.match(rule(styles, 'html'), /scroll-padding-top:calc\(var\(--topbar-height\)/);
  assert.match(media(styles, '(max-width: 639.98px)'), /scroll-padding-bottom:calc\(var\(--bottombar-height\)/);
  // Where the top bar wraps to two rows, the padding covers both.
  assert.match(media(styles, '(max-width: 374.98px)'), /scroll-padding-top:calc\(2 \* var\(--topbar-height\)/);
});

test('the top bar wraps and its project switcher shrinks instead of scrolling sideways at 320 px (1.4.10)', () => {
  const narrow = media(appCss, '(max-width: 374.98px)');
  assert.match(rule(narrow, '.topbar'), /flex-wrap:wrap/);
  assert.match(rule(narrow, '.topbar__actions'), /margin-left:auto/);
  assert.match(rule(appCss, '.switcher'), /min-width:0/);
  const select = rule(appCss, '.switcher__select');
  assert.match(select, /width:100%/);
  assert.match(select, /min-width:0/);
});

test('a canvas element that fills the canvas shows its focus ring inside, under its badges (2.4.7)', () => {
  const ring = rule(studio, '.el:focus-visible::after');
  for (const part of [
    /position:absolute/,
    /inset:0/,
    /z-index:0/,
    /pointer-events:none/,
    /inset 0 0 0 2px var\(--ink\)/,
    /inset 0 0 0 5px #fff/,
  ]) {
    assert.match(ring, part);
  }
  // Tale Studio 7.10's low-contrast badge stays above the ring.
  assert.match(rule(studio, '.el__warn'), /z-index:2/);
  // Thinner on a tiny element.
  assert.match(rule(studio, '.el--tiny:focus-visible::after'), /inset 0 0 0 1px var\(--ink\),inset 0 0 0 2px #fff/);
});
