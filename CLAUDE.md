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
- Migration numbering: general range continues from 0169 (0168 reserved for
  governance/connect/notifications; 0170–0172 reserved for DocShare);
  **0100–0149 reserved for HR (Tafara)**.
- Keep architecture AI-ready: server-side RPCs/views, trigger-written audit events.
- Build check before commit: `cd bravura-meals && npx vite build`.

## Critical schema facts (learned the hard way)

- `permissions` table: `code`, `module`, `action` all NOT NULL,
  `action` CHECK-constrained to `('View','Create','Edit','Delete','Approve')`,
  and `UNIQUE (module, action)` — **max 5 permissions per module**.
  HR uses: hr.view / hr.create / hr.edit / hr.terminate (Delete) / hr.approve.
  Finance uses finance.view/create/edit/delete/approve (renamed from FI01–FI05 in 0205 — FIxx are T-codes, never permissions).
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

**Operating model (from user, Sept 2026):** Harare HQ houses Accounting and Procurement. They buy and
pay centrally, and every purchase or payment names the site it's for (site_id = the destination site,
entered by HQ staff). Petty cash is the only money run on site, and it is funded by Accounting (HQ).
Procurement will be restyled using the finance theme and components (FinShell, financeTheme).

## Module map

meals (ME), fuel (FU), fleet (FL), campsite (CA), workforce/HR (HR),
admin (AD), procurement (PR), feedback (FB), contractors/CL (CL),
docshare (DS).
HR pages: `src/pages/hr/` (+ `hr/leave/`). Legacy workforce pages still in
`src/pages/workforce/`. Contractor pages: `src/pages/contractors/`.

## SHEQ Module Roadmap

Phase 1 (Foundation & Core Safety — 0160): Dashboard, Incidents, Incident Detail,
Hazard/Near-Miss Reporting, CAPA Register, Safety Observations, SHEQ Reports, Settings.
Phase 2 (Risk & Permits — 0161): Risk Register, Risk Assessments, PTW, PTW Board,
LOTO Isolation Register, Risk Matrix Config.
Phase 3 (Inspections & Audits — 0162): Inspections, Inspection Templates, Audit
Programme, Audit Findings, SHEQ Calendar.
Phase 4 (Training, Competency & Medical — 0163): Training & Competency Matrix,
Medical Fitness Register, Toolbox Talks, Employee SHEQ Profile, Induction Register.
Phase 5 (Environment & PPE — 0164): Environmental Register, Waste Management,
Spill Management, Environmental Monitoring, PPE Register & Issues, Resource Consumption.
Phase 6 (Compliance, Documents & Contractors — 0165): Legal Register, Document Control,
Contractor SHEQ Compliance, Emergency Plans, Emergency Drills, Management Review, Analytics.
Phase 7 (Cross-Module Integration): Fleet→SHEQ incidents, HR→SHEQ profiles,
Contractors→compliance scores, Projects→risk registers, Finance→incident costs.

## Governance, Connect & Notifications Roadmap

Phase 1 (Notifications Foundation — 0168a): notifications table, notification_templates
table, notificationEngine.js utility (pushNotification, pushNotificationToGroup,
pushNotificationToPermission, pushNotificationFromTemplate), NotificationBell component
in ModuleLayout header with unread count + dropdown, Notification Center page (NT01)
with category tabs (All/Approvals/Reminders/Announcements/Escalations/Chat/General),
date grouping, read/unread filter, mark-all-read, realtime subscription, pagination.
Permissions: notifications.view/create/edit/delete/approve.

Phase 2 (Governance — 0168b): governance_documents table (doc_type: announcement/policy),
governance_responses, governance_versions, announcement_reads tables.
Announcements page (GV01): publish with priority (normal/important/urgent), expiry,
pinning, target recipients, read receipts dashboard, archive/restore. Fires notifications
via engine on publish.
Policies & Compliance page (GV02): versioned policies with category filter, mandatory
acknowledgement with deadlines, accept/reject flow, compliance dashboard with KPI
row + employee status table + CSV export. Draft→published workflow with governance.approve.
Permissions: governance.view/create/edit/delete/approve.

