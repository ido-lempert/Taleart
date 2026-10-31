import { SWIPE_UP_BOX, type TaleDocument, type TaleElement } from '@taleart/contract/tale-document';

/** What a tale's buttons are drawn with: the colours suit the floor colour of the tale's picture. */
export interface Ink {
  buttonFill: string;
  buttonText: string;
}

export const INK = {
  sand: { buttonFill: '#9a4a33', buttonText: '#ffffff' },
  sage: { buttonFill: '#2f4838', buttonText: '#ffffff' },
  blush: { buttonFill: '#27364a', buttonText: '#ffffff' },
  night: { buttonFill: '#e0a458', buttonText: '#1a2438' },
  sun: { buttonFill: '#2f4838', buttonText: '#ffffff' },
  mist: { buttonFill: '#9a4a33', buttonText: '#ffffff' },
} as const satisfies Record<string, Ink>;

/** Text sizes (fractions of the canvas height) and line heights the seed writes. */
export const HEADING = { size: 0.036, lineHeight: 1.2 } as const;
export const BODY = { size: 0.026, lineHeight: 1.3 } as const;

export type InkName = keyof typeof INK;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Text sits on a cream card (its own opaque box colour), so it reads over any picture and Tale Studio
 * can check its contrast exactly; the card and the text colour are the same in every tale.
 */
export const TEXT_COLOR = '#27364a';
export const TEXT_CARD = '#faf7f2';
/** The dark panel behind an interactive component: the Studio draws its stand-in in white, and the components use their dark theme. */
export const PANEL_COLOR = '#1f2937';

/**
 * Builds the elements of one tale on top of its picture. Ids are numbered, so a document is the
 * same every time it is built; the picture itself is the tale's own media, which the API puts in.
 */
export class ElementBuilder {
  readonly elements: TaleElement[] = [];
  private count = 0;

  constructor(
    private readonly ink: Ink,
    private readonly taleNumber: number,
  ) {}

  private id(): string {
    this.count += 1;
    return `${this.taleNumber.toString(16).padStart(8, '0')}-0000-4000-8000-${this.count.toString(16).padStart(12, '0')}`;
  }

  private add(type: TaleElement['type'], box: Box, props: object, a11y: { label?: string } = {}): this {
    this.elements.push({
      id: this.id(),
      type,
      box: { ...box, rotation: 0 },
      hidden: false,
      locked: false,
      a11y,
      props,
    } as TaleElement);
    return this;
  }

  heading(text: string, y = 0.55, h = 0.09): this {
    return this.add(
      'text',
      { x: 0.08, y, w: 0.84, h },
      {
        text,
        size: HEADING.size,
        weight: 'bold',
        color: TEXT_COLOR,
        align: 'start',
        lineHeight: HEADING.lineHeight,
        background: 'box',
        backgroundColor: TEXT_CARD,
        font: { source: 'system', stack: 'serif' },
      },
    );
  }

  body(text: string, y = 0.65, h = 0.11): this {
    return this.add(
      'text',
      { x: 0.08, y, w: 0.84, h },
      { text, size: BODY.size, weight: 'regular', color: TEXT_COLOR, align: 'start', lineHeight: BODY.lineHeight, background: 'box', backgroundColor: TEXT_CARD },
    );
  }

  // A dark rounded panel under an interactive component, same box.
  private panel(box: Box): this {
    return this.add('shape', box, { shape: 'rectangle', fill: PANEL_COLOR, radius: 0.02 });
  }

  button(label: string, href: string, y = 0.78): this {
    return this.add(
      'button',
      { x: 0.08, y, w: 0.5, h: 0.06 },
      { label, href, newTab: true, variant: 'filled', color: this.ink.buttonText, fill: this.ink.buttonFill, radius: 0.03 },
    );
  }

  swipeUp(label: string, href: string): this {
    return this.add('swipe-up', SWIPE_UP_BOX, { label, href, newTab: true, color: this.ink.buttonText, background: this.ink.buttonFill });
  }

  countdown(title: string, endsAt: string, endedText: string, y = 0.66): this {
    const box = { x: 0.08, y, w: 0.84, h: 0.12 };
    return this.panel(box).add('countdown', box, { title, endsAt, endedText, theme: 'dark' });
  }

  promoCode(title: string, code: string, note: string, y = 0.66): this {
    const box = { x: 0.08, y, w: 0.84, h: 0.12 };
    return this.panel(box).add('promo-code', box, { title, code, note, theme: 'dark' });
  }

  poll(title: string, question: string, options: [string, string][], y = 0.58): this {
    const box = { x: 0.08, y, w: 0.84, h: 0.26 };
    return this.panel(box).add('poll', box, { title, question, options: options.map(([id, label]) => ({ id, label })), theme: 'dark' });
  }

  quiz(title: string, question: string, answers: [string, string][], correct: string, y = 0.56): this {
    const box = { x: 0.08, y, w: 0.84, h: 0.28 };
    return this.panel(box).add('quiz', box, { title, question, answers: answers.map(([id, label]) => ({ id, label })), correctAnswerId: correct, theme: 'dark' });
  }

  rating(title: string, question: string, emoji: string, y = 0.64): this {
    const box = { x: 0.08, y, w: 0.84, h: 0.18 };
    return this.panel(box).add('rating', box, { title, question, emoji, theme: 'dark' });
  }

  reaction(title: string, question: string, emojis: string[], y = 0.7): this {
    const box = { x: 0.08, y, w: 0.84, h: 0.14 };
    return this.panel(box).add('reaction', box, { title, question, emojis, theme: 'dark' });
  }
}

/**
 * The document the tale's own media starts as (a full-canvas image element) with the elements on
 * top of it: the elements are appended, so they sit above the picture in the z-order.
 */
export function withElements(document: TaleDocument, elements: readonly TaleElement[]): TaleDocument {
  return { ...document, elements: [...document.elements, ...elements] };
}
