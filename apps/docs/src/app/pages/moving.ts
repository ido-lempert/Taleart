import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DOCS_SNIPPET, FOLD_EXAMPLES } from '../docs-content';

// docs-check:removed (the markup of builds before the zone rework, shown only as what to replace)
const OLD_MARKUP = '<taleart-view api-url="https://api.example.com" zone-key="tak_…" stage="top"></taleart-view>\n<taleart-view api-url="https://api.example.com" site-key="tas_…" zone="home-top"></taleart-view>';
// /docs-check:removed

@Component({
  selector: 'docs-moving',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Stages and zone keys</h1>
    <p class="lede">
      Earlier builds placed content with stages, frames, presets and one key per zone. The zone rework replaced the stages and frames and, for a time, the zone keys; zone keys are back.
      This page says what the upgrade did to your content and how to move a page that still uses the old markup.
    </p>

    <h2 id="now">How it works now</h2>
    <ul>
      <li>A <strong>zone</strong> is one spot with at most one <strong>display</strong> (a bar or a banner).</li>
      <li>A <strong>template</strong> sets a new zone's display once, when you create it.</li>
      <li>A page shows a zone with the zone's own <strong>zone key</strong>, issued on the zone's Install tab.</li>
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
        named "&lt;zone name&gt; – &lt;Type&gt; &lt;n&gt;", such as "Home – Bar 2", with that frame as its display.
        <code>n</code> counts the original zone's frames of that type, oldest first, including the frames its stages
        showed.
      </li>
      <li>
        Such a zone's slug is the original zone's new slug, then <code>-&lt;type&gt;-&lt;n&gt;</code>: when "Home"
        became "Top" (<code>top</code>), its second bar became <code>top-bar-2</code>.
      </li>
      <li>Every new zone got a copy of the original zone's tale groups, in the same order.</li>
      <li>A zone that had no frame stayed one zone, with no display.</li>
      <li>
        Other slugs came from the stage key, or from the zone's name when there was none. A slug another zone of the
        project already had got <code>-2</code>, <code>-3</code> and so on, oldest zone first, so a stage key can have
        changed: check the slug on the zone page.
      </li>
    </ul>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="fold-caption">
      <table>
        <caption id="fold-caption">Examples of the upgrade</caption>
        <thead>
          <tr>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          @for (example of examples; track example.before) {
            <tr>
              <td>{{ example.before }}</td>
              <td>
                <ul class="plain">
                  @for (zone of example.after; track zone.slug) {
                    <li>
                      "{{ zone.name }}" (<code>{{ zone.slug }}</code>), {{ zone.note }}
                    </li>
                  }
                </ul>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <p>Each zone made from "Home" shows Home's tale groups, in Home's order; the same for "Shop".</p>

    <h2 id="templates">Frames and presets</h2>
    <p>
      A frame is now called the zone's <strong>display</strong>, and there is one per zone. The presets that set up
      several frames at once (playbooks) are gone: they became <strong>templates</strong> you pick when creating a
      zone. A zone made from one keeps only a "created from template" note.
    </p>

    <h2 id="zone-keys">Zone keys are back; the stage attribute stays removed</h2>
    <p>
      The zone rework briefly removed zone keys (owner decision, 2026-10-22). They return, as one key per zone: a
      <code>tak_…</code> key names its zone, so an element needs only <code>zone-key</code>. The
      <code>stage</code> attribute stays removed, and so do the <code>site-key</code> and <code>zone</code> attributes of
      the interim builds. A page that still uses a site key with <code>zone=</code> must move to a zone key from the
      zone's Install tab. An element placed the old way renders nothing, and the <code>site-key</code> attribute logs
      one console warning per element.
    </p>
    <!-- docs-check:removed -->
    <p>Replace markup like this:</p>
    <pre tabindex="0" role="region" aria-label="Old markup"><code>{{ oldMarkup }}</code></pre>
    <!-- /docs-check:removed -->
    <p>with the snippet from the zone's Install tab:</p>
    <pre tabindex="0" role="region" aria-label="Install snippet"><code>{{ snippet }}</code></pre>
    <ol class="steps">
      <li>Open the zone that came from the stage (or zone) the page used.</li>
      <li>On its Install tab, an admin issues the zone's key, and you copy the snippet.</li>
      <li>Replace the old element with the new one. If the page set a theme, pass the zone's slug to <code>configureZone</code>.</li>
    </ol>
    <p>See <a routerLink="/install">Install a zone</a> for the details.</p>
  `,
})
export class MovingPage {
  protected readonly oldMarkup = OLD_MARKUP;
  protected readonly snippet = DOCS_SNIPPET;
  protected readonly examples = FOLD_EXAMPLES;
}
