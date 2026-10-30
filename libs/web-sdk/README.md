# web-sdk

The TaleArt Web SDK: a `<taleart-view>` custom element that renders a zone's display (a bar or a banner) and opens its
tale groups in a full-screen viewer, reading published content from the Delivery API with the zone's key (`tak_…`).

## Terms

These are the words the dashboard and the docs app use (the UX review's glossary):

| Term | Meaning |
| --- | --- |
| Project | Your app or site: its zones, tale groups, theme and fonts. |
| Zone | One spot in your app or site where tales appear, named on a page by its slug (`home-top`). |
| Display | How a zone looks: a bar or a banner, plus its settings. One per zone (the API and code call it a frame). |
| Template | A preset picked when a zone is created (Stories bar, Promo banner, Blank). It sets the display once. |
| Tale group | A set of tales shown as one item: one circle in a bar or one slide in a banner. On or Off. |
| Tale | One full-screen page of a group, made in Tale Studio. Shown or Hidden. |
| Theme | Colours, rings and fonts for every zone of the project. |
| Zone key | The key of one zone (`tak_…`), issued in the dashboard. It names the zone on a host page and is the only key the page holds. |

## Placing a zone

The zone page's Install tab in the dashboard gives this snippet for its zone, with the API URL and the zone key filled in
(the key is shown once, when it is issued):

```html
<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>
<!-- Optional, once per page: <script>Taleart.init({ locale: "en" })</script> -->
<taleart-view zone-key="YOUR_ZONE_KEY"></taleart-view>
```

The script loads from the API, so its origin is the default API URL; with the npm package (no script origin) pass
`apiUrl` to `init`. `zone-key` is the only attribute an element needs. A zone has one active key: rotating it issues a new one and revokes
the old, and revoking it takes the zone off every page that places it. A refused, rotated or revoked key renders nothing
and logs one console error per element.

Several zones on one page take one script tag and one element per zone, each with its own key:

```html
<taleart-view api-url="https://api.example.com" zone-key="tak_YOUR_PROMO_KEY"></taleart-view>
<taleart-view api-url="https://api.example.com" zone-key="tak_YOUR_TOP_KEY"></taleart-view>
```

Elements that ask for the same zone at the same time share one request. Rotating a key affects only its zone: update the
page that places it.

The Install tab also has a Copy button and an "Open test page" link (below).

- **Where the SDK comes from.** The TaleArt API serves this package's ES build at `<api-url>/sdk/v1/taleart.js`: the
  API build copies `dist/libs/web-sdk/index.js` next to its `main.js` (`WEB_SDK_FILE` names another file). The `v1`
  follows the Delivery API's version: the bundle there always reads `/delivery/v1`. A deploy replaces it at the same
  URL; it is cached for five minutes, and a running API serves a rebuilt file at once. Deploy a new file atomically:
  write it elsewhere on the same disk, then rename it over the old one (the API reads again a file that changes while
  it reads it, but never keeps half of one). A site may also host the file itself, or install the npm package.
- **Pinning it.** The same build is also served at a URL pinned to its content, `<api-url>/sdk/v1/taleart.<hash>.js`,
  cached for a year. The zone page's Install tab shows that URL and its Subresource Integrity value, each with a Copy
  button, and copies the whole tag, for a page that wants the browser to refuse any other file:
  `<script type="module" src="…/taleart.<hash>.js" integrity="sha384-…" crossorigin="anonymous">`
  (`GET <api-url>/api/v1/install` gives them too, as `sdkPinnedUrl` and `sdkIntegrity`, with `sdkBuildsKept`, to a
  signed-in user). By default the API keeps the last 5 SDK builds this server served at their pinned URLs, the
  current one included, so a pinned page keeps working through the next 4 SDK builds the server serves; update the
  pin before then. The Install tab says the server's own number. With only the current build kept, a pinned URL
  stops working at the next SDK build. An older or unknown hash answers 404, which no cache keeps.
  - For the people who run TaleArt: the API writes each build it serves to `SDK_BUILDS_DIR`, at start and once the
    bundle file has not changed for a second, and deletes the oldest beyond `SDK_BUILDS_KEPT` (default 5, from 2 to
    100: during a rolling deploy an old and a new process each keep their build). Unset or empty, the folder is
    `.data/sdk-builds` from the folder the API starts in, outside the build output, which a rebuild replaces.
    `off` (or `false`, `none`, `no`, `0`, in any case) keeps only the current build. The folder must persist across
    deploys (a volume, in a container) and be shared by every API process that serves the same URLs, on hosts whose
    clocks are in sync (the newest build is the most recently written file). In production the API warns at start
    when the folder holds no build.
- **The test page.** `<api-url>/sdk/v1/test-page?zone=<slug>` renders one zone with this SDK. It reads the site key
  from the URL fragment (`#siteKey=…`, which a browser never sends to a server) and removes it from the address bar,
  or from a field on the page. It stores the key nowhere and sends it only in the SDK's `Authorization` header to the
  Delivery API. It is served with a strict Content Security Policy (scripts from the API only), `noindex` and no
  referrer.

An element renders with its zone key alone (`zone-key`, or `zoneKey`). Put the key only in the attribute or the property,
never in a query string: the SDK sends it only in the `Authorization` header. The key is a credential for reading its
zone, not access control for the zone's content: anyone who sees it in a page can read what the zone shows, so treat a
visible zone as public. The Delivery API limits how often one visitor may ask (by
default bursts of 600, then 20 a second), and one address ten times that in all; over the limit it answers 429, and
the element renders nothing and logs one console error. A flood from one device behind a shared network (a NAT, such
as an office or a mobile carrier) can use up that address's allowance for everyone behind it. Whoever runs the API must
set `TRUST_PROXY` to exactly the proxies in front of it: otherwise every client is counted as the proxy's address and
they all share one allowance.

**The visitor id.** Each browser gets a visitor id: a random UUID v4 the SDK makes once and keeps in the host page's
local storage under `taleart.visitor`. It is random, not derived from the person or the device, and tied to no account,
but it is a stable identifier of a browser, so cover it in your privacy notice and in your consent setup like other
local storage. The SDK sends it only to the Delivery API, in the `X-TaleArt-Visitor` header, which limits requests per
visitor rather than per address, so many visitors behind one network each get their own allowance, and counts each
visitor's answer to a poll, a quiz, a Rating or a Reaction once (answering needs the id); proxies, CDNs and
access logs in front of the API can see the header too. Clearing the site's data makes a new one, and Safari may clear
script-written storage after seven days without a visit. Where local storage is blocked, the id lasts one page load; a
request without an id is limited by its address. The native SDKs keep the same kind of id in the SDK's own device store
(the `taleart-sdk` SharedPreferences on Android, the `taleart-sdk` NSUserDefaults suite on iOS). Clearing the app's
data makes a new one, and so does a reinstall, unless a device backup restores it: Android Auto Backup and iOS backups
restore that store, so an app that wants a fresh id after a reinstall excludes `sharedpref/taleart-sdk.xml` in its
Android backup rules (`android:fullBackupContent` and `android:dataExtractionRules`).

<!-- docs-check:removed -->
### The `stage` attribute and the `site-key` attribute

Zone keys are back (SDK v2; they were removed for a while in the zone rework, story 8.7). The `stage="…"` attribute
is gone: it is ignored. The `site-key` attribute, and the `siteKey` property, are no longer read: an element that
has one logs one console warning and places nothing with it. To move a page, replace the element with the Install
tab's snippet for its zone, which names it with `zone-key`.
<!-- /docs-check:removed -->

Loading the SDK registers `<taleart-view>`. The ES build exports the API below; the UMD build puts the same exports on
`window.TaleartWebSdk`.

| Attribute / property | Meaning |
| --- | --- |
| `api-url` / `apiUrl` | The TaleArt API origin. Default: the origin the script loads from (see `init`). |
| `zone-key` / `zoneKey` | The zone's key (`tak_…`), issued in the dashboard. Required: the element renders nothing without it. |
| `locale` / `locale` | This element's locale (BCP 47, such as `he-IL`). Default: the SDK's locale (see `init`). |
| `theme` / `theme` | Theme fields for this element (JSON in the attribute, an object in the property); see below. |
| `fallback` / `fallback` | What this element shows when its zone fails to load: `none` (default) or `message` (the SDK's text and a retry button). See Load failures. |
| `frequency` / `frequency` | How often a viewer sees a tale group of this element: `once`, `daily`, `weekly` or a whole number from 1 to 50. Default none. See Frequency cap. |
| `analytics` / `analytics` | `off` stops this element's analytics events. Any other value, or none, leaves it to the SDK's `analytics` option. See Analytics. |
| `dir` / `dir` | The reading direction of this element: `ltr` or `rtl` set it; `auto` (the default) takes the page's. See Reading direction. |

Properties without an attribute:

| Property | Meaning |
| --- | --- |
| `zone` | The zone's slug, such as `home-top`, from the response. Set it only to name the zone's `configureZone` theme when the response does not carry the slug. |
| `strings` | This element's texts, per locale or flat, added to the SDK's `strings` (this element's win). See Locale and strings. |
| `hooks` | This element's hooks, called before the SDK's `hooks` (see Hooks). |

Methods: `retry()` reads the zone again after a failed load (see Load failures).

## Configuration: `Taleart.init`

The script sets `globalThis.Taleart`, with the functions below. `init(config)` (also a named export of the module) sets
the SDK's options, before or after the elements connect; elements that show a zone read the options again. Every
option is optional: an option left out keeps its value. `null` clears `locale`, `strings`, `theme`, `externalUserId`,
`tags`, `properties`, `hooks` and `frequency`, `fallback: null` means `none`, `analytics: null` means on, and `dir: null` means `auto`. An invalid option logs one console warning naming it and keeps its value.

| Option | Default | Meaning |
| --- | --- | --- |
| `apiUrl` | The origin the script loads from | The TaleArt API origin. An element's `api-url` wins. |
| `locale` | `document.documentElement.lang`, then `en` | The locale of the SDK's texts (BCP 47). An element's `locale` wins. |
| `strings` | none | Texts per locale, or flat for every locale (see Locale and strings). |
| `theme` | none | Theme fields for every element. A zone's `configureZone` theme and an element's own theme win over it. |
| `externalUserId` | none | The viewer's external user ID (see User lists). |
| `tags` | none | The viewer's targeting tags (see Targeting tags). |
| `properties` | none | The viewer's properties, for audience rules (see Viewer properties). |
| `hooks` | none | Hooks for every element (see Hooks). |
| `fallback` | `none` | What every element shows when its zone fails to load: `none` or `message` (see Load failures). An element's `fallback` wins. |
| `frequency` | none | How often a viewer sees a tale group: `once`, `daily`, `weekly` or a whole number from 1 to 50 (see Frequency cap). An element's `frequency` wins. |
| `analytics` | on | Whether elements report impressions, opens, tale views and clicks (see Analytics). `false` turns them off; an element's `analytics` attribute wins. |
| `dir` | `auto` | The reading direction of every element: `ltr`, `rtl`, or `auto` for the page's (see Reading direction). An element's `dir` attribute wins. |

```js
import { init } from 'https://api.example.com/sdk/v1/taleart.js';

init({
  locale: 'he-IL',
  strings: { he: { 'viewer.close': 'סגור' } },
  hooks: { onActionClicked: (event) => analytics.track('tale-cta', { url: event.url }) },
});
```

`setTags`, `setProperties`, `setProperty`, `setExternalUserId`, `configureZone` and `defineTaleartElement` remain, each the same as its `init` option (`setProperty` sets one property, see Viewer properties).

## Reading direction

The display and the viewer lay out in the reading direction of the page, so a right-to-left page (`<html dir="rtl">`, or
an element inside one) reverses the bar's order and scrolling, the banner's slides and dots, the viewer's tap zones,
arrow keys, swipes, progress and neighbouring groups. The arrows and chevrons turn with it; play, pause, close, emoji,
numbers, countdown digits, percentages and promo codes stay as they are (numbers and codes always read left to right).

To set the direction, use the `dir` attribute on one element, or `init({ dir })` for every element. An element's
attribute wins over the option, and `auto` (the default) takes the page's direction:

```html
<taleart-view zone-key="YOUR_ZONE_KEY" dir="rtl"></taleart-view>
```

```js
Taleart.init({ dir: 'rtl' });
```

The keys follow the visual direction too: in a right-to-left display the left arrow key goes to the next tale, the next
group, or the next banner slide.

## Locale and strings

The SDK's texts (the viewer's buttons, the banner's controls, the names it announces) are in English by default. The
locale comes from the element's `locale` attribute, else `init({ locale })`, else the page's `lang`, else `en`. A
text is looked up under the full locale (`he-IL`), then its language (`he`), then the flat `strings`, then English; a
key nobody defines shows English, never the key itself. A `{name}` in a text is filled in by the SDK.

```js
init({ locale: 'he', strings: { he: { 'viewer.close': 'סגור', 'bar.seen': '{name}, נצפה' } } });
```

```html
<taleart-view api-url="…" zone-key="tak_…" locale="he"></taleart-view>
```

| Key | English default |
| --- | --- |
| `viewer.close` | Close |
| `viewer.play` | Play |
| `viewer.pause` | Pause |
| `viewer.previousTale` | Previous tale |
| `viewer.nextTale` | Next tale |
| `viewer.previousGroup` | Previous |
| `viewer.nextGroup` | Next |
| `viewer.previousGroupName` | Previous group: {name} |
| `viewer.nextGroupName` | Next group: {name} |
| `viewer.progress` | {group}, tale {tale} of {count} |
| `viewer.taleFallback` | Tale {number} |
| `banner.label` | Banner |
| `banner.carousel` | carousel |
| `banner.slide` | slide |
| `banner.slideOf` | {index} of {count} |
| `banner.previousSlide` | Previous slide |
| `banner.nextSlide` | Next slide |
| `banner.showGroup` | Show {name} |
| `banner.stopRotation` | Stop automatic slide show |
| `banner.startRotation` | Start automatic slide show |
| `bar.seen` | {name}, seen |
| `load.failed` | Stories could not be loaded. |
| `load.retry` | Try again |
| `links.newTab` |  (opens in a new tab) |
| `poll.voted` | You voted {label}. |
| `poll.chose` | You chose {label}. |
| `poll.previewNotRecorded` | Votes are not recorded in the preview. |
| `poll.failed` | Your vote could not be sent. Try again. |
| `quiz.answered` | You answered {label}. |
| `quiz.right` | Right! You answered {label}. |
| `quiz.wrongAnswer` | Wrong: you answered {label}. The correct answer is {correct}. |
| `quiz.correct` |  correct answer |
| `quiz.wrong` |  wrong |
| `quiz.previewNotRecorded` | Answers are not recorded in the preview. |
| `quiz.failed` | Your answer could not be sent. Try again. |
| `rating.sliderLabel` | Your rating |
| `rating.valueText` | {value} out of {max} |
| `rating.ratedValueText` | You rated {value} out of {max} |
| `rating.sent` | You rated {value}. |
| `rating.previewRated` | You rated {value}. Ratings are not recorded in the preview. |
| `rating.failed` | Your rating could not be sent. Try again. |
| `rating.summary` | Average {average} from {total} {count} |
| `rating.singular` | rating |
| `rating.plural` | ratings |
| `countdown.ended` | Ended |
| `countdown.days` | Days |
| `countdown.hours` | Hours |
| `countdown.minutes` | Min |
| `countdown.seconds` | Sec |
| `promo.copy` | Copy |
| `promo.copied` | Copied |
| `promo.copyFailed` | Could not copy. Select the code and copy it yourself. |
| `reaction.count` | Reactions: {count} |
| `reaction.failed` | Your reaction could not be sent. Try again. |
| `preview.stop` | Stop preview |
| `preview.size.small` | Small |
| `preview.size.default` | Default |
| `preview.size.large` | Large |

## Hooks

Hooks let the host page follow what the SDK does. Set them for every element with
`init({ hooks })`, or for one element with its `hooks` property; both run, the element's first, then the global one,
and each hook may also be an `onEvent` that gets every event. A hook's exception is logged with `console.error` and
never breaks the viewer.

```js
init({
  hooks: {
    onLoaded: (e) => console.log('zone', e.zoneSlug),
    onGroupImpression: (e) => track('group_seen', e.group.id),
    onActionClicked: (e) => {
      // Stop the navigation and route it in the host's own app.
      if (e.url.startsWith('https://shop.example.com/')) {
        e.preventDefault();
        router.push(new URL(e.url).pathname);
      }
    },
  },
});
```

| Hook | When it fires | Payload (besides `name`, `zoneKeyPrefix`, `zoneSlug`) |
| --- | --- | --- |
| `onLoaded` | The zone was read. Once per load. | none |
| `onLoadFailed` | The zone could not be read: a refused or unknown key, a network failure, a bad answer. | `error` (the message) |
| `onGroupImpression` | A group's bar item or banner slide first is half on screen. Once per group per load. | `group` |
| `onPresented` | The full-screen viewer opened. | `group` |
| `onTaleShown` | A tale came on screen in the viewer. | `group`, `tale` |
| `onActionClicked` | A button, an image button or the swipe-up link was activated, before it navigates. Cancelable. | `group`, `tale`, `component` (`id`, `type`), `url`, `newTab`, `preventDefault()` |
| `onUserInteracted` | The server accepted a poll, quiz, Rating or Reaction answer. | `group`, `tale`, `component` (`id`, `type`, `value`) |
| `onComponentEvent` | A component of a tale did something: a countdown `ended`, a promo code was `copied`, a poll, quiz, Rating or Reaction answer was `selected`. Fires with `userInteracted` for an answer, and reaches `onEvent`. | `groupId`, `taleId`, `component` (the element type, such as `countdown`), `action`, `value` (the promo code, the option id, the answer id, the Rating's number or the Reaction's emoji, when there is one) |
| `onDismissed` | The viewer closed. | `group` |
| `onGroupCapped` | The frequency cap left a tale group out of the display. Once per group per render. | `groupId`, `rule` |
| `onEvent` | Every event above, in one stream. | the same as the event |

- `group` is `{ id, name, index }` (its position in the zone, from 0); `tale` is `{ id, index, title }` (its position in
  the group, from 0).
- `zoneKeyPrefix` is the first 8 characters of the zone key (`tak_abc…`); the full key is never in an event.
- `preventDefault()` on `actionClicked` stops the navigation, for a link: the host routes it. It works from the hook,
  or from a `taleart:action-clicked` listener on the element.

Each event is also a DOM event on the `<taleart-view>` element: bubbling and composed, named `taleart:` and the event's
name in kebab case (`taleart:load-failed`, `taleart:group-impression`, `taleart:tale-shown`, `taleart:action-clicked`,
`taleart:user-interacted`, `taleart:group-capped`, `taleart:component-event`). Its `detail` is the payload. Only `taleart:action-clicked` is cancelable.

```js
document.querySelector('taleart-view').addEventListener('taleart:user-interacted', (e) => {
  console.log(e.detail.component.id, e.detail.component.value);
});
```

## Load failures

When the zone cannot be read (a refused, rotated or revoked key, a network failure, a bad answer) the element renders
nothing by default and `onLoadFailed` fires. To show something in its place, use either of two things:

- A child of the element with `slot="fallback"`: your own markup, shown instead of the zone. It wins over `fallback`.

```html
<taleart-view zone-key="YOUR_ZONE_KEY">
  <p slot="fallback">Stories are unavailable right now.</p>
</taleart-view>
```

- `fallback="message"` (an attribute, or `init({ fallback: 'message' })`; the element's attribute wins): the SDK's
  text `load.failed` ("Stories could not be loaded.") and a button labelled `load.retry` ("Try again") that calls
  `retry()`.

While the zone has failed the element has `data-state="failed"`. A reload or a successful load removes it. `retry()`
reads the zone again, at once:

```js
document.querySelector('taleart-view').retry();
```

## Frequency cap

`frequency` limits how often a viewer sees a tale group. It is set with the attribute `frequency`, or
`init({ frequency })` for every element (the element's attribute wins). The values:

| Value | The group is left out of the display |
| --- | --- |
| `once` | after its first view |
| `daily` | for 24 hours after a view |
| `weekly` | for 7 days after a view |
| a whole number N from 1 to 50 | after N views, for good |

Default: none. An invalid value logs one console warning and is ignored.

```html
<taleart-view zone-key="YOUR_ZONE_KEY" frequency="daily"></taleart-view>
```

- A view is a viewer opening that tale group, the same moment the group is marked as seen.
- Views are counted in this browser only, in local storage under the key `taleart.views`, as `{ [groupId]: [timestamps] }`:
  the newest 50 views of each group and the newest 500 groups. They are never sent to the server, so another device
  counts its own views.
- When every group of the zone is capped, the display renders nothing.
- `onGroupCapped` (or the DOM event `taleart:group-capped`) fires once per capped group per render, with `groupId`
  and `rule`.

```js
init({
  frequency: 'once',
  hooks: { onGroupCapped: (e) => console.log('capped', e.groupId, e.rule) },
});
```

## Analytics

The element reports four events to the TaleArt API, which the zone's Analytics tab counts: an **impression** when a tale
group is half on screen, an **open** when a viewer opens the group, a **view** when a tale is shown in the viewer, and a
**click** when a tale's button, image button or swipe-up link is activated (counted whether or not the host cancels the
navigation). Each event carries its type, its tale group's id, its tale's id (views and clicks only) and the time in UTC.
Nothing else is sent: not the external user ID, not the tags, not the viewer properties, nothing from the page.

Events wait in memory and go out together: every 5 seconds while any wait, at 20 of them, and when the page is hidden,
by `navigator.sendBeacon` (or `fetch` with `keepalive` when a beacon is not possible). The zone key is the bearer token
of a `fetch`, and the visitor id its header; a beacon carries both in its body. A failed send is retried once, with the
next send, and then dropped without a message. A zone that failed to load sends nothing, and so does the Tale Studio preview.

Turn analytics off for every element with `init({ analytics: false })`, or for one element with `analytics="off"`. The
element's attribute wins: any other value turns it on.

```js
init({ analytics: false });
```

## Targeting tags

A tale group can carry targeting tags, combined with **Any** (the default) or **All**, set in the dashboard under the
group's Audience. Tell the SDK the viewer's tags once for the whole page:

```js
import { setTags } from 'https://api.example.com/sdk/v1/taleart.js';

setTags(['summer', 'vip']);
```

Every `<taleart-view>` on the page, now and later, then shows only the groups whose rule passes:

- a group without tags always shows;
- with **Any**, at least one of the group's tags is among the viewer's; with **All**, every one of them is;
- tags match ignoring case and surrounding spaces (`'SUMMER '` matches `summer`);
- while the page sets no tags (no call, `setTags(null)` or `setTags([])`), every group shows.

Calling `setTags` again replaces the tags, and rendered elements show the matching groups at once, without a new
request. The SDK decides in the browser: the tags are never sent to TaleArt. The Delivery API sends every group of the
zone with its tag names, so targeting is not access control: anyone with the zone key can read every visible group
and its tag names. Keep anything private out of tag names.

## Viewer properties

A tale group can carry an **audience rule** on top of its tags: a rule over the viewer's properties (a segment, a plan,
an age, ...), set in the dashboard under the group's Audience. The page passes the properties once, as a flat object
of name to value (a string, a number, a boolean or a list of strings; pass a date as epoch milliseconds):

```js
import { setProperties, setProperty } from 'https://api.example.com/sdk/v1/taleart.js';

setProperties({ plan: 'pro', age: 34, segment: ['beta', 'newsletter'] });

// Later, one property at a time (null removes it):
setProperty('plan', 'free');
setProperty('segment', null);
```

Every `<taleart-view>` on the page, now and later, then shows a group only when its tag rule (above) **and** its audience
rule pass. A rule has **All** (every condition) or **Any** (one of them), with 1 to 10 conditions:

| Operator | The group's condition holds when | Viewer value |
| --- | --- | --- |
| `eq`, `neq` | the viewer's value equals (or differs from) the rule's value | string, number or boolean |
| `in`, `notIn` | the viewer's string is one of (or none of) the listed values | string |
| `gt`, `gte`, `lt`, `lte` | the viewer's number is greater (or less), or equal | number |
| `contains` | the viewer's string contains the text, or its list holds the item | string or list |
| `exists`, `notExists` | the viewer has the property (or not); no value | any |

The rules, as the SDK evaluates them:

- a group without an audience rule always shows, and so does every group while the page has set no properties (no call,
  `setProperties(null)`): a page without the feature shows everything;
- once properties are set, a condition on a property the viewer does not have is false, except `neq`, `notIn` and
  `notExists`, which are true;
- a value of another kind than the property's (a number against a string, `gt` on a string) is false;
- strings match ignoring case and surrounding spaces (`'Pro '` matches `pro`); numbers and booleans match exactly;
- the page passes at most 50 properties, a string of at most 256 characters, and a list of at most 50 items. A name is
  a letter, then letters, digits, `_`, `.` or `-` (case counts). An invalid entry is dropped with one console warning, and
  `setProperty` with an invalid name or value changes nothing.

A viewer sees the same groups in a bar and in a banner: the banner shows only the slides whose rule passes, with a dot
for each. Calling `setProperties` or `setProperty` again re-renders the rendered elements at once, without a new request.

The SDK decides in the browser, and the properties are **never sent** to TaleArt: not in a request, a header, a URL or
an analytics event. The Delivery API sends every group of the zone with its rule (the rule is public, like tag names),
so the rule is not access control: anyone with the zone key can read every group and its rule. Keep private content out
of rule values, and keep the values themselves out of the page's public source.

## User lists and the external user ID

A tale group can also be targeted to **user lists**: lists of your site's own user IDs, uploaded as a CSV on the
dashboard's Audience page. Tell the SDK who the viewer is once for the whole page, for example after sign-in:

```js
import { setExternalUserId } from 'https://api.example.com/sdk/v1/taleart.js';

// Your own opaque ID for the signed-in user; null after sign-out.
setExternalUserId('cust-1001');
```

- A group with user lists shows only when the viewer's ID is in one of them, and its tag rule and audience rule (above) also pass.
  A viewer with no ID, or one in none of its lists, does not get the group: the Delivery API leaves it out.
- Groups without user lists show as before, so a page that never calls `setExternalUserId` sees only those.
- Use an **opaque ID**, never an email address or a phone number. It is trimmed and matched exactly (case counts);
  any Unicode text of up to 256 characters without control characters works. Another value logs one console warning
  and sends no ID.
- The SDK sends the ID in the `X-TaleArt-External-User-Id` request header, as base64url of its UTF-8 bytes (RFC 4648
  section 5, no padding), and never in a URL. It keeps the ID in memory only: not in storage or a cookie, and never
  with the visitor id.
- Every element on the page reads its zone again when the ID changes; `setExternalUserId(null)` sends none again.
- The Delivery API hashes the ID for the lookup and drops it: it is not logged or stored. Its answer to a request
  with the header is `Cache-Control: private, no-store`, with no ETag, so no cache keeps one viewer's groups for
  another.
- TaleArt stores user lists only as keyed hashes (HMAC-SHA-256 under a secret of the project) and shows how many IDs
  a list holds, never which. Deleting a list deletes its hashes for good and removes it from every group; a group
  targeted only to that list stops showing (to anyone) until someone changes its Audience in the dashboard.

Targeting is not access control: a targeted group's tales are public media, and anyone with the zone key can try IDs
and see which groups come back. Responses to a tale's interactive components (polls, quizzes, ratings) are accepted
from any viewer of a delivered tale, without checking its user lists. Do not use targeting to protect content.

## Theme

The project's theme, set in the dashboard, styles the zone's display and the viewer. A host page can override any of its fields
for a zone, or for one element. There is no theme per display. Each field resolves, in order, from:

1. the element's `theme` property or attribute,
2. the zone's `configureZone(zone, { theme })` option, where `zone` is the zone's slug,
3. the project's theme,
4. TaleArt's default.

Import `configureZone` from exactly the URL of the page's script tag (the pinned one, if the page pins it): another
URL loads a second copy of the SDK, whose settings the elements never read.

```js
import { configureZone } from 'https://api.example.com/sdk/v1/taleart.js';

// Every <taleart-view> with zone="home-top"; other zones keep the project's theme.
configureZone('home-top', { theme: { ringStyle: 'solid', ringColors: ['#0055ff'] } });

// One element only.
document.querySelector('taleart-view').theme = { cornerRadius: 0 };
```

```html
<taleart-view api-url="…" zone-key="tak_…" theme='{"fontFamily": "Georgia, serif"}'></taleart-view>
```

| Field | Values |
| --- | --- |
| `ringStyle` | `"gradient"`, `"solid"` or `"none"` |
| `ringColors` | 1–3 colours, `#rrggbb` |
| `seenRingColor` | `#rrggbb` |
| `ringWidth` | integer 1–4 (px) |
| `cornerRadius` | integer 0–32 (px), or `null` for the display's own |
| `fontFamily` | a CSS font-family list (names, quoted or bare; the host page loads the font), or `null` for the host page's |
| `titleColor` | `#rrggbb`, or `null` for the host page's text colour |
| `backgroundColor` | `#rrggbb` or `"transparent"` |
| `accentColor` | `#rrggbb`: the viewer's progress and buttons |
| `colorScheme` | `"auto"` (the default: the visitor's light or dark setting), `"light"` or `"dark"` |
| `liveColor` | `#rrggbb`, or `null` for the last ring colour (the live badge) |
| `successColor` | `#rrggbb`: a right quiz answer (lightened on dark cards to 4.5:1) |
| `errorColor` | `#rrggbb`: a wrong quiz answer (lightened on dark cards to 4.5:1) |

- A field left out (or `undefined`) falls through to the next source; `null`, where allowed, is a value and wins.
- Each value is checked with the same rules as the dashboard's. An invalid or unknown field is ignored with one console
  warning naming it, and the next source's value applies. An override that is not an object (or attribute text that is
  not JSON) is ignored with one warning. Values only ever reach CSS custom properties, never style text.
- The value is copied, checked and kept when set: assign the property again, or call `configureZone` again, to change
  it. Reading `el.theme` returns a copy of that element's own override fields that passed (not the zone's or the
  project's). Rendered elements restyle at once, with no new request.
- `el.theme = null`, removing the attribute (or setting it empty), `configureZone(zone)` or `configureZone(zone, {})`
  removes an override. A `theme` attribute of `null` or of JSON that is not an object warns once and sets none.
- A `theme` property set by script before the SDK defines `<taleart-view>` is applied when the element upgrades and wins
  over a `theme` attribute already present then, which is left unread and logs nothing; later attribute changes apply
  as usual.
- Warnings about a zone's theme name the zone by its slug, or a key passed by mistake by its first 8 characters (`tak_…`, `tas_…`) only.
- With an override, colour contrast is the host page's responsibility: keep titles at 4.5:1 and rings at 3:1 against the
  background (WCAG 2.2 AA).

## Fast first content

The budget (NFR-006) is the first zone content visible within 1.5 s at p75 on a mid-tier phone over Fast 4G, with
the SDK at most 50 KB gzipped. What the SDK does:

- The display's covers in view load first, eager and at high fetch priority; every other picture (bar covers out
  of view) waits until they have loaded, at most 3 s. Bar covers out of view stay lazy, including
  still canvas covers (animated images under reduced motion). A new render (another key) starts over, and an
  element removed from the page starts no more downloads.
- A still video cover (a first frame, metadata-only preload) counts as loaded at its first frame, or 1 s after its
  metadata when the browser loads no frame data up front.
- A banner loads the slide shown, then the slides next to it once that slide has its picture; the rest stay lazy.
- Covers and slides have fixed boxes, so nothing inside the element shifts when pictures arrive.
- The Delivery API answers `Cache-Control: private, no-cache` with an ETag: a repeat visit revalidates the zone and
  gets 304 while it is unchanged, and a paused or unpublished group still disappears at once.
- Performance marks, for your own monitoring, each once per element: `taleart:zone` when the zone first arrives, and
  `taleart:first-content` when the element's display is first on the page with its covers in view loaded (a render
  replaced or removed before that never marks). With several elements, the earliest is the page's first zone content.

```js
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) if (entry.name === 'taleart:first-content') console.log(entry.startTime);
}).observe({ type: 'mark', buffered: true });
```

What the host page does:

```html
<head>
  <!-- Fetch the SDK early. -->
  <link rel="modulepreload" href="https://api.example.com/sdk/v1/taleart.js" />
  <!-- Connect to the API early: once for the Delivery API call (CORS, no credentials), once for media. -->
  <link rel="preconnect" href="https://api.example.com" crossorigin />
  <link rel="preconnect" href="https://api.example.com" />
  <style>
    /* Reserve the display's height, so the page does not shift when it renders: 94 px for the default bar. */
    taleart-view { display: block; min-height: 94px; }
  </style>
</head>
```

- Serve the SDK compressed (gzip or brotli), as any CDN does. The API's `/sdk/v1/taleart.js` sends it gzipped to
  a browser that accepts gzip.
- Give tale groups a cover in the dashboard: a still cover is a 320 px JPEG of about 20 KB, while a group without one
  shows its first tale's lowest media element (its full-size image, often 300 KB or more) in the bar, or that tale's
  background colour when it has no media.

### Project fonts

A text in a tale can use a WOFF2 font uploaded to the project (Tale Studio). The SDK never loads one for first zone
content: it fetches a font only when the viewer opens a tale that uses it, once per page, from its public URL on the
API (CORS, no credentials). It registers the bytes with `new FontFace(...)` and `document.fonts.add`, under an internal
name made of the font's id, and builds no `@font-face` or `url()` text. The text shows its fallback stack until the
font is ready and then swaps; a font that fails, or takes over 3 s, is dropped and the fallback stays. A page whose
tales use no project font downloads no font file. Under a CSP, the API origin must be allowed in `connect-src`, as it
already is for the Delivery API.

### Images and video in tales

A tale's images and its video (Tale Studio) load only when the viewer opens that tale, never for first zone content.
Images are `<img>` elements with their alt text; decorative ones are hidden from assistive technology. The video is a
muted, inline `<video>` that plays with the tale, pauses with the viewer and ends it: a tale with a video lasts as long
as the video, at most 15 s, and moves on if the video stalls for 5 s; one without lasts its set duration (7 s by
default). When the visitor prefers reduced motion, the video waits on its first frame until Play, and a GIF, WebP or PNG
is drawn once to a canvas. Under a CSP, the API origin must be allowed in `img-src` and `media-src`, as it already is
for tale media.

### Shapes, emoji and stickers in tales

Shapes (rectangles, ellipses and lines) are built from their checked colours and sizes through CSSOM, never from SVG
or CSS text, and are hidden from assistive technology unless they have a label. An emoji is text in the platform's
emoji fonts (no emoji images are downloaded), announced by its label, the emoji's name. An image sticker is an image of
the project's media shown whole, with its alt text or hidden when decorative, and still under reduced motion. An SDK
that predates a type skips it and shows the rest of the tale.

### Buttons, image buttons and the swipe-up link

Calls to action are real `<a>` links with `rel="noopener noreferrer"` (and `target="_blank"` when set to open a new
tab), named by their label or, for an image button, its alt text. The SDK checks each destination again with the
contract's rule (an absolute `http` or `https` URL of at most 2,048 characters, no credentials or control characters)
and does not draw a link that fails it. The swipe-up link sits in the bottom safe area and opens on a click, on Enter
when focused, or on a flick up anywhere on the tale. A flick is one pointer (a second finger makes the press a pinch,
which opens nothing), released within 500 ms, travelling upwards more than sideways by at least 50 px or 8% of the
stage's height, whichever is more; a hold that drifts up, or a slower drag, is not one. On a tale without a swipe-up
link a vertical drag stays a tap, and the viewer's taps, sideways swipes and hold to pause are unchanged. A link that
opens a new tab says "(opens in a new tab)" in its accessible name. While a link has keyboard focus the tale waits,
and when the tale goes (by a key or the arrows) focus returns to the viewer.

### Polls

A poll is a card with a question and two options, each a `<button>`, inside a group named by the question; its text is
set as text nodes and its colours come from its light or dark theme. Pressing an option (by pointer, Enter or Space)
posts the vote to `POST /delivery/v1/responses` with the zone key and the visitor id; the card then
shows each option's percentage with the visitor's choice marked, says so in a polite live region, and takes no second
vote (the server keeps the first one). A press on the poll never steps the tale, and the tale waits while keyboard
focus is inside it. The SDK keeps the answer and the percentages it received in the host page's local storage under
`taleart.responses` (at most 200 answers), and shows them on a return visit without asking again; clearing the site's
data forgets them, while the server still holds the vote. The Tale Studio preview records nothing. Under a CSP, the
API origin must be allowed in `connect-src`, as it already is for the Delivery API.

### Quizzes

A quiz is a card like a poll's with two to four answers. Pressing one posts it the same way, and the card then shows
each answer's percentage with the visitor's answer pressed. When the quiz has a correct answer, the card marks it with
a check mark and the words "correct answer" in its button's name, and marks a wrong answer with a cross and "wrong"
(not by colour alone); the live region says "Right! You answered Venus." or "Wrong: you answered Earth. The correct
answer is Venus.", then the percentages. A quiz without a correct answer is a survey and shows only the percentages.
The correct answer is part of the published tale, so the SDK can mark it at once, and anyone can read it: a quiz is
not a secure test. Once answered, the answers are read-only: Space on one does nothing (it neither presses it nor
pauses the tale), while the arrow keys step the tale as anywhere else; the same holds for an answered poll. The answer and result are kept under `taleart.responses`, and the Tale Studio preview records nothing.

### Ratings

A Rating is a card with a question and a slider from 0 to 100 whose thumb is the tale's emoji, inside a group named by
the question. The slider is one Tab stop (`role="slider"`, named "Your rating", with `aria-valuenow` and a spoken
value). The visitor presses or drags along it, by mouse, pen or touch, and the rating is posted when the pointer is
released; or moves it with the arrow keys and Page Up and Page Down in steps of 10, Home and End to the ends (the left
and right arrows mirror on a right-to-left page), and posts it with Enter. A drag or press on the slider never
swipes to another tale group or steps the tale, and while the visitor is rating, the arrow keys move the emoji rather
than the tale, and Space does not pause it. Once rated, the slider is read-only: its arrow keys step the tale again,
Space on it does nothing, and the
card keeps the visitor's value, marks the average on the track, shows "Average 60 from 2 ratings", says so in a
polite live region, and takes no second rating (the server keeps the first). The value and
result are kept under `taleart.responses` like a poll's, and the Tale Studio preview records nothing.

Poll and quiz counts and Rating averages are indicative, not tamper-proof. An answer counts once per visitor id, and
the visitor id is made by the browser: clearing site data, a private window or a script that sends new ids can answer
again (within the Delivery API's rate limits). Do not use a poll, a quiz or a Rating where the result must be trusted,
such as a contest.

### Budgets

The Web SDK's budgets (NFR-006; epic Tale Studio R15) on a mid-tier phone over Fast 4G, checked by the two targets
below:

| Budget | Limit | Checked by |
| --- | --- | --- |
| The SDK's ES chunks together, gzipped | at most 50 KB | `web-sdk:size`, `sdk-sample:perf` |
| The chunk the page loads (`index.js`), gzipped | at most 40 KB, else the viewer splits out | `web-sdk:size`, `sdk-sample:perf` |
| First zone content, cold, p75 | at most 1.5 s | `sdk-sample:perf` |
| First tale frame of a 20-element tale with a project font, from the tap, p75 | at most 1 s | `sdk-sample:perf` |
| Font requests by a page whose tales use no project font | none | `sdk-sample:perf` |
| Project font | after the first tale frame, only when its tale opens | `sdk-sample:perf` |

Past 40 KB gzipped, the viewer and the document renderers move to a chunk the SDK loads when the viewer first opens
(AD-16), and `web-sdk:size` reports both chunks. Until then the SDK is one chunk, and the check reports what that split
would move, as lower bounds (from `dist/libs/web-sdk-modules.json`, the module report the build writes beside the
package; it is not published). Sizes are measured at gzip level 9 (what the API sends) and level 6 (most servers' and
CDNs' default), and judged on the larger. The split also needs the API to serve the second chunk under `/sdk/v1` and the UMD build to keep working.

### Measuring

`nx run sdk-sample:perf` builds the API and the SDK, starts the API on `TEST_DATABASE_URL` (a database whose name
ends in `_test`, as pg resolves the connection string), seeds a zone with a bar display and eight tale
groups (an animated cover first, a group without a cover third, still covers for the rest; three 1080 x 1920 JPEG
tales each), serves the sample page and loads it in headless Chromium with Chrome DevTools' Fast 4G (165 ms latency,
9 Mbps x 0.9 down, 1.5 Mbps x 0.9 up), a 4x slower CPU and a 412 x 823 phone screen. Each run is a cold load (empty
cache) and a warm reload; it reads `taleart:first-content` and prints every run, p50, p75 and max, layout shift and
the SDK's size per chunk. It fails when cold p75 is over 1.5 s, the SDK over its size budget, or that page requests a
font file. A second zone holds one composed tale of 20 elements (14 texts, every other one in a project font, 4 shapes,
an emoji and a button): the run checks that its page requests no font before the tale opens, then times the first tale
frame (all 20 elements placed and painted, the texts in their fallback) and the font swap from the tap on its bar item,
and fails when p75 first tale frame is over 1 s. Three more runs hold the font's response back 1.5 s: they fail when
the first frame then takes over 1 s (it waited for the font) or paints with the project font already loaded. Last, it
loads the first zone from the API's test page, which loads the SDK from `/sdk/v1/taleart.js` as a host page does, and
fails when cold p75 there is over 1.5 s or the SDK did not come gzipped. It ends with every gate, its limit and its
margin. `PERF_RUNS` (default 10), `PERF_BUDGET_MS` (default 1500),
`PERF_FRAME_BUDGET_MS` (default 1000) and `PERF_DEBUG=1` (the first load's requests) tune it.

What a run adds to the database, and deletes again at the end (also when it fails or gets SIGINT/SIGTERM): an admin
user and their session (inserted directly, as the API tests sign in), and through the Management API a project, its
zone, its bar display, eight tale groups with their zone placements, covers and 24 tales, and the zone's key; and a
project font with a second zone, its bar display, group and tale. The media files go
to a temporary folder that is removed with them. A run killed outright (SIGKILL) leaves those rows, whose media keys
then name files that no longer exist.

## Tale Studio preview (workspace only)

`@taleart/web-sdk/preview` (`src/preview.ts`) is the entry point the dashboard's Tale Studio imports to preview a tale
exactly as visitors see it (AD-16, epic Tale Studio R10). It is not part of the published bundle: `index.js` does not
include it, so the host page's bundle and its public types are unchanged. It exports:

- `TalePreview`: the SDK's own `TaleViewer` and document renderer embedded in a host element's Shadow DOM: shown in
  place as a region described as a preview (not a modal dialog, never taking focus, Close labelled "Stop preview"),
  always laid out as on a phone (no wide-screen deck), letting the page scroll, with the viewer's chrome, playing the
  tale for its duration. It starts muted; `setSound(true)` gives the tale's own video sound, as visitors have it.
  `show(tale)` takes a changed tale 150 ms after the last change and redraws it in place (on the timer, or around the
  tale's own running video), or plays it from its start 500 ms after the last change when its duration or a video
  changed; an unchanged tale changes nothing, and another tale starts over. Also `replay()`, `togglePause()`,
  `setTheme(theme)`, `setSafeArea(on)` and `destroy()`.
- `previewDocument(draft, mediaUrl)`: the studio's draft as the Delivery API would deliver it (hidden layers and
  editor fields left out, media keys as URLs). The server additionally validates a document when it is updated to the
  site and delivers none that fails; the preview draws the draft as it stands, with the SDK's own checks.
- `PREVIEW_SIZES`: 375 × 667, 390 × 844 (default) and 430 × 932.

Links in the preview render with the visitor's look and stay focusable (`role="link"`, `tabindex="0"`, so the tale
waits while one has focus), but without `href` or target, and clicks on them are cancelled: a draft's destination
never becomes a live link in the dashboard. `nx run sdk-sample:preview-parity` compares the preview with the sample
page's viewer pixel by pixel at 390 × 844, in a phone-sized window and inside a 1440 × 1000 window.

## Building

Run `nx build web-sdk` to build the library, and `nx run web-sdk:size` to check the size budget (all chunks at most
50 KB gzipped, the page's chunk at most 40 KB; see "Budgets").

## Running unit tests

Run `nx test web-sdk` to execute the unit tests via [Vitest](https://vitest.dev/).
