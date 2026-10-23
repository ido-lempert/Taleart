import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Drawer, reachable } from './drawer';

// Story 7.15 (WCAG 2.4.3, 2.1.2): the drawer's Tab trap counts only Tab stops. A grid with a roving
// tabindex (the emoji picker) is one stop; its other controls (tabindex -1) are not ends of the trap.
@Component({
  imports: [Drawer],
  template: `
    <app-drawer heading="Pick">
      <div class="drawer__body">
        <input id="search" />
        <div role="grid">
          <button type="button" id="first-cell" tabindex="-1">A</button>
          <button type="button" id="active-cell" tabindex="0">B</button>
          <button type="button" id="last-cell" tabindex="-1">C</button>
        </div>
      </div>
    </app-drawer>
  `,
})
class Host {}

const tab = (from: HTMLElement, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  from.dispatchEvent(event);
  return event;
};

describe('Drawer Tab trap', () => {
  it('treats a control with tabindex -1 as no Tab stop', () => {
    const el = (html: string) => {
      const div = document.createElement('div');
      div.innerHTML = html;
      document.body.append(div);
      return div.firstElementChild as HTMLElement;
    };
    expect(reachable(el('<button>a</button>'))).toBe(true);
    expect(reachable(el('<button tabindex="-1">a</button>'))).toBe(false);
    expect(reachable(el('<div hidden><button>a</button></div>').firstElementChild as HTMLElement)).toBe(false);
  });

  it('treats a radio group as one Tab stop: the checked radio, else the first', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <input type="radio" name="t" id="r1" /><input type="radio" name="t" id="r2" checked /><input type="radio" name="t" id="r3" />
      <input type="radio" name="u" id="u1" /><input type="radio" name="u" id="u2" />`;
    document.body.append(div);
    const r = (id: string) => div.querySelector<HTMLElement>(`#${id}`) as HTMLElement;
    expect(['r1', 'r2', 'r3'].map((id) => reachable(r(id)))).toEqual([false, true, false]);
    expect(['u1', 'u2'].map((id) => reachable(r(id)))).toEqual([true, false]);
    div.remove();
  });

  it('wraps Tab from the grid’s one Tab stop to Close, and Shift+Tab from Close back to it', async () => {
    const fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const close = root.querySelector<HTMLElement>('.drawer__close') as HTMLElement;
    const active = root.querySelector<HTMLElement>('#active-cell') as HTMLElement;
    // Opens on the body's first control, not on a cell out of the Tab order.
    expect(document.activeElement?.id).toBe('search');

    active.focus();
    const forward = tab(active);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    const back = tab(close, true);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(active);
    fixture.destroy();
  });
});
