import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import {
  installSnippet,
  isErrorBody,
  npmSnippet,
  testPageLink,
  ZONE_KEY_PLACEHOLDER,
  type InstallInfo,
  type IssuedZoneKey,
  type ZoneKeyInfo,
} from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';
import { PinnedSdk } from './pinned-sdk';

/** What the drawer is about to do. */
export type ZoneKeyAction = 'issue' | 'rotate' | 'revoke';

const HEADINGS: Record<ZoneKeyAction, string> = {
  issue: 'Issue zone key',
  rotate: 'Rotate zone key',
  revoke: 'Revoke zone key',
};

// The API's own message when it sent the standard error body, else the fallback.
function refusal(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse && err.status === 0) return `${fallback} Check the connection.`;
  return err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
}

/**
 * The zone page's Install tab (zone keys, the Web SDK's `zone-key` attribute): the zone's own key
 * (its prefix and date for everyone with access; Issue, Rotate and Revoke for admins in a drawer),
 * and the copy-ready snippet with the key, the npm variant and "Open test page". A new key is shown
 * once, in the drawer, where the snippet and the test page link carry it; anywhere else the snippet
 * says {@link ZONE_KEY_PLACEHOLDER} and the test page asks for the key. Only this zone is affected.
 * Each change reads the dashboard again, since it changes whether the zone is installed.
 */
