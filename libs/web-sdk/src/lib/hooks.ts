// The SDK's hooks (listener-style): callbacks the host page sets with `Taleart.init({ hooks })` for every
// element, or with `element.hooks` for one. Each event is also a bubbling DOM CustomEvent on the element.
import { getConfig } from './config';
import type { FrequencyRule } from './frequency';

/** A tale group in the zone, as the event names it: its id, name and position in the zone (from 0). */
export interface GroupRef {
  id: string;
  name: string;
  index: number;
}

/** A tale in its group: its id, position in the group (from 0) and title. */
export interface TaleRef {
  id: string;
  index: number;
  title: string;
}

/** An interactive component or a link of a tale: its element id and type (`poll`, `button`, ...), and its answer. */
export interface ComponentRef {
  id: string;
  type: string;
  value?: string;
}

// Every event names the zone: the first 8 characters of its zone key (never the whole key) and its slug.
interface EventBase {
  zoneKeyPrefix: string;
  zoneSlug: string;
}

/** The zone was read and its display is rendered (or none is needed). */
export interface LoadedEvent extends EventBase {
  name: 'loaded';
}

/** The zone could not be read: a refused key, a network failure or a bad answer. `error` is the message. */
export interface LoadFailedEvent extends EventBase {
  name: 'loadFailed';
  error: string;
}

/** A group's bar item or banner slide first became half visible in the element (once per group per load). */
export interface GroupImpressionEvent extends EventBase {
  name: 'groupImpression';
  group: GroupRef;
}

/** The full-screen viewer opened on a group. */
export interface PresentedEvent extends EventBase {
  name: 'presented';
  group: GroupRef;
}

/** The full-screen viewer closed; `group` is the group it showed last. */
export interface DismissedEvent extends EventBase {
  name: 'dismissed';
  group: GroupRef;
}

/** A tale of a group came on screen in the viewer. */
export interface TaleShownEvent extends EventBase {
  name: 'taleShown';
  group: GroupRef;
  tale: TaleRef;
}

/**
 * A call to action of a tale was activated (a button, an image button or the swipe-up link) before it
 * navigates. `url` is its destination and `newTab` whether it opens a new tab. Cancelable: calling
 * `preventDefault()` (on the event, in the hook or in a `taleart:action-clicked` listener) stops the navigation.
 */
export interface ActionClickedEvent extends EventBase {
  name: 'actionClicked';
  group: GroupRef;
  tale: TaleRef;
  component: ComponentRef;
  url: string;
  newTab: boolean;
  preventDefault(): void;
}

/** A tale group was left out of the display by the frequency cap (once per group per render). `rule` is the cap. */
export interface GroupCappedEvent extends EventBase {
  name: 'groupCapped';
  groupId: string;
  rule: FrequencyRule;
}

/** The visitor's answer to a poll, a quiz or a Rating was accepted by the server. */
export interface UserInteractedEvent extends EventBase {
  name: 'userInteracted';
  group: GroupRef;
  tale: TaleRef;
  component: ComponentRef & { value: string };
}

/**
 * What an element of a tale did (components, 2026-10-29): a countdown `ended`, a promo code was `copied`,
 * and a visitor's answer was `selected` (a poll's option, a quiz's answer or a Rating's number).
 */
export type ComponentAction = 'ended' | 'copied' | 'selected';

/**
 * A component of a tale did something: `component` is its element type (`countdown`, `promo-code`, `poll`,
 * `quiz`, `rating`), `action` what it did, and `value` what it did it with: a promo code's code, a poll's
 * option id, a quiz's answer id or a Rating's number as text. Fired in addition to `userInteracted`, which
 * stays as it is, and reaches `onEvent` too.
 */
export interface ComponentEvent extends EventBase {
  name: 'componentEvent';
  groupId: string;
  taleId: string;
  component: string;
  action: ComponentAction;
  value?: string;
}