Phase 3 (Connect Foundation — 0168c): chat_conversations, chat_participants,
chat_messages, message_reactions, message_reads tables.
Connect page (CN01): two-panel layout (conversation list + message thread), DMs,
groups, department auto-groups (linked to employee records — auto-join on department
assignment), record-linked threads (attach conversation to any module record like
a fleet asset, SHEQ incident, PO). @mention picker (searches site users), /slash
T-code picker (searches txnCodes.js, inserts clickable reference chips), emoji
reactions (toggle 👍❤️😂😮👏🔥), reply/quote, edit/delete own messages (soft delete),
file attachments (supabase storage), pinned messages, message search within
conversation. Realtime subscription on chat_messages INSERT. Unread badges via
last_read_at tracking. Mobile responsive (single-panel toggle below 768px).
Permissions: connect.view/create/edit/delete/approve.

Phase 4 (Cross-Module Wiring): Wire notificationEngine into existing modules —
leave requests → notify approver, fuel approvals → notify requester, SHEQ incidents
→ notify safety officer, fleet maintenance due → notify fleet manager, inventory
low-stock → notify storekeeper, policy acknowledgement deadlines → remind users,
contractor document expiry → notify procurement. Add record-thread "Discuss" button
to key detail pages (incident detail, maintenance detail, PO detail).

Phase 5 (Enhancements): Notification preferences per user (mute categories, stored
in app_users metadata). Action buttons on notification cards (Approve/Reject inline
for leave, fuel, POs). Email digest opt-in (daily summary). Connect: group settings
(rename, add/remove participants), message forwarding between conversations,
notification sound/badge on mobile PWA.

## DocShare Module Roadmap (DS — internal document management)

**Viewer-first** internal DMS for mining/camp operations. Core differentiator:
inline browser viewing of PDF, DOCX, Excel, and DWG files — **no editing,
view-only**. The viewer is a **shared component** (`components/DocumentViewer.jsx`)
reusable across the entire ERP — anywhere a document exists (fleet manuals,
SHEQ investigation reports, HR certifications, contractor insurance docs,
procurement POs, governance policies), clicking "View" opens the same inline
viewer without leaving the system. No module needs its own file preview logic.
Two document modes: **controlled** (versioned, approval workflow,
acknowledgement tracking, expiry) and **general** (upload, organize, search,
download — shared file storage).
Permissions: ds.view/create/edit/delete/approve. Migration range: 0170+.

### Phase 1 — Foundation, Storage & Document Viewer (0170)
Tables: `ds_documents` (id, site_id, title, description, category, doc_mode
['controlled','general'], folder_id, created_by, created_at, updated_at,
is_archived, file_path, file_name, file_size, file_type, tags[]),
`ds_folders` (id, site_id, name, parent_id, created_by, created_at, is_archived),
`ds_document_access` (document_id, user_id/role_id, access_level ['view','edit']).
Pages:
- **Document Library (DS01)**: grid/list view with folder tree sidebar, category
  filter, search by title/tags/content, sort by date/name/size, bulk actions.
  Upload with drag-and-drop, multi-file support. Folder create/rename/move/archive.
  Document detail drawer with metadata, download, share link (internal), move
  to folder.
- **Document Viewer (DS02)**: full-screen inline viewer, no editing. Formats:
  - **PDF**: native browser `<iframe>` / `<object>` embed with signed URL.
  - **DOCX**: render via `mammoth.js` (converts DOCX → HTML for display).
  - **Excel (XLSX/XLS)**: render via `SheetJS` (xlsx) — parse to JSON, render
    as HTML table with sheet tabs, column sorting, frozen headers. Read-only.
  - **DWG**: render via `three-dxf` or Autodesk Forge viewer embed (free tier)
    for 2D/3D CAD drawings. Fallback: convert server-side to SVG/PDF if viewer
    unavailable.
  - **Images**: native `<img>` with zoom/pan controls.
  Viewer toolbar: zoom in/out, fit-to-width, page navigation (PDF), sheet tabs
  (Excel), layer toggle (DWG), download original, print, fullscreen toggle.
  Mobile responsive — pinch-to-zoom on touch devices.
