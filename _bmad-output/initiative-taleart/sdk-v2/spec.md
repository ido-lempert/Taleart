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
