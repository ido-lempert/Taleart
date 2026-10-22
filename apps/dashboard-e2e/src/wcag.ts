import type { Page } from '@playwright/test';
import { axeViolations } from './axe';

/**
 * Targeted WCAG 2.2 AA checks that axe-core does not make (epic UX rework R18, story 8.17), run on
 * the page as it stands. Each returns findings as "criterion: what, where" lines; none is a pass.
 *
 * - 2.4.7 Focus visible and 2.4.11 Focus not obscured (minimum): a keyboard walk (Tab) over the
 *   page or the open dialog; at each stop the focused control looks different from the same control
 *   unfocused (pixels compared), and part of it is the topmost element at sampled points.
 * - 2.5.8 Target size (minimum): every visible control is at least 24 × 24 CSS px, or a 24 px
 *   circle on its centre touches no other control nor another small control's circle; links inside
 *   a sentence are exempt.
 * - 1.4.10 Reflow: at 320 CSS px wide, no sideways page scroll and nothing past the right edge
 *   that is not inside a scroll area.
 * - 1.4.12 Text spacing: with the criterion's spacing applied, no text is cut that was not cut
 *   before.
 */

/** Called with a short label while the page shows a finding, or the page at 320 px (for a screenshot). */
export type Evidence = (label: string) => Promise<void>;

/** Where the controls of the page are: inside the top modal dialog if one is open, else the page. */
const CONTROLS =
  'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=switch], [role=tab], [role=menuitem], [role=radio], [role=checkbox], [role=link], [tabindex]:not([tabindex="-1"])';

