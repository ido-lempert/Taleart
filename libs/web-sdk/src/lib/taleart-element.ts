import {
  audienceRulePasses,
  encodeExternalUserIdHeader,
  tagRulePasses,
  viewerPropertiesFrom,
  viewerTagSet,
  type AnalyticsEventType,
  type DeliveryZone,
} from '@taleart/contract';
import { recordAnalyticsEvent, type AnalyticsTarget } from './analytics';
import { BANNER_FRAME_TYPE, BANNER_STYLES, renderBanner } from './banner';
import {
  applyCoverMotion,
  BAR_FRAME_TYPE,
  BAR_STYLES,
  COVER_MOTION_MS,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  renderBar,
  setItemSeen,
} from './bar';
import {
  checkFallback,
  checkFrequency,
  getConfig,
  init,
  mergeStrings,
  onConfigChange,
  parseFallback,
  readStrings,
  type ConfigKey,
  type FallbackMode,
} from './config';
import { fetchZone } from './delivery-client';
import { parseDir } from './direction';
import { emit, type GroupRef, type TaleRef, type TaleartHooks } from './hooks';
import { cappedGroupIds, type FrequencyRule, parseFrequency, recordView } from './frequency';
import { responseClient } from './responses';
import { coversInView, FIRST_CONTENT_MARK, holdMedia, loadFirstContent, mark, ZONE_MARK } from './first-content';
import { createTranslate, type StringsConfig, type Translate } from './i18n';
import type { Theme, ViewerProperties, ViewerPropertyValue } from './public-types';
import { markGroupSeen, seenGroupIds } from './seen';
import { applyTheme, readThemeOverride, THEME_SCHEME_STYLES } from './theme';
import { TaleViewer, VIEWER_STYLES } from './viewer';

export const TALEART_ELEMENT_TAG = 'taleart-view';

// The failed view's text and retry button, in the shadow root (fallback="message").
const FALLBACK_STYLES = `
.failed { display: grid; gap: 0.5rem; justify-items: center; padding: 1rem; font: inherit; text-align: center; }
.failed button { font: inherit; padding: 0.4rem 0.9rem; border: 1px solid currentColor; border-radius: 999px; background: transparent; color: inherit; cursor: pointer; }
`;

const API_URL_ATTR = 'api-url';
const ZONE_KEY_ATTR = 'zone-key';
const LOCALE_ATTR = 'locale';
const FALLBACK_ATTR = 'fallback';
const FREQUENCY_ATTR = 'frequency';
// The reading direction of this element: `ltr` or `rtl` overrides the page's, `auto` (or none) takes the page's or the SDK's `dir` option.
const DIR_ATTR = 'dir';
// `analytics="off"` turns the element's events off; any other value, or no attribute, leaves them to the SDK option.
const ANALYTICS_ATTR = 'analytics';
const ANALYTICS_OFF = 'off';
// The host's state while its zone failed to load (`failed`); removed on a reload or a success.
const STATE_ATTR = 'data-state';
// The zone's slug: read only for a configureZone theme when the response does not name it.
const ZONE_ATTR = 'zone';
// The attribute of the removed site key: it is no longer read, and one warning says so.
const SITE_KEY_ATTR = 'site-key';
const THEME_ATTR = 'theme';
// The part of the zone key that hook events may name: its first 8 characters, never the whole key.
const KEY_PREFIX_LENGTH = 8;
// A zone key or a site key passed where a slug goes: a warning names it by its start only.
const KEY_PREFIX = /^ta[ks]_/;

/** The SDK configuration of a zone, passed to {@link configureZone}. */
export interface ZoneOptions {
  /** Theme fields for every element of the zone; each one set wins over the project's theme (R9). */
  theme?: Partial<Theme> | null;
}

// The checked theme overrides set with configureZone, by zone slug, and the connected
// elements they restyle.
const zoneThemes = new Map<string, Readonly<Partial<Theme>>>();
const connected = new Set<TaleartElement>();

/**
 * Configures a zone for every `<taleart-view>` that shows it, now and later
 * (R9). `zone` is the zone's slug, as in `zone="home-top"` (epic UX rework
 * R3). `theme` holds theme fields that win over the project's theme for that
 * zone; an element's own `theme` wins over them. Calling again replaces the
 * zone's configuration; `configureZone(zone)` or `configureZone(zone, {})`
 * removes it. Rendered elements restyle at once, without a new request.
 * Invalid fields are ignored with one console warning each, naming the zone by
 * its slug, or a key passed by mistake by its start (`tak_…`, `tas_…`) only.
 */
export function configureZone(zone: string, options?: ZoneOptions | null): void {
  if (typeof zone !== 'string' || !zone) {
    console.warn('TaleArt: configureZone needs a zone slug; the configuration is ignored');
    return;
  }
  const name = KEY_PREFIX.test(zone) ? `${zone.slice(0, 8)}…` : zone;
  const theme = readThemeOverride(options?.theme, `the theme of zone "${name}"`);
  if (Object.keys(theme).length) zoneThemes.set(zone, theme);
  else zoneThemes.delete(zone);
  for (const element of connected) element.retheme();
}

