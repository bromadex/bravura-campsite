-- 0186: Phase E — Fixed asset register.
--   * per-site document numbering (KAM-FA-2026-0001), reusable by any module (doc_next_number)
--   * asset categories with default depreciation (straight line / reducing balance)
--   * fixed assets, optionally linked 1:1 to a fleet asset (import from fleet)
--   * monthly depreciation run that posts to the ledger (event asset_depreciation)
--   * capitalisation and disposal postings, reclassification/transfer log
--   * physical verification counts (found / missing / condition)
-- Permissions: assets.view / create / edit / delete (dispose) / approve (post depreciation).

-- ── Per-site numbering ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_number_series (
  site_id  UUID NOT NULL REFERENCES sites(id),
  doc_type TEXT NOT NULL,
  year     INT  NOT NULL,
  last_no  INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, doc_type, year)
);
ALTER TABLE doc_number_series ENABLE ROW LEVEL SECURITY;  -- only reached through doc_next_number()

CREATE OR REPLACE FUNCTION doc_next_number(p_site_id UUID, p_doc_type TEXT, p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _code TEXT; _yr INT := EXTRACT(YEAR FROM COALESCE(p_date, CURRENT_DATE))::INT; _n INT;
BEGIN
  SELECT COALESCE(NULLIF(code, ''), UPPER(LEFT(name, 3))) INTO _code FROM sites WHERE id = p_site_id;
  IF _code IS NULL THEN RAISE EXCEPTION 'Unknown site'; END IF;
  INSERT INTO doc_number_series (site_id, doc_type, year, last_no) VALUES (p_site_id, UPPER(p_doc_type), _yr, 1)
  ON CONFLICT (site_id, doc_type, year) DO UPDATE SET last_no = doc_number_series.last_no + 1
  RETURNING last_no INTO _n;
  RETURN _code || '-' || UPPER(p_doc_type) || '-' || _yr || '-' || LPAD(_n::TEXT, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION doc_next_number(UUID, TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION doc_next_number(UUID, TEXT, DATE) TO authenticated;

-- ── Permissions ──────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description) VALUES
  ('assets.view',    'assets', 'View',    'See the fixed asset register'),
  ('assets.create',  'assets', 'Create',  'Add assets and record verification counts'),
  ('assets.edit',    'assets', 'Edit',    'Edit, reclassify and transfer assets'),
  ('assets.delete',  'assets', 'Delete',  'Dispose of or write off assets'),
  ('assets.approve', 'assets', 'Approve', 'Capitalise assets and post depreciation')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id FROM role_permissions rp
  JOIN permissions p  ON p.id = rp.permission_id AND p.code IN ('FI04', 'users.edit')
  JOIN permissions np ON np.code LIKE 'assets.%'
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = np.id);
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id FROM role_permissions rp
  JOIN permissions p  ON p.id = rp.permission_id AND p.code = 'fleet.edit'
  JOIN permissions np ON np.code IN ('assets.view', 'assets.create')
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = np.id);

