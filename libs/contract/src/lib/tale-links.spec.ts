import Ajv2020 from 'ajv/dist/2020';
import {
  BUTTON_VARIANTS,
  buttonFontSize,
  documentMediaRefs,
  elementName,
  hasAltText,
  isLinkElement,
  isLinkUrl,
  isMediaElement,
  isOutsideSafeArea,
  isSwipeUpBox,
  LINK_URL_MESSAGES,
  linkLabel,
  linkLabelStyle,
  linkUrlProblem,
  MAX_LINK_LABEL_LENGTH,
  MAX_LINK_RADIUS,
  MAX_LINK_URL_LENGTH,
  missingAltText,
  missingAltTextMessage,
  missingLinkUrl,
  missingLinkUrlMessage,
  NEW_BUTTON_BOX,
  NEW_IMAGE_BUTTON_BOX,
  newButtonProps,
  newSwipeUpProps,
  resolveButtonStyle,
  resolveDocumentMedia,
  resolveSwipeUpStyle,
  safeAreaBounds,
  SWIPE_UP_BOX,
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_SAFE_AREA,
  textContrast,
  type TextStyle,
} from '../index';

// Tale Studio story 7.7: buttons, image buttons and the swipe-up link (R7, R14).
type Schema = { [key: string]: unknown };
const schemaOf = (key: string) => TALE_ELEMENT_TYPE_REGISTRY.find((t) => t.key === key)?.schema as Schema;
const ajv = new Ajv2020();
const validate = (key: string) => ajv.compile(schemaOf(key));
const ch = (code: number) => String.fromCharCode(code);

const IMAGE = 'media/0b7c9d4e-1111-4222-8333-944455556666.jpg';

const element = (type: string, props: unknown, extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  type,
  box: { x: 0.1, y: 0.1, w: 0.8, h: 0.1, rotation: 0 },
  hidden: false,
  locked: false,
  a11y: {},
  props,
  ...extra,
});

describe('linkUrlProblem: the destination rule (R7, R14)', () => {
  it.each([
    'https://example.com',
    'http://example.com/shop?item=1#top',
    'HTTPS://EXAMPLE.COM/Path',
    'https://xn--bcher-kva.example/',
    'https://example.com:8443/a/b',
    `https://example.com/${'a'.repeat(MAX_LINK_URL_LENGTH - 'https://example.com/'.length)}`,
  ])('accepts %s', (url) => {
    expect(linkUrlProblem(url)).toBeNull();
    expect(isLinkUrl(url)).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ['nothing', '', 'empty'],
    ['a number', 42, 'empty'],
    ['a javascript: URL', 'javascript:alert(1)', 'scheme'],
    ['a JavaScript: URL in capitals', 'JAVASCRIPT:alert(1)', 'scheme'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>', 'scheme'],
    ['an ftp: URL', 'ftp://example.com/file', 'scheme'],
    ['a mailto: URL', 'mailto:a@example.com', 'scheme'],
    ['a relative URL', '/shop', 'scheme'],
    ['a protocol-relative URL', '//example.com', 'scheme'],
    ['a scheme with one slash', 'https:/example.com', 'scheme'],
    ['a scheme without slashes', 'https:example.com', 'scheme'],
    ['credentials', 'https://user:pass@example.com', 'credentials'],
    ['a user name', 'https://user@example.com', 'credentials'],
    ['a space', 'https://example.com/a b', 'characters'],
    ['a leading space', ' https://example.com', 'characters'],
    ['a tab inside the scheme', `java${ch(9)}script:alert(1)`, 'characters'],
    ['a line feed', `https://example.com/${ch(10)}`, 'characters'],
    ['a NUL', `https://example.com/${ch(0)}`, 'characters'],
    ['DEL', `https://example.com/${ch(0x7f)}`, 'characters'],
    ['a C1 control', `https://example.com/${ch(0x85)}`, 'characters'],
    ['a bidi override', `https://example.com/${ch(0x202e)}gpj.exe`, 'characters'],
    ['no host', 'http://', 'invalid'],
    ['a broken host', 'https://exa mple', 'characters'],
    ['an invalid port', 'https://example.com:99999', 'invalid'],
    [
      '2,049 characters',
      `https://example.com/${'a'.repeat(MAX_LINK_URL_LENGTH - 'https://example.com/'.length + 1)}`,
      'tooLong',
    ],
  ])('refuses %s', (_name, value, problem) => {
    expect(linkUrlProblem(value)).toBe(problem);
    expect(isLinkUrl(value)).toBe(false);
  });

  it('says each problem in words', () => {
    expect(Object.keys(LINK_URL_MESSAGES).sort()).toEqual(
      ['characters', 'credentials', 'empty', 'invalid', 'scheme', 'tooLong'].sort(),
    );
    expect(LINK_URL_MESSAGES.scheme).toContain('http://');
  });
});

describe('link schemas', () => {
  const button = validate('button');
  const imageButton = validate('image-button');
  const swipeUp = validate('swipe-up');

  it('registers the three types', () => {
    expect(TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key)).toEqual(
      expect.arrayContaining(['button', 'image-button', 'swipe-up']),
    );
  });

  it('states the contract values', () => {
    for (const key of ['button', 'image-button', 'swipe-up']) {
      const props = schemaOf(key)['properties'] as Record<string, Schema>;
      expect(props['href']['maxLength']).toBe(MAX_LINK_URL_LENGTH);
      expect(schemaOf(key)['additionalProperties']).toBe(false);
    }
    const props = schemaOf('button')['properties'] as Record<string, Schema>;
    expect(props['variant']['enum']).toEqual(BUTTON_VARIANTS);
    expect(props['label']['maxLength']).toBe(MAX_LINK_LABEL_LENGTH);
    expect(props['radius']['maximum']).toBe(MAX_LINK_RADIUS);
  });

  it('accepts new links, with and without a destination', () => {
    expect(button(newButtonProps())).toBe(true);
    expect(button({ ...newButtonProps(), href: 'https://example.com', newTab: true })).toBe(true);
    expect(swipeUp(newSwipeUpProps())).toBe(true);
    expect(swipeUp({ ...newSwipeUpProps(), href: 'http://example.com' })).toBe(true);
    expect(imageButton({ mediaKey: IMAGE, href: 'https://example.com', radius: 0.02 })).toBe(true);
  });

  it('refuses other schemes, long URLs, bad styles and unknown props', () => {
    expect(button({ ...newButtonProps(), href: 'javascript:alert(1)' })).toBe(false);
    expect(button({ ...newButtonProps(), href: 'ftp://example.com' })).toBe(false);
    expect(button({ ...newButtonProps(), href: `https://e.com/${'a'.repeat(2048)}` })).toBe(false);
    expect(button({ ...newButtonProps(), variant: 'ghost' })).toBe(false);
    expect(button({ ...newButtonProps(), color: 'red' })).toBe(false);
    expect(button({ ...newButtonProps(), label: '' })).toBe(false);
    expect(button({ ...newButtonProps(), onclick: 'x' })).toBe(false);
    expect(swipeUp({ ...newSwipeUpProps(), href: 'data:text/html,x' })).toBe(false);
    expect(imageButton({ mediaKey: 'media/abc.mp4' })).toBe(false);
    expect(imageButton({ mediaKey: IMAGE, url: 'https://example.com/x.png' })).toBe(false);
  });
});