/**
 * Tells the SDK the viewer's tags, for every `<taleart-view>` on the page, now
 * and later (epic targeting R2). A tale group with targeting tags shows only
 * when its rule passes: with Any, one of its tags is among these; with All,
 * every one is. Case and surrounding spaces are ignored. A group without tags
 * always shows, and so does every group while no tags are set: before any
 * call, after `setTags(null)` or `setTags([])`. Calling again replaces the
 * tags; rendered elements show the matching groups at once, without a new
 * request. The tags stay in the browser: they are never sent to TaleArt
 * (AD-13). A value that is not an array is ignored with one console warning.
 * Same as `init({ tags })`.
 */
export function setTags(tags: readonly string[] | null): void {
  init({ tags });
}

/**
 * Tells the SDK the viewer's properties, for every `<taleart-view>` on the page, now and later
 * (epic viewer properties): a flat map of name to value, a string, a number, a boolean or a list
 * of strings (dates as epoch milliseconds). A tale group with an audience rule shows only when the
 * rule passes for these properties, on top of its tags; a group without a rule always shows, and
 * so does every group while no properties are set: before any call, or after `setProperties(null)`.
 * Calling again replaces all of them; rendered elements show the matching groups at once, without
 * a new request. The properties are evaluated in the browser and are never sent to TaleArt: not in
 * a request, a header or an analytics event. Invalid entries are dropped with one console warning.
 * Same as `init({ properties })`.
 */
export function setProperties(properties: ViewerProperties | null): void {
  init({ properties });
}

/**
 * Sets one viewer property, keeping the others (epic viewer properties). A `null` value removes it.
 * On a page with no properties set, `setProperty(name, null)` changes nothing, so every group still
 * shows. Otherwise it behaves as {@link setProperties} does: the same re-render at once, no request,
 * nothing sent.
 */
export function setProperty(name: string, value: ViewerPropertyValue | null): void {
  const current = getConfig().properties;
  if (value === null && current === null) return;
  // A name or value that is not valid changes nothing (one warning), so a page never falls to {}.
  if (value !== null && !Object.prototype.hasOwnProperty.call(viewerPropertiesFrom({ [name]: value }) ?? {}, name)) {
    console.warn('TaleArt: setProperty ignores a property that is not valid (a name, then a value within the limits)');
    return;
  }
  const next: Record<string, unknown> = { ...(current ?? {}) };
  if (value === null) delete next[name];
  else next[name] = value;
  init({ properties: next as ViewerProperties });
}

/**
 * Tells the SDK who the viewer is, for user-list targeting, for every `<taleart-view>` on the page,
 * now and later (epic targeting R4): the host's own ID for the viewer, an opaque one, never an
 * email address or a phone number. A tale group targeted to user lists shows only to a viewer
 * whose ID is in one of them; groups without lists show as before. Every element reads its zone
 * again with the new ID. The ID is sent to the Delivery API in the `X-TaleArt-External-User-Id`
 * request header (base64url of its UTF-8 bytes), never in a URL, and is kept only in memory: not in
 * storage or a cookie, and never with the visitor id. `setExternalUserId(null)` sends none again.
 * The ID is trimmed and matched exactly (case counts). An ID no user list can hold (not text,
 * blank, over 256 characters, a control character) logs one console warning and sends no ID, so a
 * page never keeps showing the previous viewer's groups. Same as `init({ externalUserId })`.
 */
export function setExternalUserId(id: string | null): void {
  init({ externalUserId: id });
}

// The external user ID's header value (base64url of its UTF-8 bytes), or null for none.
function externalUserIdHeader(): string | null {
  const { externalUserId } = getConfig();
  return externalUserId === null ? null : encodeExternalUserIdHeader(externalUserId);
}

// The zone with only the tale groups whose tag rule and audience rule pass for the viewer.
function targeted(zone: DeliveryZone): DeliveryZone {
  const { tags: viewerTags, properties } = getConfig();
  const tags = viewerTagSet(viewerTags);
  return {
    ...zone,
    taleGroups: zone.taleGroups.filter((group) => tagRulePasses(group, tags) && audienceRulePasses(group.audience, properties)),
  };
}

// The ids of a zone's groups, as one string, to tell whether a render would change.
function groupKey(zone: DeliveryZone): string {
  return zone.taleGroups.map((group) => group.id).join('\n');
}

// The hook payload of a group of the zone: its id, name and position in the zone (from 0).
function groupRef(zone: DeliveryZone, groupId: string): GroupRef {
  const index = zone.taleGroups.findIndex((group) => group.id === groupId);
  return { id: groupId, name: zone.taleGroups[index]?.name ?? '', index };
}

// The hook payload of a tale of a group: its id, position in the group (from 0) and title.
function taleRef(zone: DeliveryZone, groupId: string, taleIndex: number): TaleRef {
  const tale = zone.taleGroups.find((group) => group.id === groupId)?.tales[taleIndex];
  return { id: tale?.id ?? '', index: taleIndex, title: tale?.title ?? '' };
}

