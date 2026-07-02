-- ── Import Kamativi fuel deliveries + dip readings from old ERP ──────────────
-- Phase 2a: 4 deliveries + 35 dipstick observations against the ZUFTA10 tank.
-- All historical — the tank_level trigger is bypassed for this import so the
-- current level is not shifted around by legacy events. Idempotent —
-- transaction_number and (tank_id, reading_date, reading_litres) are
-- checked before insert.

BEGIN;

-- Bypass fuel_update_tank_level and any other triggers on target tables
-- (SET session_replication_role requires superuser; migrations satisfy that).
SET session_replication_role = 'replica';

DO $$
DECLARE
  v_site_id   uuid;
  v_tank_id   uuid;
BEGIN
  SELECT id INTO v_site_id FROM sites WHERE lower(name) = 'kamativi' LIMIT 1;
  IF v_site_id IS NULL THEN RAISE EXCEPTION 'Kamativi site not found.'; END IF;

  SELECT id INTO v_tank_id FROM fuel_tanks
   WHERE site_id = v_site_id AND (code = 'ZUFTA10' OR upper(name) = 'MAIN TANK')
   LIMIT 1;
  IF v_tank_id IS NULL THEN RAISE EXCEPTION 'ZUFTA10 tank not found at Kamativi.'; END IF;

  -- ── 4 fuel deliveries ────────────────────────────────────────────────
  INSERT INTO fuel_transactions (
    site_id, transaction_number, transaction_date, tank_id,
    transaction_type, litres, supplier, notes)
  SELECT v_site_id, r.txn, r.date::date, v_tank_id,
         'delivery', r.litres::numeric, r.supplier,
         format('Legacy delivery %s', r.legacy_id)
    FROM (VALUES
      ('mo8fhkeihe8id', 'FD-2026-04-17-01', '2026-04-17', 10000, 'RAM Petroleum'),
      ('movachbcuhzkj', 'FD-2026-05-07-01', '2026-05-07', 10000, 'RAM Petroleum'),
      ('mp7znduwwb7ws', 'FD-2026-05-15-01', '2026-05-15', 10000, 'Zuva'),
      ('mppe8qfmae5os', 'FD-2026-05-27-01', '2026-05-27', 10000, 'Zuva')
    ) AS r(legacy_id, txn, date, litres, supplier)
   WHERE NOT EXISTS (
     SELECT 1 FROM fuel_transactions ft
      WHERE ft.site_id = v_site_id AND ft.transaction_number = r.txn
   );

  -- ── 35 dipstick observations → fuel_dip_readings ─────────────────────
  -- fuel_end is the level after the shift; that's the observed value.
  -- Skip rows we've already seeded (dedup by tank+date+litres).
  -- Live column names are level_litres + dip_mm + read_by (the 0020
  -- migration file documented pre-shipping names — the running schema
  -- matches what DipReadings.jsx inserts).
  -- read_by is a uuid FK to profiles(id); legacy rows only have free-text
  -- names, so we keep the name in the notes instead of the FK column.
  INSERT INTO fuel_dip_readings (
    site_id, tank_id, reading_date, dip_mm, level_litres, notes)
  SELECT v_site_id, v_tank_id, r.date::date,
         (r.dip_end::numeric * 1000)::numeric,
         r.fuel_end::numeric,
         format('Imported legacy %s (dip %s→%s m, fuel %s→%s L%s)',
                r.legacy_id, r.dip_start, r.dip_end,
                r.fuel_start, r.fuel_end,
                CASE WHEN COALESCE(r.done_by,'') <> ''
                     THEN ', done by ' || r.done_by
                     ELSE '' END)
    FROM (VALUES
      ('12e19281-431c-4a29-8bff-4e5ee6c78d7c', '2026-05-24', '0.52', '0.51', '2087', '2031', 'Clement Mpala'),
      ('4fb4e37a-5c03-4e25-a873-c4b0e5b30350', '2026-05-15', '0.48', '0.05', '1865', '67',   'Wendy T. Mpala'),
      ('9dc5ebd8-62be-4899-9e66-e46b6308d54e', '2026-05-26', '0.51', '0.42', '2031', '1542', 'Nyasha Ncube'),
      ('a192846a-03df-4f51-86fd-d293cfcf6772', '2026-05-27', '0.42', '0.22', '1542', '605',  'Obvious Ncube'),
      ('ac381241-fec0-4b4f-b96b-2436b0714556', '2026-05-05', '0.22', '0.21', '605',  '565',  'Wendy T. Mpala'),
      ('e9a6450d-b251-4c4c-8b4a-0a15fd7172e3', '2026-05-27', '0.22', '0.045','605',  '57',   'Obvious Ncube'),
      ('ed3132e1-feb9-45bc-b446-4e99f103b695', '2026-05-27', '0.045','2',    '57',   '10103','Obvious Ncube'),
      ('f671f4ef-3ace-449c-9069-f493a11c5d41', '2026-05-28', '2',    '1.65', '10103','8916', 'Obvious Ncube'),
      ('mo9ote3go5881', '2026-04-22', '1.26', '1.12', '6705', '5822', ''),
      ('mob7uzkvy1zvn', '2026-04-23', '1.12', '1.04', '5822', '5309', ''),
      ('mock5xnv4542r', '2026-04-24', '1.04', '0.96', '5309', '4794', 'Wendy Thandeka Mpala'),
      ('mocmz61kunbv4', '2026-04-24', '0.96', '0.92', '4794', '4538', ''),
      ('mogwmv67rethv', '2026-04-25', '0.96', '0.88', '4794', '4282', ''),
      ('moh0yyfol2whr', '2026-04-27', '0.88', '0.74', '4282', '3398', 'Wendy Thandeka Mpala'),
      ('moieed15wrwaw', '2026-04-28', '0.74', '0.59', '3398', '2490', 'Wendy Thandeka Mpala'),
      ('mol9bz0x4spqx', '2026-04-29', '0.59', '0.44', '2490', '1648', 'Wendy Thandeka Mpala'),
      ('mol9fwesurgic', '2026-04-30', '0.44', '0.38', '1648', '1337', 'Wendy Thandeka Mpala'),
      ('momlo0ldfeekc', '2026-05-01', '0.38', '0.33', '1337', '1091', 'Wendy Thandeka Mpala'),
      ('moscusyntjsmv', '2026-05-04', '0.33', '0.22', '1091', '605',  'Wendy Thandeka Mpala'),
      ('mova73atenucd', '2026-05-07', '0.21', '0.09', '565',  '162',  ''),
      ('movak263610th', '2026-05-07', '0.09', '0.05', '162',  '67',   'Wendy Thandeka Mpala'),
      ('movf1piy1jfzp', '2026-05-07', '1.96', '1.62', '10055','8767', ''),
      ('mp0w17pe80lm3', '2026-05-11', '0.95', '0.79', '4730', '3711', ''),
      ('mp2k61lcxtvpp', '2026-05-12', '0.79', '0.65', '3711', '2847', 'Wendy Thandeka Mpala'),
      ('mp3s4os6hfuj4', '2026-05-13', '0.79', '0.48', '3711', '1865', 'Wendy Thandeka Mpala'),
      ('mp803hupr6f1o', '2026-05-16', '1.79', '1.72', '9539', '9244', 'Wendy Thandeka Mpala'),
      ('mpb9emodajcyr', '2026-05-18', '1.72', '1.42', '9244', '7671', 'Wendy Thandeka Mpala'),
      ('mpcec8k39142o', '2026-05-19', '1.41', '1.11', '7613', '5758', ''),
      ('mpfalddh1eh9r', '2026-05-20', '1.11', '0.89', '5758', '4346', 'Wendy SuperAdmin'),
      ('mpfalxo7kbync', '2026-05-21', '0.89', '0.77', '4346', '3585', 'Wendy SuperAdmin'),
      ('mpgnddj8w6xlo', '2026-05-22', '0.76', '0.58', '3523', '2432', 'Wendy SuperAdmin'),
      ('mpwl1734c16wc', '2026-06-02', '1.18', '1.14', '6203', '5949', 'Wendy Thandeka Mpala'),
      ('mq99bvlrulyie', '2026-06-10', '0.32', '0.18', '1043', '450',  'Wendy Thandeka Mpala'),
      ('mq99cshuzrx9t', '2026-06-11', '0.18', '0.11', '450',  '218',  'Wendy Thandeka Mpala'),
      ('mqi2euw0w42yb', '2026-06-17', '1.33', '1.21', '7135', '6392', 'Wendy SuperAdmin')
    ) AS r(legacy_id, date, dip_start, dip_end, fuel_start, fuel_end, done_by)
   WHERE NOT EXISTS (
     SELECT 1 FROM fuel_dip_readings d
      WHERE d.tank_id = v_tank_id
        AND d.reading_date = r.date::date
        AND d.level_litres = r.fuel_end::numeric
   );

  -- Sync tank fields to the latest dipstick reading so the dashboard shows
  -- the true current level rather than something the trigger would have
  -- computed from historical issuances/deliveries.
  UPDATE fuel_tanks SET
    current_level_litres = 6392,
    last_dip_date        = '2026-06-17',
    last_dip_reading     = 6392,
    updated_at           = NOW()
   WHERE id = v_tank_id;
END $$;

SET session_replication_role = 'origin';

COMMIT;
