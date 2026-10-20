---
title: 'Reorder tale groups and tales'
type: 'feature'
ticket: '4'
created: '2026-10-20'
status: 'built'
baseline_revision: '48f34bbced88b08e2ad543d78c0bde6cee3f4688'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tale groups and tales keep the order they were added in (`position`, story 3), but a content manager cannot change it; PRD FR-011 asks for reordering by drag.

**Approach:** Two API calls that set the full order of a zone's tale groups and of a group's tales, and drag-and-drop in the dashboard (groups vertically, tales horizontally) with a keyboard and single-pointer alternative (move earlier and later buttons).

## Boundaries & Constraints

**Always:** An order request lists every id of the parent's children exactly once; anything else is refused, so a stale dashboard cannot drop or duplicate items. Positions are rewritten to 0..n-1 in one transaction that locks the parent (the tale-group row for tales; the zone advisory lock from story 3 for groups). The dashboard updates the order at once (optimistic) and reverts with the API's message on failure. Drag uses `@angular/cdk/drag-drop` (MIT, part of Angular); every drag has a button alternative (WCAG 2.2 SC 2.5.7) with an accessible name, and moves are announced through a polite live region. Module rules from earlier stories hold; contract first; story 14 design system.

**Never:** Moving a tale to another group or a group to another zone. Deleting. Changing the `position` storage scheme.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reorder groups | `PUT /api/v1/zones/{zoneId}/tale-groups/order {taleGroupIds: [B, A]}` | 200, the zone's groups in the new order with positions 0..n-1 | — |
| Reorder tales | `PUT /api/v1/tale-groups/{taleGroupId}/tales/order {taleIds: [Y, X]}` | 200, the group's tales in the new order | — |
| Kept after reload | reorder, then list | lists return the new order, also after an API restart | — |
| Missing or extra id | list omits a child, repeats one, or names a child of another parent | 409 | `order_mismatch` |
| Not a list | body missing the array, or an item is not a string | 400 | `validation_failed` |
| Unknown parent | zone or tale group missing or not a UUID | 404 | `zone_not_found` / `tale_group_not_found` |
| Drag in dashboard | drag tale 2 before tale 1 | cards swap at once, badges renumber, order call sent | on refusal, order reverts and the message shows in a banner on the zone page |
| Keyboard | focus a tale card's "Move earlier" | tale moves one place earlier, focus stays on the moved tale, live region announces "New arrivals moved to position 1 of 2" | first item: "Move earlier" disabled |

</intent-contract>

## Code Map

- `libs/server/tales/src/lib/tales.ts` -- `inTransaction`, advisory lock key `'tale_groups:' || zoneId` in `createTaleGroup`, `FOR UPDATE` on the group in `createTale`, `listTaleGroups`; add `orderTaleGroups(db, zoneId, ids)` and `orderTales(db, taleGroupId, ids)` plus `OrderMismatchError`. Reuse the same lock so order and create cannot interleave.
- `apps/api/src/http/tale-groups.router.ts`, `tales.router.ts`, `errors.ts`, `validation.ts` -- route and error patterns (parent check first, then body); map `OrderMismatchError` to 409.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- two PUT paths, request schemas, code `order_mismatch`; regenerate.
- `apps/api/src/app.spec.ts` -- integration tests against `taleart_test`.
- `apps/dashboard/src/app/dashboard.store.ts`, `pages/zone-detail.*`, `styles.css`, `app.spec.ts` -- tale-group rows and tale cards from story 14; add drop lists, drag handles, move buttons (visible on hover and focus, always on touch), the live region and the error banner.
- `package.json` -- add `@angular/cdk` at the installed Angular version.

## Tasks & Acceptance

**Execution:**
- [x] `libs/server/tales/src/lib/` -- order functions with locking and mismatch check; unit tests.
- [x] `libs/contract/` -- paths, schemas, code; regenerate -- AD-3.
- [x] `apps/api/src/` -- routes, validation, error mapping; tests for every matrix row.
- [x] `apps/dashboard/src/app/` -- drag-and-drop for groups and tales, move buttons, live region, optimistic update with revert; component tests.
- [x] `package.json` -- `@angular/cdk`.

**Acceptance Criteria:**
- Given a zone with groups A, B and tales X, Y in A, when the user drags B above A and Y before X, then after a page reload the zone shows B, A and A shows Y, X.
- Given the API refuses an order, when the dashboard sent it, then the previous order is shown again with the API's message.
- Given only a keyboard, when the user tabs to a tale card and activates "Move later", then the tale moves and the change is announced.

## Implementation Notes

- Mismatch check runs inside the locked transaction (zone advisory lock for groups, `FOR UPDATE` on the group row for tales); ids that are not UUIDs count as a mismatch (409), not a 400. An empty list for a parent with no children answers 200.
- Dashboard: optimistic order per zone keeps a request counter, so only the latest order request's answer (or revert) replaces what is shown.
- Move buttons are named "Move {title} earlier/later"; drag handles are pointer-only (`aria-hidden`), the buttons are the alternative. After a move, focus returns to the same button, or the item's other button when it reached an end (the first button is then disabled).

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 5 findings — high 0, medium 1, low 4, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` Concurrent order PUTs could commit out of order, a group reorder's answer could overwrite a newer tale order, and stale refusals were not reverted, so the screen could differ from the saved order — fixed: one queue per zone sends order requests one at a time; the last confirmed order is restored on refusal and moves queued behind it are dropped; new test.
  - `[low]` `[patch]` `OrderTalesRequest.taleIds` declared `maxItems: 100` that the server did not enforce — fixed: removed from the contract; regenerated.
  - `[low]` `[patch]` Group-order unit test made no assertion on the result — fixed: asserts the returned order.
  - `[low]` `[patch]` Banner and live-region text survived a change of zone — fixed: reset when `zoneId` changes.
  - `[low]` `[patch]` Tale-order mismatch tests had no non-UUID id — fixed: added, expects 409.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-tales` -- expected: all succeed.

**Manual checks (if no CLI):**
- The parent session reorders tales on the running dev servers and screenshots the zone page.

## Auto Run Result

**Summary:** Two API calls set the full order of a zone's tale groups and of a group's tales, under the same locks as creation, refusing any list that does not name every child exactly once (409 `order_mismatch`). The dashboard reorders by drag (`@angular/cdk/drag-drop`) and by "Move earlier/later" buttons, announces moves, updates at once and restores the confirmed order with the API's message on refusal.

**Files changed:**
- `libs/server/tales/src/lib/tales.ts` — `orderTaleGroups`, `orderTales`, `OrderMismatchError`; unit tests.
- `libs/contract/` — two PUT paths, request schemas, `order_mismatch`; regenerated.
- `apps/api/src/http/` — routes, `requiredStringArray`, 409 mapping; integration tests.
- `apps/dashboard/src/app/` — drag-and-drop, move buttons, live region, error banner, queued order requests; component tests.
- `package.json`, `package-lock.json` — `@angular/cdk` 22.1.8.

**Review:** 5 patches applied (1 medium, 4 low), 0 deferred, 0 rejected.

**Follow-up review recommended:** false. One medium and no high were patched.

**Verification:** `nx run-many -t lint test build -p api dashboard contract server-tales` passed before and after the patches (api 74, server-tales 20, dashboard 32 tests). On the dev servers "Move Sneakers on sale earlier" was clicked in a real browser and the order survived a reload; screenshots were sent to the user.

**Residual risks:**
- Drag is tested by firing the CDK drop event, not real pointer movement.
- A full data refresh landing while order requests are pending can show the older order until they settle.
