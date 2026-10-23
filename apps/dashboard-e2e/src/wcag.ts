import type { Locator, Page } from '@playwright/test';
import { axeViolations } from './axe';

/**
 * Targeted WCAG 2.2 AA checks that axe-core does not make (epic UX rework R18, story 8.17), run on
 * the page as it stands. Each returns findings as "criterion: what, where" lines; none is a pass.
 *
 * - 2.4.7 Focus visible and 2.4.11 Focus not obscured (minimum): a keyboard walk (Tab) over the
 *   page or the open dialog. At each stop the focused control must look different from the same
 *   control blurred: along at least one side of the control, a line at least 1 CSS px thick and half
 *   the side long changes. An ancestor's change counts only if its outline, box shadow, border colour
 *   or background changed (a card that draws its link's ring). Part of the control must be the
 *   topmost element at one of nine sampled points. A walk that reaches its limit before cycling is a
 *   finding.
 * - 2.5.8 Target size (minimum): every visible control is at least 24 × 24 CSS px, or a 24 px
 *   circle on its centre touches no other control nor another small control's circle; links inside
 *   a sentence are exempt.
 * - 1.4.10 Reflow: at 320 CSS px wide, no sideways page scroll, nothing past the left or right edge
 *   unless inside a scroll area, and no box cutting off content it showed whole at full width.
 * - 1.4.12 Text spacing: with the criterion's spacing applied, no text is cut and no two text boxes
 *   overlap that did not before (same nodes compared), at full width and at 320 px.
 */

/** Called with a short label while the page shows a finding, or the page at 320 px (for a screenshot). */
export type Evidence = (label: string) => Promise<void>;

/** Every kind of control a pointer can hit. */
const CONTROLS = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'select',
  'textarea',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  ...[
    'button',
    'switch',
    'tab',
    'link',
    'radio',
    'checkbox',
    'option',
    'menuitem',
    'menuitemradio',
    'menuitemcheckbox',
    'slider',
    'gridcell',
  ].map((role) => `[role=${role}]`),
].join(', ');

/** Helpers put on the page (through the DevTools protocol, so a page's CSP does not stop them). */
function helperScript(): string {
  return `
    window.__a11yDescribe = (el) => {
      if (!el || !el.tagName) return String(el);
      const tag = el.tagName.toLowerCase();
      const id = el.id ? '#' + el.id : '';
      const cls = !id && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : '';
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
      return tag + id + cls + (name ? ' "' + name + '"' : '');
    };
    window.__a11yDeepActive = () => {
      let el = document.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      return el;
    };
    window.__a11yHidden = (el) => {
      const r = el.getBoundingClientRect();
      return r.width <= 1 || r.height <= 1;
    };
    // The box a person sees as the control: a visually hidden input's label, else the element.
    window.__a11yBox = (el) => (window.__a11yHidden(el) && el.closest('label') ? el.closest('label') : el);
    // Every root to search: the document and each open shadow root, nested ones too.
    window.__a11yRoots = (scope) => {
      const roots = [scope];
      for (let i = 0; i < roots.length; i++) {
        for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
      }
      return roots;
    };
    // The parent, crossing out of a shadow root.
    window.__a11yParent = (n) => n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
    // The topmost element at a point, inside shadow roots.
    window.__a11yHit = (x, y) => {
      let hit = document.elementFromPoint(x, y);
      while (hit && hit.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
      }
      return hit;
    };
    // Whether part of an element is the topmost thing at one of nine points inside it and the window.
    window.__a11yOnTop = (el) => {
      const target = window.__a11yBox(el);
      const box = target.getBoundingClientRect();
      for (const fx of [0.15, 0.5, 0.85]) {
        for (const fy of [0.15, 0.5, 0.85]) {
          const x = box.left + box.width * fx;
          const y = box.top + box.height * fy;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          const hit = window.__a11yHit(x, y);
          if (hit && (hit === el || el.contains(hit) || target.contains(hit))) return true;
        }
      }
      return false;
    };
    // The computed styles that draw a focus indicator.
    window.__a11yRing = (el) => {
      const s = getComputedStyle(el);
      return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.borderRightColor,
        s.borderBottomColor, s.borderLeftColor, s.backgroundColor].join('|');
    };
  `;
}

