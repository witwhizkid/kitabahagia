-- Manual verification for migration 20260927010000_event_selection_mode.
--
-- Run the whole file in the Supabase SQL Editor AFTER the migration is applied.
-- It creates private test events (slug 'zz-selection-test-*', is_public = false,
-- is_demo = true), runs every check inside one DO block, deletes its own test
-- data at the end and prints one row per check. Every row should show
-- pass = true. If the block fails half-way, all of its test data is rolled back.

drop table if exists pg_temp.kb_selection_test;
create temp table kb_selection_test (
  step text, check_name text, expected text, actual text, pass boolean
);

do $$
declare
  v_sel uuid;
  v_later uuid;
  v_result jsonb;
  v_error text;
  v_row record;
  v_question constant text := 'Kenapa kamu ingin ikut kegiatan ini?';
  v_answer constant text := repeat('Saya ingin berbagi kebahagiaan. ', 6);
  v_i integer;

begin
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline,
                             is_public, is_demo, registration_mode, applicant_limit, announcement_at,
                             selection_question, selection_min_chars, commitment_text)
  values ('zz-selection-test-main', 'Uji seleksi', current_date + 40, 'open', 0, 1, now() + interval '30 days',
          false, true, 'selection', 3, now() + interval '10 days',
          v_question, 150, 'Saya bersedia hadir penuh.')
  returning id into v_sel;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline,
                             is_public, is_demo, registration_opens_at)
  values ('zz-selection-test-later', 'Uji belum dibuka', current_date + 40, 'open', 0, 10, now() + interval '30 days',
          false, true, now() + interval '1 day')
  returning id into v_later;

  -- 1. Registration before registration_opens_at is refused (first_come event).
  begin
    perform public.create_registration(p_event_slug => 'zz-selection-test-later', p_name => 'Uji', p_phone => '081200000001',
      p_email => 'a1@example.test', p_reason => 'x', p_notes => null, p_consent => true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_selection_test values ('1', 'Sebelum jam buka', 'REGISTRATION_NOT_OPEN', v_error, v_error = 'REGISTRATION_NOT_OPEN');

  -- 2. A valid application becomes 'applied', holds no payment, stores the snapshot.
  v_result := public.create_registration(p_event_slug => 'zz-selection-test-main', p_name => 'Pelamar Satu', p_phone => '081200000002',
    p_email => 'a2@example.test', p_reason => 'x', p_notes => null, p_consent => true,
    p_selection_answer => v_answer, p_commitment => true);
  select registration_status, payment_status, amount, selection_question, selection_answer, commitment_text
    into v_row from public.registrations where registration_code = v_result->'registration'->>'registration_code';
  insert into kb_selection_test values ('2', 'Lamaran valid', 'applied / not_required / 0 / snapshot tersimpan',
    concat_ws(' / ', v_row.registration_status, v_row.payment_status, v_row.amount,
              case when v_row.selection_question = v_question and v_row.selection_answer = btrim(v_answer)
                        and v_row.commitment_text = 'Saya bersedia hadir penuh.' then 'snapshot tersimpan' else 'snapshot salah' end),
    v_row.registration_status = 'applied' and v_row.payment_status = 'not_required' and v_row.amount = 0
      and v_row.selection_question = v_question and v_row.selection_answer = btrim(v_answer));
  insert into kb_selection_test values ('2b', 'Respons memuat announcement_at', 'terisi',
    coalesce(v_result->'registration'->>'announcement_at', 'kosong'), v_result->'registration'->>'announcement_at' is not null);

  -- 3. Answer shorter than selection_min_chars is refused.
  begin
    perform public.create_registration(p_event_slug => 'zz-selection-test-main', p_name => 'Uji', p_phone => '081200000003',
      p_email => 'a3@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_selection_answer => 'terlalu pendek', p_commitment => true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_selection_test values ('3', 'Jawaban < minimal karakter', 'INVALID_ANSWER', v_error, v_error = 'INVALID_ANSWER');

  -- 4. Commitment not ticked is refused.
  begin
    perform public.create_registration(p_event_slug => 'zz-selection-test-main', p_name => 'Uji', p_phone => '081200000004',
      p_email => 'a4@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_selection_answer => v_answer, p_commitment => null);
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_selection_test values ('4', 'Komitmen tidak dicentang', 'INVALID_ANSWER', v_error, v_error = 'INVALID_ANSWER');

  -- 5. The same person applying twice is refused (number written differently).
  begin
    perform public.create_registration(p_event_slug => 'zz-selection-test-main', p_name => 'Uji', p_phone => '+62 812-0000-0002',
      p_email => 'lain@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_selection_answer => v_answer, p_commitment => true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_selection_test values ('5', 'Pelamar yang sama daftar lagi', 'ALREADY_REGISTERED', v_error, v_error = 'ALREADY_REGISTERED');

  -- 6. Applications are not limited by capacity (1) but by applicant_limit (3).
  v_error := 'ok';
  for v_i in 5..6 loop
    begin
      perform public.create_registration(p_event_slug => 'zz-selection-test-main', p_name => 'Pelamar', p_phone => '08120000000' || v_i,
        p_email => 'a' || v_i || '@example.test', p_reason => 'x', p_notes => null, p_consent => true,
        p_selection_answer => v_answer, p_commitment => true);
    exception when others then v_error := sqlerrm; end;
  end loop;
  insert into kb_selection_test values ('6', 'Pelamar ke-2 dan ke-3 melebihi kapasitas 1', 'ok', v_error, v_error = 'ok');

  begin
    perform public.create_registration(p_event_slug => 'zz-selection-test-main', p_name => 'Uji', p_phone => '081200000007',
      p_email => 'a7@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_selection_answer => v_answer, p_commitment => true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_selection_test values ('6b', 'Pelamar ke-4 (batas 3)', 'APPLICANTS_FULL', v_error, v_error = 'APPLICANTS_FULL');

  -- 7. A cancelled application frees its place under applicant_limit.
  update public.registrations set registration_status = 'cancelled'
   where event_id = v_sel and email = 'a5@example.test';
  begin
    perform public.create_registration(p_event_slug => 'zz-selection-test-main', p_name => 'Uji', p_phone => '081200000007',
      p_email => 'a7@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_selection_answer => v_answer, p_commitment => true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_selection_test values ('7', 'Lamaran batal tidak dihitung', 'ok', v_error, v_error = 'ok');

  -- 8. Selection mode on a paid event cannot be saved.
  begin
    update public.events set price = 35000 where id = v_sel;
    v_error := 'ok';
  exception when check_violation then v_error := 'check_violation'; end;
  insert into kb_selection_test values ('8', 'Seleksi + berbayar', 'check_violation', v_error, v_error = 'check_violation');

  -- 9. The old 9-argument call (currently deployed Edge Function) still works on a first_come event.
  update public.events set registration_opens_at = null where id = v_later;
  v_result := public.create_registration(p_event_slug => 'zz-selection-test-later', p_name => 'Uji Lama', p_phone => '081200000009',
    p_email => 'a9@example.test', p_reason => 'x', p_notes => null, p_consent => true,
    p_domicile => 'Bogor', p_institution => 'IPB');
  insert into kb_selection_test values ('9', 'Panggilan 9 argumen (first_come)', 'confirmed',
    v_result->'registration'->>'registration_status', v_result->'registration'->>'registration_status' = 'confirmed');

  -- 10. Constraints.
  begin
    update public.events set registration_mode = 'lottery' where id = v_sel;
    v_error := 'ok';
  exception when check_violation then v_error := 'check_violation'; end;
  insert into kb_selection_test values ('10', 'registration_mode tidak dikenal', 'check_violation', v_error, v_error = 'check_violation');

  delete from public.registrations where event_id in (v_sel, v_later);
  delete from public.events where id in (v_sel, v_later);
end
$$;

select * from kb_selection_test order by step;

-- 11. Existing data: every event defaults to first_come (read-only). Only meaningful
--     right after the migration; once selection events exist this row is expected to fail.
select '11' as step, 'Semua kegiatan lama first_come' as check_name,
       count(*) filter (where registration_mode <> 'first_come') as not_first_come,
       count(*) filter (where registration_mode <> 'first_come') = 0 as pass
  from public.events where slug not like 'zz-selection-test-%';
