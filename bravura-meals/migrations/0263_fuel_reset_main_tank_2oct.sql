-- 0263 (user, 3 Oct 2026): start fuel tracking fresh from the Main Tank dip of 2 Oct 11:08 (6,392 L).
-- Stores book was 7,027 L → write off the 635 L difference as a fuel loss (same entries as month-end close),
-- close every open dip gap with this reason, and count gaps for month-end only from the reset onwards.
DO $$
DECLARE _tank fuel_tanks%ROWTYPE; _dip fuel_dip_readings%ROWTYPE; _item uuid; _book numeric; _diff numeric; _mv uuid; _val numeric; _je uuid;
BEGIN
  SELECT * INTO _tank FROM fuel_tanks WHERE id = '5bd0dc58-83ef-4284-b208-554ad7a13a81';
  SELECT * INTO _dip FROM fuel_dip_readings WHERE id = 'ca7e537e-330c-4e63-b27d-0cee584dab4c';
  SELECT item_id INTO _item FROM fuel_types WHERE id = _tank.fuel_type_id;
  SELECT COALESCE(SUM(on_hand_qty), 0) INTO _book FROM stock_balances WHERE warehouse_id = _tank.warehouse_id AND item_id = _item;
  _diff := _dip.level_litres - _book;              -- 6392 - 7027 = -635
  IF _diff <> 0 THEN
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, voucher_type, voucher_no, source_module,
      source_reference_id, reason, notes, created_at)
    VALUES (_item, _tank.warehouse_id, 'stock_take', _diff, 0, 'fuel_reset', 'FUEL-RESET-2026-10-02', 'fuel', _tank.id,
      CASE WHEN _diff < 0 THEN 'Fuel loss' ELSE 'Fuel gain' END,
      'Books reset to the dip of 2 Oct 2026 11:08 (' || _dip.level_litres || ' L) — tracking starts here', _dip.created_at)
    RETURNING id, abs(value) INTO _mv, _val;
    _je := gl_auto_post(_tank.site_id, CASE WHEN _diff < 0 THEN 'fuel_loss' ELSE 'fuel_gain' END, 'fuel_tanks', _tank.id, _dip.reading_date, _val,
      'Fuel reset ' || _tank.name || ' to dip 2 Oct — ' || abs(_diff) || ' L');
  END IF;
  -- old gaps: closed with the reset as the reason
  UPDATE fuel_dip_readings SET gap_status = 'signed_off', gap_reason = COALESCE(gap_reason, 'Before the reset of 2 Oct 2026 — books set to the dip'),
    gap_signed_at = now()
   WHERE site_id = _tank.site_id AND gap_status IN ('needs_reason', 'explained') AND created_at <= _dip.created_at;
  -- month-end only counts dips after the reset
  UPDATE fuel_tanks SET stores_from = _dip.created_at + interval '1 second' WHERE id = _tank.id;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0263_fuel_reset_main_tank_2oct.sql') ON CONFLICT DO NOTHING;
