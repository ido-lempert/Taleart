import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EXTERNAL_USER_ID_HEADER } from '@taleart/contract/core';
import { DOCS_EXTERNAL_USER_ID_SCRIPT, DOCS_TAGS_SCRIPT } from '../docs-content';

/**
 * Targeting (epic targeting R10, started by story 5.4): tags with Any and All, user lists matched by
 * the viewer's external user ID, what TaleArt stores, and that targeting is not access control.
 * Story 5.10 completes it with segments and the native SDK.
 */
@Component({
  selector: 'docs-targeting',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Targeting</h1>
    <p class="lede">
      A tale group can show to some viewers only: by <strong>targeting tags</strong>, by <strong>user lists</strong>, or
      both. You set them in the group's <strong>Audience</strong> (its ⋯ menu); a group with neither shows to everyone.
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
}
