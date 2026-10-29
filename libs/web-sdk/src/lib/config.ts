// The SDK's global configuration: `Taleart.init(config)` sets it, every element reads it (epic SDK v2).
import { encodeExternalUserIdHeader } from '@taleart/contract';
import type { StringsConfig } from './i18n';
import { parseFrequency, type FrequencyRule } from './frequency';
import type { TaleartHooks } from './hooks';
import type { Theme } from './public-types';
import { readThemeOverride } from './theme';

/** What a `<taleart-view>` shows when its zone cannot be loaded: nothing, or a message with a retry button. */
export type FallbackMode = 'none' | 'message';

/**
 * The options of `Taleart.init(config)`. All are optional: an option left out keeps its value, and
 * one given replaces it. Calling it before or after the elements connect is fine; the elements
 * read the configuration again.
 */
export interface TaleartConfig {
  /** The TaleArt API origin. Default: the origin the SDK script loads from. */
  apiUrl?: string;
  /** The locale (BCP 47, such as `he-IL`); `null` clears it. Default: `document.documentElement.lang`, then `en`. */
  locale?: string | null;
  /** Overrides of the SDK's texts, per locale (`{ he: { 'viewer.close': '…' } }`) or flat for every locale. */
  strings?: StringsConfig | null;
  /** Theme fields for every element. A zone's {@link configureZone} theme and an element's own theme win over it. */
  theme?: Partial<Theme> | null;
  /** The viewer's external user ID, as {@link setExternalUserId} takes it. */
  externalUserId?: string | null;
  /** The viewer's tags, as {@link setTags} takes them. */
  tags?: readonly string[] | null;
  /** Hooks for every element (see `hooks.ts`); an element's own `hooks` property adds to them. */
  hooks?: TaleartHooks | null;
  /** What elements show when their zone fails to load: `none` (default) or `message` (text and a retry button). */
  fallback?: FallbackMode | null;
  /** How often a viewer sees a tale group: `once`, `daily`, `weekly` or a positive integer N. Default: none. */
  frequency?: FrequencyRule | null;
  /** Whether elements report impressions, opens, views and clicks to the Delivery API. `false` turns it off; `null` means on. Default: on. */
  analytics?: boolean | null;
}

/** What {@link getConfig} returns: every option with the value the SDK uses. */
export interface ResolvedTaleartConfig {
  readonly apiUrl: string;
  readonly locale: string;
  readonly strings: StringsConfig | null;
  readonly theme: Readonly<Partial<Theme>>;
  readonly externalUserId: string | null;
  readonly tags: readonly string[] | null;
  readonly hooks: TaleartHooks | null;
  readonly fallback: FallbackMode;
  readonly frequency: FrequencyRule | null;
  readonly analytics: boolean;
}

/** The names of the options. */
export type ConfigKey = keyof TaleartConfig;

/** Told after a change, with the names of the options that changed. */
export type ConfigListener = (changed: ReadonlySet<ConfigKey>) => void;

const KEYS: readonly ConfigKey[] = [
  'apiUrl',
  'locale',
  'strings',
  'theme',
  'externalUserId',
  'tags',
  'hooks',
  'fallback',
  'frequency',
  'analytics',
];

/**
 * The API origin a script loaded from `scriptUrl` belongs to (`https://api.example.com` for
 * `https://api.example.com/sdk/v1/taleart.js`), or '' when the script has none (a file or an
 * opaque origin).
 */
export function defaultApiUrl(scriptUrl: string): string {
  try {
    const { origin } = new URL(scriptUrl);
    return /^https?:\/\//.test(origin) ? origin : '';
  } catch {
    return '';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks strings overrides: null clears them, an object is copied (its locale objects too), and
 * anything else is `undefined` (invalid, to be ignored by the caller), with one console warning.
 */
export function readStrings(value: unknown, source: string): StringsConfig | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) {
    console.warn(`TaleArt: ${source} must be an object of strings; it is ignored`);
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, text]) => [key, isRecord(text) ? { ...text } : text]),
  ) as StringsConfig;
}

/**
 * Two strings overrides as one: `own` wins over `base`, locale by locale, so an element's `strings`
 * property adds to or replaces the SDK configuration's.
 */
export function mergeStrings(base: StringsConfig | null, own: StringsConfig | null): StringsConfig | null {
  if (!base) return own;
  if (!own) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(own)) {
    const current = merged[key];
    merged[key] = isRecord(value) && isRecord(current) ? { ...current, ...value } : value;
  }
  return merged as StringsConfig;
}

interface State {
  apiUrl: string;
  locale: string;
  strings: StringsConfig | null;
  theme: Readonly<Partial<Theme>>;
  externalUserId: string | null;
  tags: readonly string[] | null;
  hooks: TaleartHooks | null;
  fallback: FallbackMode;
  frequency: FrequencyRule | null;
  analytics: boolean;
}

let state: State = {
  // The bundle is an ES module, so import.meta is its own script URL.
  apiUrl: defaultApiUrl(import.meta.url),
  locale: '',
  strings: null,
  theme: Object.freeze({}),
  externalUserId: null,
  tags: null,
  hooks: null,
  fallback: 'none',
  frequency: null,
  analytics: true,
};

const listeners = new Set<ConfigListener>();

// The page's language, read each time: a page may set it after the SDK loads.
function documentLocale(): string {
  return (typeof document !== 'undefined' && document.documentElement?.lang) || '';
}