- **DocShare Settings (DS03)**: categories management, default folder structure
  per site, file size limits, allowed file types configuration.
RLS: site-scoped, ds.view for SELECT, ds.create for INSERT, ds.edit for UPDATE.
Storage bucket: `docshare-files` (private, signed URLs via RPC).
Libraries: `mammoth` (DOCX→HTML), `xlsx`/SheetJS (Excel parse), viewer for DWG
(evaluate Autodesk Forge free tier vs `three-dxf` vs LibreCAD WASM).

### Phase 2 — Controlled Documents & Versioning (0171)
Tables: `ds_versions` (id, document_id, version_number, file_path, file_name,
file_size, change_summary, status ['draft','in_review','approved','superseded'],
uploaded_by, reviewed_by, approved_by, approved_at, created_at),
`ds_review_requests` (id, version_id, reviewer_id, status, comments, responded_at),
`ds_acknowledgements` (id, version_id, user_id, acknowledged_at, required_by).
Pages:
- **Document Detail (DS04)**: full page for controlled docs — version history
  timeline, current approved version prominent with inline viewer, draft/review
  status badges, side-by-side version comparison (metadata, not content diff),
  view/download any version. Review panel: approve/reject with comments, request
  changes.
- **My Acknowledgements (DS05)**: list of documents requiring user's acknowledgement,
  pending/completed tabs, acknowledge button with timestamp, overdue highlighting.
  Clicking a document opens the viewer inline before acknowledging.
Workflow: upload new version (draft) → assign reviewers (ds.approve holders or
specific users) → reviewers approve/reject → on approval, previous version
becomes 'superseded', new version becomes 'approved' → fire notifications to
acknowledgement targets → track compliance.
Wire notificationEngine: new version published → notify relevant users,
acknowledgement deadline approaching → remind, review requested → notify reviewer.

### Phase 3 — Expiry, Compliance & Reporting (0172)
Tables: `ds_expiry_rules` (id, document_id, expiry_months, notify_days_before,
auto_archive), `ds_activity_log` (id, document_id, action, user_id, details, created_at).
Pages:
- **Compliance Dashboard (DS06)**: KPI row (total docs, expiring soon, overdue
  acknowledgements, pending reviews), document status breakdown by category,
  acknowledgement completion rates by department, expiring documents list with
  days remaining, activity timeline.
- **Document Reports (DS07)**: export document register (CSV), acknowledgement
  compliance report by user/department, version history audit trail, storage
  usage by site/category.
Triggers: auto-notify on approaching expiry (30/14/7 days), auto-archive on
expiry if configured. Cron-friendly: expiry check RPC callable from scheduled task.

### Phase 4 — Cross-Module Viewer Wiring
Wire `DocumentViewer` into every module that already has file attachments or
document references. Every "View" button across the ERP opens the same viewer:
- **Fleet**: vehicle manuals, inspection certificates, insurance docs on
  fleet asset detail page.
- **SHEQ**: investigation reports, incident photos, PTW attachments, audit
  evidence on incident/inspection detail pages.
- **HR**: employee qualifications, certifications, medical fitness docs,
  training certificates on employee profile.
- **Contractors**: contracts, insurance policies, SHEQ compliance docs on
  contractor detail page.
- **Procurement**: purchase orders, invoices, delivery notes, quotations on
  PO detail page.
- **Governance**: policy documents, announcements with attachments — viewer
  replaces current download-only flow.
- **Campsite**: room inspection reports, maintenance docs.
Uses `ds_document_links` (document_id, linked_table, linked_id) for cross-ref.
"Attach Document" button on key detail pages to link existing DocShare docs.
Connect integration: share document links in chat, preview card in message.
Governance migration: optionally migrate existing governance_documents into
DocShare as controlled documents (one-time migration script).

## Connect Hardening Roadmap (from cross-AI code review, September 2026)

