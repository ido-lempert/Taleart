import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DOCS_SNIPPET } from '../docs-content';

// docs-check:removed (the markup of builds before the zone rework, shown only as what to replace)
const OLD_MARKUP = '<taleart-view api-url="https://api.example.com" zone-key="tak_…" stage="top"></taleart-view>';
// /docs-check:removed

@Component({
  selector: 'docs-moving',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Stages and zone keys</h1>
    <p class="lede">
      Earlier builds placed content with stages, frames, playbooks and one key per zone. The zone rework replaced them.
      This page says what the upgrade did to your content and how to move a page that still uses the old markup.
    </p>

    <h2 id="now">How it works now</h2>
    <ul>
      <li>A <strong>zone</strong> is one spot with at most one <strong>display</strong> (a bar or a banner).</li>
      <li>A <strong>template</strong> sets a new zone's display once, when you create it.</li>
      <li>A page places a zone with the project's <strong>site key</strong> and the zone's <strong>slug</strong>.</li>
    </ul>

    <!-- docs-check:removed -->
    <h2 id="stages">What the upgrade did to stages and frames</h2>
    <p>
      The upgrade turned every stage, and every frame beyond a zone's first, into a zone of its own with one display.
      No content and no placement was lost:
    </p>
    <ul>
      <li>
        A zone with stages kept its id and became the zone of its oldest stage: the stage's name, its key as the slug,
        and the stage's frame as the display. Every further stage became a new zone in the same way.
      </li>
      <li>
        A frame that no stage showed, and every frame after the first of a zone without stages, became a new zone
        named "&lt;zone name&gt; – &lt;type&gt; &lt;n&gt;", such as "Home – Bar 2", with that frame as its display.
      </li>
      <li>Every new zone got a copy of the original zone's tale groups, in the same order.</li>
      <li>A zone that had no frame stayed one zone, with no display.</li>
      <li>
        Slugs came from the stage key, or from the zone's name when there was none, and were made unique in the
        project with <code>-2</code>, <code>-3</code> and so on. A stage key that another zone already used got such a
        suffix: check the slug on the zone page.
      </li>
    </ul>
    <div class="table-wrap">
      <table>
        <caption class="muted">Example</caption>
        <thead>
          <tr>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              "Home" with stages Top (a bar) and Promo (a banner), a bar no stage showed, and groups G1 and G2
            </td>
            <td>
              "Top" (<code>top</code>, the original zone), "Promo" (<code>promo</code>) and "Home – Bar 2"
              (<code>home-bar-2</code>), each showing G1 and G2
            </td>
          </tr>
          <tr>
            <td>"Shop" with a bar and a banner, no stages</td>
            <td>"Shop" (<code>shop</code>, the bar) and "Shop – Banner 1" (<code>shop-banner-1</code>)</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="playbooks">Frames and playbooks</h2>
    <p>
      A frame is now called the zone's <strong>display</strong>, and there is one per zone. Playbooks are gone: the
      presets became <strong>templates</strong> you pick when creating a zone. A zone made from a playbook keeps only a
      "created from template" note.
    </p>

    <h2 id="zone-keys">Zone keys and the stage attribute were removed</h2>
    <p>
      Zone keys (<code>tak_…</code>), the <code>zone-key</code> attribute, the <code>zoneKey</code> property, the
      <code>stage</code> attribute and <code>configureZone</code> with a zone key were removed. They no longer work:
      an element with only a zone key renders nothing and logs one console warning.
    </p>
    <p>Replace markup like this:</p>
    <pre><code>{{ oldMarkup }}</code></pre>
    <!-- /docs-check:removed -->
    <p>with the snippet from the zone's Install tab:</p>
    <pre><code>{{ snippet }}</code></pre>
    <ol class="steps">
      <li>Open the zone that came from the stage (or zone) the page used, and note its slug.</li>
      <li>On its Install tab, issue the project's site key if the project has none, and copy the snippet.</li>
      <li>Replace the old element, and pass the slug to <code>configureZone</code> if the page set a theme.</li>
    </ol>
    <p>See <a routerLink="/install">Install a zone</a> for the details.</p>
  `,
})
export class MovingPage {
  protected readonly oldMarkup = OLD_MARKUP;
  protected readonly snippet = DOCS_SNIPPET;
}
