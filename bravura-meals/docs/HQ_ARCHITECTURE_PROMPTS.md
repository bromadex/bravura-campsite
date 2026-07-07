# Bravura ERP — Multi-Site HQ Architecture Prompts

> **When to run these**: After all operational modules are built and working
> with single-site filtering. These prompts convert the ERP from
> "one site at a time" to "HQ sees everything, operational sites see only
> their own data."

---

## Master Prompt (Context for Every Session)

```
You are working on the Bravura ERP (React 19 + Vite SPA, Supabase PostgREST + RLS).

STANDING RULES (always enforced):
- Push to BOTH branches after every commit: main AND claude/code-review-re5zt3
- Commit author: git config user.email noreply@anthropic.com && git config user.name Claude
- NEVER READ OR WRITE profiles.meals_pin
- RBAC: NEVER hardcode role checks. Use const { can } = usePermissions() then can('module.action')
- NEVER DELETE RECORDS — soft deletes only (exception: user explicitly asked for hard-delete with audit trail)
- EVERY Supabase query must include .eq('site_id', currentSiteId) — UNLESS the current site is HQ (is_hq = true), in which case the site filter is conditionally skipped to show cross-site data
- INLINE STYLES ONLY — no CSS files, no Tailwind. Use THEME tokens from utils/permissions
- MODULE_COLORS.fuel = '#D97706' (amber), MODULE_COLORS.procurement = '#7C3AED' (violet)
- usePermissions imported from '../../hooks/usePermissions' (fuel/fleet pages) or '../../contexts/PermissionsContext' (other pages)
- This is a MULTI-SITE system with HQ architecture — Harare is the headquarters
- Theme locked to light mode

ARCHITECTURE:
- sites table has site_type column ('head_office' | 'operational'). Harare (site_type = 'head_office') is the corporate HQ.
- SiteContext exposes: currentSiteId, currentSite, isHQ (derived from site_type === 'head_office'), allSites, accessibleSites
- When isHQ is true, contexts fetch data across ALL sites (no site_id filter) and join sites(name) for labelling
- When isHQ is false, contexts filter by .eq('site_id', currentSiteId) as before
- RLS function user_in_site() already supports global access via user_roles.site_id IS NULL
- applySiteFilter(query, currentSiteId, isHQ) is the standard helper — use it everywhere
- List views show a site badge on each row when isHQ is true
- HQ pages include a "Filter by site" dropdown to narrow cross-site views

TABLES:
- employee_transfers: tracks site reassignment history (employee_id, from_site_id, to_site_id, transfer_date, type, reason)
- procurement_suppliers: centralized under HQ site_id (Harare owns all suppliers)
- procurement_requisitions: site_id = requesting site, managed from HQ
- fuel_vehicles / fuel_equipment: site_id = current location, shown cross-site from HQ with site badge
```

---

## Prompt 1: Foundation — Sites Table & SiteContext

```
TASK: Add HQ foundation to the multi-site architecture.

1. MIGRATION — Add is_hq column to sites table:
   - ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_type TEXT NOT NULL DEFAULT 'operational' CHECK (site_type IN ('head_office', 'operational'));
   - UPDATE sites SET site_type = 'head_office' WHERE lower(name) LIKE '%harare%';
   - Add unique index: only one site can be head_office

2. SITECONTEXT — Extend useSite() to expose isHQ:
   File: src/contexts/SiteContext.jsx
   - After currentSite is resolved, derive: const isHQ = currentSite?.site_type === 'head_office'
   - Expose isHQ in the context value
   - When fetching sites, include is_hq in the select: .select('*') already covers it
   - Update the SiteSwitcher component to show a small "HQ" badge next to Harare in the dropdown

3. HELPER — Create applySiteFilter utility:
   File: src/utils/siteFilter.js
   - Export function applySiteFilter(query, currentSiteId, isHQ):
     - If isHQ is true, return query unchanged (no site filter)
     - If isHQ is false, return query.eq('site_id', currentSiteId)
   - This is the ONE place site filtering logic lives — every context must use it

4. Do NOT change any existing contexts or pages yet. This is foundation only.

Test: Switch to Harare in site selector — it should show "HQ" badge. Switch to Kamativi — no badge. The applySiteFilter utility should be importable but not yet used.
```

