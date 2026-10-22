// `nx run dashboard-e2e:test`: the dashboard CSS fixes of the WCAG 2.2 AA scan (story 8.17), checked
// in the stylesheets. `nx run dashboard-e2e:a11y` checks them in the browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const src = resolve(import.meta.dirname, '../../dashboard/src');
const styles = readFileSync(`${src}/styles.css`, 'utf8');
const appCss = readFileSync(`${src}/app/app.css`, 'utf8');
const studio = readFileSync(`${src}/app/pages/tale-studio.ts`, 'utf8');

/** The value of a custom property of `:root`. */
function token(name) {
  const match = styles.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
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

/** The declarations of the first rule whose selector is exactly `selector`, after `from`. */
function rule(css, selector, from = 0) {
  const at = css.indexOf(`${selector} {`, from);
  assert.ok(at >= 0, `${selector} has a rule`);
  return css.slice(at, css.indexOf('}', at));
}

/** The text of the `@media` block for `query`. */
function media(css, query) {
  const at = css.indexOf(`@media ${query} {`);
  assert.ok(at >= 0, `@media ${query} exists`);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(at, i);
  }
  return css.slice(at);
}

test('a template description is readable on the chosen option (1.4.3)', () => {
  assert.match(rule(styles, '.template-option__desc'), /color:\s*var\(--text-secondary\)/);
  assert.match(rule(styles, '.template-option:has(input:checked)'), /background:\s*var\(--surface-sunken\)/);
  assert.ok(contrast(token('--text-secondary'), token('--surface-sunken')) >= 4.5);
  // Why the change: the muted grey is under 4.5:1 on the chosen option's background.
  assert.ok(contrast(token('--text-muted'), token('--surface-sunken')) < 4.5);
});

test('focus scrolls clear of the sticky top bar and the phone bottom bar (2.4.11)', () => {
  assert.match(rule(styles, 'html'), /scroll-padding-top:\s*calc\(var\(--topbar-height\)/);
  assert.match(media(styles, '(max-width: 639.98px)'), /scroll-padding-bottom:\s*calc\(var\(--bottombar-height\)/);
  // Where the top bar wraps to two rows, the padding covers both.
  assert.match(media(styles, '(max-width: 374.98px)'), /scroll-padding-top:\s*calc\(2 \* var\(--topbar-height\)/);
});

test('the top bar wraps instead of scrolling sideways at 320 px (1.4.10)', () => {
  const narrow = media(appCss, '(max-width: 374.98px)');
  assert.match(narrow, /\.topbar \{[^}]*flex-wrap:\s*wrap/);
  assert.match(narrow, /\.topbar__actions \{[^}]*margin-left:\s*auto/);
});

test('a canvas element that fills the canvas shows its focus ring inside (2.4.7)', () => {
  const ring = rule(studio, '    .el:focus-visible::after');
  assert.match(ring, /position:\s*absolute/);
  assert.match(ring, /inset:\s*0/);
  assert.match(ring, /pointer-events:\s*none/);
  assert.match(ring, /inset 0 0 0 2px var\(--ink\)/);
  assert.match(ring, /inset 0 0 0 5px #fff/);
});
