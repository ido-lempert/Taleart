import { TALE_ELEMENT_TYPE_REGISTRY, TALE_TEST_ELEMENT_TYPES, type DeliveryTaleDocument } from '@taleart/contract';

// Tale Studio story 7.8 (R8): the SDK looks renderers up by the registry's keys, and skips a type it
// does not know, here the registry's test-only badge, with one console warning per type per page.

const element = (id: string, type: string, y: number, props: Record<string, unknown>) => ({
  id,
  type,
  box: { x: 0.1, y, w: 0.8, h: 0.1, rotation: 0 },
  a11y: {},
  props,
});
const badge = (id: string, y: number) => element(id, 'test-badge', y, { label: 'New', color: '#FF0055', tone: 'solid' });
const words = (id: string, y: number, text: string) => element(id, 'text', y, { text });
const doc = (elements: unknown[]) =>
  ({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements }) as DeliveryTaleDocument;

// A fresh module per test: the warnings already given are remembered for the page.
async function freshRenderer() {
  vi.resetModules();
  return import('./renderer');
}

describe('the renderer lookup and the element-type registry (story 7.8)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('has exactly one renderer per registered type, and none for a test-only type', async () => {
    const { ELEMENT_RENDERERS } = await freshRenderer();
    expect([...ELEMENT_RENDERERS.keys()]).toEqual(TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key));
    expect(TALE_TEST_ELEMENT_TYPES.length).toBeGreaterThan(0);
    for (const { key } of TALE_TEST_ELEMENT_TYPES) expect(ELEMENT_RENDERERS.has(key)).toBe(false);
  });

  it('shows the rest of a tale without a type it lacks, with one warning for the page', async () => {
    const { renderTaleDocument } = await freshRenderer();
    const tale = doc([badge('b1', 0.1), words('t1', 0.3, 'Still here'), badge('b2', 0.5), words('t2', 0.7, 'Me too')]);
    const first = renderTaleDocument(tale);
    const second = renderTaleDocument(tale);
    for (const area of [first, second]) {
      const canvas = area.querySelector('.ta-canvas') as HTMLElement;
      expect([...canvas.querySelectorAll('.ta-text')].map((p) => p.textContent)).toEqual(['Still here', 'Me too']);
      expect(canvas.children).toHaveLength(2);
      expect(canvas.textContent).not.toContain('New');
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe(
      'TaleArt: element type "test-badge" is not supported by this SDK; it is skipped',
    );
    // Another unknown type warns once too.
    renderTaleDocument(doc([element('p', 'future-widget', 0.1, {}), element('p2', 'future-widget', 0.2, {})]));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('renders every registered type as before', async () => {
    const { renderTaleDocument } = await freshRenderer();
    const area = renderTaleDocument(
      doc([
        words('t', 0.1, 'Text'),
        element('s', 'shape', 0.2, { shape: 'rectangle', fill: '#FFFFFF' }),
        element('e', 'emoji', 0.3, { emoji: '🎉' }),
        element('b', 'button', 0.4, {
          label: 'Shop',
          variant: 'filled',
          color: '#111827',
          fill: '#FFFFFF',
          href: 'https://example.com/',
        }),
      ]),
    );
    expect(area.querySelectorAll('.ta-el')).toHaveLength(4);
    expect(warn).not.toHaveBeenCalled();
  });
});