async function prepare(page: Page): Promise<void> {
  if (!(await page.evaluate(() => '__a11yDescribe' in window))) await page.evaluate(helperScript());
}

type Win = Window & {
  __a11yDescribe(el: Element | null): string;
  __a11yDeepActive(): Element | null;
  __a11yHidden(el: Element): boolean;
  __a11yBox(el: Element): Element;
  __a11yRoots(scope: ParentNode): ParentNode[];
  __a11yParent(n: Element): Element | null;
  __a11yHit(x: number, y: number): Element | null;
  __a11yOnTop(el: Element): boolean;
  __a11yRing(el: Element): string;
  __a11yFocused?: HTMLElement | null;
  __a11yCut?: Set<Element>;
  __a11yTexts?: Text[];
  __a11yLayers?: (Element | null)[];
};

/** Waits until no finite animation or transition runs, then two frames. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Runs `run` with the viewport at `width` × 640, then puts it back. */
async function atWidth<T>(page: Page, width: number, run: () => Promise<T>): Promise<T> {
  const before = page.viewportSize();
  await page.setViewportSize({ width, height: 640 });
  await settle(page);
  try {
    return await run();
  } finally {
    if (before) await page.setViewportSize(before);
    await settle(page);
  }
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether two screenshots of `clip` differ along a side of `box` (both in CSS px of the viewport):
 * some row near the top or bottom edge, or some column near the left or right edge, within `pad`
 * of it, changes over at least half that side. Decoded and compared in the page.
 */
async function sideChanged(page: Page, a: Buffer, b: Buffer, clip: Rect, box: Rect, pad: number): Promise<boolean> {
  return page.evaluate(
    async ({ a, b, clip, box, pad }) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bitmap, 0, 0);
        return {
          data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
          width: bitmap.width,
          height: bitmap.height,
        };
      };
      const [pa, pb] = await Promise.all([decode(a), decode(b)]);
      const scale = pa.width / clip.width;
      const changed = (x: number, y: number) => {
        const px = Math.floor((x - clip.x) * scale);
        const py = Math.floor((y - clip.y) * scale);
        if (px < 0 || py < 0 || px >= pa.width || py >= pa.height) return false;
        const i = (py * pa.width + px) * 4;
        return (
          Math.abs(pa.data[i] - pb.data[i]) +
            Math.abs(pa.data[i + 1] - pb.data[i + 1]) +
            Math.abs(pa.data[i + 2] - pb.data[i + 2]) >
          24
        );
      };
      const line = (from: number, to: number, at: (t: number) => [number, number]) => {
        let hits = 0;
        let total = 0;
        for (let t = from; t < to; t += 1 / scale) {
          total++;
          if (changed(...at(t))) hits++;
        }
        return total > 0 && hits / total >= 0.5;
      };
      const left = Math.max(box.x, clip.x);
      const right = Math.min(box.x + box.width, clip.x + clip.width);
      const top = Math.max(box.y, clip.y);
      const bottom = Math.min(box.y + box.height, clip.y + clip.height);
      for (let d = -pad; d <= pad; d += 1 / scale) {
        if (line(left, right, (x) => [x, box.y + d])) return true;
        if (line(left, right, (x) => [x, box.y + box.height - 1 + d])) return true;
        if (line(top, bottom, (y) => [box.x + d, y])) return true;
        if (line(top, bottom, (y) => [box.x + box.width - 1 + d, y])) return true;
      }
      return false;
    },
    { a: a.toString('base64'), b: b.toString('base64'), clip, box, pad },
  );
}

/**
 * 2.4.7 and 2.4.11: Tab through the page from the top, or through the open dialog from where focus
 * is, until focus comes back to a stop met before or leaves the page; `max` stops at most.
 */
