import { TEXT_ELEMENT_STYLE, type DeliveryTaleElement } from '@taleart/contract';

/**
 * A text element (epic Tale Studio R4): its plain text as one text node in a paragraph, so it is
 * selectable, read by screen readers and sharp at any size. Never parsed as HTML (AD-16); a line
 * feed starts a new line. Its look is the contract's default text style, set through CSSOM, with
 * the size a fraction of the canvas height. Null when the props hold no text.
 */
export function renderText(element: DeliveryTaleElement): HTMLElement | null {
  const text = (element.props as { text?: unknown }).text;
  if (typeof text !== 'string' || text === '') return null;
  const node = document.createElement('p');
  node.className = 'ta-el ta-text';
  node.textContent = text;
  const style = node.style;
  style.fontSize = `${TEXT_ELEMENT_STYLE.fontSize * 100}cqh`;
  style.lineHeight = String(TEXT_ELEMENT_STYLE.lineHeight);
  style.fontWeight = String(TEXT_ELEMENT_STYLE.fontWeight);
  style.color = TEXT_ELEMENT_STYLE.color;
  style.fontFamily = TEXT_ELEMENT_STYLE.fontFamily;
  return node;
}