-- ── Tables ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_categories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID NOT NULL REFERENCES sites(id),
  name                TEXT NOT NULL,
  method              TEXT NOT NULL DEFAULT 'straight_line' CHECK (method IN ('straight_line','reducing_balance')),
  useful_life_months  INT CHECK (useful_life_months > 0),
  rate_pct            NUMERIC(6,2) CHECK (rate_pct > 0),
  is_archived         BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID NOT NULL REFERENCES sites(id),
  asset_code           TEXT NOT NULL,
  name                 TEXT NOT NULL,
  category_id          UUID REFERENCES asset_categories(id),
  fleet_asset_id       UUID REFERENCES fleet_assets(id),
  serial_number        TEXT,
  location             TEXT,
  department_id        UUID,
  custodian_employee_id UUID REFERENCES employees(id),
  cost_centre_id       UUID REFERENCES cost_centres(id),
  project_id           UUID REFERENCES projects(id),
  acquisition_date     DATE,
  cost                 NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  salvage_value        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  method               TEXT NOT NULL DEFAULT 'straight_line' CHECK (method IN ('straight_line','reducing_balance')),
  useful_life_months   INT CHECK (useful_life_months > 0),
  rate_pct             NUMERIC(6,2),
  depreciation_start   DATE,
  accumulated_depreciation NUMERIC(15,2) NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','disposed','written_off')),
  capitalised_at       TIMESTAMPTZ,
  disposed_at          DATE,
  disposal_proceeds    NUMERIC(15,2),
  disposal_notes       TEXT,
  last_verified_at     TIMESTAMPTZ,
  last_condition       TEXT,
  notes                TEXT,
  is_archived          BOOLEAN NOT NULL DEFAULT false,
  created_by           UUID REFERENCES profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_code  ON fixed_assets (site_id, asset_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_fleet ON fixed_assets (fleet_asset_id) WHERE fleet_asset_id IS NOT NULL AND NOT is_archived;

CREATE TABLE IF NOT EXISTS asset_depreciation (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  asset_id         UUID NOT NULL REFERENCES fixed_assets(id),
  period           DATE NOT NULL,             -- first day of the month depreciated
  amount           NUMERIC(15,2) NOT NULL,
  accumulated_after NUMERIC(15,2) NOT NULL,
  book_value_after NUMERIC(15,2) NOT NULL,
  journal_id       UUID,
  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period)
);

CREATE TABLE IF NOT EXISTS asset_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id),
  asset_id    UUID NOT NULL REFERENCES fixed_assets(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('created','capitalised','reclassified','transferred','verified','disposed','written_off')),
  before      JSONB,
  after       JSONB,
  notes       TEXT,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by   UUID REFERENCES profiles(id),
  closed_at   TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS asset_verification_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id UUID NOT NULL REFERENCES asset_verifications(id),
  asset_id        UUID NOT NULL REFERENCES fixed_assets(id),
  found           BOOLEAN,
  condition       TEXT CHECK (condition IN ('good','fair','poor','damaged')),
  location_seen   TEXT,
  notes           TEXT,
  checked_by      UUID REFERENCES profiles(id),
  checked_at      TIMESTAMPTZ,
  UNIQUE (verification_id, asset_id)
);

-- ── RLS (meals pattern: permission + site checked server-side) ───────
ALTER TABLE asset_categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_depreciation       ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_movements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_verifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_verification_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ac_select ON asset_categories;  DROP POLICY IF EXISTS ac_write ON asset_categories;
CREATE POLICY ac_select ON asset_categories FOR SELECT USING (_has_permission('assets.view', site_id));
CREATE POLICY ac_write  ON asset_categories FOR ALL USING (_has_permission('assets.edit', site_id)) WITH CHECK (_has_permission('assets.edit', site_id));

DROP POLICY IF EXISTS fa_select ON fixed_assets; DROP POLICY IF EXISTS fa_insert ON fixed_assets; DROP POLICY IF EXISTS fa_update ON fixed_assets;
CREATE POLICY fa_select ON fixed_assets FOR SELECT USING (_has_permission('assets.view', site_id));
CREATE POLICY fa_insert ON fixed_assets FOR INSERT WITH CHECK (_has_permission('assets.create', site_id));
-- Financial fields of an active asset change only through the RPCs (trigger below).
CREATE POLICY fa_update ON fixed_assets FOR UPDATE USING (_has_permission('assets.edit', site_id)) WITH CHECK (_has_permission('assets.edit', site_id));

DROP POLICY IF EXISTS ad_select ON asset_depreciation;
CREATE POLICY ad_select ON asset_depreciation FOR SELECT USING (_has_permission('assets.view', site_id));
DROP POLICY IF EXISTS am_select ON asset_movements;
CREATE POLICY am_select ON asset_movements FOR SELECT USING (_has_permission('assets.view', site_id));
DROP POLICY IF EXISTS av_select ON asset_verifications;
CREATE POLICY av_select ON asset_verifications FOR SELECT USING (_has_permission('assets.view', site_id));
DROP POLICY IF EXISTS avi_select ON asset_verification_items;
CREATE POLICY avi_select ON asset_verification_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM asset_verifications v WHERE v.id = verification_id AND _has_permission('assets.view', v.site_id)));

