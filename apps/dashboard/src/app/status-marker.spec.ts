import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatusMarker, type StatusTone } from './status-marker';

@Component({
  imports: [StatusMarker],
  template: `<div class="row"><app-status-marker [tone]="tone()" [text]="text()" /></div>`,
})
class Host {
  readonly tone = signal<StatusTone>('green');
  readonly text = signal('Visible on site');
}

function render(tone: StatusTone = 'green', text = 'Visible on site') {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.tone.set(tone);
  fixture.componentInstance.text.set(text);
  fixture.detectChanges();
  document.body.appendChild(fixture.nativeElement);
  const host = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-status-marker');
  const button = host?.querySelector<HTMLButtonElement>('button') ?? null;
  if (!host || !button) throw new Error('no marker');
  return { fixture, host, button };
}

const escape = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('StatusMarker (status text moved into a tooltip)', () => {
  it('is a focusable button named by its text, with a glyph that is hidden from screen readers', () => {
    const { button } = render('orange', 'Not visible: starts Nov 30, 2026');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Not visible: starts Nov 30, 2026');
    expect(button.getAttribute('tabindex')).toBeNull();
    expect(button.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelector('span')?.textContent).toBe('!');
  });

  it.each([
    ['green', '✓'],
    ['orange', '!'],
    ['red', '×'],
  ] as const)('gives %s its own tone class and a glyph that does not rely on colour', (tone, glyph) => {
    const { button } = render(tone);
    for (const other of ['green', 'orange', 'red'] as const) {
      expect(button.classList.contains(`status-marker--${other}`)).toBe(other === tone);
    }
    expect(button.querySelector('span')?.textContent).toBe(glyph);
  });

  it('puts the text in its tooltip, hidden from screen readers because the name says it', () => {
    const { host } = render('red', 'Not visible: group is off');
    const tip = host.querySelector('.status-marker__tip');
    expect(tip?.textContent).toBe('Not visible: group is off');
    expect(tip?.getAttribute('aria-hidden')).toBe('true');
  });

  it('follows a change of tone and text', () => {
    const { fixture, button } = render('green', 'Visible on site');
    fixture.componentInstance.tone.set('red');
    fixture.componentInstance.text.set('Not visible: zone has no display');
    fixture.detectChanges();
    expect(button.classList.contains('status-marker--red')).toBe(true);
    expect(button.classList.contains('status-marker--green')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Not visible: zone has no display');
    expect(button.closest('app-status-marker')?.querySelector('.status-marker__tip')?.textContent).toBe(
      'Not visible: zone has no display',
    );
  });

  it('hides its tooltip on Escape, and shows it again when the pointer comes back', () => {
    const { fixture, host, button } = render('orange', 'Visible on site · for viewers tagged vip');
    expect(button.classList.contains('status-marker--dismissed')).toBe(false);
    escape(button);
    fixture.detectChanges();
    expect(button.classList.contains('status-marker--dismissed')).toBe(true);
    host.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(button.classList.contains('status-marker--dismissed')).toBe(false);
  });

  it('lets Escape reach the page when the tooltip is not showing, so an open drawer still closes', () => {
    const { button } = render();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    try {
      escape(button);
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', seen);
    }
  });
});
