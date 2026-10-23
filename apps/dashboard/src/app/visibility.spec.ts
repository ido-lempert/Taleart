import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GroupAudience, Visibility, VisibilitySubject } from '@taleart/contract/core';
import { formatLocal } from './schedule';
import { TIP_HIDE_DELAY_MS, tipPosition, visibilityLine, VisibilityIndicator } from './visibility';

@Component({
  imports: [VisibilityIndicator],
  template: `
    <div class="tale-card">
      <app-visibility
        [visibility]="visibility()"
        [viewing]="viewing()"
        [compact]="compact()"
        [anyZone]="anyZone()"
        [targeting]="targeting()"
      />
    </div>
  `,
})
class Host {
  readonly visibility = signal<Visibility | undefined>(undefined);
  readonly viewing = signal<VisibilitySubject>('tale');
  readonly compact = signal(false);
  readonly anyZone = signal(false);
  readonly targeting = signal<GroupAudience | null>(null);
}

const at = '2026-12-01T09:00:00.000Z';
const notVisible: Visibility = {
  visible: false,
  reasons: [
    { code: 'group-off', subject: 'group' },
    { code: 'starts-at', subject: 'tale', at },
    { code: 'zone-no-display', subject: 'zone' },
  ],
};
const VISIBLE: Visibility = { visible: true, reasons: [] };

