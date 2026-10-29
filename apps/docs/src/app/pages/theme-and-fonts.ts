import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-theme-and-fonts',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Theme and fonts</h1>
<p>The theme sets how bars and banners look. Open <strong>Projects</strong>, then <strong>Theme</strong> for a project.</p>
<p><img class="guide-img" alt="Project theme" src="guides/images/18-theme.png" /></p>
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
</tbody>
</table></div>
<h2 id="which-value-wins">Which value wins</h2>
<p>A value is read from the most specific place that sets it: the element's <code>theme</code> attribute, then <code>configureZone</code> in the page's script, then the project theme, then the default. Examples are on <a routerLink="/install">Install a zone</a>.</p>
<h2 id="project-fonts">Project fonts</h2>
<p><strong>Projects</strong>, then <strong>Fonts</strong>. Upload a WOFF2 file (at most 500 KB), give it a family name, weight and style, and confirm you may use and distribute it. Tale Studio and the SDK can then use the family. Text shows in the fallback font until the font has loaded.</p>
<p><img class="guide-img" alt="Fonts" src="guides/images/19-fonts.png" /></p>
  `,
})
export class ThemeAndFontsPage {}
