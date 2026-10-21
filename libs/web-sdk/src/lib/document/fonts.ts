import { isFontWeight, loadProjectFont, type DeliveryTale } from '@taleart/contract';

// An absolute http(s) URL, as the Delivery API builds them; anything else is not fetched.
function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Starts loading the project fonts a tale's text uses (epic Tale Studio R18, AD-16), as the viewer
 * shows that tale: never for first zone content, never for a tale that is not open. Each face is
 * fetched once per page from its public URL and registered from its bytes under its internal alias
 * (`FontFace` + `document.fonts.add`, no CSS text), so its text, drawn in the fallback stack until
 * then, swaps to it; a face that fails or takes over 3 s is dropped and the fallback stays.
 */
export function loadTaleFonts(tale: DeliveryTale): void {
  if (!tale.document || !Array.isArray(tale.fonts)) return;
  for (const font of tale.fonts) {
    if (!isHttpUrl(font?.url)) continue;
    void loadProjectFont({
      id: font.id,
      url: font.url,
      weight: isFontWeight(font.weight) ? font.weight : 400,
      style: font.style === 'italic' ? 'italic' : 'normal',
    });
  }
}
