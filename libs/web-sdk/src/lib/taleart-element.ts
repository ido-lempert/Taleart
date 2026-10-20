export const TALEART_ELEMENT_TAG = 'taleart-view';

/**
 * `<taleart-view>` web component. Rendering logic is not implemented yet.
 */
export class TaleartElement extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  connectedCallback(): void {
    this.root.innerHTML = '<slot></slot>';
  }
}

export function defineTaleartElement(tag = TALEART_ELEMENT_TAG): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, TaleartElement);
  }
}