export async function focusWalk(page: Page, max = 60, stops: string[] = [], evidence?: Evidence): Promise<string[]> {
  await prepare(page);
  const findings: string[] = [];
  const seen = new Set<string>();
  let last = '';
  let repeats = 0;
  // On a page (no modal dialog open), walk from the top: focus a mark at the start of the body.
  await page.evaluate(() => {
    const open = [...document.querySelectorAll('[role=dialog][aria-modal=true]')].some(
      (d) => d.getBoundingClientRect().width > 0,
    );
    if (open) return;
    const mark = document.createElement('div');
    mark.id = 'a11y-walk-start';
    mark.tabIndex = -1;
    document.body.prepend(mark);
    mark.focus({ preventScroll: true });
    scrollTo(0, 0);
  });
  try {
    let cycled = false;
    for (let i = 0; i < max && !cycled; i++) cycled = await step();
    if (!cycled) findings.push(`walk: ${max} Tab stops without coming back to one (raise maxStops or look for a trap)`);
  } finally {
    await page.evaluate(() => document.getElementById('a11y-walk-start')?.remove());
  }
  return findings;

  /** One Tab; true when the walk is over. */
  async function step(): Promise<boolean> {
    await page.keyboard.press('Tab');
    const pad = 8;
    const stop = await page.evaluate((pad) => {
      const w = window as unknown as Win;
      const el = w.__a11yDeepActive();
      if (!el || el === document.body || el === document.documentElement) return null;
      // A stop's identity: its path in the document, so one control met again ends the walk.
      const path: string[] = [];
      for (let n: Element | null = el; n && n !== document.documentElement; n = w.__a11yParent(n)) {
        path.push(`${n.tagName}:${n.parentElement ? Array.prototype.indexOf.call(n.parentElement.children, n) : 0}`);
      }
      const rect = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      };
      const clipOf = (r: { x: number; y: number; width: number; height: number }) => {
        const x = Math.max(0, r.x - pad);
        const y = Math.max(0, r.y - pad);
        return {
          x,
          y,
          width: Math.min(innerWidth, r.x + r.width + pad) - x,
          height: Math.min(innerHeight, r.y + r.height + pad) - y,
        };
      };
      // The control, then its three nearest ancestors (a card whose link covers it draws the ring on
      // the card), with the styles that draw a ring.
      const areas: { box: ReturnType<typeof rect>; clip: ReturnType<typeof clipOf>; ring: string }[] = [];
      let around: Element | null = w.__a11yBox(el);
      for (let i = 0; around && i < 4; i++, around = w.__a11yParent(around)) {
        const box = rect(around);
        areas.push({ box, clip: clipOf(box), ring: w.__a11yRing(around) });
      }
      return { key: path.join('/'), name: w.__a11yDescribe(el), shown: w.__a11yOnTop(el), areas };
    }, pad);
    // A control with fields of its own (a date and time input: day, month, year, …) keeps focus over
    // several Tabs: the same control again at once is still the walk going on, not a cycle (7.15).
    // Ten times running it is the only stop there is (a dialog with one control): the walk is over.
    if (stop && stop.key === last && ++repeats < 10) return false;
    if (!stop || seen.has(stop.key)) return true;
    seen.add(stop.key);
    last = stop.key;
    repeats = 0;
    stops.push(stop.name);
    if (!stop.shown) {
      findings.push(`2.4.11 focus obscured: ${stop.name}`);
      await evidence?.('focus-obscured');
    }
    const areas = stop.areas.filter((a) => a.clip.width >= 1 && a.clip.height >= 1);
    if (areas.length === 0) return false;
    // 2.4.7: the control with focus looks different from the control without it.
    const focused: Buffer[] = [];
    for (const { clip } of areas) focused.push(await page.screenshot({ clip, animations: 'disabled' }));
    const rings = await page.evaluate((count) => {
      const w = window as unknown as Win;
      const el = w.__a11yDeepActive() as HTMLElement | null;
      w.__a11yFocused = el;
      el?.blur();
      const out: string[] = [];
      let around: Element | null = el ? w.__a11yBox(el) : null;
      for (let i = 0; around && i < count; i++, around = w.__a11yParent(around)) out.push(w.__a11yRing(around));
      return out;
    }, stop.areas.length);
    let visible = false;
    for (const [i, area] of areas.entries()) {
      // The control's own area always counts; an ancestor's only if its ring styles changed.
      const index = stop.areas.indexOf(area);
      if (index > 0 && rings[index] === area.ring) continue;
      const blurred = await page.screenshot({ clip: area.clip, animations: 'disabled' });
      if (await sideChanged(page, focused[i], blurred, area.clip, area.box, pad)) {
        visible = true;
        break;
      }
    }
    await page.evaluate(() => (window as unknown as Win).__a11yFocused?.focus());
    if (!visible) {
      findings.push(`2.4.7 no visible focus: ${stop.name}`);
      await evidence?.('no-visible-focus');
    }
    return false;
  }
}

