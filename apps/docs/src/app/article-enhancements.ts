import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

/** How long "Copied" stays in a code block's status, in milliseconds. */
export const COPIED_MS = 2000;

/**
 * Copies text: the Clipboard API, or, where it is missing or refuses (an insecure page, a browser without it), a
 * hidden textarea and `execCommand('copy')`. Resolves to whether the text was copied.
 */
export async function copyText(text: string, doc: Document): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Refused (the permission, the focus): the textarea below may still copy.
    }
  }
  const field = doc.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  doc.body.append(field);
  field.select();
  try {
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/** The language of a code block, from its `language-xxx` class, or 'text'. */
export function languageOf(code: HTMLElement): string {
  return /(?:^|\s)language-([\w+#.-]+)/.exec(code.className)?.[1] ?? 'text';
}

/**
 * Wraps each code block of the article (`pre > code`) in a block with a header: the language and a Copy button.
 * The status beside the button is a live region: "Copied" for two seconds, or "Copy failed". The Swagger UI's own
 * blocks (the API reference) are left alone. Blocks already wrapped are skipped, so this can run again.
 */
export function enhanceCodeBlocks(root: ParentNode, doc: Document): void {
  const pres = [...root.querySelectorAll<HTMLPreElement>('.article pre')].filter(
    (pre) => pre.querySelector(':scope > code') && !pre.closest('.api-reference') && !pre.closest('.code-block'),
  );
  for (const pre of pres) {
    const code = pre.querySelector<HTMLElement>(':scope > code');
    if (!code) continue;
    const block = doc.createElement('div');
    block.className = 'code-block';
    const bar = doc.createElement('div');
    bar.className = 'code-block__bar';
    const language = doc.createElement('span');
    language.className = 'code-block__lang';
    language.textContent = languageOf(code);
    const status = doc.createElement('span');
    status.className = 'code-block__status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'code-block__copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code');
    bar.append(language, status, button);
    pre.replaceWith(block);
    block.append(bar, pre);

    let timer: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener('click', () => {
      void copyText(code.textContent ?? '', doc).then((ok) => {
        status.textContent = ok ? 'Copied' : 'Copy failed';
        status.classList.toggle('is-error', !ok);
        clearTimeout(timer);
        timer = setTimeout(() => {
          status.textContent = '';
          status.classList.remove('is-error');
        }, COPIED_MS);
      });
    });
  }
}

/** The enlarged image: one <dialog> for the page, filled with each image that is opened. */
export class Lightbox {
  private readonly dialog: HTMLDialogElement;
  private readonly image: HTMLImageElement;
  private readonly caption: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private opener: HTMLElement | null = null;

  constructor(private readonly doc: Document) {
    this.dialog = doc.createElement('dialog');
    this.dialog.className = 'lightbox';
    this.dialog.setAttribute('aria-label', 'Enlarged image');
    const figure = doc.createElement('figure');
    figure.className = 'lightbox__figure';
    this.closeButton = doc.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'lightbox__close';
    this.closeButton.textContent = 'Close';
    this.closeButton.setAttribute('aria-label', 'Close image');
    this.image = doc.createElement('img');
    this.image.className = 'lightbox__img';
    this.caption = doc.createElement('figcaption');
    figure.append(this.closeButton, this.image, this.caption);
    this.dialog.append(figure);
    this.closeButton.addEventListener('click', () => this.dialog.close());
    // A click on the dialog itself (not the figure) is a click on the backdrop.
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    // Escape, the button and the backdrop all close it; the focus goes back to the image that opened it.
    this.dialog.addEventListener('close', () => {
      const back = this.opener;
      this.opener = null;
      back?.focus({ preventScroll: true });
    });
  }

  show(item: { src: string; alt: string; caption: string; opener: HTMLElement }): void {
    this.opener = item.opener;
    this.image.src = item.src;
    this.image.alt = item.alt;
    this.caption.textContent = item.caption;
    this.caption.hidden = item.caption === '';
    if (!this.dialog.isConnected) this.doc.body.append(this.dialog);
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.closeButton.focus({ preventScroll: true });
  }
}

/**
 * Makes each image in a figure of the article enlargeable: wrapped in a button ("Enlarge image: <alt>") that opens
 * it in the lightbox. The image keeps its size attributes, so nothing moves.
 */
export function enhanceFigures(root: ParentNode, doc: Document, lightbox: () => Lightbox): void {
  const images = [...root.querySelectorAll<HTMLImageElement>('.article figure img')].filter(
    (img) => !img.closest('.api-reference') && !img.parentElement?.classList.contains('figure-zoom'),
  );
  for (const img of images) {
    const alt = img.alt.trim();
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'figure-zoom';
    button.setAttribute('aria-label', alt ? `Enlarge image: ${alt}` : 'Enlarge image');
    img.before(button);
    button.append(img);
    const caption = img.closest('figure')?.querySelector('figcaption')?.textContent?.trim() ?? '';
    button.addEventListener('click', () =>
      lightbox().show({ src: img.currentSrc || img.src, alt, caption, opener: button }),
    );
  }
}

/** The article's enhancements, applied to the page after each navigation (in the browser only). */
@Injectable({ providedIn: 'root' })
export class ArticleEnhancements {
  private readonly doc = inject(DOCUMENT);
  private lightbox: Lightbox | null = null;

  /** Adds the code headers and the figure zoom to the page's article. Safe to call again: nothing is added twice. */
  apply(): void {
    const main = this.doc.getElementById('main');
    if (!main) return;
    enhanceCodeBlocks(main, this.doc);
    enhanceFigures(main, this.doc, () => (this.lightbox ??= new Lightbox(this.doc)));
  }
}