-- Lock: once capitalised, cost/depreciation settings can't be edited directly.
CREATE OR REPLACE FUNCTION trg_fixed_assets_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.fa_rpc', true) = 'on' THEN NEW.updated_at := now(); RETURN NEW; END IF;
  IF OLD.status <> 'draft' AND (NEW.cost IS DISTINCT FROM OLD.cost OR NEW.salvage_value IS DISTINCT FROM OLD.salvage_value
      OR NEW.method IS DISTINCT FROM OLD.method OR NEW.useful_life_months IS DISTINCT FROM OLD.useful_life_months
      OR NEW.rate_pct IS DISTINCT FROM OLD.rate_pct OR NEW.depreciation_start IS DISTINCT FROM OLD.depreciation_start
      OR NEW.accumulated_depreciation IS DISTINCT FROM OLD.accumulated_depreciation OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.site_id IS DISTINCT FROM OLD.site_id) THEN
    RAISE EXCEPTION 'This asset is % — cost, depreciation and status change only through capitalise, depreciation or disposal', OLD.status;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.accumulated_depreciation IS DISTINCT FROM OLD.accumulated_depreciation THEN
    RAISE EXCEPTION 'Use capitalise, depreciation or disposal to change this';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fixed_assets_guard ON fixed_assets;
CREATE TRIGGER trg_fixed_assets_guard BEFORE UPDATE ON fixed_assets FOR EACH ROW EXECUTE FUNCTION trg_fixed_assets_guard();

