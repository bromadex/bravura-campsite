-- ════════════════════════════════════════════════════════════════════════════
-- BRAVURA ZIMBABWE — MEAL MANAGEMENT SYSTEM v2
-- Supabase / PostgreSQL Schema
-- Run this in the Supabase SQL Editor (in order)
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ─────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────
-- 1. PROFILES (extends auth.users)
-- ─────────────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  role        text not null check (role in (
                'super_admin','meal_officer','approver','kitchen','kitchen_owner'
              )),
  full_name   text,
  created_at  timestamptz default now()
);

-- Trigger: auto-create profile row when a new auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, role, full_name)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    coalesce(new.raw_user_meta_data->>'role', 'meal_officer'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────────────
-- 2. EMPLOYEES
-- ─────────────────────────────────────────────────────
create table if not exists employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  group_name  text not null default 'Main Site',
  status      text not null default 'Active' check (status in ('Active','Inactive')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Auto-update updated_at
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists employees_updated_at on employees;
create trigger employees_updated_at
  before update on employees
  for each row execute procedure update_updated_at_column();

-- ─────────────────────────────────────────────────────
-- 3. MEAL PRICES
-- ─────────────────────────────────────────────────────
create table if not exists meal_prices (
  id              uuid primary key default gen_random_uuid(),
  effective_date  date not null default current_date,
  breakfast_usd   numeric(10,2) not null default 0 check (breakfast_usd >= 0),
  lunch_usd       numeric(10,2) not null default 0 check (lunch_usd >= 0),
  supper_usd      numeric(10,2) not null default 0 check (supper_usd >= 0),
  set_by          uuid references profiles(id),
  notes           text,
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────
-- 4. DAILY SUBMISSIONS (one row per calendar day)
-- ─────────────────────────────────────────────────────
create table if not exists daily_submissions (
  id              uuid primary key default gen_random_uuid(),
  date            date not null unique,
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','queried')),
  submitted_by    uuid references profiles(id),
  submitted_at    timestamptz,
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  confirmed_by    uuid references profiles(id),
  confirmed_at    timestamptz,
  kitchen_count_b int,
  kitchen_count_l int,
  kitchen_count_s int,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

drop trigger if exists daily_submissions_updated_at on daily_submissions;
create trigger daily_submissions_updated_at
  before update on daily_submissions
  for each row execute procedure update_updated_at_column();

-- ─────────────────────────────────────────────────────
-- 5. MEAL LOGS (one row per employee per day)
-- ─────────────────────────────────────────────────────
create table if not exists meal_logs (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid references daily_submissions(id) on delete cascade,
  date            date not null,
  employee_id     uuid references employees(id),
  employee_name   text not null,
  had_breakfast   boolean not null default false,
  had_lunch       boolean not null default false,
  had_supper      boolean not null default false,
  recorded_by     uuid references profiles(id),
  recorded_at     timestamptz default now(),
  unique(date, employee_id)
);

-- ─────────────────────────────────────────────────────
-- 6. FLAGS (kitchen queries / complaints)
-- ─────────────────────────────────────────────────────
create table if not exists flags (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid references daily_submissions(id) on delete cascade,
  date            date not null,
  raised_by       uuid references profiles(id),
  raised_at       timestamptz default now(),
  reason          text not null check (reason in (
                    'count_mismatch','missing_allocation','quality_issue','other'
                  )),
  message         text not null,
  system_count_b  int,  -- what system says was ordered
  system_count_l  int,
  system_count_s  int,
  kitchen_count_b int,  -- what kitchen actually received
  kitchen_count_l int,
  kitchen_count_s int,
  status          text not null default 'open'
                    check (status in ('open','resolved','dismissed')),
  resolved_by     uuid references profiles(id),
  resolved_at     timestamptz,
  resolution_note text
);

-- When a flag is raised, auto-update submission status to 'queried'
create or replace function flag_raised_update_submission()
returns trigger language plpgsql security definer as $$
begin
  update daily_submissions
  set status = 'queried', updated_at = now()
  where id = new.submission_id and status = 'approved';
  return new;
end;
$$;

drop trigger if exists on_flag_raised on flags;
create trigger on_flag_raised
  after insert on flags
  for each row execute procedure flag_raised_update_submission();

-- When a flag is resolved, return submission to 'approved'
create or replace function flag_resolved_update_submission()
returns trigger language plpgsql security definer as $$
begin
  if new.status in ('resolved','dismissed') and old.status = 'open' then
    -- Only mark approved if no other open flags remain
    if not exists (
      select 1 from flags
      where submission_id = new.submission_id
        and status = 'open'
        and id != new.id
    ) then
      update daily_submissions
      set status = 'approved', updated_at = now()
      where id = new.submission_id and status = 'queried';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_flag_resolved on flags;
create trigger on_flag_resolved
  after update on flags
  for each row execute procedure flag_resolved_update_submission();

-- ─────────────────────────────────────────────────────
-- 7. CONFIG
-- ─────────────────────────────────────────────────────
create table if not exists config (
  key   text primary key,
  value text
);

insert into config (key, value) values
  ('company_name',    'Bravura Zimbabwe Ltd'),
  ('site_name',       'Kamativi Mine Site'),
  ('supervisor_name', 'Eng. C. Katsande'),
  ('provider_name',   'Catering Company')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════════

-- Helper: get current user's role
create or replace function get_my_role()
returns text language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

-- ── PROFILES ──
alter table profiles enable row level security;

create policy "profiles_self_read" on profiles
  for select using (id = auth.uid());

create policy "profiles_admin_all" on profiles
  for all using (get_my_role() = 'super_admin');

-- ── EMPLOYEES ──
alter table employees enable row level security;

-- All authenticated users can read employees
create policy "employees_read" on employees
  for select using (auth.uid() is not null);

-- Only super_admin and meal_officer can insert/update
create policy "employees_write" on employees
  for insert with check (get_my_role() in ('super_admin','meal_officer'));

create policy "employees_update" on employees
  for update using (get_my_role() in ('super_admin','meal_officer'));

-- Only super_admin can delete
create policy "employees_delete" on employees
  for delete using (get_my_role() = 'super_admin');

-- ── MEAL PRICES ──
alter table meal_prices enable row level security;

-- Read: super_admin, approver, kitchen_owner
create policy "prices_read" on meal_prices
  for select using (get_my_role() in ('super_admin','approver','kitchen_owner'));

-- Write: super_admin, kitchen_owner
create policy "prices_write" on meal_prices
  for insert with check (get_my_role() in ('super_admin','kitchen_owner'));

create policy "prices_update" on meal_prices
  for update using (get_my_role() in ('super_admin','kitchen_owner'));

-- ── DAILY SUBMISSIONS ──
alter table daily_submissions enable row level security;

-- All authenticated users can read
create policy "submissions_read" on daily_submissions
  for select using (auth.uid() is not null);

-- Meal officer can insert/update draft submissions
create policy "submissions_insert" on daily_submissions
  for insert with check (get_my_role() in ('super_admin','meal_officer'));

create policy "submissions_update" on daily_submissions
  for update using (
    get_my_role() = 'super_admin'
    or (get_my_role() = 'meal_officer' and status = 'draft')
    or (get_my_role() = 'approver' and status in ('submitted','queried'))
    or (get_my_role() = 'kitchen' and status = 'approved')
  );

-- ── MEAL LOGS ──
alter table meal_logs enable row level security;

-- Read: everyone except kitchen_owner (they only need totals, not names)
create policy "logs_read" on meal_logs
  for select using (get_my_role() in (
    'super_admin','meal_officer','approver','kitchen'
  ));

-- Write: super_admin and meal_officer (on draft days)
create policy "logs_insert" on meal_logs
  for insert with check (get_my_role() in ('super_admin','meal_officer'));

create policy "logs_update" on meal_logs
  for update using (get_my_role() in ('super_admin','meal_officer','approver'));

create policy "logs_delete" on meal_logs
  for delete using (get_my_role() in ('super_admin','meal_officer'));

-- ── FLAGS ──
alter table flags enable row level security;

-- Kitchen can only see own flags; others see all
create policy "flags_read" on flags
  for select using (
    get_my_role() in ('super_admin','approver')
    or (get_my_role() = 'kitchen' and raised_by = auth.uid())
  );

-- Kitchen can raise flags
create policy "flags_insert" on flags
  for insert with check (get_my_role() in ('super_admin','kitchen'));

-- Approver and super_admin can resolve
create policy "flags_update" on flags
  for update using (get_my_role() in ('super_admin','approver'));

-- ── CONFIG ──
alter table config enable row level security;

create policy "config_read" on config
  for select using (auth.uid() is not null);

create policy "config_write" on config
  for all using (get_my_role() = 'super_admin');

-- ════════════════════════════════════════════════════════════════════════════
-- SEED DATA — EMPLOYEES
-- ════════════════════════════════════════════════════════════════════════════
insert into employees (name, group_name, status) values
  ('Osaramen Omoregie','Main Site','Active'),
  ('Confidence Fedo','Main Site','Active'),
  ('Abbey Joshua','Main Site','Active'),
  ('Charles Eta','Main Site','Active'),
  ('Kenneth Ilome','Main Site','Active'),
  ('Zorodzai Kamwanda','Main Site','Active'),
  ('Innocent Mlilo','Main Site','Active'),
  ('Yakubu Zubaru','Main Site','Active'),
  ('David Adekoya','Main Site','Active'),
  ('Samuel Wakshama','Main Site','Active'),
  ('Izzu Umeoniso','Main Site','Active'),
  ('Olaide Olatunde','Main Site','Active'),
  ('Kenneth Onyegbula','Main Site','Active'),
  ('David Igenewari','Main Site','Active'),
  ('Monday Akpan','Main Site','Active'),
  ('Barikeme Tigiri','Main Site','Active'),
  ('Alfa M. Omale','Main Site','Active'),
  ('Odion E','Main Site','Active'),
  ('Oris Osakwa','Main Site','Active'),
  ('Sam Victor','Main Site','Active'),
  ('Udor Etim','Main Site','Active'),
  ('Inwang Michael','Main Site','Active'),
  ('Thomas Idowu','Main Site','Active'),
  ('Crispen Katsande','Main Site','Active'),
  ('Lewis Karambwe','Main Site','Active'),
  ('Grabwell Fundira','Main Site','Active'),
  ('Tafara Chikuku','Main Site','Active'),
  ('Nyasha Ncube','Main Site','Active'),
  ('Arnold Bhero','Main Site','Active'),
  ('Obvious Ncube','Main Site','Active'),
  ('Farai Gonyora','Main Site','Active'),
  ('Thubelihle Sibanda','Main Site','Active'),
  ('Jojo Grospe','Main Site','Active'),
  ('Michael Tan','Main Site','Active'),
  ('Daniel De La Cruz','Main Site','Active'),
  ('Cornelio Gannawa','Main Site','Active'),
  ('Owen Mugadzikwa','Main Site','Active'),
  ('Gift Makuvire','Main Site','Active'),
  ('Archford Chakura','Main Site','Active'),
  ('Tendai Magadzire','Main Site','Active'),
  ('Glen D Lucas','Main Site','Active'),
  ('Ronald Mugabe','Main Site','Active'),
  ('Tinny Kamombe','Main Site','Active'),
  ('Marlon Chinyani','Main Site','Active'),
  ('Nimrod Ndlovu','Main Site','Active'),
  ('Lucious Chikara','Main Site','Active'),
  ('Piason Munkuli','Main Site','Active'),
  ('Clement Nyati','Main Site','Active'),
  ('Clarah Mashini','Main Site','Active'),
  ('Wendy Mpala','Main Site','Active'),
  ('Prudence Dube','Main Site','Active'),
  ('Prisca Mumpande','Main Site','Active'),
  ('Fungisai Herry','Main Site','Active'),
  ('Esther Nyoni','Main Site','Active'),
  ('Joseph Tshuma','Main Site','Active'),
  ('Mduduzi Sibanda','Main Site','Active'),
  ('Methembe Sibindi','Main Site','Active'),
  ('Vision Nyati','Main Site','Active'),
  ('Sinikiwe Mumpande','Main Site','Active'),
  ('Shepard Koreka','Main Site','Active'),
  ('Garikayi Mlinganiza','Main Site','Active'),
  ('Fopilen Kumelgance','Main Site','Active'),
  ('Godfrey Kasipo','Main Site','Active'),
  ('Shoko','Main Site','Active'),
  -- Manhattan group
  ('Elias Manjawu','Manhattan','Active'),
  ('Mollet Mbaisi','Manhattan','Active'),
  ('Leon Chigada','Manhattan','Active'),
  ('Laxon Maketo','Manhattan','Active'),
  ('Tapiwa Ndoro','Manhattan','Active'),
  ('Tafadzwa Mbaisi','Manhattan','Active'),
  ('Noel Matemera','Manhattan','Active'),
  ('Morgan Magama','Manhattan','Active'),
  ('Bright Chinoona','Manhattan','Active'),
  ('Amos Mafundikwa','Manhattan','Active'),
  ('Clive Sibanda','Manhattan','Active'),
  ('Fani Mbeve','Manhattan','Active'),
  ('Tapfumaneyi Matiza','Manhattan','Active'),
  ('Jotham Mahaso','Manhattan','Active'),
  ('Misheck Mariwo','Manhattan','Active'),
  ('Robson Mbofana','Manhattan','Active'),
  ('Beven Mavhura','Manhattan','Active'),
  ('Trevor Munemo','Manhattan','Active'),
  ('Chenjerai Makovere','Manhattan','Active'),
  ('Emmanuel Fedo','Manhattan','Active'),
  ('Takudzwa Dube','Manhattan','Active'),
  ('Wallace Savanhu','Manhattan','Active')
on conflict (name) do nothing;

-- ── Seed initial meal prices ──
insert into meal_prices (effective_date, breakfast_usd, lunch_usd, supper_usd, notes)
values ('2025-01-01', 3.50, 5.00, 4.50, 'Initial price schedule')
on conflict do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- VIEWS (useful for billing queries)
-- ════════════════════════════════════════════════════════════════════════════

-- Daily totals with cost
create or replace view daily_billing as
select
  ds.date,
  ds.status,
  count(ml.id) filter (where ml.had_breakfast) as breakfast_count,
  count(ml.id) filter (where ml.had_lunch)     as lunch_count,
  count(ml.id) filter (where ml.had_supper)    as supper_count,
  count(ml.id) filter (where ml.had_breakfast or ml.had_lunch or ml.had_supper) as total_meals,
  mp.breakfast_usd,
  mp.lunch_usd,
  mp.supper_usd,
  round(
    count(ml.id) filter (where ml.had_breakfast) * mp.breakfast_usd +
    count(ml.id) filter (where ml.had_lunch)     * mp.lunch_usd     +
    count(ml.id) filter (where ml.had_supper)    * mp.supper_usd,
    2
  ) as total_cost_usd
from daily_submissions ds
left join meal_logs ml on ml.submission_id = ds.id
left join lateral (
  select breakfast_usd, lunch_usd, supper_usd
  from meal_prices
  where effective_date <= ds.date
  order by effective_date desc
  limit 1
) mp on true
group by ds.date, ds.status, mp.breakfast_usd, mp.lunch_usd, mp.supper_usd;

-- ════════════════════════════════════════════════════════════════════════════
-- REALTIME — enable for live flag notifications
-- ════════════════════════════════════════════════════════════════════════════
-- Run in Supabase dashboard: Database → Replication → enable for:
--   public.flags
--   public.daily_submissions
-- (Cannot be done via SQL in free tier — do it via the dashboard)

-- ════════════════════════════════════════════════════════════════════════════
-- HOW TO CREATE AUTH USERS (run via Supabase Auth dashboard or this SQL)
-- ════════════════════════════════════════════════════════════════════════════
/*
  Use the Supabase dashboard:
  Authentication → Users → Invite / Create

  For each user, after creating in auth, run:

  UPDATE profiles SET
    username  = 'wendy',
    role      = 'super_admin',
    full_name = 'Wendy Mpala'
  WHERE id = '<uuid from auth.users>';

  Repeat for all 5 users with correct role values:
    super_admin | meal_officer | approver | kitchen | kitchen_owner

  Alternatively, use the service_role key in a server-side script to call
  supabase.auth.admin.createUser({ email, password, user_metadata: { username, role, full_name } })
  which will auto-fire the handle_new_user trigger.
*/
