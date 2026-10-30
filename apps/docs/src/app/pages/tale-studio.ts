import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-tale-studio',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Tale Studio</h1>
<p>Tale Studio is the editor for one tale. It opens from <strong>Edit in Tale Studio</strong> in the tale panel.</p>
<p><img class="guide-img" alt="Tale Studio" src="guides/images/11-tale-studio.png" width="1280" height="800" /></p>
<h2 id="the-canvas">The canvas</h2>
<ul>
<li>The canvas is 9:16, like a phone screen.</li>
<li><strong>Safe area</strong> shows the margins the viewer may cover: 12% at the top, 16% at the bottom and 4% on each side. Studio warns when an element sits outside them.</li>
<li>A tale lasts 7 seconds by default. You can set 3 to 15 seconds. A tale with a video plays for the video's length, up to 15 seconds.</li>
<li>A tale holds at most 60 elements, and its document at most 128 KB.</li>
</ul>
<h2 id="elements">Elements</h2>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Element</th>
<th>Notes</th>
</tr>
</thead>
<tbody>
<tr>
<td>Text</td>
<td>Up to 1,000 characters. Font, size, weight, italic, colour, alignment, direction and line height. Background: none, box or highlight.</td>
</tr>
<tr>
<td>Image</td>
<td>Needs alt text, or a "decorative" flag.</td>
</tr>
<tr>
<td>Video</td>
<td>At most one per tale.</td>
</tr>
<tr>
<td>Shape</td>
<td>Rectangle, ellipse or line.</td>
</tr>
<tr>
<td>Emoji and sticker</td>
<td></td>
</tr>
<tr>
<td>Button</td>
<td>Filled or outline. Opens a link.</td>
</tr>
<tr>
<td>Image button</td>
<td>A button made from an image.</td>
</tr>
<tr>
<td>Swipe-up</td>
<td>A swipe-up link. At most one per tale.</td>
</tr>
<tr>
<td>Poll, quiz, rating, reaction, countdown, promo code</td>
<td>See <a routerLink="/interactive-components">Interactive components</a>.</td>
</tr>
</tbody>
</table></div>
<p>A link must be an absolute <code>http</code> or <code>https</code> URL of at most 2,048 characters.</p>
<p><img class="guide-img" src="images/web-shot-elements.png" width="780" height="1400" alt="A tale in the viewer with display elements: the text Summer is here, a sun emoji, a thin white line made with a shape, a filled yellow button Shop the sale, an outlined button See all shoes and a Read the story swipe-up link pinned to the bottom." /></p>
<p>The screenshot above shows how text, an emoji, a shape, two buttons and a swipe-up link look to a visitor in the viewer. Poll, quiz, rating, countdown, promo code and reaction have their own page: <a routerLink="/interactive-components">Interactive components</a>.</p>
<h2 id="autosave-and-publish">Autosave and publish</h2>
<p>Studio saves a draft as you work. Visitors keep seeing the last published version until you click <strong>Update tale</strong>. You can discard the draft, and duplicate or copy a document.</p>
<h2 id="accessibility-checks">Accessibility checks</h2>
<p>Studio warns about text with a contrast ratio below 4.5:1, about elements outside the safe area, and about images with no alt text.</p>
<h3 id="example-fixing-a-low-contrast-heading">Example: fixing a low-contrast heading</h3>
<ol>
<li>Click <strong>Heading</strong> in the Elements palette and change its text.</li>
<li>Studio saves ("All changes saved"), but the status says changes are not updated yet.</li>
<li>Click <strong>Update tale</strong>. Studio confirms that visitors now see this version.</li>
</ol>
<p><img class="guide-img" alt="Heading with a low-contrast warning" src="guides/images/12-studio-heading-low-contrast.png" width="1280" height="800" /></p>
<p>White text on a light photo scored about 1.2:1. Set the text <strong>Background</strong> to <strong>Highlight behind each line</strong> (or <strong>Solid box</strong>) with a dark colour (black in the example). The panel then reads "Contrast 21.0:1 against its highlight".</p>
<p><img class="guide-img" alt="After the fix" src="guides/images/14-studio-heading-fixed.webp" width="1280" height="800" />
<img class="guide-img" alt="The fixed heading in the viewer" src="guides/images/13-viewer-with-heading.webp" width="430" height="800" /></p>
<p>Only the Heading element was exercised by hand for these guides. The other elements are described from the source.</p>
  `,
})
export class TaleStudioPage {}
