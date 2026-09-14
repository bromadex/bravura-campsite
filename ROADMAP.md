# Bravura ERP — Development Roadmap

> Last updated: 2026-09-14

---

## Phase 1 — Module Reorder & Concrete Foundation

### 1.1 Module Reorder

Reorder the entire ERP to follow the business cycle across all navigation surfaces:

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

### 1.2 Concrete Operations — Database Migration

New tables with RLS policies using `_has_permission('concrete.view', site_id)` pattern:

| Table | Purpose |
|-------|---------|
| `mix_designs` | Versioned concrete recipes per grade (C20, C25, C30, C40 etc.) |
| `mix_design_aggregates` | Per-aggregate quantities in each mix design (one row per aggregate type) |
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
- `batch_aggregates.aggregate_type_id` → `aggregate_types`
- `cube_tests.batch_id` → `concrete_batches`

- [ ] Create migration file with all tables, FKs, indexes, and RLS policies
- [ ] Seed permissions: `concrete.view`, `concrete.create`, `concrete.edit`, `concrete.delete`, `concrete.approve`
- [ ] Seed default aggregate types per site
- [ ] Add T-codes: CO01–CO08
- [ ] Add `concreteNav` array and `moduleAccess.concrete` to `permissions.js`
- [ ] Add lazy imports and `getConcretePage()` route function to `App.jsx`

---

## Phase 2 — HR Designation Fix + Preferences Page + Dashboard Revamps (Part 1)

### 2.1 HR Designation Fix

Designations were set up but display as blank on employee records.

- [ ] Investigate root cause: missing join, null FK, or designation not saved on employee create/edit
- [ ] Fix the data query and/or the save logic
- [ ] Verify designations display on: employee list, employee detail, org chart

### 2.2 Preferences Page Improvement

Redesign the user preferences page with a clean, modern layout:

| Section | Contents |
|---------|----------|
| **Profile** | Name, avatar, contact details |
| **Notifications** | Email alerts, in-app alerts (toggles per module) |
| **Display** | Default site, default landing module/page, date format, number format, timezone |
| **Security** | Change password, active sessions |
| **Accessibility** | Font size preference, compact/comfortable density mode |

- [ ] Audit current preferences page
- [ ] Design and build improved layout with section grouping, toggles, dropdowns
- [ ] Save to `profiles` or new `user_preferences` table
- [ ] Respect saved preferences across the app (landing page, date format, etc.)

### 2.3 Procurement Dashboard Revamp

Interactive dashboard with hover tooltips on all charts:

- [ ] KPI tiles with sparklines: total POs this month, total spend, pending approvals count, average PO processing time
- [ ] Bar chart: monthly spend trend (6–12 months)
- [ ] Donut chart: spend by category/department
- [ ] Top suppliers table: name, total spend, PO count, last order date
- [ ] Pending approvals list with quick-action buttons
- [ ] Recent POs table

### 2.4 Inventory/Stores Dashboard Revamp

- [ ] KPI tiles: total stock value, items below reorder level, items received this month, items issued this month
- [ ] Bar chart: stock value by category
- [ ] Low stock alerts panel with days-until-stockout estimates
- [ ] Line chart: receipts vs issues trend over time
- [ ] Top consumed items table
- [ ] Recent stock movements table

### 2.5 Fuel Dashboard Revamp

- [ ] KPI tiles with sparklines: litres issued today/this month, total fuel cost, average cost per litre, transaction count
- [ ] Gauge charts: tank levels (current level vs capacity per tank)
- [ ] Line chart: daily consumption trend
- [ ] Bar chart: consumption by department/vehicle
- [ ] Top consumers table: vehicle/department, litres, cost
- [ ] Alerts panel: tanks below threshold, abnormal consumption spikes
- [ ] Recent transactions table

---

## Phase 3 — Dashboard Revamps (Part 2) + Mix Designs & Concrete Production

### 3.1 Fleet Dashboard Revamp

- [ ] KPI tiles: total vehicles, active count, in-maintenance count, idle count
- [ ] Donut chart: vehicle status breakdown (active/maintenance/idle/decommissioned)
- [ ] Bar chart: maintenance cost by vehicle (top 10)
- [ ] Gauge: fleet utilization rate
- [ ] Upcoming maintenance table with overdue flags
- [ ] Line chart: cost per vehicle trend
- [ ] Recent maintenance records table

