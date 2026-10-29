import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-guides-create-campaign',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Create a campaign</h1>
<p>A campaign is a <strong>zone</strong> (a spot on your site) that shows <strong>tale groups</strong> (one circle in a bar), each made of <strong>tales</strong> (full-screen pages of image, video and text). See <a routerLink="/concepts">Concepts</a> for the glossary.</p>
<h2 id="create-the-zone">Create the zone</h2>
<ol>
<li>Zones, then <strong>New zone</strong>.</li>
<li>Name it (example: "Home - top"). The slug (<code>home-top</code>) is made from the name if left empty. Pick a template: Stories bar, Promo banner or Blank.</li>
</ol>
<p><img class="guide-img" alt="A new zone, not yet visible" src="guides/images/03-zone-new.png" width="1280" height="800" /></p>
<p>The page shows why a zone is not visible yet, and a checklist: choose a display, issue the zone key on the zone's Install tab, turn a tale group On with a shown tale.</p>
<h2 id="add-tale-groups">Add tale groups</h2>
<ol>
<li><strong>New tale group</strong>, give it a name, and upload an image or video: each file becomes a tale. New tales are Shown.</li>
<li>Turn the group <strong>On</strong>. New groups start Off.</li>
</ol>
<p>In the furniture example we made three groups: Summer sale, New arrivals and Staff picks. Each has two tales, and each tale has its own generated sample illustration.</p>
<p><img class="guide-img" alt="Three tale groups, all On and visible on site" src="guides/images/04-tale-groups.png" width="1280" height="800" /></p>
<p>Open a group to see its tales. Each uploaded file is one tale, shown by default, with an <strong>Add tale</strong> button.</p>
<p><img class="guide-img" alt="Tale group page with its tales and Add tale" src="guides/images/09-tale-group.png" width="1280" height="800" /></p>
<p>Click a tale to open its panel: Shown/Hidden, Archive, Delete, Replace media, and <strong>Edit in Tale Studio</strong>.</p>
<p><img class="guide-img" alt="Tale panel" src="guides/images/10-tale-panel.png" width="1280" height="800" /></p>
<p>Tale Studio opens the tale on a canvas with an Elements palette (text, image, video, shapes, emoji, stickers, buttons, polls and more), Templates, Media and Layers, a Safe area toggle, Undo/Redo, Preview, and <strong>Update tale</strong>, which puts your changes on the site (until then visitors see the previous version).</p>
<p><img class="guide-img" alt="Tale Studio" src="guides/images/11-tale-studio.png" width="1280" height="800" /></p>
<h3 id="add-a-heading-and-publish-the-change">Add a heading and publish the change</h3>
<ol>
<li>In the Elements palette, click <strong>Heading</strong>. It lands on the canvas. Change the text in the <strong>Text</strong> box on the right (up to 1,000 characters).</li>
<li>Studio saves as you work ("All changes saved") but visitors still see the old version: the status says "changes not updated yet".</li>
<li>Click <strong>Update tale</strong>. Studio confirms "Tale updated. Visitors now see this version."</li>
</ol>
<p><img class="guide-img" alt="Studio with the heading edited: low contrast warning" src="guides/images/12-studio-heading-low-contrast.png" width="1280" height="800" /></p>
<p>Studio warns about low contrast here (white text on a light photo, about 1.2:1). Fix it in the text's style panel: set <strong>Background</strong> to <strong>Highlight behind each line</strong> (or <strong>Solid box</strong>) and pick a dark colour (black in the example). The panel then reads "Contrast 21.0:1 against its highlight". Also make the text box tall enough for the text (we set Top 36%, Height 24%), then click <strong>Update tale</strong> again.</p>
<p><img class="guide-img" alt="Studio after the fix" src="guides/images/14-studio-heading-fixed.webp" width="1280" height="800" /></p>
<p>The fixed heading shows in the viewer on the example website:</p>
<p><img class="guide-img" alt="Readable heading in the viewer on the demo site" src="guides/images/13-viewer-with-heading.webp" width="430" height="800" /></p>
<p>Only the Heading element was tested. Other elements (images, shapes, buttons, polls, Templates, Media, Layers) were not exercised.</p>
<p>A group, and each tale, can also be scheduled (the ... menu) so it only shows in a time window.</p>
<h2 id="check-visibility">Check visibility</h2>
<p>Every zone, group and tale says "Visible on site" or "Not visible" with the first reason. The Display tab sets bar or banner options.</p>
<p><img class="guide-img" alt="Display tab" src="guides/images/06-display-tab.png" width="1280" height="800" /></p>
  `,
})
export class GuidesCreateCampaignPage {}
