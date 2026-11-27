---
title: 'Dark mode on the user profile: appearance follows the device by default'
type: 'feature'
ticket: 'story-user-profile-dark-mode'
created: '2026-11-27'
status: 'in-progress'
baseline_revision: '6e0324102bd1dc82afa3d850d7618833d61bb6a1'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['_bmad-output/initiative-taleart/tickets/backlog/story-user-profile-dark-mode.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The dashboard has light colours only. A signed-in user cannot choose a dark appearance, and there is no profile page to hold one.

**Approach:** A new Settings tab, "Profile", holds an Appearance control (System, Light, Dark). System is the default and follows the device's `prefers-color-scheme` live. An explicit choice is stored on the user's account on the server, so it follows them across devices. Dark tokens and the dashboard's hard-coded colours are switched by the same attribute.

## Boundaries & Constraints

**Always:** Appearance is per user, never per project. The project theme (`ThemeService`, Management API theme) and the Web SDK are unchanged. Text meets WCAG AA contrast in both themes. The choice is validated by the API; the browser never trusts it alone. Signed-out pages (sign-in, setup, invitations) follow the device setting only.

**Never:** No per-device-only storage as the source of truth (localStorage may cache, not decide). No change to the tale canvas content or the zone/tale theme. No new dependency. No commit or push without the human's yes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | New user, no choice stored | Appearance shows System; device dark → dark dashboard | None |
| Live device change | System selected, OS switches to dark | Dashboard turns dark without reload | None |
| Explicit Dark on light device | Stored `dark` | Dark shown, persists after reload and on a second device | None |
| Save fails | PUT preference returns 5xx or network error | Previous appearance kept, message "Could not save appearance. Try again." | Revert control |
| Bad value | API receives `"purple"` | 400 with the API's error body | Validation in contract schema |
| Signed out | No session | Device setting applied, no preference call | None |

## Decisions (approved 2026-11-27)

- Appearance control: a new "Profile" settings tab for every signed-in user (option 1a).
- Tale Studio chrome (panels, palette, inspector) follows the dashboard appearance; the tale canvas stays light (option 2a).
- One story, one PR (option 3a).

</frozen-after-approval>

## Code Map

- `apps/dashboard/src/app/app.routes.ts` -- add `settings/profile` under the shell, next to `settings/api-tokens`
- `apps/dashboard/src/app/pages/settings-tabs.ts` -- add a "Profile" tab for every signed-in user
- `apps/dashboard/src/app/pages/my-sign-in-methods.ts` -- reference pattern for a per-user settings page (sections, `AuthStore`)
- `apps/dashboard/src/app/auth.ts` -- `AuthStore` holds the signed-in `User`; the preference is read from it on load
- `apps/dashboard/src/styles.css` -- `:root` colour tokens (light only today); add dark values here
- `apps/dashboard/src/app/app.css`, `pages/*.css`, `pages/*.ts` -- about 23 non-Tale-Studio files hard-code hex colours; move them to tokens
- `apps/dashboard/src/index.html` -- already has `theme-color` per scheme; no change expected
- `libs/contract/openapi/openapi.yaml` -- `User` schema (line ~6851) gains `appearance`; add `PUT /me/preferences` (or `/auth/me/appearance`)
- `libs/contract/src/generated/*` -- regenerated from the OpenAPI file, never hand-edited
- `libs/server/access/src/lib/migration.ts` -- `users` table gains `appearance text NOT NULL DEFAULT 'system' CHECK (...)`
- `libs/server/access/src/lib/sessions.ts` (`findSessionUser`) -- returns `appearance` with the user
- `apps/api/src/http/auth.router.ts` -- `/state` already returns `user`; add the preference route here or in a new `me.router.ts`
- `apps/api/src/http/authorize.ts` -- session check reused by the new route

## Tasks & Acceptance

**Execution:**
- [ ] `libs/server/access/src/lib/migration.ts` -- add `users.appearance` column with default `system` -- stored preference, forward-only
- [ ] `libs/server/access/src/lib/sessions.ts` -- return `appearance` on `User` -- so the first render knows the choice
- [ ] `libs/server/access/src/lib/users.ts` (new or existing user module) -- `setAppearance(userId, value)` -- single writer
- [ ] `libs/contract/openapi/openapi.yaml` + regenerate -- `User.appearance` enum `system|light|dark`; `PUT` route body `{ appearance }` -- contract first
- [ ] `apps/api/src/http/me.router.ts` (new), mounted in the API app -- session-authenticated PUT, 400 on bad value -- the only write path
- [ ] `apps/dashboard/src/styles.css` -- dark token set under `:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` -- dark look
- [ ] `apps/dashboard/src/app/appearance.ts` (new) -- applies `data-theme` on `<html>` from the stored choice or the device; listens to `matchMedia` change -- live System
- [ ] `apps/dashboard/src/app/pages/profile.ts` (new) -- Appearance radio group, saves via the API, reverts on error -- the control
- [ ] `apps/dashboard/src/app/app.routes.ts`, `pages/settings-tabs.ts` -- route and tab "Profile" -- reachable
- [ ] the ~23 dashboard files with hard-coded hex -- replace with tokens -- dark-safe
- [ ] tests: `appearance.spec.ts`, `profile.spec.ts`, API `me.router.spec.ts`, access migration test -- the I/O matrix

**Acceptance Criteria:**
- Given a new user with no choice and a dark device, when the dashboard loads, then it is dark and the Appearance control shows System.
- Given System selected, when the device switches from dark to light, then the dashboard switches without reload.
- Given the user picks Dark on a light device, when they reload or sign in on another device, then Dark is shown.
- Given Dark is active, when any dashboard page or the profile page is shown, then text contrast is at least 4.5:1.
- Given a project's theme is changed, when the dashboard is viewed in any appearance, then the theme's values are unchanged.

## Implementation Notes

- 2026-11-27 (build agent): implemented in the working tree, not committed. Server: `users.appearance` (migration, CHECK, default `system`), `findSessionUser` returns it, `setAppearance` in `libs/server/access/src/lib/users.ts` (the single writer), `PUT /api/v1/me/preferences` in `apps/api/src/http/me.router.ts` (session only: a token gets 403, a bad value 400 `validation_failed`). Contract: `Appearance` enum, `User.appearance` optional (so existing object literals in specs still compile), `PreferencesRequest`, new tag `Profile`; regenerated with `pnpm nx run contract:generate`.
- Route is `/me/preferences`, not `/auth/me/appearance`. The new operation is session-only, so the docs' session-only list in `apps/docs/src/app/pages/api-reference.spec.ts` gained `PUT /me/preferences`.
- Dashboard: `appearance.ts` (`AppearanceService`) paints `data-theme` on `<html>` with `light` or `dark`, from the choice or the device, and repaints on the device's `matchMedia` change. `AuthStore.apply` sets the choice from the user (System when signed out); `AuthStore.saveAppearance` shows the choice at once and reverts with "Could not save appearance. Try again." on failure. `pages/profile.ts` is the Profile tab at `settings/profile`.
- `styles.css`: dark token set in two blocks (`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme='light'])`, and `:root[data-theme='dark']`), plus new semantic tokens `--success-text`, `--warning-*`, `--inverse`/`--on-inverse`, `--studio-*`. Contrast of the dark pairs computed: lowest text pair 6.0:1 (muted on sunken), all others at or above 6.3:1; light pairs unchanged or darker.
- Hard-coded colours moved to tokens: status marker and visibility tips and dots, audience and theme warning boxes, skip link, group filter checked option, drag label, Tale Studio workspace, selection tint and update dot, the `--line` fallbacks. Deliberately left as they are: scrims and overlays on media, the tale canvas and tale preview backgrounds (the canvas stays light), the QR code's white (it must stay light to scan), project theme values and the theme editor's defaults (data, not chrome), the group placeholder gradient.
- Light-mode side effect: the theme and audience warning text moved from `#93370d` / `#7a2e0e` to one token `#7a2e0e` (higher contrast, visually close).
- Tests added: `apps/api/src/http/me.router.spec.ts` (10 tests, fake pool, instead of the planned DB-free split), five real-database cases in `apps/api/src/app.spec.ts` (new describe at the end, covering the migration default, the CHECK, persistence across sessions, 400 and 401), `apps/dashboard/src/app/appearance.spec.ts`, `apps/dashboard/src/app/pages/profile.spec.ts`. Two existing `app.spec.ts` expectations of the `/auth/state` user gained `appearance: 'system'`.
- Known gap: no first-paint cache. A user who chose Dark on a light device sees light until `/auth/state` answers (System is painted by the CSS media query at once). The browser's theme-color meta is still device-based.
- Bundle: the initial budget was already exceeded at HEAD (520.89 kB against 500 kB, and `app.css` 4.50 kB against 4 kB). With this change it is 524.46 kB. Not fixed here; the plan's "under 500 kB" cannot be met by this story alone.
- Environment: `pnpm install --frozen-lockfile` stopped on ignored build scripts, so it was rerun with `--ignore-scripts` (no lockfile change). Most `pnpm nx` lint and test targets then fail with "externalDependency ... could not be found" (eslint, vitest, vite), and `dashboard:build` needs `--exclude-task-dependencies` because `web-sdk:build` fails the same way. Those checks were run with the underlying binaries (see the report).
- Manual browser checks (both OS appearances, second browser) were not run.

## Plan Change Log

## Review Triage Log

## Design Notes

Dark palette: keep the brand violet (`--brand` #4f1dfc is 4.5:1 or more on the dark surface if lightened to #a78bfa for text), dark surfaces around #0f0c1f, text #f3f4f6. Exact values are set during implementation and must each be checked against WCAG AA.


## Verification

**Commands:**
- `pnpm nx run-many -t lint test --projects=dashboard,api,access,contract` -- expected: green
- `pnpm nx build dashboard` -- expected: success, under the 500 kB initial budget

**Manual checks (if no CLI):**
- Open the Profile tab with OS dark and light; check each of System, Light, Dark; reload; sign in from a second browser.
- Check contrast of the dashboard shell, zones list, and profile page in Dark with a contrast checker.