---

## Prompt 2: FuelContext — Cross-Site Data Loading

```
TASK: Update FuelContext to support HQ cross-site data loading.

File: src/contexts/FuelContext.jsx

1. Import { applySiteFilter } from '../utils/siteFilter'
2. Import { isHQ } from useSite() — destructure it alongside currentSiteId
3. Replace every .eq('site_id', currentSiteId) call with applySiteFilter(query, currentSiteId, isHQ)
4. When isHQ is true, add .select('*, sites!inner(name)') joins (or sites(name) if not inner) so each record carries its site name for display
5. Update the fetchAll dependency array to include isHQ
6. For insert/create operations (addTransaction, addVehicle, etc.): these should STILL require a specific site_id. When isHQ, the user must select which site the record belongs to — do NOT auto-stamp with HQ site_id. For now, keep currentSiteId as the default but add a TODO comment noting that HQ creates will need a site picker.

IMPORTANT: Do not change any page components yet. Only the context layer.
```

---

## Prompt 3: CampsiteContext — Cross-Site Data Loading

```
TASK: Update CampsiteContext to support HQ cross-site data loading.

File: src/contexts/CampsiteContext.jsx

Same pattern as Prompt 2:
1. Import applySiteFilter
2. Destructure isHQ from useSite()
3. Replace .eq('site_id', currentSiteId) with applySiteFilter()
4. When isHQ, join sites(name) for labelling
5. The cascading filter (blocks → rooms → assignments) should still work — when HQ, blocks come from ALL sites, rooms come from ALL those blocks, etc.
6. Insert operations keep currentSiteId as default with TODO for HQ site picker
```

---

## Prompt 4: ProcurementContext — Centralise Under HQ

```
TASK: Centralise procurement under Harare HQ.

1. MIGRATION — Move all procurement data to HQ:
   - UPDATE procurement_suppliers SET site_id = (SELECT id FROM sites WHERE is_hq = true) WHERE site_id != (SELECT id FROM sites WHERE is_hq = true);
   - UPDATE procurement_requisitions SET site_id = (SELECT id FROM sites WHERE is_hq = true) WHERE site_id != (SELECT id FROM sites WHERE is_hq = true);
   - Add a requesting_site_id column to procurement_requisitions to track which site the goods are for:
     ALTER TABLE procurement_requisitions ADD COLUMN IF NOT EXISTS requesting_site_id UUID REFERENCES sites(id);
   - Backfill: UPDATE procurement_requisitions SET requesting_site_id = site_id WHERE requesting_site_id IS NULL;

2. PROCUREMENT CONTEXT — Update queries:
   File: src/contexts/ProcurementContext.jsx
   - Procurement data is ALWAYS loaded regardless of current site (it lives under HQ)
   - But when an operational site is selected, only show requisitions where requesting_site_id = currentSiteId
   - Suppliers are always visible (central registry)

3. SUPPLIERS PAGE — When creating a supplier, always use the HQ site_id, not currentSiteId
   File: src/pages/procurement/Suppliers.jsx

4. Update the FuelReceipts.jsx supplier dropdown to load suppliers from HQ site, not currentSiteId
```

---

## Prompt 5: Employee Transfers Table & History

