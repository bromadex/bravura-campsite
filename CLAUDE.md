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
  `accrual_release` / `accrual_topup` so exactly the matched accrual leaves 2200. Migrations continue at 0239. Kamativi stores (0238): Container 1 (KAM-C1, main — the old Main Store), Container 2 (KAM-C2), Container 3 (KAM-C3).

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

- **Procurement rewrite (#50, Stage 12) — P1–P7 BUILT.** Phases are sub-issues:
  P1 look/menu/Home (#51) · P2 Requests (#52) · P3 Purchase Orders hub, RFQ = draft PO + alternatives +
  approval levels + lock/amend (#53) · P4 Receiving + supplier acknowledgement link (#54) · P5 Suppliers
  profile + hold + price list + Agreements (#55) · P6 Bills move to Finance FI21 + inter-site 2500 postings
  (#56) · P7 Reports + reorder→draft POs + PO↔fleet work order (#57). Defaults: bills in Finance; each site
  keeps its own books (HQ pays via 2500); approval tiers ≤$1k / ≤$10k / >$10k (configurable, no role names).
  **P1+P2 built (0214, 0214b, 0214c):** `components/ProcShell.jsx` (FinShell with module/homePage/siteText) +
  `useSiteScope`/`SiteScopeToggle` (this site vs all accessible sites). ProcHome (PR01, `proc_home(site_ids[])`)
  replaces ProcDashboard. ProcRequests (PR07, also IN14) replaces ProcRequisitions + InvRequisitions:
  `purchase_requisitions` gained request_type buy/transfer, title, needed_by, department_id, work_order_id,
  source_site_id, fulfilled_*; lines allow free-text services and are soft-archived. Write via
  `proc_request_save` / `proc_request_submit` / `proc_request_cancel`; `proc_stock_check(item_ids[])`;
  `proc_request_fulfil_transfer` moves stock between sites' stores (transfer_out/in). RLS via `_proc_can`
  (procurement.* or inventory.*); sending site can see transfers. Default approval route per site:
  line manager ("Department head"). Older procurement screens are wrapped in ProcShell in App.jsx.
  **P3 built (0215):** ProcOrders hub (PR04; also proc_rfqs/proc_rfq_compare/proc_tracking/inv_purchase_orders
  routes → tabs To order · Quotes · Orders · Tracking). ProcRFQ, ProcRfqCompare, InvPurchaseOrders deleted
  (rfqs table unused/empty). purchase_orders statuses rfq → rfq_sent → draft → pending_approval → sent →
  partially_received → received | cancelled; rfq_group_id (alternatives), amended_from/revision (cancel &
  amend, PO-x-1), cancel_reason, confirmed_*. po_lines: item optional (services), description, unit,
  requisition_line_id, is_archived. RPCs: proc_po_from_requests, proc_po_save, proc_rfq_add_supplier,
  proc_rfq_mark_sent, proc_po_confirm (cancels other alternatives), proc_po_cancel, proc_po_amend,
  proc_po_list (receipt/billed status), proc_lines_to_order, proc_item_price_history. Locks:
  trg_lock_po_lines + trg_po_header_lock (editable only rfq/rfq_sent/draft). trg_po_requests_sync keeps
  requisition_lines.ordered_qty + request status (ordered/approved). GRN trigger now confirms service lines.
  Default PO approval routes per site: ≤$1k (procurement.approve), ≤$10k (2× procurement.approve),
  >$10k (+finance.approve).
  **P4+P5 built (0216, 0216b, 0216c):** supplier confirmation link — public route `/ack/<token>` handled at the
  top of App.jsx (no login) → `pages/public/SupplierConfirm.jsx`; `po_ack_links`, `proc_po_ack_link`,
  anon-callable `proc_po_ack_get/submit` (sets acknowledged_at, ack_by_name, po_lines.promised_date,
  expected_date). pg_cron `procurement-reminders` 05:00 UTC → `proc_delivery_reminders()` (due in
  supplier.reminder_days, late, not confirmed after 2 days) via `_proc_notify` (procurement.edit holders).
  ProcReceiving (PR08, route proc_grn; tabs To receive + Receipts = old ProcGRN). Stores InvGrn needs a
  no-PO reason. Supplier hold (`hold_type` none/all/bills/payments, `proc_supplier_set_hold`,
  trg_supplier_hold_po / trg_supplier_hold_bill). `supplier_prices` (used first by `_po_last_price`).
  `proc_supplier_scorecard`. ProcSuppliers (PR02; replaces Suppliers.jsx; scorecards & aging tab = old
  ProcSupplierPerformance). Agreements PR13 (`proc_agreements`, `proc_agreement_lines`, po_lines.agreement_line_id,
  `proc_agreement_save/set_status/list`, `proc_po_from_agreement`).
  **P6 built (0218):** bills recorded/approved in Finance FI21 Pay Suppliers → tab "Record & approve bills"
  (embeds ProcInvoices; route proc_invoices → FI21 for finance users). HQ pays for sites: finance_setup.funded_by_site_id
  (Kamativi → Harare), `_paying_site(invoice)` (run bank account's site, else funder, else own). Paid bill of a
  funded site posts `invoice_paid_by_hq` (site Dr 2100/Cr 2500) + `hq_paid_for_site` & IMTT at HQ (Dr 2500/Cr 1110);
  petty cash top-ups `petty_cash_topup_hq` / `hq_funded_site_cash`. Harare books set up 25 Sep 2026 (0220: 78
  accounts, 46 rules, bank acct → 1110, MOCK opening Dr 1110 1.5M / Dr 2500 3M / Cr 3900 4.5M, live 25 Sep) — both sides
  now post; 2500 balances mirror (Kamativi owes HQ = HQ owed). Tab "Head office & sites": `fin_intersite_balances`,
  `finance_set_funded_by`.
  **P7 built (0219, 0219b):** purchase_orders.work_order_id (copied from requests by trg_po_line_work_order;
  `proc_po_set_work_order`), FleetMaintenance work order modal lists its POs; `proc_po_from_reorder` (stores
  shortages → draft POs by preferred/price-list supplier); `proc_po_trail` (Paper trail on PO detail);
  `proc_report(kind, sites, from, to)` → ProcReports PR06 (8 reports + CSV).
  **Ask Bravura A1 (0217):** FI29 `fi_ask` → edge function `supabase/functions/ask-bravura` (Groq, secret
  GROQ_API_KEY, prefers qwen/qwen3-32b, env GROQ_MODEL overrides; 60 questions/user/day); tools = read-only
  `ai_spend_summary`, `ai_spend_on`, `ai_supplier_history` (finance/procurement view per site via `_ai_sites`);
  log `ai_questions` (rating 👍/👎).

- Real opening balances for Kamativi (replace mock JV-0001 via `finance_setup_clear_mock_opening`).
- Finance setup (FI20) for Selous and Manhizi — no CoA/rules yet. Harare done (mock opening).
- Hired-vehicle usage log (daily/km) so vehicles accrue like hired equipment (`hired_plant_usage`).
- Expected recurring bills with a missing-bill warning.
- **NEXT: Ask Bravura ERP-wide (#58, Stage 13)** — replaces A2–A6. Rules: tools only (ai_* RPCs as the asking user),
  never writes on its own (proposal cards → person confirms → same RPCs as the screens), sources + logs
  (ai_questions, ai_actions), figures only from tools / `calculate`. Phases: B1 floating button bottom-centre +
  screen-aware (`useAskContext()` hook per screen, DOM-text fallback, "Using this screen" chip) + `calculate`
  tool + clickable record links; B2 ai_* read functions for every module + `ai_find`; B3 files in chat (vision
  read + match to supplier/PO, no save); B4 actions (receive items via proc_receive_po + file on GRN, draft bill,
  petty cash, request, PO from quote, approvals); B5 ds_document_links + DocumentViewer on any record; B6 daily
  brief + alerts + report commentary; B7 voice notes (Whisper on Groq). A1 (FI29) is live.
  **B1 built:** `components/AskBravura.jsx` — AskProvider inside ModuleLayout's content area (contentRef for DOM-text
  fallback), floating ✦ button bottom-centre portalled to body (opened by the button or the open-ask-bravura event; no keyboard shortcut — Ctrl J is the browser Downloads key), desktop panel
  movable + resizable on all edges/corners (geometry in localStorage 'ask_box'), phone bottom sheet with drag
  handle; welcome message (capabilities + examples); `useAskContext(obj)` wired on ProcHome, ProcOrders,
  ProcReceiving, ProcRequests, PaySuppliers (others use visible text). Edge function v2: `calculate` tool (safe
  parser), SCREEN section in prompt, `links` for PO/request/JV/GRN/agreement numbers; routes proc_orders:<id> and
  proc_requisitions:<id> open the record. FI29 page reuses AskChat (removed from the finance sidebar; reach it via FI29). Answers render light markdown (bold, lists).
  **B2 built (0221):** `_ai_sites_for(perm, sites)` + read-only `ai_fuel`, `ai_fleet`, `ai_stock`, `ai_people`, `ai_sheq`,
  `ai_meals`, `ai_camp`, `ai_procurement`, `ai_find` (each gated by that module's .view per site); edge function v3 maps
  tools fuel/fleet/stock/people/sheq/meals/camp/procurement/find via MODULE_RPC.
  **B3 built (0222):** 📎 / paste / drop in AskChat — images downscaled to JPEG, PDFs rendered (pdfjs-dist, 2 pages) + text layer,
  sent with the question and never stored; edge fn v4 reads each with a Groq vision model (llama-4-scout, env GROQ_VISION_MODEL)
  into JSON, then `match_document` → `ai_match_document` (supplier, POs with lines/receipts/bills, duplicate bill number).
  Also `ai_leave` (leave requests by status, incl. rejected + reason); `ai_notifications` (0223, own notifications, read-only).
  **B4 built (0224):** `ai_actions` log; `ai_prepare_receive/bill/petty_cash/request` (read-only checks) → edge fn tools
  `propose_*` save a proposal (`ai_action_propose`) and return `actions` → ActionCard in AskChat with Confirm/Cancel →
  `ai_action_confirm` (SECURITY INVOKER: proc_receive_po, purchase_invoices draft insert, petty_cash_record, proc_request_save)
  / `ai_action_cancel`. Proposals expire after 2 h. Groq free tier: `groqChat` falls back qwen → gpt-oss-120b → gpt-oss-20b.
  **B5 built (0226):** `ds_document_links` created (was referenced but missing — LinkedDocuments failed silently); archive-only
  (`ds_unlink`); `ds_attach_file` = upload-and-link (`utils/docshareUpload.js` attachFileToRecord). LinkedDocuments now has
  Upload / Link existing / remove, on PO detail, request detail, supplier profile (+ employees, contractors, incidents, fleet assets).
  `ai_action_confirm` returns record_table/record_id; AskChat files the chat attachment on that record after Confirm.
  **B6 built (0228):** `_ai_alerts_core` (fuel draw >2× usual, price jump >20%, duplicate bills, bill mismatch) → `ai_alerts`,
  `ai_daily_brief` (approval_inbox, late POs, low stock, expiring papers/docs, budgets ≥90%, alerts) shown as "Your day" on
  HomeLauncher; pg_cron `ask-bravura-alerts` 04:30 UTC → `ai_alerts_notify` (once per alert, `ai_alert_log`). scheduled-reports
  v3 adds an "In short" AI commentary. **B7:** 🎤 in AskChat → edge fn `{transcribe}` (Whisper on Groq) → text into the box;
  offline recordings retried on 'online'. **B8 guardrails (0229):** `ai_settings` + `ai_usage_check` (per person/site caps, on/off),
  `supabase/functions/ask-bravura/audit.js` figure check (tested in src/test/askAudit.test.js) → `ai_questions.unverified` + ⚠ note,
  AD12 `admin_ask` page (`ai_admin_overview`: usage, needs-a-look, actions, limits, AI register).
  Procurement Home touch-up (0225 `proc_home_insights`): headline band, 6-month trend, top suppliers, 30-day pipeline.
- **Ask Bravura leftovers done (0231):** approve/reject from the approvals inbox (`ai_prepare_approval` → `approval_decide`),
  quote → draft PO (`ai_prepare_po` → `proc_po_save`), chat history 30 days on the server (`ai_questions.hidden` = New conversation),
  `useAskContext` on Finance Home, Budgets, Reports, Fuel dashboard, Fleet dashboard, Fleet maintenance, Stock balances.
  No keyboard shortcut (Ctrl J opens browser Downloads). "Your day" on home is hidden when nothing is waiting.
- Home screen order: Finance, Procurement, Inventory, Fuel, Fleet (Fleet is now a top-level tile), then Batch Plant and groups.
- DocShare storage (0230): `docshare-files` read needs ds.view, upload ds.create, at the site in the path's first folder (`_ds_storage_site`).
- **NEXT: Inventory rewrite (#59, Stage 14)** — review + dashboard design: https://claude.ai/artifact/QdzVfFMx8DRqYeBMomSctT.
  Finance look (FinShell). Found: outgoing moves saved at unit_cost 0 (issues/returns/adjust/IN08 → $0 GL and zero-value transfers),
  negative stock allowed, inventory RLS uses `ur.site_id = w.site_id` (all-site roles see nothing), screens insert movements directly,
  one items.average_cost for all stores, reorder per item. Phases: I1 correct (RLS, move RPCs with DB-set cost, no negatives, cost per
  store, remove IN08 / camp_supply_txns / stock_transfers) · I2 bins + QR, min/max per store, UoM conversions, Excel import, opening count ·
  I3 reservations, available/on order/in transit, transfers with in-transit, "truck" cart · I4 `inv_home` dashboard, FinShell, menu
  Overview/Stock/Move/Replenish/Reports/Setup, phone scanning · I5 ageing, dead stock, ABC, shrinkage, FEFO, return condition, kits ·
  I6 Ask Bravura issue cards + stock alerts.
  **I1 built (0232, 0232a):** inventory RLS via `_inv_can(action, warehouse)` / `_inv_any` (_has_permission; all-site roles work);
  stock_balances / inventory_movements / inventory_batches are read-only to clients — every move goes through `inv_issue`, `inv_return`,
  `inv_adjust` (reason, inventory.edit), `inv_transfer` (same site only), `inv_receive_nopo` (opening/donation/found/returned/other),
  `inv_opening`, `inv_count_post` (one step, variance $ on stock_takes). Balance trigger prices outgoing moves at the store's moving
  average (incoming $0 → store rate), blocks negatives unless `warehouses.allow_negative`, items.average_cost = weighted across stores.
  GL: `stock_opening` (1320/3900), cross-site `stock_transfer_out` (2500/1320) / `stock_transfer_in` (1320/2500) via
  `inventory_movements.counter_warehouse_id`; PO receipts without a store go to `_inv_main_store(site)`; requests issued from stock
  track `requisition_lines.issued_qty` and close as fulfilled. Fleet WO parts issue via inv_issue (work_order_id). camp_supply_txns +
  stock_transfers frozen (`trg_retired`); CA06/CA07 open Stores screens; IN08 = Move between stores.
  **I2 built (0233):** `warehouse_bins` + QR labels (IN17 `inv_bins`), `item_store_settings` bin/min/max/reorder per store (IN18
  `inv_levels`; `_inv_reorder_core` uses them first), `items.purchase_uom_id` + `purchase_factor` (GRN converts PO-unit qty × factor,
  cost ÷ factor), `inv_import_items(rows, store)` + IN19 `inv_import` (Excel template, upsert by item_code, bins/levels, opening stock).
  **I3 built (0234):** `stock_reservations` (request or work order; `inv_reserve` / `inv_release`; BEFORE trigger `trg_inv_a_reservation`
  blocks issue/transfer_out of stock held for others and consumes the matching reservation on issue). Shipments `inv_shipments` +
  `inv_shipment_lines`: `inv_dispatch` (transfer_out, SHP number, in transit) → `inv_receive_shipment` (transfer_in at sending cost,
  shortfall = adjustment 'short in transit'); `proc_request_fulfil_transfer` now dispatches (request 'ordered' → 'fulfilled' on receipt).
  `inv_position(sites, store)` = on hand / reserved / free / on order (PO units converted) / in transit / reorder / value / bin.
  `inv_store_list()` names every active store (destination picker). Screens IN20 `inv_transfers` (truck cart, receive), IN21 `inv_position`
  (position + reservations tabs).
  **I4 built (0235):** `inv_home(site_ids)` → Stores dashboard IN01 `pages/inventory/InvHome.jsx` (replaces InvDashboard): attention chips,
  value / issued this month / days of cover / dead stock (180 d) / count accuracy (90 d) / reserved, 6-month trend, by department,
  Reorder now (+ proc_po_from_reorder), ABC (12 m issued value), expiring batches, latest moves. `inv_scan(code, site)` → IN22 `inv_scan`
  (BarcodeDetector camera or typed / handheld; item → stock per store + Issue / Count (inv_adjust 'Spot count'); `BIN:store:code` → bin
  contents). Inventory menu grouped Overview · Stock · Move · Replenish · Reports · Setup; older stores screens wrapped with `invFramed`
  (FinShell module Inventory); QuickNav hides inside any Finance/Procurement/Stores frame.
  **I5 built (0236):** FEFO in `trg_inventory_movement_batch` (outgoing move with no batch takes the earliest-expiry batch, empties it
  and splits the rest onto a new movement; `inv.split_child` stops the reservation guard double-counting). Returns carry `condition`
  good/damaged/scrap (damaged/scrap = return then 'returned …' adjustment loss). Kits: `items.is_kit` + `item_kit_components`,
  `_inv_expand_kits` in inv_issue/inv_return/inv_dispatch, `trg_inv_0_no_kit` (kits hold no stock); IN24 `inv_kits`.
  `inv_report(kind, sites, from, to)` kinds ageing/dead/abc/shrinkage/usage/counts → IN23 `inv_health` (CSV).
  **I6 built (0237):** `ai_stock` from inv_position (free/reserved/on order/on the way/bin; short list, on the road, expiring);
  proposals `ai_prepare_stock_issue` (to department / person / work order) and `ai_prepare_stock_transfer` → `ai_action_confirm`
  kinds stock_issue (inv_issue) / stock_transfer (inv_dispatch); edge fn v12 tools propose_stock_issue / propose_stock_transfer.
  `_ai_alerts_core` = `_ai_alerts_base` (old) ∪ `_ai_alerts_stock` (out of stock — reads tables directly for the cron, shipment
  on the road >5 d, count off >5%, batch expiring ≤14 d).
  **Module is called "Stores" on screen (user, 25 Sep)** — code ids stay `inventory` / `inv_*` / `inventory.*` permissions.
  **No scanning (user, 25 Sep):** Scan (IN22) removed from menu/dashboard, bin labels are plain text (no QR, qrcode package removed).
  **Vercel (25 Sep):** preview deployments disabled + Ignored Build Step skips every branch but main (free plan = 100 builds/day; the second branch push no longer builds). If pushes stop deploying, redeploy from the dashboard or MCP create_deployment.
- **NEXT: Fleet & assets rewrite (#61, Stage 15)** — review: https://claude.ai/artifact/F3gZhEyBtf8bkj8BmGZHRh. Found: 45 machines (Kamativi) with no
  cost/papers/meters/operator; all 135 fuel issues unpriced ($0 → no cost per machine, nothing to GL); no km/hours reach
  fleet_meter_readings; delete policies on fleet tables; fleet_assets vs fixed_assets unconnected (0 fixed assets); 4 register screens over
  one 62-column table; status 'active'/'operational' mixed; papers on asset + fleet_compliance; maintenance vs work orders duplicate;
  FL16 frozen table in menu. Phases A1 correct · A2 one machine record · A3 pre-starts + work orders · A4 service planning + contracts ·
  A5 dashboard/cost per hour/finance look · A6 small assets + Ask Bravura (+ optional Traccar).
  Sub-issues: A1 #62 · A2 #63 · A3 #64 · A4 #65 · A5 #66 (dashboard in the FINANCE look — FinShell/financeTheme, user 25 Sep) ·
  **A1 built (0239, 0239b):** fuel issues priced by `trg_fuel_price_and_meter` (last delivery price; 135 backfilled, $19,485.20);
  fuel_transactions.hours_reading/meter_broken/meter_note; `trg_fuel_to_meter` → fleet_meter_readings (flags backwards / >max jump,
  fleet_settings.max_km_jump/max_hours_jump); statuses normalised + CHECK; fleet DELETE policies dropped; compliance → asset expiry
  dates (read-only on asset form); `fleet_meter_gaps` panel on meter readings; FL16 removed from menu.
  **A2 built (0240):** one Machines list FL05 `fleet_assets` (FleetVehicles/HeavyEquipment/Generators deleted; FL02–04 open it filtered
  via initialCategory); `fleet_type_specs` (per type category) → `fleet_assets.specs` jsonb (old generator columns copied, kept);
  `MachineBook.jsx` on FleetAssetDetail: specs, book value (`fleet_machine_book`), "Add to fixed assets" (`fleet_capitalise` —
  optional GRN line via `fleet_capitalise_sources`, non-stock lines only → `asset_capitalised_grn` Dr 1610/Cr 1320; else asset_capitalised
  Dr 1610/Cr 1650), "Move to another site" (`fleet_transfer_site`, `fleet_site_transfers`; clears dept/cost centre/project/operator;
  fixed asset moves with it; events asset_transfer_out(_accum) / asset_transfer_in(_accum) through 2500).
  **A3 built (0241):** FL20 `fleet_prestart` (FleetPrestart.jsx, offline queue in localStorage 'fleet_prestart_queue', idempotent
  client_ref) → `fleet_prestart_template(asset)` (site/type template else default list per category) + `fleet_prestart_submit(p)`:
  inspection kind 'prestart', meter readings source 'prestart' (flags), `fleet_defects` per fail, one open job per machine
  (critical fail → priority critical + grounded if fleet_settings.auto_ground_on_fail), _notify_permission fleet.edit.
  `fleet_wo_costs(wo)` (Stores issues via inventory_movements.source_reference_id, bills via purchase_orders.work_order_id);
  `fleet_wo_complete(wo, p)` writes fleet_maintenance (+ parts from Stores), closes defects, machine back to operational.
  `trg_fleet_wo_status_to_asset`: in_progress → maintenance, waiting_for_parts → awaiting_parts (downtime clock).
  **A4 built (0242):** FL21 `fleet_contracts` (FleetContracts.jsx; `fleet_contract_list`, annual cost, states), pg_cron
  `fleet-contract-reminders` 04:45 UTC → `fleet_contract_reminders()` (once per end date, `reminded_for`);
  `fleet_reliability_by_type` shown on FL19 Downtime tab. Service due list/plans per type already existed (fleet_pm_due).
  Meters at fuel fills: optional now, REQUIRED from 1 Nov 2026 (user, 25 Sep) — setting meter_required_from.
  A6 #67 **small assets issued to people (tools, radios, laptops) is REQUIRED** (user, 25 Sep): register, issue/sign/return with
  condition, who-holds-what, employee profile + exit checklist blocks until returned, overdue returns, counts.
- **Bravura email (#60):** RESEND_API_KEY + verified sending domain (REPORTS_FROM) + Supabase Auth custom SMTP; then daily brief by email.
- **Later:** exports (Excel/PDF) for every list and report (#60).
- UI: app-wide TopBar lives in `components/ModuleLayout.jsx` (module eyebrow, split title, Ctrl K search
  firing `open-command-palette`, live clock capsule); SiteSwitcher is a pill.

## Database access

No credentials are stored in this repo. If the user provides a connection
string in chat (Session pooler, IPv4: `aws-0-eu-west-1.pooler.supabase.com:5432`),
use `psql` with PGPASSWORD env var, apply migrations directly, and verify.
Never commit credentials. The direct host `db.<ref>.supabase.co` is IPv6-only
and unreachable from cloud containers.
