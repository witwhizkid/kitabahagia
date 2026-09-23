-- Manual verification for migration 20260924010000_registration_payment_deadline.
--
-- Run the whole file in the Supabase SQL Editor AFTER the migration is applied.
-- It creates private test events (slug 'zz-deadline-test-*', is_public = false,
-- is_demo = true), runs every check inside one DO block, deletes its own test
-- data at the end and finally prints one row per check. Every row should show
-- pass = true. The DO block is a single statement: if it fails half-way, all of
-- its test data is rolled back automatically (the CLEANUP section at the bottom
-- is only a safety net).
--
-- It never touches existing registrations except for the read-only check 10.

drop table if exists pg_temp.kb_deadline_test;
create temp table kb_deadline_test (
  step text, check_name text, expected text, actual text, pass boolean
);

do $$
declare
  v_paid_event uuid;
  v_short_event uuid;
  v_closing_event uuid;
  v_free_event uuid;
  v_result jsonb;
  v_code_a text;
  v_code_b text;
  v_deadline timestamptz;
  v_attempt jsonb;
  v_order text;
  v_status text;
  v_payment text;
  v_count integer;
  v_error text;
begin
  -- Fixtures ---------------------------------------------------------------
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline, is_public, is_demo)
  values ('zz-deadline-test-paid', 'Uji batas bayar', current_date + 40, 'open', 35000, 1, now() + interval '30 days', false, true)
  returning id into v_paid_event;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline, is_public, is_demo)
  values ('zz-deadline-test-short', 'Uji deadline pendek', current_date + 40, 'open', 35000, 5, now() + interval '1 hour', false, true)
  returning id into v_short_event;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline, is_public, is_demo)
  values ('zz-deadline-test-closing', 'Uji hampir tutup', current_date + 40, 'open', 35000, 5, now() + interval '3 minutes', false, true)
  returning id into v_closing_event;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline, is_public, is_demo)
  values ('zz-deadline-test-free', 'Uji gratis', current_date + 40, 'open', 0, 5, now() + interval '30 days', false, true)
  returning id into v_free_event;

  -- 1. Paid registration gets now() + 3 hours ------------------------------
  v_result := public.create_registration('zz-deadline-test-paid', 'Uji A', '081200000001', 'uji-a@example.com', 'uji', null, true);
  v_code_a := v_result -> 'registration' ->> 'registration_code';
  v_deadline := (v_result -> 'registration' ->> 'payment_deadline')::timestamptz;
  insert into kb_deadline_test values ('1', 'Pendaftaran berbayar: payment_deadline = now() + 3 jam',
    'antara +2j59m dan +3j01m', (v_deadline - now())::text,
    v_deadline between now() + interval '2 hours 59 minutes' and now() + interval '3 hours 1 minute');

  -- 2. Pending registration with a future deadline holds the only seat ------
  begin
    perform public.create_registration('zz-deadline-test-paid', 'Uji B', '081200000002', 'uji-b@example.com', 'uji', null, true);
    v_error := 'tidak ada error';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_deadline_test values ('2', 'Kuota 1 masih ditahan pendaftaran pending', 'EVENT_FULL', v_error, v_error = 'EVENT_FULL');

  -- 3. After the deadline the seat is released (lazy) ----------------------
  update public.registrations set payment_deadline = now() - interval '1 minute' where registration_code = v_code_a;
  begin
    v_result := public.create_registration('zz-deadline-test-paid', 'Uji B', '081200000002', 'uji-b@example.com', 'uji', null, true);
    v_code_b := v_result -> 'registration' ->> 'registration_code';
    v_error := 'berhasil';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_deadline_test values ('3', 'Setelah deadline lewat, kursi kembali', 'berhasil', v_error, v_error = 'berhasil');

  -- 3b. Same rule as public-events "slot tersisa" ---------------------------
  select count(*) into v_count from public.registrations as registration
   where registration.event_id = v_paid_event
     and (registration.registration_status = 'confirmed'
          or (registration.registration_status = 'pending_payment'
              and (registration.payment_deadline is null or registration.payment_deadline > now())));
  insert into kb_deadline_test values ('3b', 'Kursi terpakai menurut aturan public-events', '1 (hanya Uji B)', v_count::text, v_count = 1);

  -- 4. No new QRIS after the deadline --------------------------------------
  begin
    perform public.prepare_payment_attempt(v_code_a, 'uji-a@example.com');
    v_error := 'tidak ada error';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_deadline_test values ('4', 'prepare_payment_attempt setelah deadline', 'PAYMENT_DEADLINE_PASSED', v_error, v_error = 'PAYMENT_DEADLINE_PASSED');

  -- 5. Event deadline shorter than 3 hours caps payment_deadline ------------
  v_result := public.create_registration('zz-deadline-test-short', 'Uji C', '081200000003', 'uji-c@example.com', 'uji', null, true);
  v_deadline := (v_result -> 'registration' ->> 'payment_deadline')::timestamptz;
  insert into kb_deadline_test values ('5', 'Deadline kegiatan < 3 jam dipakai sebagai batas bayar',
    'sama dengan registration_deadline kegiatan (+1 jam)', (v_deadline - now())::text,
    v_deadline = (select registration_deadline from public.events where id = v_short_event));

  -- 6. Less than 5 minutes to pay: registration refused --------------------
  begin
    perform public.create_registration('zz-deadline-test-closing', 'Uji D', '081200000004', 'uji-d@example.com', 'uji', null, true);
    v_error := 'tidak ada error';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_deadline_test values ('6', 'Sisa waktu bayar < 5 menit', 'REGISTRATION_CLOSED', v_error, v_error = 'REGISTRATION_CLOSED');

  -- 7. Free events are unaffected -------------------------------------------
  v_result := public.create_registration('zz-deadline-test-free', 'Uji E', '081200000005', 'uji-e@example.com', 'uji', null, true);
  insert into kb_deadline_test values ('7', 'Kegiatan gratis langsung confirmed, tanpa deadline',
    'confirmed / not_required / null',
    concat_ws(' / ', v_result -> 'registration' ->> 'registration_status', v_result -> 'registration' ->> 'payment_status',
              coalesce(v_result -> 'registration' ->> 'payment_deadline', 'null')),
    v_result -> 'registration' ->> 'registration_status' = 'confirmed'
      and v_result -> 'registration' ->> 'payment_status' = 'not_required'
      and (v_result -> 'registration' -> 'payment_deadline') = 'null'::jsonb);

  -- 8. Within the window a new attempt is created and carries the deadline --
  v_attempt := public.prepare_payment_attempt(v_code_b, 'uji-b@example.com');
  v_order := v_attempt ->> 'order_id';
  insert into kb_deadline_test values ('8', 'prepare_payment_attempt sebelum deadline', 'attempt baru + payment_deadline',
    concat('is_reused=', v_attempt ->> 'is_reused', ', payment_deadline=', v_attempt ->> 'payment_deadline'),
    (v_attempt ->> 'is_reused')::boolean = false and v_attempt ? 'payment_deadline' and v_attempt ->> 'payment_deadline' is not null);

  -- 8b. An existing pending attempt is still returned after the deadline so a
  --     late settlement can be reconciled (needs_recovery, not an error).
  update public.payment_attempts
     set status = 'pending', provider_transaction_id = 'zz-test-tx', qr_url = 'https://api.sandbox.midtrans.com/test',
         expires_at = now() - interval '1 minute'
   where order_id = v_order;
  update public.registrations set payment_status = 'pending', payment_reference = v_order,
         payment_deadline = now() - interval '1 minute'
   where registration_code = v_code_b;
  begin
    v_attempt := public.prepare_payment_attempt(v_code_b, 'uji-b@example.com');
    v_error := concat('needs_recovery=', v_attempt ->> 'needs_recovery');
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_deadline_test values ('8b', 'Attempt pending lama tetap bisa direkonsiliasi setelah deadline', 'needs_recovery=true', v_error, v_error = 'needs_recovery=true');

  -- 9. Settlement arriving after the deadline is accepted -------------------
  v_result := public.apply_midtrans_notification(v_order, 'zz-test-tx', 35000, 'settlement', 'accept');
  select registration_status, payment_status into v_status, v_payment from public.registrations where registration_code = v_code_b;
  insert into kb_deadline_test values ('9', 'Settlement terlambat tetap diterima', 'confirmed / paid',
    concat_ws(' / ', v_status, v_payment), v_status = 'confirmed' and v_payment = 'paid');

  -- 9b. A later expire notification cannot downgrade paid -------------------
  perform public.apply_midtrans_notification(v_order, 'zz-test-tx', 35000, 'expire', null);
  select payment_status into v_payment from public.registrations where registration_code = v_code_b;
  insert into kb_deadline_test values ('9b', 'Notifikasi expire tidak menurunkan paid', 'paid', v_payment, v_payment = 'paid');

  -- Cleanup (test rows only) --------------------------------------------------
  delete from public.payment_attempts where registration_id in (
    select id from public.registrations where event_id in (v_paid_event, v_short_event, v_closing_event, v_free_event));
  delete from public.registrations where event_id in (v_paid_event, v_short_event, v_closing_event, v_free_event);
  delete from public.events where id in (v_paid_event, v_short_event, v_closing_event, v_free_event);
end;
$$;

-- 10. Backfill: no open unpaid registration is left without a deadline (read-only).
insert into kb_deadline_test
select '10', 'Backfill: pending_payment tanpa payment_deadline', '0', count(*)::text, count(*) = 0
  from public.registrations
 where registration_status = 'pending_payment' and payment_deadline is null;

select step, check_name, expected, actual, pass from kb_deadline_test order by step;

-- CLEANUP (only needed if the DO block above failed half-way):
-- delete from public.payment_attempts where registration_id in (
--   select r.id from public.registrations r join public.events e on e.id = r.event_id
--    where e.slug like 'zz-deadline-test-%');
-- delete from public.registrations where event_id in (select id from public.events where slug like 'zz-deadline-test-%');
-- delete from public.events where slug like 'zz-deadline-test-%';
