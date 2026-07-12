# Bravura ERP — Project Context

Multi-site camp/mining operations ERP. React 19 + Vite SPA in `bravura-meals/`,
Supabase (PostgREST + RLS) backend, Vercel auto-deploys from `main` —
**every push to main IS production**.

## Standing rules (non-negotiable)

- **Push every commit to BOTH branches:** `git push --force-with-lease origin HEAD:main`
  AND `git push --force-with-lease origin HEAD:claude/code-review-re5zt3`
- Commit author: `git config user.email noreply@anthropic.com && git config user.name Claude`
- **NEVER hardcode role names.** Always `const { can } = usePermissions()` then
  `can('module.action')`. The `approver` role is retired.
- **NEVER hard-delete records** — soft deletes / archive flags only.
  (A cleanup sweep of 18 legacy `.delete()` call sites is in progress — see backlog.)
- **Every Supabase query site-scoped:** `.eq('site_id', currentSiteId)` from `useSite()`.
- **Inline styles only**, THEME tokens from `src/utils/permissions.js` (hex strings, not CSS vars).
- Every new screen gets a T-code in `src/utils/txnCodes.js` in the same commit
  (append-only, never renumber). Command palette: ⌘K.
- New user-facing workflows get a role-gated section in
  `src/pages/feedback/QuickStartGuide.jsx`.
- Migrations live in `bravura-meals/migrations/`, are applied **by hand** in the
  Supabase SQL editor (unless a DB connection is provided in chat), and must
  self-record: `INSERT INTO schema_migrations (filename) VALUES ('...') ON CONFLICT DO NOTHING;`
- New tables use meals-pattern RLS: permission + site checked server-side via
  `_has_permission(code, site_id)` (generic) / `_has_hr_permission` — never `USING (true)`.
- Migration numbering: general range continues from 0079; **0100–0149 reserved for HR (Tafara)**.
- Keep architecture AI-ready: server-side RPCs/views, trigger-written audit events.
- Build check before commit: `cd bravura-meals && npx vite build`.

## Critical schema facts (learned the hard way)

- `permissions` table: `code`, `module`, `action` all NOT NULL,
  `action` CHECK-constrained to `('View','Create','Edit','Delete','Approve')`,
  and `UNIQUE (module, action)` — **max 5 permissions per module**.
  HR uses: hr.view / hr.create / hr.edit / hr.terminate (Delete) / hr.approve.
  Fleet uses: fleet.view/create/edit/delete/approve — NOTE: module column values are inconsistently cased ('Fleet', 'HR', 'fuel', 'hr') — always match on p.code, never on module.
- `sites.site_type` CHECK: `('operational_site','head_office')`. Harare = head_office (HQ).
- `fleet_status_history` and `fleet_maintenance_parts` have **no site_id** —
  scope via joins to `fleet_assets` / `fleet_maintenance`.
- `beds` and `room_assignments` have **no site_id** (CampsiteContext works around
  this with `.in()` cascades — scheduled to be fixed by adding site_id).
- PostgREST embeds require a real FK or they 400. Use `.maybeSingle()` for
  maybe-empty lookups. `supabase` is a NAMED export from `src/supabaseClient.js`.
- usePermissions import path: `contexts/PermissionsContext` (hooks/usePermissions re-exports it).
- The live DB is the source of truth — migration files have drifted before;
  verify against information_schema when something errors.

## Sites

Kamativi (KAM — all real data), Selous, Manhizi, Harare (head office).
Default site on login: Kamativi.

## Module map

meals (ME), fuel (FU), fleet (FL), campsite (CA), workforce/HR (HR),
admin (AD), procurement (PR), feedback (FB). HR pages: `src/pages/hr/`
(+ `hr/leave/`). Legacy workforce pages still in `src/pages/workforce/`.

## Current state (July 2026)

- HR Phase 1 (foundation) and Phase 2 (leave, documents, medical, org chart,
  site transfers) are **built and migrated** (0100, 0102, 0103 applied).
- Employee numbers use prefix **BRA** (module_settings, per site).
- Migration **0079_fleet_rls_lockdown.sql is written and pushed but NOT yet
  applied** — apply it first if a DB connection is available, then verify the
  fleet module still works.
- HR Phase 3 is next when the user asks: attendance (SINGLE shift only — no
  shift scheduling), training records, skills matrix. Phase 4: payroll prep.
  Phase 5: HR analytics/AI. See TAFARA_PROMPTS.txt.

## Improvement backlog (agreed with user, work top-down)

1. ~~Rotate leaked DB password~~ (done, user-side)
2. ~~Fleet RLS lockdown~~ (done — 0079 applied and verified 2026-07-12)
3. Soft-delete sweep: 18 hard `.delete()` call sites violate the soft-delete rule.
   Worst: `pages/workforce/Employees.jsx` (hard-deletes employees, destroying
   status history), `contexts/FuelContext.jsx` deleteTank (wipes dip readings /
   calibrations / pumps with unchecked awaits). Others: contractors,
   meal_providers, camp blocks/rooms/supply txns, fleet drivers/compliance,
   user_roles, tank_calibrations, beds.
4. ~~PermissionsContext memoization~~ (done)
5. Add `site_id` to `beds` + `room_assignments`, replace CampsiteContext `.in()`
   cascades with direct site queries (414 URL-length crash risk)
6. Memoize CampsiteContext/FuelContext provider values; replace
   `supabase.auth.getUser()` in CRUD paths with AuthContext user (9 call sites)
7. Shared utils: CSV export helper (BOM+escape duplicated ~10×), `<Denied />`
   component, friendlyError that also reads err.details/err.hint
8. Smoke tests for RPCs + billing math; CI
9. FuelContext pagination (fetch reference data only; paginate transactions)
10. Realtime/staleness handling for flags & approvals (later)

## Database access

No credentials are stored in this repo. If the user provides a connection
string in chat (Session pooler, IPv4: `aws-0-eu-west-1.pooler.supabase.com:5432`),
use `psql` with PGPASSWORD env var, apply migrations directly, and verify.
Never commit credentials. The direct host `db.<ref>.supabase.co` is IPv6-only
and unreachable from cloud containers.