/**
 * Sets the SDK's options (`Taleart.init`). Each option is checked; an invalid one is ignored with
 * one console warning and keeps its value. The options that change reach every connected element,
 * which reads the configuration again. A `null` clears an option; `externalUserId` that no user
 * list can hold is cleared, with a warning, so a page never keeps the previous viewer.
 */
export function init(config: TaleartConfig): void {
  if (!isRecord(config)) {
    console.warn('TaleArt: init needs an object of options; nothing changes');
    return;
  }
  const next: State = { ...state };
  const changed = new Set<ConfigKey>();
  for (const key of Object.keys(config) as ConfigKey[]) {
    const value: unknown = config[key];
    if (value === undefined) continue;
    if (!KEYS.includes(key)) {
      console.warn(`TaleArt: init does not know the option "${key}"; it is ignored`);
      continue;
    }
    switch (key) {
      case 'apiUrl':
        if (typeof value !== 'string') {
          warnInvalid(key, 'a string');
          continue;
        }
        next.apiUrl = value.replace(/\/+$/, '');
        break;
      case 'locale':
        if (value === null) {
          next.locale = '';
          break;
        }
        if (typeof value !== 'string') {
          warnInvalid(key, 'a locale string');
          continue;
        }
        next.locale = value.trim();
        break;
      case 'strings': {
        const strings = readStrings(value, 'the strings');
        if (strings === undefined) continue;
        next.strings = strings;
        break;
      }
      case 'theme':
        next.theme = readThemeOverride(value, 'the SDK theme');
        break;
      case 'externalUserId':
        if (value === null) next.externalUserId = null;
        else if (typeof value === 'string' && encodeExternalUserIdHeader(value) !== null) next.externalUserId = value.trim();
        else {
          console.warn(
            'TaleArt: externalUserId needs an ID of 1 to 256 characters without control characters, or null; no ID is sent',
          );
          next.externalUserId = null;
        }
        break;
      case 'tags':
        if (value === null) next.tags = null;
        else if (Array.isArray(value)) next.tags = [...(value as unknown[])].filter((t): t is string => typeof t === 'string');
        else {
          warnInvalid(key, 'an array of tag names, or null');
          continue;
        }
        break;
      case 'hooks':
        if (value === null) next.hooks = null;
        else if (isRecord(value)) next.hooks = { ...(value as TaleartHooks) };
        else {
          warnInvalid(key, 'an object, or null');
          continue;
        }
        break;
      case 'fallback': {
        const fallback = checkFallback(value, 'init({ fallback })');
        if (fallback === undefined) continue;
        next.fallback = fallback ?? 'none';
        break;
      }
      case 'frequency': {
        const frequency = checkFrequency(value, 'init({ frequency })');
        if (frequency === undefined) continue;
        next.frequency = frequency;
        break;
      }
      case 'analytics':
        if (value === null) next.analytics = true;
        else if (typeof value === 'boolean') next.analytics = value;
        else {
          warnInvalid(key, 'true or false, or null');
          continue;
        }
        break;
    }
    if (!sameValue(key, state[key as keyof State], next[key as keyof State])) changed.add(key);
  }
  if (!changed.size) return;
  state = next;
  for (const listener of listeners) listener(changed);
}

/** Parses a fallback mode: `none`, `message`, or null for none. `undefined` for anything else. Pure: it never logs. */
export function parseFallback(value: unknown): FallbackMode | null | undefined {
  if (value === null || value === '') return null;
  return value === 'none' || value === 'message' ? value : undefined;
}

/**
 * Checks a fallback mode: `none`, `message` or null (none). Anything else is `undefined` (ignored by the
 * caller), with one console warning naming `source`.
 */
export function checkFallback(value: unknown, source: string): FallbackMode | null | undefined {
  const fallback = parseFallback(value);
  if (fallback === undefined) console.warn(`TaleArt: ${source} must be "none" or "message"; it is ignored`);
  return fallback;
}

/**
 * Checks a frequency cap: `once`, `daily`, `weekly`, a positive integer, or null (none). Anything else
 * is `undefined` (ignored by the caller), with one console warning naming `source`.
 */
export function checkFrequency(value: unknown, source: string): FrequencyRule | null | undefined {
  const frequency = parseFrequency(value);
  if (frequency === undefined) console.warn(`TaleArt: ${source} must be once, daily, weekly or a positive integer; it is ignored`);
  return frequency;
}

// Only option names and value kinds in the warning: a value (a viewer's ID, a tag) is never logged.
function warnInvalid(key: ConfigKey, expected: string): void {
  console.warn(`TaleArt: init needs ${key} as ${expected}; it is ignored`);
}

// Whether an option's value is the same as before. Hooks compare by reference: their functions are not data.
function sameValue(key: ConfigKey, before: unknown, after: unknown): boolean {
  if (key === 'hooks') return before === after;
  return JSON.stringify(before) === JSON.stringify(after);
}

/** The configuration the SDK uses now, every option with its effective value. */
export function getConfig(): ResolvedTaleartConfig {
  return {
    apiUrl: state.apiUrl,
    locale: state.locale || documentLocale() || 'en',
    strings: state.strings,
    theme: state.theme,
    externalUserId: state.externalUserId,
    tags: state.tags,
    hooks: state.hooks,
    fallback: state.fallback,
    frequency: state.frequency,
    analytics: state.analytics,
  };
}

/** Calls `listener` after each change of the configuration; returns the function that stops it. */
export function onConfigChange(listener: ConfigListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
