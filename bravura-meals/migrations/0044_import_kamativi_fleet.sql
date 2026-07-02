-- ── Import Kamativi fleet + heavy equipment + generators from old ERP ──────
-- 39 rows from the old `fleet` table (matched to `fleet_asset_tco` for the
-- asset_code), classified as either a vehicle, heavy equipment, or a
-- generator. Dedup'd by legacy_id.
--
-- Idempotent — uses NOT EXISTS guards keyed on legacy_id.

BEGIN;

DO $$
DECLARE
  v_site_id     uuid;
  v_fuel_type   uuid;
BEGIN
  SELECT id INTO v_site_id FROM sites WHERE lower(name) = 'kamativi' LIMIT 1;
  IF v_site_id IS NULL THEN RAISE EXCEPTION 'Kamativi site not found.'; END IF;

  SELECT id INTO v_fuel_type FROM fuel_types
   WHERE upper(code) = 'DIESEL' OR upper(name) = 'DIESEL' LIMIT 1;
  IF v_fuel_type IS NULL THEN RAISE EXCEPTION 'Diesel fuel type not found.'; END IF;

  -- ── Vehicles ───────────────────────────────────────────────────────────
  INSERT INTO fuel_vehicles (
    site_id, fleet_number, registration, description, vehicle_type,
    fuel_type_id, status, legacy_id, asset_code
  )
  SELECT v_site_id, r.asset_code, r.registration, r.description, r.vehicle_type,
         v_fuel_type, 'active', r.legacy_id, r.asset_code
    FROM (VALUES
      ('FL-2026-00001', 'AFG 6015',        'TOYOTA HILUX GD6',              'Pool Car',     'mnyy3n8uzgorq'),
      ('FL-2026-00004', 'AGL 1839',        'Mixer truck 1',                 'Mixer Truck',  'mo77s0kk63zl8'),
      ('FL-2026-00006', 'AGL 1869',        'Mixer truck 2',                 'Mixer Truck',  'mo77si5vahc4x'),
      ('FL-2026-00009', 'AFG 6016',        'AFG 6016',                      'Pool Car',     'mo8emr6u3sees'),
      ('FL-2026-00011', 'AHA 0708',        'Tipper truck',                  'Tipper',       'mo8ewi76nrgue'),
      ('FL-2026-00012', 'AGL 1471',        'Tipper truck',                  'Tipper',       'mo8ez88zc4i6r'),
      ('FL-2026-00016', 'AFG 5167',        'Land Cruiser',                  'Pool Car',     'mo8faw0r8thdo'),
      ('FL-2026-00017', 'AFU 0031',        'HILUX GD6',                     'Pool Car',     'mo9owxmqqlsh3'),
      ('FL-2026-00024', 'WATERBOSWER',     'Shacman water bowser',          'Water Bowser', 'mock98nzmpl2c'),
      ('FL-2026-00025', 'AFQ5017',         'BUS',                           'Bus',          'mocn1b74xdxaq'),
      ('FL-2026-00027', 'AGJ 1474',        'Low bed truck',                 'Low Bed',      'mol7553414yuz'),
      ('FL-2026-00028', 'AFX 2509',        'Personal car',                  'Personal',     'mol75rlyeow8f'),
      ('FL-2026-00030', 'AGL 1870',        'Mixer truck 3',                 'Mixer Truck',  'moveshqz4q4h8'),
      ('FL-2026-00032', 'AGL0806',         'Tipper truck',                  'Tipper',       'mowooxp7xinyn'),
      ('FL-2026-00034', 'AFX2513',         'Personal car',                  'Personal',     'mp5frirk48454'),
      ('FL-2026-00035', 'AFG 6014',        'Land Cruiser',                  'Pool Car',     'mpb9bbcxcyf7r'),
      ('FL-2026-00037', 'AFR4646',         'Land Cruiser',                  'Pool Car',     'mpduivsg49dz9'),
      ('FL-2026-00039', 'AGL4053',         'Executive car',                 'Executive',    'mqi2i4733g3mw'),
      ('FL-2026-00040', 'AFQ0471',         'Executive car',                 'Executive',    'mqi2j2p0hvual')
    ) AS r(asset_code, registration, description, vehicle_type, legacy_id)
   WHERE NOT EXISTS (
     SELECT 1 FROM fuel_vehicles v WHERE v.legacy_id = r.legacy_id
   );

  -- ── Heavy equipment ────────────────────────────────────────────────────
  INSERT INTO fuel_equipment (
    site_id, equipment_number, name, equipment_type,
    fuel_type_id, status,
    legacy_id, asset_code, description, registration
  )
  SELECT v_site_id, r.asset_code, r.name, r.equipment_type,
         v_fuel_type, 'active',
         r.legacy_id, r.asset_code, r.description, r.registration
    FROM (VALUES
      ('FL-2026-00003', 'HIRED EXCAVATOR',        'Excavator',  'Hired excavator',       'HIRED EXCAVATOR',        'mnzqo2detdtbx'),
      ('FL-2026-00007', 'ADT-1',                  'ADT',        'ADT 1',                 'ADT1',                   'mo77t39x8bemw'),
      ('FL-2026-00008', 'BULLDOZER',              'Bulldozer',  'D8R Bulldozer',         'BULLDOZER',              'mo77uaksa06dw'),
      ('FL-2026-00013', 'ADT-2',                  'ADT',        'Dumptruck',             'ADT 1',                  'mo8f3x0ozeusm'),
      ('FL-2026-00014', '25 TONNE CRANE',         'Crane',      '25 tonne crane',        '25 TONNE CRANE',         'mo8f6nc2g3ew6'),
      ('FL-2026-00015', '50 TONNE CRANE',         'Crane',      '50 tonne crane',        '50 TONNE CRANE',         'mo8f75mlgw87s'),
      ('FL-2026-00018', 'HIRED TLB',              'TLB',        'Case TLB',              'HIRED TLB',              'mo9p4vsqb9hwi'),
      ('FL-2026-00019', 'BOBCAT',                 'Bobcat',     'Bobcat',                'BOBCAT',                 'mo9p8ioize4v0'),
      ('FL-2026-00021', 'SMOOTH ROLLER COMPACTOR','Compactor',  'Smooth roller compactor','SMOOTH ROLER COMPACTOR','mo9q2dzjilj9r'),
      ('FL-2026-00026', 'MOBILE CRANE',           'Crane',      'Mobile crane',          'MOBILE CRANE',           'moie61p2zp7gs'),
      ('FL-2026-00031', 'DRILL RIG',              'Drill Rig',  'Rig',                   'DRILL RIG',              'mowoo6o4wj2c6'),
      ('FL-2026-00033', 'ADT-3',                  'ADT',        'Dumptruck',             'ADT3',                   'mp0zom00hcowt'),
      ('FL-2026-00036', 'COMPACTOR',              'Compactor',  'Smooth roller',         'COMPACTOR',              'mpb9bza8itf8v'),
      ('FL-2026-00038', 'GRADER',                 'Grader',     'Grader',                'GRADER',                 'mppeir3e2ut6d')
    ) AS r(asset_code, name, equipment_type, description, registration, legacy_id)
   WHERE NOT EXISTS (
     SELECT 1 FROM fuel_equipment e WHERE e.legacy_id = r.legacy_id
   );

  -- ── Generators (fuel_equipment with equipment_type = 'Generator') ──────
  INSERT INTO fuel_equipment (
    site_id, equipment_number, name, equipment_type,
    fuel_type_id, status,
    legacy_id, asset_code, description
  )
  SELECT v_site_id, r.asset_code, r.name, 'Generator',
         v_fuel_type, 'active',
         r.legacy_id, r.asset_code, r.description
    FROM (VALUES
      ('FL-2026-00002', 'BUNDU DIESEL GENERATOR', 'Plant area generator',   'mnzqnf5q446bv'),
      ('FL-2026-00010', 'CAMPSITE GENERATOR',     'Campsite generator',     'mo8eskofb71i1'),
      ('FL-2026-00023', 'BATCH PLANT GENERATOR',  'CAT generator',          'mock8sbwqpbpm'),
      ('FL-2026-00029', 'WORKSHOP GENERATOR',     'Workshop generator',     'moscxt1x79jt4')
    ) AS r(asset_code, name, description, legacy_id)
   WHERE NOT EXISTS (
     SELECT 1 FROM fuel_equipment e WHERE e.legacy_id = r.legacy_id
   );
END $$;

COMMIT;
