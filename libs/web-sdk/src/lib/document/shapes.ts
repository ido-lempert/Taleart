import {
  cleanText,
  EMOJI_FONT_STACK,
  emojiFontSize,
  LABEL_TEXT_RULE,
  MAX_EMOJI_LENGTH,
  resolveShapeStyle,
  type DeliveryTaleElement,
} from '@taleart/contract';

// The element's accessible name, or '' when it is decorative or has none.
function labelOf(element: DeliveryTaleElement): string {
  if (element.a11y?.decorative === true) return '';
  const label = element.a11y?.label;
  return typeof label === 'string' ? cleanText(label, LABEL_TEXT_RULE).trim() : '';
}

// Names the node as an image for assistive technology, or hides it when it has no name.
function name(node: HTMLElement, label: string): void {
  if (label) {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', label);
  } else node.setAttribute('aria-hidden', 'true');
}

/**
 * A shape element (epic Tale Studio R6): a rectangle, an ellipse or a line built from its checked
 * values through CSSOM only (AD-16), never from SVG or CSS text. A rectangle and an ellipse are
 * the box itself, filled and stroked inside its edges; a line is a bar of its stroke width across
 * the middle of the box, turning with it. Lengths are fractions of the canvas height (`cqh`). A
 * shape is decorative unless it has a label. Null for an unknown shape.
 */
export function renderShape(element: DeliveryTaleElement): HTMLElement | null {
  const look = resolveShapeStyle(element.props);
  if (!look) return null;
  const node = document.createElement('div');
  node.className = 'ta-el ta-shape';
  const style = node.style;
  if (look.opacity < 1) style.opacity = String(look.opacity);
  if (look.shape === 'line') {
    const bar = document.createElement('div');
    bar.className = 'ta-stroke';
    if (look.stroke && look.strokeWidth > 0) {
      bar.style.height = `${look.strokeWidth * 100}cqh`;
      bar.style.backgroundColor = look.stroke;
    }
    node.appendChild(bar);
  } else {
    if (look.fill) style.backgroundColor = look.fill;
    if (look.stroke && look.strokeWidth > 0) style.border = `${look.strokeWidth * 100}cqh solid ${look.stroke}`;
    if (look.shape === 'ellipse') style.borderRadius = '50%';
    else if (look.radius > 0) style.borderRadius = `${look.radius * 100}cqh`;
  }
  name(node, labelOf(element));
  return node;
}

/**
 * An emoji sticker (epic Tale Studio R6): its emoji as one text node in the platform's emoji fonts
 * (no emoji images), sized to its box. With a label it is an image named by it, which is what a
 * screen reader announces; without one it stays text, which screen readers read by the emoji's
 * own name; decorative, it is hidden. Null without an emoji.
 */
export function renderEmoji(element: DeliveryTaleElement): HTMLElement | null {
  const raw = (element.props as { emoji?: unknown }).emoji;
  const emoji = typeof raw === 'string' ? [...cleanText(raw, LABEL_TEXT_RULE)].slice(0, MAX_EMOJI_LENGTH).join('') : '';
  if (!emoji.trim()) return null;
  const node = document.createElement('div');
  node.className = 'ta-el ta-emoji';
  node.textContent = emoji;
  node.style.fontFamily = EMOJI_FONT_STACK;
  node.style.fontSize = emojiFontSize(element.box);
  // Named, an image with its name; decorative, hidden; neither, plain text read by the emoji's own name.
  const label = labelOf(element);
  if (label || element.a11y?.decorative === true) name(node, label);
  return node;
}
