// Tale Studio's element types (epic Tale Studio R8; AD-15): one descriptor per key of the contract's
// element-type registry, which says how the Add menu offers the type and which inspector edits it.
// The registry is the one list: a registered type without a descriptor stops the studio, and a
// descriptor without a registered type is never shown. Lazy: only the studio imports this file.
import { InjectionToken } from '@angular/core';
import {
  ELEMENT_TYPE_LIMITS,
  hasDisallowedCharacter,
  isEmojiGlyph,
  LABEL_TEXT_RULE,
  limitedVideoCount,
  MAX_SWIPE_UP_ELEMENTS,
  MAX_VIDEO_ELEMENTS,
  propSchema,
  SHAPE_KINDS,
  SHAPE_NAMES,
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_TEST_ELEMENT_TYPES,
  type ElementTypeEntry,
  type ShapeKind,
  type TaleElementA11y,
  type TaleElementBox,
} from '@taleart/contract/tale-document';
import type { IconName } from '../icon';

/** What a palette tile does: the studio's own flow for a built-in type, or `configured` for a new type. */
export type AddAction =
  | { kind: 'text' }
  | { kind: 'media'; media: 'image' | 'video' }
  | { kind: 'sticker' }
  | { kind: 'image-button' }
  | { kind: 'shape'; shape: ShapeKind }
  | { kind: 'emoji' }
  | { kind: 'button' }
  | { kind: 'swipe-up' }
  | { kind: 'configured' };

/** A limit on how many elements of a type a tale holds: its tile is blocked and says so, by the hint's id. */
export interface AddLimit {
  hintId: string;
  hint: string;
  reached(doc: { elements: readonly { type: string; props?: unknown }[] } | null | undefined): boolean;
}

/**
 * The palette's categories, as the Elements tab orders them (epic Tale Studio 2 R2): `actions` is
 * "Buttons & links". A type without a palette entry shows under More, after them.
 */
export type PaletteCategory = 'text' | 'media' | 'shapes' | 'stickers' | 'actions' | 'interactive';

/** One of several tiles a type offers (a text style, a shape kind), each its own way to add the type. */
export interface PalettePreset {
  /** Its tile's id is `studio-add-<id>`. */
  id: string;
  /** The tile's word, such as "Heading"; its accessible name is "Add heading". */
  label: string;
  /** Words it is also found by, beside the type's. */
  keywords?: readonly string[];
  icon?: IconName;
  /** Its own way to add, in place of the type's (a shape kind). */
  action?: AddAction;
  /** Props laid over the type's new props, such as a text preset's size and weight. */
  props?: Readonly<Record<string, unknown>>;
  /** Where it lands, in place of the type's own new box. */
  box?: TaleElementBox;
  /** How its tile draws it, where that differs from `props` (a text preset's sample). */
  tileProps?: Readonly<Record<string, unknown>>;
}

/**
 * How the Elements tab offers a type (epic Tale Studio 2 R2, EXPERIENCE Registry fit): its category
 * and place in it, the words it is found by, and one tile, or one per preset. A blocked tile stays
 * focusable and says why: the type's limit, or the project's media it needs.
 */
export interface PaletteEntry {
  category: PaletteCategory;
  /** Its place in the category, lowest first. */
  order: number;
  /** Words it is found by, beside its label and its category's name. */
  keywords: readonly string[];
  icon: IconName;
  action: AddAction;
  /** Picks the project's media, so it needs the tale's project. */
  needsProject?: boolean;
  limit?: AddLimit;
  /** Several tiles in place of one, in order. */
  presets?: readonly PalettePreset[];
}

/** One field of a descriptor-driven inspector; its rules come from the type's props schema. */
export interface InspectorField {
  /** The prop it edits. */
  prop: string;
  label: string;
  /**
   * `text` and `number` inputs, a `color` picker with its hex field, a `select` of the schema's enum,
   * or an `emoji` shown with a button that opens the studio's emoji picker (epic interactive
   * components story 4.2).
   */
  control: 'text' | 'number' | 'color' | 'select' | 'emoji';
  /** For a select: the name people read for each enum value. */
  options?: readonly { value: string; label: string }[];
  hint?: string;
}

