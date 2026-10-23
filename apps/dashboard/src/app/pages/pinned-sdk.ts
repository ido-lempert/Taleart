import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { pinnedSdkScriptTag, type InstallInfo } from '@taleart/contract/core';

// Long enough for a screen reader to see the status emptied before the new text arrives.
const ANNOUNCE_DELAY_MS = 100;

/** What each Copy button copies, and what it announces. */
type Copied = 'url' | 'integrity' | 'tag';

const COPIED: Record<Copied, string> = {
  url: 'Pinned URL copied',
  integrity: 'Integrity copied',
  tag: 'Pinned script tag copied',
};

/**
 * The Install tab's pinned SDK (story 8.21): the current build's URL pinned to its content and its
 * Subresource Integrity value, each with a Copy button, and the script tag with both. It says how
 * long the URL keeps working from `sdkBuildsKept`, the number of SDK builds this server keeps.
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
    /*
     * The pinned URL and the integrity value wrap anywhere, growing to their content, so nothing is
     * cut at 320 px (WCAG 2.2 SC 1.4.10, story 8.19 review): read-only text areas, not one-line inputs.
     */
    .pinned-value {
      field-sizing: content;
      padding-block: var(--space-2);
      line-height: 1.4;
      resize: none;
      overflow-wrap: anywhere;
      word-break: break-all;
      white-space: pre-wrap;
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
            value. It always serves this build.
            @if (kept() > 1) {
              This server keeps the last {{ kept() }} SDK builds it served at their pinned URLs, this one included, so
              this URL keeps working through the next {{ kept() - 1 }} SDK
              {{ kept() === 2 ? 'build' : 'builds' }} this server serves: update the pin before then.
            } @else {
              This server keeps only its current SDK build, so this URL stops working at the next SDK build.
            }
          </p>
          <div class="field">
            <label class="field__label" for="pinned-sdk-url">Pinned URL</label>
            <div class="pinned-row">
              <textarea
                id="pinned-sdk-url"
                class="input input--mono pinned-value"
                rows="2"
                readonly
                spellcheck="false"
                [value]="p.url"
                aria-describedby="pinned-sdk-hint"
                (focus)="selectAll($event)"
              ></textarea>
              <button type="button" class="btn btn--secondary btn--sm" id="pinned-sdk-copy-url" (click)="copy('url', p.url)">
                Copy URL
              </button>
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="pinned-sdk-integrity">Integrity</label>
            <div class="pinned-row">
              <textarea
                id="pinned-sdk-integrity"
                class="input input--mono pinned-value"
                rows="2"
                readonly
                spellcheck="false"
                [value]="p.integrity"
                aria-describedby="pinned-sdk-hint"
                (focus)="selectAll($event)"
              ></textarea>
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

  /** How many SDK builds this server keeps at their pinned URLs (1: only the current one). */
  protected readonly kept = computed(() => {
    const kept = this.install().sdkBuildsKept;
    // An older API does not say: it kept only the current build.
    return Number.isInteger(kept) && kept >= 1 ? kept : 1;
  });
  protected readonly status = signal('');

  /** The pinned URL, its integrity and the script tag with both; null without a bundle. */
  protected pinned(): { url: string; integrity: string; tag: string } | null {
    const info = this.install();
    const tag = pinnedSdkScriptTag(info);
    return tag && info.sdkPinnedUrl && info.sdkIntegrity ? { url: info.sdkPinnedUrl, integrity: info.sdkIntegrity, tag } : null;
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement | HTMLTextAreaElement).select();
  }

  protected async copy(what: Copied, text: string): Promise<void> {
    // Cleared first and set after a tick, so the same copy twice is announced twice.
    this.status.set('');
    let said: string;
    try {
      await navigator.clipboard.writeText(text);
      said = COPIED[what];
    } catch {
      said = 'Could not copy. Select the text and copy it.';
    }
    await new Promise((resolve) => setTimeout(resolve, ANNOUNCE_DELAY_MS));
    this.status.set(said);
  }
}
