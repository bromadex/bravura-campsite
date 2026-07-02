-- ── Kamativi Main Tank (ZUFTA10) + full dip calibration chart ────────────────
-- 10,000 L aboveground diesel tank supplied by Brown Engineering (Pvt) Ltd.
-- Dimensions from the manufacturer's dip chart:
--   Internal diameter: 2 m
--   Internal length:   3.216 m
--   Total volume:      10 103 L
-- Dip stick readings run 0.00 m → 2.00 m in 0.01 m (10 mm) increments —
-- 201 calibration points, imported below and used by DipReadings.jsx's
-- interpolate() to compute litres from any dip reading between them.
--
-- Idempotent: uses NOT EXISTS guards + upsert on tank_calibrations.

BEGIN;

-- ── Ensure a Diesel fuel_type row exists (safe no-op if already there) ────
INSERT INTO fuel_types (name, code)
SELECT 'Diesel', 'DIESEL'
WHERE NOT EXISTS (SELECT 1 FROM fuel_types WHERE upper(code) = 'DIESEL' OR upper(name) = 'DIESEL');

-- ── Create the tank + populate the calibration chart ─────────────────────
DO $$
DECLARE
  v_site_id     uuid;
  v_fuel_type   uuid;
  v_tank_id     uuid;
BEGIN
  SELECT id INTO v_site_id FROM sites WHERE lower(name) = 'kamativi' LIMIT 1;
  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Kamativi site not found. Add the site first.';
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
   WHERE site_id = v_site_id AND (code = 'ZUFTA10' OR upper(name) = 'MAIN TANK')
   LIMIT 1;

  IF v_tank_id IS NULL THEN
    INSERT INTO fuel_tanks (
      site_id, name, code, tank_type, fuel_type_id,
      capacity_litres, min_threshold_percent,
      location_description, status
    ) VALUES (
      v_site_id,
      'Main Tank',
      'ZUFTA10',
      'above_ground',
      v_fuel_type,
      10103,     -- true total volume from the dip chart, not the nominal 10 000
      20,
      'Kamativi main yard — 10 000 L above-ground diesel tank (Brown Engineering ZUFTA10)',
      'active'
    )
    RETURNING id INTO v_tank_id;
  ELSE
    -- Tank already exists — refresh the capacity in case it was seeded with the nominal figure.
    UPDATE fuel_tanks
       SET capacity_litres = 10103,
           fuel_type_id    = v_fuel_type,
           tank_type       = 'above_ground'
     WHERE id = v_tank_id;
  END IF;

  -- ── Full 0-2000 mm dip chart (Brown Engineering ZUFTA10) ────────────────
  -- (dip_mm, level_litres). Upsert-safe on (tank_id, dip_mm).
  INSERT INTO tank_calibrations (tank_id, dip_mm, level_litres)
  VALUES
    (v_tank_id,    0,     0), (v_tank_id,   10,     6), (v_tank_id,   20,    17),
    (v_tank_id,   30,    31), (v_tank_id,   40,    48), (v_tank_id,   50,    67),
    (v_tank_id,   60,    88), (v_tank_id,   70,   111), (v_tank_id,   80,   136),
    (v_tank_id,   90,   162), (v_tank_id,  100,   189), (v_tank_id,  110,   218),
    (v_tank_id,  120,   247), (v_tank_id,  130,   279), (v_tank_id,  140,   311),
    (v_tank_id,  150,   344), (v_tank_id,  160,   379), (v_tank_id,  170,   414),
    (v_tank_id,  180,   450), (v_tank_id,  190,   488), (v_tank_id,  200,   526),
    (v_tank_id,  210,   565), (v_tank_id,  220,   605), (v_tank_id,  230,   645),
    (v_tank_id,  240,   687), (v_tank_id,  250,   729), (v_tank_id,  260,   772),
    (v_tank_id,  270,   815), (v_tank_id,  280,   860), (v_tank_id,  290,   905),
    (v_tank_id,  300,   950), (v_tank_id,  310,   997), (v_tank_id,  320,  1043),
    (v_tank_id,  330,  1091), (v_tank_id,  340,  1139), (v_tank_id,  350,  1188),
    (v_tank_id,  360,  1237), (v_tank_id,  370,  1286), (v_tank_id,  380,  1337),
    (v_tank_id,  390,  1387), (v_tank_id,  400,  1439), (v_tank_id,  410,  1490),
    (v_tank_id,  420,  1542), (v_tank_id,  430,  1595), (v_tank_id,  440,  1648),
    (v_tank_id,  450,  1702), (v_tank_id,  460,  1755), (v_tank_id,  470,  1810),
    (v_tank_id,  480,  1865), (v_tank_id,  490,  1920), (v_tank_id,  500,  1975),
    (v_tank_id,  510,  2031), (v_tank_id,  520,  2087), (v_tank_id,  530,  2144),
    (v_tank_id,  540,  2201), (v_tank_id,  550,  2258), (v_tank_id,  560,  2316),
    (v_tank_id,  570,  2374), (v_tank_id,  580,  2432), (v_tank_id,  590,  2490),
    (v_tank_id,  600,  2549), (v_tank_id,  610,  2608), (v_tank_id,  620,  2668),
    (v_tank_id,  630,  2727), (v_tank_id,  640,  2787), (v_tank_id,  650,  2847),
    (v_tank_id,  660,  2908), (v_tank_id,  670,  2968), (v_tank_id,  680,  3029),
    (v_tank_id,  690,  3090), (v_tank_id,  700,  3151), (v_tank_id,  710,  3213),
    (v_tank_id,  720,  3275), (v_tank_id,  730,  3336), (v_tank_id,  740,  3398),
    (v_tank_id,  750,  3461), (v_tank_id,  760,  3523), (v_tank_id,  770,  3585),
    (v_tank_id,  780,  3648), (v_tank_id,  790,  3711), (v_tank_id,  800,  3774),
    (v_tank_id,  810,  3837), (v_tank_id,  820,  3900), (v_tank_id,  830,  3964),
    (v_tank_id,  840,  4027), (v_tank_id,  850,  4091), (v_tank_id,  860,  4154),
    (v_tank_id,  870,  4218), (v_tank_id,  880,  4282), (v_tank_id,  890,  4346),
    (v_tank_id,  900,  4410), (v_tank_id,  910,  4474), (v_tank_id,  920,  4538),
    (v_tank_id,  930,  4602), (v_tank_id,  940,  4666), (v_tank_id,  950,  4730),
    (v_tank_id,  960,  4794), (v_tank_id,  970,  4859), (v_tank_id,  980,  4923),
    (v_tank_id,  990,  4987), (v_tank_id, 1000,  5052), (v_tank_id, 1010,  5116),
    (v_tank_id, 1020,  5180), (v_tank_id, 1030,  5245), (v_tank_id, 1040,  5309),
    (v_tank_id, 1050,  5373), (v_tank_id, 1060,  5437), (v_tank_id, 1070,  5502),
    (v_tank_id, 1080,  5566), (v_tank_id, 1090,  5630), (v_tank_id, 1100,  5694),
    (v_tank_id, 1110,  5758), (v_tank_id, 1120,  5822), (v_tank_id, 1130,  5885),
    (v_tank_id, 1140,  5949), (v_tank_id, 1150,  6013), (v_tank_id, 1160,  6076),
    (v_tank_id, 1170,  6140), (v_tank_id, 1180,  6203), (v_tank_id, 1190,  6266),
    (v_tank_id, 1200,  6329), (v_tank_id, 1210,  6392), (v_tank_id, 1220,  6455),
    (v_tank_id, 1230,  6518), (v_tank_id, 1240,  6580), (v_tank_id, 1250,  6643),
    (v_tank_id, 1260,  6705), (v_tank_id, 1270,  6767), (v_tank_id, 1280,  6829),
    (v_tank_id, 1290,  6890), (v_tank_id, 1300,  6952), (v_tank_id, 1310,  7013),
    (v_tank_id, 1320,  7074), (v_tank_id, 1330,  7135), (v_tank_id, 1340,  7196),
    (v_tank_id, 1350,  7256), (v_tank_id, 1360,  7316), (v_tank_id, 1370,  7376),
    (v_tank_id, 1380,  7436), (v_tank_id, 1390,  7495), (v_tank_id, 1400,  7554),
    (v_tank_id, 1410,  7613), (v_tank_id, 1420,  7671), (v_tank_id, 1430,  7730),
    (v_tank_id, 1440,  7788), (v_tank_id, 1450,  7845), (v_tank_id, 1460,  7902),
    (v_tank_id, 1470,  7959), (v_tank_id, 1480,  8016), (v_tank_id, 1490,  8072),
    (v_tank_id, 1500,  8128), (v_tank_id, 1510,  8184), (v_tank_id, 1520,  8239),
    (v_tank_id, 1530,  8294), (v_tank_id, 1540,  8348), (v_tank_id, 1550,  8402),
    (v_tank_id, 1560,  8455), (v_tank_id, 1570,  8508), (v_tank_id, 1580,  8561),
    (v_tank_id, 1590,  8613), (v_tank_id, 1600,  8665), (v_tank_id, 1610,  8716),
    (v_tank_id, 1620,  8767), (v_tank_id, 1630,  8817), (v_tank_id, 1640,  8867),
    (v_tank_id, 1650,  8916), (v_tank_id, 1660,  8964), (v_tank_id, 1670,  9012),
    (v_tank_id, 1680,  9060), (v_tank_id, 1690,  9107), (v_tank_id, 1700,  9153),
    (v_tank_id, 1710,  9199), (v_tank_id, 1720,  9244), (v_tank_id, 1730,  9288),
    (v_tank_id, 1740,  9332), (v_tank_id, 1750,  9374), (v_tank_id, 1760,  9417),
    (v_tank_id, 1770,  9458), (v_tank_id, 1780,  9499), (v_tank_id, 1790,  9539),
    (v_tank_id, 1800,  9578), (v_tank_id, 1810,  9616), (v_tank_id, 1820,  9653),
    (v_tank_id, 1830,  9689), (v_tank_id, 1840,  9725), (v_tank_id, 1850,  9759),
    (v_tank_id, 1860,  9792), (v_tank_id, 1870,  9825), (v_tank_id, 1880,  9856),
    (v_tank_id, 1890,  9886), (v_tank_id, 1900,  9914), (v_tank_id, 1910,  9942),
    (v_tank_id, 1920,  9968), (v_tank_id, 1930,  9992), (v_tank_id, 1940, 10015),
    (v_tank_id, 1950, 10036), (v_tank_id, 1960, 10055), (v_tank_id, 1970, 10072),
    (v_tank_id, 1980, 10086), (v_tank_id, 1990, 10097), (v_tank_id, 2000, 10103)
  ON CONFLICT (tank_id, dip_mm) DO UPDATE
    SET level_litres = EXCLUDED.level_litres;
END $$;

COMMIT;
