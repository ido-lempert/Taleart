---
title: 'Invite a user to a project'
type: 'feature'
ticket: '13'
created: '2026-10-20'
status: 'built'
baseline_revision: '16f3045ed733845a12bbb3266cebe3b6437bd471'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-platform-foundation/tickets/story-set-up-the-first-admin-and-sign-in-with-a-passkey-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Only the first admin can get in (story 7), and every signed-in user can reach every project. The user decided (2026-10-20): other users join only through an admin's invitation; the agreed defaults are a one-time link shown in the dashboard (no mail server), invitees become content managers of the invited project, and only admins create projects and invitations.

**Approach:** Add project membership and invitations to the access module. An admin creates an invitation for a project and copies its link; the invitee opens it, registers a passkey and is signed in as a content manager of that project. Every Management API route checks the caller's access to the project it touches (AD-4).

## Boundaries & Constraints

**Always:**
- Admins can access every project. A content manager can access only projects they are a member of.
- Invitation token: 32 random bytes in the link (`/invite/<token>`), stored only as its SHA-256 hash; valid 7 days; single use, consumed in the same transaction that creates the user, membership and session (row locked, so two people cannot redeem one link).
- Invitee registration reuses story 7's WebAuthn options, challenge and verify flow and its `PasskeyVerifier`; the new user gets role `content_manager`. An email that already belongs to a user is refused.
- Authorization lives at the API edge in one helper that every route uses: resolve the project of the resource (project id, zone, tale group or tale) through the owning module's public interface, then allow or refuse. Lists are filtered to accessible projects. A resource in a project the caller cannot access answers 403 `forbidden`; a resource that does not exist still answers 404.
- Admin-only actions (create project, create invitation) answer 403 `forbidden` for content managers.
- Contract first, standard error body, story 14 design system, `_test` database.

**Never:** Email sending, removing members, changing roles, inviting existing users to more projects, revoking invitations, or listing members (later stories).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create invitation | admin: `POST /api/v1/projects/{projectId}/invitations` | 201 `{id, projectId, url, expiresAt}`; `url` holds the token, shown only in this response | content manager → 403 `forbidden`; unknown project → 404 `project_not_found` |
| Read invitation | `GET /api/v1/auth/invitations/{token}` (no session) | 200 `{projectName, expiresAt}` | unknown, used or expired → 410 `invitation_invalid` |
| Redeem options | `POST /auth/invitations/{token}/options {name, email}` | 200 creation options; challenge cookie | 410 as above; email taken → 409 `email_taken`; bad input → 400 `validation_failed` |
| Redeem verify | `POST /auth/invitations/{token}/verify` | 201 `{user}` role `content_manager`, member of the project; session cookie; invitation used | failed passkey → 400 `passkey_failed`; used meanwhile → 410 |
| Second redeem | same link again | 410 | `invitation_invalid` |
| Member lists | content manager of A: `GET /projects`, `GET /zones` | only project A and its zones | — |
| Other project | content manager of A: any route on a project, zone, tale group or tale of B | 403 | `forbidden` |
| Create project | content manager: `POST /projects` | 403 | `forbidden` |
| Admin | admin on any project | allowed | — |
| Dashboard admin | Projects page | each project card has "Invite"; the drawer creates the link and offers "Copy link" with the expiry date | API message in the drawer |
| Dashboard invitee | opens `/invite/<token>` | card "Join <project> on TaleArt" with name, email, "Create passkey"; lands on Zones of that project | invalid link: "This invitation is no longer valid" |
| Dashboard content manager | signed in | no "New project" button and no "Invite"; project switcher lists only member projects | — |

</intent-contract>

## Code Map

- `libs/server/access/src/lib/` -- story 7: `auth.ts` (setup flow, `createUser`), `challenges.ts`, `sessions.ts`, `passkey-verifier.ts`, `errors.ts`, `migration.ts`, `projects.ts`; add `project_members`, `invitations`, membership queries (`accessibleProjectIds`, `canAccessProject`), invitation create, read and redeem. Reuse the setup flow's challenge handling for redeem.
- `libs/server/zones`, `libs/server/tales` -- `zoneProjectId` exists; add exported project lookups for a tale group and a tale if missing.
- `apps/api/src/http/auth.router.ts` -- session middleware puts the user on `res.locals.user`; add the invitation routes under `/auth` (no session needed).
- `apps/api/src/http/*.router.ts`, `errors.ts` -- add one authorization helper (e.g. `http/authorize.ts`) and call it in every route; filter list routes; map `forbidden` 403, `invitation_invalid` 410, `email_taken` 409.
- `apps/api/src/app.spec.ts` -- tests sign in as an admin by default; add a content-manager helper; cover each matrix row and one 403 per resource kind.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- paths, `Invitation`, `InvitationPreview`, codes; regenerate.
- `apps/dashboard/src/app/` -- `auth.ts` (user and role), `pages/projects.ts`, `create-drawer.*` (invite drawer), `app.routes.ts` (`invite/:token` outside the shell, like `setup`), `pages/setup.ts` (card layout to copy), `app.html` (hide admin-only actions).

## Tasks & Acceptance

**Execution:**
- [x] `libs/server/access/` -- membership, invitations, redeem in one transaction; unit tests -- AD-4, AD-9.
- [x] `libs/server/zones/`, `libs/server/tales/` -- project lookups for zone, tale group and tale through public interfaces -- AD-1.
- [x] `libs/contract/` -- paths, schemas, codes; regenerate -- AD-3.
- [x] `apps/api/src/` -- invitation routes, authorization helper used by every route, list filtering, error mapping; tests for every matrix row.
- [x] `apps/dashboard/src/app/` -- invite drawer with copy, invite page, role-aware UI; component tests.