### 3.2 HR Dashboard Revamp

- [ ] KPI tiles: total headcount, new hires this month, terminations this month, employees on leave today
- [ ] Donut chart: headcount by department
- [ ] Bar chart: monthly hires vs terminations trend
- [ ] Gauge: turnover rate
- [ ] Leave overview: who's on leave today/this week
- [ ] Upcoming events: birthdays, contract renewals, probation endings
- [ ] Department breakdown table: department, headcount, vacancies, budget

### 3.3 Contractors Dashboard Revamp

- [ ] KPI tiles: active contracts count, total contract value, spend this month, casual workers today
- [ ] Bar chart: spend by contractor
- [ ] Donut chart: contract type breakdown
- [ ] Active contracts table with days remaining and % spent
- [ ] Timesheet summary: hours this week/month
- [ ] Expiring contracts alerts panel

### 3.4 Campsite Dashboard Revamp

- [ ] KPI tiles: total beds, occupied beds, occupancy %, meals served today
- [ ] Gauge chart: occupancy rate
- [ ] Bar chart: occupancy trend by week/month
- [ ] Room status grid: visual blocks showing occupied/vacant/maintenance per room
- [ ] Line chart: meal count trends
- [ ] Recent check-ins/check-outs table

### 3.5 Mix Designs Screen

- [ ] List view: grade, name, cement per m³, water per m³, aggregate breakdown, active status
- [ ] Add/Edit modal: grade dropdown, name, cement_kg_per_m3, water_litres_per_m3, dynamic aggregate rows (select type + quantity per row)
- [ ] Version warning: editing a mix design used in existing batches prompts to create new version
- [ ] Search and filter by grade
- [ ] Archive/restore

### 3.6 Concrete Batches Screen

- [ ] Batch creation flow: select grade → auto-selects mix design → enter quantity (m³) → system calculates theoretical materials → assign mixer truck (from fleet_assets) → assign driver → delivery location → select project → create
- [ ] Batch list: batch number, date, grade, quantity, project, truck, driver, status, variance %
- [ ] Batch detail view: all fields, material breakdown (theoretical vs actual side by side, variance highlighted red/green), dispatch/return times, turnaround time
- [ ] Record actuals: operator enters actual cement, water, and aggregate per type — system computes variance
- [ ] Status workflow: Mixing → Dispatched (records dispatch_time) → Delivered (records return_time) → Cancelled
- [ ] Filter by date range, grade, project, truck, status
- [ ] Export to CSV

---

## Phase 4 — Cement & Aggregate Inventory + Quality Control + Project Costing

### 4.1 Cement Inventory Screen

- [ ] **Deliveries tab**: log deliveries (supplier, delivery note, truck registration, quantity kg, unit cost, total cost, silo number, date). List with search/filter/export
- [ ] **Stock view**: Opening stock + deliveries − consumed (from batches) = **remaining stock** (prominently displayed)
- [ ] Silo breakdown: stock per silo (if multiple)
- [ ] Line chart: daily/weekly cement consumption trend
- [ ] **Reorder alert panel**: current stock, average daily consumption, days of stock remaining, supplier lead time, color-coded urgency (green >10 days, orange 5–10 days, red <5 days), suggested order quantity
- [ ] "ORDER NOW" warning when stock will run out within lead time

### 4.2 Aggregate Inventory Screen

Same structure as cement, repeated per aggregate type:

- [ ] **Deliveries tab**: log per type (10mm, 20mm, 40mm, crusher dust, river sand), supplier, quantity, cost, stockpile location
- [ ] **Stock view per type**: opening + deliveries − consumed = remaining
- [ ] Reorder alerts per aggregate type (same logic as cement)
- [ ] Consumption trend chart per type

### 4.3 Cube Tests Screen

- [ ] Log cube test: select batch, sample number, 7-day test date + result (MPa), 28-day test date + result (MPa), target strength (auto-filled from grade)
- [ ] Auto pass/fail: 28-day result ≥ target → Pass, else → Fail. Warning if 7-day result is abnormally low (<60% of target)
- [ ] Batch quality badge: Passed / Failed / Pending (awaiting 28-day)
- [ ] Test results list: batch number, grade, 7-day, 28-day, target, status, tested by
- [ ] Filter by status (pending/pass/fail), date range, grade
- [ ] Failed batches highlighted in red

