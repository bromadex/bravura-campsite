# Bravura Zimbabwe — Meal Management System v2
## Full Architecture & Build Specification

---

## 1. Overview

The current system is a single-file HTML/JS app using `localStorage`. The new version moves to a full-stack web application:

- **Frontend**: React (Vite) + Tailwind CSS — same visual language as v1
- **Backend / DB**: Supabase (PostgreSQL + Auth + Realtime)
- **Hosting**: Vercel (frontend) via GitHub CI/CD
- **Auth**: Supabase Auth with role-based access control

---

## 2. Project Structure

```
bravura-meals/
├── public/
│   └── favicon.ico
├── src/
│   ├── App.jsx                  # Router + auth gate
│   ├── main.jsx
│   ├── supabaseClient.js        # Supabase initialisation
│   ├── auth/
│   │   ├── LoginPage.jsx
│   │   └── useAuth.js           # Auth context/hook
│   ├── components/
│   │   ├── Layout.jsx           # Sidebar + topbar shell
│   │   ├── Sidebar.jsx
│   │   ├── Toast.jsx
│   │   └── Modal.jsx
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── DailyEntry.jsx       # Meal Officer only
│   │   ├── KitchenConfirm.jsx   # Kitchen Guy only
│   │   ├── Approvals.jsx        # Approver / Site Manager
│   │   ├── DailyReport.jsx
│   │   ├── RangeReport.jsx
│   │   ├── MonthlyReport.jsx
│   │   ├── Employees.jsx
│   │   ├── Pricing.jsx          # Kitchen Owner only
│   │   ├── Flags.jsx            # Query / flag management
│   │   └── Settings.jsx
│   └── utils/
│       ├── permissions.js       # Role-based access helpers
│       └── formatters.js
├── .env.local                   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
├── vercel.json
└── package.json
```

---

## 3. User Roles & Permissions

| Role | Username | Password | Key Permissions |
|---|---|---|---|
| **Super Admin** | `wendy` | `Wendy123` | Everything — all data, all settings, all reports incl. costs |
| **Meal Officer** | `mealofficer` | `Mealofficer123` | Enter daily meals, add/edit employees, view historical data, **cannot** see costs, **cannot** modify approved days |
| **Approver** (Site Manager) | `sitemanager` | `Sitemanager123` | Review & approve daily submissions, edit before approving, see costs/billing |
| **Kitchen** | `kitchen` | `Kitchen123` | Confirm meal counts received, raise flags/queries |
| **Kitchen Owner** | `kitchenowner` | `Kitchenowner123` | Set & update meal prices (breakfast/lunch/supper) |

> **Note**: Passwords must be changed to strong values before go-live. These are starter credentials only. Store them in Supabase Auth — never in code.

### Permission Matrix

| Feature | Super Admin | Meal Officer | Approver | Kitchen | Kitchen Owner |
|---|:---:|:---:|:---:|:---:|:---:|
| Dashboard | ✅ Full | ✅ (no costs) | ✅ Full | ✅ Limited | ✅ Limited |
| Daily Entry | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit approved day | ✅ | ❌ | ✅ (before approve) | ❌ | ❌ |
| Approve day | ✅ | ❌ | ✅ | ❌ | ❌ |
| Kitchen Confirm | ✅ | ❌ | ❌ | ✅ | ❌ |
| Raise Flag | ✅ | ❌ | ❌ | ✅ | ❌ |
| Resolve Flag | ✅ | ❌ | ✅ | ❌ | ❌ |
| View costs / billing | ✅ | ❌ | ✅ | ❌ | ✅ |
| Set meal prices | ✅ | ❌ | ❌ | ❌ | ✅ |
| Add/Edit employees | ✅ | ✅ | ❌ | ❌ | ❌ |
| Settings | ✅ | ❌ | ❌ | ❌ | ❌ |
| All Reports | ✅ | ✅ (no costs) | ✅ | ❌ | ✅ (costs only) |

---

## 4. Database Schema (Supabase / PostgreSQL)

### 4.1 `profiles` table
Extends Supabase `auth.users`. Created automatically via trigger on signup.

```sql
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  role        text not null check (role in (
                'super_admin','meal_officer','approver','kitchen','kitchen_owner'
              )),
  full_name   text,
  created_at  timestamptz default now()
);
```

