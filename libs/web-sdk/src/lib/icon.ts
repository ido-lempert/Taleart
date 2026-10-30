// The SVG icons the SDK draws into its buttons. Shared by the bar, the banner and the viewer, which
// loads on first open (see viewer-loader.ts), so it lives here and not in the viewer.

/** Draws the icon `path` (an SVG path in a 24 × 24 box) into `button`, replacing its content. */
export function setIcon(button: HTMLElement, path: string): void {
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
}
