---
type: epic
title: Interactive components
parent: initiative-taleart
id: 4
covers: [R4, R10, R7]
sources: [_bmad-output/initiative-taleart/initiative-taleart.md, _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md]
after: []
refined: true
risk: high
---

# Interactive components

## Description

Content managers add seven interactive components to a tale in Tale Studio: poll, quiz, emoji reaction, Rating, countdown, promo code and product pins. Visitors respond to them in the Web SDK viewer, and each response is recorded and counted.

Each component is an **element type** in the tale document (architecture AD-15), added through the element-type registry that Tale Studio story 7.8 built (`libs/contract/tale-document/element-types/registry.json`, steps in `libs/contract/README.md`): a props schema, server rules, a studio descriptor and an SDK renderer. Responses are owned by a new `interactive` module (`libs/server/interactive`). The SDK posts them to the Delivery API, which today only reads (`GET /delivery/v1/zone`).

The scope stays lean.

The native mobile SDK (`libs/mobile-sdk`, epic-native-mobile story 9.5) already renders documents and skips types it does not know. It learns the seven components in two native stories at the end of this epic, not inside each web story (C1).

## Outcome

A content manager adds a poll, a quiz, an emoji reaction, a Rating, a countdown, a promo code and product pins to tales in Tale Studio and updates the tale. A visitor on the sample page answers each one by pointer and by keyboard, and sees the result where the component shows one. The studio then shows each component's response counts. The Taller app on Android and iOS shows and answers the same components.

## Requirements

R1 (parent R4, R10; PRD FR-014; AD-15): **Components are element types**
   - The seven components are registry element types with these keys: `poll`, `quiz`, `emoji-reaction`, `rating`, `countdown`, `promo-code` and `product-pin`. Adding them needs no document version change and no migration.
   - Each is added from Tale Studio's Add menu, edited in its inspector, saved, validated on the server and updated to the site like any other element (Tale Studio R1, R9).
   - **Shared settings:** a box, an optional title, and a light or dark theme. Text is plain and has stated length limits.
   - **Limits per tale:** at most one of each component type, except product pins, which allow up to 10 per tale (C3).
   - **Choice ids:** every answer, option or emoji choice has a stable id inside its element, so counts survive an edit to its text.
   - **Unknown types:** an SDK that does not know a component type skips it and shows the rest of the tale. This is true today for both the Web and the native SDK.
   Verify: each component type appears in the Add menu, saves and is refused when it breaks its schema; a second poll in one tale is refused, and an eleventh product pin is refused; an SDK build without a component's renderer shows the tale without it.

R2 (parent R4; PRD FR-014, FR-015): **Poll**
   A poll has a question and two options. The visitor taps or presses one option. The vote is recorded, and the poll then shows each option's percentage with the visitor's choice marked.
   Verify: vote on the sample page and see the percentages; reload and see the choice and percentages again, with no second vote possible.

R3 (parent R4; PRD FR-014): **Quiz**
   A quiz has a question and two to four answers.
   - The author can mark one answer as correct. After answering, the visitor sees whether their answer was right, the correct answer is marked, and each answer's percentage is shown.
   - With no correct answer marked, the quiz works as a survey and shows only the percentages.
   Verify: answer a quiz wrongly and see the right answer marked and the percentages; a quiz without a correct answer shows only the percentages.

R4 (parent R4; PRD FR-014): **Emoji reaction**
   An emoji reaction has three to five emoji in a horizontal or vertical bar. The visitor picks one, and the pick is recorded.
   - The chosen emoji is marked, with a short animation that is skipped under reduced motion.
   - Visitors are not shown counts (C5).
   Verify: pick an emoji on the sample page and see it marked; the studio's count for that emoji goes up by one.

R5 (PRD FR-014): **Rating**
   Rating comes from PRD FR-014 and the split review; initiative R4's list of six omits it (initiative Open question).
   A Rating has a question and one emoji on a slider from 0 to 100. The visitor sets a value by dragging, or by arrow keys in steps of 10, and it is recorded when released or confirmed. The Rating then shows the average of all ratings.
   Dragging on the slider never moves to another tale or tale group.
   Verify: drag the slider on the sample page and see the average; set a value with the keyboard alone; dragging the slider does not swipe to the next group.

