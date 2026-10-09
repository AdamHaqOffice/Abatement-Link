-- Abatement Link v2.15 QA seed data
-- Creates 20 believable FAKE test devices with interval readings and alarm history under one test account.
-- Change seed_user_email below if your test account uses a different login email.

DO $$
DECLARE
  seed_user_email text := 'abatetester1@yopmail.com';
  target_user uuid;
  d int;
  sample_index int;
  v_room int;
  v_device_id uuid;
  v_serial text;
  v_model text;
  v_job_no text;
  v_name text;
  v_ts timestamptz;
  v_pressure numeric;
  v_temperature numeric;
  v_humidity numeric;
  v_particles numeric;
  v_ach numeric;
  v_velocity numeric;
  v_pressure_event text;
  v_pressure_state text;
  v_alarm_start timestamptz;
  v_alarm_resolved timestamptz;
BEGIN
  SELECT id INTO target_user
  FROM auth.users
  WHERE lower(email) = lower(seed_user_email)
  LIMIT 1;

  IF target_user IS NULL THEN
    RAISE EXCEPTION 'No auth user found for %. Create the user first or edit seed_user_email at the top of this file.', seed_user_email;
  END IF;

  FOR d IN 1..20 LOOP
    v_model := CASE WHEN d % 3 = 0 THEN 'RPM' ELSE 'PPM4' END;
    v_serial := 'FAKE-' || v_model || '-' || lpad(d::text, 4, '0');
    v_job_no := 'FAKE-JOB-' || (42000 + d)::text;
    v_name := 'FAKE Test ' || v_model || ' - ' ||
      (ARRAY['North Wing','South Wing','Containment A','Containment B','ICU Temp Wall','Lab Exhaust','Room 204','Room 306','Basement Zone','Penthouse'])[1 + ((d - 1) % 10)] || ' #' || d::text;

    INSERT INTO public.devices (
      owner_id, serial_number, nickname, model, validation_code, verified_at, last_seen_at, last_job_no, latest_metrics
    ) VALUES (
      target_user,
      v_serial,
      v_name,
      v_model,
      lpad((100000 + d)::text, 6, '0'),
      now() - interval '2 days',
      now() - ((d % 8) || ' minutes')::interval,
      v_job_no,
      jsonb_build_object(
        'pressure', jsonb_build_object('value', round((-13.5 + random() * 2)::numeric, 3), 'timestamp', now()),
        'temperature', jsonb_build_object('value', round((20.5 + random() * 2.5)::numeric, 1), 'timestamp', now()),
        'humidity', jsonb_build_object('value', round((38 + random() * 14)::numeric, 1), 'timestamp', now()),
        'particles', jsonb_build_object('value', round((45 + random() * 90)::numeric, 0), 'timestamp', now()),
        'ach', jsonb_build_object('value', round((4.5 + random() * 4)::numeric, 1), 'timestamp', now()),
        'velocity', jsonb_build_object('value', round((80 + random() * 120)::numeric, 0), 'timestamp', now())
      )
    )
    ON CONFLICT (serial_number) DO UPDATE SET
      owner_id = excluded.owner_id,
      nickname = excluded.nickname,
      model = excluded.model,
      verified_at = excluded.verified_at,
      last_seen_at = excluded.last_seen_at,
      last_job_no = excluded.last_job_no,
      latest_metrics = excluded.latest_metrics,
      updated_at = now()
    RETURNING id INTO v_device_id;

    DELETE FROM public.notification_logs WHERE device_id = v_device_id;
    DELETE FROM public.alarm_events WHERE device_id = v_device_id;
    DELETE FROM public.device_readings WHERE device_id = v_device_id;
    DELETE FROM public.notification_rules WHERE device_id = v_device_id AND user_id = target_user;

    INSERT INTO public.notification_rules (device_id, user_id, push_high, push_low, push_ok, email_high, email_low, email_ok, extra_emails)
    VALUES (v_device_id, target_user, true, true, true, false, false, false, '[]'::jsonb)
    ON CONFLICT (device_id, user_id) DO UPDATE SET
      push_high = true,
      push_low = true,
      push_ok = true,
      updated_at = now();

    FOR sample_index IN 0..23 LOOP
      v_ts := now() - ((23 - sample_index) || ' hours')::interval;
      FOR v_room IN 1..2 LOOP
        v_pressure := round((-14.2 + (random() * 3.2) + (v_room * 0.45) + (d * 0.025))::numeric, 3);
        v_pressure_event := 'INTERVAL';
        v_pressure_state := 'ok';

        IF d % 4 = 0 AND sample_index = 16 AND v_room = 1 THEN
          v_pressure := round((-4.8 + random())::numeric, 3);
          v_pressure_event := 'HIGH ALARM';
          v_pressure_state := 'high';
        ELSIF d % 4 = 0 AND sample_index = 18 AND v_room = 1 THEN
          v_pressure := round((-12.9 + random())::numeric, 3);
          v_pressure_event := 'OK ALARM';
          v_pressure_state := 'ok';
        ELSIF d % 5 = 0 AND sample_index = 20 AND v_room = 2 THEN
          v_pressure := round((-26.8 - random())::numeric, 3);
          v_pressure_event := 'LOW ALARM';
          v_pressure_state := 'low';
        ELSIF d % 7 = 0 AND sample_index = 10 AND v_room = 2 THEN
          v_pressure := round((-25.5 - random())::numeric, 3);
          v_pressure_event := 'LOW ALARM';
          v_pressure_state := 'low';
        ELSIF d % 7 = 0 AND sample_index = 13 AND v_room = 2 THEN
          v_pressure := round((-13.1 + random())::numeric, 3);
          v_pressure_event := 'OK ALARM';
          v_pressure_state := 'ok';
        END IF;

        v_temperature := round((20.0 + random() * 3.8 + v_room * 0.2)::numeric, 1);
        v_humidity := round((36.0 + random() * 16.0)::numeric, 1);
        v_particles := round((35 + random() * 125)::numeric, 0);
        v_ach := round((4.0 + random() * 4.5)::numeric, 1);
        v_velocity := round((75 + random() * 145)::numeric, 0);

        INSERT INTO public.device_readings (device_id, serial_number, job_no, device_ts, room_no, sensor_no, metric, value, upper_limit, lower_limit, alarm_state, event_text, raw_payload)
        VALUES
          (v_device_id, v_serial, v_job_no, v_ts, v_room, 1, 'pressure', v_pressure, -6.494, -23.988, v_pressure_state, format('PRESSURE R%sS1 %s %s SET MENU PASSWORD', v_room, v_pressure_event, v_pressure), jsonb_build_object('seed', true, 'fake', true)),
          (v_device_id, v_serial, v_job_no, v_ts, v_room, 1, 'temperature', v_temperature, 26.0, 18.0, 'ok', format('TEMPERATURE R%sS1 INTERVAL %s', v_room, v_temperature), jsonb_build_object('seed', true, 'fake', true)),
          (v_device_id, v_serial, v_job_no, v_ts, v_room, 1, 'humidity', v_humidity, 60.0, 30.0, 'ok', format('HUMIDITY R%sS1 INTERVAL %s', v_room, v_humidity), jsonb_build_object('seed', true, 'fake', true)),
          (v_device_id, v_serial, v_job_no, v_ts, v_room, 2, 'particles', v_particles, 250.0, 0.0, 'ok', format('PARTICLE R%sS2 INTERVAL %s', v_room, v_particles), jsonb_build_object('seed', true, 'fake', true)),
          (v_device_id, v_serial, v_job_no, v_ts, v_room, 1, 'ach', v_ach, 12.0, 3.0, 'ok', format('ACH R%sS1 INTERVAL %s', v_room, v_ach), jsonb_build_object('seed', true, 'fake', true)),
          (v_device_id, v_serial, v_job_no, v_ts, v_room, 2, 'velocity', v_velocity, 300.0, 0.0, 'ok', format('VELOCITY R%sS2 INTERVAL %s', v_room, v_velocity), jsonb_build_object('seed', true, 'fake', true));
      END LOOP;
    END LOOP;

    IF d % 4 = 0 THEN
      v_alarm_start := now() - interval '7 hours';
      v_alarm_resolved := now() - interval '5 hours';
      INSERT INTO public.alarm_events (device_id, alarm_state, metric, room_no, sensor_no, value, limit_value, event_text, started_at, resolved_at)
      VALUES (v_device_id, 'high', 'pressure', 1, 1, -4.8, -6.494, 'PRESSURE R1S1 HIGH ALARM -4.800 SET MENU PASSWORD', v_alarm_start, v_alarm_resolved);
    END IF;

    IF d % 5 = 0 THEN
      v_alarm_start := now() - interval '3 hours';
      INSERT INTO public.alarm_events (device_id, alarm_state, metric, room_no, sensor_no, value, limit_value, event_text, started_at, resolved_at)
      VALUES (v_device_id, 'low', 'pressure', 2, 1, -26.8, -23.988, 'PRESSURE R2S1 LOW ALARM -26.800 SET MENU PASSWORD', v_alarm_start, NULL);
    END IF;

    IF d % 7 = 0 THEN
      v_alarm_start := now() - interval '13 hours';
      v_alarm_resolved := now() - interval '10 hours';
      INSERT INTO public.alarm_events (device_id, alarm_state, metric, room_no, sensor_no, value, limit_value, event_text, started_at, resolved_at)
      VALUES (v_device_id, 'low', 'pressure', 2, 1, -25.5, -23.988, 'PRESSURE R2S1 LOW ALARM -25.500 SET MENU PASSWORD', v_alarm_start, v_alarm_resolved);
    END IF;
  END LOOP;
END $$;
