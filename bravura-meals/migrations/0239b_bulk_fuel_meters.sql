-- 0239b — bulk fuel issuance carries the meter reading (km for vehicles, hours for machines) and "meter broken".
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('rpc_bulk_fuel_issuance(uuid,uuid,uuid,text,text,jsonb)'::regprocedure);
  IF position('hours_reading' in d) = 0 THEN
    d := replace(d, 'acknowledgement_status, batch_id, created_by
    ) VALUES (', 'acknowledgement_status, batch_id, created_by, odometer_km, hours_reading, meter_broken, meter_note
    ) VALUES (');
    d := replace(d, '''pending'', p_batch_id, v_user_id
    ) RETURNING', '''pending'', p_batch_id, v_user_id,
      NULLIF(v_row->>''odometer_km'', '''')::numeric, NULLIF(v_row->>''hours_reading'', '''')::numeric,
      COALESCE((v_row->>''meter_broken'')::boolean, false), NULLIF(v_row->>''meter_note'', '''')
    ) RETURNING');
    EXECUTE d;
  END IF;
END $$;
INSERT INTO schema_migrations (filename) VALUES ('0239b_bulk_fuel_meters.sql') ON CONFLICT DO NOTHING;
