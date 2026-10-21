import {
  cleanText,
  ELEMENT_TEXT_RULE,
  resolveTextStyle,
  TEXT_BOX_PADDING_EM,
  TEXT_HIGHLIGHT_PADDING_EM,
  TEXT_WEIGHTS,
  textFontFamily,
  type DeliveryTaleElement,
} from '@taleart/contract';

/**
 * A text element (epic Tale Studio R4): its plain text as one text node, so it is selectable, read
 * by screen readers and sharp at any size. Never parsed as HTML (AD-16); a line feed starts a new
 * line, and characters the contract does not allow in text (control characters, lone surrogates,
 * bidi overrides) are stripped, should a document hold any. The paragraph is the element's box and
 * lets taps through; only the text itself, in an inline span, takes pointer events and selection,
 * so a tap on the empty part of the box still steps the viewer. Null when the props hold no text.
 *
 * Its style (story 7.4) comes from `resolveTextStyle`, which checks every value again and falls
 * back to the default for one that fails, and reaches the DOM through CSSOM properties only: the
 * font (a registry stack, the theme's `--ta-font` or a checked font-family list, each ending in
 * the fallback stack; no font file is loaded), the size as a fraction of the canvas height, the
 * weight, italic, colour, line height, logical alignment (`start` and `end` follow the
 * direction), a solid box on the paragraph or a highlight behind each line of the glyphs, and the
 * direction as the `dir` attribute (`auto` by default, so a Hebrew line reads right to left).
 */
export function renderText(element: DeliveryTaleElement): HTMLElement | null {
  const raw = (element.props as { text?: unknown }).text;
  const text = typeof raw === 'string' ? cleanText(raw, ELEMENT_TEXT_RULE) : '';
  if (text === '') return null;
  const look = resolveTextStyle(element.props);
  const node = document.createElement('p');
  node.className = 'ta-el ta-text';
  node.dir = look.direction;
  const glyphs = document.createElement('span');
  glyphs.className = 'ta-glyphs';
  glyphs.textContent = text;
  // A block line inside the column, so the glyphs stay inline and a highlight follows each line.
  const line = document.createElement('span');
  line.className = 'ta-line';
  line.appendChild(glyphs);
  node.appendChild(line);
  const style = node.style;
  style.fontFamily = textFontFamily(look);
  style.fontSize = `${look.size * 100}cqh`;
  style.lineHeight = String(look.lineHeight);
  style.fontWeight = String(TEXT_WEIGHTS[look.weight]);
  style.fontStyle = look.italic ? 'italic' : 'normal';
  style.color = look.color;
  style.textAlign = look.align;
  if (look.background === 'box') {
    style.backgroundColor = look.backgroundColor;
    style.paddingInline = `${TEXT_BOX_PADDING_EM}em`;
  } else if (look.background === 'highlight') {
    glyphs.classList.add('ta-hl');
    glyphs.style.backgroundColor = look.backgroundColor;
    glyphs.style.paddingInline = `${TEXT_HIGHLIGHT_PADDING_EM}em`;
  }
  return node;
}
