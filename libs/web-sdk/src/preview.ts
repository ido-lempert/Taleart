// The Tale Studio preview's entry point (epic Tale Studio R10, AD-16): the SDK's own viewer and
// document renderer, for the dashboard to mount on an unsaved document. A workspace entry point
// (`@taleart/web-sdk/preview`), not part of the published bundle: the host page's `index.js` does
// not include it, and importing it registers no custom element.
export {
  DEFAULT_PREVIEW_SIZE,
  PREVIEW_SIZES,
  previewDocument,
  TalePreview,
} from './lib/preview';
export type { PreviewSizeId, PreviewTale, TalePreviewOptions } from './lib/preview';
