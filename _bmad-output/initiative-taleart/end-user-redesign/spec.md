# End-user UI redesign (spec, 2026-10-30)

Source of truth: `handoff.md` (the owner's design handoff; read all of it) and the canvas sources in `canvas/*.dc.html` (reference only; they are LTR, hard-coded admin colours, and contain animated tale backgrounds: do NOT copy those parts, see handoff sections 2, 3, 4, 6).

Owner decision (2026-10-30): scope = **everything**: tokens, RTL, restyle of viewer, bar, banner, poll and stickers, PLUS the new layouts and variants from the canvas (6 bar layouts, 5 banner variants, 5 poll views, CTA sticker) as display settings, in contract, dashboard, web SDK and Android/iOS SDKs, with docs and real screenshots for each.

## Non-negotiables (from the handoff)
1. No hard-coded colours in end-user components: every colour derives from theme tokens (`color-mix`). Max 3 `ringColors`.
2. No animation on layers over the tale's own media (no parallax/blob). Rings, progress, poll fill, quiz shake, reaction fly, countdown flip, promo shine, toast, marquee, swipe-up bounce stay. All motion stops under `prefers-reduced-motion` (web) and the reduce-motion setting (native).
3. RTL/LTR: logical CSS properties everywhere; mirror directional arrows/chevrons/carousel/coverflow/deck/marquee; numbers, percentages, promo codes and countdown digits stay LTR (`<bdi>`/`dir=ltr`); no uppercase/letter-spacing on Hebrew/Arabic; `unicode-bidi: plaintext` on animated titles; Compose uses LayoutDirection.
4. Text 4.5:1 contrast on any background; text on `accentColor` picks white/dark automatically. Touch targets >= 44px.
5. Data model unchanged at the base: `DeliveryTaleGroup`, element schemas. New display options are *settings* of the frame/zone/element (additive, defaulted so existing zones look as before except for the restyle).
6. Fonts: the SDK ships none; host font by default (`fontFamily: null`); dashboard/docs may suggest a Hebrew-capable family but SDK never bundles one.
7. Standing rules: every feature ends with docs (guides + reference tables) and REAL screenshots; no competitor names (AD-12); size budget of the web SDK 50 KB gzip (report each phase; if exceeded, split code by display type lazily).

## Phases (strictly in this order; each phase is delegated, verified by the main agent, committed locally; push only on the owner's go-ahead)
- **P1 Foundation (tokens + theme):** theme schema adds `colorScheme` (auto|light|dark), `liveColor`, `successColor`, `errorColor` (optional, validated `#rrggbb`, derived defaults per handoff 4.3); contract `DEFAULT_THEME`/validation/OpenAPI + server + dashboard theme editor (+preview) + web `theme.ts` (derived tokens `--ta-ring/seen/accent/title/muted/surface/on-accent/live/success/error`, `colorScheme`) + `TaleartTheme.kt` + docs theme page. Keep the drift test between the web copy and the contract.
- **P2 RTL + motion hygiene (web):** convert physical CSS in libs/web-sdk to logical properties, mirror per handoff 3.2 table, LTR numbers, remove any tale-background animation, reduced motion audit. Tests in both `dir`s. Same for Compose/Swift-facing code in libs/mobile-sdk (LayoutDirection) as P2b.
- **P3 Viewer restyle:** web viewer + native viewer: progress segments (start-to-end), nav areas by inline direction, buttons/hit areas 44px, desktop neighbour groups, layout per `Viewer.dc.html` minus parallax. Real screenshots.
- **P4 Bar:** restyle the ring bar; add bar layouts via the frame setting `layout`: `ring` (default), `tile`, `chip`, `poster`, `stack` (collapsed), plus the loading skeleton shown while the zone loads (same footprint). Contract frame schema, dashboard Display tab, web, native, docs + screenshots.
- **P5 Banner:** restyle; add banner variants via frame setting `variant`: `carousel` (default), `peek`, `deck`, `sticky`, `strip` (marquee) (and coverflow if the canvas has it as separate; follow `Banner.dc.html`). Same surfaces.
- **P6 Poll + stickers:** restyle quiz/rating/reaction/countdown/promo; poll views via element prop `view`: `sticker` (default), `embed`, `this-or-that`, `grid`, `inline`; CTA sticker restyle (button/swipe-up). Same surfaces.
- **P7 Verification:** full test suites, docs build, a11y checks, LTR/RTL x light/dark screenshots matrix for each component (web), native screenshots on simulator/emulator via the taller app where feasible.

## Standing rule: dependent screens (owner, 2026-10-30)
Every look change to a component also updates every screen built on it, in the same phase: docs screenshots (retake with apps/docs/scripts), dashboard live previews and Tale Studio canvas, the taller sample app and its native screenshots, e2e/a11y baselines, and guide text that describes the look. Find consumers by grep; the phase report lists what was refreshed.

## Per-phase acceptance
Unit + e2e tests for touched projects pass (API tests strictly one Nx task at a time); web SDK size reported; docs updated with real screenshots (docs-assets spec passes); LTR and RTL, light and dark each checked at least by a test or a screenshot; reduced motion honoured.
