# Bravura ERP — Unified Development Roadmap

> Last updated: 2026-09-14

---

## System Overview

**Stack:** React 19 + Vite SPA (`bravura-meals/`), Supabase (PostgREST + RLS), Vercel auto-deploys from `main`.

**Sites:** Kamativi (KAM — primary), Selous, Manhizi, Harare (HQ / head_office).

**Modules (business cycle order):**

| # | Module | Code | Status |
|---|--------|------|--------|
| 1 | Finance | FI | **Complete** (Phases 1–5) |
| 2 | Procurement | PR | **Built** — dashboard revamp pending |
| 3 | Inventory / Stores | IN/ST | **Planned** — tables + pages not yet built |
| 4 | Fuel | FU | **Built** (Phases 1–4) — dashboard revamp pending |
| 5 | Fleet | FL | **Built** — dashboard revamp pending |
| 6 | HR | HR | **Built** (Phases 1–5 incl. analytics) — designation display bug, dashboard revamp pending |
| 7 | Contractors | CL | **Built** (Phases 1–3) — cost dashboard/reports pending |
| 8 | Departments | DP | **Planned** — portal not yet built |
| 9 | Campsite | CA | **Built** — dashboard revamp pending |
| 10 | Concrete Operations | CO | **Planned** — new module |
| 11 | Projects | PJ | **Planned** — new module (SharePoint/Planner style) |

**Cross-cutting:** HQ multi-site architecture (applySiteFilter, site badges, cross-site dashboards) — **planned**, prompts documented below.

---

## What's Done

### Finance (FI) — ALL COMPLETE
- Phase 1: GL Foundation — Chart of Accounts, Journal Entries, GL Posting Engine, Permissions
- Phase 2: Banking — Bank Accounts, Bank Reconciliation (CSV import, auto-match)
- Phase 3: Financial Reports — Trial Balance, Profit & Loss, Balance Sheet
- Phase 4: Cash Flow & Cost Centres — Cash Flow Statement, Cost Centres + Report
- Phase 5: Cross-Module Integration — Auto GL Postings (fuel, fleet, meals, payroll), Finance Dashboard with interactive SVG charts

T-codes: FI01–FI12

### Fuel (FU) — CORE COMPLETE
- Phase 1: Tank management, dip readings, fuel receipts
- Phase 2: Fuel issuance, vehicle/equipment consumers, odometer tracking
- Phase 3: Reports (daily, monthly, variance, delivery, vehicle consumption, cost allocation)
- Phase 4: Fuel requests/approvals, budget tracking

T-codes registered. Dashboard exists but needs revamp to interactive SVG charts.

### Fleet (FL) — CORE COMPLETE
- Vehicle and equipment registry, operators, maintenance scheduling
- Maintenance records, parts tracking, status history
- Fleet dashboard (basic — needs revamp)
- RLS lockdown (migration 0079 applied)

### HR (HR) — PHASES 1–5 COMPLETE
- Phase 1: Foundation — employees, departments, designations, employee numbers (BRA prefix)
- Phase 2: Leave management, documents, medical records, org chart, site transfers
- Phase 3: Attendance/shifts, training, skills matrix, HR reports
- Phase 4: Payroll, appraisals, disciplinary, exit management
- Phase 5: HR analytics/AI

Migrations 0100–0108 applied. **Known bug:** designations display as blank — needs investigation.

### Contractors (CL) — PHASES 1–3 COMPLETE
- Phase 1: Contractor companies, contracts, casual workers registry
- Phase 2: Timesheets, hired vehicles, hired equipment
- Phase 3: Placeholder cost dashboard/reports pages (awaiting cross-module RPCs)

Migration 0083 applied. **Remaining:** Phase 4 (cost aggregation RPCs), Phase 5 (compliance/insurance tracking), Phase 6 (cross-module integration).

### Campsite (CA) — CORE COMPLETE
- Blocks, rooms, beds, room assignments, camp headcount
- Camp supplies, meals integration
- Migration 0081 (beds/assignments site_id) applied

### Procurement (PR) — CORE COMPLETE
- Suppliers, requisitions, purchase orders, approvals
- Receipts, supplier performance

### Meals (ME) — CORE COMPLETE
- Daily entry, kitchen confirm, approvals, billing, reports

