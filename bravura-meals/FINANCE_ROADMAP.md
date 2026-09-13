# Finance Module Roadmap

Bravura ERP — phased build plan for double-entry accounting, bank reconciliation, reporting, and cross-module cost integration.

**Module code:** FI | **Pages:** 12 | **New tables:** 8

---

## Phase 1 — GL Foundation
*Migration + 3 pages*

### Chart of Accounts (`accounts`)
- Five account types: Asset, Liability, Equity, Revenue, Expense
- Hierarchical codes (1000 Assets, 2000 Liabilities, etc.)
- Inline add/edit, soft-delete (is_archived), site-scoped
- Seed with standard mining-camp chart on first deploy

### Journal Entries (`journal_entries`, `journal_lines`)
- Double-entry: debits must equal credits (DB CHECK constraint)
- Status workflow: **Draft → Posted → Void** (no deletes)
- Auto-numbering (JV-001, JV-002…) per site
- Optional source reference (module, record_id) for cross-module GL postings
- Approval gate via `can('finance.approve')`

### GL Posting Engine (RPC)
- Server-side `finance_post_to_gl()` RPC — callable from any module
- Validates balanced entries, updates account running balances
- Returns journal entry ID for audit trail linkage

### Permissions
- `finance.view` / `finance.create` / `finance.edit` / `finance.delete` / `finance.approve`
- RLS policies via `_has_permission('FI...', site_id)`

---

## Phase 2 — Banking
*Migration + 2 pages*

### Bank Accounts (`bank_accounts`)
- Account name, number, bank, currency, linked GL account
- Opening balance, current balance (trigger-maintained)
- Site-scoped, soft-delete

### Bank Reconciliation (`bank_statement_lines`)
- CSV import for bank statements (reuse `utils/csv.js`)
- Auto-match: amount + date proximity to unreconciled journal lines
- Manual match/unmatch with drag or click pairing
- Reconciliation status badges, period lock after sign-off

---

## Phase 3 — Financial Reports
*3 pages (server-side RPCs)*

### Trial Balance
- Period date range filter, site filter
- Debit/credit columns with running totals
- Drill-down: click account → filtered journal lines

### Profit & Loss
- Revenue minus Expenses for selected period
- Grouped by account sub-type (Sales, Cost of Sales, Operating Expenses)
- Month-over-month comparison columns
- CSV / PDF export

### Balance Sheet
- Assets = Liabilities + Equity at period end
- Current vs non-current classification
- Retained earnings auto-calculated from cumulative P&L

---

## Phase 4 — Cash Flow & Cost Centres
*Migration + 2 pages*

### Cash Flow Statement
- Indirect method: start from net income, adjust for non-cash items
- Three sections: Operating, Investing, Financing
- Account-type-based auto-classification (configurable mapping)

### Cost Centres (`cost_centres`)
- Tag journal lines to departments/projects (Fuel, Fleet, Meals, Camp, HR)
- Cost centre report: spending breakdown by centre and period
- Links to existing module data for cross-module cost tracking

---

## Phase 5 — Cross-Module Integration
*Triggers + 2 pages*

### Auto GL Postings
- Fuel purchases → debit Fuel Expense, credit Accounts Payable
- Fleet maintenance → debit Vehicle Maintenance, credit Bank/AP
- Meal costs → debit Catering Expense, credit Bank/AP
- Payroll (HR) → debit Salaries Expense, credit Salaries Payable
- Each posts via `finance_post_to_gl()` with source reference

### Finance Dashboard
- KPI tiles: Cash position, Monthly revenue, Monthly expenses, Net P&L
- Sparkline trends (30/60/90 day)
- Unreconciled items count, pending approvals count
- Quick links to all finance pages

---

## Architecture Decisions

| Decision | Detail |
|---|---|
| Site-scoped | Every table carries site_id; all queries filter via useSite() |
| RLS-gated | `_has_permission('FI...', site_id)` on all finance tables |
| Server-side RPCs | GL posting, report aggregation, reconciliation matching run in Postgres |
| Soft deletes only | is_archived flag; void instead of delete for journal entries |
| THEME tokens | Inline styles using THEME from utils/permissions.js |
| Audit trail | created_by, updated_by, created_at, updated_at on every table |

---

## T-Code Plan (FI prefix)

| Code | Page | Phase |
|---|---|---|
| FI01 | Finance Dashboard | 5 |
| FI02 | Chart of Accounts | 1 |
| FI03 | Journal Entries | 1 |
| FI04 | Journal Entry Detail | 1 |
| FI05 | Bank Accounts | 2 |
| FI06 | Bank Reconciliation | 2 |
| FI07 | Trial Balance | 3 |
| FI08 | Profit & Loss | 3 |
| FI09 | Balance Sheet | 3 |
| FI10 | Cash Flow Statement | 4 |
| FI11 | Cost Centres | 4 |
| FI12 | Cost Centre Report | 4 |
