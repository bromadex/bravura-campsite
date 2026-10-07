-- 0266 (user, 7 Oct 2026): Kamativi Civil Works & Installation — apply the status sheet of 1 Oct 2026
-- (OCT012026_Civil_Works_Mechanical_Electrical_installation_Status.xlsx). Updates % / status / revised finish,
-- adds the "beyond the concrete pouring schedule" works that were not yet tasks. Leads (Eng. Osas / Joshua / Confidence)
-- have no logins yet, so they are written into the task description.
DO $$
DECLARE _p uuid := 'a0000001-0000-0000-0000-000000000001'; _pos int;
BEGIN
  -- existing tasks: (task_no, area_code, %, status, start, due, note, blocked_reason)
  UPDATE project_tasks t SET
    area_code = COALESCE(v.ac, t.area_code),
    percent_complete = v.pct, status = v.st,
    start_date = COALESCE(v.sd, t.start_date), due_date = COALESCE(v.dd, t.due_date),
    blocked_reason = CASE WHEN v.st = 'blocked' THEN v.why END,
    description = 'Status 1 Oct 2026: ' || v.note || COALESCE(E'\n' || NULLIF(t.description, ''), '')
  FROM (VALUES
    (18, NULL,  100, 'done',        NULL::date, NULL::date, 'Complete. Lead: Eng. Joshua', NULL),
    (25, '46A',  98, 'in_progress', NULL, '2026-10-07', 'Diesel generator building (DPC) 98%, materials available (was due 25 Jul). Lead: Eng. Joshua', NULL),
    (26, '46B',  83, 'in_progress', NULL, '2026-10-07', 'Power substation (DPC) 83% — roof slab materials awaiting delivery (was due 25 Jul). Lead: Eng. Joshua', NULL),
    (34, NULL,  100, 'done',        NULL, NULL, 'Plant building foundation (DPC) complete — foundation covers AC26–29, 31, 39, 41–43. Lead: Eng. Osas', NULL),
    (36, NULL,  100, 'done',        NULL, NULL, 'Ablution DPC complete. Lead: Eng. Joshua', NULL),
    (37, NULL,   18, 'in_progress', NULL, '2026-10-15', 'In progress — materials incomplete, awaiting delivery to site (was due 5 Aug)', NULL),
    (38, NULL,   88, 'in_progress', NULL, '2026-10-30', 'Roof slab materials procured, awaiting delivery to site (was due 31 Jul). Lead: Eng. Joshua', NULL),
    (39, NULL,   93, 'in_progress', NULL, '2026-10-20', 'Light masts: civils 13/14, installed 11/14 (was due 31 Jul). Lead: Eng. Confidence', NULL),
    (40, NULL,   86, 'in_progress', '2026-08-03', '2026-10-08', 'In progress, materials available (was due 17 Aug)', NULL),
    (42, NULL,  100, 'done',        NULL, NULL, 'Complete. Lead: Eng. Osas', NULL),
    (43, NULL,   63, 'in_progress', NULL, '2026-10-15', 'In progress, materials available (was due 12 Aug). Lead: Eng. Osas', NULL),
    (44, NULL,  100, 'done',        '2026-08-03', '2026-10-08', 'Complete (27% at the 17 Sep Exco)', NULL),
    (31, NULL,   33, 'blocked',     '2026-08-03', '2026-10-15', 'Materials procured, awaiting delivery to site (was due 18 Aug)', 'Materials procured — awaiting delivery to site'),
    (32, NULL,    0, 'blocked',     '2026-08-03', '2026-08-18', 'Inactive — materials unavailable. Lead: Eng. Confidence', 'Materials unavailable'),
    (35, NULL,   81, 'in_progress', NULL, NULL, '81% (80% at the 17 Sep Exco)', NULL),
    (33, NULL,    0, 'blocked',     NULL, NULL, 'Inactive — MCCs ETA to site 15 Oct 2026', 'Waiting for MCCs (ETA site 15 Oct 2026)')
  ) AS v(no, ac, pct, st, sd, dd, note, why)
  WHERE t.project_id = _p AND t.task_no = v.no AND NOT COALESCE(t.is_archived, false);

  SELECT COALESCE(max(position), 0) INTO _pos FROM project_tasks WHERE project_id = _p;

  -- works beyond the concrete pouring schedule (not yet tasks)
  INSERT INTO project_tasks (project_id, title, area_code, start_date, due_date, percent_complete, status, blocked_reason, description, position, priority)
  SELECT _p, v.title, v.ac, v.sd::date, v.dd::date, v.pct, v.st, CASE WHEN v.st = 'blocked' THEN v.why END,
         'Status 1 Oct 2026: ' || v.why, _pos + row_number() OVER (), 'medium'
  FROM (VALUES
    ('Electric power cable trenches (MCCs to substation & transformers)', NULL, '2026-09-23', '2026-10-19', 0,  'blocked',     'Inactive — materials unavailable'),
    ('Fencing of plant foundation area',                                 NULL, '2026-07-27', '2026-08-21', 0,  'blocked',     'Inactive — materials unavailable. Community bypass road complete'),
    ('Road & stormwater management system',                              NULL, '2026-06-12', '2026-09-03', 0,  'blocked',     'Inactive — materials unavailable'),
    ('Mining workshop foundation (DPC)',                                 NULL, '2026-09-03', '2026-09-30', 0,  'blocked',     'Inactive — materials unavailable'),
    ('Mining workshop superstructure',                                   NULL, '2026-10-02', '2026-11-12', 0,  'blocked',     'Inactive — materials unavailable'),
    ('Ablution superstructure',                                          '52', '2026-07-13', '2026-08-07', 20, 'in_progress', 'In progress — materials for completion to be procured (15% at 17 Sep Exco)'),
    ('Plant building superstructure',                                    '47', '2026-08-12', '2026-09-14', 0,  'blocked',     'Inactive — materials unavailable'),
    ('Generator building construction',                                  '46A','2026-07-20', '2026-08-14', 0,  'blocked',     'Inactive — materials unavailable'),
    ('Power substation construction',                                    '46B','2026-07-20', '2026-09-11', 0,  'blocked',     'Inactive — materials unavailable')
  ) AS v(title, ac, sd, dd, pct, st, why)
  WHERE NOT EXISTS (SELECT 1 FROM project_tasks x WHERE x.project_id = _p AND x.title = v.title AND NOT COALESCE(x.is_archived, false));

  INSERT INTO project_updates (project_id, health, progress, note, measured)
  VALUES (_p, COALESCE(pj_health(_p)->>'health', 'at_risk'), 94,
    'Status sheet 1 Oct 2026: concrete pouring schedule 94% (finish moved 18 Sep → 19 Oct). Mechanical installations 81%. '
    || 'Electrical waits for MCCs (ETA 15 Oct). Most open items are held by materials not on site: AC36, AC46B roof slab, AC50, AC51, AC54 roof slab, '
    || 'cable trenches, fencing, roads, mining workshop, AC47 superstructure, generator building and substation.', NULL);
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0266_kam_civils_status_1oct.sql') ON CONFLICT DO NOTHING;
