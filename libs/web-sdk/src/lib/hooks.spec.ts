import { init } from './config';
import { emit, type TaleartHooks } from './hooks';

// The hooks' delivery (hooks.ts): the element's hook, then the global one, then each onEvent; one DOM event
// on the element; a throwing hook logged and not thrown; the canceled state of a cancelable event.
const PAYLOAD = {
  zoneKeyPrefix: 'tak_abcd',
  zoneSlug: 'home',
  group: { id: 'ga', name: 'Summer', index: 0 },
};
const TALE = { id: 't1', index: 0, title: 'Beach' };

function host(hooks?: TaleartHooks | null): HTMLElement & { hooks?: TaleartHooks | null } {
  const el = document.createElement('div') as HTMLElement & { hooks?: TaleartHooks | null };
  if (hooks !== undefined) el.hooks = hooks;
  document.body.appendChild(el);
  return el;
}

describe('hooks', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    init({ hooks: null });
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('calls the element hook, the global hook, then each onEvent, once each, with the payload', () => {
    const order: string[] = [];
    const calls: unknown[] = [];
    const el = host({
      onPresented: (e) => (order.push('element'), calls.push(e)),
      onEvent: (e) => (order.push('element-event'), calls.push(e)),
    });
    init({
      hooks: {
        onPresented: (e) => (order.push('global'), calls.push(e)),
        onEvent: (e) => (order.push('global-event'), calls.push(e)),
      },
    });
    emit(el, 'presented', PAYLOAD);
    expect(order).toEqual(['element', 'global', 'element-event', 'global-event']);
    expect(calls[0]).toEqual({ name: 'presented', ...PAYLOAD });
    expect(calls).toHaveLength(4);
  });

  it('gives a hook the event with its name and fields, the zone key only as its prefix', () => {
    const received: unknown[] = [];
    const el = host({ onGroupImpression: (e) => received.push(e) });
    emit(el, 'groupImpression', PAYLOAD);
    expect(received).toEqual([{ name: 'groupImpression', ...PAYLOAD }]);
  });

  it('dispatches a bubbling, composed DOM event named by the kebab-case name, with the payload as detail', () => {
    const el = host();
    const seen: CustomEvent[] = [];
    const parentSpy = vi.fn();
    document.body.addEventListener('taleart:load-failed', parentSpy);
    el.addEventListener('taleart:load-failed', (e) => seen.push(e as CustomEvent));
    const result = emit(el, 'loadFailed', { ...PAYLOAD, error: 'refused' });
    expect(result).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].detail).toEqual({ name: 'loadFailed', ...PAYLOAD, error: 'refused' });
    expect(seen[0].bubbles).toBe(true);
    expect(seen[0].composed).toBe(true);
    expect(parentSpy).toHaveBeenCalledTimes(1);
  });

  it('does not let a throwing hook stop the other hooks or the DOM event, and logs it once', () => {
    const later = vi.fn();
    const el = host({
      onDismissed: () => {
        throw new Error('host bug');
      },
      onEvent: later,
    });
    init({ hooks: { onDismissed: later } });
    const domSpy = vi.fn();
    el.addEventListener('taleart:dismissed', domSpy);
    expect(() => emit(el, 'dismissed', PAYLOAD)).not.toThrow();
    expect(later).toHaveBeenCalledTimes(2);
    expect(domSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('returns false when a hook prevents a cancelable event', () => {
    const el = host({ onActionClicked: (e) => e.preventDefault() });
    const result = emit(el, 'actionClicked', { ...PAYLOAD, tale: TALE, component: { id: 'b1', type: 'button' }, url: 'https://example.com/shop', newTab: false }, { cancelable: true });
    expect(result).toBe(false);
  });

  it('returns false when a DOM listener prevents a cancelable event, and true when nothing does', () => {
    const el = host();
    el.addEventListener('taleart:action-clicked', (e) => e.preventDefault());
    const action = { ...PAYLOAD, tale: TALE, component: { id: 'b1', type: 'button' }, url: 'https://example.com/shop', newTab: true };
    expect(emit(el, 'actionClicked', action, { cancelable: true })).toBe(false);
    expect(emit(host(), 'actionClicked', action, { cancelable: true })).toBe(true);
  });

  it('ignores preventDefault on an event that is not cancelable', () => {
    const el = host({ onPresented: (e) => (e as unknown as { preventDefault?: () => void }).preventDefault?.() });
    expect(emit(el, 'presented', PAYLOAD)).toBe(true);
  });

  it('calls an element hook with the event, as the element holds it', () => {
    const hook = vi.fn();
    const el = host({ onLoaded: hook });
    emit(el, 'loaded', { zoneKeyPrefix: 'tak_abcd', zoneSlug: 'home' });
    expect(hook).toHaveBeenCalledWith({ name: 'loaded', zoneKeyPrefix: 'tak_abcd', zoneSlug: 'home' });
  });

  it('is silent with no hooks at all', () => {
    const el = host(null);
    expect(emit(el, 'dismissed', PAYLOAD)).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
