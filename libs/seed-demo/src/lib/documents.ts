import { SWIPE_UP_BOX, type TaleDocument, type TaleElement } from '@taleart/contract/tale-document';

/** What a tale's text and buttons are drawn with: the ink suits the floor colour of the tale's picture. */
export interface Ink {
  text: string;
  buttonFill: string;
  buttonText: string;
}

export const INK = {
  sand: { text: '#27364a', buttonFill: '#9a4a33', buttonText: '#ffffff' },
  sage: { text: '#233a2c', buttonFill: '#2f4838', buttonText: '#ffffff' },
  blush: { text: '#4a2a20', buttonFill: '#27364a', buttonText: '#ffffff' },
  night: { text: '#faf7f2', buttonFill: '#e0a458', buttonText: '#1a2438' },
  sun: { text: '#3a2a14', buttonFill: '#2f4838', buttonText: '#ffffff' },
  mist: { text: '#1f2f3a', buttonFill: '#9a4a33', buttonText: '#ffffff' },
} as const satisfies Record<string, Ink>;

export type InkName = keyof typeof INK;

type Box = { x: number; y: number; w: number; h: number };

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

  heading(text: string, y = 0.56, h = 0.11): this {
    return this.add(
      'text',
      { x: 0.08, y, w: 0.84, h },
      { text, size: 0.04, weight: 'bold', color: this.ink.text, align: 'start', font: { source: 'system', stack: 'serif' } },
    );
  }

  body(text: string, y = 0.68, h = 0.1): this {
    return this.add(
      'text',
      { x: 0.08, y, w: 0.84, h },
      { text, size: 0.026, weight: 'regular', color: this.ink.text, align: 'start', lineHeight: 1.3 },
    );
  }

  button(label: string, href: string, y = 0.78): this {
    return this.add(
      'button',
      { x: 0.08, y, w: 0.5, h: 0.065 },
      { label, href, newTab: true, variant: 'filled', color: this.ink.buttonText, fill: this.ink.buttonFill, radius: 0.03 },
    );
  }

  swipeUp(label: string, href: string): this {
    return this.add('swipe-up', SWIPE_UP_BOX, { label, href, newTab: true, color: this.ink.buttonText, background: this.ink.buttonFill });
  }

  countdown(title: string, endsAt: string, endedText: string, y = 0.66): this {
    return this.add('countdown', { x: 0.08, y, w: 0.84, h: 0.12 }, { title, endsAt, endedText, theme: 'light' });
  }

  promoCode(title: string, code: string, note: string, y = 0.66): this {
    return this.add('promo-code', { x: 0.08, y, w: 0.84, h: 0.12 }, { title, code, note, theme: 'light' });
  }

  poll(title: string, question: string, options: [string, string][], y = 0.58): this {
    return this.add(
      'poll',
      { x: 0.08, y, w: 0.84, h: 0.26 },
      { title, question, options: options.map(([id, label]) => ({ id, label })), theme: 'light' },
    );
  }

  quiz(title: string, question: string, answers: [string, string][], correct: string, y = 0.56): this {
    return this.add(
      'quiz',
      { x: 0.08, y, w: 0.84, h: 0.28 },
      { title, question, answers: answers.map(([id, label]) => ({ id, label })), correctAnswerId: correct, theme: 'light' },
    );
  }

  rating(title: string, question: string, emoji: string, y = 0.64): this {
    return this.add('rating', { x: 0.08, y, w: 0.84, h: 0.18 }, { title, question, emoji, theme: 'light' });
  }

  reaction(title: string, question: string, emojis: string[], y = 0.7): this {
    return this.add('reaction', { x: 0.08, y, w: 0.84, h: 0.14 }, { title, question, emojis, theme: 'light' });
  }
}

/**
 * The document the tale's own media starts as (a full-canvas image element) with the elements on
 * top of it: the elements are appended, so they sit above the picture in the z-order.
 */
export function withElements(document: TaleDocument, elements: readonly TaleElement[]): TaleDocument {
  return { ...document, elements: [...document.elements, ...elements] };
}
