# Digest: Flows, audiences, labels, conversion (round 2, researcher 3)
accessed: 2026-10-20 | 5 pages fetched, Android targeting page 404 | undated | publisher: Storyly

## Flow
- claim: Flow = preset group of one or more widgets for a business goal (discovery, conversion, retention, loyalty), with built-in content logic and optional AI personalization. Flow to widgets is one-to-many. | source: https://docs.storyly.io/docs/introduction | confidence: high | class: entity-model
- claim: No Flow fields or identifiers given; no limit on flows per placement stated. Integrating a placement activates its widgets and flows. | source: same | confidence: medium | class: entity-model
- claim: After setup Storyly "automatically manages what to show, when to show it, and to whom." | source: same | confidence: high | class: ui-only

## Custom audience CSV
- claim: Single-column CSV; no column header named. | source: https://docs.storyly.io/docs/having-custom-audience-for-story-groups | confidence: high | class: entity-model
- claim: Identifier is user info matching the custom parameter the app sends to the SDK (user ID or email); matching is exact. | source: same | confidence: high | class: api
- claim: Upload under Audiences, then select on Story Groups, banners and swipe cards. Users in no audience see only public content. Custom parameter must be set up SDK-to-app first. | source: same | confidence: high | class: ui-only
- claim: No size, row, or format limits beyond single-column CSV. | source: same | confidence: high (absence) | class: limit

## Labels
- claim: iOS: STRPlacementConfig.Builder().setLabels(...) (example ["new comers", "europe"]). Web: storylyPlacement.setLabels([...]) or labels in init config. React Native and Flutter: labels field on StorylyPlacementConfig. Legacy Flutter: storylySegments. | source: https://docs.storyly.io/docs/ios-targeting-with-labels | confidence: high | class: api
- claim: AND: Story Group shows only if both labels are passed. OR: shows if either is passed. Stated explicitly on this page. | source: same | confidence: high | class: entity-model
- claim: No labels passed: SDK shows all active Story Groups. | source: same | confidence: high | class: api
- claim: Labels created in Settings > Data Management > Labels, assigned under Audience on widgets. Targets a segment or label combination; only related widgets show. Labels in use cannot be deleted. | source: https://docs.storyly.io/docs/using-labels-to-distribute-your-stories-to-the-right-audience | confidence: high | class: ui-only
- claim: Labels page does NOT state AND/OR, default visibility without labels, or how the app sets user labels. | source: same | confidence: high (absence) | class: other
- claim: Label values may be case-sensitive (lowercase recommended); runtime label changes need placement refresh. | source: search snippet, not fetched | confidence: low | class: api

## Conversion attribution
- claim: Attribution uses two parameters: the custom parameter (user match, same value as SDK init; SDK has no user IDs by default) and product ID (products[].id, must match the Product Feed). | source: https://docs.storyly.io/docs/conversion-attribution-tracking | confidence: high | class: api
- claim: POST https://metric.storyly.io/conversion/event/{STORYLY_WIDGET_TOKEN}; required: type, value, currency, products; optional: transaction_id, tax, shipping. Widget token: Settings > Account Settings > Apps & Websites. | source: same | confidence: high | class: api
- claim: View-through (converted after watching) and click-through (converted after CTA click), both default 6-hour window, changeable on request. | source: same | confidence: high | class: limit
- claim: Conversions NOT linked to story, group, or placement; no such ID in the event body. Dashboard breakdown, duplicate handling, response format not stated. | source: same | confidence: high (absence) | class: entity-model

## Not found
- Flow identifiers or schema; flows per placement.
- Custom audience size and format limits.
- Conversion attribution to group or placement.
- Default visibility when a story has labels and the user has none.
- Android labels setter (targeting page 404).

## Leads
- integration.storyly.io/android/targeting.html ("User Segments with Storyly") and integration.storyly.io/getting-started/core-concepts.html (placement/flow identifiers).
- docs.storyly.io/docs/how-to-measure-conversion-who-clicks-from-stories (UTM click tracking).