/**
 * A list of choices, each `{ id, label }` (epic interactive components R1): the inspector edits each
 * label as a text field; ids stay as made, so a choice's count survives an edit to its text. When
 * its array prop allows fewer items than it holds at most (a quiz's two to four answers, story 4.3),
 * it is a list field: choices are added, removed and moved up or down, each by id. It may also pick
 * one choice as the correct one.
 */
export interface ChoicesField {
  /** The array prop. */
  prop: string;
  /** The group's name, such as "Options". */
  label: string;
  /** The name of the choice at `index` (from 0), such as "Option 1". */
  itemLabel(index: number): string;
  /** For a list field: the label a choice added at `index` starts with, unlike the labels `taken`. */
  newLabel?(index: number, taken: readonly string[]): string;
  /** The Add button's text, such as "Add answer". */
  addLabel?: string;
  hint?: string;
  /**
   * An optional string prop holding the id of the correct choice (a quiz's `correctAnswerId`):
   * picked from the choices, or none. Removing that choice clears it.
   */
  correct?: { prop: string; label: string; none: string; hint?: string };
}

/**
 * One edit to a list of choices, applied by the studio to the element's props as they are when it
 * lands, never to a copy the inspector held (epic interactive components R1): a choice's new label
 * by its index; a choice added at the end, up to `max`; a choice removed by id, down to `min`,
 * clearing `clears` when that prop held its id; a choice moved one place up or down by id.
 */
export type ChoiceEdit =
  | { prop: string; index: number; label: string }
  | { prop: string; add: { id: string; label: string }; max: number }
  | { prop: string; remove: string; min: number; clears?: string }
  | { prop: string; move: string; by: -1 | 1 };

/** The props with `edit` applied, or null when it changes nothing (an id gone, a limit reached, an end). */
export function applyChoiceEdit(
  props: Readonly<Record<string, unknown>>,
  edit: ChoiceEdit,
): Record<string, unknown> | null {
  const items = props[edit.prop];
  if (!Array.isArray(items)) return null;
  const list = items as readonly Record<string, unknown>[];
  const at = (id: string) => list.findIndex((item) => item?.['id'] === id);
  if ('label' in edit) {
    if (edit.index < 0 || edit.index >= list.length) return null;
    return { ...props, [edit.prop]: list.map((item, i) => (i === edit.index ? { ...item, label: edit.label } : item)) };
  }
  if ('add' in edit) {
    if (list.length >= edit.max || at(edit.add.id) !== -1) return null;
    return { ...props, [edit.prop]: [...list, { ...edit.add }] };
  }
  if ('remove' in edit) {
    const index = at(edit.remove);
    if (index === -1 || list.length <= edit.min) return null;
    const next: Record<string, unknown> = { ...props, [edit.prop]: list.filter((_, i) => i !== index) };
    if (edit.clears && next[edit.clears] === edit.remove) delete next[edit.clears];
    return next;
  }
  const index = at(edit.move);
  const to = index + edit.by;
  if (index === -1 || to < 0 || to >= list.length) return null;
  const moved = [...list];
  [moved[index], moved[to]] = [moved[to], moved[index]];
  return { ...props, [edit.prop]: moved };
}

/** A new type's inspector: its fields, in order, checked against its props schema as people edit. */
export interface FieldsInspector {
  fields: readonly InspectorField[];
  /** Its choices, after the fields. */
  choices?: ChoicesField;
}

/** The inspector of each built-in type, or a new type's fields. */
export type InspectorDescriptor = 'text' | 'media' | 'shape' | 'emoji' | 'link' | FieldsInspector;

/** How the studio adds a new (`configured`) type: its box, its props and what is said. */
export interface CreateDescriptor {
  box: TaleElementBox;
  props(): Record<string, unknown>;
  a11y?: TaleElementA11y;
}