/** 2.5.8: the controls of the page (or the open dialog) that are too small and too close. */
export async function targetSize(page: Page): Promise<string[]> {
  await prepare(page);
  return page.evaluate((selector) => {
    const w = window as unknown as Win;
    const dialogs = [...document.querySelectorAll('[role=dialog][aria-modal=true]')].filter(
      (d) => d.getBoundingClientRect().width > 0,
    );
    const scope: ParentNode = dialogs.at(-1) ?? document;
    const targets: { el: Element; r: DOMRect }[] = [];
    for (const root of w.__a11yRoots(scope)) {
      for (const raw of root.querySelectorAll(selector)) {
        const el = w.__a11yBox(raw);
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1 || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
        if (raw.closest('[inert], [aria-hidden=true]')) continue;
        // Covered (under a sticky bar, a drawer's backdrop): not a target now.
        if (!w.__a11yOnTop(raw)) continue;
        // Inline: a link in a sentence (2.5.8 exception).
        if (raw.tagName === 'A' && style.display === 'inline') {
          const parentText = [...(raw.parentElement?.childNodes ?? [])].some(
            (n) => n !== raw && n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
          );
          if (parentText) continue;
        }
        if (targets.some((t) => t.el === el)) continue;
        targets.push({ el, r });
      }
    }
    // Under 24 px, with room for layout rounding (23.999… is 24).
    const small = targets.filter(({ r }) => r.width < 24 - 0.01 || r.height < 24 - 0.01);
    const findings: string[] = [];
    for (const s of small) {
      const cx = s.r.left + s.r.width / 2;
      const cy = s.r.top + s.r.height / 2;
      const clash = targets.find((t) => {
        if (t === s || t.el.contains(s.el) || s.el.contains(t.el)) return false;
        if (small.includes(t))
          return Math.hypot(t.r.left + t.r.width / 2 - cx, t.r.top + t.r.height / 2 - cy) < 24 - 0.01;
        const nx = Math.max(t.r.left, Math.min(cx, t.r.right));
        const ny = Math.max(t.r.top, Math.min(cy, t.r.bottom));
        return Math.hypot(nx - cx, ny - cy) < 12 - 0.01;
      });
      if (clash) {
        findings.push(
          `2.5.8 target ${Math.round(s.r.width)}×${Math.round(s.r.height)} too close to ${w.__a11yDescribe(clash.el)}: ${w.__a11yDescribe(s.el)}`,
        );
      }
    }
    return findings;
  }, CONTROLS);
}

/** Records, in the page, the boxes that cut off content now (hidden or clip overflow). */
async function markCut(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Win;
    const cut = new Set<Element>();
    for (const root of w.__a11yRoots(document)) {
      for (const el of root.querySelectorAll('*')) {
        const h = el as HTMLElement;
        const s = getComputedStyle(el);
        const cuts = (o: string) => o === 'hidden' || o === 'clip';
        if (el === document.documentElement || el === document.body) continue;
        if (w.__a11yHidden(el) || s.visibility === 'hidden') continue;
        if (
          (cuts(s.overflowX) && h.scrollWidth > h.clientWidth + 1) ||
          (cuts(s.overflowY) && h.scrollHeight > h.clientHeight + 1)
        )
          cut.add(el);
      }
    }
    w.__a11yCut = cut;
  });
}