describe('link helpers', () => {
  it('tells links apart; an image button is media of the project', () => {
    expect(['button', 'image-button', 'swipe-up'].every((type) => isLinkElement({ type }))).toBe(true);
    expect(isLinkElement({ type: 'text' })).toBe(false);
    expect(isMediaElement({ type: 'image-button' })).toBe(true);
    expect(isMediaElement({ type: 'button' })).toBe(false);
  });

  it('references an image button media key, and delivers it as a URL with its destination', () => {
    const doc = {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [element('image-button', { mediaKey: IMAGE, href: 'https://example.com' })],
    };
    expect(documentMediaRefs(doc)).toEqual([
      { key: IMAGE, pointer: '/elements/0/props/mediaKey', kind: 'image', visible: true },
    ]);
    const delivered = resolveDocumentMedia(doc, (key) => `https://cdn.example/${key}`);
    expect(delivered.elements[0]).toMatchObject({
      props: { url: `https://cdn.example/${IMAGE}`, href: 'https://example.com' },
    });
  });

  it('needs alt text on an image button: the decorative mark does not name a link', () => {
    const decorative = element('image-button', { mediaKey: IMAGE }, { a11y: { decorative: true } });
    expect(hasAltText(decorative)).toBe(false);
    expect(hasAltText({ ...decorative, a11y: { label: 'Shop the look' } })).toBe(true);
    const found = missingAltText({ elements: [decorative] });
    expect(found).toEqual({ index: 0, name: 'Image button 1', type: 'image-button' });
    expect(missingAltTextMessage(found ?? { name: '' })).toBe(
      '"Image button 1" needs alt text before the tale can be updated.',
    );
  });

  it('finds a visible link without a destination, by name', () => {
    const elements = [
      element('button', { ...newButtonProps(), href: 'https://example.com' }),
      element('button', newButtonProps(), { hidden: true }),
      element('swipe-up', newSwipeUpProps(), { box: { ...SWIPE_UP_BOX } }),
    ];
    const found = missingLinkUrl({ elements });
    expect(found).toEqual({ index: 2, name: 'See more' });
    expect(missingLinkUrlMessage(found ?? { name: '' })).toBe(
      '"See more" needs a web address before the tale can be updated.',
    );
    expect(missingLinkUrl({ elements: elements.slice(0, 2) })).toBeNull();
    // A stored address that fails the rule counts as none.
    expect(missingLinkUrl({ elements: [element('button', { ...newButtonProps(), href: 'javascript:x' })] })).toEqual({
      index: 0,
      name: 'Learn more',
    });
  });

  it('names links as the layers list does', () => {
    const elements = [
      element('button', { ...newButtonProps(), label: '' }),
      element('button', newButtonProps()),
      element('image-button', { mediaKey: IMAGE }),
      element('swipe-up', { ...newSwipeUpProps(), label: '  ' }),
    ];
    expect(elementName(elements, 0)).toBe('Button 1');
    expect(elementName(elements, 1)).toBe('Learn more');
    expect(elementName(elements, 2)).toBe('Image button 1');
    expect(elementName(elements, 3)).toBe('Swipe-up link');
  });

  it('pins the swipe-up link inside the bottom safe area; new links sit inside the safe areas', () => {
    expect(SWIPE_UP_BOX.y).toBeGreaterThanOrEqual(1 - TALE_SAFE_AREA.bottom);
    expect(SWIPE_UP_BOX.y + SWIPE_UP_BOX.h).toBeLessThanOrEqual(1);
    expect(isSwipeUpBox({ ...SWIPE_UP_BOX })).toBe(true);
    expect(isSwipeUpBox({ ...SWIPE_UP_BOX, y: 0.5 })).toBe(false);
    const safe = safeAreaBounds();
    expect(isOutsideSafeArea(NEW_BUTTON_BOX)).toBe(false);
    expect(isOutsideSafeArea(NEW_IMAGE_BUTTON_BOX)).toBe(false);
    expect(NEW_IMAGE_BUTTON_BOX.w * 9).toBeCloseTo(NEW_IMAGE_BUTTON_BOX.h * 16);
    expect(safe.y + safe.h).toBeCloseTo(1 - TALE_SAFE_AREA.bottom);
  });

  it('resolves styles again, falling back on bad values', () => {
    expect(resolveButtonStyle({ variant: 'outline', color: '#ff0000', fill: '#00ff00', radius: 0.1 })).toEqual({
      variant: 'outline',
      color: '#ff0000',
      fill: '#00ff00',
      radius: 0.1,
    });
    expect(resolveButtonStyle({ variant: 'x', color: 'red;x', fill: 'url(x)', radius: 9 })).toEqual({
      variant: 'filled',
      color: '#111827',
      fill: '#FFFFFF',
      radius: 0,
    });
    expect(resolveSwipeUpStyle({ color: 'x', background: '#11223344' })).toEqual({
      color: '#FFFFFF',
      background: '#11223344',
    });
    expect(buttonFontSize({ h: 0.07 })).toBeCloseTo(0.028);
    expect(buttonFontSize({ h: 0.5 })).toBe(0.06);
  });

  it('draws a label on one line, without controls, within its limit', () => {
    expect(linkLabel(`Shop${ch(10)}now${ch(0x202e)}`)).toBe('Shop now');
    expect([...linkLabel('x'.repeat(200))].length).toBe(MAX_LINK_LABEL_LENGTH);
    expect(linkLabel(3)).toBe('');
  });

  it('checks a label against its fill, or against the canvas for an outline button', () => {
    const base = { canvasColor: '#ffffff', overMedia: false };
    const filled = linkLabelStyle(
      element('button', { ...newButtonProps(), color: '#eeeeee', fill: '#ffffff' }),
    ) as TextStyle;
    expect(textContrast(filled, base)).toMatchObject({ kind: 'low', against: 'box' });
    const good = linkLabelStyle(element('button', newButtonProps())) as TextStyle;
    expect(textContrast(good, base).kind).toBe('ok');
    const outline = linkLabelStyle(
      element('button', { ...newButtonProps(), variant: 'outline', color: '#ffffff' }),
    ) as TextStyle;
    expect(textContrast(outline, base)).toMatchObject({ kind: 'low', against: 'canvas' });
    const swipe = linkLabelStyle(element('swipe-up', newSwipeUpProps(), { box: { ...SWIPE_UP_BOX } })) as TextStyle;
    expect(textContrast(swipe, { canvasColor: '#000000', overMedia: false }).kind).toBe('ok');
    expect(linkLabelStyle(element('image-button', { mediaKey: IMAGE }))).toBeNull();
  });
});
