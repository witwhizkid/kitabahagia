-- Manual checks for migration 20260929010000_instagram_proof.
-- Run in Supabase SQL Editor after the migration. All output rows should pass.
-- A synthetic object path is used to test database rules; upload/signing is tested separately.

drop table if exists pg_temp.kb_instagram_proof_test;
create temp table kb_instagram_proof_test (
  step text, check_name text, expected text, actual text, pass boolean
);

do $$
declare
  v_selection uuid;
  v_free uuid;
  v_paid uuid;
  v_result jsonb;
  v_error text;
  v_code text;
  v_path text := 'zz-instagram-proof-test/123e4567-e89b-42d3-a456-426614174000.png';
  v_stored_path text;
begin
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline,
                             is_public, is_demo, registration_mode)
  values ('zz-instagram-proof-test', 'Uji bukti seleksi', current_date + 40, 'open', 0, 10,
          now() + interval '30 days', false, true, 'selection') returning id into v_selection;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline,
                             is_public, is_demo)
  values ('zz-instagram-proof-free', 'Uji gratis biasa', current_date + 40, 'open', 0, 10,
          now() + interval '30 days', false, true) returning id into v_free;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline,
                             is_public, is_demo)
  values ('zz-instagram-proof-paid', 'Uji berbayar', current_date + 40, 'open', 1000, 10,
          now() + interval '30 days', false, true) returning id into v_paid;

  begin
    perform public.create_registration(p_event_slug => 'zz-instagram-proof-test', p_name => 'Tanpa Bukti',
      p_phone => '081300001001', p_email => 'no-proof@example.test', p_reason => 'x', p_notes => null, p_consent => true);
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_instagram_proof_test values ('1', 'Gratis seleksi wajib punya path bukti', 'INVALID_INSTAGRAM_PROOF', v_error,
    v_error = 'INVALID_INSTAGRAM_PROOF');

  v_result := public.create_registration(p_event_slug => 'zz-instagram-proof-test', p_name => 'Dengan Bukti',
    p_phone => '081300001002', p_email => 'with-proof@example.test', p_reason => 'x', p_notes => null,
    p_consent => true, p_instagram_proof_path => v_path);
  v_code := v_result->'registration'->>'registration_code';
  select instagram_proof_path into v_stored_path from public.registrations where registration_code = v_code;
  insert into kb_instagram_proof_test values ('2', 'Path proof tersimpan pada pendaftaran seleksi', v_path,
    coalesce(v_stored_path, 'NULL'), v_stored_path = v_path);

  begin
    perform public.create_registration(p_event_slug => 'zz-instagram-proof-free', p_name => 'Gratis Biasa',
      p_phone => '081300001003', p_email => 'free@example.test', p_reason => 'x', p_notes => null,
      p_consent => true, p_instagram_proof_path => 'zz-instagram-proof-free/123e4567-e89b-42d3-a456-426614174000.png');
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_instagram_proof_test values ('3', 'Event gratis biasa menolak proof', 'INVALID_INSTAGRAM_PROOF', v_error,
    v_error = 'INVALID_INSTAGRAM_PROOF');

  v_result := public.create_registration(p_event_slug => 'zz-instagram-proof-free', p_name => 'Gratis JSON',
    p_phone => '081300001004', p_email => 'free-json@example.test', p_reason => 'x', p_notes => null, p_consent => true);
  select instagram_proof_path into v_stored_path from public.registrations
   where registration_code = v_result->'registration'->>'registration_code';
  insert into kb_instagram_proof_test values ('4', 'JSON gratis biasa tetap tanpa proof', 'NULL', coalesce(v_stored_path, 'NULL'),
    v_stored_path is null);

  begin
    perform public.create_registration(p_event_slug => 'zz-instagram-proof-paid', p_name => 'Berbayar',
      p_phone => '081300001005', p_email => 'paid@example.test', p_reason => 'x', p_notes => null,
      p_consent => true, p_instagram_proof_path => 'zz-instagram-proof-paid/123e4567-e89b-42d3-a456-426614174000.png');
    v_error := 'ok';
  exception when others then v_error := sqlerrm; end;
  insert into kb_instagram_proof_test values ('5', 'Event berbayar menolak proof', 'INVALID_INSTAGRAM_PROOF', v_error,
    v_error = 'INVALID_INSTAGRAM_PROOF');

  delete from public.registrations where event_id in (v_selection, v_free, v_paid);
  delete from public.events where id in (v_selection, v_free, v_paid);
end
$$;

select * from kb_instagram_proof_test order by step;
