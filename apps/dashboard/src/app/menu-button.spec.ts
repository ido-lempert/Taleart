import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MenuButton, menuPosition, type MenuItem, type MenuPick } from './menu-button';

@Component({
  imports: [MenuButton],
  template: `
    <button type="button" id="before">Before</button>
    @if (shown()) {
      <app-menu-button label="More for Summer" [items]="items()" (picked)="picks.push($event)" />
    }
    <button type="button" id="after">After</button>
    <app-menu-button id="winter" label="More for Winter" [items]="items()" />
  `,
})
class Host {
  readonly shown = signal(true);
  readonly items = signal<readonly MenuItem[]>([
    { id: 'schedule', label: 'Schedule' },
    { id: 'place', label: 'Show in another zone', disabledReason: 'Already in every zone' },
    { id: 'archive', label: 'Archive' },
  ]);
  readonly picks: MenuPick[] = [];
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  document.body.appendChild(fixture.nativeElement);
  const root = fixture.nativeElement as HTMLElement;
  const trigger = root.querySelector<HTMLButtonElement>('.menu-button__trigger');
  if (!trigger) throw new Error('no trigger');
  const menu = () => root.querySelector<HTMLElement>('[role=menu]');
  const items = () => [...root.querySelectorAll<HTMLElement>('[role=menuitem]')];
  const focused = () => document.activeElement?.firstElementChild?.textContent?.trim();
  const key = (target: Element, name: string) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  return { fixture, root, trigger, menu, items, focused, key };
}

