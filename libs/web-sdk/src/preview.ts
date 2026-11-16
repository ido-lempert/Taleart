// The Tale Studio preview's entry point (epic Tale Studio R10, AD-16): the SDK's own viewer and document
// renderer, for the dashboard to mount on an unsaved document, and the SDK's own group rendering (the zone's bar or
// banner, then the viewer of its group) for a tale group. A workspace entry point (`@taleart/web-sdk/preview`), not
// part of the published bundle: the host page's `index.js` does not include it, and importing it registers no custom
// element.
export {
  DEFAULT_PREVIEW_SIZE,
  GroupPreview,
  PREVIEW_REDRAW_MS,
  PREVIEW_RESTART_MS,
  PREVIEW_SIZES,
  previewDocument,
  TalePreview,
} from './lib/preview';
export type { PreviewSizeId, PreviewTale, TalePreviewOptions } from './lib/preview';