### 4.4 Project Costing Report

- [ ] Project selector dropdown
- [ ] Summary: total m³ delivered, total batches, date range
- [ ] Material cost breakdown: cement cost (kg consumed × weighted average cost/kg), aggregate cost per type (same logic), total material cost
- [ ] Cost per m³: total material cost ÷ total m³
- [ ] Revenue and margin: if project has contract value — revenue, gross margin, margin %
- [ ] Comparison table: all projects side by side (name, m³, material cost, cost/m³, revenue, margin)
- [ ] Export to CSV

### 4.5 Batch Plant Settings Screen

- [ ] Cement: minimum stock level (kg), supplier lead time (days), safety factor multiplier
- [ ] Per aggregate type: minimum stock level, lead time, safety factor
- [ ] Batch number config: prefix (BTH), year format, sequence start
- [ ] Default silo/stockpile assignments
- [ ] Save to `batch_plant_settings` table

---

## Phase 5 — Departments Portal + Concrete Dashboard + Fleet Integration

### 5.1 Department Portal

Dynamic, context-aware department home page:

- [ ] Header shows "**{Department Name} Department**" based on logged-in user's department
- [ ] **My Team**: staff list filtered by department — name, designation, contact, status
- [ ] **Department Assets**: fleet vehicles and equipment assigned to this department (from `fleet_assets`)
- [ ] **Department Requests**: procurement requests and maintenance requests raised by department members
- [ ] **Department Budget**: cost centre spend vs budget for this department (from Finance/Cost Centres), variance display
- [ ] **Department Tasks**: tasks assigned to department members (from Projects module)
- [ ] **Department Contractors**: contractors and casuals working under this department
- [ ] Department selector dropdown for managers/admins overseeing multiple departments
- [ ] Works for all departments: Electrical, Mechanical, Transport, Admin, Kitchen, Mining, Processing, etc.

### 5.2 Concrete Operations Dashboard

Interactive dashboard (same design standard as Finance Dashboard):

- [ ] KPI tiles with sparklines: concrete produced today (m³), produced this month, batches today, active mixer trucks
- [ ] Gauge charts: cement stock level (days remaining), fleet utilization rate
- [ ] Bar chart: daily production volume (last 30 days) with hover (m³ + batch count)
- [ ] Donut chart: production by grade (C20/C25/C30/C40) with hover (m³ + %)
- [ ] Line chart: cost per m³ trend over time with hover
- [ ] **Reorder alerts panel**: cement and each aggregate — days remaining, color-coded, "Order Now" suggestions
- [ ] Stock levels summary: cement + each aggregate remaining with mini progress bars
- [ ] Recent batches table: batch number, date, grade, m³, project, truck, status
- [ ] Quality alerts: pending cube tests, failed tests
- [ ] Today's dispatch log: truck, driver, batch, dispatched at, returned at, turnaround time

### 5.3 Fleet Integration for Mixer Trucks

- [ ] Tag mixer trucks in `fleet_assets` (asset_type or dedicated flag)
- [ ] Dispatch log: each concrete batch dispatch visible in both Concrete and Fleet modules
- [ ] Turnaround analysis: average turnaround time per truck, per driver, per project — bar chart with hover
- [ ] Truck utilization: batches per truck per day/week/month, idle time, productive hours
- [ ] Driver performance: m³ delivered per driver, trips per day, average turnaround
- [ ] Maintenance warning: if truck is due for service, warn when assigning to a batch

### 5.4 Finance Integration

- [ ] Cement/aggregate deliveries optionally link to procurement PO or auto-create journal entry (DR Raw Materials, CR Accounts Payable)
- [ ] Concrete production consumption posts to Concrete cost centre (DR Cost of Production, CR Raw Materials)
- [ ] Cost per m³ data feeds into Finance → Cost Centre Report
- [ ] Project costing data available from Finance filtered by project

---

## Phase 6 — Projects Module (SharePoint / Planner Style)

### 6.1 Project Board (Kanban — like Microsoft Planner)

