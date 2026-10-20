import { defineTaleartElement, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';

describe('TaleartElement', () => {
  it('registers the custom element', () => {
    defineTaleartElement();
    expect(customElements.get(TALEART_ELEMENT_TAG)).toBe(TaleartElement);
  });
});
