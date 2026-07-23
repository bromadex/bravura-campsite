# Projects Module — Complete Reference

## Overview

The Projects module (module code **PJ**) manages construction, mining, and infrastructure projects across Bravura ERP sites. It provides full project lifecycle management: planning, task tracking, scheduling (Gantt + CPM), cost management (EVM), document control, transmittals, area code management, and change orders.

**Permission codes:** `projects.view`, `projects.create`, `projects.edit`, `projects.delete`, `projects.approve`

**T-codes:** PJ01–PJ10 (accessible via ⌘K command palette)

---

## Navigation Structure

The module has **10 standalone pages**, connected by a top QuickNav pill bar:

| T-code | Page ID | Label | File | Lines |
|--------|---------|-------|------|-------|
| PJ01 | `pj_dashboard` | Dashboard | `PJDashboard.jsx` | 190 |
| PJ02 | `pj_projects` | Projects | `PJList.jsx` | 523 |
| PJ03 | `pj_detail_{id}` | Project Detail | `PJDetail.jsx` | 2,888 |
| PJ04 | `pj_tasks` | My Tasks | `PJTasks.jsx` | 268 |
| PJ05 | `pj_timeline` | Timeline | `PJTimeline.jsx` | 221 |
| PJ06 | `pj_areas` | Area Codes | `PJAreas.jsx` | 609 |
| PJ07 | `pj_documents` | Documents | `PJDocuments.jsx` | 861 |
| PJ08 | `pj_transmittals` | Transmittals | `PJTransmittals.jsx` | 492 |
| PJ09 | `pj_costs` | Costs & EVM | `PJCosts.jsx` | 155 |
| PJ10 | `pj_changes` | Change Orders | `PJChanges.jsx` | 163 |

**Routing:** All pages use `setPage(pageId)` for navigation. Project detail uses `setPage('pj_detail_' + projectId)`. Employee links navigate to `setPage('wf_employee_detail', employeeId)`.

---

## 1. Dashboard (`PJDashboard.jsx`)

**Purpose:** Portfolio-level overview of all projects at the current site.

**Data fetched:**
- `projects` — filtered by `site_id`, `is_archived = false`
- `project_phases` — for progress calculation (weighted by `weight` column)
- `project_members` — for member counts

**KPIs displayed (6 cards):**
- Total Projects, Active, Planning, Completed, Overdue, Total Budget

**Sections:**
- **Status Breakdown** — donut chart showing project distribution by status (planning/active/on_hold/completed/cancelled)
- **Top Projects by Budget** — horizontal progress bars for top 5 by budget
- **Recent Projects** — list of last 8 projects with phase-based progress %, member count, budget

**Realtime:** Subscribes to `projects` table changes via `useRealtimeSubscription`.

---

## 2. Project List (`PJList.jsx`)

**Purpose:** Create, edit, archive, and browse all projects.

**Views:** Cards (default) or List (table) — toggled via icon button.

**Filters:** Search (name, code, client, location), Status dropdown, Type dropdown.

**Project fields:**
- `name` (required), `description`, `project_type` (construction/mining/maintenance/infrastructure/exploration/other)
- `status` (planning/active/on_hold/completed/cancelled)
- `priority` (low/medium/high/critical)
- `start_date`, `target_end_date`, `budget`, `client`, `location`
- `cover_color` — 10 color swatches for visual identity
- `notes`

**Auto-generated:** `project_code` — format `PJ-001`, `PJ-002`, etc. (sequential per site).

**Card view shows:** Color stripe, code, status badge, priority badge, name, client, progress bar (phase-based), budget, member count, overdue indicator.

**List view shows:** Table with Code, Name, Type, Status, Priority, Budget, Progress bar, Open button.

**Actions:**
- **New Project** — opens modal (requires `projects.create`)
- **Edit** — click card/row opens same modal pre-filled (requires `projects.edit`)
- **Archive** — soft-delete: sets `is_archived = true`, `archived_at = now()` (requires `projects.delete`)
- **Open Workspace** — navigates to `pj_detail_{id}`

---

## 3. Project Detail (`PJDetail.jsx`) — The Main Workspace

**Purpose:** The central hub for managing a single project. This is the largest file (2,888 lines) and contains 9 tabs.

**Data fetched on mount:**
- `projects` row by ID
- `profiles` (auth users) for name resolution
- `employees` at current site for assignee dropdown and name resolution
- `project_areas` + `area_codes` for area association