/** What a studio descriptor holds for one registry key. */
export interface StudioTypeDescriptor {
  /**
   * How the Elements tab offers it. A type without one (a descriptor in the shape before story
   * 11.3, a test type) shows under More, added by its `create` (epic Tale Studio 2 R2).
   */
  palette?: PaletteEntry;
  inspector: InspectorDescriptor;
  /** For a `configured` type, or one without a palette entry: how a new one is made. */
  create?: CreateDescriptor;
  /** For a `configured` type: the text the canvas shows in its box, as a stand-in for the SDK's look. */
  preview?(props: Record<string, unknown>): string;
  /**
   * For a `configured` type: a rule its schema cannot state, as the server's `PROPS_RULES` adds one,
   * run on the props an edit would give; the reason it refuses them, or null.
   */
  check?(props: Readonly<Record<string, unknown>>): string | null;
}

/** A registered element type as the studio offers it: the registry entry with its descriptor. */
export type StudioElementType = ElementTypeEntry & StudioTypeDescriptor;

// The poll's rules its schema cannot state, as the server's `PROPS_RULES` holds them: its text shows
// on one line, and its option ids differ (epic interactive components R2).
function checkPollProps(props: Readonly<Record<string, unknown>>): string | null {
  const options = Array.isArray(props['options']) ? (props['options'] as { id?: unknown; label?: unknown }[]) : [];
  const problem = lineTextProblem([props['question'], props['title'], ...options.map((o) => o?.label)]);
  if (problem) return problem;
  if (new Set(options.map((o) => o?.id)).size !== options.length) return 'Each option needs its own id.';
  return null;
}

// A component's texts show on one line, as plain text that is not blank; the first problem, or null.
function lineTextProblem(texts: readonly unknown[]): string | null {
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    if (text.trim() === '') return 'Enter some text.';
    if (hasDisallowedCharacter(text, LABEL_TEXT_RULE) || text.includes('\n')) return 'Use one line of plain text.';
  }
  return null;
}

// A quiz's rules its schema cannot state, as the server's `PROPS_RULES` holds them: its text shows on
// one line, its answer ids differ, and its correct answer, when set, is one of them (epic
// interactive components R3).
function checkQuizProps(props: Readonly<Record<string, unknown>>): string | null {
  const answers = Array.isArray(props['answers']) ? (props['answers'] as { id?: unknown; label?: unknown }[]) : [];
  const problem = lineTextProblem([props['question'], props['title'], ...answers.map((a) => a?.label)]);
  if (problem) return problem;
  if (new Set(answers.map((a) => a?.id)).size !== answers.length) return 'Each answer needs its own id.';
  const correct = props['correctAnswerId'];
  if (correct !== undefined && !answers.some((a) => a?.id === correct)) return 'Pick one of the answers, or none.';
  return null;
}

// A Rating's rules its schema cannot state, as the server's `PROPS_RULES` holds them: its text shows
// on one line, and its emoji is one RGI emoji (epic interactive components R5, R15).
function checkRatingProps(props: Readonly<Record<string, unknown>>): string | null {
  return (
    lineTextProblem([props['question'], props['title']]) ?? (isEmojiGlyph(props['emoji']) ? null : 'Choose one emoji.')
  );
}

// A limit of one element of `type` per tale (epic interactive components C3), said by its tile.
function oneOf(type: string, hintId: string, hint: string): AddLimit {
  return {
    hintId,
    hint,
    reached: (doc) => (doc?.elements.filter((e) => e.type === type).length ?? 0) >= ELEMENT_TYPE_LIMITS[type],
  };
}

const THEME_FIELD: InspectorField = {
  prop: 'theme',
  label: 'Theme',
  control: 'select',
  options: [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ],
};

// Each shape kind's own picture and words on its tile (Tale Studio 2, stories 11.1 and 11.3).
const SHAPE_ICONS: Readonly<Record<ShapeKind, IconName>> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  line: 'line',
};
const SHAPE_KEYWORDS: Readonly<Record<ShapeKind, readonly string[]>> = {
  rectangle: ['box', 'square', 'rect', 'block', 'background'],
  ellipse: ['circle', 'oval', 'round', 'dot'],
  line: ['divider', 'rule', 'stroke', 'separator'],
};

