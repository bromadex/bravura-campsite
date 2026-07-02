-- ── Selous Main Tank + full dip calibration chart ────────────────────────────
-- Above-ground diesel tank at the Selous site.
--   Depth (max chart reading):  1 780 mm
--   Total volume (at max dip):   9 095 L
--   Dip chart resolution:        10 mm steps (179 points)
--
-- Idempotent — safe to re-run; upserts calibration rows on (tank_id, dip_mm).

BEGIN;

-- Diesel fuel_type exists after migration 0041; add a fallback insert
-- just in case this migration is applied stand-alone in a fresh project.
INSERT INTO fuel_types (name, code)
SELECT 'Diesel', 'DIESEL'
WHERE NOT EXISTS (SELECT 1 FROM fuel_types WHERE upper(code) = 'DIESEL' OR upper(name) = 'DIESEL');

DO $$
DECLARE
  v_site_id   uuid;
  v_fuel_type uuid;
  v_tank_id   uuid;
BEGIN
  SELECT id INTO v_site_id FROM sites WHERE lower(name) = 'selous' LIMIT 1;
  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Selous site not found. Add the site first.';
  END IF;

  SELECT id INTO v_fuel_type
    FROM fuel_types
   WHERE upper(code) = 'DIESEL' OR upper(name) = 'DIESEL'
   LIMIT 1;
  IF v_fuel_type IS NULL THEN
    RAISE EXCEPTION 'Diesel fuel type not found.';
  END IF;

  SELECT id INTO v_tank_id
    FROM fuel_tanks
   WHERE site_id = v_site_id AND (code = 'SEL-MAIN' OR upper(name) = 'MAIN TANK')
   LIMIT 1;

  IF v_tank_id IS NULL THEN
    INSERT INTO fuel_tanks (
      site_id, name, code, tank_type, fuel_type_id,
      capacity_litres, min_threshold_percent,
      location_description, status
    ) VALUES (
      v_site_id,
      'Main Tank',
      'SEL-MAIN',
      'above_ground',
      v_fuel_type,
      9095,
      20,
      'Selous main yard — above-ground diesel tank (9 095 L)',
      'active'
    )
    RETURNING id INTO v_tank_id;
  ELSE
    UPDATE fuel_tanks
       SET capacity_litres = 9095,
           fuel_type_id    = v_fuel_type,
           tank_type       = 'above_ground'
     WHERE id = v_tank_id;
  END IF;

  -- ── Full 0-1780 mm Selous dip chart (10 mm steps) ─────────────────────
  INSERT INTO tank_calibrations (tank_id, dip_mm, level_litres)
  VALUES
    (v_tank_id,    0,    0), (v_tank_id,   10,    7), (v_tank_id,   20,   19),
    (v_tank_id,   30,   34), (v_tank_id,   40,   52), (v_tank_id,   50,   72),
    (v_tank_id,   60,   95), (v_tank_id,   70,  119), (v_tank_id,   80,  145),
    (v_tank_id,   90,  173), (v_tank_id,  100,  202), (v_tank_id,  110,  232),
    (v_tank_id,  120,  264), (v_tank_id,  130,  297), (v_tank_id,  140,  332),
    (v_tank_id,  150,  367), (v_tank_id,  160,  404), (v_tank_id,  170,  441),
    (v_tank_id,  180,  480), (v_tank_id,  190,  519), (v_tank_id,  200,  560),
    (v_tank_id,  210,  601), (v_tank_id,  220,  643), (v_tank_id,  230,  686),
    (v_tank_id,  240,  730), (v_tank_id,  250,  775), (v_tank_id,  260,  820),
    (v_tank_id,  270,  867), (v_tank_id,  280,  913), (v_tank_id,  290,  961),
    (v_tank_id,  300, 1009), (v_tank_id,  310, 1058), (v_tank_id,  320, 1107),
    (v_tank_id,  330, 1158), (v_tank_id,  340, 1208), (v_tank_id,  350, 1259),
    (v_tank_id,  360, 1311), (v_tank_id,  370, 1364), (v_tank_id,  380, 1416),
    (v_tank_id,  390, 1470), (v_tank_id,  400, 1524), (v_tank_id,  410, 1578),
    (v_tank_id,  420, 1633), (v_tank_id,  430, 1688), (v_tank_id,  440, 1744),
    (v_tank_id,  450, 1800), (v_tank_id,  460, 1857), (v_tank_id,  470, 1913),
    (v_tank_id,  480, 1971), (v_tank_id,  490, 2029), (v_tank_id,  500, 2087),
    (v_tank_id,  510, 2145), (v_tank_id,  520, 2204), (v_tank_id,  530, 2263),
    (v_tank_id,  540, 2322), (v_tank_id,  550, 2382), (v_tank_id,  560, 2442),
    (v_tank_id,  570, 2503), (v_tank_id,  580, 2563), (v_tank_id,  590, 2624),
    (v_tank_id,  600, 2685), (v_tank_id,  610, 2747), (v_tank_id,  620, 2808),
    (v_tank_id,  630, 2870), (v_tank_id,  640, 2932), (v_tank_id,  650, 2995),
    (v_tank_id,  660, 3057), (v_tank_id,  670, 3120), (v_tank_id,  680, 3183),
    (v_tank_id,  690, 3246), (v_tank_id,  700, 3309), (v_tank_id,  710, 3373),
    (v_tank_id,  720, 3436), (v_tank_id,  730, 3500), (v_tank_id,  740, 3564),
    (v_tank_id,  750, 3628), (v_tank_id,  760, 3692), (v_tank_id,  770, 3756),
    (v_tank_id,  780, 3821), (v_tank_id,  790, 3885), (v_tank_id,  800, 3950),
    (v_tank_id,  810, 4014), (v_tank_id,  820, 4079), (v_tank_id,  830, 4144),
    (v_tank_id,  840, 4208), (v_tank_id,  850, 4273), (v_tank_id,  860, 4338),
    (v_tank_id,  870, 4403), (v_tank_id,  880, 4468), (v_tank_id,  890, 4532),
    (v_tank_id,  900, 4597), (v_tank_id,  910, 4662), (v_tank_id,  920, 4727),
    (v_tank_id,  930, 4792), (v_tank_id,  940, 4857), (v_tank_id,  950, 4922),
    (v_tank_id,  960, 4986), (v_tank_id,  970, 5051), (v_tank_id,  980, 5116),
    (v_tank_id,  990, 5180), (v_tank_id, 1000, 5245), (v_tank_id, 1010, 5309),
    (v_tank_id, 1020, 5373), (v_tank_id, 1030, 5437), (v_tank_id, 1040, 5501),
    (v_tank_id, 1050, 5565), (v_tank_id, 1060, 5629), (v_tank_id, 1070, 5693),
    (v_tank_id, 1080, 5756), (v_tank_id, 1090, 5820), (v_tank_id, 1100, 5883),
    (v_tank_id, 1110, 5946), (v_tank_id, 1120, 6009), (v_tank_id, 1130, 6071),
    (v_tank_id, 1140, 6134), (v_tank_id, 1150, 6196), (v_tank_id, 1160, 6258),
    (v_tank_id, 1170, 6320), (v_tank_id, 1180, 6381), (v_tank_id, 1190, 6443),
    (v_tank_id, 1200, 6504), (v_tank_id, 1210, 6564), (v_tank_id, 1220, 6625),
    (v_tank_id, 1230, 6685), (v_tank_id, 1240, 6745), (v_tank_id, 1250, 6805),
    (v_tank_id, 1260, 6864), (v_tank_id, 1270, 6923), (v_tank_id, 1280, 6982),
    (v_tank_id, 1290, 7040), (v_tank_id, 1300, 7098), (v_tank_id, 1310, 7155),
    (v_tank_id, 1320, 7212), (v_tank_id, 1330, 7269), (v_tank_id, 1340, 7326),
    (v_tank_id, 1350, 7382), (v_tank_id, 1360, 7437), (v_tank_id, 1370, 7492),
    (v_tank_id, 1380, 7547), (v_tank_id, 1390, 7601), (v_tank_id, 1400, 7654),
    (v_tank_id, 1410, 7707), (v_tank_id, 1420, 7760), (v_tank_id, 1430, 7812),
    (v_tank_id, 1440, 7864), (v_tank_id, 1450, 7915), (v_tank_id, 1460, 7965),
    (v_tank_id, 1470, 8015), (v_tank_id, 1480, 8064), (v_tank_id, 1490, 8112),
    (v_tank_id, 1500, 8160), (v_tank_id, 1510, 8208), (v_tank_id, 1520, 8254),
    (v_tank_id, 1530, 8300), (v_tank_id, 1540, 8345), (v_tank_id, 1550, 8389),
    (v_tank_id, 1560, 8433), (v_tank_id, 1570, 8475), (v_tank_id, 1580, 8517),
    (v_tank_id, 1590, 8558), (v_tank_id, 1600, 8598), (v_tank_id, 1610, 8637),
    (v_tank_id, 1620, 8675), (v_tank_id, 1630, 8712), (v_tank_id, 1640, 8748),
    (v_tank_id, 1650, 8783), (v_tank_id, 1660, 8817), (v_tank_id, 1670, 8849),
    (v_tank_id, 1680, 8881), (v_tank_id, 1690, 8910), (v_tank_id, 1700, 8939),
    (v_tank_id, 1710, 8966), (v_tank_id, 1720, 8991), (v_tank_id, 1730, 9014),
    (v_tank_id, 1740, 9036), (v_tank_id, 1750, 9055), (v_tank_id, 1760, 9071),
    (v_tank_id, 1770, 9085), (v_tank_id, 1780, 9095)
  ON CONFLICT (tank_id, dip_mm) DO UPDATE
    SET level_litres = EXCLUDED.level_litres;
END $$;

COMMIT;