**Per-tab data (lazy-loaded):**
- Board/Overview: `project_board_columns`, `project_tasks`, `project_task_labels`, `project_task_checklist`
- Phases: `project_phases`
- Team: `project_members` + `profiles`
- Labels: `project_labels`
- Schedule: `project_baselines`, `project_baseline_snapshots`, `project_progress_data`
- Costs: `project_cost_items`, `project_change_orders`
- Activity: `project_activities`

### Tab: Overview

**KPIs (6 cards):** Total Tasks, Completed, In Progress, Overdue, Average Progress, Days Elapsed.

**Per-assignee breakdown:** Groups tasks by `assigned_to`, shows each person's task count, completed count, and average progress with a progress bar. Employee names are clickable → HR detail.

**Data dependency:** Reuses `boardTasks` from the Board tab's fetch.

### Tab: Areas

Shows project_areas linked to this project. Each area card shows:
- Area code, name, discipline badge, color indicator
- Task count and completion status

### Tab: Phases

**Purpose:** Define and manage project phases (sequential stages).

**Phase fields:** `name`, `description`, `status` (pending/in_progress/completed/skipped), `start_date`, `end_date`, `weight` (for progress weighting), `color`.

**Column used:** `sequence` (NOT `position` — important distinction).

**CRUD:** Add phase, edit inline, reorder (drag not implemented — uses sequence numbers), archive (soft delete).

### Tab: Team

**Purpose:** Manage project members and their roles.

**Member roles:** owner, manager, engineer, supervisor, foreman, operator, labourer, viewer.

**Fields:** `user_id` (FK to auth.users), `role`, `is_active`.

**Display:** Grid of member cards with avatar, name, role badge. Add member via dropdown.

### Tab: Labels

**Purpose:** Create colored labels for task categorization.

**Fields:** `name`, `color` (hex picker).

**Usage:** Labels are assigned to tasks via `project_task_labels` junction table.

### Tab: Board

**Purpose:** Kanban-style task management + spreadsheet table view.

**Views:** Table (default) or Board — toggled via button.

**Board columns:** Auto-created on first visit: "To Do", "In Progress", "Review", "Done" (with `is_done_column` flag).

**Task fields:**
| Field | Description |
|-------|-------------|
| `title` | Task name (required) |
| `description` | Rich text description |
| `column_id` | FK to board column (determines status) |
| `phase_id` | Optional FK to project phase |
| `area_id` | Optional FK to area_codes |
| `parent_task_id` | Optional FK for subtask hierarchy |
| `assigned_to` | UUID — can be auth user ID or employee ID (no FK constraint) |
| `priority` | low/medium/high/critical |
| `start_date` | Planned start |
| `due_date` | Planned end |
| `actual_start` | Actual start date |
| `actual_end` | Actual end date |
| `planned_duration` | Duration in days |
| `duration_days` | Calculated duration |
| `percent_complete` | 0–100 integer |
| `estimated_hours` | Estimated effort |
| `actual_hours` | Actual effort |
| `wbs_code` | Work Breakdown Structure code (auto-generated) |
| `is_milestone` | Boolean flag |
| `position` | Sort order within column |
| `completed_date` | Set when moved to done column |

**Table view columns:** #, Task, Status, Duration, Start, Finish, Actual Start, Actual Finish, % Complete (with progress bar), Responsible Person (clickable → HR detail).

**Footer row:** Totals for completed, in-progress, overdue counts, and average progress.

**Task modal (full editor):** Opens on task click. Contains:
- All fields above as form inputs
- Assignee dropdown: "Employees" optgroup (from HR) + "Project Members" optgroup
- Checklist: add items, toggle done, delete
- Labels: multi-select from project labels
- Dependencies: add predecessor/successor relationships via `project_task_dependencies`
- Schedule section: start/end dates, actual dates, duration, % complete, milestone toggle
- Archive button (soft-delete, requires `projects.delete`)

**Board view:** Kanban columns with drag support (manual — not react-dnd). Cards show title, due date, priority dot, assignee avatar chip (clickable → HR detail), label badges, checklist progress.

**Filters:** Label, Assignee (shows employees with tasks), Priority.

**Board CRUD:**
- Quick add: text input at bottom of each column
- Rename column: click column header
- Add column: "+ Column" button
- Delete column: only if empty
- Move tasks between columns: click task → change column in modal