/**
 * The text presets (EXPERIENCE Left panel tabs): Heading, Subheading, Body, Caption and Label, each
 * a text in its own size and weight, drawn so on its tile. Body is the text the studio added before
 * presets, in today's box and style (DEFAULT_TEXT_STYLE). Each box is inside the safe area.
 */
export const TEXT_PRESETS: readonly PalettePreset[] = [
  {
    id: 'heading',
    label: 'Heading',
    keywords: ['title', 'headline', 'h1', 'big'],
    props: { text: 'Heading', size: 0.06, weight: 'bold', lineHeight: 1.1 },
    box: { x: 0.1, y: 0.2, w: 0.8, h: 0.14, rotation: 0 },
  },
  {
    id: 'subheading',
    label: 'Subheading',
    keywords: ['subhead', 'subtitle', 'h2'],
    props: { text: 'Subheading', size: 0.045, weight: 'medium', lineHeight: 1.2 },
    box: { x: 0.1, y: 0.34, w: 0.8, h: 0.1, rotation: 0 },
  },
  {
    id: 'text',
    label: 'Body text',
    keywords: ['body', 'paragraph', 'copy'],
    props: { text: 'Text' },
    // Its tile draws it lighter than it adds it, so the tiles read as a ladder below the headings.
    tileProps: { weight: 'regular' },
  },
  {
    id: 'caption',
    label: 'Caption',
    keywords: ['small', 'note', 'footnote', 'credit'],
    props: { text: 'Caption', size: 0.025, weight: 'regular', italic: true },
    box: { x: 0.1, y: 0.66, w: 0.8, h: 0.06, rotation: 0 },
  },
  {
    id: 'label',
    label: 'Label',
    keywords: ['tag', 'badge', 'pill', 'chip'],
    props: { text: 'Label', size: 0.025, weight: 'bold', background: 'box', backgroundColor: '#111827' },
    box: { x: 0.3, y: 0.14, w: 0.4, h: 0.06, rotation: 0 },
  },
];