### Admin (AD) — BUILT
- User management, roles, permissions, audit log viewer, site management

---

## What's NOT Done

### Immediate Fixes
- [ ] **HR designation display bug** — showing blanks
- [ ] **Preferences page** — needs redesign with proper sections

### Modules Not Yet Built
- [ ] **Inventory / Stores (IN/ST)** — full module (catalogue, stock operations, procurement workflow, reports)
- [ ] **Concrete Operations (CO)** — full module (mix designs, batches, cement/aggregate inventory, cube tests, reorder alerts)
- [ ] **Projects (PJ)** — full module (Kanban boards, task management, timeline/Gantt, files — SharePoint/Planner style)
- [ ] **Departments (DP)** — contextual portal showing "{Department Name} Department" scoped to user's department

### Dashboard Revamps Needed (all modules → interactive SVG charts like Finance)
- [ ] Procurement dashboard
- [ ] Inventory dashboard
- [ ] Fuel dashboard
- [ ] Fleet dashboard
- [ ] HR dashboard
- [ ] Contractors dashboard
- [ ] Campsite dashboard
- [ ] Concrete dashboard (new)

### Module Reorder
- [ ] Reorder sidebar, home tiles, command palette to business cycle order (Finance → Procurement → Inventory → Fuel → Fleet → HR → Contractors → Departments → Campsite → Concrete → Projects)

### Contractors Remaining
- [ ] Phase 4: Cost aggregation RPCs, cost dashboard with real data
- [ ] Phase 5: Compliance tracking, insurance expiry alerts, safety certifications
- [ ] Phase 6: Cross-module integration (link to procurement POs, fleet assets, finance GL)

### HQ Multi-Site Architecture
- [ ] Foundation: `applySiteFilter()` helper, SiteContext `isHQ` flag, HQ badge
- [ ] FuelContext cross-site data loading
- [ ] CampsiteContext cross-site data loading
- [ ] Procurement centralization under HQ (requesting_site_id)
- [ ] Employee transfers table and UI
- [ ] Fleet cross-site visibility with site badges
- [ ] Site badges and filtering sweep across all list views
- [ ] Dashboard cross-site aggregation
- [ ] Reports cross-site support
- [ ] Security audit

---

## Development Phases

### Phase 1 — Module Reorder & Concrete Foundation

#### 1.1 Module Reorder

Reorder the entire ERP navigation to follow the business cycle:

| Order | Module | Code |
|-------|--------|------|
| 1 | Finance | FI |
| 2 | Procurement | PR |
| 3 | Inventory / Stores | ST |
| 4 | Fuel | FU |
| 5 | Fleet | FL |
| 6 | HR | HR |
| 7 | Contractors | CL |
| 8 | Departments | DP |
| 9 | Campsite | CA |
| 10 | Concrete Operations | CO |
| 11 | Projects | PJ |

- [ ] Reorder sidebar navigation
- [ ] Reorder home screen module tiles
- [ ] Reorder command palette (Cmd+K) groupings
- [ ] Update `moduleAccess`, nav arrays, and `DEFAULT_PAGE` mappings in `permissions.js`
- [ ] Verify all existing routes and deep links still work

#### 1.2 Concrete Operations — Database Migration

New tables with RLS policies using `_has_permission('concrete.view', site_id)` pattern:

| Table | Purpose |
|-------|---------|
| `mix_designs` | Versioned concrete recipes per grade (C20, C25, C30, C40 etc.) |
| `mix_design_aggregates` | Per-aggregate quantities in each mix design |
| `aggregate_types` | Aggregate catalogue: 10mm, 20mm, 40mm, Crusher Dust, River Sand |
| `concrete_batches` | Production records — batch number, grade, quantity m³, truck, driver, project, status |
| `batch_aggregates` | Actual vs theoretical aggregate usage per batch |
| `cement_deliveries` | Cement receipt log — supplier, quantity, cost, silo |
| `aggregate_deliveries` | Aggregate receipt log — per type, supplier, quantity, cost, stockpile |
| `cube_tests` | Quality control — 7-day and 28-day compressive strength test results |
| `batch_plant_settings` | Operational config — minimum stock levels, lead times, safety factors |

Key relationships:
- `concrete_batches.fleet_asset_id` → `fleet_assets` (mixer trucks)
- `concrete_batches.driver_id` → `profiles`
- `concrete_batches.project_id` → `projects`
- `concrete_batches.mix_design_id` → `mix_designs`
- `cube_tests.batch_id` → `concrete_batches`

