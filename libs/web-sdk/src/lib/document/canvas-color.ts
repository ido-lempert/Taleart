import type { DeliveryTaleDocument } from '@taleart/contract';

/** The document's canvas colour when it is a valid `#RRGGBB` or `#RRGGBBAA`, else null. */
export function canvasColor(doc: DeliveryTaleDocument): string | null {
  const color = doc.canvas?.background?.color;
  return typeof color === 'string' && /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : null;
}