// The group and the position in it of the tale with `taleId`, or null when the zone has none.
function locateTale(zone: DeliveryZone, taleId: string): { groupId: string; taleIndex: number } | null {
  for (const group of zone.taleGroups) {
    const taleIndex = group.tales.findIndex((tale) => tale.id === taleId);
    if (taleIndex >= 0) return { groupId: group.id, taleIndex };
  }
  return null;
}

// Applies a configuration change to the connected elements: a theme only restyles, new tags or
// properties only retarget, anything else reads the zone again.
onConfigChange((changed: ReadonlySet<ConfigKey>) => {
  const only = (key: ConfigKey) => changed.size === 1 && changed.has(key);
  const retargetOnly = [...changed].every((key) => key === 'tags' || key === 'properties');
  for (const element of connected) {
    if (only('theme') || only('dir')) element.retheme();
    else if (retargetOnly) element.retarget();
    else if (only('hooks') || only('analytics')) continue;
    else element.reload();
  }
});

// The rendered display: its element, and how it takes focus back for a group (its first item for null).
interface DisplayView {
  readonly element: HTMLElement;
  focus(groupId: string | null): boolean;
  destroy?(): void;
}

// A server (Node, no DOM) can import the package: the class then extends an empty base and nothing is defined.
const ElementBase: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as typeof HTMLElement) : HTMLElement;

/**
 * `<taleart-view zone-key="tak_…">`: reads the zone that the zone key names
 * from the Delivery API (`GET <api>/delivery/v1/zone`, the key as a bearer
 * token). Elements that read the same zone at once share one request. It
 * renders the zone in its Shadow DOM: its display, a bar or a banner (AD-17); a
 * zone without a display renders nothing. Frame types it does not know are
 * skipped (AD-5). A refused key or a network failure renders nothing and logs
 * one console error. Activating a bar item or a banner slide opens its tale
 * group in the full-screen viewer; groups this browser has viewed show the
 * seen ring in the bar. The zone's project theme (R9) styles the display and
 * the viewer through CSS custom properties on a wrapper inside the Shadow DOM;
 * each theme field set in the SDK configuration wins over it, in this order:
 * the `init` theme, the zone's {@link configureZone} option, then the element's
 * `theme` property (or `theme` attribute, JSON).
 *
 * The API origin comes from `api-url` or else `init({ apiUrl })`; the locale
 * from `locale` or else `init({ locale })`; the texts from `strings` or else
 * `init({ strings })`, and {@link t} looks them up.
 */

export class TaleartElement extends ElementBase {
  static get observedAttributes(): string[] {
    return [API_URL_ATTR, ZONE_KEY_ATTR, LOCALE_ATTR, THEME_ATTR, FALLBACK_ATTR, FREQUENCY_ATTR, ANALYTICS_ATTR, DIR_ATTR];
  }