R6 (parent R4; PRD FR-014): **Countdown**
   A countdown has a title and an end time (stored in UTC, entered in the author's time zone). It shows days, hours, minutes and seconds left, in the visitor's locale, and an ended text after the end time.
   - It can offer **Remind me**, with the reminder's text and time. Pressing it gives the visitor a calendar file (`.ics`) and records the press as the countdown's response (C6).
   - A countdown without a reminder records nothing.
   Verify: a countdown to a time two minutes ahead counts down on the sample page and shows the ended text after it; Remind me downloads a calendar file with the reminder's text and time, and the studio counts one reminder.

R7 (parent R4; PRD FR-014): **Promo code**
   A promo code shows a code and a label. Pressing it copies the code to the clipboard, says "Copied", and records the copy.
   - Where the clipboard is not available, the code is selected so the visitor can copy it by hand.
   Verify: press the promo code on the sample page, paste it elsewhere, and see the same code; the studio counts one copy.

R8 (parent R4; PRD FR-014): **Product pins**
   A product pin is a marker placed on the canvas. Pressing it opens a product card with:
   - a title,
   - an optional price, as text,
   - an optional image from the project's media, with alt text or marked decorative,
   - a destination URL, which opens in the same tab by default or in a new tab with `noopener`.

   Product data is entered by hand. Product feeds and product sets stay out (C4). Opening the card and following its link are both recorded.
   Verify: put three pins on a tale; on the sample page each opens its card by pointer and by keyboard, and the card's link opens its URL; the studio counts card opens and link clicks per pin; a `javascript:` URL is refused on save.

R9 (parent R4; PRD FR-015; AD-2, AD-10, AD-13): **Responses are recorded**
   The Web SDK posts a response to the Delivery API with the project's site key. The response carries the zone slug, the tale id, the element id, the visitor id and the value.
   - **Checks:** the server keeps a response only when the tale is visible in that zone (the AD-6 visibility function), the element is in the tale's published document with that type, and the value is valid for the type.
   - **One per visitor:** each visitor has one response per component and interaction kind. The first is kept, and a repeat returns the stored one. Most components have one kind; a product pin has two, opening its card and following its link.
   - **Answer:** the server answers with the component's current result: per-choice counts and percentages for a poll or quiz, and the count and average for a Rating.
   - **Visitor id:** this is the device's visitor id from epic-ux-rework story 8.23 (owner decision 2026-10-23): a random UUID v4 the SDK keeps on the device and sends with every Delivery request. Responses are keyed by it. No external user ID or user attribute is sent (AD-13; C2).
   - **Stored row:** each response row records `project_id`, `zone_id`, `frame_id`, `tale_group_id`, `tale_id`, element id and type, value, visitor id, and the client and server times (AD-10).
   - **Deletion:** deleting a tale deletes its responses.
   - **Preview:** the studio preview never records a response.
   - **Limits:** the Delivery rate limit applies to the endpoint.
   Verify: API tests refuse a response for an unknown element, an element of another type, an invalid value, a tale that is not visible, and a site key of another project; a repeat response returns the first; a vote in the studio preview reaches no row.

R10 (parent R4; NFR-007; AD-16; architecture Quality Targets): **Components in the viewer are accessible and do not fight navigation**
   - Every component works by pointer and by keyboard, with named controls in reading order, and results are announced through a live region.
   - A tap or press on a component never steps to another tale.
   - While keyboard focus is inside a component, the tale is paused (C7).
   - Content is rendered as text nodes and styled through CSSOM only (AD-16).
   - Animation respects reduced motion.
   Verify: answer each component with the keyboard alone and a screen reader on the sample page; the automated WCAG 2.2 AA scan of a tale with all seven components reports no violations.

R11 (parent R4; PRD FR-015): **Content managers see responses**
   - When a component is selected, Tale Studio's inspector shows its response counts: per choice for a poll, quiz and emoji reaction, count and average for a Rating, reminders for a countdown, copies for a promo code, and card opens and link clicks for a product pin.
   - The counts are read through the Management API for the session's project.
   - When a component already has responses, the inspector says so before its choices are edited. Removing a choice drops its count from the result.
   Charts, CSV export and date filters belong to epic-analytics (C8).
   Verify: after two votes on the sample page, the poll's inspector shows them per option; editing an option's text keeps its count.

R12 (parent R4, R7; AD-10): **Component events for hosts and analytics**
   - The event names of component interactions are defined in `libs/contract`, in `lower_snake_case` and the past tense: `component_responded`, `promo_code_copied`, `product_pin_opened`, `product_pin_clicked` and `countdown_reminder_set`.
   - The `<taleart-view>` element dispatches each one as a DOM event with the zone slug, tale group id, tale id, element id, element type and value, and no user data. A host can feed them into its own analytics.
   - epic-analytics posts the same events to its event store.
   Verify: a listener on the sample page logs one event per interaction with those fields; the event names in `libs/contract` match what is dispatched.

R13 (parent R4; NFR-006; AD-16): **SDK budget with the components**
   - With the seven renderers, the Web SDK stays within 50 KB gzipped, and p75 first zone content stays within 1.5 s on Fast 4G.
   - When the bundle passes 40 KB gzipped, the viewer and renderers move to a chunk loaded on first open, as AD-16 says.
   Verify: the size check and `nx run sdk-sample:perf` pass with a zone whose tales carry all seven components.

R14 (parent R4, R10; owner direction 2026-10-23 for epic-native-mobile): **Native SDK renders the components**
   `libs/mobile-sdk` renders the seven components in shared Compose on Android and iOS, with the same layout and rules as the Web SDK. It posts responses through the same Delivery endpoint, with the device's visitor id (8.23).
   Verify: in Taller on Android and iOS, answer each component of the sample tale and see the same result the sample page shows; the studio counts the responses.

R15 (parent R4; AD-15, AD-16): **Security of components**
   - Every component's props are validated on every write: closed schemas, length limits, hex colours, and RGI emoji checked as the `emoji` type checks them.
   - URLs are absolute `http` or `https` and at most 2,048 characters. The server checks them, and the SDK checks them again.
   - Media keys must belong to the tale's project.
   - A response value is checked against the published document, never trusted from the client.
   Verify: API tests refuse an HTML string in a question, a `javascript:` product URL, a media key of another project and a non-emoji in an emoji reaction; a question of `<img src=x onerror=alert(1)>` shows as literal text on the sample page.

## Constraints

- **Contract first:** component schemas, the registry entries and the event names live in `libs/contract`. Source: AD-3, AD-10, AD-15.
- **Responses in their own module:** `libs/server/interactive` owns the response table and reaches tales only through the `tales` public interface. Source: AD-1, architecture Capability Map (R4).
- **Delivery surface:** the SDK writes responses only to the Delivery API, with the site key. Source: AD-2.
- **No sensitive end-user data:** this covers the device's visitor id, with no user attributes and no external user ID. Source: AD-13.
- **No HTML or CSS from content:** this covers text nodes and CSSOM. Source: AD-16.
- **Web SDK budget:** 50 KB gzipped and 1.5 s first content. Source: architecture Quality Targets.
- **WCAG 2.2 AA:** applies to the studio and the rendered components. Source: architecture Quality Targets.
- **No third-party brand names** in code, UI or docs. "Product tag" is named product pin. Source: AD-12, NFR-004.
- **Apache-2.0.** Source: NFR-001.

## Done when

- **Web:** on the deployed dashboard a content manager adds all seven components to tales in Tale Studio and updates them. On the sample page a visitor answers each by pointer and by keyboard, and the studio shows the counts.
- **Native:** Taller on Android and iOS renders and answers the same components, and the counts include its responses.
- **Budget:** the Web SDK is at most 50 KB gzipped, and p75 first content is at or under 1.5 s.
- **Accessibility:** the WCAG 2.2 AA scans of the studio and the sample page are clean, and a person's keyboard and screen-reader walk is recorded.

## Boundaries

- **In:** the seven components on the Web SDK and the native SDK, response recording, counts in the studio, and component events as DOM events.
- **Out:**
  - **Product feeds and product sets** (PRD FR-021, FR-022). They remain owned by this epic in name, as decided on 2026-10-20, but have no stories until product feeds exist. Product pins take data entered by hand.
  - **Metrics and analytics:** charts, CSV export, date filters, and Reach, Impression, Engagement Rate and CTR. These belong to epic-analytics, which consumes R9's rows and R12's events.
  - **Audiences from answers** and journeys routed by answers. Both are post-MVP.
  - **An image quiz** and components beyond the seven. Each is a later element type.
  - **Push or e-mail reminders** for a countdown. The Web reminder is a calendar file.
  - **Showing a viewer their past answers on another device.**
- **Touch points:**
  - **Analytics:** epic-analytics reads the response rows through the `interactive` public interface and adds the R12 events to its store.
- **Must not change:** the document version, the delivery of the zone response (`GET /delivery/v1/zone`), and the rendering of existing element types.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R4, R7, R10)
- prd — `_bmad-output/initiative-taleart/prd-taleart/prd-taleart.md`, FR-014, FR-015, FR-021, FR-022, FR-023, NFR-004, NFR-005, NFR-006, NFR-007
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-1, AD-2, AD-3, AD-6, AD-10, AD-13, AD-15, AD-16, Quality Targets, Capability Map
- tale studio — `_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md`, R1, R8, R9, R10, R12, R14, R15; `libs/contract/README.md`, section Element types
- native mobile — `_bmad-output/initiative-taleart/tickets/epic-native-mobile/epic-native-mobile.md`, story 9.5

