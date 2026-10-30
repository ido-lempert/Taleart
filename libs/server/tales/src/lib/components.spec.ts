import { InvalidTaleDocumentError, checkTaleDocument } from './tale-document';

// Components without server state (2026-10-29): the server takes a countdown and a promo code by
// their schemas and the rules of their props, and refuses the rest.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const element = (type: string, props: Record<string, unknown>) => ({
  id: id(1),
  type,
  box: { x: 0.1, y: 0.2, w: 0.8, h: 0.2, rotation: 0 },
  hidden: false,
  locked: false,
  a11y: {},
  props,
});
const doc = (elements: unknown[]) => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#000000' } },
  elements,
});

function refused(value: unknown): InvalidTaleDocumentError {
  try {
    checkTaleDocument(value);
  } catch (err) {
    if (err instanceof InvalidTaleDocumentError) return err;
    throw err;
  }
  throw new Error('the document was accepted');
}

const countdown = (props: Record<string, unknown> = {}) => doc([element('countdown', { endsAt: '2026-12-31T21:00:00Z', ...props })]);
const promo = (props: Record<string, unknown> = {}) => doc([element('promo-code', { code: 'SPRING26', ...props })]);
const reaction = (props: Record<string, unknown> = {}) =>
  doc([element('reaction', { question: 'How was it?', emojis: ['❤️', '😂'], ...props })]);

describe('checkTaleDocument: a countdown (components, 2026-10-29)', () => {
  it('accepts an instant in UTC with optional title, endedText and theme', () => {
    expect(() => checkTaleDocument(countdown())).not.toThrow();
    expect(() => checkTaleDocument(countdown({ title: 'Sale ends', endedText: 'Over', theme: 'dark' }))).not.toThrow();
    expect(() => checkTaleDocument(countdown({ endsAt: '2026-02-28T23:59:59.5Z' }))).not.toThrow();
  });

  it.each([
    ['an offset instead of Z', '2026-12-31T21:00:00+02:00'],
    ['no time zone', '2026-12-31T21:00:00'],
    ['a space for the T', '2026-12-31 21:00:00Z'],
    ['no seconds', '2026-12-31T21:00Z'],
    ['a month 13', '2026-13-01T00:00:00Z'],
    ['a 30 February', '2026-02-30T00:00:00Z'],
    ['an hour 24', '2026-12-31T24:00:00Z'],
    ['a leap second', '2026-06-30T23:59:60Z'],
    ['a date alone', '2026-12-31'],
    ['a number', 1798750800000],
  ])('refuses an endsAt with %s', (_name, endsAt) => {
    expect(refused(countdown({ endsAt })).pointer).toBe('/elements/0/props/endsAt');
  });

  it('refuses a missing endsAt, an unknown prop and a line break in the ended text', () => {
    expect(refused(countdown({ endsAt: undefined })).pointer).toBe('/elements/0/props/endsAt');
    expect(refused(countdown({ size: 3 })).pointer).toBe('/elements/0/props/size');
    expect(refused(countdown({ endedText: 'Over\nnow' })).pointer).toBe('/elements/0/props/endedText');
  });

  it('refuses a title with a control character or a bidi override', () => {
    expect(refused(countdown({ title: 'Sale\u0007' })).pointer).toBe('/elements/0/props/title');
    expect(refused(countdown({ title: 'Sale‮' })).pointer).toBe('/elements/0/props/title');
  });

  it('refuses an unknown theme', () => {
    expect(refused(countdown({ theme: 'blue' })).pointer).toBe('/elements/0/props/theme');
  });
});

describe('checkTaleDocument: a promo code (components, 2026-10-29)', () => {
  it('accepts a code of letters, digits, underscores and hyphens, with optional title and note', () => {
    for (const code of ['A', 'SPRING_26-x', 'a'.repeat(32)]) expect(() => checkTaleDocument(promo({ code }))).not.toThrow();
    expect(() => checkTaleDocument(promo({ title: 'Thanks', note: 'Once per visitor', theme: 'light' }))).not.toThrow();
  });

  it.each([
    ['a space', 'SPRING 26'],
    ['a dot', 'SPRING.26'],
    ['an accented letter', 'CAFÉ'],
    ['an emoji', 'SAVE🎉'],
    ['a slash', 'A/B'],
    ['markup', '<b>x</b>'],
    ['a line break', 'AB\nCD'],
    ['33 characters', 'a'.repeat(33)],
    ['an empty code', ''],
  ])('refuses a code with %s', (_name, code) => {
    expect(refused(promo({ code })).pointer).toBe('/elements/0/props/code');
  });

  it('refuses a missing code, a note over 120 characters and a note with a control character', () => {
    expect(refused(promo({ code: undefined })).pointer).toBe('/elements/0/props/code');
    expect(refused(promo({ note: 'x'.repeat(121) })).pointer).toBe('/elements/0/props/note');
    expect(refused(promo({ note: 'Terms\u0000' })).pointer).toBe('/elements/0/props/note');
  });
});