```
TASK: Create the employee transfer system for cross-site movements.

1. MIGRATION — Create employee_transfers table:
   CREATE TABLE IF NOT EXISTS employee_transfers (
     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     employee_id     UUID NOT NULL REFERENCES employees(id),
     from_site_id    UUID NOT NULL REFERENCES sites(id),
     to_site_id      UUID NOT NULL REFERENCES sites(id),
     transfer_date   DATE NOT NULL DEFAULT CURRENT_DATE,
     effective_date  DATE,
     transfer_type   TEXT NOT NULL DEFAULT 'permanent'
                       CHECK (transfer_type IN ('permanent', 'temporary', 'secondment')),
     reason          TEXT,
     approved_by     UUID REFERENCES profiles(id),
     status          TEXT NOT NULL DEFAULT 'completed'
                       CHECK (status IN ('pending', 'completed', 'cancelled')),
     return_date     DATE,
     notes           TEXT,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     created_by      UUID REFERENCES profiles(id)
   );
   - Add RLS using user_in_site() on from_site_id or to_site_id
   - Add trigger: when a transfer is completed, UPDATE employees SET site_id = to_site_id

2. EMPLOYEES PAGE — Add transfer action:
   File: src/pages/workforce/Employees.jsx
   - Add a "Transfer" button on each employee row (permission-gated)
   - Transfer modal: select destination site, transfer type, reason, effective date
   - On save: insert into employee_transfers, which triggers the site_id update
   - Show transfer history on employee detail/edit view

3. HR from HQ: When isHQ, load employees from ALL sites with site badge on each row
```

---

## Prompt 6: Fleet Cross-Site Visibility

```
TASK: Make fleet assets visible across sites from HQ with site indicators.

1. VEHICLES PAGE (src/pages/fuel/Vehicles.jsx):
   - Import isHQ from useSite()
   - When isHQ: vehicles already come cross-site from FuelContext (Prompt 2)
   - Add a "Site" column to the table showing vehicle.sites?.name or a site badge
   - Add a "Filter by site" dropdown at the top (only visible when isHQ)
   - The site badge should use a consistent colour per site

2. EQUIPMENT PAGE (src/pages/fuel/Equipment.jsx):
   - Same pattern as Vehicles

3. FLEET DASHBOARD (src/pages/fleet/FleetDashboard.jsx):
   - When isHQ: show aggregate stats across all sites
   - Show breakdown cards per site (vehicle count, equipment count)
   - When operational site: show only that site's stats (current behaviour)

4. ASSET TRANSFER: Add ability to transfer a vehicle/equipment to another site:
   - Add a "Transfer Site" action on vehicle/equipment rows
   - This updates the asset's site_id and logs to an audit trail
   - Consider: fuel_asset_transfers table (asset_type, asset_id, from_site_id, to_site_id, date, reason)
```

---

## Prompt 7: List Views — Site Badges & Filtering

```
TASK: Add site badges and filtering to all list views when in HQ mode.

This is a sweep across ALL list/table pages. For each page:

1. Import { useSite } from the SiteContext
2. Destructure isHQ and allSites
3. When isHQ is true:
   a. Add a "Site" column to the table (or a site badge inline)
   b. Add a "Filter by site" dropdown above the table, defaulting to "All Sites"
   c. Apply client-side filtering when a specific site is selected
4. When isHQ is false: no changes (current single-site behaviour)

SITE BADGE COMPONENT — Create a reusable SiteBadge component:
File: src/components/ui/SiteBadge.jsx
- Props: siteName, siteId
- Renders a small coloured pill with the site name
- Consistent colours per site (hash the site name to pick from a palette)

Pages to update (in order):
- Fuel: FuelDashboard, FuelTanks, FuelReceipts, DipReadings, FuelIssuance, FuelTransactions, FuelRequests
- Fleet: Vehicles, Equipment, Operators
- HR: Employees, Contractors, WorkforceLeave
- Campsite: CampHeadcount, CampRooms, CampBlocks, CampAssignments, CampSupplies
- Meals: Dashboard, DailyEntry, Approvals, KitchenConfirm
- Procurement: Suppliers (always cross-site, but show site badge on requisitions)
- Admin: AuditLogViewer
```

