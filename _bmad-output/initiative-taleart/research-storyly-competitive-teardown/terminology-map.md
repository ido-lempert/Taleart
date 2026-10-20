---
type: glossary
subject: TaleArt terminology map (vs Storyly)
date: 2026-10-20
status: draft, legal review required
---

# TaleArt Terminology Map

Purpose: give TaleArt its own vocabulary, so the product does not use Storyly's brand-specific names. Concept-level structures (groups of items, locations, interactive elements) are generic industry patterns; the names below avoid Storyly's branding. **This is a naming-risk aid, not legal advice. Counsel must clear the final names.**

## Mapping

| Storyly term | TaleArt term | Notes |
|---|---|---|
| Story | **Tale** | Set by the brief. |
| Story Group | **Tale Group** | Set by the brief's pattern. Alternative if the name is too close: "Tale Set". |
| Placement | **Zone** | Set by the brief. |
| Showcase app | **Taller App** | Set by the brief. Preview tool. |
| Instance | **Stage** | A view on an app page. Not a Storyly brand term. |
| Widget (Story Bar, Banner, Swipe Card, Vertical Feed, Canvas) | **Frame** with types: `bar`, `banner`, `card-deck`, `feed`, `canvas` | Use generic type names, not Storyly product names. |
| Flow | **Playbook** | Storyly uses "Flow" and "Journeys" as product terms, so both are avoided. |
| IVoD (interactive video on demand) | **Interactive Clip** | Generic. |
| Label | **Tag** | Generic. |
| Segment | **Segment** | Generic industry term; keep. |
| Audience | **Audience** | Generic industry term; keep. |
| Sub user | **Member** | Per-user record. |
| Custom parameter | **External user key** | Generic. |
| Interactive components (Poll, Rating, Quiz, Emoji Reaction, Countdown, Product Tags, Promo Code) | Keep names | Generic UI element names. "Product Tags" may be renamed to "Product Pins" to reduce overlap. |
| Placement token | **Zone key** | Per-platform identifier. |
| Story status (ACTIVE, PASSIVE, ...) | Define TaleArt's own statuses | Storyly's meanings are undefined (see research §7.1). |
| Conversion event | **Conversion event** | Generic. |
| Open Rate | **Open rate** | Generic metric. |

## TaleArt core entities (draft)

- **App**: a customer's application.
- **Zone**: a location in an app that holds one Frame or Journey. Has a zone key per platform.
- **Stage**: a rendered instance of a Zone on a page.
- **Playbook**: a preset set of Frames for a business goal.
- **Frame**: a runtime-chosen display (bar, banner, card-deck, feed, canvas).
- **Tale Group**: up to 100 tales.
- **Tale**: full-screen media (image, GIF, video, or interactive clip). Carries interactive components.
- **Interactive component**: Poll, Rating, Quiz, Emoji Reaction, Countdown, Product Pins, Promo Code.
- **Tag** and **Segment**: targeting inputs passed by the SDK.
- **Audience**: an uploaded list matched against the external user key.
- **Member**: a per-user record.
- **Conversion event**: an action attributed to tales or zones (TaleArt will key this to content, unlike Storyly).

## Rules

1. No Storyly brand names in code, UI, or docs. Import tooling may refer to "Storyly" as a source system.
2. Keep generic industry terms (audience, segment, conversion, open rate).
3. Record each name's origin in this file before using it in code.