describe('checkTaleDocument: a reaction (components, 2026-10-29)', () => {
  it('accepts two to six distinct emoji, with optional title and theme', () => {
    expect(() => checkTaleDocument(reaction())).not.toThrow();
    expect(() => checkTaleDocument(reaction({ emojis: ['👍', '👎', '🤔', '🔥', '🎉', '👏'] }))).not.toThrow();
    expect(() => checkTaleDocument(reaction({ title: 'Your mood', theme: 'dark' }))).not.toThrow();
  });

  it('refuses one emoji and seven', () => {
    expect(refused(reaction({ emojis: ['❤️'] })).pointer).toBe('/elements/0/props/emojis');
    expect(refused(reaction({ emojis: ['👍', '👎', '🤔', '🔥', '🎉', '👏', '😮'] })).pointer).toBe('/elements/0/props/emojis');
  });

  it('refuses duplicate emoji', () => {
    expect(refused(reaction({ emojis: ['❤️', '❤️'] })).pointer).toBe('/elements/0/props/emojis');
  });

  it.each([
    ['a word', 'love'],
    ['a digit', '1'],
    ['two emoji in one entry', '❤️😂'],
    ['markup', '<b>x</b>'],
    ['an empty entry', ''],
    ['a letter with an emoji', 'A😂'],
  ])('refuses an entry that is not one emoji: %s', (_name, emoji) => {
    expect(refused(reaction({ emojis: ['❤️', emoji] })).pointer).toMatch(/^\/elements\/0\/props\/emojis/);
  });

  it('refuses a second reaction in one tale', () => {
    const second = { ...element('reaction', { question: 'Q', emojis: ['👍', '👎'] }), id: id(2) };
    const twice = doc([element('reaction', { question: 'Q', emojis: ['👍', '👎'] }), second]);
    expect(refused(twice).pointer).toBe('/elements/1/type');
  });

  it('refuses a question with a line break and a missing emojis prop', () => {
    expect(refused(reaction({ question: 'How\nwas it?' })).pointer).toBe('/elements/0/props/question');
    expect(refused(reaction({ emojis: undefined })).pointer).toBe('/elements/0/props/emojis');
  });
});

describe('checkTaleDocument: poll views and option colours (end-user redesign P4)', () => {
  const poll = (props: Record<string, unknown> = {}) =>
    doc([
      element('poll', {
        question: 'Tea or coffee?',
        theme: 'light',
        options: [
          { id: 'tea', label: 'Tea' },
          { id: 'coffee', label: 'Coffee' },
        ],
        ...props,
      }),
    ]);

  it('keeps a poll without view or colours valid, as before the redesign', () => {
    expect(() => checkTaleDocument(poll())).not.toThrow();
  });

  it('accepts each view and a #rrggbb colour per option', () => {
    for (const view of ['sticker', 'embed', 'this-or-that', 'grid', 'inline']) {
      expect(() => checkTaleDocument(poll({ view }))).not.toThrow();
    }
    const options = [
      { id: 'tea', label: 'Tea', color: '#2563eb' },
      { id: 'coffee', label: 'Coffee', color: '#B45309' },
    ];
    expect(() => checkTaleDocument(poll({ view: 'this-or-that', options }))).not.toThrow();
  });

  it('refuses an unknown view and a colour that is not #rrggbb', () => {
    expect(() => checkTaleDocument(poll({ view: 'carousel' }))).toThrow(InvalidTaleDocumentError);
    const options = [
      { id: 'tea', label: 'Tea', color: 'blue' },
      { id: 'coffee', label: 'Coffee' },
    ];
    expect(() => checkTaleDocument(poll({ view: 'grid', options }))).toThrow(InvalidTaleDocumentError);
  });
});
