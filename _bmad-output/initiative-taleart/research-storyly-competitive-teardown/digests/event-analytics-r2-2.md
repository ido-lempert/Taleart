# Digest: event and analytics model (round 2, researcher 2)
accessed: 2026-10-20 | iOS and Web fetched; Android, Flutter, React Native lists NOT obtained | all undated | publisher: Storyly

## iOS delegate events (https://integration.storyly.io/ios/event-handling.html)
- storylyLoaded(view, storyGroupList, dataSource): data ops finished, list shown; dataSource added v1.18.0. | high | api
- storylyLoadFailed(view, errorMessage): fetch failure; skeleton icons shown. | high | api
- storylyStoryPresentFailed?(view, errorMessage): programmatic open failed (bad group ID, story ID, or play mode). | medium | api
- storylyStoryPresented(view): stories start presenting. | high | api
- storylyStoryDismissed(view): user dismisses story. | high | api
- storylyActionClicked(view, rootVC, story): Swipe Up or CTA tap; story.media.actionUrl is key. | high | api
- storylyUserInteracted(view, storyGroup, story, storyComponent): only Emoji, Rating, Poll, Quiz, Countdown; tracking ID from component customPayload set in Studio. | high | api
- storylyEvent(view, event, storyGroup?, story?, storyComponent?): forwards every event; name in event.stringValue; event list NOT on page. | high (existence), low (completeness) | entity-model

## Web events (https://docs.storyly.io/v2.0/docs/web-analytics, v2.0 page)
- userEvent: user sees a story; impression and reach mentioned, no fields listed. | high | entity-model
- renderedStoryGroups: group rendered; payload group fields: group_id, icon_image_url, media_host, order, pinned, stories, title. | high | entity-model
- noStoryGroup: no group exists. | high | api
- openStoryGroup / closeStoryGroup: group fields. | high | api
- storyOpenFailed: programmatic open failed; errorMessage. | high | api
- storyViewed: group, story_id, media URL, index. No duration or completion condition. | high | entity-model
- storyGroupViewed: user switches group; group fields. | high | entity-model
- nextStory / previousStory: group, story_id, media, index; gesture_type (nextStory: clicked|progress; previousStory: clicked). | high | entity-model
- nextStoryGroup / previousStoryGroup: group fields + gesture_type (next: clicked|swiped|progress; previous: clicked|swiped). | high | entity-model
- productTagExpanded / productTagClicked: id, productTagId, title, seen, index, actionUrl; developer handles redirect on productTagClicked. | high | api
- userInteracted: story, storyGroup, storyComponent; same five component types. | high | api

## Android (snippet only, low)
- StoryViewed in com.appsamurai.storyly.analytics, sent when a story LOADS (load-time, not view-time). Source: integration.storyly.io android analytics snippet. | low

## Completion and reach
- Only reach mention: web userEvent carries impression and reach. No definition found. | medium | limit
- No completion event documented. nextStory gesture_type=progress indicates auto-advance, not completion. | medium | limit

## Keying (Q3)
- Web analytics keys every event to group and story (group fields, story_id, index); no placement, instance, flow, or widget fields. iOS event page: no placement, index, or instance fields either. | high (for these pages) | entity-model
- React Native analytics page: 404. Android and Flutter analytics: not fetched.

## Conversion attribution (conflict flagged)
- Attribution linked by Custom Parameter (SDK init and each conversion event; can be hashed) and Product ID (must match product feed). No story, group, placement, or instance attribution. | https://docs.storyly.io/docs/conversion-attribution-tracking | high | entity-model
- View-through and click-through, both 6-hour default window, changeable on request. | high | limit
- CONFLICT: React Native conversion page posts to https://trk.storyly.io/traffic/<TOKEN> with custom_parameter and payload.event_type = "Conversion", payload.detail arbitrary (https://integration.storyly.io/react-native/conversion-tracking.html, high). Earlier round-2 researcher (flows digest) reported POST https://metric.storyly.io/conversion/event/{WIDGET_TOKEN} with type, value, currency, products. Snippet from attribution page also says type/value/currency/custom_parameter/products, metric endpoint (low). The two endpoints and payload shapes disagree; VERIFY before any importer or event design.

## Not found
- Documented reach or impression definition; completion event; placement/instance/flow/widget keys on any fetched analytics page; Flutter, Android, React Native event lists.

## Version drift
- iOS docs show both StorylyProductDelegate (v2.0) and STRProductDelegate (newer); an older StorylyView reference of about 4.14.0. Verify SDK version before copying signatures.

## Leads
- integration.storyly.io/android/event-handling.html; Android StorylyEvent enum reference (cross-platform event names).
- docs.storyly.io/docs/sending-storyly-analytics-to-3rd-party-analytics-platform.
- reference/getstorygroupstats (reach definition, if any).
- docs.storyly.io/docs/ios-shoppable-content (STRProductDelegate event list).
