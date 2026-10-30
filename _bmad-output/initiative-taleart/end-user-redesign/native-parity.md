# Native parity with the web SDK (follow-up to the end-user redesign)

Owner request (2026-10-31): the native Android/iOS UI must look like the redesign and be identical to the web SDK, and the
native docs clips must show the experience the way the web clips do. Source of truth for values: the web SDK
(`libs/web-sdk/src/lib/**`), which implements the handoff. Where the web SDK differs from the canvas (quiz answers are
soft grey pill outlines on web; the canvas has filled 14px answers) we follow the web SDK and list it as an open owner
decision. Kotlin UI: `libs/mobile-sdk/src/commonMain/kotlin/site/lempert/taleart/sdk/ui/` (paths below are relative to it).

Rules: no hard-coded colours (theme tokens), touch targets >= 48dp, RTL with logical start/end, reduce motion honoured,
data model unchanged. Every change is covered by a host test where it is logic, and by a retaken screenshot where it is
look (standing rule: a visual change updates every dependent screen: docs images, clips, guide text, reference tables).

## Gaps (ranked, from the audit of 2026-10-31)

### G1 Viewer CTA button is square (`TaleDocument.kt:537-542`, `:121`; `TaleDocumentLayer.kt:497`)
Web `.ta-button`: radius 99px (full pill) unless `props.radius` is a number, padding 0 .8em, weight 700.
Kotlin: `radius` defaults to 0.0. Make `ButtonLook.radius` nullable; null means full pill. Swipe-up and image buttons keep their paths.

### G2 Choice buttons (quiz, poll sticker, embed, inline) (`TaleInteractive.kt:212-219, 521, 532, 546`)
Web (`document/poll.ts:46-72`): idle border 0.25cqh solid ink at 35% alpha; selected border 0.5cqh ink; quiz right/wrong
border 0.5cqh in the mark colour with fill mark colour at 22%; card shadow `0 1cqh 3cqh -1.6cqh ink 35%`; min height
max(2.4em, 44px); padding .4em .9em; label weight 600.
Kotlin: idle border is full-strength ink, fill always ink 22%, no card shadow. Match the web values.

### G3 "Quiz" eyebrow
The eyebrow is the element `title` prop, not an SDK default. Fix the native fixtures (see G17), not the SDK.

### G4 Viewer chrome (`TaleartViewer.kt:136, 193, 195, 886, 958-969`)
Control discs: web 44px disc, dark 45% plus blur 8px, 24px icon. Kotlin 40dp, 60%, 20dp icon, no blur: use 44dp disc
(touch target stays 48dp), dark 45%, 24dp icon, blur where the platform supports it (otherwise 45% plain).
Top scrim: web dark 60% to transparent, padding 12 12 40; Kotlin TOP_SHADE 70% -> 60%. Head gap under the progress
segments: web 12px, Kotlin 6dp -> 12dp. Tale content entrance: web `.frame .ta-area` rises 24px and scales .96 over 0.7s;
add the same entrance (skipped under reduce motion). Android shots show black bands top/bottom (~24dp): check whether
`ContentScale.Fit` over `stageColor` (`:836`, `TaleContent.kt:129`) causes it; the stage must fill the screen.

### G5 Promo code card and toast (`TaleComponentViews.kt:211, 247-322`)
Web: one ticket row: code chip (flex 1, monospace 1.3em 700, LTR) plus a "Copy" stub 6em wide with a dashed divider
(0.2cqh dashed, ink 45%); ticket radius 0.8em, background ink 10%, stub ink 14%; two notch cutouts (radius 0.7em) top and
bottom at the seam, mirrored in RTL. Toast: overlay at the card's top-inline-end, pill, ink background, paper text,
0.8em 700, 4000 ms (`PROMO_TOAST_MS`).
Kotlin: dashed box with notches at the outer edges and Copy as a separate pill underneath; toast inline, 2 s. Restructure.

### G6 Bar stack (`TaleartBarLayouts.kt:293-355`)
Web `bar-extra-layouts.ts:204+`: one pill, background surface, radius 16, min height 60, padding 10 14 10 24, gap 12;
covers in a row with 3px paper borders and -14px overlap; "+N" bubble = paper mixed with 14% ink; caption beside the
covers 13/600, muted when none unseen. Kotlin has no pill, caption under the covers, borders in the gap colour.

### G7 Bar chip (`TaleartBarLayouts.kt:91-151`)
Web: avatar is a plain round cover (no ring); pill border 1px currentColor 18%, surface background in both states, min
height 44, title 14/20 weight 500, max width 180, dot 8px accent with a 0 0 0 1px ink ring; seen: muted text, cover
opacity .6, no dot. Kotlin draws a gradient ring, no border, transparent seen pill, 13/18 SemiBold, no dot ring.

### G8 Poster (`TaleartBarLayouts.kt:160-251`, `TaleartBarLogic.kt:18-19`)
Web: card 112x188, radius 16, row padding-block 32 (shadows not clipped), shadow 0 18px 30px -18px dark 80%, unseen inset
accent ring 2px; scrim 60% of the height dark 90% -> 70% at 40% -> transparent; segments all dim while unseen, all lit
once seen; title 15/700 line-height 1.1 clamp 2; caption 11/14; text inset 10; hover lift -8 and rotate -1.5deg (+1.5deg RTL).
Kotlin: 120x200, elevation shadow, row padding 4, full-height black 85% scrim, first segment lit while unseen, 13sp title,
lift -6 no rotation.