describe('MenuButton (WAI-ARIA menu button)', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('is a named button that says it opens a menu, with nothing rendered until it opens', () => {
    const { trigger, menu } = render();
    expect(trigger.getAttribute('aria-label')).toBe('More for Summer');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    expect(menu()).toBeNull();
  });

  it('opens on a click with focus on the first item, labelled by its button', () => {
    const { fixture, trigger, menu, items, focused } = render();
    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(menu()?.id);
    expect(menu()?.getAttribute('aria-labelledby')).toBe(trigger.id);
    expect(items().map((i) => i.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1']);
    expect(focused()).toBe('Schedule');
  });

  it('opens on Down at the first item and on Up at the last', () => {
    const { fixture, trigger, focused, key } = render();
    expect(key(trigger, 'ArrowUp').defaultPrevented).toBe(true);
    expect(focused()).toBe('Archive');
    key(document.activeElement as Element, 'Escape');
    expect(document.activeElement).toBe(trigger);
    key(trigger, 'ArrowDown');
    fixture.detectChanges();
    expect(focused()).toBe('Schedule');
  });

  it('moves with the arrow keys, wrapping, and with Home and End', () => {
    const { trigger, focused, key } = render();
    trigger.click();
    const move = (name: string) => key(document.activeElement as Element, name);
    move('ArrowDown');
    expect(focused()).toBe('Show in another zone');
    move('ArrowDown');
    expect(focused()).toBe('Archive');
    move('ArrowDown');
    expect(focused()).toBe('Schedule');
    move('ArrowUp');
    expect(focused()).toBe('Archive');
    move('Home');
    expect(focused()).toBe('Schedule');
    move('End');
    expect(focused()).toBe('Archive');
  });

  it('closes on Escape and returns focus to its button', () => {
    const { trigger, menu, key } = render();
    trigger.click();
    key(document.activeElement as Element, 'Escape');
    expect(menu()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Tab, leaving focus to move on from its button', () => {
    const { trigger, menu, key } = render();
    trigger.click();
    const event = key(document.activeElement as Element, 'Tab');
    expect(event.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a press outside, and a second click on its button closes it', () => {
    const { fixture, root, trigger, menu } = render();
    trigger.click();
    root.querySelector('#after')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(menu()).toBeNull();
    trigger.click();
    fixture.detectChanges();
    expect(menu()).not.toBeNull();
    trigger.click();
    fixture.detectChanges();
    expect(menu()).toBeNull();
  });

  it('emits the chosen item with its button, closes and returns focus', () => {
    const { fixture, trigger, menu, items } = render();
    trigger.click();
    items()[2].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picks).toEqual([{ id: 'archive', opener: trigger }]);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps a disabled item reachable, says why, and does nothing when it is chosen', () => {
    const { fixture, trigger, menu, items } = render();
    trigger.click();
    const disabled = items()[1];
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(disabled.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe('Already in every zone');
    // Its name is its label alone: the reason is out of the name and read once, as the description.
    expect(reason?.getAttribute('aria-hidden')).toBe('true');
    const name = [...disabled.childNodes]
      .filter((node) => node.nodeType !== Node.COMMENT_NODE)
      .filter((node) => !(node instanceof Element && node.getAttribute('aria-hidden') === 'true'))
      .map((node) => node.textContent)
      .join('')
      .trim();
    expect(name).toBe('Show in another zone');
    expect(items()[0].hasAttribute('aria-disabled')).toBe(false);
    disabled.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picks).toEqual([]);
    expect(menu()).not.toBeNull();
  });

  it('leaves Enter and Space to the button, whose click opens the menu on its first item', () => {
    const { fixture, trigger, focused, key } = render();
    for (const name of ['Enter', ' ']) {
      expect(key(trigger, name).defaultPrevented).toBe(false);
      // The browser turns Enter and Space on a button into a click.
      trigger.click();
      fixture.detectChanges();
      expect(focused()).toBe('Schedule');
      key(document.activeElement as Element, 'Escape');
    }
  });

  it('keeps one menu open at a time', () => {
    const { fixture, root, trigger, menu } = render();
    trigger.click();
    root.querySelector<HTMLButtonElement>('#winter .menu-button__trigger')?.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelectorAll('[role=menu]')).toHaveLength(1);
    expect(menu()?.getAttribute('aria-labelledby')).toContain('button');
    expect(document.activeElement?.closest('#winter')).not.toBeNull();
  });

  it('closes on a click outside without a press, as a keyboard or screen reader click', () => {
    const { fixture, root, trigger, menu } = render();
    trigger.click();
    root.querySelector<HTMLButtonElement>('#after')?.click();
    fixture.detectChanges();
    expect(menu()).toBeNull();
  });

  it('closes when focus moves outside it', () => {
    const { fixture, root, trigger, menu } = render();
    trigger.click();
    root.querySelector<HTMLButtonElement>('#after')?.focus();
    fixture.detectChanges();
    expect(menu()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on a scroll of the page but not of the menu itself, and on a resize', () => {
    const { fixture, trigger, menu } = render();
    trigger.click();
    menu()?.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(menu()).not.toBeNull();
    document.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(menu()).toBeNull();
    trigger.click();
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();
    expect(menu()).toBeNull();
  });

  it('closes when the browser closes its popover', () => {
    const { fixture, trigger, menu } = render();
    trigger.click();
    const toggle = Object.assign(new Event('toggle'), { newState: 'closed' });
    menu()?.dispatchEvent(toggle);
    fixture.detectChanges();
    expect(menu()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('stops listening when it is removed while open', () => {
    const { fixture, root, trigger } = render();
    trigger.click();
    const removed = vi.spyOn(document, 'removeEventListener');
    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['pointerdown', 'click']));
    removed.mockRestore();
    // A later menu still opens, as the removed one no longer counts as open.
    root.querySelector<HTMLButtonElement>('#winter .menu-button__trigger')?.click();
    fixture.detectChanges();
    expect(root.querySelectorAll('[role=menu]')).toHaveLength(1);
  });
});

describe('menuPosition', () => {
  const viewport = { width: 390, height: 844 };
  const menu = { width: 160, height: 100 };

  it('goes below its button with the right edges aligned', () => {
    expect(menuPosition({ left: 300, right: 332, top: 100, bottom: 132 }, menu, viewport)).toEqual({ left: 172, top: 136 });
  });

  it('goes above when there is no room below, and stays inside the viewport', () => {
    expect(menuPosition({ left: 8, right: 40, top: 800, bottom: 832 }, menu, viewport)).toEqual({ left: 4, top: 696 });
  });

  it('aligns with the button left edge in a right-to-left page', () => {
    expect(menuPosition({ left: 20, right: 52, top: 100, bottom: 132 }, menu, viewport, true)).toEqual({ left: 20, top: 136 });
    expect(menuPosition({ left: 300, right: 332, top: 100, bottom: 132 }, menu, viewport, true)).toEqual({ left: 226, top: 136 });
  });
});