Five AI systems reviewed ConnectPage.jsx. Findings consolidated into three tiers:

### Tier 1 — Quick Fixes (code-only, no migration)
1. Clear messages on conversation switch (`setMessages([])`) + selectedId ref
   guard to prevent stale/privacy flash and out-of-order fetch resolution.
2. `whiteSpace: 'pre-wrap'` on message bubbles — newlines currently collapse.
3. `e.isComposing` check on Enter keydown — prevents IME users (CJK input)
   accidentally sending mid-composition.
4. `100dvh` instead of `100vh` — fixes mobile browser address bar resize.
5. `behavior: 'auto'` instead of `'smooth'` on initial message scroll —
   smooth-scrolls through entire history on conversation open.
6. Memoize reply lookup as a Map (currently O(n²) `messages.find()` per render).
7. Staleness guard on entity search debounce (request-id to drop late responses).

### Tier 2 — Security & Schema (migration 0168d)
8. **RLS on all chat tables** — chat_conversations, chat_messages,
   chat_participants, message_reactions. Participant-based SELECT, sender-based
   INSERT, own-message UPDATE for edits/deletes, `connect.edit` for pin.
9. **Private bucket + signed URLs** for connect-files — currently public with
   unguessable URLs. Switch to private bucket, 60-second signed URLs issued
   after membership check via RPC.
10. **`UNIQUE(message_id, user_id, emoji)`** on message_reactions — prevents
    duplicate reactions from double-click race.