**Acceptance Criteria:**
- Given an admin and projects A and B, when the admin invites someone to A and that person opens the link and creates a passkey, then they see project A and its zones, and not B.
- Given that content manager, when they call any API route for B, then it answers 403 `forbidden`.
- Given a used or 7-day-old invitation link, when it is opened, then the dashboard says it is no longer valid and the API answers 410.
- Given the database, when the invitations table is read, then it holds token hashes, never tokens.

## Implementation Notes

- Access module: `project_members` (PK project+user), `invitations` (`token_hash`, `created_by`, `expires_at`, `used_at`, `used_by`); the `auth_challenges` purpose check is replaced idempotently to allow `invitation`. Token helpers moved to `tokens.ts` (`newToken`, `hashToken`); sessions reuse them. `members.ts`: `accessibleProjectIds` returns `'all' | string[]` (`ProjectScope`), `canAccessProject`, `addProjectMember`. `invitations.ts`: `createInvitation`, `previewInvitation`, `startInvitation`, `finishInvitation`; the challenge row carries the invitation id, and redeem re-checks the invitation under `SELECT … FOR UPDATE` inside the transaction that creates user, passkey, membership and session. Unique violations on email or credential map to `email_taken` / `passkey_failed`.
- `listProjects` and `listZones` take an optional `ProjectScope`. Tales exports `taleGroupProjectId`, `taleProjectId`; zones already had `zoneProjectId`.
- API: `http/authorize.ts` holds `authorize` / `authorizeParam` (resolve the resource's project through the owning module, 403 when not accessible, pass through when missing so the route's own 404 or 400 stays), `requireAdmin`, `accessibleScope`. `POST /zones` authorizes the body's `projectId` after validation. Invitation links are `${RP_ORIGIN}/invite/<token>` (`AppAuth.dashboardOrigin`, set from RP_ORIGIN in `main.ts`). Invitation options validate the body (400) before the link (410).
- Contract: `forbidden`, `invitation_invalid`, `email_taken`; `Invitation`, `InvitationPreview`, `RedeemInvitationRequest`; `INVITATION_TTL_MS`, `invitationPath`; 403 listed on every project-scoped route.
- Dashboard: `AuthStore.isAdmin`, `invitation(token)`, `join(token, name, email)`; switching users on one browser resets the store. `/invite/:token` is a bare route without a guard. The invite drawer (`kind: 'invite'`) shows the link once in a read-only field with "Copy link", the expiry date and "Done". Content managers get no "New project", no "Invite", and an empty state that says to ask an admin.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 3 findings — high 0, medium 0, low 3, false 0, maybe-false 0
- findings:
  - `[low]` `[reject]` When a link is used between options and verify, or the email is taken, the challenge row and cookie stay until the 5-minute expiry — harmless (the row expires and the cookie is single-use), matches the setup flow, and the fix adds error branches.
  - `[low]` `[patch]` `projectName` in the access module had no caller — fixed: removed with its export.
  - `[low]` `[reject]` `finishInvitation` returns a `projectId` only the unit test reads — harmless output that documents what was joined.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage` -- expected: all succeed.

**Manual checks (if no CLI):**
- The parent session runs admin setup, creates an invitation, redeems it in a second browser context with a CDP virtual authenticator, and screenshots the invite drawer and the content manager's Projects page.

## Auto Run Result

**Summary:** The access module adds project membership and invitations. An admin creates a one-time, 7-day invitation link for a project (token stored only as a hash); the invitee opens it, registers a passkey and is signed in as a content manager of that project, all in one locked transaction. Every Management API route authorizes the project it touches through one helper: admins see all projects, content managers only their own (403 `forbidden` otherwise), and project and zone lists are filtered. The dashboard has an Invite drawer with Copy link, an invite page, and hides admin-only actions from content managers.

**Files changed:**
- `libs/server/access/src/lib/` — `project_members`, `invitations`, `members.ts`, `invitations.ts`, `tokens.ts`; filtered `listProjects`; unit tests.
- `libs/server/zones`, `libs/server/tales` — filtered `listZones`; `taleGroupProjectId`, `taleProjectId`.
- `libs/contract/` — invitation paths and schemas, 403 on project routes, codes `forbidden`, `invitation_invalid`, `email_taken`; regenerated.
- `apps/api/src/` — `http/authorize.ts` used by every route, invitation routes, error mapping; tests for every matrix row.
- `apps/dashboard/src/app/` — `AuthStore` roles and join, `pages/invite.ts`, Invite drawer, role-aware UI; tests.
- `.env.example` — note that invitation links use `RP_ORIGIN`.

**Review:** 1 patch applied (low), 0 deferred, 2 rejected (low: leftover challenge row until expiry; unused `projectId` output).

**Follow-up review recommended:** false. No high or medium findings were patched.

**Verification:** `nx run-many -t lint test build` for the seven projects passed before and after the patch (api 116, server-access 22, dashboard 49 tests). End to end in Chromium with two CDP virtual authenticators against `taleart_e2e_test`: admin setup, two projects, an invitation to "Acme shop", redemption in a second context; the content manager saw only "Acme shop", creating a zone in "Beta app" returned 403, and the reused link returned 410. Screenshots were sent to the user.

**Residual risks:**
- Invitation links are only as correct as `RP_ORIGIN` in a deployment.
- The migration drops and re-adds the challenge purpose check on every start.
