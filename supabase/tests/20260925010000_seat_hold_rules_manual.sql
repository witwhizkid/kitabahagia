-- Manual verification for migration 20260925010000_event_seat_hold_rules.
--
-- Run the whole file in the Supabase SQL Editor AFTER the migration is applied.
-- It creates private test events (slug 'zz-seathold-test-*', is_public = false,
-- is_demo = true), runs every check inside one DO block, deletes its own test
-- data at the end and prints one row per check. Every row should show
-- pass = true. The DO block is a single statement: if it fails half-way, all
-- of its test data is rolled back automatically.
--
-- Existing data is only read (checks 11 and 12).

drop table if exists pg_temp.kb_seathold_test;
create temp table kb_seathold_test (
  step text, check_name text, expected text, actual text, pass boolean
);

do $$
declare
  v_paid uuid;
  v_capped uuid;
  v_free uuid;
  v_result jsonb;
  v_code text;
  v_deadline timestamptz;
  v_error text;
  v_try text;  -- phone format tried in checks 4-6
begin
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline, is_public, is_demo)
  values ('zz-seathold-test-paid', 'Uji tahan kursi', current_date + 40, 'open', 35000, 10, now() + interval '30 days', false, true)
  returning id into v_paid;                                  -- payment_window_minutes = default 15
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline, is_public, is_demo, payment_window_minutes)
  values ('zz-seathold-test-capped', 'Uji jendela terpotong', current_date + 40, 'open', 35000, 10, now() + interval '20 minutes', false, true, 180)
  returning id into v_capped;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline, is_public, is_demo)
  values ('zz-seathold-test-free', 'Uji gratis', current_date + 40, 'open', 0, 10, now() + interval '30 days', false, true)
  returning id into v_free;

  -- 1. Default 15-minute window ---------------------------------------------
  v_result := public.create_registration('zz-seathold-test-paid', 'Uji A', '0812-3456-7890', 'Uji.A@Example.com', 'uji', null, true);
  v_code := v_result -> 'registration' ->> 'registration_code';
  v_deadline := (v_result -> 'registration' ->> 'payment_deadline')::timestamptz;
  insert into kb_seathold_test values ('1', 'Jendela default 15 menit', 'antara +14m59s dan +15m01s', (v_deadline - now())::text,
    v_deadline between now() + interval '14 minutes 59 seconds' and now() + interval '15 minutes 1 second');

  -- 2. Window capped by the event registration_deadline ---------------------
  v_result := public.create_registration('zz-seathold-test-capped', 'Uji B', '081299990000', 'uji-b@example.com', 'uji', null, true);
  v_deadline := (v_result -> 'registration' ->> 'payment_deadline')::timestamptz;
  insert into kb_seathold_test values ('2', 'Jendela 3 jam dipotong registration_deadline (+20m)', 'sama dengan registration_deadline',
    (v_deadline - now())::text, v_deadline = (select registration_deadline from public.events where id = v_capped));

  -- 3. Same email, different capitalisation ---------------------------------
  begin
    perform public.create_registration('zz-seathold-test-paid', 'Uji A2', '089900000001', 'uji.a@EXAMPLE.com', 'uji', null, true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_seathold_test values ('3', 'Email sama beda kapitalisasi', 'ALREADY_REGISTERED', v_error, v_error = 'ALREADY_REGISTERED');

  -- 4-6. Same number in different formats ------------------------------------
  foreach v_try in array array['+62 812 3456 7890', '62 812-3456-7890', '81234567890'] loop
    begin
      perform public.create_registration('zz-seathold-test-paid', 'Uji A3', v_try, 'lain-' || md5(v_try) || '@example.com', 'uji', null, true);
      v_error := 'ok';
    exception when others then v_error := sqlerrm;
    end;
    insert into kb_seathold_test values (
      case v_try when '+62 812 3456 7890' then '4' when '62 812-3456-7890' then '5' else '6' end,
      'Nomor WA sama: ' || v_try || ' vs 0812-3456-7890', 'ALREADY_REGISTERED', v_error, v_error = 'ALREADY_REGISTERED');
  end loop;

  -- 7. normalize_phone itself -----------------------------------------------
  insert into kb_seathold_test values ('7', 'normalize_phone: 0812 / +62 812 / 62 812 / 812', '628123456789 (x4)',
    concat_ws(', ', public.normalize_phone('0812-3456-789'), public.normalize_phone('+62 812 3456 789'),
              public.normalize_phone('62 812 3456 789'), public.normalize_phone('8123456789')),
    public.normalize_phone('0812-3456-789') = '628123456789'
      and public.normalize_phone('+62 812 3456 789') = '628123456789'
      and public.normalize_phone('62 812 3456 789') = '628123456789'
      and public.normalize_phone('8123456789') = '628123456789');

  -- 8. After the payment deadline the same person may register again ---------
  update public.registrations set payment_deadline = now() - interval '1 minute' where registration_code = v_code;
  begin
    v_result := public.create_registration('zz-seathold-test-paid', 'Uji A', '0812-3456-7890', 'uji.a@example.com', 'uji', null, true);
    v_code := v_result -> 'registration' ->> 'registration_code';
    v_error := 'ok';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_seathold_test values ('8', 'Deadline lewat -> boleh daftar lagi', 'ok', v_error, v_error = 'ok');

  -- 9. A confirmed registration keeps blocking --------------------------------
  update public.registrations set registration_status = 'confirmed', payment_status = 'paid' where registration_code = v_code;
  begin
    perform public.create_registration('zz-seathold-test-paid', 'Uji A', '0812-3456-7890', 'uji.a@example.com', 'uji', null, true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_seathold_test values ('9', 'Sudah confirmed -> tetap ditolak', 'ALREADY_REGISTERED', v_error, v_error = 'ALREADY_REGISTERED');

  -- 9b. A cancelled registration does not block -----------------------------
  update public.registrations set registration_status = 'cancelled' where registration_code = v_code;
  begin
    perform public.create_registration('zz-seathold-test-paid', 'Uji A', '0812-3456-7890', 'uji.a@example.com', 'uji', null, true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_seathold_test values ('9b', 'Cancelled tidak menghalangi', 'ok', v_error, v_error = 'ok');

  -- 10. Free events: duplicate refused too --------------------------------------
  perform public.create_registration('zz-seathold-test-free', 'Uji G', '081311112222', 'uji-g@example.com', 'uji', null, true);
  begin
    perform public.create_registration('zz-seathold-test-free', 'Uji G2', '+6281311112222', 'lain-g@example.com', 'uji', null, true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_seathold_test values ('10', 'Kegiatan gratis, nomor WA sama', 'ALREADY_REGISTERED', v_error, v_error = 'ALREADY_REGISTERED');

  -- 10b. Out-of-range window is rejected by the check constraint ----------------
  begin
    update public.events set payment_window_minutes = 5 where id = v_paid;
    v_error := 'ok';
  exception when check_violation then v_error := 'check_violation';
  end;
  insert into kb_seathold_test values ('10b', 'payment_window_minutes = 5 ditolak', 'check_violation', v_error, v_error = 'check_violation');

  -- Cleanup (test rows only) --------------------------------------------------
  delete from public.payment_attempts where registration_id in (
    select id from public.registrations where event_id in (v_paid, v_capped, v_free));
  delete from public.registrations where event_id in (v_paid, v_capped, v_free);
  delete from public.events where id in (v_paid, v_capped, v_free);
end;
$$;

-- 11. Existing events received the default (read-only).
insert into kb_seathold_test
select '11', 'Semua kegiatan punya payment_window_minutes 10..1440', '0 di luar rentang', count(*)::text, count(*) = 0
  from public.events
 where payment_window_minutes is null or payment_window_minutes not between 10 and 1440;

-- 12. Lookup indexes exist and are not unique (read-only).
insert into kb_seathold_test
select '12', 'Index email/nomor ada dan tidak unique', '2 index, unique=false',
       concat(count(*), ' index, unique=', bool_or(indisunique)), count(*) = 2 and not bool_or(indisunique)
  from pg_index
 where indexrelid in ('public.registrations_event_email_lookup_idx'::regclass,
                      'public.registrations_event_phone_lookup_idx'::regclass);

select step, check_name, expected, actual, pass from kb_seathold_test order by pg_catalog.regexp_replace(step, '[^0-9]', '', 'g')::integer, step;

-- CLEANUP (only if something was left behind):
-- delete from public.payment_attempts where registration_id in (
--   select r.id from public.registrations r join public.events e on e.id = r.event_id
--    where e.slug like 'zz-seathold-test-%');
-- delete from public.registrations where event_id in (select id from public.events where slug like 'zz-seathold-test-%');
-- delete from public.events where slug like 'zz-seathold-test-%';
