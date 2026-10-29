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