/** A short name of an element, for findings: tag, id or first class, and its accessible text. */
function describeScript(): string {
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
  `;
}

async function prepare(page: Page): Promise<void> {
  // Through the DevTools protocol, so a page's CSP (the test page's) does not stop it.
  if (!(await page.evaluate(() => '__a11yDescribe' in window))) await page.evaluate(describeScript());
}

type Win = Window & {
  __a11yDescribe(el: Element | null): string;
  __a11yDeepActive(): Element | null;
  __a11yHidden(el: Element): boolean;
  __a11yBox(el: Element): Element;
  __a11yFocused?: HTMLElement | null;
};

/**
 * 2.4.7 and 2.4.11: Tab through the page (or the open dialog) from where focus is, up to `max`
 * stops or until focus comes back to the first stop or leaves the page.
 */
export async function focusWalk(page: Page, max = 60, stops: string[] = [], evidence?: Evidence): Promise<string[]> {
  await prepare(page);
  const findings: string[] = [];
  const seen = new Set<string>();
  // On a page (no modal dialog open), walk from the top: focus a mark at the start of the body.
  // In a dialog, from where focus is: Tab stays inside it.
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
    await walk();
  } finally {
    await page.evaluate(() => document.getElementById('a11y-walk-start')?.remove());
  }
  return findings;

  async function walk(): Promise<void> {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const w = window as unknown as Win;
        const el = w.__a11yDeepActive();
        if (!el || el === document.body || el === document.documentElement) return null;
        // A stop's identity: its path in the document, so one control met again ends the walk.
        const path: string[] = [];
        for (
          let n: Element | null = el;
          n && n !== document.documentElement;
          n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host || null)
        ) {
          path.push(`${n.tagName}:${n.parentElement ? Array.prototype.indexOf.call(n.parentElement.children, n) : 0}`);
        }
        const box = w.__a11yBox(el).getBoundingClientRect();
        // 2.4.11: part of the control is on top at one of nine points inside it and inside the window.
        let shown = false;
        for (const fx of [0.15, 0.5, 0.85]) {
          for (const fy of [0.15, 0.5, 0.85]) {
            const x = box.left + box.width * fx;
            const y = box.top + box.height * fy;
            if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
            let hit: Element | null = document.elementFromPoint(x, y);
            while (hit && hit.shadowRoot) {
              const inner = hit.shadowRoot.elementFromPoint(x, y);
              if (!inner || inner === hit) break;
              hit = inner;
            }
            const target = w.__a11yBox(el);
            if (hit && (hit === el || el.contains(hit) || target.contains(hit))) shown = true;
          }
        }
        // Where a focus indicator may be drawn: around the control, or around one of its three
        // nearest ancestors (a card whose link covers it draws the ring on the card).
        const pad = 8;
        const clips: { x: number; y: number; width: number; height: number }[] = [];
        let around: Element | null = w.__a11yBox(el);
        for (let i = 0; around && i < 4; i++, around = around.parentElement) {
          const r = around.getBoundingClientRect();
          const clip = {
            x: Math.max(0, r.left - pad),
            y: Math.max(0, r.top - pad),
            width: Math.min(innerWidth, r.right + pad) - Math.max(0, r.left - pad),
            height: Math.min(innerHeight, r.bottom + pad) - Math.max(0, r.top - pad),
          };
          if (clip.width >= 1 && clip.height >= 1) clips.push(clip);
        }
        return { key: path.join('/'), name: w.__a11yDescribe(el), shown, clips };
      });
      if (!stop) break;
      if (seen.has(stop.key)) break;
      seen.add(stop.key);
      stops.push(stop.name);
      if (!stop.shown) {
        findings.push(`2.4.11 focus obscured: ${stop.name}`);
        await evidence?.('focus-obscured');
      }
      if (stop.clips.length === 0) continue;
      // 2.4.7: the control with focus looks different from the control without it.
      const focused: Buffer[] = [];
      for (const clip of stop.clips) focused.push(await page.screenshot({ clip, animations: 'disabled' }));
      await page.evaluate(() => {
        const w = window as unknown as Win;
        w.__a11yFocused = w.__a11yDeepActive() as HTMLElement | null;
        w.__a11yFocused?.blur();
      });
      let changed = false;
      for (const [i, clip] of stop.clips.entries()) {
        if (!focused[i].equals(await page.screenshot({ clip, animations: 'disabled' }))) {
          changed = true;
          break;
        }
      }
      await page.evaluate(() => (window as unknown as Win).__a11yFocused?.focus());
      if (!changed) {
        findings.push(`2.4.7 no visible focus: ${stop.name}`);
        await evidence?.('no-visible-focus');
      }
    }
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
    const roots: ParentNode[] = [scope];
    for (const host of scope.querySelectorAll('*')) if (host.shadowRoot) roots.push(host.shadowRoot);
    const targets: { el: Element; r: DOMRect }[] = [];
    for (const root of roots) {
      for (const raw of root.querySelectorAll(selector)) {
        const el = w.__a11yBox(raw);
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1 || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
        if (raw.closest('[inert], [aria-hidden=true]')) continue;
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
    const small = targets.filter(({ r }) => r.width < 23.5 || r.height < 23.5);
    const findings: string[] = [];
    for (const s of small) {
      const cx = s.r.left + s.r.width / 2;
      const cy = s.r.top + s.r.height / 2;
      const clash = targets.find((t) => {
        if (t === s || t.el.contains(s.el) || s.el.contains(t.el)) return false;
        const isSmall = small.includes(t);
        if (isSmall) return Math.hypot(t.r.left + t.r.width / 2 - cx, t.r.top + t.r.height / 2 - cy) < 24;
        const nx = Math.max(t.r.left, Math.min(cx, t.r.right));
        const ny = Math.max(t.r.top, Math.min(cy, t.r.bottom));
        return Math.hypot(nx - cx, ny - cy) < 12;
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

/** 1.4.10: at 320 CSS px wide, the page does not scroll sideways and nothing sticks out. */
export async function reflow(page: Page, evidence?: Evidence): Promise<string[]> {
  await prepare(page);
  const before = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(400);
  const findings = await page.evaluate(() => {
    const w = window as unknown as Win;
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1)
      out.push(`1.4.10 page scrolls sideways at 320 px (${doc.scrollWidth} px wide)`);
    const width = doc.clientWidth;
    const clipped = (el: Element): boolean => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if (o !== 'visible') return true;
      }
      return false;
    };
    let count = 0;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= width + 1 || r.left >= width) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || (style.position === 'fixed' && r.left >= width)) continue;
      if (clipped(el)) continue;
      // Only the outermost element that sticks out.
      if (el.parentElement && el.parentElement.getBoundingClientRect().right > width + 1 && !clipped(el.parentElement))
        continue;
      out.push(`1.4.10 past the right edge at 320 px (${Math.round(r.right)} px): ${w.__a11yDescribe(el)}`);
      if (++count >= 5) break;
    }
    return out;
  });
  await evidence?.(findings.length > 0 ? 'reflow-320-finding' : 'at-320');
  if (before) await page.setViewportSize(before);
  await page.waitForTimeout(300);
  return findings;
}

/** 1.4.12: text cut with the criterion's spacing applied that was whole without it. */
export async function textSpacing(page: Page): Promise<string[]> {
  await prepare(page);
  const cut = () =>
    page.evaluate(() => {
      const w = window as unknown as Win;
      const out: string[] = [];
      const walk = (root: ParentNode) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) walk(el.shadowRoot);
          const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
          if (!hasText) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) continue;
          // The nearest box that cuts its overflow: the element or an ancestor up to three levels.
          let n: Element | null = el;
          for (let i = 0; n && i < 4; i++, n = n.parentElement) {
            const s = getComputedStyle(n);
            const cuts = (o: string) => o === 'hidden' || o === 'clip';
            const h = n as HTMLElement;
            if (
              (cuts(s.overflowX) && h.scrollWidth > h.clientWidth + 1) ||
              (cuts(s.overflowY) && h.scrollHeight > h.clientHeight + 1)
            ) {
              const nr = n.getBoundingClientRect();
              if (nr.width > 1 && nr.height > 1) out.push(w.__a11yDescribe(el));
              break;
            }
          }
        }
      };
      walk(document);
      return out;
    });
  const before = new Set(await cut());
  const css = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
  await page.evaluate((text) => {
    const add = (root: Document | ShadowRoot) => {
      const style = document.createElement('style');
      style.id = 'a11y-text-spacing';
      style.textContent = text;
      (root instanceof Document ? root.head : root).appendChild(style);
    };
    add(document);
    for (const host of document.querySelectorAll('*')) if (host.shadowRoot) add(host.shadowRoot);
  }, css);
  await page.waitForTimeout(300);
  const after = await cut();
  await page.evaluate(() => {
    document.querySelectorAll('#a11y-text-spacing').forEach((s) => s.remove());
    for (const host of document.querySelectorAll('*'))
      host.shadowRoot?.querySelectorAll('#a11y-text-spacing').forEach((s) => s.remove());
  });
  return [...new Set(after.filter((name) => !before.has(name)))].map(
    (name) => `1.4.12 text cut with text spacing: ${name}`,
  );
}

export interface ScanOptions {
  /** Walk the page with Tab (2.4.7, 2.4.11). On by default. */
  walk?: boolean;
  /** Check 1.4.10 at 320 px and 1.4.12. Off by default (once per screen is enough). */
  layout?: boolean;
  /** Called with a short label while the page shows a finding, or the page at 320 px. */
  evidence?: Evidence;
  /** Filled with the names of the walk's Tab stops, in order. */
  stops?: string[];
  /** How many Tab stops at most. */
  maxStops?: number;
}

/** axe-core's WCAG 2.2 AA rules plus the targeted checks above, as one list of findings. */
export async function scan(page: Page, options: ScanOptions = {}): Promise<string[]> {
  const findings = (await axeViolations(page)).map((v) => `axe ${v}`);
  findings.push(...(await targetSize(page)));
  if (options.layout) {
    findings.push(...(await reflow(page, options.evidence)));
    findings.push(...(await textSpacing(page)));
  }
  if (options.walk !== false)
    findings.push(...(await focusWalk(page, options.maxStops, options.stops, options.evidence)));
  return findings;
}
