# Bravura Zimbabwe — Meal Management System v2

A multi-user, cloud-based meal tracking and billing platform for Bravura Zimbabwe Ltd — Kamativi Mine Site.

**Stack:** React 19 + Vite · Supabase (PostgreSQL + Auth) · Vercel

---

## User Roles

| Role | Username | Access |
|---|---|---|
| Super Admin | `wendy` | Everything |
| Meal Officer | `mealofficer` | Enter meals, manage employees, view reports (no costs) |
| Approver | `sitemanager` | Review & approve submissions, billing, flags |
| Kitchen | `kitchen` | Confirm daily counts, raise flags |
| Kitchen Owner | `kitchenowner` | Set meal prices, view billing |

> **Important:** Set up users via Supabase Auth dashboard (see Step 2). Change passwords before going live.

---

## Setup Guide

### Step 1 — Clone the repo

```bash
git clone https://github.com/YOUR_ORG/bravura-meals.git
cd bravura-meals
npm install
```

### Step 2 — Create Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Note your **Project URL** and **anon public key** from Settings → API
3. Open the **SQL Editor** and paste + run `supabase_schema.sql` (in the project root)
4. This creates all tables, RLS policies, triggers, and seeds employee data

### Step 3 — Create auth users

In Supabase dashboard → **Authentication → Users → Add user**:

Create these users (use real email addresses):

| Email | Password | After creating, update profiles table |
|---|---|---|
| wendy@bravurazim.com | Wendy123! | role = 'super_admin', username = 'wendy' |
| mealofficer@bravurazim.com | Mealofficer123! | role = 'meal_officer', username = 'mealofficer' |
| sitemanager@bravurazim.com | Sitemanager123! | role = 'approver', username = 'sitemanager' |
| kitchen@bravurazim.com | Kitchen123! | role = 'kitchen', username = 'kitchen' |
| kitchenowner@bravurazim.com | Kitchenowner123! | role = 'kitchen_owner', username = 'kitchenowner' |

After creating each user in auth, run in SQL Editor:
```sql
UPDATE profiles SET
  username  = 'wendy',
  role      = 'super_admin',
  full_name = 'Wendy Mpala'
WHERE id = (SELECT id FROM auth.users WHERE email = 'wendy@bravurazim.com');
```
Repeat for each user with correct values.

### Step 4 — Configure environment

```bash
cp .env.local.template .env.local
```

Edit `.env.local`:
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 5 — Run locally

```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173)

---

## Deploy to Vercel

### Option A — Vercel CLI
```bash
npm install -g vercel
vercel
```

### Option B — GitHub + Vercel Dashboard
1. Push repo to GitHub: `git push origin main`
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. Add environment variables in Vercel dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy — Vercel auto-deploys on every push to `main`

---

## Enable Supabase Realtime (optional but recommended)

In Supabase dashboard → **Database → Replication**:

Enable realtime for:
- `public.flags`
- `public.daily_submissions`

This gives live flag notifications without page refresh.

---

## Approval Workflow

```
Meal Officer enters meals
        ↓
    [Save as Draft]
        ↓
  [Submit for Approval] → Approver reviews
        ↓                      ↓
   SUBMITTED              [Approve] or [Return]
                               ↓
                          APPROVED
                               ↓
                    Kitchen confirms counts
                               ↓
                    [Raise Flag if mismatch]
                               ↓
                           QUERIED
                               ↓
                    Approver resolves flag
                               ↓
                    Back to APPROVED
```

---

## Project Structure

```
src/
├── App.jsx              # Root + auth gate + page routing
├── main.jsx             # Entry point
├── supabaseClient.js    # Supabase init
├── auth/
│   ├── AuthContext.jsx  # Auth provider + useAuth hook
│   └── LoginPage.jsx
├── components/
│   ├── Layout.jsx       # Sidebar + topbar (role-aware nav)
│   └── ui.jsx           # Shared UI primitives
├── pages/
│   ├── Dashboard.jsx
│   ├── DailyEntry.jsx   # Meal Officer
│   ├── Approvals.jsx    # Approver
│   ├── KitchenConfirm.jsx
│   ├── Reports.jsx      # Daily / Range / Monthly (exports 3 components)
│   ├── Billing.jsx      # Cost reports
│   ├── Employees.jsx
│   ├── Pricing.jsx      # Kitchen Owner
│   ├── Flags.jsx        # Kitchen + Approver
│   └── Settings.jsx     # Super Admin
└── utils/
    └── permissions.js   # Role-based access control
```

---

## Database Tables

| Table | Purpose |
|---|---|
| `profiles` | User roles linked to Supabase auth |
| `employees` | Employee master list |
| `meal_prices` | Price schedule (effective date based) |
| `daily_submissions` | One row per day — tracks approval state |
| `meal_logs` | One row per employee per day — the actual meal ticks |
| `flags` | Kitchen queries and their resolution |
| `config` | Company name, site, supervisor, provider |

View `daily_billing` joins submissions + logs + prices to calculate daily costs.

---

## Security

- All routes are guarded at both UI level (React) and database level (RLS policies)
- Kitchen can only see their own flags
- Meal Officer cannot see costs or billing
- Only Super Admin can access Settings
- Passwords must be changed from defaults before go-live

---

*Bravura Zimbabwe Ltd — Kamativi Mine Site · v2.0 · June 2026*