/** The descriptors of the registry's types, keyed by registry key (R8). */
export const STUDIO_TYPE_DESCRIPTORS: Readonly<Record<string, StudioTypeDescriptor>> = {
  text: {
    palette: {
      category: 'text',
      order: 0,
      keywords: ['text', 'type', 'words', 'font', 'write'],
      icon: 'text',
      action: { kind: 'text' },
      presets: TEXT_PRESETS,
    },
    inspector: 'text',
  },
  image: {
    palette: {
      category: 'media',
      order: 0,
      keywords: ['photo', 'picture', 'gif', 'jpeg', 'png', 'upload'],
      icon: 'image',
      action: { kind: 'media', media: 'image' },
      needsProject: true,
    },
    inspector: 'media',
  },
  video: {
    palette: {
      category: 'media',
      order: 1,
      keywords: ['movie', 'clip', 'mp4', 'film', 'upload'],
      icon: 'video',
      action: { kind: 'media', media: 'video' },
      needsProject: true,
      limit: {
        hintId: 'studio-video-hint',
        hint: 'A tale holds one video, and plays for its length. Delete it to add another.',
        reached: (doc) => limitedVideoCount(doc as { elements: readonly { type: string }[] }) >= MAX_VIDEO_ELEMENTS,
      },
    },
    inspector: 'media',
  },
  shape: {
    palette: {
      category: 'shapes',
      order: 0,
      keywords: ['shape', 'geometry', 'fill'],
      icon: 'shape',
      action: { kind: 'shape', shape: 'rectangle' },
      presets: SHAPE_KINDS.map((shape) => ({
        id: shape,
        label: SHAPE_NAMES[shape],
        keywords: SHAPE_KEYWORDS[shape],
        icon: SHAPE_ICONS[shape],
        action: { kind: 'shape', shape } as const,
      })),
    },
    inspector: 'shape',
  },
  emoji: {
    palette: {
      category: 'stickers',
      order: 0,
      keywords: ['smiley', 'face', 'reaction', 'icon', 'heart'],
      icon: 'emoji',
      action: { kind: 'emoji' },
    },
    inspector: 'emoji',
  },
  sticker: {
    palette: {
      category: 'stickers',
      order: 1,
      keywords: ['cutout', 'png', 'webp', 'gif', 'decal', 'upload'],
      icon: 'sticker',
      action: { kind: 'sticker' },
      needsProject: true,
    },
    inspector: 'media',
  },
  button: {
    palette: {
      category: 'actions',
      order: 0,
      keywords: ['cta', 'call to action', 'link', 'url', 'shop', 'buy', 'tap'],
      icon: 'button',
      action: { kind: 'button' },
    },
    inspector: 'link',
  },
  'image-button': {
    palette: {
      category: 'actions',
      order: 1,
      keywords: ['cta', 'call to action', 'link', 'url', 'banner', 'picture'],
      icon: 'image-button',
      action: { kind: 'image-button' },
      needsProject: true,
    },
    inspector: 'link',
  },
  poll: {
    palette: {
      category: 'interactive',
      order: 0,
      keywords: ['vote', 'votes', 'voting', 'survey', 'question', 'choice', 'options', 'opinion', 'ask'],
      icon: 'poll',
      action: { kind: 'configured' },
      limit: oneOf('poll', 'studio-poll-hint', 'A tale holds one poll. Delete it to add another.'),
    },
    inspector: {
      fields: [
        { prop: 'question', label: 'Question', control: 'text', hint: 'One line, up to 200 characters.' },
        { prop: 'title', label: 'Title', control: 'text', hint: 'Optional, up to 80 characters.' },
        THEME_FIELD,
      ],
      choices: {
        prop: 'options',
        label: 'Options',
        itemLabel: (index) => `Option ${index + 1}`,
        hint: 'Up to 60 characters each. Votes stay with an option when its text changes.',
      },
    },
    create: {
      box: { x: 0.1, y: 0.36, w: 0.8, h: 0.28, rotation: 0 },
      props: () => ({
        question: 'Ask a question',
        theme: 'light',
        options: [
          { id: crypto.randomUUID(), label: 'Yes' },
          { id: crypto.randomUUID(), label: 'No' },
        ],
      }),
    },
    // The canvas shows its question; the preview pane draws it as visitors see it (AD-16).
    preview: (props) => (typeof props['question'] === 'string' ? props['question'] : ''),
    check: checkPollProps,
  },
  rating: {
    palette: {
      category: 'interactive',
      order: 1,
      keywords: ['emoji slider', 'slider', 'score', 'feedback', 'stars', 'like'],
      icon: 'rating',
      action: { kind: 'configured' },
      limit: oneOf('rating', 'studio-rating-hint', 'A tale holds one rating. Delete it to add another.'),
    },
    inspector: {
      fields: [
        { prop: 'question', label: 'Question', control: 'text', hint: 'One line, up to 200 characters.' },
        { prop: 'title', label: 'Title', control: 'text', hint: 'Optional, up to 80 characters.' },
        {
          prop: 'emoji',
          label: 'Emoji',
          control: 'emoji',
          hint: 'Visitors slide it from 0 to 100 to rate.',
        },
        THEME_FIELD,
      ],
    },
    create: {
      box: { x: 0.1, y: 0.62, w: 0.8, h: 0.22, rotation: 0 },
      props: () => ({ question: 'How much do you like it?', emoji: '❤️', theme: 'light' }),
    },
    // The canvas shows its emoji and question; the preview pane draws the slider as visitors see it (AD-16).
    preview: (props) =>
      [props['emoji'], props['question']].filter((part): part is string => typeof part === 'string').join(' '),
    check: checkRatingProps,
  },
  quiz: {
    palette: {
      category: 'interactive',
      order: 2,
      keywords: ['trivia', 'question', 'answer', 'correct', 'game'],
      icon: 'quiz',
      action: { kind: 'configured' },
      limit: oneOf('quiz', 'studio-quiz-hint', 'A tale holds one quiz. Delete it to add another.'),
    },
    inspector: {
      fields: [
        { prop: 'question', label: 'Question', control: 'text', hint: 'One line, up to 200 characters.' },
        { prop: 'title', label: 'Title', control: 'text', hint: 'Optional, up to 80 characters.' },
        THEME_FIELD,
      ],
      choices: {
        prop: 'answers',
        label: 'Answers',
        itemLabel: (index) => `Answer ${index + 1}`,
        newLabel: (index, taken) => {
          // "Answer N" from its place, or the next N no other answer is labelled with.
          let n = index + 1;
          while (taken.includes(`Answer ${n}`)) n += 1;
          return `Answer ${n}`;
        },
        addLabel: 'Add answer',
        hint: 'Two to four, up to 60 characters each. Answers keep their count when their text changes or they move.',
        correct: {
          prop: 'correctAnswerId',
          label: 'Correct answer',
          none: 'None: show only the percentages',
          hint: 'Visitors see if they were right once they answer. The correct answer is public, so a quiz is not a secure test.',
        },
      },
    },
    create: {
      box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
      props: () => ({
        question: 'Ask a question',
        theme: 'light',
        answers: [
          { id: crypto.randomUUID(), label: 'Answer 1' },
          { id: crypto.randomUUID(), label: 'Answer 2' },
        ],
      }),
    },
    // The canvas shows its question; the preview pane draws it as visitors see it (AD-16).
    preview: (props) => (typeof props['question'] === 'string' ? props['question'] : ''),
    check: checkQuizProps,
  },
  'swipe-up': {
    palette: {
      category: 'actions',
      order: 2,
      keywords: ['link', 'cta', 'call to action', 'url', 'swipe', 'more'],
      icon: 'swipe-up',
      action: { kind: 'swipe-up' },
      limit: {
        hintId: 'studio-swipe-up-hint',
        hint: 'A tale holds one swipe-up link. Delete it to add another.',
        reached: (doc) => (doc?.elements.filter((e) => e.type === 'swipe-up').length ?? 0) >= MAX_SWIPE_UP_ELEMENTS,
      },
    },
    inspector: 'link',
  },
};

