import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Visibility, VisibilitySubject } from '@taleart/contract/core';
import { formatLocal } from './schedule';
import { visibilityLine, VisibilityIndicator } from './visibility';

@Component({
  imports: [VisibilityIndicator],
  template: `<app-visibility [visibility]="visibility()" [viewing]="viewing()" [compact]="compact()" />`,
})
class Host {
  readonly visibility = signal<Visibility | undefined>(undefined);
  readonly viewing = signal<VisibilitySubject>('tale');
  readonly compact = signal(false);
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

function render(visibility: Visibility | undefined, viewing: VisibilitySubject = 'tale', compact = false) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.visibility.set(visibility);
  fixture.componentInstance.viewing.set(viewing);
  fixture.componentInstance.compact.set(compact);
  fixture.detectChanges();
  const host = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-visibility');
  if (!host) throw new Error('no indicator');
  return { fixture, host };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('VisibilityIndicator (epic UX rework R7)', () => {
  it('shows a filled dot and "Visible on site", with nothing to open', () => {
    const { host } = render({ visible: true, reasons: [] }, 'zone');
    expect(host.classList).toContain('visibility--visible');
    expect(text(host)).toBe('Visible on site');
    expect(host.querySelector('.visibility__dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('button')).toBeNull();
  });

  it('shows a hollow dot and "Not visible:" with the first reason, as a button described by every reason', () => {
    const { host } = render(notVisible, 'tale');
    expect(host.classList).not.toContain('visibility--visible');
    const button = host.querySelector('button');
    expect(text(button)).toBe('Not visible: group is off');
    const tip = host.querySelector('[role=tooltip]');
    expect(button?.getAttribute('aria-describedby')).toBe(tip?.id);
    expect([...(tip?.querySelectorAll('li') ?? [])].map(text)).toEqual([
      'group is off',
      `starts ${formatLocal(at)}`,
      'zone has no display',
    ]);
  });

  it('opens the reasons on hover and on focus, keeps them while hovered, and closes them with Escape', () => {
    const { fixture, host } = render(notVisible);
    const open = () => host.classList.contains('visibility--open');
    host.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(open()).toBe(true);
    host.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(open()).toBe(false);

    const button = host.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(open()).toBe(true);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(open()).toBe(false);
    // Pressing it (a touch) opens them again.
    button.click();
    fixture.detectChanges();
    expect(open()).toBe(true);
    button.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    fixture.detectChanges();
    expect(open()).toBe(false);
  });

  it('on a tale card shows only the dot, named by the line, with the reasons in its tooltip; visible ones too', () => {
    const hidden = render(notVisible, 'tale', true).host;
    const button = hidden.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Not visible: group is off');
    expect(hidden.querySelector('.visibility__text')).toBeNull();
    const shown = render({ visible: true, reasons: [] }, 'tale', true).host;
    expect(shown.querySelector('button')?.getAttribute('aria-label')).toBe('Visible on site');
    expect(text(shown.querySelector('[role=tooltip]'))).toBe('Visible on site');
  });

  it('names the subject only when it is not the content read', () => {
    const archived: Visibility = { visible: false, reasons: [{ code: 'archived', subject: 'group' }] };
    expect(visibilityLine(archived, 'group')).toBe('Not visible: archived');
    expect(visibilityLine(archived, 'tale')).toBe('Not visible: group is archived');
  });

  it('shows nothing while the visibility is unknown', () => {
    const { host } = render(undefined);
    expect(host.hidden).toBe(true);
  });
});
