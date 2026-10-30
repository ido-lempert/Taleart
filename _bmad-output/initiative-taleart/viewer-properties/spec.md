# Viewer properties and audience rules (spec, 2026-10-30)

Owner request: pass segments and user properties from the host app so tale groups can be personalised. Owner constraint: **no viewer data goes to the server; every show/hide decision is made on the client.** Owner confirmed it applies to bars **and banners** (a banner slide is a tale group, so the same filter applies; tests and screenshots must cover both).

## Model
- The host passes **viewer properties**: a flat map `name -> value`. Value types: string, number, boolean, or a list of strings. Names `^[A-Za-z][A-Za-z0-9_.-]{0,63}$` (compared case-sensitively, stored as given). At most 50 properties; a string value at most 256 chars; a list at most 50 items. Invalid entries are dropped with one console warning (web) / ignored (native). Dates are passed as numbers (epoch milliseconds) or ISO strings compared as strings only with eq/neq; the docs say "pass dates as epoch milliseconds".
- A tale group may have an **audience rule** (in addition to its tags): `{ match: 'all' | 'any', conditions: Condition[] }`, 1 to 10 conditions, no nesting. `Condition = { property: string, operator: Operator, value?: string|number|boolean|string[] }`.
- Operators: `eq`, `neq`, `in` (viewer value is one of the listed values), `notIn`, `gt`, `gte`, `lt`, `lte` (numbers only), `contains` (string contains substring, or list contains the item; case-insensitive for strings), `exists`, `notExists` (no `value`).
- Evaluation (`audienceRulePasses(rule, properties)`): 
  - No rule, or an empty rule: passes.
  - **Viewer properties never set (null): every rule passes** (same leniency as tags, so a page without the feature shows everything).
  - Properties set (even empty `{}`): each condition is evaluated; a missing property makes the condition false, except `neq`, `notIn`, `notExists` which are true. A type mismatch (e.g. `gt` on a string, `eq` number vs string) is false; `eq` compares string vs string case-insensitively (NFC, trim, lower) and number/boolean strictly. `match: 'all'` needs every condition, `any` one.
- A group shows only when its **tag rule AND its audience rule** both pass. User lists (server-side, external user id) are unchanged.
- Delivery: the group payload gains `audience` (the rule or `null`). The rule is public (like tag names): keep private content out of rule values. The zone response stays viewer-independent and cacheable.

## Surfaces
1. **Contract**: OpenAPI `AudienceRule`, `AudienceCondition`, `TaleGroup.audience`, `DeliveryTaleGroup.audience`, request to set it; `libs/contract/src/lib/audience-rule.ts` with `audienceRulePasses`, `viewerPropertiesFrom(input)` (validation/normalisation), constants; shared table `libs/contract/targeting/audience-rule.cases.json` (>= 60 cases) run by TS and Kotlin (copied like tag-rule cases).
2. **Server/API**: store the rule on the group (JSONB column + migration), validate (400 `validation_failed` with the reason), `PUT /tale-groups/{id}/audience` (and `DELETE` or `null` to clear), returned on group reads, included in delivery, copied when a group is duplicated, in CLI `groups` command (`--audience-json`), covered by tests. Editor role and above, same as tags.
3. **Web SDK**: `Taleart.init({ properties })`, `Taleart.setProperties(obj|null)` (same re-render without request as `setTags`), `setProperty(name, value|null)`. Filter in the same place as tags (`taleart-element.ts`), so **bar and banner** both filter. Properties never leave the browser (no header, no analytics field). Size budget stays under 50 KB gzip (report the new size).
4. **Native**: `TaleartConfig.properties` (Map<String, Any>? in Kotlin; Swift `[String: Any]`-equivalent typed wrapper that the existing wrappers use), same evaluator in common code with the shared cases; filter next to the tag filter in `TaleartZoneController` (bar and banner). Android and iOS wrappers expose it.
5. **Dashboard**: tale group targeting UI gets an "Audience rule" editor (Any/All, rows of property / operator / value, add/remove, validation, a "Test" box where you type sample properties as JSON and see whether the group would show), the audience summary line ("for viewers where plan is pro and age ≥ 30"), shown in groups table and drawer. Banner and bar groups alike.
6. **Docs** (standing rule: guides with real screenshots + reference tables): targeting page (properties vs tags, when to use which, a decision table, privacy statement "evaluated in the browser/app; never sent"), web guide step, Android and iOS guide steps, Web SDK reference rows (`properties`, `setProperties`, `setProperty`), native reference rows, operator table, evaluation rules table, examples of personas, screenshots: the dashboard editor, a bar and a banner for two different viewers (web, real), native shots if feasible. No competitor names (AD-12).

## Out of scope
Server-side segments, sending properties to the API, nested rules, regex operators, time-based rules, analytics breakdown by property.

## Acceptance
All unit suites of touched projects pass; shared cases pass in TS and Kotlin (Android host + iOS simulator); API tests (run strictly one Nx task at a time); dashboard e2e for the editor; docs tests; screenshots updated.