/**
 * The descriptors of the registry's test-only types (R8), made on demand. Only development builds
 * that opt in, and tests, reach them: production builds drop them with `ngDevMode`. The test badge
 * has no palette entry on purpose: it shows under More (epic Tale Studio 2 R2).
 */
export function studioTestTypeDescriptors(): Readonly<Record<string, StudioTypeDescriptor>> {
  return {
    'test-badge': {
      inspector: {
        fields: [
          { prop: 'label', label: 'Label', control: 'text', hint: 'One line, up to 40 characters.' },
          { prop: 'color', label: 'Colour', control: 'color' },
          {
            prop: 'tone',
            label: 'Style',
            control: 'select',
            options: [
              { value: 'solid', label: 'Solid' },
              { value: 'outline', label: 'Outline' },
            ],
          },
          { prop: 'count', label: 'Count', control: 'number', hint: 'A whole number from 0 to 99; empty for none.' },
        ],
      },
      create: {
        box: { x: 0.3, y: 0.2, w: 0.4, h: 0.07, rotation: 0 },
        props: () => ({ label: 'Test badge', color: '#7C3AED', tone: 'solid' }),
      },
      preview: (props) =>
        `${typeof props['label'] === 'string' ? props['label'] : ''}${typeof props['count'] === 'number' ? ` ${props['count']}` : ''}`,
    },
  };
}

/** The JSON Schema keywords a props schema edited by the fields inspector may use at its top level. */
export const FIELDS_SCHEMA_KEYWORDS: readonly string[] = [
  '$schema',
  'title',
  'description',
  'type',
  'additionalProperties',
  'required',
  'properties',
];

/** The JSON Schema keywords each prop of such a schema may use: what `propValueProblem` checks. */
export const FIELDS_PROP_KEYWORDS: readonly string[] = [
  'title',
  'description',
  'type',
  'enum',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
];

/** The pattern a colour field's prop has: `#RRGGBB`, what the colour picker gives. */
export const HEX_COLOR_PATTERN = '^#[0-9a-fA-F]{6}$';

const PROP_TYPES: Readonly<Record<InspectorField['control'], readonly string[]>> = {
  text: ['string'],
  color: ['string'],
  select: ['string'],
  emoji: ['string'],
  number: ['integer', 'number'],
};

