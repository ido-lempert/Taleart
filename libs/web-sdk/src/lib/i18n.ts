/**
 * Text the SDK shows or announces. Every user-visible string lives in {@link DEFAULT_STRINGS}
 * (English); a page overrides any of them per locale with `Taleart.init({ locale, strings })` or,
 * for one element, with its `locale` attribute and `strings` property. `{name}` marks a value
 * the SDK fills in.
 */
export const DEFAULT_STRINGS = {
  // Keys are added by the code that uses them, grouped by area (viewer.*, banner.*, bar.*, ...).
  'viewer.close': 'Close',
} as const satisfies Record<string, string>;

export type StringKey = keyof typeof DEFAULT_STRINGS;
/** Overrides for some strings of one locale. */
export type StringOverrides = Partial<Record<StringKey, string>>;
/** Overrides by locale (`{ he: { 'viewer.close': 'סגור' } }`), or one flat set for every locale. */
export type StringsConfig = Record<string, StringOverrides> | StringOverrides;
/** Looks a string up and fills its `{name}` values. */
export type Translate = (key: StringKey, values?: Record<string, string | number>) => string;

/**
 * Builds the translate function for a locale (BCP 47, `he-IL`; empty means the page's `lang`
 * then English). Lookup order: strings for the full locale, then its language, then flat
 * overrides, then English. A key nobody defines falls back to English, never to the key.
 */
export function createTranslate(locale: string, strings: StringsConfig | undefined): Translate {
  const language = locale.split('-')[0];
  const byLocale = (strings ?? {}) as Record<string, unknown>;
  const pick = (key: StringKey): string | undefined => {
    for (const set of [byLocale[locale], byLocale[language], byLocale]) {
      const value = (set as Record<string, unknown> | undefined)?.[key];
      if (typeof value === 'string') return value;
    }
    return undefined;
  };
  return (key, values) =>
    (pick(key) ?? DEFAULT_STRINGS[key]).replace(/\{(\w+)\}/g, (m, name: string) =>
      values && name in values ? String(values[name]) : m,
    );
}