@Component({
  selector: 'app-zone-key-card',
  imports: [Drawer, PinnedSdk],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .key-info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-4);
      margin: 0;
    }
    .key-info dd {
      margin: 0;
    }
    .key-actions,
    .snippet-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .snippet {
      margin: 0;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      background: var(--surface-sunken);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: var(--text-sm);
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      /* Muted text on the sunken background is under 4.5:1. */
      color: var(--text);
    }
    .drawer-snippet {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
  `,
  template: `
    <section class="card section zone-section" aria-labelledby="zone-key-title">
      <div class="section__header">
        <h3 class="section__title" id="zone-key-title" tabindex="-1">Zone key</h3>
        @if (admin() && loaded() && !readFailed()) {
          <div class="key-actions">
            @if (info()) {
              <button type="button" class="btn btn--secondary btn--sm" id="zone-key-rotate" (click)="open('rotate', $event)">
                Rotate
              </button>
              <button type="button" class="btn btn--secondary btn--sm" id="zone-key-revoke" (click)="open('revoke', $event)">
                Revoke
              </button>
            } @else {
              <button type="button" class="btn btn--primary btn--sm" id="zone-key-issue" (click)="open('issue', $event)">
                Issue zone key
              </button>
            }
          </div>
        }
      </div>
      <p class="muted">One key for this zone. Your page sends it to show this zone; it names the zone, so no slug is needed.</p>
      @if (info(); as key) {
        <dl class="key-info">
          <div>
            <dt class="visually-hidden">Zone key</dt>
            <dd><code class="key-prefix">{{ key.prefix }}…</code></dd>
          </div>
          <div>
            <dt class="visually-hidden">Issued</dt>
            <dd class="muted">Issued {{ issuedDate(key.createdAt) }}</dd>
          </div>
        </dl>
      } @else if (readFailed()) {
        <!-- Never Issue on a failed read: a key may be active, and issuing would replace it. -->
        <div class="key-actions" role="alert">
          <p class="form-error">The zone key could not be read.</p>
          <button type="button" class="btn btn--secondary btn--sm" id="zone-key-retry" (click)="retry()">Retry</button>
        </div>
      } @else if (loaded()) {
        <p class="muted">
          @if (admin()) {
            No zone key yet. Issue one so this zone shows on your page. It is shown once, when you issue it.
          } @else {
            No zone key yet. Ask an admin to issue one so this zone shows on your page.
          }
        </p>
        @if (admin()) {
          <!-- Said before issuing, since Issue issues at once. -->
          <p id="zone-key-exposure-tab">
            <strong>It opens this zone.</strong> The key sits in your page's HTML, so anyone who sees it can read this zone
            while it is visible.
          </p>
        }
      }
      <p class="visually-hidden" role="status">{{ announcement() }}</p>
    </section>

    <section class="card section zone-section" aria-labelledby="snippet-title">
      <div class="section__header">
        <h3 class="section__title" id="snippet-title">Snippet</h3>
      </div>
      @if (install(); as urls) {
        <p class="muted" id="snippet-hint">
          Paste it into your page's HTML where the zone should show. Replace {{ placeholder }} with this zone's key: TaleArt
          shows a key only once, when it is issued. If you no longer have it, rotate the key.
        </p>
        <pre class="snippet" id="install-snippet" aria-describedby="snippet-hint"><code>{{ snippet(urls, null) }}</code></pre>
        <div class="snippet-actions">
          <button type="button" class="btn btn--secondary btn--sm" id="snippet-copy" (click)="copySnippet(urls, null)">
            Copy snippet
          </button>
          <a
            class="btn btn--secondary btn--sm"
            id="test-page-link"
            target="_blank"
            rel="noopener noreferrer"
            [href]="testPage(urls, null)"
          >
            Open test page<span class="visually-hidden"> (opens in a new tab)</span>
          </a>
        </div>
        <details class="npm-variant" id="npm-variant">
          <summary>Use the npm package instead</summary>
          <pre class="snippet" id="npm-snippet"><code>{{ npm(null) }}</code></pre>
          <div class="snippet-actions">
            <button type="button" class="btn btn--secondary btn--sm" id="npm-copy" (click)="copyNpm(null)">Copy npm snippet</button>
          </div>
        </details>
        <p class="muted">The test page asks for the zone key and shows this zone as your page will.</p>
      } @else if (installFailed()) {
        <p class="form-error" role="alert">The snippet could not be loaded. Reload the page to try again.</p>
      }
      <p class="visually-hidden" role="status">{{ snippetStatus() }}</p>
    </section>

    @if (install(); as urls) {
      <app-pinned-sdk [install]="urls" />
    }

    @if (action(); as current) {
      <app-drawer [heading]="heading(current)" [returnFocus]="returnFocus" [busy]="saving()" (closed)="close()">
        <form class="drawer__form" (submit)="submit($event)" novalidate>
          <div class="drawer__body">
            @if (issued(); as key) {
              <div class="field">
                <label class="field__label" for="zone-key-value">Zone key</label>
                <input
                  id="zone-key-value"
                  class="input input--mono"
                  name="zoneKey"
                  readonly
                  spellcheck="false"
                  [value]="key.key"
                  aria-describedby="zone-key-hint"
                  (focus)="selectAll($event)"
                />
                <p class="field__hint" id="zone-key-hint">
                  Shown only now. Copy it into your page; TaleArt keeps only a hash and cannot show it again.
                </p>
              </div>
              <div class="invite-actions">
                <button type="button" class="btn btn--secondary" (click)="copy(key)">Copy key</button>
              </div>
              @if (install(); as urls) {
                <div class="drawer-snippet">
                  <p class="field__label" id="issued-snippet-label">Snippet for this zone, with the key</p>
                  <pre class="snippet" id="issued-snippet" aria-labelledby="issued-snippet-label"><code>{{
                    snippet(urls, key.key)
                  }}</code></pre>
                  <div class="invite-actions">
                    <button type="button" class="btn btn--secondary" id="issued-snippet-copy" (click)="copySnippet(urls, key.key)">
                      Copy snippet
                    </button>
                    <a
                      class="btn btn--primary"
                      id="issued-test-page-link"
                      target="_blank"
                      rel="noopener noreferrer"
                      [href]="testPage(urls, key.key)"
                    >
                      Open test page<span class="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  </div>
                </div>
              }
              <p class="muted" role="status">{{ copyStatus() }}</p>
            } @else {
              @switch (current) {
                @case ('rotate') {
                  <p>
                    A new zone key replaces <code class="key-prefix">{{ info()?.prefix }}…</code>.
                    <strong>This affects this zone only:</strong> the current key stops working at once, so update the page
                    that uses it.
                  </p>
                }
                @case ('revoke') {
                  <p>
                    Revoke <code class="key-prefix">{{ info()?.prefix }}…</code>?
                    <strong>This affects this zone only:</strong> it stops working at once, and the zone shows nothing on your
                    pages until you issue a new zone key.
                  </p>
                }
                @default {
                  @if (saving()) {
                    <p>Issuing a zone key…</p>
                  }
                  <p>Your page sends this key to show this zone. It is shown once, when you issue it.</p>
                  <p id="zone-key-exposure">
                    <strong>It opens this zone.</strong> The key sits in your page's HTML, so anyone who sees it can read
                    this zone while it is visible.
                  </p>
                }
              }
            }
            @if (error()) {
              <p class="form-error" role="alert">{{ error() }}</p>
            }
          </div>
          <div class="drawer__footer">
            @if (issued()) {
              <button type="button" class="btn btn--primary" (click)="close()">Done</button>
            } @else {
              <button type="button" class="btn btn--secondary" [disabled]="saving()" (click)="close()">Cancel</button>
              <button type="submit" class="btn btn--primary" id="zone-key-submit" [disabled]="saving()">
                {{ current === 'revoke' ? 'Revoke key' : current === 'rotate' ? 'Rotate key' : 'Issue key' }}
              </button>
            }
          </div>
        </form>
      </app-drawer>
    }
  `,
})
export class ZoneKeyCard {
  private readonly http = inject(HttpClient);
  private readonly store = inject(DashboardStore);

  /** The zone whose key this is. */
  readonly zoneId = input.required<string>();
  /** Admins issue, rotate and revoke; everyone else only sees the prefix and date. */
  readonly admin = input(false);

  protected readonly placeholder = ZONE_KEY_PLACEHOLDER;
  protected readonly info = signal<ZoneKeyInfo | null>(null);
  protected readonly loaded = signal(false);
  /** True when the zone key could not be read: the tab offers Retry, never Issue. */
  protected readonly readFailed = signal(false);
  /** Where the SDK and the test page are (`GET /install`); null until read. */
  protected readonly install = signal<InstallInfo | null>(null);
  protected readonly installFailed = signal(false);
  protected readonly action = signal<ZoneKeyAction | null>(null);
  protected readonly issued = signal<IssuedZoneKey | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly copyStatus = signal('');
  protected readonly snippetStatus = signal('');
  protected readonly announcement = signal('');
  protected returnFocus: HTMLElement | null = null;
  // Bumped per read, so an older answer for another zone writes nothing.
  private reads = 0;
  // Bumped when the zone changes, so an answer for the first zone writes nothing here.
  private zoneRun = 0;

  /** The snippet, the npm variant and the test page link for this zone, with a key or the placeholder. */
  protected readonly snippet = (urls: InstallInfo, key: string | null) => installSnippet(urls, key);
  protected readonly npm = (key: string | null) => npmSnippet(key);
  protected readonly testPage = (urls: InstallInfo, key: string | null) => testPageLink(urls, key);

  constructor() {
    effect(() => {
      const zoneId = this.zoneId();
      untracked(() => {
        // The card stays when the zone page shows another zone (its route is reused, as on Back): a drawer
        // left open would rotate or revoke that zone's key. Close it and start over.
        this.zoneRun++;
        this.action.set(null);
        this.issued.set(null);
        this.saving.set(false);
        this.error.set('');
        this.copyStatus.set('');
        void this.read(zoneId);
      });
    });
    void this.readInstall();
  }

  private async readInstall(): Promise<void> {
    try {
      const info = await firstValueFrom(this.http.get<InstallInfo | null>(`${API_BASE}/install`));
      // Only a whole answer: a snippet with a missing URL would not work on any page.
      if (info && [info.apiUrl, info.sdkUrl, info.testPageUrl].every((url) => typeof url === 'string' && url)) {
        this.install.set(info);
        return;
      }
    } catch {
      // Said below.
    }
    this.installFailed.set(true);
  }

  protected retry(): void {
    void this.read(this.zoneId());
  }

  private async read(zoneId: string): Promise<void> {
    const run = ++this.reads;
    this.loaded.set(false);
    this.readFailed.set(false);
    try {
      const info = await firstValueFrom(this.http.get<ZoneKeyInfo | null>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/key`));
      if (run !== this.reads) return;
      this.info.set(info);
    } catch {
      if (run !== this.reads) return;
      this.info.set(null);
      this.readFailed.set(true);
    }
    this.loaded.set(true);
  }

  protected heading(action: ZoneKeyAction): string {
    return HEADINGS[action];
  }

  protected issuedDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /**
   * Opens the drawer. Rotate and revoke wait for their confirmation there. Issue (no key is active,
   * so nothing stops working) issues at once, after the tab said what the key opens; the drawer then
   * shows the key, or the refusal with "Issue key" to try again.
   */
  protected open(action: ZoneKeyAction, event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.issued.set(null);
    this.error.set('');
    this.copyStatus.set('');
    this.action.set(action);
    if (action === 'issue') void this.submit();
  }

  protected close(): void {
    if (this.saving()) return;
    // The button that opened the drawer may be gone (Issue becomes Rotate): focus the card's first action.
    if (this.returnFocus && !this.returnFocus.isConnected) {
      this.returnFocus = document.querySelector<HTMLElement>('#zone-key-rotate, #zone-key-issue');
    }
    this.action.set(null);
    this.issued.set(null);
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected async copy(key: IssuedZoneKey): Promise<void> {
    try {
      await navigator.clipboard.writeText(key.key);
      this.copyStatus.set('Key copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the key and copy it.');
    }
  }

  /** Copies the snippet; in the drawer (with the key) the drawer's status says so, else the tab's. */
  protected async copySnippet(urls: InstallInfo, key: string | null): Promise<void> {
    const say = key ? this.copyStatus : this.snippetStatus;
    // Cleared first, so copying twice announces again.
    say.set('');
    try {
      await navigator.clipboard.writeText(installSnippet(urls, key));
      say.set(key ? 'Snippet with the key copied' : 'Snippet copied');
    } catch {
      say.set('Could not copy. Select the snippet and copy it.');
    }
  }

  protected async copyNpm(key: string | null): Promise<void> {
    this.snippetStatus.set('');
    try {
      await navigator.clipboard.writeText(npmSnippet(key));
      this.snippetStatus.set('npm snippet copied');
    } catch {
      this.snippetStatus.set('Could not copy. Select the snippet and copy it.');
    }
  }

  protected async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    const action = this.action();
    // Once the key is shown, Enter must not issue another one.
    if (!action || this.saving() || this.issued()) return;
    this.saving.set(true);
    this.error.set('');
    const zoneId = this.zoneId();
    const url = `${API_BASE}/zones/${encodeURIComponent(zoneId)}/key`;
    const run = this.zoneRun;
    // The card now shows another zone: nothing of this answer belongs on it.
    const moved = () => run !== this.zoneRun;
    try {
      if (action === 'revoke') {
        await firstValueFrom(this.http.delete<void>(url));
        if (moved()) return void this.store.refresh();
        this.info.set(null);
        this.saving.set(false);
        this.announcement.set('Zone key revoked.');
        this.close();
      } else {
        // POST issues a key, and replaces the active one (rotation, after its confirmation).
        const key = await firstValueFrom(this.http.post<IssuedZoneKey>(url, {}));
        if (moved()) return void this.store.refresh();
        this.info.set({ prefix: key.prefix, createdAt: key.createdAt });
        this.issued.set(key);
        this.saving.set(false);
        this.announcement.set(action === 'rotate' ? 'Zone key rotated.' : 'Zone key issued.');
      }
    } catch (err) {
      if (moved()) return;
      this.saving.set(false);
      const fallback =
        action === 'revoke' ? 'The zone key was not revoked. Try again.' : 'The zone key was not issued. Try again.';
      this.error.set(refusal(err, fallback));
      // Nothing to revoke any more: read the zone again rather than show a stale key.
      if (action === 'revoke' && err instanceof HttpErrorResponse && err.status === 404) void this.read(zoneId);
      return;
    }
    // Whether the zone is installed changed (epic UX rework R7): read its visibility again.
    void this.store.refresh();
  }
}
