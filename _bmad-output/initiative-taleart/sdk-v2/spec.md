# SDK v2 spec (owner request 2026-10-29)

Decisions: zone keys return (reverses 8.7); script loads once; global config; hooks inspired by another tool's delegate;
publish only on owner go-ahead. Packages: npm `@lempert/taleart`, Maven `site.lempert.taleart`, iOS XCFramework on a GitHub release.

## Credential
- Zone key `tak_<base64url>`: one active per zone, hash stored, shown once, rotate/revoke (restore from commit 1de9e58^:
  libs/server/access/src/lib/zoneKeys.ts, apps/api/src/http/zone-keys.router.ts, contract constants/types).
- Delivery API: `Authorization: Bearer tak_...` resolves the zone from the key (no `?zone=` needed). Site key + `?zone=slug`
  keeps working for server-side/legacy callers. Same 401 `invalid_site_key` body for every refusal.
- A zone is "installed" if it has an active zone key or its project has a site key (zoneInstalledSql already allows both).

## Web SDK
- `<taleart-view zone-key="tak_...">` is the only required attribute. `site-key` is no longer read (console warning if present).
  `api-url` stays as an optional per-element override.
- Script loads once (CDN `<api>/sdk/v1/taleart.js` or npm `@lempert/taleart`). Registers the element and `globalThis.Taleart`.
- `Taleart.init(config)` (also named export `init`), all optional, callable before or after elements connect (it reloads them):
  `apiUrl` (default: origin of the script URL), `locale` (default: `document.documentElement.lang`, then `en`),
  `strings` (see src/lib/i18n.ts), `theme`, `externalUserId`, `tags`, `hooks`.
  Element-level overrides: `locale` attribute/property, `strings` property, `theme`.
- Existing exports remain: configureZone, setExternalUserId, setTags, defineTaleartElement.

## Hooks (another tool-style, bound to all elements via `init({hooks})` and to one via `element.hooks`)
`onLoaded(zone)`, `onLoadFailed(error)`, `onGroupImpression`, `onTaleShown`, `onPresented`, `onDismissed`,
`onActionClicked(event)` (cancelable: `event.preventDefault()` stops the default navigation, host can route itself),
`onUserInteracted` (poll/quiz/rating answer), `onEvent(event)` (every one of the above, one stream for analytics).
Each also dispatched as bubbling DOM CustomEvent `taleart:<name>` (cancelable for action-clicked) on the element.
Payload: { zoneKey prefix only, zone slug, group {id,name,index}, tale {id,index,title}, component {id,type,value}? }. Never the full key.
Hook exceptions are caught and logged, never break the viewer.

## Quick wins (2026-10-29)

### QW1 Load-failure placeholder
- Light-DOM child `<div slot="fallback">…</div>` of `<taleart-view>` is shown only when the zone load fails (shadow root gets `<slot name="fallback" hidden>`; the host gets `data-state="failed"` while failed, removed on success/reload).
- Attribute `fallback="message"` (also `Taleart.init({ fallback: 'message' })`, element wins) shows the translated string `load.failed` ("Stories could not be loaded.") in the shadow root when no slotted child exists. Default `fallback="none"` renders nothing (today's behaviour).
- Element method `retry()` reloads the zone. `onLoadFailed` payload unchanged.
- New i18n key `load.failed` plus `load.retry` ("Try again"); `fallback="message"` shows a retry button calling `retry()`.

### QW2 Size and speed budget page
- Docs page `/reference/performance` with: budget table (gzipped size budget 50 KB, measured value from the real build, max requests = 1 script + 1 zone call, no third-party calls), loading rules (script once, async/defer, zone call after connect, lazy media), and how to verify. Measured numbers come from a generated file written by `libs/web-sdk/scripts/measure-budget.mjs` (gzip of the built ESM and UMD bundles) and a docs spec fails when the page and the file differ.

### QW3 Frequency cap
- Attribute `frequency` on `<taleart-view>` and `Taleart.init({ frequency })`; element wins. Values: `once` (hide a group after its first view), `daily` (at most one view per 24 h), `weekly` (one per 7 days), or a positive integer N (hide after N views, lifetime). Default none.
- A "view" is a viewer open of that tale group (same moment the group is marked seen). Stored in local storage key `taleart.views` as `{ [groupId]: number[] }` (timestamps, newest last, max 50 per group, max 500 groups). Never sent to the server.
- Groups over the cap are removed from the rendered display; if none remain the display renders nothing. Invalid value: ignored with one console warning.
- Hook payload unchanged; `onEvent` gets a `groupCapped` event (`{groupId, rule}`) once per group per render.

## Components (2026-10-29)

New element types, registered like `rating` (schema in `libs/contract/tale-document/element-types`, `registry.json`, contract and server validators, web SDK renderer, dashboard studio palette/inspector/preview, docs). All text is plain, one line, no control characters, as in `rating.schema.json`. Props common to all three: optional `title` (1-80), `theme` (`light` | `dark`).

### countdown
- Props: `endsAt` (ISO 8601 UTC, `...Z`, required), optional `endedText` (1-80; default is the string `countdown.ended`).
- Renders days, hours, minutes, seconds, ticking each second (`role="timer"`; announced politely once a minute, not every second). At and after `endsAt` it shows `endedText` and fires one `componentEvent` `{component:'countdown', action:'ended'}` per render. Uses the visitor's clock; the docs say so. Respects `prefers-reduced-motion` (no flip animation). Several allowed per tale.
- Strings: `countdown.ended`, `countdown.days`, `countdown.hours`, `countdown.minutes`, `countdown.seconds`.

### promo-code
- Props: `code` (1-32 chars of `A-Z a-z 0-9 _ -`, required), optional `note` (1-120).
- Renders the code in a chip and a Copy button. Copy uses `navigator.clipboard.writeText` with a selection fallback; shows `promo.copied` for 2 s, or `promo.copyFailed`. Fires `componentEvent` `{component:'promo-code', action:'copied', value: <code>}`. The code is visible to every visitor: the docs say it is not a secret.
- Strings: `promo.copy`, `promo.copied`, `promo.copyFailed`.

### reaction (second batch)
- Props: `question` (1-200), `emojis` (2-6 distinct RGI emoji). One per tale. A visitor taps one emoji; it is posted to the Delivery responses endpoint like a poll vote (value = the emoji, server rejects any value not in `emojis`), then each emoji shows its count. Follow the `poll` precedent end to end, including the responses store, dashboard Responses page and `userInteracted`.
- Strings: `reaction.failed`, `reaction.count` ("{count} reactions").

### Host component events (hook)
- New hook `onComponentEvent` (`taleart:component-event` DOM event): payload `{zoneKeyPrefix, zoneSlug, taleId, groupId, component, action, value?}`. `component` is the element type key; `action` is `ended` (countdown), `copied` (promo-code), `selected` (reaction, poll, quiz, rating: the answer, `value` = option id or emoji or number). Fires in addition to `userInteracted`, which stays as it is. Reaches `onEvent` too.
- Native Android/iOS do not render tale documents' interactive components yet; the native docs say so.
