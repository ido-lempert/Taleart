import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EXTERNAL_USER_ID_HEADER } from '@taleart/contract/core';
import { DOCS_EXTERNAL_USER_ID_SCRIPT, DOCS_TAGS_SCRIPT, EXAMPLE_INSTALL } from '../docs-content';

// The audience-rule examples: a rule saved in the group's Audience, and the page that tells the SDK the viewer's properties.
const SDK_URL = EXAMPLE_INSTALL.sdkUrl;
function personaPage(call: string): string {
  return ['<script type="module">', `  import { setProperties } from '${SDK_URL}';`, `  ${call}`, '</script>'].join('\n');
}
const PERSONA_RULES = {
  pro: JSON.stringify({ match: 'all', conditions: [{ property: 'plan', operator: 'eq', value: 'pro' }] }, null, 2),
  adults: JSON.stringify(
    {
      match: 'all',
      conditions: [
        { property: 'plan', operator: 'eq', value: 'pro' },
        { property: 'age', operator: 'gte', value: 30 },
      ],
    },
    null,
    2,
  ),
  loyal: JSON.stringify(
    {
      match: 'any',
      conditions: [
        { property: 'tier', operator: 'in', value: ['gold', 'platinum'] },
        { property: 'points', operator: 'gte', value: 5000 },
      ],
    },
    null,
    2,
  ),
};
const PERSONA_PAGES = {
  pro: personaPage("setProperties({ plan: 'pro' });"),
  adults: personaPage("setProperties({ plan: 'pro', age: 34 });"),
  loyal: personaPage("setProperties({ tier: 'gold', points: 6200 });"),
};

/**
 * Targeting (epic targeting R10, started by story 5.4): tags with Any and All, user lists matched by
 * the viewer's external user ID, what TaleArt stores, and that targeting is not access control.
 * Story 5.10 completes it with segments and the native SDK.
 */
