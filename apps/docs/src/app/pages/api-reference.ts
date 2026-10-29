import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  InjectionToken,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../theme';
import {
  DEFAULT_API_URL,
  normalizeApiUrl,
  OPENAPI_ASSET,
  type OpenApiDocument,
  prepareSpec,
  readApiUrl,
  storeApiUrl,
  SWAGGER_UI,
} from './api-reference-spec';

/** The part of Swagger UI's instance the page uses. */
export interface SwaggerUiInstance {
  specActions: { updateSpec(spec: string): void };
  authActions: { logout(schemes: string[]): void };
}

/** Starts Swagger UI on an element with a prepared document. */
export type SwaggerUiStart = (host: HTMLElement, spec: OpenApiDocument) => SwaggerUiInstance;

/**
 * Loads what the page needs in the browser: the OpenAPI document and Swagger UI (its script and
 * styles are added to the page only now, so no other docs page and no main bundle carries them).
 * Tests replace it.
 */
export interface ApiReferenceLoader {
  document(): Promise<OpenApiDocument>;
  swaggerUi(): Promise<SwaggerUiStart>;
  /** Removes what {@link swaggerUi} added that would style other pages. */
  leave(): void;
}

interface SwaggerUiBundle {
  (config: Record<string, unknown>): SwaggerUiInstance;
  presets: { apis: unknown };
}

const STYLE_IDS = ['docs-swagger-ui-css', 'docs-swagger-ui-theme'];

function browserLoader(doc: Document): ApiReferenceLoader {
  const url = (path: string) => new URL(path, doc.baseURI).href;
  let script: Promise<SwaggerUiBundle> | null = null;

  function style(id: string, href: string, integrity?: string): void {
    if (doc.getElementById(id)) return;
    const link = doc.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = url(href);
    if (integrity) link.integrity = integrity;
    doc.head.append(link);
  }

  return {
    async document() {
      const res = await fetch(url(OPENAPI_ASSET));
      if (!res.ok) throw new Error(`${OPENAPI_ASSET}: ${res.status}`);
      return (await res.json()) as OpenApiDocument;
    },
    async swaggerUi() {
      style(STYLE_IDS[0], SWAGGER_UI.style, SWAGGER_UI.styleIntegrity);
      style(STYLE_IDS[1], SWAGGER_UI.theme);
      const win = doc.defaultView as (Window & { SwaggerUIBundle?: SwaggerUiBundle }) | null;
      script ??= win?.SwaggerUIBundle
        ? Promise.resolve(win.SwaggerUIBundle)
        : new Promise<SwaggerUiBundle>((resolve, reject) => {
            const el = doc.createElement('script');
            el.src = url(SWAGGER_UI.script);
            el.integrity = SWAGGER_UI.scriptIntegrity;
            el.onload = () =>
              win?.SwaggerUIBundle ? resolve(win.SwaggerUIBundle) : reject(new Error('no SwaggerUIBundle'));
            el.onerror = () => reject(new Error(`${SWAGGER_UI.script} did not load`));
            doc.head.append(el);
          });
      script.catch(() => (script = null));
      const bundle = await script;
      return (host, spec) =>
        bundle({
          domNode: host,
          spec,
          presets: [bundle.presets.apis],
          layout: 'BaseLayout',
          // Groups by tag in the document's order, collapsed; no deep links, which would rewrite the
          // docs' own URL.
          docExpansion: 'list',
          deepLinking: false,
          defaultModelsExpandDepth: 0,
          displayRequestDuration: true,
          tryItOutEnabled: false,
          // A token or site key stays in this page's memory only.
          persistAuthorization: false,
          // No request leaves for swagger.io's validator.
          validatorUrl: null,
          // Plain code blocks in the docs' colours: the highlighter's themes fail contrast.
          syntaxHighlight: false,
        });
    },
    leave() {
      for (const id of STYLE_IDS) doc.getElementById(id)?.remove();
      doc.documentElement.classList.remove('dark-mode');
    },
  };
}

export const API_REFERENCE_LOADER = new InjectionToken<ApiReferenceLoader>('API reference loader', {
  providedIn: 'root',
  factory: () => browserLoader(inject(DOCUMENT)),
});

const DIALOG_TITLE_ID = 'docs-swagger-dialog-title';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Fills in what Swagger UI's markup leaves out (WCAG 4.1.2): the Authorize dialog's icon-only close
 * button gets a name, and the dialog its role, `aria-modal` and its heading as its name; its credential
 * fields become password fields, so a token is never shown. Run again whenever Swagger UI renders.
 */
export function labelSwaggerControls(root: HTMLElement): void {
  for (const button of root.querySelectorAll('button.close-modal:not([aria-label])')) {
    button.setAttribute('aria-label', 'Close');
  }
  // A token or site key typed into the Authorize dialog is masked, like a password.
  for (const input of root.querySelectorAll<HTMLInputElement>('.modal-ux .auth-container input[type="text"]')) {
    input.type = 'password';
    input.autocomplete = 'off';
  }
  const dialog = root.querySelector('.modal-ux');
  if (dialog && !dialog.hasAttribute('role')) {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = dialog.querySelector('.modal-ux-header h3');
    if (title) {
      title.id = DIALOG_TITLE_ID;
      dialog.setAttribute('aria-labelledby', DIALOG_TITLE_ID);
    }
  }
}