**Export:** MS Project XML (valid `.xml` with tasks, resources, assignments), CSV.

### Tab: Schedule

**Purpose:** Interactive Gantt chart, Critical Path Method analysis, baselines, and progress tracking.

**Gantt Chart:**
- Renders all tasks with `start_date` or `end_date` as horizontal bars
- Color coding: green (complete), blue (in progress), orange (overdue), red (critical path), theme color (on track)
- Progress fill: inner bar shows `percent_complete` visually
- Today marker: red vertical line
- Month and week headers
- **Hover:** Bars scale up (1.3x vertical), show shadow, display rich tooltip with: title, start/end dates, duration, progress %, assignee, status, critical path flag
- **Click bar:** Opens quick progress update modal (slider 0–100%, preset buttons 0/25/50/75/100%, actual start/finish date inputs, progress bar preview, Full Edit link, Save button)
- **Double-click bar:** Opens full task edit modal
- **Auto-status:** Setting 100% auto-moves task to Done column; setting >0% auto-moves to In Progress column

**Delayed Tasks section:** Table showing overdue tasks with:
- Task name, planned end date, days-late badge, progress bar, assignee, Update button

**Quick Progress Tracker:** Scrollable list of all incomplete tasks. Click any task → opens quick progress modal. Shows due date, assignee, overdue flag.

**CPM (Critical Path Method):**
- "Run CPM" button calculates: Early Start (ES), Early Finish (EF), Late Start (LS), Late Finish (LF), Total Float for each task
- Results table: Task, WBS, ES, EF, LS, LF, Float, Critical (YES badge for zero-float tasks)
- KPIs: Project Duration, Critical Tasks count, Total Tasks

**Baselines:**
- "Save Baseline" button snapshots all task dates and progress to `project_baselines` + `project_baseline_snapshots`
- Click baseline → shows snapshot table with: Task, Planned Start, Planned End, Duration, % Complete
- Drift indicators: shows "+Xd late" or "Xd early" comparing baseline to current dates

### Tab: Costs & EVM

**Sub-tabs:** EVM Dashboard, Cost Breakdown, Change Orders.

**EVM Dashboard:**
- "Recalculate" button computes Earned Value metrics from tasks
- KPIs: BAC (Budget at Completion), BCWS/PV (Planned Value), BCWP/EV (Earned Value), ACWP/AC (Actual Cost)
- Performance Indices: SPI, CPI, TCPI — color-coded green (good) / red (bad) with descriptions
- Variances & Forecasts: SV, CV, EAC, ETC, VAC, Planned %, Actual %
- S-Curve chart: SVG line chart plotting PV, EV, AC over time with BAC reference line
- Progress bars: Planned vs Actual progress

**Cost Breakdown:**
- CRUD for `project_cost_items` with: CBS code, description, category, cost_type, budgeted/committed/actual/ETC/EAC
- Totals row

**Change Orders:**
- CRUD for `project_change_orders`: CO number (auto: CO-001), title, description, status (draft/submitted/under_review/approved/rejected/implemented), impact_type (cost/schedule/scope/cost_and_schedule), cost_impact, schedule_impact_days, notes
- Approval workflow: status transitions

### Tab: Activity

- Displays `project_activities` log
- Add comments/notes with author and timestamp

---

## 4. All Tasks (`PJTasks.jsx`)

**Purpose:** Cross-project task view for administrators and managers.

**Data fetched:**
- All `projects` at site (non-archived)
- All `project_tasks` (non-archived), filtered client-side to only tasks belonging to site projects
- `project_board_columns` for status resolution
- `employees` for name display

**Toggle:** All Tasks / My Tasks (filters by `assigned_to === profile.id`)

**Filters:** Project, Status (done/in_progress/not_started/overdue), Assignee, Priority

**Sort options:** Due Date, Priority, % Complete, Position

**KPIs (5 cards):** Total Tasks, Completed, In Progress, Overdue, Avg Progress

**Table columns:** #, Project code, Task Description, Status (column name badge), Duration, Start, Finish, % Complete (progress bar), Assigned To (clickable → HR detail), Priority badge

**Click row:** Navigates to `pj_detail_{project_id}` (opens the project, not the specific task).

**Export:** CSV download.

---

## 5. Timeline (`PJTimeline.jsx`)

**Purpose:** Cross-project Gantt/timeline view showing phases and tasks across all projects.

