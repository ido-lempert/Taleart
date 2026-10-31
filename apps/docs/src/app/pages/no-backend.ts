import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SDK_NPM_PACKAGE } from '@taleart/contract/core';
import { BANNER_ZONE, BAR_ZONE, json, MINIMAL_ZONE } from './no-backend-data';

/** Where the docs site serves the built Web SDK: `sdk/web/index.js` and its chunks (see the docs build assets). */
export const DOCS_SDK_PATH = 'sdk/web/index.js';

/** What the page uses of the SDK: its own global, set when the module loads. */
interface Sdk {
  setZoneData(zone: string, data: unknown): void;
  validateZone(json: unknown): { ok: true } | { ok: false; errors: string[] };
}

type DataElement = HTMLElement & { data: unknown };

/**
 * Use the Web SDK without a backend: the zone JSON goes to the element or to `Taleart.setZoneData`. The page runs the
 * real, built Web SDK (loaded in the browser from the docs site's own `sdk/web/`) on inline zone data; the examples are
 * created in the browser only, so the prerendered page reads without them.
 */
@Component({
  selector: 'docs-no-backend',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .live {
      border: 1px solid var(--docs-border, #d0d7de);
      border-radius: 12px;
      padding: 16px;
      margin: 16px 0;
    }
    .live__bar {
      font-size: 0.8125rem;
      margin: 0 0 8px;
      opacity: 0.75;
    }
    .live__host {
      min-height: 120px;
    }
    .editor {
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(0, 1fr);
    }
    @media (min-width: 900px) {
      .editor {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 22rem;
      font: 0.8125rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      padding: 12px;
      border: 1px solid var(--docs-border, #d0d7de);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      resize: vertical;
    }
    .verdict {
      margin: 8px 0 0;
      font-weight: 600;
    }
    .verdict[data-ok='true'] {
      color: #1a7f37;
    }
    .verdict[data-ok='false'] {
      color: #cf222e;
    }
    .errors {
      margin: 4px 0 0;
      padding-inline-start: 1.25rem;
      font: 0.8125rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
  `,
  template: `
    <h1 tabindex="-1">Use without a backend</h1>
    <p class="lede">
      Show tales on a page with no TaleArt server: you pass the zone JSON yourself, to the element or to one function.
      The Web SDK renders it exactly as it renders a zone it fetched, and sends nothing to the Delivery API.
    </p>

    <h2 id="when">When to use it</h2>
    <ul>
      <li>A static site, a landing page, a prototype or a demo that must work with no server of yours or ours.</li>
      <li>An app that already has its stories in its own data, and wants the TaleArt look and viewer for them.</li>
      <li>Tests and screenshots, where a network call would be noise.</li>
    </ul>
    <p>
      Choose the normal setup (<a routerLink="/guides/web">the Web guide</a>) when editors should change tales in Tale
      Studio without a deploy, or when you want analytics and poll results in the dashboard. Without a backend the JSON is
      part of your page: changing a tale means changing the JSON and publishing the page again.
    </p>

    <h2 id="json-shape">The JSON</h2>
    <p>
      The input is exactly the body of <code>GET /delivery/v1/zone</code>: one zone with its display (<code>frame</code>) and
      its tale groups. The smallest useful zone is one bar with one group of two tales, a picture and a line of text:
    </p>
    <pre tabindex="0" role="region" aria-label="The smallest zone"><code class="language-json">{{ minimalJson }}</code></pre>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="shape-caption">
      <table id="shape">
        <caption id="shape-caption">What each part of the zone means</caption>
        <thead>
          <tr>
            <th scope="col">Path</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>frame</code></td>
            <td>
              The display. <code>type</code> is <code>bar</code> or <code>banner</code>, and <code>settings</code> are its
              options (the layout, the size, the banner variant). <code>null</code> shows nothing.
            </td>
          </tr>
          <tr>
            <td><code>taleGroups[]</code></td>
            <td>
              The groups, in the order they show. Each needs an <code>id</code> (unique in the zone), a <code>name</code>
              (the title under its ring) and its <code>tales</code>. Optional: <code>tags</code>, <code>tagMatch</code> and
              <code>audience</code> for <a routerLink="/targeting">targeting</a>, and <code>cover</code>.
            </td>
          </tr>
          <tr>
            <td><code>tales[]</code></td>
            <td>
              A tale needs an <code>id</code> and a <code>title</code> and something to show: <code>media</code> (an image or
              a video) or a <code>document</code> (a canvas and its elements: text, shapes, buttons, polls, a countdown).
            </td>
          </tr>
          <tr>
            <td><code>media.url</code></td>
            <td>
              Absolute (<code>https://cdn.example.com/a.jpg</code>), relative to the page (<code>images/a.jpg</code>) or a
              <code>data:</code> URI.
            </td>
          </tr>
          <tr>
            <td><code>theme</code>, <code>id</code>, <code>name</code>, <code>slug</code></td>
            <td>
              Optional. Without a <code>theme</code> the display takes the page's look; set it, or use
              <code>configureZone</code>, to style it (<a routerLink="/theme-and-fonts">Theme and fonts</a>).
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="three-apis">The three calls</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="apis-caption">
      <table id="apis">
        <caption id="apis-caption">The calls for zone data</caption>
        <thead>
          <tr>
            <th scope="col">Call</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>element.data = zone</code></td>
            <td>
              This element renders <code>zone</code>, an object or JSON text. Set it again to render again; set
              <code>null</code> to remove it.
            </td>
          </tr>
          <tr>
            <td><code>Taleart.setZoneData(name, zone)</code></td>
            <td>
              Gives the zone named <code>name</code> its data, so every
              <code>&lt;taleart-view zone="name"&gt;</code>, now or added later, renders it. A later call re-renders them;
              <code>null</code> removes the data.
            </td>
          </tr>
          <tr>
            <td><code>Taleart.validateZone(json)</code></td>
            <td>
              Checks the JSON and answers <code>{{ okShape }}</code> or <code>{{ failShape }}</code>. It renders and sends
              nothing.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      An element needs <strong>no zone key and no API URL</strong>. If more than one source is present the order is: the
      element's own <code>data</code>, then the data registered for its <code>zone</code>, then the network. All three
      also exist as module exports (<code>setZoneData</code>, <code>validateZone</code>) when you bundle the SDK from npm.
    </p>
    <pre tabindex="0" role="region" aria-label="The three calls in a page"><code class="language-html">{{ htmlSnippet }}</code></pre>

    <h2 id="live-bar">Live: a bar</h2>
    <p>
      This is the real Web SDK, loaded from this site, rendering the JSON below it with no key and no request. Tap a ring to
      open it; the second group's last tale has a poll that you can answer, and the answer stays on your device.
    </p>
    <div class="live" aria-label="A live bar">
      <p class="live__bar" id="live-bar-status" role="status">{{ barStatus() }}</p>
      <div #barHost class="live__host"></div>
    </div>
    <details>
      <summary>The zone this bar renders</summary>
      <pre tabindex="0" role="region" aria-label="The bar's zone data"><code class="language-json">{{ barJson }}</code></pre>
    </details>

    <h2 id="live-banner">Live: a banner</h2>
    <p>
      The same call with a banner display, set from a registered name:
      <code>Taleart.setZoneData('docs-banner', zone)</code> and <code>&lt;taleart-view zone="docs-banner"&gt;</code>.
    </p>
    <div class="live" aria-label="A live banner">
      <div #bannerHost class="live__host"></div>
    </div>
    <details>
      <summary>The zone this banner renders</summary>
      <pre tabindex="0" role="region" aria-label="The banner's zone data"><code class="language-json">{{ bannerJson }}</code></pre>
    </details>

    <h2 id="live-editor">Live: edit the JSON</h2>
    <p>
      Change the JSON on the left. It is checked with <code>Taleart.validateZone</code> as you type, and rendered with
      <code>element.data</code> as soon as it is valid. Break it on purpose, to see the messages.
    </p>
    <div class="live editor" aria-label="A live editor">
      <div>
        <label for="zone-json"><strong>Zone JSON</strong></label>
        <textarea
          id="zone-json"
          #editor
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          [value]="minimalJson"
          (input)="edited()"
        ></textarea>
        <p class="verdict" id="zone-verdict" role="status" [attr.data-ok]="verdict().ok">{{ verdict().text }}</p>
        <ul class="errors" id="zone-errors" aria-label="Problems found">
          @for (error of verdict().errors; track $index) {
            <li>{{ error }}</li>
          }
        </ul>
        <div class="actions">
          <button type="button" class="button" (click)="reset()">Reset the example</button>
          <button type="button" class="button" (click)="breakIt()">Break it</button>
        </div>
      </div>
      <div>
        <p class="live__bar">The result</p>
        <div #editorHost class="live__host"></div>
      </div>
    </div>

    <h2 id="what-works">What is active, and what is not</h2>
    <p>
      With zone data the SDK makes <strong>no request to the Delivery API at all</strong>: no read of the zone, no analytics
      events and no posted answers. The rest works as with a fetched zone.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="active-caption">
      <table id="active">
        <caption id="active-caption">Features with and without a backend</caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">With zone data</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>The bar, the banner and the full-screen viewer</td>
            <td>Work as usual, with every layout and variant.</td>
          </tr>
          <tr>
            <td>Tags, viewer properties and audience rules</td>
            <td>Work: the SDK compares the rules in your JSON with <code>setTags</code> and <code>setProperties</code>.</td>
          </tr>
          <tr>
            <td>User lists and the external user ID</td>
            <td>
              Not used. The server decides user lists; with no server, put in the JSON the groups you want this visitor to
              see.
            </td>
          </tr>
          <tr>
            <td>Frequency cap and the seen ring</td>
            <td>Work: they are kept in this browser.</td>
          </tr>
          <tr>
            <td>Theme, <code>configureZone</code>, locale, strings and right-to-left pages</td>
            <td>Work.</td>
          </tr>
          <tr>
            <td>Hooks and DOM events</td>
            <td>
              Work, with an empty <code>zoneKeyPrefix</code>. Use them to send your own analytics.
            </td>
          </tr>
          <tr>
            <td>Analytics in the dashboard</td>
            <td>Off. Nothing is sent, so nothing is counted.</td>
          </tr>
          <tr>
            <td>Polls, quizzes, ratings and reactions</td>
            <td>
              The visitor can answer and sees their own answer, kept on the device (<code>localStorage</code>). Nothing is
              posted, so there are no shared results: a poll shows the visitor's choice as 100%.
            </td>
          </tr>
          <tr>
            <td>Countdowns, promo codes, buttons and links</td>
            <td>Work: they run in the browser.</td>
          </tr>
          <tr>
            <td>Pictures and video</td>
            <td>Any URL the page can load: absolute, relative to the page or a <code>data:</code> URI.</td>
          </tr>
          <tr>
            <td>Tale Studio, scheduling and the media library</td>
            <td>Not part of it. You write or export the JSON yourself.</td>
          </tr>
          <tr>
            <td>Invalid data</td>
            <td>
              The same as a failed load: one console error that lists the problems, the <code>loadFailed</code> hook, the
              element's fallback. It never throws.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="get-the-json">Get the JSON</h2>
    <ul>
      <li>
        <strong>Copy it from a real zone.</strong> Open the zone's Delivery API address in a browser tool or run
        <code>curl</code> with the zone key, and save the body. Media URLs in it point at the API's media: keep them, or
        replace them with your own.
        <pre tabindex="0" role="region" aria-label="Fetch a zone"><code class="language-sh">{{ curlSnippet }}</code></pre>
      </li>
      <li>
        <strong>Write it by hand,</strong> starting from the smallest zone above. The fields are those of the
        <code>DeliveryZone</code> schema in the <a routerLink="/api-reference">API reference</a>.
      </li>
      <li>
        <strong>Let your editor help.</strong> The schema of the data is published at
        <a href="schemas/zone.schema.json"><code>schemas/zone.schema.json</code></a>. Point a file at it with
        <code>"$schema"</code> as the first key (the SDK ignores it) and the editor completes the field names and flags the
        wrong ones:
        <pre tabindex="0" role="region" aria-label="The schema key"><code class="language-json">{{ schemaSnippet }}</code></pre>
      </li>
    </ul>

    <h2 id="validate">Debug with validateZone</h2>
    <p>
      <code>validateZone</code> answers with one line per problem, each naming the path and what is wrong. It accepts the
      object or the text, so it also catches a missing comma. The SDK logs the same lines when it cannot render the data.
    </p>
    <pre tabindex="0" role="region" aria-label="validateZone"><code class="language-js">{{ validateSnippet }}</code></pre>

    <h2 id="frameworks">In a framework</h2>
    <p>
      Install the package (<code>npm i {{ npmPackage }}</code>) or load the script, then set the property. The element
      is a custom element, so each framework sets <code>data</code> the way it sets any property.
    </p>
    <h3 id="framework-html">Plain HTML</h3>
    <pre tabindex="0" role="region" aria-label="Plain HTML"><code class="language-html">{{ plainSnippet }}</code></pre>
    <h3 id="framework-react">React</h3>
    <pre tabindex="0" role="region" aria-label="React"><code class="language-jsx">{{ reactSnippet }}</code></pre>
    <h3 id="framework-angular">Angular</h3>
    <pre tabindex="0" role="region" aria-label="Angular"><code class="language-html">{{ angularSnippet }}</code></pre>
    <h3 id="framework-vue">Vue</h3>
    <pre tabindex="0" role="region" aria-label="Vue"><code class="language-html">{{ vueSnippet }}</code></pre>

    <h2 id="screenshots">What it looks like</h2>
    <p>Real screenshots of the live examples above, for when you read this page without scripts.</p>
    <figure>
      <img
        src="images/no-backend-bar.png"
        alt="A bar of three rings with the groups Dawn, Night and Sea, each drawn from a picture in the zone JSON: warm hills, a night city and a blue sea."
        width="696"
        height="185"
      />
      <figcaption>The live bar: three groups from inline JSON, no zone key and no request.</figcaption>
    </figure>
    <figure>
      <img
        src="images/no-backend-viewer.png"
        alt="The full-screen viewer open on the Dawn group: a hills picture, two progress segments, the group name, pause and close buttons."
        width="430"
        height="800"
      />
      <figcaption>Tapping a ring opens the same full-screen viewer as with a fetched zone.</figcaption>
    </figure>
    <figure>
      <img
        src="images/no-backend-banner.png"
        alt="A banner slide of the hills picture with the title Hills at dawn and a Watch button, previous and next arrows and three dots."
        width="696"
        height="451"
      />
      <figcaption>The live banner, from the zone registered with <code>Taleart.setZoneData</code>.</figcaption>
    </figure>
    <figure>
      <img
        src="images/no-backend-errors.png"
        alt="The editor with broken JSON: a red message says Not valid, 3 problems, and lists each path with what is wrong, beside the last valid render."
        width="696"
        height="659"
      />
      <figcaption>validateZone on broken JSON: each line names the path and the problem, and the last valid render stays.</figcaption>
    </figure>

    <h2 id="see-also">See also</h2>
    <ul>
      <li><a routerLink="/guides/web">Web guide</a>, the normal setup with a zone key.</li>
      <li><a routerLink="/reference/web-sdk">Web SDK reference</a>, for the element, the functions and the errors.</li>
      <li><a routerLink="/targeting">Targeting</a>, for tags and audience rules in the JSON.</li>
    </ul>
  `,
})
export class NoBackendPage {
  protected readonly minimalJson = json(MINIMAL_ZONE);
  protected readonly barJson = json(BAR_ZONE);
  protected readonly bannerJson = json(BANNER_ZONE);
  protected readonly npmPackage = SDK_NPM_PACKAGE;
  protected readonly okShape = '{ ok: true }';
  protected readonly failShape = '{ ok: false, errors: [...] }';

  protected readonly htmlSnippet = `<script type="module" src="https://cdn.example.com/taleart/index.js"></script>

<taleart-view id="stories"></taleart-view>
<taleart-view zone="home-top"></taleart-view>

<script>
  // 1. One element: an object, or the JSON text.
  document.getElementById('stories').data = zoneJson;

  // 2. By zone name: every <taleart-view zone="home-top">, now and added later. Call it again to re-render.
  Taleart.setZoneData('home-top', zoneJson);
  Taleart.setZoneData('home-top', null); // remove it

  // 3. Check it first.
  const result = Taleart.validateZone(zoneJson); // { ok: true } or { ok: false, errors: [...] }
</script>`;

  protected readonly curlSnippet = `curl -H "Authorization: Bearer $ZONE_KEY" https://api.example.com/delivery/v1/zone > zone.json`;

  protected readonly schemaSnippet = `{
  "$schema": "https://taleart.lempert.site/schemas/zone.schema.json",
  "frame": { "type": "bar", "settings": {} },
  "taleGroups": []
}`;

  protected readonly validateSnippet = `const result = Taleart.validateZone(text);
if (!result.ok) console.log(result.errors.join('\\n'));

// taleGroups[0].tales[1].media.url: is missing (it must be text)
// taleGroups[1].tagMatch: must be "any" or "all", but is "some"
// the zone is not valid JSON (Unexpected token } in JSON at position 41)`;

  protected readonly plainSnippet = `<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>
<taleart-view id="stories"></taleart-view>
<script>
  fetch('/stories.json')
    .then((res) => res.json())
    .then((zone) => { document.getElementById('stories').data = zone; });
</script>`;

  protected readonly reactSnippet = `import '${SDK_NPM_PACKAGE}';
import { useEffect, useRef } from 'react';

export function Stories({ zone }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.data = zone; }, [zone]);
  return <taleart-view ref={ref} />;
}`;

  protected readonly angularSnippet = `<!-- import '${SDK_NPM_PACKAGE}' once, and add CUSTOM_ELEMENTS_SCHEMA to the component -->
<taleart-view [data]="zone"></taleart-view>`;

  protected readonly vueSnippet = `<!-- import '${SDK_NPM_PACKAGE}' once, and list taleart-view in compilerOptions.isCustomElement -->
<taleart-view :data.prop="zone" />`;

  private readonly barHost = viewChild.required<ElementRef<HTMLElement>>('barHost');
  private readonly bannerHost = viewChild.required<ElementRef<HTMLElement>>('bannerHost');
  private readonly editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  private readonly editor = viewChild.required<ElementRef<HTMLTextAreaElement>>('editor');

  protected readonly barStatus = signal('Loading the Web SDK…');
  protected readonly verdict = signal<{ ok: boolean | null; text: string; errors: string[] }>({
    ok: null,
    text: 'The JSON is checked in your browser.',
    errors: [],
  });

  private sdk: Sdk | null = null;
  private editorElement: DataElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    afterNextRender(() => void this.start());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  // Loads the built Web SDK that this site serves, then renders the live examples. A failure leaves the static page.
  private async start(): Promise<void> {
    try {
      const url = new URL(DOCS_SDK_PATH, document.baseURI).href;
      await import(/* @vite-ignore */ url);
      this.sdk = (globalThis as unknown as { Taleart?: Sdk }).Taleart ?? null;
    } catch {
      this.sdk = null;
    }
    const sdk = this.sdk;
    if (!sdk) {
      this.barStatus.set('The live examples need JavaScript and the Web SDK, which did not load.');
      return;
    }
    this.barStatus.set('Rendered by the Web SDK from the JSON below, with no request.');
    this.mount(this.barHost().nativeElement, BAR_ZONE);
    sdk.setZoneData('docs-banner', BANNER_ZONE);
    const banner = document.createElement('taleart-view');
    banner.setAttribute('zone', 'docs-banner');
    this.bannerHost().nativeElement.replaceChildren(banner);
    this.editorElement = this.mount(this.editorHost().nativeElement, MINIMAL_ZONE);
    this.check();
  }

  // Creates a <taleart-view> in `host` and gives it `zone` through its data property.
  private mount(host: HTMLElement, zone: unknown): DataElement {
    const element = document.createElement('taleart-view') as DataElement;
    element.data = zone;
    host.replaceChildren(element);
    return element;
  }

  protected edited(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), 200);
  }

  protected reset(): void {
    this.editor().nativeElement.value = this.minimalJson;
    this.check();
  }

  // Breaks the example in two ways the messages explain: a group without a name, and a tale with no picture.
  protected breakIt(): void {
    const zone = JSON.parse(this.minimalJson);
    delete zone.taleGroups[0].name;
    zone.taleGroups[0].tales[0].media = { kind: 'gif', url: '' };
    this.editor().nativeElement.value = json(zone);
    this.check();
  }

  // Validates the textarea; a valid zone is rendered, an invalid one keeps the last good render.
  private check(): void {
    const sdk = this.sdk;
    const text = this.editor().nativeElement.value;
    if (!sdk) return;
    const result = sdk.validateZone(text);
    if (result.ok) {
      this.verdict.set({ ok: true, text: 'Valid: rendered by the SDK.', errors: [] });
      if (this.editorElement) this.editorElement.data = text;
    } else {
      const count = result.errors.length;
      this.verdict.set({ ok: false, text: `Not valid: ${count} ${count === 1 ? 'problem' : 'problems'}.`, errors: result.errors });
    }
  }
}