---

### Phase 2 — HR Fix + Preferences + Dashboard Revamps (Part 1)

#### 2.1 HR Designation Fix
- [ ] Investigate and fix blank designations on employee records

#### 2.2 Preferences Page Improvement
- [ ] Profile, Notifications, Display, Security, Accessibility sections

#### 2.3 Procurement Dashboard Revamp
- [ ] KPI tiles with sparklines, spend bar chart, category donut, top suppliers, pending approvals

#### 2.4 Inventory/Stores Dashboard Revamp
- [ ] KPI tiles, stock value by category, low stock alerts, receipts vs issues trend

#### 2.5 Fuel Dashboard Revamp
- [ ] KPI tiles with sparklines, tank gauge charts, consumption trends, top consumers, alerts

---

### Phase 3 — Dashboard Revamps (Part 2) + Concrete Production

#### 3.1 Fleet Dashboard Revamp
- [ ] KPI tiles, status donut, maintenance cost bar, utilization gauge, upcoming maintenance

#### 3.2 HR Dashboard Revamp
- [ ] KPI tiles, department donut, hires vs terminations trend, turnover gauge, leave overview

#### 3.3 Contractors Dashboard Revamp
- [ ] KPI tiles, spend by contractor bar, contract type donut, expiring contracts alerts

#### 3.4 Campsite Dashboard Revamp
- [ ] KPI tiles, occupancy gauge, trend bar, room status grid, meal trends

#### 3.5 Mix Designs Screen
- [ ] List/edit mix designs per grade, dynamic aggregate rows, version tracking

#### 3.6 Concrete Batches Screen
- [ ] Batch creation flow (grade → mix design → calculate materials → assign truck/driver/project)
- [ ] Status workflow: Mixing → Dispatched → Delivered → Cancelled
- [ ] Actual vs theoretical material tracking with variance display

---

### Phase 4 — Concrete Inventory + Quality Control + Project Costing

#### 4.1 Cement Inventory
- [ ] Deliveries log, stock view (opening + deliveries − consumed = remaining)
- [ ] Reorder alert: days of stock remaining, color-coded urgency, "ORDER NOW" when within lead time

#### 4.2 Aggregate Inventory
- [ ] Same structure per aggregate type (10mm, 20mm, 40mm, crusher dust, river sand)

#### 4.3 Cube Tests
- [ ] Log 7-day and 28-day compressive strength, auto pass/fail vs target

#### 4.4 Project Costing Report
- [ ] Material cost breakdown per project, cost per m³, margin analysis

#### 4.5 Batch Plant Settings
- [ ] Minimum stock levels, lead times, safety factors, batch number config

---

### Phase 5 — Departments Portal + Concrete Dashboard + Integration

#### 5.1 Department Portal
- [ ] Dynamic header: "{Department Name} Department" based on logged-in user
- [ ] Sections: My Team, Department Assets, Requests, Budget, Tasks, Contractors
- [ ] Department selector for managers overseeing multiple departments

#### 5.2 Concrete Operations Dashboard
- [ ] Interactive SVG charts: production KPIs, cement stock gauge, grade donut, cost trend
- [ ] Reorder alerts panel, quality alerts, dispatch log

#### 5.3 Fleet Integration for Mixer Trucks
- [ ] Dispatch log, turnaround analysis, truck utilization, driver performance

#### 5.4 Finance Integration
- [ ] Auto GL postings for cement/aggregate deliveries and concrete production consumption

---

### Phase 6 — Projects Module (SharePoint / Planner Style)

#### 6.1 Project Board (Kanban)
- [ ] Drag-and-drop task cards between customizable buckets
- [ ] Cards: title, assignee, due date, priority, checklist progress, attachments, comments

#### 6.2 Task Detail
- [ ] Rich description, assignees, due dates, priority, labels, checklist, attachments, comments/activity

#### 6.3 Project Hub
- [ ] All projects list with progress %, tabs: Overview, Board, Timeline, Files, Settings

#### 6.4 Timeline / Gantt View
- [ ] Horizontal timeline with task bars, dependencies, zoom levels

#### 6.5 My Tasks View
- [ ] Cross-project view of all tasks assigned to current user