/**
 * Keeps the keyboard in Swagger UI's Authorize dialog while it is open (Tab and Shift+Tab cycle inside
 * it; WCAG 2.4.3), as a modal dialog does. Returns how to stop.
 */
export function trapDialogFocus(root: HTMLElement): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const dialog = root.querySelector<HTMLElement>('.modal-ux');
    if (!dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = root.ownerDocument.activeElement;
    if (!dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  root.ownerDocument.addEventListener('keydown', onKeydown, true);
  return () => root.ownerDocument.removeEventListener('keydown', onKeydown, true);
}

type State = 'loading' | 'ready' | 'failed';

/**
 * The API reference (epic developer experience 10.2): the whole Management and Delivery API from
 * `libs/contract/openapi/openapi.yaml`, in Swagger UI, with Try it out against the API URL the
 * reader sets.
 */
@Component({
  selector: 'docs-api-reference',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">API reference</h1>
    <p class="lede">
      Every Management and Delivery API operation, with its parameters, schemas and examples. Try any of them against
      your TaleArt API.
    </p>

    <h2 id="before-you-try">Before you try</h2>
    <ol class="steps">
      <li>
        Set the <strong>API URL</strong> below to your TaleArt API. It starts as the local API,
        <code>{{ defaultApiUrl }}</code
        >.
      </li>
      <li>
        Choose <strong>Authorize</strong> and paste an <a routerLink="/api-tokens">API token</a> (<code>tat_…</code>)
        for the Management API, or a zone key (<code>tak_…</code>) or the project's site key (<code>tas_…</code>) for
        the Delivery API.
      </li>
      <li>Open an operation, choose <strong>Try it out</strong>, then <strong>Execute</strong>.</li>
    </ol>
    <aside class="callout callout--warning">
      <p>
        <strong>Requests are real.</strong> Try it out sends them from your browser to the API URL, as you: a write
        changes your data. Use a test project and a read-only token where you can.
      </p>
      <p>
        The token stays in this page only: it is not stored, and is gone when you leave, reload or change the API URL.
        The dashboard's signed-in session (a cookie) cannot be used from the docs, so operations that need it, such as
        managing API tokens, say <em>Dashboard only</em>.
      </p>
    </aside>
    <p>
      From a terminal or a script, the <code>taleart</code> command-line tool calls these operations for you; an AI
      agent can drive it with the TaleArt skill: see <a routerLink="/ai-agents">AI agents</a>.
    </p>

    <form class="api-url" (submit)="apply($event)" novalidate>
      <label for="api-url">API URL</label>
      <div class="api-url__row">
        <input
          #field
          id="api-url"
          name="api-url"
          type="url"
          inputmode="url"
          autocomplete="url"
          spellcheck="false"
          [value]="apiUrl()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="error() ? 'api-url-hint api-url-error' : 'api-url-hint'"
        />
        <button type="submit">Use this URL</button>
      </div>
      <p id="api-url-hint" class="muted">
        Requests go to <code>{{ apiUrl() }}/api/v1</code> (Management) and <code>{{ apiUrl() }}/delivery/v1</code>
        (Delivery). Kept in this browser for your next visit.
      </p>
      @if (error(); as message) {
        <p id="api-url-error" class="api-url__error">{{ message }}</p>
      }
    </form>
    <p class="api-status" role="status">{{ statusText() }}</p>

    <h2 id="operations">Operations</h2>
    @if (state() === 'failed') {
      <p>
        The reference could not load. The OpenAPI document is
        <a [href]="openapiAsset">{{ openapiAsset }}</a
        >; the API also serves it at <code>/api/openapi.json</code>.
      </p>
    } @else if (state() === 'loading') {
      <p class="muted">
        Loading the reference… It needs JavaScript; without it, read the OpenAPI document at
        <a [href]="openapiAsset">{{ openapiAsset }}</a
        >.
      </p>
    }
    <div #host class="api-reference" [class.is-hidden]="state() !== 'ready'"></div>

    <h2 id="accessibility">Accessibility</h2>
    <p>
      The reference is Swagger UI {{ swaggerVersion }}. The docs restyle it for contrast in the light and dark themes,
      enlarge its copy buttons, name its dialog and close button, keep the keyboard inside the Authorize dialog and
      return it to the button that opened it, and let wide tables scroll on narrow screens. What the docs cannot change
      from outside:
    </p>
    <ul>
      <li>
        A response from <strong>Execute</strong> is not announced to screen readers. Move on to the
        <em>Server response</em> heading below the button to read it.
      </li>
      <li>
        The lock button on each operation is named “authorization button locked” or “unlocked”; it opens the same
        Authorize dialog.
      </li>
    </ul>
    <p>
      Every operation is also in the OpenAPI document, <a [href]="openapiAsset">{{ openapiAsset }}</a
      >, which any OpenAPI tool reads.
    </p>
  `,
  styles: `
    .api-url {
      margin: 1.5rem 0 0.5rem;
    }
    .api-url label {
      display: block;
      font-weight: 600;
    }
    .api-url__row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0.25rem 0;
    }
    .api-url input {
      flex: 1 1 18rem;
      min-width: 0;
      min-height: 2.5rem;
      padding: 0.375rem 0.625rem;
      font: inherit;
      color: var(--text);
      background: var(--bg);
      border: 1px solid var(--muted);
      border-radius: 6px;
    }
    .api-url input[aria-invalid='true'] {
      border-color: var(--error);
    }
    .api-url button {
      min-height: 2.5rem;
      padding: 0.375rem 1rem;
      font: inherit;
      font-weight: 600;
      color: var(--on-accent);
      background: var(--accent-text);
      border: 0;
      border-radius: 6px;
      cursor: pointer;
    }
    .api-url input:focus-visible,
    .api-url button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .api-url__error {
      color: var(--error);
      font-weight: 600;
    }
    .api-status:empty {
      display: none;
    }
    .is-hidden {
      display: none;
    }
  `,
})
export class ApiReferencePage {
  private readonly loader = inject(API_REFERENCE_LOADER);
  private readonly doc = inject(DOCUMENT);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private ui: SwaggerUiInstance | null = null;
  private observer: MutationObserver | null = null;
  private stopTrap: (() => void) | null = null;
  private source: OpenApiDocument | null = null;
  private left = false;
  private readonly theme = inject(ThemeService);

  protected readonly defaultApiUrl = DEFAULT_API_URL;
  protected readonly openapiAsset = OPENAPI_ASSET;
  protected readonly swaggerVersion = SWAGGER_UI.version;
  protected readonly apiUrl = signal(DEFAULT_API_URL);
  protected readonly error = signal<string | null>(null);
  protected readonly state = signal<State>('loading');
  protected readonly statusText = signal('');

  constructor() {
    afterNextRender(() => void this.start());
    // Swagger UI's own dark theme (its `dark-mode` class on <html>) follows the docs' theme, whichever the reader chose.
    effect(() => this.doc.documentElement.classList.toggle('dark-mode', this.theme.dark()));
    inject(DestroyRef).onDestroy(() => {
      this.left = true;
      this.observer?.disconnect();
      this.stopTrap?.();
      this.loader.leave();
    });
  }

  private storage = (): Storage | null => this.doc.defaultView?.localStorage ?? null;

  private async start(): Promise<void> {
    this.apiUrl.set(readApiUrl(this.storage));
    try {
      const [source, start] = await Promise.all([this.loader.document(), this.loader.swaggerUi()]);
      if (this.left) return;
      this.source = source;
      const host = this.host().nativeElement;
      this.ui = start(host, prepareSpec(source, this.apiUrl()));
      labelSwaggerControls(host);
      this.stopTrap = trapDialogFocus(host);
      // When the Authorize dialog closes, the keyboard goes back to the button that opened it.
      let opener: HTMLElement | null = null;
      let lastOutside: HTMLElement | null = null;
      host.addEventListener('focusin', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && !target.closest('.modal-ux')) lastOutside = target;
      });
      this.observer = new MutationObserver(() => {
        labelSwaggerControls(host);
        const open = !!host.querySelector('.modal-ux');
        if (open && !opener) {
          opener = lastOutside?.isConnected
            ? lastOutside
            : host.querySelector<HTMLElement>('.scheme-container .btn.authorize');
        } else if (!open && opener) {
          const back = opener.isConnected
            ? opener
            : host.querySelector<HTMLElement>('.scheme-container .btn.authorize');
          opener = null;
          back?.focus();
        }
      });
      this.observer.observe(host, { childList: true, subtree: true });
      this.state.set('ready');
    } catch {
      if (this.left) return;
      this.state.set('failed');
      this.statusText.set('The reference could not load.');
    }
  }

  protected apply(event: Event): void {
    event.preventDefault();
    const url = normalizeApiUrl(this.field().nativeElement.value);
    if (!url) {
      this.error.set('Enter an http or https URL, such as https://api.example.com, without a query or fragment.');
      this.statusText.set('');
      return;
    }
    this.error.set(null);
    this.field().nativeElement.value = url;
    this.apiUrl.set(url);
    storeApiUrl(this.storage, url);
    if (this.ui && this.source) {
      const spec = prepareSpec(this.source, url);
      // A token or site key was given for the previous API: it never goes to another host.
      this.ui.authActions.logout(Object.keys(spec.components?.securitySchemes ?? {}));
      this.ui.specActions.updateSpec(JSON.stringify(spec));
    }
    this.statusText.set(`Credentials cleared; authorize again for ${url}. Try it out now sends requests there.`);
  }
}