### 4.2 `employees` table

```sql
create table employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  group_name  text not null default 'Main Site',  -- 'Main Site' | 'Manhattan'
  status      text not null default 'Active',      -- 'Active' | 'Inactive'
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
```

### 4.3 `meal_prices` table

```sql
create table meal_prices (
  id            uuid primary key default gen_random_uuid(),
  effective_date date not null default current_date,
  breakfast_usd numeric(10,2) not null default 0,
  lunch_usd     numeric(10,2) not null default 0,
  supper_usd    numeric(10,2) not null default 0,
  set_by        uuid references profiles(id),
  created_at    timestamptz default now()
);
-- Only the most recent effective_date row is used for billing
```

### 4.4 `daily_submissions` table
One row per day. Tracks submission & approval lifecycle.

```sql
create table daily_submissions (
  id              uuid primary key default gen_random_uuid(),
  date            date not null unique,
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','queried')),
  submitted_by    uuid references profiles(id),
  submitted_at    timestamptz,
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  confirmed_by    uuid references profiles(id),   -- kitchen
  confirmed_at    timestamptz,
  kitchen_count_b int,  -- what kitchen received
  kitchen_count_l int,
  kitchen_count_s int,
  notes           text,
  created_at      timestamptz default now()
);
```

### 4.5 `meal_logs` table
One row per employee per meal per day.

```sql
create table meal_logs (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid references daily_submissions(id) on delete cascade,
  date            date not null,
  employee_id     uuid references employees(id),
  employee_name   text not null,  -- denormalised for historical integrity
  had_breakfast   boolean not null default false,
  had_lunch       boolean not null default false,
  had_supper      boolean not null default false,
  recorded_by     uuid references profiles(id),
  recorded_at     timestamptz default now(),
  unique(date, employee_id)
);
```

### 4.6 `flags` table
Kitchen raises a query; approver resolves it.

```sql
create table flags (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid references daily_submissions(id) on delete cascade,
  date            date not null,
  raised_by       uuid references profiles(id),  -- kitchen user
  raised_at       timestamptz default now(),
  message         text not null,
  status          text not null default 'open'
                    check (status in ('open','resolved')),
  resolved_by     uuid references profiles(id),
  resolved_at     timestamptz,
  resolution_note text
);
```

### 4.7 `config` table

```sql
create table config (
  key   text primary key,
  value text
);
-- Rows: company_name, site_name, supervisor_name, provider_name
```

---

## 5. Approval Workflow (State Machine)

```
[Meal Officer]         [Approver]        [Kitchen]
     │                     │                  │
  DRAFT ──────submit──▶ SUBMITTED ──review──▶ │
     ◀──────────────────────┤ (edit)           │
                            │                  │
                       APPROVED ──────────▶ CONFIRMED
                            │
                            ▼
                      [flag raised] ──▶ QUERIED
                                           │
                                    [flag resolved] ──▶ back to APPROVED
```

**Rules:**
- Meal Officer can edit only `draft` days
- Approver can edit and approve `submitted` days
- Once `approved`, only Super Admin can edit
- Kitchen confirms counts and can raise a flag on any `approved` day
- Flags show up as notifications to Approver & Super Admin
- Super Admin can force-override any state

---

## 6. Flag / Query System

When kitchen raises a flag:
1. A row is inserted into `flags`
2. The `daily_submissions.status` changes to `'queried'`
3. Approver and Super Admin see a **red badge** on the sidebar "Flags" item and on the Dashboard
4. The Approver opens the flag, reads the message, optionally adjusts the record, then resolves with a note
5. On resolution, status returns to `'approved'` and kitchen sees the flag as resolved

Flag reasons (dropdown, kitchen selects):
- Count mismatch (received different qty)
- Missing allocation (employees listed but no food received)
- Quality issue (food not delivered / wrong)
- Other (free text)

---

## 7. Billing / Cost Module

Only visible to **Super Admin**, **Approver**, and **Kitchen Owner**.

Uses `meal_prices` to look up the price applicable on each date (the most recent `effective_date ≤ meal date`).

**Billing calculations:**
```
day_cost = (breakfast_count × b_price) + (lunch_count × l_price) + (supper_count × s_price)
```