11. **File upload validation** — client-side size limit (10MB), MIME allowlist
    (image/*, application/pdf, text/*), UUID file paths instead of raw filenames.

### Tier 3 — Architecture (migration 0168e)
12. **Denormalize conversation list** — add `last_message_at`, `last_message_id`,
    `message_count` to chat_conversations, maintained by trigger on chat_messages.
    Eliminates the 1000-row PostgREST cliff where busy sites show "No messages yet"
    on older conversations.
13. **Server-side unread counts** — trigger-maintained `unread_count` on
    chat_participants (increment on INSERT where sender ≠ participant and
    created_at > last_read_at; zero on read). Eliminates phantom badge race.
14. **Payload-based realtime** — append from realtime payload instead of full
    refetch. Reduces per-event cost from O(conversation) to O(1).
15. **Cursor pagination for messages** — load newest 50, paginate on scroll-up.
    `order(created_at, id).limit(50).lt(cursor)` with id tiebreaker.
16. **`create_or_get_dm()` RPC** — atomic DM creation with serializable
    transaction to prevent duplicate DM conversations from race conditions.

### Backlog (future)
17. Reactions realtime subscription (currently half-realtime: your view updates,
    theirs doesn't until reload).
18. Keyboard navigation for mention/slash dropdowns (Arrow/Tab/Escape).
19. Optimistic send with reconciliation (append pending message, reconcile on
    realtime echo).
20. Presence/typing indicators (Supabase Presence or heartbeat table).
21. Mobile panel CSS transform instead of conditional render (preserves scroll
    position and draft on panel switch).
22. Server-side unread counts via RPC (alternative to trigger approach).
23. Edit audit trail (`chat_message_edits` table).
24. Enhanced soft delete (`deleted_at`, `deleted_by` columns).
25. ERP entity references as first-class data (`chat_message_entities` table).
26. URL detection and linkification in messages.

## Current state (September 2026)

- HR Phase 1 (foundation) and Phase 2 (leave, documents, medical, org chart,
  site transfers) are **built and migrated** (0100, 0102, 0103 applied).
- HR Phase 3 (attendance/shifts, training, skills matrix, HR reports) and
  Phase 4 (payroll, appraisals, disciplinary, exit) are **built** (0106-0108).
  Migrations 0106, 0107, 0108 applied.
- Employee numbers use prefix **BRA** (module_settings, per site).
- Migration 0079 (fleet RLS lockdown) is **applied and verified** (2026-07-12).
- Migrations 0080 (soft-delete columns), 0081 (beds/assignments site_id),
  0082 (dip readings soft delete), 0073 (fuel_transactions.odometer_km) applied.
- Migration 0083 (contract_contractor_management) **applied** — contractors,
  contractor_contracts, casual_workers, contractor_employees, casual_timesheets,
  hired_vehicles, hired_equipment tables. CL module Phase 1 (registry) and
  Phase 2 (timesheets, hired vehicles/equipment) **built**. Phase 3 (cost
  dashboard/reports) has placeholder pages, awaits cross-module aggregation
  RPCs. See CONTRACTOR_PROMPTS.txt for the phased plan.
- Phase 5: HR analytics/AI. See TAFARA_PROMPTS.txt.
- SHEQ Phases 1–7 **built** (0160–0167 applied). Dashboard enriched with
  cross-module views (fleet incident summary, contractor scores, cost impact).
- Governance, Connect & Notifications: Phase 3 (Connect Foundation) **built**.
  Bug fixes from cross-AI review applied (mention insertion, file upload reply_to,
  unread counting, DM path). Hardening roadmap defined — see section above.
  Phases 1-2 (Notifications, Governance) and Phases 4-5 **planned**.
- DocShare (DS): Phases 1–3 tables live (0195 applied the missing 0171/0172). DocShare is the
  single document store — SHEQ Doc Control opens the DocShare library (SHEQ category).
- Overlap merges done (0194–0199): HR+SHEQ share PPE/medical/training; fuel uses fleet_assets
  and Fleet drivers auto-become fuel operators; POs/GRNs live in Procurement and an accepted GRN
  moves stock (`proc_receive_po` RPC); department projects are rows in `projects`
  (department_id); hired plant lives in Contractors (hired_vehicles/equipment). Retired tables
  are frozen by `trg_moved_to_sheq` triggers — don't write to them.
- Connect: cursor pagination, payload realtime, keyboard pickers, typing indicators
  (broadcast) and edit history (`chat_message_edits`, 0200) done.
- Landed cost on GRNs (0201, `grn_landed_costs` + `proc_apply_landed_cost`): value-only
  `landed_cost` stock movements raise moving-average cost; ledger event `landed_cost`.
  Governance policies can link a DocShare document (`ds_document_id`).
- Finance rewrite (issue #49): Phase 1 design agreed (maroon nav + buttons, blue links/charts,
  IBM Plex, tokens in `utils/financeTheme.js`). Phase 2 Setup wizard FI20 `fi_setup` built (0202:
  `finance_setup`, mining CoA template, rule template, opening balances, go-live — `gl_auto_post`
  skips postings dated before go-live). 0203: opening balances can be MOCK (`opening_is_mock`),
  cleared by `finance_setup_clear_mock_opening` (voids JV). Kamativi has the CoA, 31 rules and
  MOCK opening balances JV-0001 as at 30 Sep 2026; went live (testing) 25 Sep 2026.
  Phase 3 Pay Suppliers FI21 `fi_pay_suppliers` (0204): RLS now ON for purchase_invoices,
  invoice_lines, goods_received_notes, grn_lines (`_ap_can`); supplier payment terms + bank details;
  auto due dates; three-way match (`match_status`, `match_diff`); payment runs (`ap_payment_runs`,
  `ap_run_create/approve/mark_paid/cancel`, KAM-PAY-YYYY-NNNN). 0206 fixed two legacy notification triggers (fuel issuance, meals) still using recipient_id/body/action_url. Phase 4 (0207): Finance Home FI12 (`fin_home` RPC, replaces FinanceDashboard) and Budgets FI22
  `fi_budgets` (also PR11) — one budget store `procurement_budgets` + `budget_months` (`monthly_split`),
  `fin_budget_vs_actual` = plan vs ledger actual vs committed POs. Phase 5 (0208): Bank & Cash FI23 `fi_bank` (replaces fi_reconciliation) — `bank_import_lines` (dedupe),
  `bank_auto_match` (journal same amount ±5d, then `bank_match_rules`), `bank_confirm_line`, `bank_unmatch_line`
  (voids created JV), `bank_save_rule`, `bank_rec_summary`. Statement lines writable only via RPCs. Phase 6 (0209): Reports FI24 `fi_reports` (replaces TB/P&L/BS/cash-flow pages; `fin_statements`, `fin_explore`)
  and Month-end FI25 `fi_month_end` (`finance_periods`, `fin_close_checklist/close/reopen`; `trg_period_lock`
  blocks journals dated in a closed month). Modernised (0210): FinShell (`components/FinShell.jsx`) scopes the finance palette onto old ui-based
  screens; hubs FI26 Ledger, FI27 Claims & Petty Cash (Quick spend), FI28 Fixed Assets; 11 duplicate pages
  deleted; supplier statement recs (`supplier_statement_recs`, `ap_supplier_position`); Finance Home
  per-user layout + saved Explorer views (`finance_home_layouts`). 0211 cross-module postings: stores
  issues/returns/count gains+losses (`trg_inv_movement_gl`; camp-type departments → 6420), approved casual
  timesheets (6510) and hired-equipment usage (6520) accrue to 2200, closed SHEQ incidents with actual_cost
  (6951). fleet_maintenance.actual_cost is deliberately NOT posted (parts via stores, workshops via bills).
  0212: `purchase_invoices.bill_type` ('goods'|'accrued'); an accrued bill posts `invoice_accrual`
  Dr 2200 / Cr 2100 instead of clearing GRNI. 0213: `bill_accrual_links` matches a bill to the exact timesheets / usage logs /
  incidents (`ap_unbilled_accruals`, `ap_set_bill_accruals`); on approval the difference posts as
  `accrual_release` / `accrual_topup` so exactly the matched accrual leaves 2200. Migrations continue at 0214.

## Improvement backlog (agreed with user, work top-down)

1. ~~Rotate leaked DB password~~ (done, user-side)
2. ~~Fleet RLS lockdown~~ (done — 0079 applied and verified 2026-07-12)
3. ~~Soft-delete sweep~~ (done — 0080 applied, 15 hard deletes → archive, beds+user_roles kept)
4. ~~PermissionsContext memoization~~ (done)
5. ~~Add `site_id` to `beds` + `room_assignments`~~ (done — 0081 applied, .in() cascades eliminated)
6. ~~Memoize CampsiteContext/FuelContext; replace getUser()~~ (done — 9 calls removed)
7. ~~Shared utils~~ (done — `utils/csv.js`, `components/Denied.jsx`, `utils/friendlyError.js`)
8. ~~Smoke tests for RPCs + billing math; CI~~ (done — vitest + 3 test suites, GitHub Actions CI)
9. ~~FuelContext pagination~~ (done — ref data fetched once, transactions date-filtered 30 days default)
10. ~~Realtime/staleness handling for flags & approvals~~ (done — #21)
11. ~~Breadcrumb shows raw T-codes~~ (done — ModuleLayout now falls back to txnCodes labels)

## Open roadmap (Sept 2026) — tracked in #49 (finance + AI) and #47 (Stage 11)

- Real opening balances for Kamativi (replace mock JV-0001 via `finance_setup_clear_mock_opening`).
- Finance setup (FI20) for Selous, Manhizi, Harare — no CoA/rules yet, so nothing posts there.
- Hired-vehicle usage log (daily/km) so vehicles accrue like hired equipment (`hired_plant_usage`).
- Expected recurring bills with a missing-bill warning.
- AI assistant A1–A6: Qwen via Groq free tier, key as edge-function secret; read-only RPCs run as the
  asking user. Blocked on the user's Groq API key.
- UI: app-wide TopBar lives in `components/ModuleLayout.jsx` (module eyebrow, split title, Ctrl K search
  firing `open-command-palette`, live clock capsule); SiteSwitcher is a pill.

## Database access

No credentials are stored in this repo. If the user provides a connection
string in chat (Session pooler, IPv4: `aws-0-eu-west-1.pooler.supabase.com:5432`),
use `psql` with PGPASSWORD env var, apply migrations directly, and verify.
Never commit credentials. The direct host `db.<ref>.supabase.co` is IPv6-only
and unreachable from cloud containers.