@Component({
  selector: 'docs-targeting',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Targeting</h1>
    <p class="lede">
      A tale group can show to some viewers only: by <strong>targeting tags</strong>, by <strong>user lists</strong>,
      by <strong>viewer properties</strong> (an audience rule), or several of them. You set them in the group's
      <strong>Audience</strong> (its ⋯ menu); a group with none of them shows to everyone.
    </p>

    <h2 id="tags">Targeting tags</h2>
    <p>
      A group's tags combine with <strong>Any</strong> (the default: one of them is enough) or <strong>All</strong>. The
      page tells the SDK the viewer's tags, and the SDK decides in the browser: tags are never sent to TaleArt. A page
      that passes no tags shows every group, tagged or not.
    </p>
    <pre tabindex="0" role="region" aria-label="Setting the viewer's tags"><code>{{ tagsScript }}</code></pre>

    <h2 id="user-lists">User lists and the external user ID</h2>
    <p>
      A <strong>user list</strong> holds your site's own IDs for its users, uploaded on the Audience page as a CSV with
      one ID per row. A group targeted to user lists shows only to a viewer whose <strong>external user ID</strong> is
      in one of them, and whose tags also pass the group's tag rule. A viewer with no ID, or one in none of its lists,
      does not get the group at all: the Delivery API leaves it out of the response.
    </p>
    <p>Tell the SDK who the viewer is once for the page, for example after sign-in:</p>
    <pre tabindex="0" role="region" aria-label="Setting the external user ID"><code>{{ idScript }}</code></pre>
    <ul>
      <li>
        Use an <strong>opaque ID</strong> from your own system, never an email address or a phone number. The ID is
        trimmed and matched exactly: case counts, and any Unicode text works.
      </li>
      <li>
        The SDK sends it to the Delivery API in the <code>{{ header }}</code> request header, as base64url of its UTF-8
        bytes, and never in a URL. It keeps the ID in memory only: not in storage or a cookie.
      </li>
      <li>Every zone on the page loads again with the new ID. <code>setExternalUserId(null)</code> sends none again.</li>
      <li>
        A group targeted only to user lists that hold no ID reads <em>Not visible: its user lists are empty</em> in the
        dashboard, and nobody sees it until a list has an ID.
      </li>
    </ul>

    <h2 id="viewer-properties">Viewer properties and audience rules</h2>
    <p>
      A <strong>viewer property</strong> is a fact your site already knows about the viewer: a plan, an age, a tier, a
      list of interests. An <strong>audience rule</strong> on a tale group compares those properties, and the group shows
      only to viewers whose properties pass it. Set the properties on the page with the Web SDK or in the native SDK, and
      the rule in the group's <strong>Audience</strong>. Both are checked on the device, never on the server.
    </p>

    <h3 id="properties-or-tags">Properties or tags?</h3>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Properties or tags"><table>
      <caption>Which to use</caption>
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Use</th>
          <th scope="col">Why</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>The viewer belongs to a named group you label, such as <code>vip</code> or <code>summer</code></td>
          <td>Tags</td>
          <td>One label per segment, set with <code>setTags</code>. A group's tags combine with Any or All.</td>
        </tr>
        <tr>
          <td>You compare a value: a plan, a number at least 30, a tier in a list, a date before a cut-off</td>
          <td>Viewer properties (audience rule)</td>
          <td>Typed values and operators. One rule per group, on top of its tags.</td>
        </tr>
        <tr>
          <td>The viewer is one of your known users, by your own ID</td>
          <td>User lists</td>
          <td>Matched on the server by the external user ID. The list is stored as hashes only.</td>
        </tr>
        <tr>
          <td>Several of the above</td>
          <td>Combine them</td>
          <td>A group shows only when its tags, its audience rule and its user lists all pass.</td>
        </tr>
      </tbody>
    </table></div>

    <h3 id="property-types">Property types and limits</h3>
    <ul>
      <li>
        <strong>Names</strong>: 1 to 64 characters, starting with a letter, then letters, digits, <code>_</code>,
        <code>.</code> or <code>-</code>. Names are case-sensitive: <code>Plan</code> and <code>plan</code> differ.
      </li>
      <li>
        <strong>Values</strong>: text (up to 256 characters), a number, a boolean (<code>true</code> or
        <code>false</code>), or a list of text values (up to 50 items).
      </li>
      <li>
        <strong>Up to 50 properties</strong> per page. Dates are passed as epoch milliseconds (a number), then compared
        with <code>gt</code>, <code>lt</code> and the others.
      </li>
      <li>
        An invalid entry is dropped, and the Web SDK logs one console warning that names it. The native SDKs ignore it.
      </li>
      <li>
        <strong>An audience rule</strong> has <em>match</em> <code>all</code> (every condition must pass) or
        <code>any</code> (one is enough), and 1 to 10 conditions. Conditions do not nest.
      </li>
    </ul>

    <h3 id="operators">Operators</h3>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Operators"><table>
      <caption>The eleven operators</caption>
      <thead>
        <tr>
          <th scope="col">Operator (dashboard label)</th>
          <th scope="col">Meaning</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        <tr><td><code>eq</code> (is)</td><td>The viewer's value equals the value</td><td>Text, number or boolean</td></tr>
        <tr><td><code>neq</code> (is not)</td><td>The viewer's value differs from the value</td><td>Text, number or boolean</td></tr>
        <tr><td><code>in</code> (is one of)</td><td>The viewer's value is one of the listed values</td><td>A list</td></tr>
        <tr><td><code>notIn</code> (is not one of)</td><td>The viewer's value is none of the listed values</td><td>A list</td></tr>
        <tr><td><code>gt</code> (is more than)</td><td>Greater than</td><td>A number</td></tr>
        <tr><td><code>gte</code> (is at least)</td><td>Greater than or equal to</td><td>A number</td></tr>
        <tr><td><code>lt</code> (is less than)</td><td>Less than</td><td>A number</td></tr>
        <tr><td><code>lte</code> (is at most)</td><td>Less than or equal to</td><td>A number</td></tr>
        <tr><td><code>contains</code></td><td>Text contains the text, or a list contains the item</td><td>Text</td></tr>
        <tr><td><code>exists</code> (is set)</td><td>The property is set</td><td>None</td></tr>
        <tr><td><code>notExists</code> (is not set)</td><td>The property is not set</td><td>None</td></tr>
      </tbody>
    </table></div>

    <h3 id="evaluation">How a viewer is checked</h3>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Evaluation rules"><table>
      <caption>Evaluation rules</caption>
      <thead>
        <tr>
          <th scope="col">Situation</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>The group has no audience rule, or an empty one</td><td>Passes</td></tr>
        <tr><td>The page passes no properties (never set, or <code>setProperties(null)</code>)</td><td>Every rule passes, so the page behaves as before the feature</td></tr>
        <tr><td>The page passes properties, even an empty object</td><td>Each condition is checked</td></tr>
        <tr><td>The property is missing</td><td>The condition is false, except <code>neq</code>, <code>notIn</code> and <code>notExists</code>, which are true</td></tr>
        <tr><td>The value has another type (<code>gt</code> on text, a number compared with text)</td><td>The condition is false</td></tr>
        <tr><td>Text is compared with <code>eq</code>, <code>in</code> or <code>contains</code></td><td>Ignoring case and surrounding spaces. Numbers and booleans compare exactly.</td></tr>
        <tr><td>The group has tags, an audience rule and user lists</td><td>All three must pass</td></tr>
      </tbody>
    </table></div>

    <h3 id="examples">Three examples</h3>
    <h4 id="example-pro">Pro members</h4>
    <p>The group shows to viewers on the pro plan. The rule is saved in the group's Audience:</p>
    <pre tabindex="0" role="region" aria-label="Rule for pro members"><code>{{ personaRules.pro }}</code></pre>
    <p>The page tells the SDK the viewer's properties, after sign-in:</p>
    <pre tabindex="0" role="region" aria-label="Page for pro members"><code>{{ personaPages.pro }}</code></pre>

    <h4 id="example-adults">Pro members aged 30 and over</h4>
    <p>Two conditions, both must pass. The dashboard shows the rule as <em>for viewers where plan is pro and age is at least 30</em>.</p>
    <pre tabindex="0" role="region" aria-label="Rule for pro members aged 30 and over"><code>{{ personaRules.adults }}</code></pre>
    <pre tabindex="0" role="region" aria-label="Page for pro members aged 30 and over"><code>{{ personaPages.adults }}</code></pre>

    <h4 id="example-loyal">Gold or platinum, or many points</h4>
    <p>Either condition is enough: a tier in a list, or a number of points at least 5000.</p>
    <pre tabindex="0" role="region" aria-label="Rule for loyal viewers"><code>{{ personaRules.loyal }}</code></pre>
    <pre tabindex="0" role="region" aria-label="Page for loyal viewers"><code>{{ personaPages.loyal }}</code></pre>

    <h3 id="editor">The audience rule in the dashboard</h3>
    <p>
      Open <strong>Tale groups</strong>, then the group's ⋯ menu, then <strong>Audience</strong>. The Audience rule holds
      one row per condition: a property, an operator and a value, and <em>Add condition</em> for another. <em>Try it</em>
      takes the properties a sample viewer has, as JSON, and says whether the group would show to that viewer. The group's
      row keeps the rule in its visibility line.
    </p>
    <figure>
      <img
        src="images/audience-shot-editor.png"
        alt="The Audience drawer of the group Pro members: the rule's second condition, age is at least 30, and the Try it box with a sample viewer whose plan is pro and whose age is 34, with the result that the group would show."
        width="420"
        height="960"
      />
      <figcaption>The Audience drawer of a group, with a saved rule and a sample viewer tried in Try it.</figcaption>
    </figure>
    <figure>
      <img
        src="images/audience-shot-summary.png"
        alt="The group row Pro members in the dashboard, with its visibility line: visible on site in at least one zone, for viewers where plan is pro and age is at least 30."
        width="1030"
        height="72"
      />
      <figcaption>The group's row: who the group is for, under its visibility line.</figcaption>
    </figure>

    <h3 id="bars-and-banners">Bars and banners</h3>
    <p>
      A rule applies to <strong>bars and banners</strong> alike. A banner's slides are tale groups, so each slide is shown or
      left out by its own rule, and a banner with no slide left for a viewer shows nothing. The same zone can therefore show
      a free viewer one group and a pro viewer another, in either form. The <a routerLink="/web-guide">Web guide</a> has the
      real screenshots.
    </p>

    <h3 id="viewer-privacy">Privacy</h3>
    <ul>
      <li>
        <strong>The rule is public.</strong> It is delivered with the zone to every viewer, as tag names are. Keep private
        content out of rule values: use an opaque segment, such as <code>tier</code> set to <code>gold</code>, never an
        email address, a health or a financial fact.
      </li>
      <li>
        <strong>The viewer's properties are never sent to TaleArt.</strong> The rule is checked in the browser or the app,
        against the properties the page holds. No request, header or analytics field carries them, and TaleArt does not
        store them.
      </li>
      <li>
        <strong>Targeting is not access control</strong>, as for tags: the tales of a group are public media, and
        anyone with a zone key can see which groups come back for the properties they try.
      </li>
    </ul>

    <h2 id="privacy">What TaleArt stores, and how to delete it</h2>
    <ul>
      <li>
        <strong>User lists</strong>: each ID only as a keyed hash (HMAC-SHA-256) under a random secret of the project,
        never in clear. The dashboard shows how many IDs a list holds, never which, and cannot export them. The CSV is
        read as it arrives and not kept.
      </li>
      <li>
        <strong>The project's secret</strong>, created with its first list and deleted with its last.
      </li>
      <li>
        <strong>Which groups use which lists</strong>. Deleting a list deletes it and all its hashes at once, for good,
        and removes it from every group. A group targeted only to that list does not turn public: it reads
        <em>Not visible: its user lists were removed</em> and shows to nobody until someone changes its Audience. A
        copy to another project leaves its lists behind and is held the same way.
      </li>
      <li>
        <strong>Nothing about the viewer</strong>: the Delivery API hashes the ID for the lookup and drops it. It is
        not logged, stored or linked to the device's visitor id. A response to a request with the ID is
        <code>Cache-Control: private, no-store</code>, with no ETag, so no browser or shared cache keeps one viewer's
        groups for another.
      </li>
      <li>Deleting a project deletes its lists. Database backups are yours to rotate.</li>
    </ul>

    <h2 id="not-access-control">Targeting is not access control</h2>
    <p>
      Targeting decides what a page shows, not who may see it. The tales of a targeted group are public media, and
      anyone with a zone key can try IDs and see which groups come back. Answers to a tale's polls, quizzes and
      ratings are accepted for any delivered tale without checking its user lists. Do not use targeting to protect
      content, and keep anything private out of tag and list names.
    </p>
  `,
})
export class TargetingPage {
  protected readonly tagsScript = DOCS_TAGS_SCRIPT;
  protected readonly idScript = DOCS_EXTERNAL_USER_ID_SCRIPT;
  protected readonly header = EXTERNAL_USER_ID_HEADER;
  protected readonly personaRules = PERSONA_RULES;
  protected readonly personaPages = PERSONA_PAGES;
}
