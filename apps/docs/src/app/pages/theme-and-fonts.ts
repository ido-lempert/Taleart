import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-theme-and-fonts',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Theme and fonts</h1>
<p>The theme sets how bars and banners look. Open <strong>Projects</strong>, then <strong>Theme</strong> for a project.</p>
<p><img class="guide-img" alt="Project theme" src="guides/images/18-theme.png" width="1280" height="800" /></p>
<h2 id="fields">Fields</h2>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Field</th>
<th>Values</th>
</tr>
</thead>
<tbody>
<tr>
<td>Ring style</td>
<td>gradient, solid or none</td>
</tr>
<tr>
<td>Ring colours</td>
<td>1 to 3 colours</td>
</tr>
<tr>
<td>Seen ring colour</td>
<td>the ring after a group was viewed</td>
</tr>
<tr>
<td>Ring width</td>
<td>1 to 4 px</td>
</tr>
<tr>
<td>Corner radius</td>
<td>0 to 32 px, or the display's own</td>
</tr>
<tr>
<td>Font family</td>
<td>a system font or a project font</td>
</tr>
<tr>
<td>Title colour</td>
<td></td>
</tr>
<tr>
<td>Background colour</td>
<td></td>
</tr>
<tr>
<td>Accent colour</td>
<td></td>
</tr>
<tr>
<td>Colour scheme</td>
<td>auto (the visitor’s setting), light or dark</td>
</tr>
<tr>
<td>Live colour</td>
<td><code>#rrggbb</code>, or <code>null</code> for the last ring colour</td>
</tr>
<tr>
<td>Success colour</td>
<td><code>#rrggbb</code>: a right quiz answer</td>
</tr>
<tr>
<td>Error colour</td>
<td><code>#rrggbb</code>: a wrong quiz answer</td>
</tr>
</tbody>
</table></div>
<h2 id="colour-scheme">Colour scheme</h2>
<p>With <strong>Colour scheme</strong> at <code>auto</code> (the default), the display draws its card and text in the light or the dark scheme the visitor's device uses; <code>light</code> and <code>dark</code> force one. The title takes the host page's text colour unless a title colour is set, so the same bar reads on a light page and on a dark one.</p>
<div class="scheme-pair">
<figure>
<img src="images/web-theme-light.png" alt="The sample bar on a light page: four circles with names under them, in the light scheme." width="1120" height="284" />
<figcaption>Light</figcaption>
</figure>
<figure>
<img src="images/web-theme-dark.png" alt="The same bar on a dark page, in the dark scheme: the names are light and the cover edge is near-black." width="1120" height="284" />
<figcaption>Dark</figcaption>
</figure>
</div>
<h2 id="derived">How colours are derived</h2>
<p>A display never uses a colour that is not in the theme or derived from it. The SDK sets these tokens from the fields above; a component reads them, so changing one field changes every place that uses it.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Token</th>
<th>Source</th>
<th>Rule</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>--ta-ring</code></td>
<td><code>ringColors</code>, <code>ringStyle</code></td>
<td>A gradient at 45° through up to three colours; <code>solid</code> the first colour; <code>none</code> transparent.</td>
</tr>
<tr>
<td><code>--ta-seen</code></td>
<td><code>seenRingColor</code></td>
<td>The ring after a group was viewed. Transparent with <code>none</code>.</td>
</tr>
<tr>
<td><code>--ta-accent</code></td>
<td><code>accentColor</code></td>
<td>The viewer’s progress and buttons.</td>
</tr>
<tr>
<td><code>--ta-on-accent</code></td>
<td><code>accentColor</code></td>
<td>Text on the accent: white or near-black, whichever has the higher contrast with it.</td>
</tr>
<tr>
<td><code>--ta-title</code></td>
<td><code>titleColor</code></td>
<td>The title. Unset (<code>null</code>): the host page’s text colour.</td>
</tr>
<tr>
<td><code>--ta-muted</code></td>
<td>the title (or the host page’s colour)</td>
<td>The title at 65 %: dots, borders and secondary text.</td>
</tr>
<tr>
<td><code>--ta-surface</code></td>
<td><code>backgroundColor</code></td>
<td>The background. Transparent: the title at 6 %.</td>
</tr>
<tr>
<td><code>--ta-live</code></td>
<td><code>liveColor</code>, else the last ring colour</td>
<td>The live badge.</td>
</tr>
<tr>
<td><code>--ta-success</code>, <code>--ta-error</code></td>
<td><code>successColor</code>, <code>errorColor</code></td>
<td>A right and a wrong quiz answer, as the colour itself.</td>
</tr>
<tr>
<td><code>--ta-success-ink</code>, <code>--ta-error-ink</code></td>
<td>the two colours and the colour scheme</td>
<td>The answer mark on the card of the scheme in use: the colour itself on light, lightened until it reads at 4.5:1 on the dark card.</td>
</tr>
<tr>
<td><code>--ta-paper</code>, <code>--ta-ink</code></td>
<td><code>colorScheme</code></td>
<td>The card and its text: white and near-black on light, near-black and white on dark. <code>auto</code> follows the visitor’s light or dark setting.</td>
</tr>
</tbody>
</table></div>
<h2 id="which-value-wins">Which value wins</h2>
<p>A value is read from the most specific place that sets it: the element's <code>theme</code> attribute, then <code>configureZone</code> in the page's script, then the project theme, then the default. Examples are on <a routerLink="/install">Install a zone</a>.</p>
<h2 id="project-fonts">Project fonts</h2>
<p><strong>Projects</strong>, then <strong>Fonts</strong>. Upload a WOFF2 file (at most 500 KB), give it a family name, weight and style, and confirm you may use and distribute it. Tale Studio and the SDK can then use the family. Text shows in the fallback font until the font has loaded.</p>
<p><img class="guide-img" alt="Fonts page with the Inter font uploaded" src="guides/images/19-fonts.png" width="1280" height="1100" /></p>
  `,
})
export class ThemeAndFontsPage {}
