import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { DEFAULT_SDK_BUILDS_KEPT, pinnedSdkScriptTag, type InstallInfo } from '@taleart/contract/core';

/** What each Copy button copies, and what it announces. */
type Copied = 'url' | 'integrity' | 'tag';

const COPIED: Record<Copied, string> = {
  url: 'Pinned URL copied',
  integrity: 'Integrity copied',
  tag: 'Pinned script tag copied',
};

/**
 * The Install tab's pinned SDK (story 8.21): the current build's URL pinned to its content and its
 * Subresource Integrity value, each with a Copy button, and the script tag with both. The API keeps
 * the last builds at their pinned URLs ({@link DEFAULT_SDK_BUILDS_KEPT} unless the server sets
 * SDK_BUILDS_KEPT), so a pinned page keeps working through the next releases.
 */
@Component({
  selector: 'app-pinned-sdk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .pinned {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .pinned-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .pinned-row .input {
      flex: 1 1 16rem;
      min-width: 0;
    }
  `,
  template: `
    <section class="card section zone-section" aria-labelledby="pinned-sdk-title">
      <div class="section__header">
        <h3 class="section__title" id="pinned-sdk-title">Pin this SDK version (optional)</h3>
      </div>
      @if (pinned(); as p) {
        <div class="pinned">
          <p class="muted" id="pinned-sdk-hint">
            For a page that wants the browser to refuse any other file: load the SDK from this URL with its integrity
            value. It always serves this build. TaleArt keeps the last {{ kept }} builds at their pinned URLs (unless your
            server sets another number), so a pinned page keeps working through the next {{ kept - 1 }} releases: update
            the pin before then.
          </p>
          <div class="field">
            <label class="field__label" for="pinned-sdk-url">Pinned URL</label>
            <div class="pinned-row">
              <input
                id="pinned-sdk-url"
                class="input input--mono"
                readonly
                spellcheck="false"
                [value]="p.url"
                aria-describedby="pinned-sdk-hint"
                (focus)="selectAll($event)"
              />
              <button type="button" class="btn btn--secondary btn--sm" id="pinned-sdk-copy-url" (click)="copy('url', p.url)">
                Copy URL
              </button>
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="pinned-sdk-integrity">Integrity</label>
            <div class="pinned-row">
              <input
                id="pinned-sdk-integrity"
                class="input input--mono"
                readonly
                spellcheck="false"
                [value]="p.integrity"
                (focus)="selectAll($event)"
              />
              <button
                type="button"
                class="btn btn--secondary btn--sm"
                id="pinned-sdk-copy-integrity"
                (click)="copy('integrity', p.integrity)"
              >
                Copy integrity
              </button>
            </div>
          </div>
          <div class="pinned-row">
            <button type="button" class="btn btn--secondary btn--sm" id="pinned-sdk-copy-tag" (click)="copy('tag', p.tag)">
              Copy pinned script tag
            </button>
            <span class="muted">Use it in place of the snippet's script tag.</span>
          </div>
        </div>
      } @else {
        <p class="muted">This server has no Web SDK build, so there is no pinned URL.</p>
      }
      <p class="visually-hidden" role="status">{{ status() }}</p>
    </section>
  `,
})
export class PinnedSdk {
  /** What `GET /install` answered. */
  readonly install = input.required<InstallInfo>();

  protected readonly kept = DEFAULT_SDK_BUILDS_KEPT;
  protected readonly status = signal('');

  /** The pinned URL, its integrity and the script tag with both; null without a bundle. */
  protected pinned(): { url: string; integrity: string; tag: string } | null {
    const info = this.install();
    const tag = pinnedSdkScriptTag(info);
    return tag && info.sdkPinnedUrl && info.sdkIntegrity ? { url: info.sdkPinnedUrl, integrity: info.sdkIntegrity, tag } : null;
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected async copy(what: Copied, text: string): Promise<void> {
    // Cleared first, so copying twice announces again.
    this.status.set('');
    try {
      await navigator.clipboard.writeText(text);
      this.status.set(COPIED[what]);
    } catch {
      this.status.set('Could not copy. Select the text and copy it.');
    }
  }
}
