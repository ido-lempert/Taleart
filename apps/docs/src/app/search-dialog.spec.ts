import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { DocsSearch } from './search-dialog';
import { SearchIndex } from './search';

const INDEX: SearchIndex = {
  v: 1,
  pages: [
    { p: 'install', t: 'Install a zone', g: 'Installation' },
    { p: 'guides/web', t: 'Web guide', g: 'SDK guides' },
  ],
  s: [
    { i: 0, a: '', h: 'Install a zone', x: 'Install the script.' },
    { i: 0, a: 'zone-key', h: 'Zone key', x: 'Copy the zone key once.' },
    { i: 1, a: 'step-zone-key', h: 'Issue the zone key.', x: 'An admin issues the key.' },
  ],
};

/** jsdom has no <dialog> methods: the component's calls are backed by the open attribute and a close event. */
function dialogShim(): void {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void };
  if (typeof proto.showModal === 'function') return;
  Object.defineProperty(proto, 'open', {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute('open');
    },
    set(this: HTMLDialogElement, value: boolean) {
      if (value) this.setAttribute('open', '');
      else this.removeAttribute('open');
    },
  });
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  (proto as unknown as { close: () => void }).close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

async function settle(fixture: ComponentFixture<DocsSearch>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
}

describe('DocsSearch', () => {
  let fixture: ComponentFixture<DocsSearch>;
  let host: HTMLElement;
  let navigate: ReturnType<typeof vi.spyOn>;

  const dialog = () => host.querySelector('dialog') as HTMLDialogElement;
  const input = () => host.querySelector('input') as HTMLInputElement;
  const options = () => [...host.querySelectorAll<HTMLElement>('[role=option]')];
  const status = () => host.querySelector('[role=status]')?.textContent?.trim() ?? '';
  const press = (el: EventTarget, key: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const type = (text: string) => {
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  };

  beforeAll(dialogShim);

  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(INDEX), { status: 200 })),
    );
    TestBed.configureTestingModule({ imports: [DocsSearch], providers: [provideRouter([])] });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(DocsSearch);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('shows a labelled Search button with the "/" hint, and no results before the dialog opens', () => {
    const button = host.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Search');
    expect(button.textContent).toContain('/');
    expect(dialog().open).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens with "/" outside a field, focuses the labelled combobox and loads the index once', async () => {
    document.body.append(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    fixture.detectChanges();
    expect(dialog().open).toBe(true);
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-controls')).toBe('docs-search-results');
    await settle(fixture);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/search-index\.json$/);
  });

  it('does not open on "/" typed into a field', () => {
    const other = document.createElement('input');
    document.body.append(host, other);
    other.focus();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(dialog().open).toBe(false);
  });

  it('opens and closes with Ctrl/Cmd+K', () => {
    document.body.append(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(dialog().open).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', metaKey: true }));
    expect(dialog().open).toBe(false);
  });

  it('groups the results by page, marks the matches and announces the count', async () => {
    document.body.append(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    await settle(fixture);
    type('zone key');
    await settle(fixture);
    expect(status()).toBe('2 results');
    const groups = [...host.querySelectorAll('[role=group]')];
    expect(groups.map((group) => group.querySelector('.search__page-title')?.textContent)).toEqual([
      'Install a zone',
      'Web guide',
    ]);
    expect(options().map((option) => option.id)).toEqual(['docs-search-option-0', 'docs-search-option-1']);
    expect(host.querySelectorAll('[role=option] mark').length).toBeGreaterThan(0);
    expect(host.querySelector('[role=option] mark')?.textContent).toBe('Zone');
  });

  it('moves the highlighted result with the arrows, Home and End, and wraps the arrows', async () => {
    document.body.append(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    await settle(fixture);
    type('zone key');
    await settle(fixture);
    const active = () => input().getAttribute('aria-activedescendant');
    expect(active()).toBe('docs-search-option-0');
    press(input(), 'ArrowDown');
    fixture.detectChanges();
    expect(active()).toBe('docs-search-option-1');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    press(input(), 'ArrowDown');
    fixture.detectChanges();
    expect(active()).toBe('docs-search-option-0');
    press(input(), 'ArrowUp');
    fixture.detectChanges();
    expect(active()).toBe('docs-search-option-1');
    press(input(), 'Home');
    fixture.detectChanges();
    expect(active()).toBe('docs-search-option-0');
    press(input(), 'End');
    fixture.detectChanges();
    expect(active()).toBe('docs-search-option-1');
  });

  it('opens the highlighted section with Enter: the router goes to its page and anchor, and the dialog closes', async () => {
    document.body.append(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    await settle(fixture);
    type('zone key');
    await settle(fixture);
    press(input(), 'Enter');
    expect(navigate).toHaveBeenCalledWith('/install#zone-key');
    expect(dialog().open).toBe(false);
  });

  it('opens the second result by the arrow down and Enter, on its own page and anchor', async () => {
    document.body.append(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    await settle(fixture);
    type('zone key');
    await settle(fixture);
    press(input(), 'ArrowDown');
    press(input(), 'Enter');
    expect(navigate).toHaveBeenCalledWith('/guides/web#step-zone-key');
  });

  it('opens a result by a click', async () => {
    document.body.append(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    await settle(fixture);
    type('install');
    await settle(fixture);
    options()[0].click();
    expect(navigate).toHaveBeenCalledWith('/install');
  });

  it('says so when nothing matches, and shows no results for an empty query', async () => {
    document.body.append(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    await settle(fixture);
    type('qqzz');
    await settle(fixture);
    expect(status()).toBe('No results for “qqzz”.');
    expect(options()).toEqual([]);
    type('   ');
    await settle(fixture);
    expect(status()).toBe('');
  });

  it("closes with Escape (the dialog's close) and returns the focus to where it was", () => {
    const before = document.createElement('a');
    before.href = '#x';
    document.body.append(host, before);
    before.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    expect(document.activeElement).toBe(input());
    dialog().close();
    fixture.detectChanges();
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(before);
  });
});
