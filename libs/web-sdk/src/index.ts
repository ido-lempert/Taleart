import { init } from './lib/config';
import { configureZone, defineTaleartElement, setExternalUserId, setTags } from './lib/taleart-element';

export { getConfig, init } from './lib/config';
export {
  configureZone,
  defineTaleartElement,
  setExternalUserId,
  setTags,
  TaleartElement,
  TALEART_ELEMENT_TAG,
} from './lib/taleart-element';
export type { ZoneOptions } from './lib/taleart-element';
export type { ConfigKey, FallbackMode, ResolvedTaleartConfig, TaleartConfig } from './lib/config';
export type { FrequencyRule } from './lib/frequency';
export type {
  ActionClickedEvent,
  ComponentAction,
  ComponentEvent,
  ComponentRef,
  DismissedEvent,
  GroupCappedEvent,
  GroupImpressionEvent,
  GroupRef,
  LoadedEvent,
  LoadFailedEvent,
  PresentedEvent,
  TaleartEvent,
  TaleartEventName,
  TaleartHooks,
  TaleRef,
  TaleShownEvent,
  UserInteractedEvent,
} from './lib/hooks';

// Loading the SDK registers `<taleart-view>`, so a host page needs only the script tag.
if (typeof customElements !== 'undefined') defineTaleartElement();

// The page's handle: `Taleart.init({ … })` before or after the elements connect.
(globalThis as unknown as { Taleart: unknown }).Taleart = { init, configureZone, setExternalUserId, setTags, defineTaleartElement };
