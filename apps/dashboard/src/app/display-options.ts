/**
 * The display options of the end-user redesign (P4 bar layouts, P5 banner variants): each option's
 * words and the settings it does not use, so the drawer can say so and disable them. The values and
 * defaults are the contract's frame schemas (`libs/contract/frame-types`); a change there changes here.
 */

/** One option of a display's layout or variant setting. */
export interface DisplayOption {
  /** The value stored in the setting. */
  value: string;
  /** The name people read for it. */
  label: string;
  /** What it looks like, in plain words. */
  summary: string;
  /** The other settings of the display that this option does not use. */
  ignores: readonly string[];
}

/** The option setting of a display type: its key, its name and its options. */
export interface DisplayOptionSetting {
  key: 'layout' | 'variant';
  /** The setting's name, such as "Layout". */
  label: string;
  /** The default value, which is the current look. */
  defaultValue: string;
  options: readonly DisplayOption[];
  /** The noun of the option in messages: "layout" or "variant". */
  noun: string;
}

const BANNER_IGNORES_FOR_STRIPS = ['aspectRatio', 'showDots', 'loop'] as const;
// A strip scrolls on its own at a fixed speed, so autoplay and its interval do not apply either.
const BANNER_IGNORES_FOR_MARQUEE = [...BANNER_IGNORES_FOR_STRIPS, 'autoplay', 'intervalSeconds'] as const;

/** The bar's layouts, in schema order. */
export const BAR_LAYOUTS: DisplayOptionSetting = {
  key: 'layout',
  label: 'Layout',
  defaultValue: 'ring',
  noun: 'layout',
  options: [
    {
      value: 'ring',
      label: 'Ring',
      summary: 'Round covers in a ring that spins until seen. The default look.',
      ignores: [],
    },
    {
      value: 'chip',
      label: 'Chip',
      summary: 'A round cover beside its title, in a pill. Covers are always round.',
      ignores: ['shape'],
    },
    {
      value: 'poster',
      label: 'Poster',
      summary: 'A tall card with the title over the cover. Cards have one size.',
      ignores: ['shape', 'size'],
    },
    {
      value: 'stack',
      label: 'Stack',
      summary: 'The items overlap in one collapsed row. Titles and spacing are not shown.',
      ignores: ['shape', 'showTitles', 'alignment', 'gap'],
    },
  ],
};

/** The banner's variants, in schema order. */
export const BANNER_VARIANTS: DisplayOptionSetting = {
  key: 'variant',
  label: 'Variant',
  defaultValue: 'carousel',
  noun: 'variant',
  options: [
    {
      value: 'carousel',
      label: 'Carousel',
      summary: 'One slide at a time. The default look.',
      ignores: [],
    },
    {
      value: 'coverflow',
      label: 'Cover flow',
      summary: 'The current slide in front, its neighbours turned away at the sides.',
      ignores: [],
    },
    {
      value: 'peek',
      label: 'Peek',
      summary: 'The neighbouring slides show at the edges.',
      ignores: [],
    },
    {
      value: 'deck',
      label: 'Deck',
      summary: 'The slides fanned out like cards.',
      ignores: [],
    },
    {
      value: 'sticky',
      label: 'Sticky',
      summary: 'Stays on screen while the page scrolls. It does not loop or show dots.',
      ignores: BANNER_IGNORES_FOR_STRIPS,
    },
    {
      value: 'strip',
      label: 'Strip',
      summary: 'A continuous marquee of the slides. It does not loop, autoplay or show dots.',
      ignores: BANNER_IGNORES_FOR_MARQUEE,
    },
  ],
};

/** The option setting a display type has, or null for a type without one. */
export function displayOptionSetting(type: string): DisplayOptionSetting | null {
  if (type === 'bar') return BAR_LAYOUTS;
  if (type === 'banner') return BANNER_VARIANTS;
  return null;
}

/** The option the settings choose, or the setting's default when they leave it out or hold another value. */
export function selectedOption(
  setting: DisplayOptionSetting,
  settings: Readonly<Record<string, unknown>>,
): DisplayOption {
  const value = settings[setting.key];
  return (
    setting.options.find((option) => option.value === value) ??
    setting.options.find((option) => option.value === setting.defaultValue) ??
    setting.options[0]
  );
}

/**
 * The settings the chosen option does not use, each with the reason to show: a map from the setting's
 * key to "Not used by the Chip layout." Empty for a type without options.
 */
export function ignoredSettings(type: string, settings: Readonly<Record<string, unknown>>): Map<string, string> {
  const setting = displayOptionSetting(type);
  const ignored = new Map<string, string>();
  if (!setting) return ignored;
  const option = selectedOption(setting, settings);
  for (const key of option.ignores) {
    ignored.set(key, `Not used by the ${option.label} ${setting.noun}.`);
  }
  return ignored;
}