**Data fetched:**
- `projects` at site (non-archived) — id, name, project_code, start_date, target_end_date
- `project_phases` for all projects
- `project_tasks` (non-archived) — id, project_id, phase_id, title, start_date, due_date, priority, completed_date

**Filter:** Project dropdown (single select, defaults to "All Projects")

**Rendering (SVG):**
- **Rows:** Phase rows (bold, with progress %) then task rows (indented) under each phase. Unphased tasks appear at the bottom.
- **Bars:** Phase bars use phase color, task bars use priority color. Completed tasks are grayed out.
- **Phase progress overlay:** Shows completion percentage as filled portion of bar.
- **Month markers:** Dashed vertical lines with month labels
- **Today line:** Red dashed vertical line

**Click behavior:** Any row click → `setPage('pj_detail_' + projectId)` (navigates to the parent project, NOT to the specific task or phase).

**Layout:** Fixed label column (220px) + scrollable chart area (800px).

---

## 6. Area Codes (`PJAreas.jsx`)

**Purpose:** Manage and monitor work by area code (physical location/zone).

**Data fetched:**
- `area_codes` — global table (no site_id), with id, code, name, discipline, color, description, is_active
- `project_areas` — links area_codes to projects (with project_id FK)
- `project_tasks` — all non-archived tasks for projects at this site
- `projects` — for name lookup

### List View

Shows area code cards in a grid. Each card displays:
- Color indicator dot, code, name
- Discipline badge
- Task count, completion count, progress bar
- Chevron → detail view

**Filters:** Discipline dropdown, search (code or name)

### Detail View (inline, not a separate route)

Entered by clicking an area code card. Back button returns to list.

**Header:** Area code + name, discipline badge, progress ring (SVG donut gauge).

**4 Tabs:**

#### Overview Tab
- **6 KPIs:** Total Tasks, Completed, In Progress, Overdue, Avg Progress, Total Duration
- **Description** text
- **Completion Progress:** Stacked bar showing done/in-progress/not-started breakdown with counts
- **Timeline:** Visual task bars with: status icon (check/pending/warning), task name, progress bar, date range. Color-coded by status.

#### Tasks Tab
- Spreadsheet-style table matching PJDetail Board format: #, Task, Status, Duration, Start, Finish, % Complete (progress bar), Assigned (clickable → HR detail)

#### Documents Tab
- Table of `project_documents` linked to this area code's project
- Columns: Doc Number, Title, Type, Status, Revision

#### Photos Tab
- **Upload:** File input (accept images), caption field, Upload button
- **Storage:** Files uploaded to `project-files` Supabase storage bucket under `area-photos/{areaId}/` path
- **Display:** Grid of photo cards with file name, caption, size, date
- **View:** Generates signed URL (60 min), opens in new tab
- **Archive:** Soft-delete (sets `is_archived = true`) on `area_code_photos` table

**Task matching logic:** Tasks belong to an area code if:
1. `task.area_id === areaCode.id` (direct FK), OR
2. Task title contains the area code number pattern (e.g., title includes "area code 12" for AC-12)

---

## 7. Document Register (`PJDocuments.jsx`)

**Purpose:** Central document control register across all projects.

**Document types:** Drawing, Specification, Method Statement, Report, Correspondence, Permit, Other

**Document statuses:** Draft, Issued for Review, Issued for Construction, Approved, Superseded

**Fields:** document_number (auto-generated), title, type, status, revision, project_id, area_code_id, description, file upload

**Features:**
- CRUD with modal form
- File upload to Supabase storage
- Revision tracking
- Filter by project, type, status
- Search by number, title
- CSV export
- Table view with: Doc Number, Title, Project, Type, Status badge, Revision, Area Code, Date

---

## 8. Transmittals (`PJTransmittals.jsx`)

**Purpose:** Formal document transmittal tracking (sending documents between parties).

**Fields:** transmittal_number (auto-generated), subject, from_party, to_party, project_id, status (draft/issued/acknowledged/closed), purpose (for_approval/for_information/for_review/for_construction/as_requested), notes, issued_date

**Transmittal items:** Links to documents from the document register, each with a purpose and remarks.

**Features:**
- CRUD with modal form
- Add/remove documents to transmittal
- Status workflow: Draft → Issued → Acknowledged → Closed
- Filter by project, status
- Table view: Transmittal #, Subject, Project, From, To, Status, Items count, Date
- CSV export