## Owner decisions to confirm

Sofia made these product decisions on 2026-10-23, working headless. The stories are planned on them, and each one stands until the owner changes it; a change re-slices the affected stories.

- **C1 Native rendering:** native rendering is not part of each web story. It comes in two native stories at the end of the epic (stories 10 and 11, after 9.5). The reason is that each web story is already one session of work, the native SDK skips unknown types safely meanwhile, and native review needs both emulators.
- **C2 Visitor id:** responses are kept per visitor, using the device's visitor id that story 8.23 adds (owner decision 2026-10-23). The external user ID is not attached in the MVP. epic-analytics can count Reach with the same id.
- **C3 Limits per tale:** each component type appears at most once per tale, except product pins, which allow up to 10.
- **C4 Product data:** product pins take product data entered by hand (title, price as text, image, URL). Product feeds and product sets stay unsliced.
- **C5 Results shown to visitors:** a poll and a quiz show percentages, and a Rating shows the average. An emoji reaction shows no counts to visitors, only in the studio.
- **C6 Countdown reminder:** on the Web, the countdown's reminder is a calendar file the visitor saves, and pressing it is the countdown's recorded response. A countdown without a reminder records nothing, which is how R4's "records a response" is read for countdown.
- **C7 Focus pauses the tale:** while keyboard focus is inside a component, the tale is paused. A tap on a component never steps tales. Answering does not extend the tale.
- **C8 Counts in the studio:** content managers see each component's counts in Tale Studio's inspector. Charts, CSV export and date filters wait for epic-analytics.
- **C9 First response wins:** a visitor cannot change an answer. A repeat returns the stored response.
- **C10 Quiz answers are public:** the quiz's correct answer is delivered in the published document, so the SDK can mark it at once. A quiz is not a secure test.
- **C11 Results on a return visit:** when a visitor comes back, the SDK shows their stored choice and the result it received then, kept locally. It does not fetch the result again.

