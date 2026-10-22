import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { isErrorBody, type IssuedSiteKey, type SiteKeyInfo } from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';

/** What the drawer is about to do. */
export type SiteKeyAction = 'issue' | 'rotate' | 'revoke';

const HEADINGS: Record<SiteKeyAction, string> = {
  issue: 'Issue site key',
  rotate: 'Rotate site key',
  revoke: 'Revoke site key',
};

// The API's own message when it sent the standard error body, else the fallback.
function refusal(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse && err.status === 0) return `${fallback} Check the connection.`;
  return err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
}

/**
 * The project's site key on the zone page (epic UX rework R3), until the Install tab (story 13):
 * its prefix and date for everyone with access, and Issue, Rotate and Revoke for admins in a drawer.
 * A new key is shown once there. Rotating and revoking affect every zone of the project, which the
 * drawer says. Each change reads the dashboard again, since it changes whether zones are installed.
 */
@Component({
  selector: 'app-site-key-card',
  imports: [Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .site-key__snippet {
      overflow-wrap: anywhere;
    }
    /* Muted text on the code's sunken background is under 4.5:1. */
    .site-key__snippet code {
      color: var(--text);
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
    .key-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
  template: `
    <section class="card section zone-section" aria-labelledby="site-key-title">
      <div class="section__header">
        <h3 class="section__title" id="site-key-title">Site key</h3>
        @if (admin() && loaded()) {
          <div class="key-actions">
            @if (info()) {
              <button type="button" class="btn btn--secondary btn--sm" id="site-key-rotate" (click)="open('rotate', $event)">
                Rotate
              </button>
              <button type="button" class="btn btn--secondary btn--sm" id="site-key-revoke" (click)="open('revoke', $event)">
                Revoke
              </button>
            } @else {
              <button type="button" class="btn btn--secondary btn--sm" id="site-key-issue" (click)="open('issue', $event)">
                Issue site key
              </button>
            }
          </div>
        }
      </div>
      <p class="muted site-key__snippet">
        One key for every zone of this project. Place this zone with
        <code class="key-prefix">&lt;taleart-view site-key="…" zone="{{ zoneSlug() }}"&gt;</code>.
      </p>
      @if (info(); as key) {
        <dl class="key-info">
          <div>
            <dt class="visually-hidden">Site key</dt>
            <dd><code class="key-prefix">{{ key.prefix }}…</code></dd>
          </div>
          <div>
            <dt class="visually-hidden">Issued</dt>
            <dd class="muted">Issued {{ issuedDate(key.createdAt) }}</dd>
          </div>
        </dl>
      } @else if (loaded()) {
        <p class="muted">
          @if (admin()) {
            No site key yet. Issue one so SDKs on your pages can read this project's zones.
          } @else {
            No site key yet. Ask an admin to issue one so SDKs on your pages can read this project's zones.
          }
        </p>
      }
      <p class="visually-hidden" role="status">{{ announcement() }}</p>
    </section>

    @if (action(); as current) {
      <app-drawer [heading]="heading(current)" [returnFocus]="returnFocus" [busy]="saving()" (closed)="close()">
        <form class="drawer__form" (submit)="submit($event)" novalidate>
          <div class="drawer__body">
            @if (issued(); as key) {
              <div class="field">
                <label class="field__label" for="site-key-value">Site key</label>
                <input
                  id="site-key-value"
                  class="input input--mono"
                  name="siteKey"
                  readonly
                  spellcheck="false"
                  [value]="key.key"
                  aria-describedby="site-key-hint"
                  (focus)="selectAll($event)"
                />
                <p class="field__hint" id="site-key-hint">
                  Shown only now. Copy it into your pages; TaleArt keeps only a hash and cannot show it again.
                </p>
              </div>
              <div class="invite-actions">
                <button type="button" class="btn btn--primary" (click)="copy(key)">Copy key</button>
              </div>
              <p class="muted" role="status">{{ copyStatus() }}</p>
            } @else {
              @switch (current) {
                @case ('rotate') {
                  <p>
                    A new site key replaces <code class="key-prefix">{{ info()?.prefix }}…</code>.
                    <strong>This affects every zone of this project:</strong> the current key stops working at once on
                    every page that uses it, so update all of them.
                  </p>
                }
                @case ('revoke') {
                  <p>
                    Revoke <code class="key-prefix">{{ info()?.prefix }}…</code>?
                    <strong>This affects every zone of this project:</strong> it stops working at once, and zones
                    without a zone key of their own show nothing on your pages until you issue a new site key.
                  </p>
                }
                @default {
                  <p>
                    SDKs on your pages send this key, with a zone's slug, to read that zone's content. It is shown
                    once, when you issue it.
                  </p>
                  <p id="site-key-exposure">
                    <strong>It opens every zone of this project.</strong> The key sits in your pages' HTML, so anyone
                    who sees it can read every zone of this project that has a display and visible content, by its
                    slug, and slugs are often guessable (such as "home").
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
              <button type="submit" class="btn btn--primary" id="site-key-submit" [disabled]="saving()">
                {{ current === 'revoke' ? 'Revoke key' : current === 'rotate' ? 'Rotate key' : 'Issue key' }}
              </button>
            }
          </div>
        </form>
      </app-drawer>
    }
  `,
})
export class SiteKeyCard {
  private readonly http = inject(HttpClient);
  private readonly store = inject(DashboardStore);

  /** The zone's project, whose site key this is. */
  readonly projectId = input.required<string>();
  /** The zone's slug, shown in the snippet. */
  readonly zoneSlug = input.required<string>();
  /** Admins issue, rotate and revoke; everyone else only sees the prefix and date. */
  readonly admin = input(false);

  protected readonly info = signal<SiteKeyInfo | null>(null);
  protected readonly loaded = signal(false);
  protected readonly action = signal<SiteKeyAction | null>(null);
  protected readonly issued = signal<IssuedSiteKey | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly copyStatus = signal('');
  protected readonly announcement = signal('');
  protected returnFocus: HTMLElement | null = null;
  // Bumped per read, so an older answer for another project writes nothing.
  private reads = 0;

  constructor() {
    effect(() => void this.read(this.projectId()));
  }

  private async read(projectId: string): Promise<void> {
    const run = ++this.reads;
    this.loaded.set(false);
    try {
      const info = await firstValueFrom(
        this.http.get<SiteKeyInfo | null>(`${API_BASE}/projects/${encodeURIComponent(projectId)}/site-key`),
      );
      if (run !== this.reads) return;
      this.info.set(info);
    } catch {
      if (run !== this.reads) return;
      this.info.set(null);
    }
    this.loaded.set(true);
  }

  protected heading(action: SiteKeyAction): string {
    return HEADINGS[action];
  }

  protected issuedDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected open(action: SiteKeyAction, event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.issued.set(null);
    this.error.set('');
    this.copyStatus.set('');
    this.action.set(action);
  }

  protected close(): void {
    if (this.saving()) return;
    // The button that opened the drawer may be gone (Issue becomes Rotate): focus the card's first action.
    if (this.returnFocus && !this.returnFocus.isConnected) {
      this.returnFocus = document.querySelector<HTMLElement>('#site-key-rotate, #site-key-issue');
    }
    this.action.set(null);
    this.issued.set(null);
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected async copy(key: IssuedSiteKey): Promise<void> {
    try {
      await navigator.clipboard.writeText(key.key);
      this.copyStatus.set('Key copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the key and copy it.');
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const action = this.action();
    // Once the key is shown, Enter must not issue another one.
    if (!action || this.saving() || this.issued()) return;
    this.saving.set(true);
    this.error.set('');
    const url = `${API_BASE}/projects/${encodeURIComponent(this.projectId())}/site-key`;
    try {
      if (action === 'revoke') {
        await firstValueFrom(this.http.delete<void>(url));
        this.info.set(null);
        this.saving.set(false);
        this.announcement.set('Site key revoked.');
        this.close();
      } else {
        // Issue and rotate are one call: issuing while a key is active rotates it.
        const key = await firstValueFrom(this.http.post<IssuedSiteKey>(url, {}));
        this.info.set({ prefix: key.prefix, createdAt: key.createdAt });
        this.issued.set(key);
        this.saving.set(false);
        this.announcement.set(action === 'rotate' ? 'Site key rotated.' : 'Site key issued.');
      }
    } catch (err) {
      this.saving.set(false);
      const fallback = action === 'revoke' ? 'The site key was not revoked. Try again.' : 'The site key was not issued. Try again.';
      this.error.set(refusal(err, fallback));
      return;
    }
    // Whether zones are installed changed (epic UX rework R7): read their visibility again.
    void this.store.refresh();
  }
}
