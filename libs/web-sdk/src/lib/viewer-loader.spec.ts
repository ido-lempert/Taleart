import type { DeliveryTaleGroup } from '@taleart/contract';
import { DOCUMENT_STYLES } from './document/renderer';
import { LazyTaleViewer } from './viewer-loader';
import { VIEWER_BASE_STYLES, VIEWER_STYLES } from './viewer';

// The viewer loads on its first open (AD-16): the entry does not carry it, the open waits for the chunk,
// and a close or a later open while it loads decides what shows.
const groups: DeliveryTaleGroup[] = [
  { id: 'ga', name: 'A', tales: [{ id: 'a1', title: 'A1', media: null }] },
  { id: 'gb', name: 'B', tales: [{ id: 'b1', title: 'B1', media: null }] },
  { id: 'empty', name: 'Empty', tales: [] },
];

let host: HTMLElement;
const dialogs = () => [...host.querySelectorAll<HTMLDialogElement>('dialog.viewer')];
const openDialog = () => dialogs().find((d) => d.open) ?? null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('LazyTaleViewer (AD-16)', () => {
  it('answers an open of a known group at once, and shows it once its chunk has loaded', async () => {
    const viewer = new LazyTaleViewer(host, groups);
    expect(viewer.open('gb')).toBe(true);
    expect(viewer.groupId).toBe('gb');
    expect(dialogs()).toHaveLength(0);
    await vi.dynamicImportSettled();
    expect(dialogs()).toHaveLength(1);
    expect(openDialog()?.getAttribute('aria-label')).toBe('B');
    expect(viewer.groupId).toBe('gb');
  });

  it('gives the viewer its own styles, when it is built', async () => {
    const viewer = new LazyTaleViewer(host, groups);
    viewer.open('ga');
    await vi.dynamicImportSettled();
    const styles = [...host.querySelectorAll('style')].map((s) => s.textContent ?? '');
    expect(styles.some((text) => text.includes('.viewer {'))).toBe(true);
  });

  it('refuses an unknown group and one without tales, without loading anything', async () => {
    const viewer = new LazyTaleViewer(host, groups);
    expect(viewer.open('nope')).toBe(false);
    expect(viewer.open('empty')).toBe(false);
    expect(viewer.groupId).toBeNull();
    await vi.dynamicImportSettled();
    expect(dialogs()).toHaveLength(0);
  });

  it('does not show a group whose open was closed while the chunk loaded', async () => {
    const viewer = new LazyTaleViewer(host, groups);
    viewer.open('ga');
    viewer.close();
    expect(viewer.groupId).toBeNull();
    await vi.dynamicImportSettled();
    expect(openDialog()).toBeNull();
  });

  it('does not show a group when its root was taken off the page while the chunk loaded', async () => {
    const detached = document.createElement('div');
    const viewer = new LazyTaleViewer(detached, groups);
    viewer.open('ga');
    await vi.dynamicImportSettled();
    expect(detached.querySelector('dialog')).toBeNull();
    expect(viewer.groupId).toBeNull();
  });

  it('shows the group opened last while the chunk loaded, and later opens are at once', async () => {
    const viewer = new LazyTaleViewer(host, groups);
    viewer.open('ga');
    viewer.open('gb');
    await vi.dynamicImportSettled();
    expect(openDialog()?.getAttribute('aria-label')).toBe('B');
    expect(viewer.open('ga')).toBe(true);
    expect(openDialog()?.getAttribute('aria-label')).toBe('A');
    expect(dialogs()).toHaveLength(1);
    viewer.close();
    expect(viewer.groupId).toBeNull();
  });
});

describe('the viewer styles', () => {
  it('draw no colour of their own: every colour is a theme token', () => {
    // The tale documents' own rules are the renderer's; the viewer's are checked here.
    const own = VIEWER_STYLES.replace(DOCUMENT_STYLES, '');
    expect(own).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(own).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(VIEWER_BASE_STYLES).not.toMatch(/(?<![\w-])(white|black)(?![\w-])/);
  });

  it('keep the progress bars at 3 px with a 3 px radius, and the controls at 44 px', () => {
    expect(VIEWER_BASE_STYLES).toMatch(/\.segment \{[^}]*height: 3px;[^}]*border-radius: 3px;/);
    expect(VIEWER_BASE_STYLES).toMatch(/\.control \{[^}]*width: 44px;[^}]*height: 44px;/);
  });

  it('stop every motion under reduced motion', () => {
    expect(VIEWER_STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.frame \.ta-area \{ animation: none; \}/,
    );
  });
});
