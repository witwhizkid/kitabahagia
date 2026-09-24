-- Manual verification for migration 20260928010000_selection_decisions.
--
-- Run the whole file in the Supabase SQL Editor AFTER the migration is applied.
-- It creates private test events (slug 'zz-decision-test-*', is_public = false,
-- is_demo = true), runs every check inside one DO block, deletes its own test
-- data at the end and shows one row per check (the editor shows the last result).
-- Every row should show pass = true.

drop table if exists pg_temp.kb_decision_test;
create temp table kb_decision_test (
  step text, check_name text, expected text, actual text, pass boolean
);

do $$
declare
  v_sel uuid;
  v_past uuid;
  v_first uuid;
  v_codes text[] := '{}';
  v_code text;
  v_first_code text;
  v_result jsonb;
  v_error text;
  v_row record;
  v_i integer;
begin
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline,
                             is_public, is_demo, registration_mode)
  values ('zz-decision-test-main', 'Uji keputusan', current_date + 40, 'open', 0, 2, now() + interval '30 days',
          false, true, 'selection')
  returning id into v_sel;
  insert into public.events (slug, title, event_date, status, price, capacity, is_public, is_demo)
  values ('zz-decision-test-past', 'Uji kegiatan lalu', current_date - 30, 'completed', 0, 10, false, true)
  returning id into v_past;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline, is_public, is_demo)
  values ('zz-decision-test-first', 'Uji siapa cepat', current_date + 40, 'open', 0, 10, now() + interval '30 days', false, true)
  returning id into v_first;

  -- Someone who joined an earlier event (inserted directly: that event is over).
  insert into public.registrations (registration_code, event_id, name, phone, email, consent,
                                    registration_status, payment_status, amount)
  values ('KB-ZZTEST-PAST01', v_past, 'Alumni', '081300000001', 'alumni@example.test', true, 'confirmed', 'not_required', 0);

  for v_i in 1..4 loop
    v_result := public.create_registration(p_event_slug => 'zz-decision-test-main', p_name => 'Pelamar ' || v_i,
      p_phone => '08130000001' || v_i, p_email => case when v_i = 1 then 'ALUMNI@example.test' else 'p' || v_i || '@example.test' end,
      p_reason => 'x', p_notes => null, p_consent => true);
    v_codes := v_codes || (v_result->'registration'->>'registration_code');
  end loop;
  v_result := public.create_registration(p_event_slug => 'zz-decision-test-first', p_name => 'Biasa',
    p_phone => '081300000099', p_email => 'biasa@example.test', p_reason => 'x', p_notes => null, p_consent => true);
  v_first_code := v_result->'registration'->>'registration_code';

  -- 1. Accept two (capacity 2).
  v_result := public.decide_selection(v_codes[1:2], 'accepted', gen_random_uuid());
  insert into kb_decision_test values ('1', 'Terima 2 dari kapasitas 2', 'accepted=2 applied=2',
    'accepted=' || (v_result->'counts'->>'accepted') || ' applied=' || (v_result->'counts'->>'applied'),
    (v_result->'counts'->>'accepted')::int = 2 and (v_result->'counts'->>'applied')::int = 2);

  -- 2. A third acceptance is refused and nothing changes.
  begin
    perform public.decide_selection(v_codes[3:3], 'accepted', gen_random_uuid());
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  select registration_status into v_row from public.registrations where registration_code = v_codes[3];
  insert into kb_decision_test values ('2', 'Terima ke-3 melebihi kapasitas', 'CAPACITY_EXCEEDED, tetap applied',
    v_error || ', ' || v_row.registration_status, v_error = 'CAPACITY_EXCEEDED' and v_row.registration_status = 'applied');

  -- 3. Waitlist and reject record who and when.
  perform public.decide_selection(v_codes[3:3], 'waitlisted', gen_random_uuid());
  v_result := public.decide_selection(v_codes[4:4], 'rejected', gen_random_uuid());
  select registration_status, selection_decided_at, selection_decided_by into v_row
    from public.registrations where registration_code = v_codes[4];
  insert into kb_decision_test values ('3', 'Cadangan + tolak', 'waitlisted=1 rejected=1, keputusan tercatat',
    'waitlisted=' || (v_result->'counts'->>'waitlisted') || ' rejected=' || (v_result->'counts'->>'rejected')
      || case when v_row.selection_decided_at is not null and v_row.selection_decided_by is not null then ', tercatat' else ', tidak tercatat' end,
    (v_result->'counts'->>'waitlisted')::int = 1 and (v_result->'counts'->>'rejected')::int = 1
      and v_row.selection_decided_at is not null);

  -- 4. Reset to 'applied' clears the decision.
  perform public.decide_selection(v_codes[4:4], 'applied', gen_random_uuid());
  select registration_status, selection_decided_at into v_row from public.registrations where registration_code = v_codes[4];
  insert into kb_decision_test values ('4', 'Kembalikan ke menunggu', 'applied, decided_at null',
    v_row.registration_status || ', ' || coalesce(v_row.selection_decided_at::text, 'null'),
    v_row.registration_status = 'applied' and v_row.selection_decided_at is null);

  -- 5. A rejected applicant cannot apply again.
  perform public.decide_selection(v_codes[4:4], 'rejected', gen_random_uuid());
  begin
    perform public.create_registration(p_event_slug => 'zz-decision-test-main', p_name => 'Lagi',
      p_phone => '081300000014', p_email => 'baru@example.test', p_reason => 'x', p_notes => null, p_consent => true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_decision_test values ('5', 'Pelamar ditolak daftar lagi', 'ALREADY_REGISTERED', v_error, v_error = 'ALREADY_REGISTERED');

  -- 6. Decisions only apply to selection events.
  begin
    perform public.decide_selection(array[v_first_code], 'accepted', gen_random_uuid());
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_decision_test values ('6', 'Kegiatan siapa cepat', 'NOT_SELECTION_EVENT', v_error, v_error = 'NOT_SELECTION_EVENT');

  -- 7. One call cannot mix events; unknown decision is refused.
  begin
    perform public.decide_selection(array[v_codes[3], v_first_code], 'waitlisted', gen_random_uuid());
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_decision_test values ('7', 'Kode dari 2 kegiatan', 'INVALID_REQUEST', v_error, v_error = 'INVALID_REQUEST');
  begin
    perform public.decide_selection(v_codes[3:3], 'maybe', gen_random_uuid());
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_decision_test values ('7b', 'Keputusan tidak dikenal', 'INVALID_DECISION', v_error, v_error = 'INVALID_DECISION');

  -- 8. History: applicant 1 joined the past event (email matched case-insensitively).
  v_result := public.selection_overview('zz-decision-test-main');
  insert into kb_decision_test values ('8', 'Riwayat ikut kegiatan', 'pelamar 1 = 1, lainnya tidak ada',
    coalesce(v_result->'history'->>v_codes[1], '-') || ', ' || coalesce(v_result->'history'->>v_codes[2], '-'),
    (v_result->'history'->>v_codes[1])::int = 1 and v_result->'history'->>v_codes[2] is null);

  delete from public.registrations where event_id in (v_sel, v_past, v_first);
  delete from public.events where id in (v_sel, v_past, v_first);
end
$$;

select * from kb_decision_test order by step;