/** The boxes that cut off content now and did not at the last `markCut`. */
async function newlyCut(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    const before = w.__a11yCut ?? new Set<Element>();
    const out: string[] = [];
    for (const root of w.__a11yRoots(document)) {
      for (const el of root.querySelectorAll('*')) {
        const h = el as HTMLElement;
        const s = getComputedStyle(el);
        const cuts = (o: string) => o === 'hidden' || o === 'clip';
        if (el === document.documentElement || el === document.body) continue;
        if (before.has(el) || w.__a11yHidden(el) || s.visibility === 'hidden') continue;
        if (
          (cuts(s.overflowX) && h.scrollWidth > h.clientWidth + 1) ||
          (cuts(s.overflowY) && h.scrollHeight > h.clientHeight + 1)
        )
          out.push(w.__a11yDescribe(el));
      }
    }
    return out;
  });
}

/** 1.4.10: at 320 CSS px wide, the page does not scroll sideways and nothing is cut or sticks out. */
export async function reflow(page: Page, evidence?: Evidence): Promise<string[]> {
  await prepare(page);
  await markCut(page);
  return atWidth(page, 320, async () => {
    const findings = await page.evaluate(() => {
      const w = window as unknown as Win;
      const out: string[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth + 1)
        out.push(`1.4.10 page scrolls sideways at 320 px (${doc.scrollWidth} px wide)`);
      const width = doc.clientWidth;
      // Inside a box that cuts or scrolls its overflow: a scroll area is fine, a cut is judged below.
      const contained = (el: Element): boolean => {
        for (let n = w.__a11yParent(el); n && n !== document.body; n = w.__a11yParent(n)) {
          if (getComputedStyle(n).overflowX !== 'visible') return true;
        }
        return false;
      };
      const out1 = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > width + 1 || r.left < -1);
      };
      let count = 0;
      for (const el of document.body.querySelectorAll('*')) {
        if (!out1(el) || contained(el)) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || w.__a11yHidden(el)) continue;
        // Only the outermost element that sticks out.
        const parent = el.parentElement;
        if (parent && parent !== document.body && out1(parent) && !contained(parent)) continue;
        const r = el.getBoundingClientRect();
        out.push(
          `1.4.10 past the ${r.left < -1 ? 'left' : 'right'} edge at 320 px (${Math.round(r.left)} to ${Math.round(r.right)} px): ${w.__a11yDescribe(el)}`,
        );
        if (++count >= 5) break;
      }
      return out;
    });
    findings.push(...(await newlyCut(page)).map((name) => `1.4.10 content cut at 320 px: ${name}`));
    await evidence?.(findings.length > 0 ? 'reflow-320-finding' : 'at-320');
    return findings;
  });
}