**Report views:**
- Daily bill (for any date)
- Monthly bill (total + per-meal breakdown)
- Date range bill (custom period)
- All-time summary

Billing reports can be printed/exported to PDF.

---

## 8. Navigation by Role

### Super Admin — full sidebar
- Dashboard, Daily Entry, Daily Report, Range Report, Monthly Report
- Billing (Day / Month / Range)
- Employees, Pricing, Flags, Settings

### Meal Officer
- Dashboard, Daily Entry, Daily Report, Range Report, Monthly Report
- Employees
- *(No billing, no pricing, no settings)*

### Approver
- Dashboard, Approvals, Daily Report, Range Report, Monthly Report
- Billing (Day / Month / Range)
- Flags

### Kitchen
- Dashboard (simplified: today's counts + flags)
- Kitchen Confirm (today's submission)
- Flags (raise / view own flags)

### Kitchen Owner
- Dashboard (simplified: cost summary)
- Pricing (set meal prices)
- Billing (read-only)

---

## 9. New & Improved Features vs v1

| Feature | v1 | v2 |
|---|---|---|
| Storage | localStorage (browser only) | Supabase cloud DB |
| Multi-user | ❌ | ✅ 5 roles |
| Login | ❌ | ✅ Supabase Auth |
| Approval workflow | ❌ | ✅ draft→submitted→approved |
| Kitchen confirmation | ❌ | ✅ with flag system |
| Cost / billing | ❌ | ✅ role-gated |
| Meal pricing | ❌ | ✅ Kitchen Owner sets prices |
| Notifications / flags | ❌ | ✅ flag inbox + badge |
| Realtime updates | ❌ | ✅ Supabase Realtime |
| Accessible from anywhere | ❌ | ✅ Vercel |
| Audit trail | ❌ | ✅ who did what, when |
| Print / export | ✅ | ✅ improved |

---

## 10. Supabase Row-Level Security (RLS)

RLS policies ensure the DB itself enforces permissions even if the frontend has a bug.

```sql
-- meal_logs: only approved viewers can SELECT; only meal_officer can INSERT/UPDATE on draft days
-- daily_submissions: kitchen_owner cannot SELECT cost columns
-- meal_prices: only kitchen_owner and super_admin can INSERT/UPDATE
-- flags: kitchen can INSERT; approver and super_admin can UPDATE
```

Full RLS SQL will be generated separately.

---

## 11. Deployment Steps

### 11.1 Supabase Setup
1. Create project at supabase.com
2. Run schema SQL (tables, RLS, triggers)
3. Create auth users for each role via Supabase Auth dashboard
4. Copy `Project URL` and `anon key`

### 11.2 Local Dev
```bash
npm create vite@latest bravura-meals -- --template react
cd bravura-meals
npm install @supabase/supabase-js react-router-dom
# create .env.local:
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx...
npm run dev
```

### 11.3 GitHub + Vercel
1. Push repo to GitHub
2. Import project in Vercel
3. Add env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
4. Deploy — Vercel auto-deploys on every push to `main`

---

## 12. Suggested Improvements (Beyond the Brief)

1. **Audit log**: every change timestamped with the user who made it — useful for disputes
2. **Employee categories**: add "Expat", "Local", "Visitor" — some sites have different meal entitlements
3. **Meal cap per employee**: e.g. set max 3 meals/day per person and warn if exceeded
4. **Export to Excel**: monthly billing report downloadable as `.xlsx`
5. **SMS/WhatsApp notification**: when a flag is raised, Twilio or Africa's Talking sends approver a message (big deal on remote mine sites)
6. **Offline mode**: service worker caches entry page so Meal Officer can work with poor signal and sync when connected
7. **Dark mode**: auto-detected from system preference
8. **Visitor meals**: ad-hoc one-off meal entries for non-employees (guests, contractors)

---

## 13. File Deliverables in This Package

| File | Purpose |
|---|---|
| `BravuraMealSystem_v2_Architecture.md` | This document |
| `supabase_schema.sql` | Full SQL for all tables, RLS, triggers |
| `src/` folder | Full React source code |

---

*Bravura Zimbabwe Ltd — Kamativi Mine Site | Prepared June 2026*