  private readonly root = this.attachShadow({ mode: 'open' });
  // Bumped on every load, so only the latest response renders.
  private loadId = 0;
  private scheduled = false;
  private viewer: TaleViewer | null = null;
  // Where the viewer's interactive components send responses: the zone last read.
  private responses: ReturnType<typeof responseClient> | null = null;
  private view: DisplayView | null = null;
  // The group that takes focus after a reload that closed an open viewer.
  private pendingFocus: string | null = null;
  // The visitor's reduced-motion setting, watched while connected so animated covers follow it (R11, R12).
  private motionQuery: MediaQueryList | null = null;
  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    applyCoverMotion(this.root, event.matches);
    this.limitCoverMotion();
  };
  // Stops animated covers COVER_MOTION_MS after they start moving (WCAG 2.2.2).
  private coverTimer: ReturnType<typeof setTimeout> | undefined;
  // This element's checked, frozen theme override, and the rendered wrapper with the name its
  // zone configuration is set under (its slug) and the theme the Delivery API sent.
  private themeOverride: Readonly<Partial<Theme>> = Object.freeze({});
  private themed: { element: HTMLElement; configName: string; theme: unknown } | null = null;
  // True while the `theme` attribute present at upgrade is to be skipped, because a script set the property first.
  private skipThemeAttribute = false;
  // True once this element has set its zone mark, and its first-content mark (for a render still on the page).
  private zoneMarked = false;
  // True once this element has warned about the site-key attribute, which is no longer read (once per element).
  private warnedSiteKey = false;
  // This element's `strings` property, checked and copied; null for none.
  private ownStrings: StringsConfig | null = null;
  private marked = false;
  // Aborts the current render's first-content work (loadFirstContent).
  private renderAbort: AbortController | null = null;
  // The last zone the Delivery API sent, with its configuration name, so new viewer tags render
  // without a new request; and the groups rendered from it.
  private loaded: { zone: DeliveryZone; configName: string } | null = null;
  private renderedKey: string | null = null;
  // True while new viewer tags wait for the open viewer to close: its group still matches them.
  private retargetOnClose = false;
  // The group whose view the frequency cap counted since the viewer opened: one view per group entered, not per tale.
  private viewCounted: string | null = null;
  // This element's hooks (`hooks` property), checked and copied; null for none.
  private ownHooks: TaleartHooks | null = null;
  // The first 8 characters of the zone key of the last load: what hook events name of it.
  private hookKeyPrefix = '';
  // Groups whose impression fired since this element's last load: each fires once per load.
  private readonly impressed = new Set<string>();
  // Watches the rendered groups' items for groupImpression; null without IntersectionObserver or a render.
  private impressionObserver: IntersectionObserver | null = null;
  // Where this element's analytics events go: the API origin and zone key of the zone last read.
  private analyticsTarget: AnalyticsTarget | null = null;

  constructor() {
    super();
    // A theme set on the element before the SDK defined it shadows the accessor: take it out and
    // pass it through the setter. Set by script, it wins over a `theme` attribute present at
    // upgrade, which is then left unread (and logs nothing).
    if (Object.prototype.hasOwnProperty.call(this, 'theme')) {
      const value: unknown = (this as { theme?: unknown }).theme;
      delete (this as { theme?: unknown }).theme;
      this.skipThemeAttribute = this.hasAttribute(THEME_ATTR);
      this.theme = value as Partial<Theme> | null;
    }
  }

  /**
   * Theme fields for this element only, winning over the zone's
   * {@link configureZone} theme and the project's theme (R9). Set an object of
   * theme fields, or `null` to remove it. The value is copied, checked and
   * kept when set: invalid fields are ignored with one console warning each.
   * Reading it returns a copy of this element's own override fields that
   * passed (not the zone's or the project's).
   */
  get theme(): Partial<Theme> {
    const own = { ...this.themeOverride };
    if (own.ringColors) own.ringColors = [...own.ringColors];
    return own;
  }
  set theme(value: Partial<Theme> | null) {
    this.themeOverride = readThemeOverride(value, "the element's theme");
    this.retheme();
  }

  /** Shows the groups that match the viewer's tags again (setTags), without a new request. */
  retarget(): void {
    const loaded = this.loaded;
    if (!loaded || !this.isConnected) return;
    const zone = targeted(loaded.zone);
    // The same groups: the display, and an open viewer, stay as they are.
    if (groupKey(zone) === this.renderedKey) {
      this.retargetOnClose = false;
      return;
    }
    // An open viewer whose group still matches stays open; the display follows when it closes.
    // One whose group no longer matches closes, and focus goes to the display.
    const open = this.viewer?.groupId ?? null;
    if (open !== null && zone.taleGroups.some((group) => group.id === open)) {
      this.retargetOnClose = true;
      return;
    }
    this.render(zone, this.clear(), loaded.configName);
  }

  /** Reads the zone again, as for a changed attribute: the viewer's external user ID changed. */
  reload(): void {
    if (this.isConnected) this.scheduleLoad();
  }

  // The direction the display draws in: this element's `dir` attribute when it says ltr or rtl, else the
  // SDK's `dir` option when that does; otherwise none, and the page's direction is inherited.
  private applyDirection(): void {
    const themed = this.themed?.element;
    if (!themed) return;
    const own = parseDir(this.getAttribute(DIR_ATTR));
    const dir = own && own !== 'auto' ? own : getConfig().dir;
    if (dir === 'auto') themed.removeAttribute('dir');
    else themed.dir = dir;
  }

  /** Applies the theme again with the current SDK configuration, without a new request. */
  retheme(): void {
    this.applyDirection();
    const themed = this.themed;
    if (themed) {
      applyTheme(
        themed.element,
        themed.theme,
        getConfig().theme,
        zoneThemes.get(themed.configName) ?? {},
        this.themeOverride,
      );
    }
  }

  /**
   * The API origin of this element, such as `https://api.example.com`, from the `api-url` attribute;
   * empty when none is set (then `init({ apiUrl })` applies, see {@link ResolvedTaleartConfig}).
   */
  get apiUrl(): string {
    return this.getAttribute(API_URL_ATTR) ?? '';
  }
  set apiUrl(value: string) {
    this.setAttribute(API_URL_ATTR, value);
  }

  /** The zone key (`tak_…`) of the zone to show, issued in the dashboard; it names one zone. */
  get zoneKey(): string {
    return this.getAttribute(ZONE_KEY_ATTR) ?? '';
  }
  set zoneKey(value: string) {
    this.setAttribute(ZONE_KEY_ATTR, value);
  }

  /** This element's locale (BCP 47), from the `locale` attribute; empty for the SDK's locale. */
  get locale(): string {
    return this.getAttribute(LOCALE_ATTR) ?? '';
  }
  set locale(value: string) {
    this.setAttribute(LOCALE_ATTR, value);
  }

  /**
   * What this element shows when its zone fails to load: `none` (nothing, the default) or `message` (the
   * SDK's text and a retry button). A light-DOM child with `slot="fallback"` is shown instead when there
   * is one. Set `null` to remove it; the SDK's `fallback` option applies then.
   */
  get fallback(): FallbackMode | null {
    return parseFallback(this.getAttribute(FALLBACK_ATTR)) ?? null;
  }
  set fallback(value: FallbackMode | null) {
    if (value === null) this.removeAttribute(FALLBACK_ATTR);
    else this.setAttribute(FALLBACK_ATTR, value);
  }

  /**
   * How often a viewer sees a tale group of this element (see `frequency.ts`): `once`, `daily`, `weekly`
   * or a positive integer N. Set `null` to remove it; the SDK's `frequency` option applies then.
   */
  get frequency(): FrequencyRule | null {
    return parseFrequency(this.getAttribute(FREQUENCY_ATTR)) ?? null;
  }
  set frequency(value: FrequencyRule | null) {
    if (value === null) this.removeAttribute(FREQUENCY_ATTR);
    else this.setAttribute(FREQUENCY_ATTR, String(value));
  }

  /**
   * Whether this element reports its impressions, opens, views and clicks (see `analytics.ts`): `false` for
   * `analytics="off"`, `true` for any other attribute value, `null` for none (the SDK's `analytics` option
   * applies then). Set `null` to remove the attribute.
   */
  get analytics(): boolean | null {
    const value = this.getAttribute(ANALYTICS_ATTR);
    return value === null ? null : value !== ANALYTICS_OFF;
  }
  set analytics(value: boolean | null) {
    if (value === null) this.removeAttribute(ANALYTICS_ATTR);
    else this.setAttribute(ANALYTICS_ATTR, value ? 'on' : ANALYTICS_OFF);
  }

  /** Reads the zone again after a failed load: the retry button of `fallback="message"` calls it. */
  retry(): void {
    this.reload();
  }

  /**
   * This element's texts, per locale or flat (see `i18n.ts`), added to the SDK configuration's
   * `strings` (this element's win). Set an object, or `null` to remove them. Reading returns a copy.
   */
  get strings(): StringsConfig | null {
    return this.ownStrings === null ? null : readStrings(this.ownStrings, "the element's strings") ?? null;
  }
  set strings(value: StringsConfig | null) {
    const strings = readStrings(value, "the element's strings");
    if (strings === undefined) return;
    this.ownStrings = strings;
    if (this.isConnected) this.scheduleLoad();
  }

  /**
   * This element's hooks (see `hooks.ts`), called before the global ones from `init({ hooks })`. Set an
   * object, or `null` to remove them. Reading returns the object as set (a copy).
   */
  get hooks(): TaleartHooks | null {
    return this.ownHooks === null ? null : { ...this.ownHooks };
  }
  set hooks(value: TaleartHooks | null) {
    if (value === null) this.ownHooks = null;
    else if (typeof value === 'object' && !Array.isArray(value)) this.ownHooks = { ...value };
    else console.warn("TaleArt: the element's hooks must be an object of hook functions, or null; it is ignored");
  }

  /**
   * The translate function of this element: `t('viewer.close')` in its locale (the `locale` attribute,
   * else the SDK's) with its strings (the `strings` property over the SDK's `strings`). Named `t`
   * because `translate` is the HTML attribute every element has.
   */
  get t(): Translate {
    const config = getConfig();
    return createTranslate(this.locale || config.locale, mergeStrings(config.strings, this.ownStrings) ?? undefined);
  }

  /** The zone's slug, such as `home-top`, from the `zone` attribute. Not needed to show the zone. */
  get zone(): string {
    return this.getAttribute(ZONE_ATTR) ?? '';
  }
  set zone(value: string) {
    this.setAttribute(ZONE_ATTR, value);
  }

  connectedCallback(): void {
    connected.add(this);
    if (!this.warnedSiteKey && this.hasAttribute(SITE_KEY_ATTR)) {
      this.warnedSiteKey = true;
      console.warn(`TaleArt: the ${SITE_KEY_ATTR} attribute is no longer read; place the zone with ${ZONE_KEY_ATTR}`);
    }
    // Properties set before the SDK defined the element shadow the accessors: pass them through.
    for (const name of ['apiUrl', 'zoneKey', 'locale', 'strings', 'hooks', 'fallback', 'frequency', 'analytics'] as const) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
      const value: unknown = (this as unknown as Record<string, unknown>)[name];
      delete (this as unknown as Record<string, unknown>)[name];
      (this as unknown as Record<string, unknown>)[name] = value;
    }
    if (typeof matchMedia === 'function') {
      const query = matchMedia(REDUCED_MOTION_QUERY);
      this.motionQuery = query;
      // Safari before 14 has only the older addListener.
      if (typeof query.addEventListener === 'function') query.addEventListener('change', this.onMotionChange);
      else query.addListener?.(this.onMotionChange);
    }
    this.scheduleLoad();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (name === THEME_ATTR) {
      if (this.skipThemeAttribute) this.skipThemeAttribute = false;
      else this.theme = this.parseThemeAttribute(newValue) as Partial<Theme> | null;
      return;
    }
    // Analytics only decides what is sent from now on: the zone is not read again.
    if (name === ANALYTICS_ATTR) return;
    // The direction only turns the display and the viewer around: nothing is read again.
    if (name === DIR_ATTR) {
      if (newValue !== null && newValue !== '' && parseDir(newValue) === undefined) {
        console.warn('TaleArt: the element\'s dir attribute must be ltr, rtl or auto; it is ignored');
      }
      this.applyDirection();
      return;
    }
    // An invalid fallback or frequency is ignored with one warning, and the SDK's option applies.
    if (name === FALLBACK_ATTR) checkFallback(newValue, "the element's fallback attribute");
    if (name === FREQUENCY_ATTR) checkFrequency(newValue, "the element's frequency attribute");
    if (this.isConnected) this.scheduleLoad();
  }

  // The `theme` attribute's JSON. A missing or empty attribute is no override; text that is not
  // JSON, or JSON `null`, is none either, with one warning (other non-objects warn in the setter).
  private parseThemeAttribute(value: string | null): unknown {
    if (value === null || value.trim() === '') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      console.warn("TaleArt: the element's theme attribute is not valid JSON; it is ignored");
      return null;
    }
    if (parsed === null) console.warn("TaleArt: the element's theme attribute must be a JSON object; it is ignored");
    return parsed;
  }

  disconnectedCallback(): void {
    connected.delete(this);
    const query = this.motionQuery;
    if (query && typeof query.removeEventListener === 'function') query.removeEventListener('change', this.onMotionChange);
    else query?.removeListener?.(this.onMotionChange);
    this.motionQuery = null;
    this.loadId++;
    // Held pictures of the render stay held: a removed element starts no downloads.
    this.stopFirstContent();
    this.closeViewer();
    this.destroyView();
  }

  // Animated covers that move (no reduced motion) stop on their first frame after COVER_MOTION_MS.
  private limitCoverMotion(): void {
    clearTimeout(this.coverTimer);
    this.coverTimer = undefined;
    if (prefersReducedMotion() || !this.root.querySelector('.cover[data-animated]')) return;
    this.coverTimer = setTimeout(() => {
      this.coverTimer = undefined;
      applyCoverMotion(this.root, true);
    }, COVER_MOTION_MS);
  }

  // Stops the current render's first-content work: its timer, listeners, releases and mark.
  private stopFirstContent(): void {
    clearTimeout(this.coverTimer);
    this.coverTimer = undefined;
    this.renderAbort?.abort();
    this.renderAbort = null;
  }

  // Closes the viewer; returns the group it showed, or null when it was not open.
  private closeViewer(): string | null {
    const viewer = this.viewer;
    this.viewer = null;
    const groupId = viewer?.groupId ?? null;
    viewer?.close();
    return groupId;
  }

  // Setting both attributes in one task loads once.
  private scheduleLoad(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.load();
    });
  }

  private async load(): Promise<void> {
    const id = ++this.loadId;
    const apiUrl = this.apiUrl || getConfig().apiUrl;
    const key = this.zoneKey;
    this.loaded = null;
    this.removeAttribute(STATE_ATTR);
    const focusGroup = this.clear();
    this.impressed.clear();
    this.hookKeyPrefix = key.slice(0, KEY_PREFIX_LENGTH);
    if (!apiUrl || !key || !this.isConnected) return;
    // Nothing escapes as an unhandled rejection: any failure renders nothing and logs once.
    try {
      const request = { key };
      const zone = await fetchZone(apiUrl, request, undefined, externalUserIdHeader());
      if (id !== this.loadId) return;
      this.responses = responseClient(apiUrl, request);
      if (!this.zoneMarked) {
        this.zoneMarked = true;
        mark(ZONE_MARK);
      }
      // The zone's slug names its configureZone theme; the response carries it.
      const configName = typeof zone.slug === 'string' && zone.slug ? zone.slug : this.zone;
      this.loaded = { zone, configName };
      this.analyticsTarget = { apiUrl, key };
      emit(this, 'loaded', { zoneKeyPrefix: this.hookKeyPrefix, zoneSlug: configName });
      this.render(targeted(zone), focusGroup, configName);
    } catch (err) {
      if (id !== this.loadId) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`TaleArt: ${message}`);
      this.root.replaceChildren(this.failedView());
      this.setAttribute(STATE_ATTR, 'failed');
      emit(this, 'loadFailed', { zoneKeyPrefix: this.hookKeyPrefix, zoneSlug: this.zone, error: message });
    }
  }

  // Queues one analytics event of this zone (analytics.ts), unless the SDK or the element turns analytics off,
  // or the zone has not loaded (a failed load sends nothing). The studio preview is not an element, so it sends none.
  private track(type: AnalyticsEventType, group: GroupRef, tale?: TaleRef): void {
    const target = this.analyticsTarget;
    if (!target || !this.loaded || !this.analyticsOn()) return;
    recordAnalyticsEvent(target, { type, groupId: group.id, ...(tale ? { taleId: tale.id } : {}) });
  }

  // The element's attribute when set, else the SDK's `analytics` option.
  private analyticsOn(): boolean {
    const value = this.getAttribute(ANALYTICS_ATTR);
    return value === null ? getConfig().analytics : value !== ANALYTICS_OFF;
  }

  // Takes the rendered display and viewer off; returns the group that takes focus once the next
  // render is on the page (a reload or new tags while the viewer is open put focus back on the display).
  private clear(): string | null {
    const focusGroup = this.closeViewer() ?? this.pendingFocus;
    this.pendingFocus = focusGroup;
    this.stopFirstContent();
    this.destroyView();
    this.root.replaceChildren();
    this.themed = null;
    this.renderedKey = null;
    this.retargetOnClose = false;
    return focusGroup;
  }

  // What a zone that failed to load shows, as a fragment: the light-DOM fallback child, in its slot;
  // or, with fallback="message" and no such child, the SDK's text and a retry button. Nothing otherwise.
  private failedView(): DocumentFragment {
    const view = document.createDocumentFragment();
    if (this.querySelector(':scope > [slot="fallback"]')) {
      const slot = document.createElement('slot');
      slot.name = 'fallback';
      view.append(slot);
    } else if (this.fallbackMode() === 'message') {
      const wrap = document.createElement('div');
      wrap.className = 'failed';
      wrap.setAttribute('role', 'status');
      const style = document.createElement('style');
      style.textContent = FALLBACK_STYLES;
      const text = document.createElement('p');
      text.textContent = this.t('load.failed');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = this.t('load.retry');
      retry.addEventListener('click', () => this.retry());
      wrap.append(text, retry);
      view.append(style, wrap);
    }
    return view;
  }

  // The fallback mode: the element's attribute when valid, else the SDK's option, else none.
  private fallbackMode(): FallbackMode {
    return parseFallback(this.getAttribute(FALLBACK_ATTR)) ?? getConfig().fallback;
  }

  // The frequency cap: the element's attribute when valid, else the SDK's option, else none.
  private frequencyRule(): FrequencyRule | null {
    return parseFrequency(this.getAttribute(FREQUENCY_ATTR)) ?? getConfig().frequency;
  }

  // The zone without the tale groups the frequency cap has reached; each one is reported (groupCapped).
  private withinFrequency(zone: DeliveryZone, configName: string): DeliveryZone {
    const rule = this.frequencyRule();
    if (rule === null) return zone;
    const capped = cappedGroupIds(zone.taleGroups.map((group) => group.id), rule);
    if (capped.size === 0) return zone;
    const base = { zoneKeyPrefix: this.hookKeyPrefix, zoneSlug: configName };
    for (const groupId of capped) emit(this, 'groupCapped', { ...base, groupId, rule });
    return { ...zone, taleGroups: zone.taleGroups.filter((group) => !capped.has(group.id)) };
  }

  // Renders the zone's display (AD-17) when the SDK knows its type; unknown types are skipped (AD-5).
  private render(input: DeliveryZone, focusGroup: string | null, configName: string): void {
    this.pendingFocus = null;
    this.renderedKey = groupKey(input);
    const zone = this.withinFrequency(input, configName);
    // Every group is capped: the display renders nothing.
    if (zone.taleGroups.length === 0 && input.taleGroups.length > 0) return;
    // The response is untrusted: anything but an object reads as no display.
    const frame = typeof zone.frame === 'object' && zone.frame !== null ? zone.frame : null;
    const names = new Map(zone.taleGroups.map((group) => [group.id, group.name]));
    const seen = seenGroupIds();
    // The strings this render shows, and what its hook events name the zone by.
    const t = this.t;
    const base = { zoneKeyPrefix: this.hookKeyPrefix, zoneSlug: configName };
    // The responses client, reporting each answer the server accepts as a userInteracted event.
    const client = this.responses;
    const responses = client ? {
      stored: client.stored,
      send: async (taleId: string, elementId: string, value: string) => {
        const response = await client.send(taleId, elementId, value);
        const found = locateTale(zone, taleId);
        if (found) {
          const tale = zone.taleGroups.find((group) => group.id === found.groupId)?.tales[found.taleIndex];
          const type = tale?.document?.elements?.find((element) => element.id === elementId)?.type ?? '';
          emit(this, 'userInteracted', {
            ...base,
            group: groupRef(zone, found.groupId),
            tale: taleRef(zone, found.groupId, found.taleIndex),
            component: { id: elementId, type, value: response.value },
          });
          // The answer selected (components, 2026-10-29): its value is the option id, the answer id or the number.
          emit(this, 'componentEvent', {
            ...base,
            groupId: found.groupId,
            taleId: taleRef(zone, found.groupId, found.taleIndex).id,
            component: type,
            action: 'selected',
            value: response.value,
          });
        }
        return response;
      },
    } : undefined;
    // Holds the display and the viewer, so both inherit the theme's custom properties.
    const themed = document.createElement('div');
    themed.className = 'taleart';
    this.themed = { element: themed, configName, theme: zone.theme };
    this.retheme();
    let barItems: Map<string, HTMLButtonElement> | null = null;
    // The display's item or slide of the group shown last takes focus back when the viewer closes.
    let view: DisplayView | null = null;
    const viewer = new TaleViewer(themed, zone.taleGroups, {
      onGroupShown: (groupId) => {
        markGroupSeen(groupId);
        if (this.viewCounted !== groupId) {
          this.viewCounted = groupId;
          recordView(groupId);
        }
        const item = barItems?.get(groupId);
        if (item) setItemSeen(item, names.get(groupId) ?? '', true, t);
      },
      onPresented: (groupId) => {
        const group = groupRef(zone, groupId);
        emit(this, 'presented', { ...base, group });
        this.track('open', group);
      },
      onTaleShown: (groupId, taleIndex) => {
        const group = groupRef(zone, groupId);
        const tale = taleRef(zone, groupId, taleIndex);
        emit(this, 'taleShown', { ...base, group, tale });
        this.track('view', group, tale);
      },
      onComponentEvent: (groupId, taleIndex, fire) =>
        emit(this, 'componentEvent', {
          ...base,
          groupId,
          taleId: taleRef(zone, groupId, taleIndex).id,
          ...fire,
        }),
      onAction: (groupId, taleIndex, action) => {
        const group = groupRef(zone, groupId);
        const tale = taleRef(zone, groupId, taleIndex);
        const proceed = emit(
          this,
          'actionClicked',
          {
            ...base,
            group,
            tale,
            component: { id: action.id, type: action.type },
            url: action.url,
            newTab: action.newTab,
          },
          { cancelable: true },
        );
        // Counted whether or not the host cancelled the navigation.
        this.track('click', group, tale);
        return proceed;
      },
      onClose: (groupId) => {
        this.viewCounted = null;
        emit(this, 'dismissed', { ...base, group: groupRef(zone, groupId) });
        // New viewer tags arrived while it was open: show the matching groups now, focus on this one.
        if (this.retargetOnClose && this.viewer === viewer) {
          this.retargetOnClose = false;
          this.viewer = null;
          this.pendingFocus = groupId;
          this.retarget();
          return;
        }
        view?.focus(groupId);
      },
      // Votes go to the zone this element read (epic interactive components R9).
      responses,
      t,
    });
    const open = (groupId: string) => {
      if (this.viewer === viewer) viewer.open(groupId);
    };

    if (frame?.type === BAR_FRAME_TYPE) {
      // Cover pictures are held until the first content is laid out (loadFirstContent).
      const bar = holdMedia(() => renderBar(zone.taleGroups, seen, frame.settings, undefined, t));
      const items = new Map<string, HTMLButtonElement>();
      for (const button of bar.querySelectorAll<HTMLButtonElement>('button.item')) {
        items.set(button.dataset['taleGroupId'] ?? '', button);
      }
      barItems = items;
      view = {
        element: bar,
        focus: (groupId) => {
          const item = groupId === null ? bar.querySelector<HTMLButtonElement>('button.item') : items.get(groupId);
          item?.focus();
          return !!item;
        },
      };
      bar.addEventListener('click', (e) => {
        const item = (e.target as Element | null)?.closest<HTMLButtonElement>('button.item');
        if (item) open(item.dataset['taleGroupId'] ?? '');
      });
    } else if (frame?.type === BANNER_FRAME_TYPE) {
      const banner = holdMedia(() =>
        renderBanner(
          zone.taleGroups,
          frame.settings,
          (groupId) => {
            if (view) open(groupId);
          },
          t,
        ),
      );
      if (banner) {
        view = {
          element: banner.element,
          focus: (groupId) => banner.focus(groupId),
          destroy: () => banner.destroy(),
        };
      }
    }
    this.view = view;
    if (!view) return;
    const style = document.createElement('style');
    style.textContent = THEME_SCHEME_STYLES + BAR_STYLES + BANNER_STYLES + VIEWER_STYLES;
    this.viewer = viewer;
    themed.replaceChildren(view.element);
    this.root.replaceChildren(style, themed);
    this.watchImpressions(view.element, zone, configName);
    this.limitCoverMotion();
    // The display's covers in view load first, then the rest of this render's pictures; the
    // first zone content this element shows is marked once, when it is on the page (NFR-006).
    const abort = new AbortController();
    this.renderAbort = abort;
    void loadFirstContent(themed, coversInView(view.element), abort.signal, () => {
      if (this.marked) return;
      this.marked = true;
      mark(FIRST_CONTENT_MARK);
    });
    // The group's item or slide, or else the display's first one.
    if (focusGroup !== null && !view.focus(focusGroup)) view.focus(null);
  }

  // Stops the timers of the rendered display.
  private destroyView(): void {
    this.view?.destroy?.();
    this.view = null;
    this.impressionObserver?.disconnect();
    this.impressionObserver = null;
  }

  // Emits groupImpression once per group per load, when the group's item or slide is half on screen
  // (IntersectionObserver; without it no impression is emitted).
  private watchImpressions(element: HTMLElement, zone: DeliveryZone, zoneSlug: string): void {
    this.impressionObserver?.disconnect();
    this.impressionObserver = null;
    if (typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          const groupId = target.dataset['taleGroupId'] ?? '';
          observer.unobserve(target);
          if (!groupId || this.impressed.has(groupId)) continue;
          this.impressed.add(groupId);
          const group = groupRef(zone, groupId);
          emit(this, 'groupImpression', { zoneKeyPrefix: this.hookKeyPrefix, zoneSlug, group });
          this.track('impression', group);
        }
      },
      { threshold: 0.5 },
    );
    for (const node of element.querySelectorAll<HTMLElement>('[data-tale-group-id]')) {
      if (!this.impressed.has(node.dataset['taleGroupId'] ?? '')) observer.observe(node);
    }
    this.impressionObserver = observer;
  }
}

export function defineTaleartElement(tag = TALEART_ELEMENT_TAG): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, TaleartElement);
  }
}