---

## Prompt 8: Dashboards — Cross-Site Aggregation

```
TASK: Update all dashboard pages to show cross-site aggregated data when HQ is selected.

1. FUEL DASHBOARD (src/pages/fuel/FuelDashboard.jsx):
   - When isHQ: show aggregated KPIs across all sites
   - Tank level hero bar: show all tanks grouped by site
   - Recent transactions: merged from all sites with site badges
   - Add site breakdown section: cards per site showing tank levels, consumption

2. FLEET DASHBOARD (src/pages/fleet/FleetDashboard.jsx):
   - When isHQ: show total vehicle/equipment counts across all sites
   - Breakdown cards per site

3. CAMPSITE DASHBOARD (CampHeadcount):
   - When isHQ: aggregate headcount across all camps
   - Show per-site occupancy breakdown

4. MEALS DASHBOARD:
   - When isHQ: aggregate meal counts, costs across all sites
   - Show per-site breakdown

Each dashboard should have a "Site breakdown" section that shows a card/row per operational site with key metrics, making it easy for HQ users to compare sites at a glance.
```

---

## Prompt 9: Reports — Cross-Site Reporting

```
TASK: Update report pages to support cross-site data when HQ is selected.

For each report page:
1. When isHQ: query data across all sites
2. Add a site filter dropdown (default: All Sites)
3. Include site name in exported CSV/PDF data
4. Group-by-site option where applicable

Key reports to update:
- Fuel Reports (daily, monthly, variance, delivery, vehicle consumption, cost allocation)
- Meals Reports (daily, range, monthly, billing)
- HR Reports (workforce reports)
- Campsite Reports (occupancy)

For exports: add a "Site" column to all CSV exports when data spans multiple sites.
```

---

## Prompt 10: Security Audit & RLS Review

```
TASK: Audit the HQ architecture for security correctness.

1. Verify that RLS policies correctly allow HQ users to see cross-site data:
   - user_in_site() already returns true when user_roles.site_id IS NULL
   - Confirm all tables use user_in_site() or equivalent
   - Check for any tables that have manual site_id checks instead of the function

2. Verify that RBAC is not bypassed:
   - HQ view expands DATA SCOPE, not PERMISSIONS
   - A user at HQ who has fuel.view but not meals.view should still not see meals data
   - Test: user with site-scoped role (user_roles.site_id = Kamativi) selecting Harare in site switcher should NOT get cross-site access — their role is site-scoped

3. Verify insert operations:
   - Records created from HQ must have a valid operational site_id (not the HQ site_id for operational data)
   - Procurement is the exception — suppliers live under HQ site_id

4. Check for any direct .eq('site_id', ...) calls that bypassed applySiteFilter()
   - Run: grep -rn "\.eq('site_id'" src/ and verify each one goes through the helper

5. Test edge cases:
   - What happens when a user with site-scoped access switches to HQ?
   - What if HQ has no operational data of its own?
   - What if an employee is transferred mid-month — do reports double-count?
```

---

## Execution Order

| Order | Prompt | Depends On | Estimated Effort |
|-------|--------|------------|-----------------|
| 1     | Foundation (sites, SiteContext, helper) | Nothing | Small |
| 2     | FuelContext cross-site | Prompt 1 | Medium |
| 3     | CampsiteContext cross-site | Prompt 1 | Medium |
| 4     | Procurement centralisation | Prompt 1 | Medium |
| 5     | Employee transfers | Prompt 1 | Medium-Large |
| 6     | Fleet cross-site | Prompt 2 | Medium |
| 7     | Site badges & filtering sweep | Prompts 2-4 | Large |
| 8     | Dashboard aggregation | Prompts 2-4, 7 | Large |
| 9     | Reports cross-site | Prompts 2-4, 7 | Large |
| 10    | Security audit | All above | Medium |

**Total estimated effort: 3-5 sessions**
