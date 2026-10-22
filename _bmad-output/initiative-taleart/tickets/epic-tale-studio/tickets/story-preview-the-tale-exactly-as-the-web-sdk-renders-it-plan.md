---
title: 'Preview the tale exactly as the Web SDK renders it'
type: 'feature'
ticket: '9'
created: '2026-10-23'
status: 'built'
baseline_revision: 'ddd48ee'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-add-a-button-an-image-button-and-a-swipe-up-link-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-register-an-element-type-by-configuration-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** R10 and AD-16 ask that Tale Studio's preview be the Web SDK's own renderer, mounted on the unsaved document, with the viewer chrome at phone sizes, playing for the tale's duration, so preview and visitor rendering cannot diverge. Today the studio has only its editing canvas; the SDK's renderer and viewer are reachable only through the published bundle, which registers `<taleart-view>`.

**Approach:** Add a workspace-only SDK entry point, `@taleart/web-sdk/preview`, that embeds the SDK's real `TaleViewer` (a small subclass: shown in place rather than modal, never taking focus, never in the wide-screen deck, links inert, able to take a changed tale without restarting) in a host's Shadow DOM with the phone-sized viewer styles, the document styles, the project theme and a safe-area overlay. A lazy Tale Studio pane (`app-tale-preview`) converts the draft as the Delivery API would (`previewDocument`) and feeds every change to it. The published `index.js` and its types do not change.

## Boundaries & Constraints

**Always:**
- One rendering path: the preview runs `TaleViewer.renderContent` → `renderTaleDocument` and the same CSS as the sample page's viewer; only an embedding layer is added (`present`, `wide`, `renderOptions` hooks; `VIEWER_STYLES` split into base + wide, composed as before).
- Inert links in the preview: no `href`/`target`/`rel`, `role="link"`, `aria-disabled="true"`, clicks cancelled; a draft destination never becomes a live `<a>` in the dashboard origin. The SDK's own `linkHref` check still decides whether a link shows, as for visitors.
- Host page inheritance cut at the preview host (`:host { all: initial }`), so the dashboard's font, smoothing and spacing do not reach it.
- Preview in the lazy studio chunk; dashboard initial bundle < 500 KB; SDK bundle ≤ 50 KB gz, `web-sdk:types-check` unchanged.

**Never:** a second renderer in the dashboard; the preview in the published bundle; autosaving or publishing from the preview; replacing the studio's editing canvas (it stays the editor; both read `doc()`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open preview | tale with text, image, shape, emoji, button | SDK viewer at 390×844 with progress, pause, close and group name | — |
| Unsaved change | edit text | preview shows it at once, keeps the playback position | duration change or a video: restarts |
| Tale ends / Close | 7 s pass, or Close | viewer closes, "Play again" offered | Play from the start never reports an end |
| Draft link | `https://…`, `javascript:…` | inert link / nothing rendered | click cancelled |
| Hidden layer | `hidden: true` | not shown (as delivery) | — |
| Media key | project key | absolute URL of the dashboard media file | unresolvable key: element left out |

</intent-contract>

## Code Map

- `libs/web-sdk/src/preview.ts` (new) -- workspace entry point.
- `libs/web-sdk/src/lib/preview.ts` (new) -- `TalePreview`, `PreviewViewer`, `previewDocument`, `PREVIEW_SIZES`.
- `libs/web-sdk/src/lib/viewer.ts` -- protected hooks, `renderContent`/`clearContent` extracted, `VIEWER_BASE_STYLES`.
- `libs/web-sdk/src/lib/document/{links,media,renderer}.ts` -- `inertLinks` render option.
- `apps/dashboard/src/app/pages/tale-preview.ts` (new), `tale-studio.ts` -- the pane and its Preview toggle.
- `tsconfig.base.json`, `eslint.config.mjs`, `apps/dashboard/eslint.config.mjs` -- alias, boundaries (dashboard may use `type:sdk` only via the preview entry; never the main SDK entry).
- `apps/sdk-sample/preview-parity.mjs`, `project.json` -- `sdk-sample:preview-parity` pixel comparison.

## Tasks & Acceptance

**Execution:**
- [x] SDK: inert links option; viewer hooks and extraction; preview entry; tests (`preview.spec.ts`).
- [x] Dashboard: preview pane (sizes, safe areas, play from the start, play again), studio toggle, project theme passed; tests (`tale-preview.spec.ts`).
- [x] Pixel parity script and target; README section.

**Acceptance Criteria:**
- Given a tale with text, media, a shape, an emoji and a button, when the preview at 390×844 and the sample page's viewer are captured with their progress frozen at the same time, then at most 0.1 % of pixels differ by more than 2 per channel.
- Given the preview is open, when the text is edited, then the preview shows it before any save.

## Implementation Notes

- The embedded viewer is the SDK's `TaleViewer` subclassed in the preview module, so the host bundle gains only the hook refactor (23.51 → 23.59 KB gz).
- `.viewer[data-embedded]` is absolutely positioned and a size container; `.frame` max-width uses `56.25cqh` instead of `56.25vh` there, so it lays out as on a phone whatever the dashboard window.
- Bug found by the e2e walk and fixed: "Play from the start" while playing reported the tale as ended (old viewer's onClose); the viewer is now detached before it closes.
- The dashboard rounds the preview screen's corners; those corner pixels (≈60) are host chrome and fall inside the tolerance.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --parallel=2` -- pass (except the known Postgres-clock auth test).
- `web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf`, `sdk-sample:preview-parity` -- pass.
