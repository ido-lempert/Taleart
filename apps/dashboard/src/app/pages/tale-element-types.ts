// Tale Studio's element types (epic Tale Studio R8; AD-15): one descriptor per key of the contract's
// element-type registry, which says how the Add menu offers the type and which inspector edits it.
// The registry is the one list: a registered type without a descriptor stops the studio, and a
// descriptor without a registered type is never shown. Lazy: only the studio imports this file.
import { InjectionToken } from '@angular/core';
import {
  ELEMENT_TYPE_LIMITS,
  hasDisallowedCharacter,
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

/** What an Add menu entry does: the studio's own flow for a built-in type, or `configured` for a new type. */
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

/** A limit on how many elements of a type a tale holds: the Add entry says so and names the hint. */
export interface AddLimit {
  hintId: string;
  hint: string;
  /** Where its hint shows among the reached limits' hints, lowest first. */
  hintOrder: number;
  reached(doc: { elements: readonly { type: string; props?: unknown }[] } | null | undefined): boolean;
}

/** One button of the Add menu. */
export interface AddMenuEntry {
  /** The button's id: `studio-add` for text, else `studio-add-<name>`. */
  id: string;
  label: string;
  icon: IconName;
  /** The Add menu row it sits in, from 0; rows show in order. */
  row: number;
  /** A small button. */
  small: boolean;
  /** Picks the project's media, so it needs the tale's project. */
  needsProject: boolean;
  action: AddAction;
  limit?: AddLimit;
}

/** One field of a descriptor-driven inspector; its rules come from the type's props schema. */
export interface InspectorField {
  /** The prop it edits. */
  prop: string;
  label: string;
  /** `text` and `number` inputs, a `color` picker with its hex field, or a `select` of the schema's enum. */
  control: 'text' | 'number' | 'color' | 'select';
  /** For a select: the name people read for each enum value. */
  options?: readonly { value: string; label: string }[];
  hint?: string;
}

/**
 * A fixed list of choices, each `{ id, label }` (epic interactive components R1): the inspector edits
 * each label as a text field; ids stay as made, so a choice's count survives an edit to its text.
 * Its prop is an array with as many items at least as at most (adding and removing choices comes
 * with the quiz's list field).
 */
export interface ChoicesField {
  /** The array prop. */
  prop: string;
  /** The group's name, such as "Options". */
  label: string;
  /** The name of the choice at `index` (from 0), such as "Option 1". */
  itemLabel(index: number): string;
  hint?: string;
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
  add: readonly AddMenuEntry[];
  inspector: InspectorDescriptor;
  /** For a `configured` type: how a new one is made. */
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

const entry = (
  id: string,
  label: string,
  icon: IconName,
  row: number,
  action: AddAction,
  extra: Partial<AddMenuEntry> = {},
): AddMenuEntry => ({ id, label, icon, row, small: row > 0, needsProject: false, action, ...extra });

// The poll's rules its schema cannot state, as the server's `PROPS_RULES` holds them: its text shows
// on one line, and its option ids differ (epic interactive components R2).
function checkPollProps(props: Readonly<Record<string, unknown>>): string | null {
  const options = Array.isArray(props['options']) ? (props['options'] as { id?: unknown; label?: unknown }[]) : [];
  const texts = [props['question'], props['title'], ...options.map((o) => o?.label)];
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    if (text.trim() === '') return 'Enter some text.';
    if (hasDisallowedCharacter(text, LABEL_TEXT_RULE) || text.includes('\n')) return 'Use one line of plain text.';
  }
  if (new Set(options.map((o) => o?.id)).size !== options.length) return 'Each option needs its own id.';
  return null;
}

/** The descriptors of the registry's types, keyed by registry key (R8). */
export const STUDIO_TYPE_DESCRIPTORS: Readonly<Record<string, StudioTypeDescriptor>> = {
  text: { add: [entry('studio-add', 'Add text', 'plus', 0, { kind: 'text' })], inspector: 'text' },
  image: {
    add: [entry('studio-add-image', 'Add image', 'image', 0, { kind: 'media', media: 'image' }, { needsProject: true })],
    inspector: 'media',
  },
  video: {
    add: [
      entry('studio-add-video', 'Add video', 'video', 0, { kind: 'media', media: 'video' }, {
        needsProject: true,
        limit: {
          hintId: 'studio-video-hint',
          hintOrder: 1,
          hint: 'A tale holds one video, and plays for its length. Delete it to add another.',
          reached: (doc) => limitedVideoCount(doc as { elements: readonly { type: string }[] }) >= MAX_VIDEO_ELEMENTS,
        },
      }),
    ],
    inspector: 'media',
  },
  shape: {
    add: SHAPE_KINDS.map((shape) =>
      entry(`studio-add-${shape}`, `Add ${SHAPE_NAMES[shape].toLowerCase()}`, 'shape', 1, { kind: 'shape', shape }),
    ),
    inspector: 'shape',
  },
  emoji: { add: [entry('studio-add-emoji', 'Add emoji', 'emoji', 1, { kind: 'emoji' })], inspector: 'emoji' },
  sticker: {
    add: [entry('studio-add-sticker', 'Add sticker', 'sticker', 1, { kind: 'sticker' }, { needsProject: true })],
    inspector: 'media',
  },
  button: { add: [entry('studio-add-button', 'Add button', 'button', 2, { kind: 'button' })], inspector: 'link' },
  'image-button': {
    add: [
      entry('studio-add-image-button', 'Add image button', 'image-button', 2, { kind: 'image-button' }, {
        needsProject: true,
      }),
    ],
    inspector: 'link',
  },
  poll: {
    add: [
      entry('studio-add-poll', 'Add poll', 'poll', 3, { kind: 'configured' }, {
        limit: {
          hintId: 'studio-poll-hint',
          hintOrder: 2,
          hint: 'A tale holds one poll. Delete it to add another.',
          reached: (doc) => (doc?.elements.filter((e) => e.type === 'poll').length ?? 0) >= ELEMENT_TYPE_LIMITS['poll'],
        },
      }),
    ],
    inspector: {
      fields: [
        { prop: 'question', label: 'Question', control: 'text', hint: 'One line, up to 200 characters.' },
        { prop: 'title', label: 'Title', control: 'text', hint: 'Optional, up to 80 characters.' },
        {
          prop: 'theme',
          label: 'Theme',
          control: 'select',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
        },
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
  'swipe-up': {
    add: [
      entry('studio-add-swipe-up', 'Add swipe-up link', 'swipe-up', 2, { kind: 'swipe-up' }, {
        limit: {
          hintId: 'studio-swipe-up-hint',
          hintOrder: 0,
          hint: 'A tale holds one swipe-up link. Delete it to add another.',
          reached: (doc) => (doc?.elements.filter((e) => e.type === 'swipe-up').length ?? 0) >= MAX_SWIPE_UP_ELEMENTS,
        },
      }),
    ],
    inspector: 'link',
  },
};

/**
 * The descriptors of the registry's test-only types (R8), made on demand. Only development builds
 * that opt in, and tests, reach them: production builds drop them with `ngDevMode`.
 */
export function studioTestTypeDescriptors(): Readonly<Record<string, StudioTypeDescriptor>> {
  return {
    'test-badge': {
      add: [entry('studio-add-test-badge', 'Add test badge', 'plus', 3, { kind: 'configured' })],
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
  if (choices) checkChoicesField(properties, choices.prop, fail);
}

/** The JSON Schema keywords a choices field's array prop may use. */
export const CHOICES_PROP_KEYWORDS: readonly string[] = ['title', 'description', 'type', 'minItems', 'maxItems', 'items'];

// A choices field edits a fixed number of closed `{ id, label }` items whose id and label use only
// what `propValueProblem` checks, and whose label is text.
function checkChoicesField(
  properties: Record<string, Record<string, unknown>>,
  name: string,
  fail: (why: string) => void,
): void {
  const prop = Object.prototype.hasOwnProperty.call(properties, name) ? properties[name] : undefined;
  if (!prop) return fail(`the inspector edits choices "${name}", which its schema lacks`);
  for (const keyword of Object.keys(prop)) {
    if (!CHOICES_PROP_KEYWORDS.includes(keyword)) fail(`"${name}" uses "${keyword}", which the choices field does not check`);
  }
  if (prop['type'] !== 'array' || prop['minItems'] === undefined || prop['minItems'] !== prop['maxItems']) {
    fail(`"${name}" must be an array with as many items at least as at most`);
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
  if (descriptor.add.some((a) => a.action.kind === 'configured') && !descriptor.create) {
    throw new Error(`Element type "${type.key}" is added by configuration but says nothing of how`);
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

/** The Add menu's rows, each with its entries and their types, in registry order. */
export function addMenuRows(types: readonly StudioElementType[]): { entry: AddMenuEntry; type: StudioElementType }[][] {
  const rows: { entry: AddMenuEntry; type: StudioElementType }[][] = [];
  for (const type of types) {
    for (const add of type.add) (rows[add.row] ??= []).push({ entry: add, type });
  }
  return rows.filter((row) => row !== undefined);
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