/** Every event the SDK emits. */
export type TaleartEvent =
  | LoadedEvent
  | LoadFailedEvent
  | GroupImpressionEvent
  | PresentedEvent
  | DismissedEvent
  | TaleShownEvent
  | ActionClickedEvent
  | UserInteractedEvent
  | GroupCappedEvent
  | ComponentEvent;

/** The name of an event, as in `onLoaded` (the hook is `on` plus the name). */
export type TaleartEventName = TaleartEvent['name'];

/** The hooks a host page sets. Each is optional; `onEvent` gets every event. A hook's exception is logged, never thrown. */
export interface TaleartHooks {
  onLoaded?: (event: LoadedEvent) => void;
  onLoadFailed?: (event: LoadFailedEvent) => void;
  onGroupImpression?: (event: GroupImpressionEvent) => void;
  onPresented?: (event: PresentedEvent) => void;
  onDismissed?: (event: DismissedEvent) => void;
  onTaleShown?: (event: TaleShownEvent) => void;
  onActionClicked?: (event: ActionClickedEvent) => void;
  onUserInteracted?: (event: UserInteractedEvent) => void;
  onGroupCapped?: (event: GroupCappedEvent) => void;
  onComponentEvent?: (event: ComponentEvent) => void;
  onEvent?: (event: TaleartEvent) => void;
}

type EventOf<N extends TaleartEventName> = Extract<TaleartEvent, { name: N }>;
/** What {@link emit} takes for an event: the event without its name (and without `preventDefault`). */
export type EventDetail<N extends TaleartEventName> = Omit<EventOf<N>, 'name' | 'preventDefault'>;

/** The events that can be canceled with `preventDefault()`. */
const CANCELABLE: ReadonlySet<TaleartEventName> = new Set<TaleartEventName>(['actionClicked']);

// `loadFailed` -> `load-failed`: the DOM event's name.
const domName = (name: TaleartEventName): string => `taleart:${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
// `loadFailed` -> `onLoadFailed`: the hook's name.
const hookName = (name: TaleartEventName): keyof TaleartHooks => `on${name[0].toUpperCase()}${name.slice(1)}` as keyof TaleartHooks;

/** An element that can carry hooks (`<taleart-view>`). */
export type HookHost = HTMLElement & { hooks?: TaleartHooks | null };

/**
 * Emits `name` from `element`: calls the element's hook for it, then the global hook (`init({ hooks })`),
 * then each one's `onEvent`; every call is guarded, so a throwing hook is logged and changes nothing.
 * Then dispatches the bubbling, composed DOM event `taleart:<kebab-name>` on the element. Returns false
 * when the event was canceled (for a cancelable event, `preventDefault()` was called), true otherwise.
 */
export function emit<N extends TaleartEventName>(
  element: HookHost,
  name: N,
  detail: EventDetail<N>,
  options: { cancelable?: boolean } = {},
): boolean {
  const cancelable = options.cancelable === true && CANCELABLE.has(name);
  let dom: CustomEvent<unknown> | null = null;
  const payload: Record<string, unknown> = { name, ...detail };
  if (cancelable) payload['preventDefault'] = () => dom?.preventDefault();
  // Built before the hooks run, so a hook's preventDefault() reaches it.
  dom = new CustomEvent(domName(name), { bubbles: true, composed: true, cancelable, detail: payload });

  const own = isHooks(element.hooks) ? element.hooks : null;
  const globalHooks = getConfig().hooks;
  const key = hookName(name);
  const calls: [unknown, unknown][] = [
    [own, own?.[key]],
    [globalHooks, globalHooks?.[key]],
    [own, own?.onEvent],
    [globalHooks, globalHooks?.onEvent],
  ];
  for (const [owner, fn] of calls) {
    if (typeof fn !== 'function') continue;
    try {
      (fn as (event: unknown) => void).call(owner, payload);
    } catch (err) {
      console.error(`TaleArt: the ${String(key)} hook threw; the SDK continues`, err);
    }
  }
  element.dispatchEvent(dom);
  return !dom.defaultPrevented;
}

// A hooks object: an element's `hooks` or the global ones (anything else is no hooks).
function isHooks(value: unknown): value is TaleartHooks {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
