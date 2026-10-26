import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'docs-import-from-another-tool',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Import from another stories tool</h1>
<p>Admins can import stories from a competing stories product into a TaleArt project. Open <strong>Projects</strong>, then <strong>Import</strong>.</p>
<p><img class="guide-img" alt="The import page" src="guides/images/21-import.png" /></p>
<h2 id="what-you-need">What you need</h2>
<p>An API token from the other product. TaleArt uses it only for the import and deletes it when the import ends.</p>
<h2 id="what-is-imported">What is imported</h2>
<ul>
<li>Each app instance becomes a <strong>zone</strong> with its tale groups and tales.</li>
<li>Labels become <strong>tags</strong>.</li>
</ul>
<h2 id="what-is-not-imported">What is not imported</h2>
<p>By design, conversion records and statistics are not imported.</p>
<h2 id="notes">Notes</h2>
<p>The importer runs only if the server has an import key configured. The page says so when it does not (the screenshot above is from a local install without one). The import was not run end to end for these guides.</p>
  `,
})
export class ImportFromAnotherToolPage {}