---

## 9. Costs & EVM Overview (`PJCosts.jsx`)

**Purpose:** Cross-project cost rollup view.

**Data fetched:**
- `projects` at site
- `project_cost_items` — joined to projects via `!inner` to filter by site

**Filters:** Project, Category

**KPIs (5 cards):** Budgeted, Committed, Actual, ETC, EAC

**Table:** Project, CBS Code, Description, Category, Type, Budgeted, Committed, Actual, ETC, EAC — with totals row.

**Over-budget highlighting:** EAC column turns red when EAC > Budgeted.

**Export:** CSV

---

## 10. Change Orders (`PJChanges.jsx`)

**Purpose:** Cross-project change order register.

**Data fetched:**
- `projects` at site
- `project_change_orders` — joined with project and requester profile

**Filters:** Project, Status

**Statuses:** draft, submitted, under_review, approved, rejected, implemented

**KPIs (5 cards):** Total COs, Pending, Approved, Cost Impact (sum of approved), Schedule Impact (sum of approved days)

**Table:** Project, CO #, Title, Status badge, Impact type, Cost Impact (red if positive, green if negative), Schedule days, Requested By, Date

**Export:** CSV

---

## Database Tables

| Table | Site-scoped? | Soft-delete? | Notes |
|-------|-------------|--------------|-------|
| `projects` | Yes (`site_id`) | Yes (`is_archived`, `archived_at`) | Main project record |
| `project_phases` | Via project FK | Yes | Uses `sequence` not `position` |
| `project_members` | Via project FK | No (`is_active` flag) | Links users to projects with roles |
| `project_board_columns` | Via project FK | No | Auto-created: To Do, In Progress, Review, Done |
| `project_tasks` | Via project FK | Yes (`is_archived`) | Uses `position` for ordering |
| `project_task_labels` | Via task FK | No | Junction table: task ↔ label |
| `project_task_checklist` | Via task FK | No | Ordered by `position` |
| `project_task_dependencies` | Via task FK | No | `task_id` + `depends_on_id` |
| `project_labels` | Via project FK | No | Name + color |
| `project_baselines` | Via project FK | No | Named schedule snapshots |
| `project_baseline_snapshots` | Via baseline FK | No | Per-task date/progress snapshot |
| `project_progress_data` | Via project FK | No | Time-series BCWS/BCWP/ACWP |
| `project_cost_items` | Via project FK | Yes (`is_archived`) | CBS-coded cost line items |
| `project_change_orders` | Via project FK | Yes (`is_archived`) | Scope/cost/schedule changes |
| `project_documents` | Via project FK | Yes | Document register records |
| `project_transmittals` | Via project FK | No | Transmittal headers |
| `project_transmittal_items` | Via transmittal FK | No | Documents in a transmittal |
| `project_activities` | Via project FK | No | Activity/comment log |
| `project_areas` | Via project FK | No | Links projects ↔ area_codes |
| `area_codes` | **Global** (no site_id) | No (`is_active` flag) | AC-01 through AC-54 |
| `area_code_photos` | Via area_code FK | Yes (`is_archived`) | Photos per area code |

**Storage bucket:** `project-files` (private) — stores area photos under `area-photos/{areaId}/`

---

## Assignee Resolution

The `assigned_to` field on `project_tasks` is a bare UUID with **no FK constraint**. It can store:
1. **Auth user ID** — resolved via `profiles` table
2. **Employee ID** — resolved via `employees` table

Resolution order in `userName(userId)`:
1. Check `siteUsers` (profiles) → return `full_name` or `username`
2. Check `siteEmployees` (employees) → return `name`
3. Fallback: "Unknown"

Employee assignees are clickable and navigate to `setPage('wf_employee_detail', employeeId)` for the HR detail view.

---

## Export Capabilities

| Format | From | Content |
|--------|------|---------|
| **MS Project XML** | PJDetail Board tab | Tasks with UIDs, resources, assignments — valid `.xml` importable by MS Project |
| **CSV** | PJDetail Board tab, PJTasks, PJDocuments, PJTransmittals, PJCosts, PJChanges | Tabular data export |

---

## Known Navigation Issue

Both PJTasks and PJTimeline navigate to the **project detail page** when a row/bar is clicked — they do NOT navigate to the specific task. The user has flagged this as a desired improvement: clicking a task should show task-level detail, and clicking a timeline bar should show that specific task's information.
