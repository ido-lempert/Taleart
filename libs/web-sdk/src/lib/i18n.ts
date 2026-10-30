/**
 * Text the SDK shows or announces. Every user-visible string lives in {@link DEFAULT_STRINGS}
 * (English); a page overrides any of them per locale with `Taleart.init({ locale, strings })` or,
 * for one element, with its `locale` attribute and `strings` property. `{name}` marks a value
 * the SDK fills in.
 */
export const DEFAULT_STRINGS = {
  'viewer.close': 'Close',
  'viewer.play': 'Play',
  'viewer.pause': 'Pause',
  'viewer.previousTale': 'Previous tale',
  'viewer.nextTale': 'Next tale',
  'viewer.previousGroup': 'Previous',
  'viewer.nextGroup': 'Next',
  'viewer.previousGroupName': 'Previous group: {name}',
  'viewer.nextGroupName': 'Next group: {name}',
  'viewer.progress': '{group}, tale {tale} of {count}',
  'viewer.taleFallback': 'Tale {number}',

  'banner.label': 'Banner',
  'banner.carousel': 'carousel',
  'banner.slide': 'slide',
  'banner.slideOf': '{index} of {count}',
  'banner.previousSlide': 'Previous slide',
  'banner.nextSlide': 'Next slide',
  'banner.showGroup': 'Show {name}',
  'banner.stopRotation': 'Stop automatic slide show',
  'banner.startRotation': 'Start automatic slide show',
  'banner.dismiss': 'Dismiss banner',
  'banner.watch': 'Watch',

  'bar.seen': '{name}, seen',
  // A poster's count of tales, and a collapsed stack's count of unseen groups (`{count}` is the number).
  'bar.story': '{count} story',
  'bar.stories': '{count} stories',
  'bar.newStory': '{count} new story',
  'bar.newStories': '{count} new stories',
  'bar.noNewStories': 'No new stories',

  'load.failed': 'Stories could not be loaded.',
  'load.retry': 'Try again',

  'links.newTab': ' (opens in a new tab)',

  'poll.voted': 'You voted {label}.',
  'poll.chose': 'You chose {label}.',
  'poll.previewNotRecorded': 'Votes are not recorded in the preview.',
  'poll.failed': 'Your vote could not be sent. Try again.',

  'quiz.answered': 'You answered {label}.',
  'quiz.right': 'Right! You answered {label}.',
  'quiz.wrongAnswer': 'Wrong: you answered {label}. The correct answer is {correct}.',
  'quiz.correct': ' correct answer',
  'quiz.wrong': ' wrong',
  'quiz.previewNotRecorded': 'Answers are not recorded in the preview.',
  'quiz.failed': 'Your answer could not be sent. Try again.',

  'rating.sliderLabel': 'Your rating',
  'rating.valueText': '{value} out of {max}',
  'rating.ratedValueText': 'You rated {value} out of {max}',
  'rating.sent': 'You rated {value}.',
  'rating.previewRated': 'You rated {value}. Ratings are not recorded in the preview.',
  'rating.failed': 'Your rating could not be sent. Try again.',
  'rating.summary': 'Average {average} from {total} {count}',
  'rating.singular': 'rating',
  'rating.plural': 'ratings',

  'countdown.ended': 'Ended',
  'countdown.days': 'Days',
  'countdown.hours': 'Hours',
  'countdown.minutes': 'Min',
  'countdown.seconds': 'Sec',

  'reaction.count': 'Reactions: {count}',
  'reaction.failed': 'Your reaction could not be sent. Try again.',

  'promo.copy': 'Copy',
  'promo.copied': 'Copied',
  'promo.copyFailed': 'Could not copy. Select the code and copy it yourself.',

  'preview.stop': 'Stop preview',
  'preview.size.small': 'Small',
  'preview.size.default': 'Default',
  'preview.size.large': 'Large',
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

/** The English translate function: what the SDK uses when a render gets no `t`. */
export const defaultTranslate: Translate = createTranslate('en', undefined);