-- Log field changes that matter (reclassify / transfer) automatically.
CREATE OR REPLACE FUNCTION trg_fixed_assets_log() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b JSONB := '{}'; _a JSONB := '{}'; _type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO asset_movements (site_id, asset_id, change_type, after, created_by)
    VALUES (NEW.site_id, NEW.id, 'created', jsonb_build_object('asset_code', NEW.asset_code, 'cost', NEW.cost), auth.uid());
    RETURN NEW;
  END IF;
  IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN _b := _b || jsonb_build_object('category_id', OLD.category_id); _a := _a || jsonb_build_object('category_id', NEW.category_id); _type := 'reclassified'; END IF;
  IF NEW.cost_centre_id IS DISTINCT FROM OLD.cost_centre_id THEN _b := _b || jsonb_build_object('cost_centre_id', OLD.cost_centre_id); _a := _a || jsonb_build_object('cost_centre_id', NEW.cost_centre_id); _type := 'reclassified'; END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN _b := _b || jsonb_build_object('project_id', OLD.project_id); _a := _a || jsonb_build_object('project_id', NEW.project_id); _type := 'reclassified'; END IF;
  IF NEW.location IS DISTINCT FROM OLD.location THEN _b := _b || jsonb_build_object('location', OLD.location); _a := _a || jsonb_build_object('location', NEW.location); _type := COALESCE(_type, 'transferred'); END IF;
  IF NEW.custodian_employee_id IS DISTINCT FROM OLD.custodian_employee_id THEN _b := _b || jsonb_build_object('custodian_employee_id', OLD.custodian_employee_id); _a := _a || jsonb_build_object('custodian_employee_id', NEW.custodian_employee_id); _type := COALESCE(_type, 'transferred'); END IF;
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN _b := _b || jsonb_build_object('department_id', OLD.department_id); _a := _a || jsonb_build_object('department_id', NEW.department_id); _type := COALESCE(_type, 'transferred'); END IF;
  IF _type IS NOT NULL THEN
    INSERT INTO asset_movements (site_id, asset_id, change_type, before, after, created_by) VALUES (NEW.site_id, NEW.id, _type, _b, _a, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fixed_assets_log ON fixed_assets;
CREATE TRIGGER trg_fixed_assets_log AFTER INSERT OR UPDATE ON fixed_assets FOR EACH ROW EXECUTE FUNCTION trg_fixed_assets_log();

-- ── RPCs ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fa_create_asset(p_site_id UUID, p_data JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID; _cat asset_categories%ROWTYPE;
BEGIN
  IF NOT _has_permission('assets.create', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to add assets'; END IF;
  IF COALESCE(TRIM(p_data->>'name'), '') = '' THEN RAISE EXCEPTION 'Give the asset a name'; END IF;
  SELECT * INTO _cat FROM asset_categories WHERE id = NULLIF(p_data->>'category_id', '')::uuid AND site_id = p_site_id;
  INSERT INTO fixed_assets (site_id, asset_code, name, category_id, fleet_asset_id, serial_number, location, department_id,
                            custodian_employee_id, cost_centre_id, project_id, acquisition_date, cost, salvage_value,
                            method, useful_life_months, rate_pct, depreciation_start, notes, created_by)
  VALUES (p_site_id, doc_next_number(p_site_id, 'FA', COALESCE(NULLIF(p_data->>'acquisition_date', '')::date, CURRENT_DATE)),
          TRIM(p_data->>'name'), _cat.id, NULLIF(p_data->>'fleet_asset_id', '')::uuid, NULLIF(p_data->>'serial_number', ''),
          NULLIF(p_data->>'location', ''), NULLIF(p_data->>'department_id', '')::uuid, NULLIF(p_data->>'custodian_employee_id', '')::uuid,
          NULLIF(p_data->>'cost_centre_id', '')::uuid, NULLIF(p_data->>'project_id', '')::uuid, NULLIF(p_data->>'acquisition_date', '')::date,
          COALESCE(NULLIF(p_data->>'cost', '')::numeric, 0), COALESCE(NULLIF(p_data->>'salvage_value', '')::numeric, 0),
          COALESCE(NULLIF(p_data->>'method', ''), _cat.method, 'straight_line'),
          COALESCE(NULLIF(p_data->>'useful_life_months', '')::int, _cat.useful_life_months),
          COALESCE(NULLIF(p_data->>'rate_pct', '')::numeric, _cat.rate_pct),
          NULLIF(p_data->>'depreciation_start', '')::date, NULLIF(p_data->>'notes', ''), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- One register entry per fleet asset that doesn't have one yet (draft — finance adds cost, then capitalises).
CREATE OR REPLACE FUNCTION fa_import_from_fleet(p_site_id UUID, p_category_id UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f RECORD; _n INT := 0;
BEGIN
  IF NOT _has_permission('assets.create', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to add assets'; END IF;
  FOR _f IN SELECT * FROM fleet_assets fa WHERE fa.site_id = p_site_id AND NOT COALESCE(fa.is_archived, false)
             AND NOT EXISTS (SELECT 1 FROM fixed_assets x WHERE x.fleet_asset_id = fa.id AND NOT x.is_archived) LOOP
    PERFORM fa_create_asset(p_site_id, jsonb_build_object(
      'name', TRIM(CONCAT_WS(' ', COALESCE(_f.fleet_number, _f.asset_number), _f.make, _f.model, NULLIF('(' || _f.registration || ')', '()'))),
      'category_id', p_category_id, 'fleet_asset_id', _f.id, 'serial_number', COALESCE(_f.serial_number, _f.vin),
      'location', _f.location, 'acquisition_date', _f.purchase_date, 'cost', _f.purchase_cost, 'salvage_value', _f.salvage_value));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

CREATE OR REPLACE FUNCTION fa_capitalise(p_asset_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a fixed_assets%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF NOT _has_permission('assets.approve', _a.site_id) THEN RAISE EXCEPTION 'You do not have permission to capitalise assets'; END IF;
  IF _a.status <> 'draft' THEN RAISE EXCEPTION 'This asset is already %', _a.status; END IF;
  IF _a.cost <= 0 THEN RAISE EXCEPTION 'Enter the asset''s cost first'; END IF;
  IF _a.acquisition_date IS NULL THEN RAISE EXCEPTION 'Enter the acquisition date first'; END IF;
  IF _a.method = 'straight_line' AND _a.useful_life_months IS NULL THEN RAISE EXCEPTION 'Enter the useful life (months)'; END IF;
  IF _a.method = 'reducing_balance' AND _a.rate_pct IS NULL THEN RAISE EXCEPTION 'Enter the annual depreciation rate'; END IF;
  IF _a.salvage_value > _a.cost THEN RAISE EXCEPTION 'Salvage value can''t exceed cost'; END IF;
  PERFORM set_config('app.fa_rpc', 'on', true);
  UPDATE fixed_assets SET status = 'active', capitalised_at = now(),
         depreciation_start = COALESCE(depreciation_start, date_trunc('month', acquisition_date)::date) WHERE id = p_asset_id;
  PERFORM set_config('app.fa_rpc', 'off', true);
  INSERT INTO asset_movements (site_id, asset_id, change_type, after, created_by)
  VALUES (_a.site_id, _a.id, 'capitalised', jsonb_build_object('cost', _a.cost), auth.uid());
  -- Only posts if finance mapped 'asset_capitalised' (e.g. Dr Fixed assets / Cr Asset clearing); purchases already
  -- posted through procurement shouldn't be mapped twice.
  PERFORM gl_auto_post(_a.site_id, 'asset_capitalised', 'fixed_assets', _a.id, _a.acquisition_date, _a.cost, 'Capitalised ' || _a.asset_code || ' ' || _a.name);
END;
$$;

CREATE OR REPLACE FUNCTION _fa_month_charge(_a fixed_assets) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(0, LEAST(
    ROUND(CASE WHEN _a.method = 'reducing_balance'
               THEN (_a.cost - _a.accumulated_depreciation) * COALESCE(_a.rate_pct, 0) / 100 / 12
               ELSE (_a.cost - _a.salvage_value) / NULLIF(_a.useful_life_months, 0) END, 2),
    _a.cost - _a.salvage_value - _a.accumulated_depreciation))
$$;

-- Depreciate every active asset for one month (idempotent per asset+month) and post each charge.
CREATE OR REPLACE FUNCTION fa_run_depreciation(p_site_id UUID, p_period DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p DATE := date_trunc('month', p_period)::date; _a fixed_assets%ROWTYPE; _amt NUMERIC; _row UUID;
        _n INT := 0; _total NUMERIC := 0; _je UUID;
BEGIN
  IF NOT _has_permission('assets.approve', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to post depreciation'; END IF;
  IF _p > date_trunc('month', CURRENT_DATE)::date THEN RAISE EXCEPTION 'You can''t depreciate a future month'; END IF;
  FOR _a IN SELECT * FROM fixed_assets WHERE site_id = p_site_id AND status = 'active' AND NOT is_archived
              AND depreciation_start <= _p AND NOT EXISTS (SELECT 1 FROM asset_depreciation d WHERE d.asset_id = fixed_assets.id AND d.period = _p)
              ORDER BY asset_code FOR UPDATE LOOP
    _amt := COALESCE(_fa_month_charge(_a), 0);
    IF _amt <= 0 THEN CONTINUE; END IF;
    INSERT INTO asset_depreciation (site_id, asset_id, period, amount, accumulated_after, book_value_after, created_by)
    VALUES (p_site_id, _a.id, _p, _amt, _a.accumulated_depreciation + _amt, _a.cost - _a.accumulated_depreciation - _amt, auth.uid())
    RETURNING id INTO _row;
    PERFORM set_config('app.fa_rpc', 'on', true);
    UPDATE fixed_assets SET accumulated_depreciation = accumulated_depreciation + _amt WHERE id = _a.id;
    PERFORM set_config('app.fa_rpc', 'off', true);
    _je := gl_auto_post(p_site_id, 'asset_depreciation', 'asset_depreciation', _row,
                        (_p + INTERVAL '1 month - 1 day')::date, _amt, 'Depreciation ' || to_char(_p, 'Mon YYYY') || ' — ' || _a.asset_code || ' ' || _a.name);
    UPDATE asset_depreciation SET journal_id = _je WHERE id = _row;
    _n := _n + 1; _total := _total + _amt;
  END LOOP;
  RETURN jsonb_build_object('assets', _n, 'total', _total, 'period', _p);
END;
$$;

CREATE OR REPLACE FUNCTION fa_dispose(p_asset_id UUID, p_date DATE, p_proceeds NUMERIC, p_write_off BOOLEAN, p_notes TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a fixed_assets%ROWTYPE; _book NUMERIC;
BEGIN
  SELECT * INTO _a FROM fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF NOT _has_permission('assets.delete', _a.site_id) THEN RAISE EXCEPTION 'You do not have permission to dispose of assets'; END IF;
  IF _a.status NOT IN ('active','draft') THEN RAISE EXCEPTION 'This asset is already %', replace(_a.status, '_', ' '); END IF;
  IF COALESCE(TRIM(p_notes), '') = '' THEN RAISE EXCEPTION 'Say why the asset is being disposed of'; END IF;
  _book := _a.cost - _a.accumulated_depreciation;
  PERFORM set_config('app.fa_rpc', 'on', true);
  UPDATE fixed_assets SET status = CASE WHEN p_write_off THEN 'written_off' ELSE 'disposed' END, disposed_at = COALESCE(p_date, CURRENT_DATE),
         disposal_proceeds = NULLIF(p_proceeds, 0), disposal_notes = TRIM(p_notes) WHERE id = p_asset_id;
  PERFORM set_config('app.fa_rpc', 'off', true);
  INSERT INTO asset_movements (site_id, asset_id, change_type, before, after, notes, created_by)
  VALUES (_a.site_id, _a.id, CASE WHEN p_write_off THEN 'written_off' ELSE 'disposed' END,
          jsonb_build_object('book_value', _book), jsonb_build_object('proceeds', COALESCE(p_proceeds, 0)), TRIM(p_notes), auth.uid());
  IF _a.status = 'active' THEN
    -- Clear accumulated depreciation against cost, write off the remaining book value, record any scrap proceeds.
    PERFORM gl_auto_post(_a.site_id, 'asset_disposal_accum', 'fixed_assets', _a.id, COALESCE(p_date, CURRENT_DATE), _a.accumulated_depreciation, 'Disposal ' || _a.asset_code || ' — accumulated depreciation');
    PERFORM gl_auto_post(_a.site_id, 'asset_disposal_loss', 'fixed_assets', _a.id, COALESCE(p_date, CURRENT_DATE), _book, 'Disposal ' || _a.asset_code || ' — book value written off');
    PERFORM gl_auto_post(_a.site_id, 'asset_disposal_proceeds', 'fixed_assets', _a.id, COALESCE(p_date, CURRENT_DATE), p_proceeds, 'Disposal ' || _a.asset_code || ' — proceeds');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fa_start_verification(p_site_id UUID, p_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID;
BEGIN
  IF NOT _has_permission('assets.create', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to run asset counts'; END IF;
  IF EXISTS (SELECT 1 FROM asset_verifications WHERE site_id = p_site_id AND status = 'open') THEN RAISE EXCEPTION 'Finish the open asset count first'; END IF;
  INSERT INTO asset_verifications (site_id, name, created_by) VALUES (p_site_id, COALESCE(NULLIF(TRIM(p_name), ''), 'Asset count ' || to_char(CURRENT_DATE, 'DD Mon YYYY')), auth.uid())
  RETURNING id INTO _id;
  INSERT INTO asset_verification_items (verification_id, asset_id)
  SELECT _id, id FROM fixed_assets WHERE site_id = p_site_id AND status IN ('active','draft') AND NOT is_archived;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION fa_verify_item(p_item_id UUID, p_found BOOLEAN, p_condition TEXT, p_location TEXT, p_notes TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v asset_verifications%ROWTYPE;
BEGIN
  SELECT v.* INTO _v FROM asset_verification_items i JOIN asset_verifications v ON v.id = i.verification_id WHERE i.id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF NOT _has_permission('assets.create', _v.site_id) THEN RAISE EXCEPTION 'You do not have permission to run asset counts'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'This count is closed'; END IF;
  UPDATE asset_verification_items SET found = p_found, condition = CASE WHEN p_found THEN NULLIF(p_condition, '') END,
         location_seen = NULLIF(TRIM(p_location), ''), notes = NULLIF(TRIM(p_notes), ''), checked_by = auth.uid(), checked_at = now()
   WHERE id = p_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION fa_close_verification(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v asset_verifications%ROWTYPE; _found INT; _missing INT; _unchecked INT;
BEGIN
  SELECT * INTO _v FROM asset_verifications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF NOT _has_permission('assets.edit', _v.site_id) THEN RAISE EXCEPTION 'You do not have permission to close asset counts'; END IF;
  IF _v.status <> 'open' THEN RAISE EXCEPTION 'Already closed'; END IF;
  SELECT COUNT(*) FILTER (WHERE x.found), COUNT(*) FILTER (WHERE x.found = false), COUNT(*) FILTER (WHERE x.found IS NULL)
    INTO _found, _missing, _unchecked FROM asset_verification_items x WHERE x.verification_id = p_id;
  UPDATE asset_verifications SET status = 'closed', closed_by = auth.uid(), closed_at = now() WHERE id = p_id;
  PERFORM set_config('app.fa_rpc', 'on', true);
  UPDATE fixed_assets a SET last_verified_at = i.checked_at, last_condition = i.condition,
         location = COALESCE(i.location_seen, a.location)
    FROM asset_verification_items i WHERE i.verification_id = p_id AND i.asset_id = a.id AND i.found;
  PERFORM set_config('app.fa_rpc', 'off', true);
  INSERT INTO asset_movements (site_id, asset_id, change_type, after, notes, created_by)
  SELECT _v.site_id, i.asset_id, 'verified', jsonb_build_object('found', i.found, 'condition', i.condition), _v.name, auth.uid()
    FROM asset_verification_items i WHERE i.verification_id = p_id AND i.found IS NOT NULL;
  IF _missing > 0 THEN
    PERFORM _notify_permission(_v.site_id, 'assets.delete', 'asset_missing', _missing || ' asset(s) not found in ' || _v.name,
      'Investigate, then write off anything confirmed lost.', '/finance/fi_asset_verification', 'escalation');
  END IF;
  RETURN jsonb_build_object('found', _found, 'missing', _missing, 'unchecked', _unchecked);
END;
$$;

REVOKE ALL ON FUNCTION fa_create_asset(UUID, JSONB), fa_import_from_fleet(UUID, UUID), fa_capitalise(UUID), fa_run_depreciation(UUID, DATE),
  fa_dispose(UUID, DATE, NUMERIC, BOOLEAN, TEXT), fa_start_verification(UUID, TEXT), fa_verify_item(UUID, BOOLEAN, TEXT, TEXT, TEXT),
  fa_close_verification(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fa_create_asset(UUID, JSONB), fa_import_from_fleet(UUID, UUID), fa_capitalise(UUID), fa_run_depreciation(UUID, DATE),
  fa_dispose(UUID, DATE, NUMERIC, BOOLEAN, TEXT), fa_start_verification(UUID, TEXT), fa_verify_item(UUID, BOOLEAN, TEXT, TEXT, TEXT),
  fa_close_verification(UUID) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0186_fixed_assets.sql') ON CONFLICT DO NOTHING;