// Refuses a fields inspector its schema does not fit: a keyword the inspector does not check (the
// server would refuse values the studio let through), a field of a prop the schema lacks or of
// another type, a select option outside the enum, a colour field whose prop is not #RRGGBB.
function checkFieldsInspector(type: ElementTypeEntry, inspector: FieldsInspector): void {
  const fail = (why: string) => {
    throw new Error(`Element type "${type.key}": ${why}`);
  };
  for (const keyword of Object.keys(type.schema)) {
    if (!FIELDS_SCHEMA_KEYWORDS.includes(keyword)) fail(`its schema uses "${keyword}", which the fields inspector does not check`);
  }
  const properties = (type.schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  const choices = inspector.choices;
  const required = Array.isArray(type.schema['required']) ? (type.schema['required'] as unknown[]) : [];
  for (const [name, prop] of Object.entries(properties)) {
    if (name === choices?.prop) continue;
    for (const keyword of Object.keys(prop)) {
      if (!FIELDS_PROP_KEYWORDS.includes(keyword)) fail(`"${name}" uses "${keyword}", which the fields inspector does not check`);
    }
  }
  for (const field of inspector.fields) {
    const found = propSchema(type.schema, field.prop);
    if (!found) fail(`the inspector edits "${field.prop}", which its schema lacks`);
    const schema = (found as NonNullable<typeof found>).schema;
    if (!PROP_TYPES[field.control].includes(schema.type ?? '')) {
      fail(`"${field.prop}" is of type "${schema.type}", which a ${field.control} field does not edit`);
    }
    if (field.control === 'select') {
      const values = schema.enum ?? [];
      if (!field.options?.length || field.options.some((o) => !values.includes(o.value))) {
        fail(`the options of "${field.prop}" must be values of its enum`);
      }
    }
    if (field.control === 'color' && schema.pattern !== HEX_COLOR_PATTERN) {
      fail(`"${field.prop}" is a colour field, so its pattern must be ${HEX_COLOR_PATTERN}`);
    }
  }
  if (choices) checkChoicesField(properties, required, choices, fail);
}

/** The JSON Schema keywords a choices field's array prop may use. */
export const CHOICES_PROP_KEYWORDS: readonly string[] = ['title', 'description', 'type', 'minItems', 'maxItems', 'items'];

// A choices field edits closed `{ id, label }` items whose id and label use only what
// `propValueProblem` checks, and whose label is text: a fixed number of them, or a list of
// `minItems` to `maxItems` (at least one) that a descriptor offering new ones names. Its correct
// pick, if any, is an optional prop of the schema holding a string.
function checkChoicesField(
  properties: Record<string, Record<string, unknown>>,
  requiredProps: readonly unknown[],
  choices: ChoicesField,
  fail: (why: string) => void,
): void {
  const name = choices.prop;
  const prop = Object.prototype.hasOwnProperty.call(properties, name) ? properties[name] : undefined;
  if (!prop) return fail(`the inspector edits choices "${name}", which its schema lacks`);
  for (const keyword of Object.keys(prop)) {
    if (!CHOICES_PROP_KEYWORDS.includes(keyword)) fail(`"${name}" uses "${keyword}", which the choices field does not check`);
  }
  const min = prop['minItems'];
  const max = prop['maxItems'];
  if (prop['type'] !== 'array' || typeof min !== 'number' || typeof max !== 'number' || min < 1 || min > max) {
    fail(`"${name}" must be an array with a number of items at least and at most`);
  }
  if (min !== max && (!choices.newLabel || !choices.addLabel)) {
    fail(`"${name}" holds ${min} to ${max} items, so the inspector must say how a new one is labelled`);
  }
  if (choices.correct) {
    const correct = Object.prototype.hasOwnProperty.call(properties, choices.correct.prop) ? properties[choices.correct.prop] : undefined;
    if (!correct || correct['type'] !== 'string' || requiredProps.includes(choices.correct.prop)) {
      fail(`the correct choice "${choices.correct.prop}" must be an optional string prop of its schema`);
    }
  }
  const items = (prop['items'] ?? {}) as Record<string, unknown>;
  const itemProps = (items['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(items['required']) ? (items['required'] as unknown[]) : [];
  if (
    items['type'] !== 'object' ||
    items['additionalProperties'] !== false ||
    Object.keys(itemProps).sort().join() !== 'id,label' ||
    !required.includes('id') ||
    !required.includes('label')
  ) {
    fail(`the items of "${name}" must be closed objects with a required id and label`);
  }
  for (const [itemName, itemProp] of Object.entries(itemProps)) {
    if (itemProp['type'] !== 'string') fail(`"${name}" items' "${itemName}" must be a string`);
    for (const keyword of Object.keys(itemProp)) {
      if (!FIELDS_PROP_KEYWORDS.includes(keyword)) fail(`"${name}" items' "${itemName}" uses "${keyword}", which the fields inspector does not check`);
    }
  }
}

// The registry entry with its descriptor; throws when it has none, or a descriptor that does not fit it.
function described(type: ElementTypeEntry, from: Readonly<Record<string, StudioTypeDescriptor>>): StudioElementType {
  const descriptor = Object.prototype.hasOwnProperty.call(from, type.key) ? from[type.key] : undefined;
  if (!descriptor) throw new Error(`Element type "${type.key}" has no Tale Studio descriptor`);
  const palette = descriptor.palette;
  const configured = !palette || [palette.action, ...(palette.presets ?? []).map((p) => p.action)].some((a) => a?.kind === 'configured');
  if (configured && !descriptor.create) {
    throw new Error(
      palette
        ? `Element type "${type.key}" is added by configuration but says nothing of how`
        : `Element type "${type.key}" has no palette entry and says nothing of how it is added`,
    );
  }
  if (typeof descriptor.inspector === 'object') checkFieldsInspector(type, descriptor.inspector);
  return { ...type, ...descriptor };
}

/**
 * The studio's element types, in registry order: each registry entry with its descriptor; with
 * `testTypes`, in a development build only, the registry's test-only types too. Throws when a
 * registered type has no descriptor, so a type cannot be half added (R8). `registry` and
 * `descriptors` stand in for the contract's registry and {@link STUDIO_TYPE_DESCRIPTORS} in tests.
 */
export function studioElementTypes(
  options: {
    testTypes?: boolean;
    registry?: readonly ElementTypeEntry[];
    descriptors?: Readonly<Record<string, StudioTypeDescriptor>>;
  } = {},
): readonly StudioElementType[] {
  const descriptors = options.descriptors ?? STUDIO_TYPE_DESCRIPTORS;
  const types = (options.registry ?? TALE_ELEMENT_TYPE_REGISTRY).map((type) => described(type, descriptors));
  // Angular's own guard: a production build defines ngDevMode as false and drops this branch.
  if ((typeof ngDevMode === 'undefined' || ngDevMode) && options.testTypes === true) {
    const testDescriptors = studioTestTypeDescriptors();
    types.push(...TALE_TEST_ELEMENT_TYPES.map((type) => described(type, testDescriptors)));
  }
  return types;
}

/**
 * The registry label of a type that is not among the registry's own (built-in) types: a test-only
 * type's in a development build, else undefined.
 */
export function elementTypeLabel(key: string): string | undefined {
  if (!(typeof ngDevMode === 'undefined' || ngDevMode)) return undefined;
  return TALE_TEST_ELEMENT_TYPES.find((t) => t.key === key)?.label;
}

/** The localStorage switch a development build reads to offer the registry's test-only types. */
export const TEST_ELEMENT_TYPES_STORAGE_KEY = 'taleart.testElementTypes';

/**
 * Whether the studio offers the registry's test-only element types (R8): never in a production
 * build; in a development build only when `localStorage['taleart.testElementTypes']` is `on`.
 * Tests provide it.
 */
export const STUDIO_TEST_ELEMENT_TYPES = new InjectionToken<boolean>('STUDIO_TEST_ELEMENT_TYPES', {
  providedIn: 'root',
  factory: () => {
    if (!(typeof ngDevMode === 'undefined' || ngDevMode)) return false;
    try {
      return globalThis.localStorage?.getItem(TEST_ELEMENT_TYPES_STORAGE_KEY) === 'on';
    } catch {
      return false;
    }
  },
});
