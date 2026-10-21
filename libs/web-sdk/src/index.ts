import { defineTaleartElement } from './lib/taleart-element';

export { configureZone, defineTaleartElement, TaleartElement, TALEART_ELEMENT_TAG } from './lib/taleart-element';
export type { ZoneOptions } from './lib/taleart-element';

// Loading the SDK registers `<taleart-view>`, so a host page needs only the script tag.
if (typeof customElements !== 'undefined') defineTaleartElement();