### G9 Banner sticky and strip (`TaleartBannerSticky.kt:115-147`, `TaleartBannerStrip.kt:134-206`)
Sticky web: full-width bar on paper, shadow 0 -4px 16px ink 12%, padding 6 8; content: prev/next 44px round buttons, 44px
circular cover, name 16/600 title colour, dismiss button; no "Watch" subtitle; height 64.
Kotlin: bordered card, 56dp rounded-square thumbnail, bold name plus "Watch stories", no prev/next.
Strip web: container surface, radius `--ta-radius` or 12, padding-block 4; items 36px circle no ring, name title colour,
min height 44, gap 24, padding 4 12 4 4, marquee 18s. Kotlin: no container, 40dp cover with a 2dp muted ring, ink name, padding 12.

### G10 Poll views (`TaleInteractivePoll.kt:126-303`, `TaleInteractive.kt:433`)
Selected marker: web underlines the label (thickness .12em, no ring); Kotlin grid draws a ring, this-or-that has none.
Alignment: web halves and tiles align content to the bottom (tiles also start-aligned); Kotlin centres.
Sizes: percent 2.4em/800 in halves, 1.8em in tiles; labels 1.1em / 1.05em. Tile fill: share fill ink 22% (`.ta-poll-fill`).
Divider "VS": 3.2em, 0.9em/800, shadow 0 .4em 1em -.4em, paper/ink. Inline view once voted: stack bar (height 1.2cqh, min 10px,
2px gaps) plus legend instead of the pills.

### G11 Rating (`TaleInteractive.kt:596-748`)
Rounded ends on track and fill (radius 999); track margin 0 1.2em; thumb 1.6em to 2.8em; average mark 1.6em with a halo
(`0 0 0 .12em ink 30%`).

### G12 Reaction (`TaleInteractive.kt:802-852`)
Emoji 2em (Kotlin 1.2em); button radius 1em (2.4cqh); pressed state fills currentColor 30%; row gap 1cqh and flex-wrap.

### G13 Countdown (`TaleComponentViews.kt:148-169`)
Digit tile: currentColor 14% (Kotlin ink 8%); radius 0.3em of the digit; tiles fill the column (inline-size 100%).

### G14 Banner caption (`TaleartBanner.kt:445-490`)
Title clamp(18, 4.5cqi, 30) weight 800 (Kotlin fixed 26sp/16sp); scrim `to top dark 85% -> transparent` over the whole slide;
caption padding 48 64 16 (64 both sides); "Watch" pill: background light, ink light-ink, padding 8x16, 14/600 (Kotlin follows accent).

### G15 Loading skeleton (`TaleartBarSkeleton.kt`)
Counts: 5 rings, 4 chips, 4 posters, 1 stack. Square-ended lines. Chip and stack pill backgrounds. Shimmer colours ink 8%/16%.

### G16 Smaller
Ring sweep: web 4s rotating linear-gradient(45deg); Kotlin sweepGradient: align colour order and joins as far as practical.
Fallback retry border: currentColor (Kotlin muted 1dp).

### G17 Fixtures and capture setup (why the shots look different)
Native tales are a flat gradient plus text; web fixtures use illustrated art and element `title`s ('Quiz', 'Poll', 'Rate us'...).
Native tale title shows twice (chip plus big white word). Native groups are 3 Hebrew-named groups with flat covers; web has 6
English groups with subject covers. Several Android shots caught the viewer paused (Play icon). Shots mix sizes (Android
720x1280 vs 506x900; iOS downscaled 415x900) and include host chrome (title, Settings, Reload, group list).
Fix: same illustrated media, titles, English group names and group count as the web fixtures; viewer running (Pause icon);
one size per platform; for bar and banner a Taller debug mode that shows only the zone (no host chrome); status bar clean.

### G18 Clips
Native clips are 1.6-4.8 s, host app in frame, no interaction. Web clips: bare component, hover/tap, 3 s of reaction.
Storylines (each <= 8 s, MP4 <= 600 KB per docs-assets spec): ring (idle, tap item 2, viewer opens, progress, swipe next
group, close), banner coverflow (autoplay 3 slides, one arrow tap, dot pill moves), poll this-or-that (open, 0.7 s, vote,
3 s), quiz (open, 0.7 s, wrong answer, shake and marks, 3 s), countdown (3.6 s flip), promo (copy, toast 4 s), rating (drag, release,
average), reaction (tap, rise, counts). Taps without a tool on iOS: Taller debug launch options that act on a timer
(`taller.autoVote=<index>`, `taller.autoPress=<index>`, `taller.autoOpenGroup/Tale` already exist), identical on Android (extras)
and iOS (store key). Android: `adb shell screenrecord`; iOS: a NEW simulator (never the owner's 3F912209), `xcrun simctl io recordVideo`,
transcode to fit the cap with AVAssetWriter (no ffmpeg).

## Open owner decision
Web quiz answers are soft grey pill outlines; the canvas shows filled 14px answers with green/orange fills and a 22px card.
We keep the web look on both platforms for parity; changing it is a separate change in all three SDKs.
