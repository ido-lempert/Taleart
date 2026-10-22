import {
  BUTTON_OUTLINE_WIDTH,
  buttonFontSize,
  isLinkUrl,
  linkLabel,
  resolveButtonStyle,
  resolveSwipeUpStyle,
  SWIPE_UP_FONT_SIZE,
  type DeliveryTaleElement,
} from '@taleart/contract';
import { renderImage, type RenderContext } from './media';

/**
 * A link's destination as the `href` to set, or null (AD-16): the server checked it on write, and
 * the SDK checks it again with the same rule, an absolute `http` or `https` URL of at most 2,048
 * characters without credentials or control characters, so no other scheme reaches the page.
 */
export function linkHref(value: unknown): string | null {
  if (!isLinkUrl(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// An `<a>` to the element's destination (R7, AD-16): never an opener or a referrer; a new tab only
// when the element asks for one. Null without a destination that passes the rule. In an inert
// context (the Tale Studio preview, which shows a draft) the link looks the same but has no `href`
// or target: it goes nowhere, and a draft's destination never becomes a live link in the dashboard.
function anchor(element: DeliveryTaleElement, className: string, context?: RenderContext): HTMLAnchorElement | null {
  const props = element.props as { href?: unknown; newTab?: unknown };
  const href = linkHref(props.href);
  if (!href) return null;
  const a = document.createElement('a');
  a.className = `ta-el ta-cta ${className}`;
  a.draggable = false;
  if (context?.inertLinks) {
    a.setAttribute('role', 'link');
    a.setAttribute('aria-disabled', 'true');
    return a;
  }
  a.href = href;
  a.rel = 'noopener noreferrer';
  if (props.newTab === true) a.target = '_blank';
  return a;
}

// True when the element's link opens a new tab (an inert link has no target, but says the same).
function opensNewTab(element: DeliveryTaleElement): boolean {
  return (element.props as { newTab?: unknown }).newTab === true;
}

/** What a link that opens a new tab adds to its accessible name (WCAG 3.2.5 advisory, G201). */
export const NEW_TAB_NOTE = ' (opens in a new tab)';

// The note, visually hidden, at the end of a link that opens a new tab, so screen readers say so.
function newTabNote(a: HTMLAnchorElement, element: DeliveryTaleElement): void {
  if (!opensNewTab(element)) return;
  const note = document.createElement('span');
  note.className = 'ta-sr';
  note.textContent = NEW_TAB_NOTE;
  a.appendChild(note);
}

/**
 * A button (epic Tale Studio R7): a link holding its label as a text node, filled with its colour
 * or outlined in it, with its corner radius, through CSSOM only (AD-16). Its label is its
 * accessible name. Null without a usable destination or label.
 */
export function renderButton(element: DeliveryTaleElement, context?: RenderContext): HTMLElement | null {
  const label = linkLabel((element.props as { label?: unknown }).label);
  const a = label ? anchor(element, 'ta-button', context) : null;
  if (!a) return null;
  a.textContent = label;
  newTabNote(a, element);
  const look = resolveButtonStyle(element.props);
  const style = a.style;
  style.color = look.color;
  style.fontSize = `${Math.round(buttonFontSize(element.box) * 100000) / 1000}cqh`;
  if (look.variant === 'filled') style.backgroundColor = look.fill;
  else style.border = `${BUTTON_OUTLINE_WIDTH * 100}cqh solid ${look.fill}`;
  if (look.radius > 0) style.borderRadius = `${look.radius * 100}cqh`;
  return a;
}

/**
 * A custom image button (epic Tale Studio R7): a link holding its image, named by its alt text
 * (the image inside is then hidden), rounded as set and still under reduced motion. Without alt
 * text, which publishing requires, it is named by its destination's host. Null without a usable
 * destination or image URL.
 */
export function renderImageButton(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const a = anchor(element, 'ta-image-button', context);
  if (!a) return null;
  const { url, radius } = element.props as { url?: unknown; radius?: unknown };
  const image = renderImage(
    {
      ...element,
      a11y: { decorative: true },
      props: { url, radius, fit: 'contain' } as unknown as DeliveryTaleElement['props'],
    },
    context,
  );
  if (!image) return null;
  image.className = 'ta-media ta-fill';
  image.setAttribute('aria-hidden', 'true');
  const label = element.a11y?.label;
  const name = linkLabel(label) || new URL(linkHref((element.props as { href?: unknown }).href) ?? '').hostname;
  a.setAttribute('aria-label', opensNewTab(element) ? `${name}${NEW_TAB_NOTE}` : name);
  a.appendChild(image);
  return a;
}

/**
 * The swipe-up link (epic Tale Studio R7): its label under an arrow on a pill, pinned to the bottom
 * safe area (the renderer gives it its box). A click or Enter on it opens it, as any link; the
 * viewer also opens it on a swipe up (see `TaleViewer`). Its label is its accessible name.
 */
export function renderSwipeUp(element: DeliveryTaleElement, context?: RenderContext): HTMLElement | null {
  const label = linkLabel((element.props as { label?: unknown }).label);
  const a = label ? anchor(element, 'ta-swipe', context) : null;
  if (!a) return null;
  const look = resolveSwipeUpStyle(element.props);
  const arrow = document.createElement('span');
  arrow.className = 'ta-swipe-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  const pill = document.createElement('span');
  pill.className = 'ta-swipe-label';
  pill.textContent = label;
  pill.style.backgroundColor = look.background;
  a.append(arrow, pill);
  newTabNote(a, element);
  a.style.color = look.color;
  a.style.fontSize = `${SWIPE_UP_FONT_SIZE * 100}cqh`;
  return a;
}