#### 6.6 Team View
- [ ] Workload per member across projects

#### 6.7 Files (Document Library)
- [ ] Per-project file storage, folders, preview, version history

#### 6.8 Database Migration
- [ ] Tables: projects, project_members, project_buckets, project_tasks, task_labels, task_checklist_items, task_comments, task_activity_log, task_attachments, task_dependencies

---

### Future — HQ Multi-Site Architecture

To be executed after all operational modules are built. Converts ERP from "one site at a time" to "HQ sees everything."

1. **Foundation** — `site_type` column on sites, `applySiteFilter()` helper, `isHQ` in SiteContext
2. **Context Updates** — FuelContext, CampsiteContext, ProcurementContext cross-site data loading
3. **Employee Transfers** — `employee_transfers` table, transfer UI, site reassignment
4. **Fleet Cross-Site** — Site badges on vehicles/equipment, asset transfers between sites
5. **List View Sweep** — SiteBadge component, site filter dropdown on all list pages when HQ
6. **Dashboard Aggregation** — Cross-site KPIs and per-site breakdown cards
7. **Reports Cross-Site** — Site filter on all reports, site column in exports
8. **Security Audit** — RLS verification, RBAC not bypassed by HQ view, insert validation

### Future — Inventory Module (IN/ST)

4-phase plan:
1. **Foundation & Catalogue** — stores, item_categories, items, units_of_measure, inventory_movements (immutable ledger)
2. **Stock Operations** — goods receipts, goods issues, stock transfers, stock counts, adjustments
3. **Procurement Workflow** — purchase requisitions → POs → goods receipts (link to Procurement module)
4. **Reports & Automation** — stock valuation, movement history, reorder alerts, ABC analysis

### Future — Contractors Remaining (CL Phases 4–6)

4. Cost aggregation RPCs, real cost dashboard data
5. Compliance tracking, insurance expiry alerts, safety certifications
6. Cross-module: link to procurement POs, fleet assets, finance GL

---

## Architecture Reference

### Permissions
- `permissions` table: `code`, `module`, `action` — all NOT NULL
- `action` CHECK: `('View','Create','Edit','Delete','Approve')` — max 5 per module
- RLS via `_has_permission(code, site_id)` / `_has_hr_permission`
- RBAC: always `const { can } = usePermissions()` then `can('module.action')`

### Database Conventions
- All tables site-scoped via `site_id`
- Soft deletes only (`is_archived` flag, void for journal entries)
- Audit trail: `created_by`, `updated_by`, `created_at`, `updated_at`
- Migrations in `bravura-meals/migrations/`, applied via Supabase SQL editor
- Migration numbering: general from 0079; 0100–0149 reserved for HR

### UI Standards
- Inline styles only, THEME tokens from `src/utils/permissions.js`
- Every screen gets a T-code in `src/utils/txnCodes.js`
- Dashboards: interactive SVG charts with hover tooltips, KPI tiles with sparklines, gauges

### Key Schema Notes
- `sites.site_type` CHECK: `('operational_site','head_office')` — Harare = head_office
- `fleet_status_history` and `fleet_maintenance_parts` have no `site_id` (scope via joins)
- `beds` and `room_assignments` have `site_id` (added in migration 0081)
- PostgREST embeds require real FK. Use `.maybeSingle()` for maybe-empty lookups
- `supabase` is a NAMED export from `src/supabaseClient.js`

### Applied Migrations
0073, 0079, 0080, 0081, 0082, 0083, 0100, 0102, 0103, 0106, 0107, 0108

---

## T-Code Plan

| Code | Page | Module |
|------|------|--------|
| FI01–FI12 | Finance pages | Finance |
| FU01–FU12 | Fuel pages | Fuel |
| FL01–FL06 | Fleet pages | Fleet |
| HR01–HR20 | HR pages | HR |
| CA01–CA06 | Campsite pages | Campsite |
| ME01–ME06 | Meals pages | Meals |
| PR01–PR06 | Procurement pages | Procurement |
| CL01–CL08 | Contractor pages | Contractors |
| AD01–AD06 | Admin pages | Admin |
| CO01–CO08 | Concrete pages | Concrete (new) |
| PJ01–PJ08 | Project pages | Projects (new) |
| DP01–DP04 | Department pages | Departments (new) |
