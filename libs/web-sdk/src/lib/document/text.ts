import { cleanText, ELEMENT_TEXT_RULE, TEXT_ELEMENT_STYLE, type DeliveryTaleElement } from '@taleart/contract';

/**
 * A text element (epic Tale Studio R4): its plain text as one text node, so it is selectable, read
 * by screen readers and sharp at any size. Never parsed as HTML (AD-16); a line feed starts a new
 * line, and characters the contract does not allow in text (control characters, lone surrogates,
 * bidi overrides) are stripped, should a document hold any. The paragraph is the element's box and
 * lets taps through; only the text itself, in an inline span, takes pointer events and selection,
 * so a tap on the empty part of the box still steps the viewer. Its look is the contract's default
 * text style, set through CSSOM, with the size a fraction of the canvas height. Null when the
 * props hold no text.
 */
export function renderText(element: DeliveryTaleElement): HTMLElement | null {
  const raw = (element.props as { text?: unknown }).text;
  const text = typeof raw === 'string' ? cleanText(raw, ELEMENT_TEXT_RULE) : '';
  if (text === '') return null;
  const node = document.createElement('p');
  node.className = 'ta-el ta-text';
  const glyphs = document.createElement('span');
  glyphs.className = 'ta-glyphs';
  glyphs.textContent = text;
  node.appendChild(glyphs);
  const style = node.style;
  style.fontSize = `${TEXT_ELEMENT_STYLE.fontSize * 100}cqh`;
  style.lineHeight = String(TEXT_ELEMENT_STYLE.lineHeight);
  style.fontWeight = String(TEXT_ELEMENT_STYLE.fontWeight);
  style.color = TEXT_ELEMENT_STYLE.color;
  style.fontFamily = TEXT_ELEMENT_STYLE.fontFamily;
  return node;
}
