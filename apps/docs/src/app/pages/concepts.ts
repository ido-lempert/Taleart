import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GLOSSARY } from '../docs-content';

@Component({
  selector: 'docs-concepts',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Concepts</h1>
    <p class="lede">The words the dashboard, the Web SDK and these docs use, and what each one means.</p>

    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="glossary-caption">
      <table id="glossary">
        <caption id="glossary-caption">Glossary</caption>
        <thead>
          <tr>
            <th scope="col">Term</th>
            <th scope="col">Meaning</th>
            <th scope="col">Example</th>
          </tr>
        </thead>
        <tbody>
          @for (entry of glossary; track entry.term) {
            <tr>
              <th scope="row">
                {{ entry.term }}
                @if (entry.was) {
                  <div class="muted">was {{ entry.was }}</div>
                }
              </th>
              <td>{{ entry.definition }}</td>
              <td>{{ entry.example }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2>How they fit together</h2>
    <p>
      A project has zones and tale groups. Each zone has one display and shows tale groups in an order you set; one tale
      group can show in several zones. A tale group holds tales. The project's theme styles every zone, and a page
      places a zone with the project's site key and the zone's slug.
    </p>

    <h2>On and Off, Shown and Hidden</h2>
    <ul>
      <li>A tale group is <strong>On</strong> or <strong>Off</strong>. New groups start Off.</li>
      <li>
        A tale is <strong>Shown</strong> or <strong>Hidden</strong>. New tales start Shown, so turning a group On shows
        all its tales; hide a tale to leave it out.
      </li>
      <li>Archive sits in a group's or a tale's ⋯ menu.</li>
      <li>
        A schedule (also in the ⋯ menu) limits when a group or a tale shows. A chip shows the window, such as
        "Starts 1 Dec 09:00".
      </li>
      <li>
        In Tale Studio, <em>Update tale</em> puts your changes on the site; until then visitors see the version
        before.
      </li>
    </ul>

    <p>
      Earlier builds placed zones differently:
      <a routerLink="/moving-from-stages">Stages and zone keys</a> says what changed.
    </p>
  `,
})
export class ConceptsPage {
  protected readonly glossary = GLOSSARY;
}