## Notes

- Decision (2026-10-23, Sofia, headless): refined from R4, PRD FR-014 and FR-015, AD-15, and the built code (registry from 7.8, Web renderer, Delivery router, `libs/mobile-sdk`). Product decisions C1 to C11 are listed above for the owner to confirm.
- Decision (2026-10-23): the tracer bullet is story 1, "Tracer: add a poll to a tale and see a visitor's vote counted". It passes through every layer the epic touches: the contract type, server rules, the studio descriptor and the inspector's counts, the SDK renderer in the viewer, the device's visitor id (8.23), the new Delivery response endpoint and the `interactive` module with its migration.
- Decision (2026-10-23): Rating is second because it is the least certain: its drag must not trigger the viewer's swipe between groups, and it needs a keyboard slider. The other components follow in one ordered lane (3 to 7), since each touches the registry, the studio descriptors and the renderer table.
- Decision (2026-10-23): the studio's configured inspector supports only `text`, `number`, `color` and `select` fields. Rating (story 2) adds an emoji field, the quiz (3) a list field with a correct-answer pick, the countdown (5) a date-time field, and product pins (7) the media and link fields from 7.5 and 7.7.
- Decision (2026-10-23): the initiative breakdown changes as follows.
  - **Epic 1:** the epic-level `after` on epic 1 ("the data model and API") is dropped. Story 1 reaches the foundation through 7.8, 8.2 and 8.7.
  - **Epic 9:** epic-native-mobile moves before this epic in the initiative order, since stories 10 and 11 wait on 9.5.
- Decision (2026-10-23): the refactor sweep (13) is proposed by default. A closing end-to-end suite is not proposed, since the source has no test plan.
- Note (2026-10-23, from the code): `registry.json` holds nine MVP types plus `test-badge` (test only). The Web renderer skips an unknown type with one console warning per type per page. `libs/mobile-sdk` (`TaleDocument.kt`) lists the nine types in `DOCUMENT_ELEMENT_TYPES` and skips the others. The Delivery API has only `GET /delivery/v1/zone`, with a rate limit. No events table, analytics module or `interactive` module exists yet. The Web SDK keeps only `taleart.seen`, never sent; the device's visitor id is planned in epic-ux-rework story 8.23 (owner decision 2026-10-23).
- Note (2026-10-24, story 1 review): response counts are indicative, not tamper-proof. Responses are kept once per visitor id (C2, C9), and the visitor id is made on the device (8.23): clearing site data, a private window or a script that invents ids can respond again, within the Delivery API's rate limits (the per-visitor and per-address limits, and the stricter write limit of `POST /delivery/v1/responses`). The SDK README and the docs say so; no component should be used where a result must be trusted.
- Note (2026-10-23, for epic-analytics): what analytics needs from this epic:
  - the response rows with the AD-10 keys (R9), read through the `interactive` public interface;
  - the event names in `libs/contract` and the DOM events on `<taleart-view>` (R12), which its SDK posting will send to the Delivery events endpoint it builds;
  - the device's visitor id (8.23), for Reach.

  Engagement Rate needs component responses over tale impressions; impressions are analytics' own events.