/** 1.4.12 at the current width: text cut, or text boxes overlapping, with the spacing applied. */
export async function textSpacing(page: Page, where = ''): Promise<string[]> {
  await prepare(page);
  await markCut(page);
  // The text nodes of the page (or of the open dialog), each with its layer: the nearest fixed or
  // sticky ancestor. Text in different layers may overlap by design (a sticky bar over the page).
  await page.evaluate(() => {
    const w = window as unknown as Win;
    const dialogs = [...document.querySelectorAll('[role=dialog][aria-modal=true]')].filter(
      (d) => d.getBoundingClientRect().width > 0,
    );
    const texts: Text[] = [];
    for (const root of w.__a11yRoots(dialogs.at(-1) ?? document)) {
      const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim()) texts.push(n as Text);
    }
    w.__a11yTexts = texts;
    w.__a11yLayers = texts.map((t) => {
      for (let n = t.parentElement; n; n = w.__a11yParent(n)) {
        const position = getComputedStyle(n).position;
        if (position === 'fixed' || position === 'sticky') return n;
      }
      return null;
    });
  });
  const overlaps = () =>
    page.evaluate(() => {
      const w = window as unknown as Win;
      const texts = w.__a11yTexts ?? [];
      const layers = w.__a11yLayers ?? [];
      // Each text node's line boxes, cut to what its scrolling or clipping ancestors show.
      const boxes = texts.map((t) => {
        const host = t.parentElement;
        if (!host || !host.isConnected || w.__a11yHidden(host) || getComputedStyle(host).visibility === 'hidden')
          return [];
        let view = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
        for (let n: Element | null = host; n; n = w.__a11yParent(n)) {
          const s = getComputedStyle(n);
          if (n === document.documentElement || (s.overflowX === 'visible' && s.overflowY === 'visible')) continue;
          const r = n.getBoundingClientRect();
          view = {
            left: Math.max(view.left, r.left),
            top: Math.max(view.top, r.top),
            right: Math.min(view.right, r.right),
            bottom: Math.min(view.bottom, r.bottom),
          };
        }
        const range = document.createRange();
        range.selectNodeContents(t);
        return [...range.getClientRects()]
          .map((r) => ({
            left: Math.max(r.left, view.left),
            top: Math.max(r.top, view.top),
            right: Math.min(r.right, view.right),
            bottom: Math.min(r.bottom, view.bottom),
          }))
          .filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1);
      });
      const meet = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
        a.some((ra) =>
          b.some(
            (rb) =>
              Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 2 &&
              Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 2,
          ),
        );
      const pairs: string[] = [];
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length === 0) continue;
        for (let j = i + 1; j < boxes.length; j++) {
          if (boxes[j].length === 0 || layers[i] !== layers[j]) continue;
          if (meet(boxes[i], boxes[j])) pairs.push(`${i}:${j}`);
        }
      }
      return pairs;
    });
  const overlapBefore = new Set(await overlaps());
  const css = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
  await page.evaluate((text) => {
    const w = window as unknown as Win;
    for (const root of w.__a11yRoots(document)) {
      const style = document.createElement('style');
      style.className = 'a11y-text-spacing';
      style.textContent = text;
      (root instanceof Document ? root.head : root).appendChild(style);
    }
  }, css);
  await settle(page);
  const cut = await newlyCut(page);
  const overlapAfter = (await overlaps()).filter((pair) => !overlapBefore.has(pair));
  const overlapNames = await page.evaluate((pairs) => {
    const w = window as unknown as Win;
    const texts = w.__a11yTexts ?? [];
    return pairs.map((pair) => {
      const [i, j] = pair.split(':').map(Number);
      return `${w.__a11yDescribe(texts[i].parentElement)} and ${w.__a11yDescribe(texts[j].parentElement)}`;
    });
  }, overlapAfter);
  await page.evaluate(() => {
    const w = window as unknown as Win;
    for (const root of w.__a11yRoots(document)) root.querySelectorAll('.a11y-text-spacing').forEach((s) => s.remove());
  });
  await settle(page);
  const at = where ? ` ${where}` : '';
  return [
    ...cut.map((name) => `1.4.12 text cut with text spacing${at}: ${name}`),
    ...overlapNames.map((names) => `1.4.12 text overlaps with text spacing${at}: ${names}`),
  ];
}

export interface ScanOptions {
  /** Walk the page with Tab (2.4.7, 2.4.11). On by default. */
  walk?: boolean;
  /** Check 1.4.10 at 320 px and 1.4.12 (full width and 320 px). Off by default (once per screen). */
  layout?: boolean;
  /** Called with a short label while the page shows a finding, or the page at 320 px. */
  evidence?: Evidence;
  /** Filled with the names of the walk's Tab stops, in order. */
  stops?: string[];
  /** How many Tab stops at most; reaching it without cycling is a finding. */
  maxStops?: number;
}

/** axe-core's WCAG 2.2 AA rules plus the targeted checks above, as one list of findings. */
export async function scan(page: Page, options: ScanOptions = {}): Promise<string[]> {
  await settle(page);
  const findings = (await axeViolations(page)).map((v) => `axe ${v}`);
  findings.push(...(await targetSize(page)));
  if (options.layout) {
    findings.push(...(await reflow(page, options.evidence)));
    findings.push(...(await textSpacing(page)));
    findings.push(...(await atWidth(page, 320, () => textSpacing(page, 'at 320 px'))));
  }
  if (options.walk !== false)
    findings.push(...(await focusWalk(page, options.maxStops, options.stops, options.evidence)));
  return findings;
}

/** Whether part of the control is the topmost element in the window (2.4.11), for a single check. */
export async function onTop(target: Locator): Promise<boolean> {
  await prepare(target.page());
  return target.evaluate((el) => (window as unknown as Win).__a11yOnTop(el));
}
