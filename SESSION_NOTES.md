# Session Notes — 2026-06-30

## Hard Rules — Non-Negotiable

### 1. Multi-Site Architecture
**Every feature in every module must be designed for N sites from day one.**

- No single-site assumptions anywhere in the codebase
- No global queries without a `site_id` filter
- No hardcoded site names (Kamativi, Selous, Manhize, etc.)
- All data, reports, permissions, and workflows are scoped to `site_id`
- Super-admins can switch between sites at any time via the SiteSwitcher
- When a site switch happens, **stale data from the previous site must clear immediately** — never show data from site A while site B is loading
- Every data-providing context (CampsiteContext, FuelContext, etc.) must:
  - Depend on `currentSiteId` and re-fetch when it changes
  - Clear all state arrays before re-fetching (`setTanks([])` etc.)
  - Return early with `loading = false` if `currentSiteId` is null
- Every module that scopes data by site **must** wrap its content in `<SiteRequired>` — enforced at render layer, not just in fetch logic
- `SiteRequired` component lives in `src/components/SiteRequired.jsx`

### 2. UI Design Philosophy
**The ERP must never feel like a traditional enterprise application.**

Instead it must feel: **modern · clean · spacious · intelligent · minimal · professional · consistent · responsive**

Principles:
- Every screen immediately communicates only the information that matters
- If something is rarely used → belongs in Settings, advanced options, or contextual menus — **not on the main screen**
- The UI must make complex workflows feel simple
- No dense tables with 10+ columns as the primary view
- Prefer cards, summaries, and progressive disclosure over raw data dumps
- Use whitespace generously — crowded UIs feel old
- Status and alerts should be contextual and visual (color, icons, badges) — not text labels alone
- Actions should be prominent where needed and hidden where not
- Consistent component vocabulary: Card, Modal, Button (filled/tonal/outlined/text), Chip, PageHeader, StatCard, TableWrap, TRow

---

## What We Did (Previous Sessions)

### 1. Shared Table Components (`ui.jsx`)
Added 5 reusable table exports: `TableWrap`, `THead`, `Th`, `TRow`, `Td`.
Applied across ~14 pages to replace repeated inline table markup.

**Pages updated:**
- `AuditLogViewer.jsx`
- `UserManagement.jsx`
- `CampAssignments.jsx`
- `CampRooms.jsx`
- `CampSupplies.jsx` (movement history table; monthly report kept raw for colored cells)
- `CampOccupancyReport.jsx` (per-block table; grand total row kept raw)
- `WorkforceLeave.jsx`
- `Billing.jsx` (daily breakdown table; grand total row kept raw)
- `Employees.jsx`

### 2. Dynamic Print Headers
Replaced hardcoded `"Bravura Campsite"` with `currentSite?.name` in all report print headers.

**Files fixed:**
- `Reports.jsx` (meals daily / range / monthly reports)
- `CampHeadcount.jsx`
- `CampOccupancyReport.jsx`

### 3. Site Filter on Workforce Reports
Added `.eq('site_id', currentSiteId)` to the employees query in `WorkforceReports.jsx` so the report only shows employees for the selected site.

### 4. SQL Migration — `daily_submissions` UNIQUE Constraint
Changed `UNIQUE(date)` → `UNIQUE(date, site_id)` so multiple sites can submit meals for the same date.
Confirmed already applied on Supabase (constraint `daily_submissions_date_site_key` exists).

### 5. Infrastructure
- Fixed git commit author to `Claude <noreply@anthropic.com>` (verified commits)
- Resolved PR merge conflicts via rebase onto `main`
- Merged PR #2 → `main` (commit `341828c`)
- Supabase MCP connected: can read schema and apply migrations directly

---

## Verified — No Action Needed

1. **Meal pin removal** — Zero references to `profiles.meals_pin` anywhere in the codebase. Already fully purged.
2. **`daily_submissions` multi-site integrity** — Constraint `daily_submissions_date_site_key` (`UNIQUE(date, site_id)`) already exists on Supabase. Clean.
3. **Print styles** — `index.html` global `<style>` block has `.print-only { display: none }` and `@media print { .print-only { display: block !important } }` covering all report pages. No CSS file needed.

---

## What's Next (Suggested)

1. **`WorkforceReports.jsx` — contractor filter site scope** — check if contractor filter also needs `.eq('site_id', currentSiteId)`.
2. **Room auto-release on long leave** — the DB trigger that releases a room when `employees.status` flips to `long_leave` should be tested end-to-end.
3. **Role/permission audit** — confirm `storekeeper` still does NOT have `supplies.approve` and `approver` role is not referenced anywhere in code.

---

## Today's Session — Fuel Management Module (2026-06-30)

### Built
- **Fuel Management module** — full CRUD for fuel receipts, issues, dip-stick readings, tanks
- **FuelContext** — site-scoped data context (clears stale data on site switch)
- **FuelDashboard** — stat cards, per-tank SVG gauge rings, 20% low-fuel alert banner
- **FuelTanks** — admin-only (fuel.delete) tank/container management
- **FuelReports** — Monthly Usage, Variance/Dip Analysis, Asset Consumption tabs
- **SiteRequired** guard component — clean empty state when `currentSiteId` is null
- **ModuleLayout** PAGE_TITLES — fuel pages added to breadcrumb map
- **SQL migration** — `bravura-meals/migrations/fuel_management.sql`

### Multi-Site Hard Rules Applied
- FuelContext: `currentSiteId`-gated fetchAll; stale data clears before re-fetch
- All 4 fuel tables include `site_id NOT NULL`; all queries filter by it
- FuelProvider wraps children in `<SiteRequired>` so pages never render without a site

### Design Rules Applied
- Tank cards use SVG gauge rings (visual) not just text labels
- Low-fuel state surfaced via banner + red border + stat card (contextual, not buried)
- Rarely-used tank admin (capacity, designation) → Tanks page behind admin permission
- Action buttons are minimal: just "Record Receipt" and "Issue Fuel" on dashboard