- [ ] Board view: columns are buckets (To Do, In Progress, Review, Done) — drag and drop tasks between columns
- [ ] Task cards show: title, assignee avatar, due date, priority label (Urgent/High/Medium/Low with color), checklist progress (e.g. "3/5"), attachment icon, comment count
- [ ] Customizable buckets per project: add, rename, reorder, delete
- [ ] Filter tasks by: assignee, priority, due date, label, bucket
- [ ] Group by: bucket (default), assignee, priority, due date

### 6.2 Task Detail

- [ ] Title and description (rich text)
- [ ] Assignee: single or multiple from site users
- [ ] Due date with overdue highlighting
- [ ] Priority: Urgent (red), High (orange), Medium (yellow), Low (green)
- [ ] Labels/tags: custom per project, color-coded
- [ ] Checklist: add sub-items with checkboxes, progress bar
- [ ] Attachments: upload files (Supabase Storage)
- [ ] Comments/activity feed: threaded comments + auto-logged activity (status changes, assignment changes, due date changes)
- [ ] Status: Not Started → In Progress → Review → Completed
- [ ] Start date + due date for timeline view

### 6.3 Project List / Hub (like SharePoint)

- [ ] All projects: name, description, owner, team members, progress %, status, start/end dates
- [ ] Project detail page with tabs: Overview, Board (Kanban), Timeline, Files, Settings
- [ ] Progress: auto-calculated from completed tasks / total tasks

### 6.4 Timeline / Gantt View

- [ ] Horizontal timeline: tasks as bars (start → due date)
- [ ] Color-coded by priority or assignee
- [ ] Task dependencies as connecting lines (optional)
- [ ] Zoom levels: day / week / month
- [ ] Hover shows task details

### 6.5 My Tasks View (like Planner "My Tasks")

- [ ] Cross-project view of all tasks assigned to the logged-in user
- [ ] Group by: project, due date, priority, or status
- [ ] Quick status toggle without opening the full task

### 6.6 Team View

- [ ] Workload per team member across all projects
- [ ] Cards grouped by person: assigned tasks, due dates, status
- [ ] Identify overloaded or idle team members

### 6.7 Files (like SharePoint Document Library)

- [ ] Per-project file storage via Supabase Storage
- [ ] Upload/download, folder structure
- [ ] File preview for images and PDFs
- [ ] Version history (optional)

### 6.8 Projects — Database Migration

| Table | Purpose |
|-------|---------|
| `projects` | Project registry — name, description, owner, status, dates |
| `project_members` | Team membership — user, role (owner/member/viewer) |
| `project_buckets` | Kanban columns per project — name, sort order |
| `project_tasks` | Tasks — title, description, assignee, priority, status, dates, bucket |
| `task_labels` | Custom labels per project — name, color |
| `task_label_assignments` | Many-to-many: tasks ↔ labels |
| `task_checklist_items` | Sub-items within a task — title, completed flag, sort order |
| `task_comments` | Threaded comments on tasks |
| `task_activity_log` | Auto-logged task changes — field, old value, new value |
| `task_attachments` | File uploads linked to tasks (Supabase Storage) |
| `task_dependencies` | Task relationships — predecessor/successor, dependency type |

- [ ] Create migration with all tables, FKs, indexes, RLS policies
- [ ] Seed permissions: `projects.view`, `projects.create`, `projects.edit`, `projects.delete`, `projects.approve`
- [ ] Add T-codes: PJ01–PJ08
- [ ] Add `projectsNav` and `moduleAccess.projects` to `permissions.js`
- [ ] Add lazy imports and `getProjectsPage()` to `App.jsx`

---

## Summary

| Phase | Focus | Key Deliverables |
|-------|-------|-----------------|
| **1** | Module Reorder + Concrete DB | Reordered nav/tiles, all Concrete tables + RLS + T-codes |
| **2** | HR Fix + Preferences + Dashboards (1) | Designation fix, improved preferences, Procurement/Inventory/Fuel dashboards |
| **3** | Dashboards (2) + Concrete Production | Fleet/HR/Contractors/Campsite dashboards, Mix Designs, Batches screen |
| **4** | Concrete Inventory + QC + Costing | Cement & Aggregate inventory with reorder alerts, Cube Tests, Project Costing |
| **5** | Departments + Concrete Dashboard | Department portal, Concrete dashboard, Fleet/Finance integration |
| **6** | Projects Module | Kanban board, task management, timeline/Gantt, files, SharePoint/Planner UX |