function render(
  visibility: Visibility | undefined,
  viewing: VisibilitySubject = 'tale',
  compact = false,
  anyZone = false,
  targeting: GroupAudience | null = null,
) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.targeting.set(targeting);
  fixture.componentInstance.visibility.set(visibility);
  fixture.componentInstance.viewing.set(viewing);
  fixture.componentInstance.compact.set(compact);
  fixture.componentInstance.anyZone.set(anyZone);
  fixture.detectChanges();
  document.body.appendChild(fixture.nativeElement);
  const host = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-visibility');
  if (!host) throw new Error('no indicator');
  const open = () => host.classList.contains('visibility--open');
  return { fixture, host, open };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('VisibilityIndicator (epic UX rework R7)', () => {
  afterEach(() => vi.useRealTimers());

  it('shows a filled dot and "Visible on site", with nothing to open', () => {
    const { host } = render(VISIBLE, 'zone');
    expect(host.classList).toContain('visibility--visible');
    expect(text(host)).toBe('Visible on site');
    expect(host.querySelector('.visibility__dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('button')).toBeNull();
  });

  describe('who a targeted group is for (epic targeting R7)', () => {
    const tags = (...names: string[]) => names.map((name, i) => ({ id: `t${i}`, name }));

    it('adds the audience to "Visible on site", as a button named by the whole line and described by the full audience', () => {
      const { host } = render(VISIBLE, 'group', false, false, { tags: tags('summer', 'vip'), tagMatch: 'any' });
      const button = host.querySelector('button.visibility__line');
      expect(text(button)).toBe('Visible on site · for viewers tagged summer or vip');
      // No aria-label: the name is the visible line, so voice control and screen readers say the same.
      expect(button?.hasAttribute('aria-label')).toBe(false);
      const tip = host.querySelector('[role=tooltip]');
      expect(button?.getAttribute('aria-describedby')).toBe(tip?.id);
      expect([...(tip?.querySelectorAll('p') ?? [])].map(text)).toEqual([
        'Shown to viewers tagged with any of summer or vip.',
        'A page that passes no tags shows it to every viewer.',
      ]);
    });

    it('says "and" for All, and words a group read for every zone', () => {
      const all = render(VISIBLE, 'group', false, true, { tags: tags('summer', 'vip'), tagMatch: 'all' });
      expect(text(all.host.querySelector('button'))).toBe(
        'Visible on site in at least one zone · for viewers tagged summer and vip',
      );
    });

    it('opens its tooltip on focus, as the reasons do', () => {
      const { fixture, host, open } = render(VISIBLE, 'group', false, false, { tags: tags('summer') });
      host.querySelector('button')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      fixture.detectChanges();
      expect(open()).toBe(true);
    });

    it('says nothing more for an untagged group, nor for a targeted group that is not visible', () => {
      const untagged = render(VISIBLE, 'group', false, false, { tags: [], tagMatch: 'all' });
      expect(text(untagged.host)).toBe('Visible on site');
      expect(untagged.host.querySelector('button')).toBeNull();
      const hidden = render(notVisible, 'group', false, false, { tags: tags('summer') });
      expect(text(hidden.host.querySelector('button'))).toBe('Not visible: group is off');
      expect(text(hidden.host.querySelector('[role=tooltip]'))).not.toContain('summer');
    });
  });

  it('shows a hollow dot and "Not visible:" with the first reason, as a button described by every reason', () => {
    const { host } = render(notVisible, 'tale');
    expect(host.classList).not.toContain('visibility--visible');
    const button = host.querySelector('button');
    expect(text(button)).toBe('Not visible: group is off');
    const tip = host.querySelector('[role=tooltip]');
    expect(button?.getAttribute('aria-describedby')).toBe(tip?.id);
    // In the top layer, so no card or scroll area clips it.
    expect(tip?.getAttribute('popover')).toBe('manual');
    expect([...(tip?.querySelectorAll('li') ?? [])].map(text)).toEqual([
      'group is off',
      `starts ${formatLocal(at)}`,
      'zone has no display',
    ]);
  });

  it('opens on hover and stays a moment after, so the pointer can reach it', () => {
    vi.useFakeTimers();
    const { fixture, host, open } = render(notVisible);
    host.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(open()).toBe(true);
    host.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(TIP_HIDE_DELAY_MS - 1);
    host.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(TIP_HIDE_DELAY_MS * 2);
    fixture.detectChanges();
    expect(open()).toBe(true);
    host.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(TIP_HIDE_DELAY_MS);
    fixture.detectChanges();
    expect(open()).toBe(false);
  });

  it('closes a hover-opened tip with Escape pressed anywhere, and with a press elsewhere', () => {
    const { fixture, host, open } = render(notVisible);
    host.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(open()).toBe(true);
    // Focus is elsewhere: Escape reaches the document.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(open()).toBe(false);

    host.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(open()).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(open()).toBe(false);
  });

  it('opens on focus, closes with Escape and when focus leaves; a press toggles it', () => {
    const { fixture, host, open } = render(notVisible);
    const button = host.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(open()).toBe(true);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(open()).toBe(false);
    // A press: its focus does not open it, its click does; a second click closes it.
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    button.click();
    fixture.detectChanges();
    expect(open()).toBe(true);
    button.click();
    fixture.detectChanges();
    expect(open()).toBe(false);
    button.click();
    button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    fixture.detectChanges();
    expect(open()).toBe(false);
  });

  it('on a tale card shows only the dot, named by the line; a visible one is not also described', () => {
    const hidden = render(notVisible, 'tale', true).host;
    const button = hidden.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Not visible: group is off');
    expect(hidden.querySelector('.visibility__text')).toBeNull();
    const shown = render(VISIBLE, 'tale', true).host;
    const dot = shown.querySelector('button');
    expect(dot?.getAttribute('aria-label')).toBe('Visible on site');
    expect(dot?.hasAttribute('aria-describedby')).toBe(false);
    expect(text(shown.querySelector('[role=tooltip]'))).toBe('Visible on site');
  });

  it('places a tale card tip beside the card, never over its switch or move buttons', () => {
    const card = { left: 100, right: 220, top: 40 };
    const dot = { left: 138, right: 162, top: 48, bottom: 72 };
    const tip = { width: 160, height: 80 };
    expect(tipPosition(dot, card, tip, { width: 1280, height: 800 })).toEqual({ left: 228, top: 48 });
    // No room on the right: on the left of the card.
    expect(tipPosition(dot, { ...card, left: 1100, right: 1220 }, tip, { width: 1280, height: 800 })).toEqual({
      left: 932,
      top: 48,
    });
    // A line's tip goes beside it, so the row's switch below stays clear...
    expect(tipPosition(dot, null, tip, { width: 1280, height: 800 })).toEqual({ left: 170, top: 44 });
    // ...or below it, inside the viewport, when there is no room.
    expect(tipPosition({ ...dot, right: 1200 }, null, tip, { width: 1280, height: 800 })).toEqual({ left: 138, top: 76 });
    expect(tipPosition({ ...dot, left: 1250, right: 1270 }, null, tip, { width: 1280, height: 800 }).left).toBe(1112);
  });

  it('positions the open tale card tip from the card', () => {
    const { fixture, host } = render(notVisible, 'tale', true);
    const cardEl = host.closest('.tale-card') as HTMLElement;
    cardEl.getBoundingClientRect = () => ({ left: 100, right: 220, top: 40, bottom: 253 }) as DOMRect;
    host.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    const tip = host.querySelector<HTMLElement>('[role=tooltip]');
    expect(Number.parseFloat(tip?.style.left ?? '0')).toBeGreaterThanOrEqual(220);
  });

  it('says "in at least one zone" for a group read for every zone', () => {
    expect(text(render(VISIBLE, 'group', false, true).host)).toBe('Visible on site in at least one zone');
    const { host } = render(notVisible, 'group', false, true);
    expect(text(host.querySelector('.visibility__tip-title'))).toBe('Not visible in any zone because:');
  });

  it('names the subject only when it is not the content read', () => {
    const archived: Visibility = { visible: false, reasons: [{ code: 'archived', subject: 'group' }] };
    expect(visibilityLine(archived, 'group')).toBe('Not visible: archived');
    expect(visibilityLine(archived, 'tale')).toBe('Not visible: group is archived');
  });

  it('renders nothing while the visibility is unknown', () => {
    const { host } = render(undefined);
    expect(host.children).toHaveLength(0);
    expect(text(host)).toBe('');
  });
});
