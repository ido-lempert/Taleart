import { COPIED_MS, copyText, enhanceCodeBlocks, enhanceFigures, languageOf, Lightbox } from './article-enhancements';

/** jsdom has no <dialog> methods: the lightbox's calls are backed by the open attribute and a close event. */
function dialogShim(): void {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void };
  if (typeof proto.showModal === 'function') return;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  (proto as unknown as { close: () => void }).close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

/** Lets the promise chains of a click run (the clipboard and the status update). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function article(html: string): HTMLElement {
  const main = document.createElement('main');
  main.id = 'main';
  main.innerHTML = `<div class="article">${html}</div>`;
  document.body.append(main);
  return main;
}

const SNIPPET = `<pre tabindex="0" role="region" aria-label="Script tag"><code class="language-html">&lt;script&gt;1&lt;/script&gt;</code></pre>`;

describe('code blocks', () => {
  let main: HTMLElement;

  beforeAll(dialogShim);

  beforeEach(() => {
    vi.useFakeTimers();
    main = article(SNIPPET + `<pre><code>plain</code></pre>` + `<pre class="no-code">not a code block</pre>`);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    main.remove();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('wraps each pre > code in a block with its language and a Copy button, and keeps the pre attributes', () => {
    enhanceCodeBlocks(main, document);
    const blocks = [...main.querySelectorAll('.code-block')];
    expect(blocks.length).toBe(2);
    expect(blocks[0].querySelector('.code-block__lang')?.textContent).toBe('html');
    expect(blocks[1].querySelector('.code-block__lang')?.textContent).toBe('text');
    const button = blocks[0].querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Copy code');
    expect(button?.textContent).toBe('Copy');
    const pre = blocks[0].querySelector('pre');
    expect(pre?.getAttribute('tabindex')).toBe('0');
    expect(pre?.getAttribute('role')).toBe('region');
    expect(pre?.getAttribute('aria-label')).toBe('Script tag');
    expect(main.querySelector('.no-code')?.closest('.code-block')).toBeNull();
  });

  it('does nothing the second time: no block is wrapped twice, no button is added', () => {
    enhanceCodeBlocks(main, document);
    enhanceCodeBlocks(main, document);
    expect(main.querySelectorAll('.code-block').length).toBe(2);
    expect(main.querySelectorAll('.code-block__copy').length).toBe(2);
    expect(main.querySelectorAll('.code-block pre .code-block').length).toBe(0);
  });

  it('leaves the Swagger UI blocks of the API reference alone', () => {
    const api = article(`<div class="api-reference"><pre><code>curl</code></pre></div>`);
    enhanceCodeBlocks(api, document);
    expect(api.querySelector('.code-block')).toBeNull();
    api.remove();
  });

  it('copies the code text and says "Copied" for two seconds', async () => {
    enhanceCodeBlocks(main, document);
    const block = main.querySelector('.code-block') as HTMLElement;
    (block.querySelector('button') as HTMLButtonElement).click();
    await flush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('<script>1</script>');
    const status = block.querySelector('[role=status]') as HTMLElement;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Copied');
    vi.advanceTimersByTime(COPIED_MS - 1);
    expect(status.textContent).toBe('Copied');
    vi.advanceTimersByTime(1);
    expect(status.textContent).toBe('');
  });

  it('falls back to a hidden textarea when the Clipboard API refuses', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    enhanceCodeBlocks(main, document);
    const block = main.querySelector('.code-block') as HTMLElement;
    (block.querySelector('button') as HTMLButtonElement).click();
    await flush();
    expect(exec).toHaveBeenCalledWith('copy');
    expect((block.querySelector('[role=status]') as HTMLElement).textContent).toBe('Copied');
    expect(document.querySelector('textarea')).toBeNull();
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('says "Copy failed" when neither way copies', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    enhanceCodeBlocks(main, document);
    const block = main.querySelector('.code-block') as HTMLElement;
    (block.querySelector('button') as HTMLButtonElement).click();
    await flush();
    const status = block.querySelector('[role=status]') as HTMLElement;
    expect(status.textContent).toBe('Copy failed');
    expect(status.classList.contains('is-error')).toBe(true);
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('copyText resolves to false when the copy throws', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        throw new Error('no');
      },
    });
    await expect(copyText('x', document)).resolves.toBe(false);
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('reads the language from a language- class, or says text', () => {
    const code = document.createElement('code');
    code.className = 'hljs language-typescript';
    expect(languageOf(code)).toBe('typescript');
    expect(languageOf(document.createElement('code'))).toBe('text');
  });
});

describe('figures and the lightbox', () => {
  let main: HTMLElement;
  let lightbox: Lightbox;

  beforeAll(dialogShim);

  beforeEach(() => {
    main = article(
      `<figure><img src="images/a.png" alt="A diagram" width="640" height="320" /><figcaption>The caption.</figcaption></figure>` +
        `<figure><img src="images/b.svg" alt="" width="10" height="10" /></figure>`,
    );
    lightbox = new Lightbox(document);
  });

  afterEach(() => {
    main.remove();
    document.querySelector('dialog.lightbox')?.remove();
  });

  it('wraps each figure image in a labelled button, once, keeping its size attributes', () => {
    enhanceFigures(main, document, () => lightbox);
    enhanceFigures(main, document, () => lightbox);
    const buttons = [...main.querySelectorAll<HTMLButtonElement>('.figure-zoom')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Enlarge image: A diagram', 'Enlarge image']);
    const img = buttons[0].querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('640');
    expect(img.getAttribute('height')).toBe('320');
    expect(main.querySelectorAll('figure .figure-zoom img').length).toBe(2);
  });

  it('opens the image in a dialog with its caption, and returns the focus to the button on close', () => {
    enhanceFigures(main, document, () => lightbox);
    const button = main.querySelector('.figure-zoom') as HTMLButtonElement;
    button.focus();
    button.click();
    const dialog = document.querySelector('dialog.lightbox') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect((dialog.querySelector('img') as HTMLImageElement).getAttribute('src')).toMatch(/images\/a\.png$/);
    expect(dialog.querySelector('figcaption')?.textContent).toBe('The caption.');
    expect(document.activeElement?.textContent).toBe('Close');
    (dialog.querySelector('button') as HTMLButtonElement).click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('closes on a click on the backdrop (the dialog itself), not on the figure', () => {
    enhanceFigures(main, document, () => lightbox);
    (main.querySelectorAll('.figure-zoom')[1] as HTMLButtonElement).click();
    const dialog = document.querySelector('dialog.lightbox') as HTMLDialogElement;
    (dialog.querySelector('img') as HTMLImageElement).click();
    expect(dialog.open).toBe(true);
    dialog.click();
    expect(dialog.open).toBe(false);
    expect(dialog.querySelector('figcaption')?.hasAttribute('hidden')).toBe(true);
  });

  it('is reused for every image: one dialog on the page', () => {
    enhanceFigures(main, document, () => lightbox);
    (main.querySelectorAll('.figure-zoom')[0] as HTMLButtonElement).click();
    (document.querySelector('dialog.lightbox button') as HTMLButtonElement).click();
    (main.querySelectorAll('.figure-zoom')[1] as HTMLButtonElement).click();
    expect(document.querySelectorAll('dialog.lightbox').length).toBe(1);
  });
});
