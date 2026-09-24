-- Manual checks for migration 20260930010000_selection_extras.
-- Run in Supabase SQL Editor after the migration. All output rows should pass.
-- Synthetic object paths are used to test database rules; upload/signing is tested separately.

drop table if exists pg_temp.kb_selection_extras_test;
create temp table kb_selection_extras_test (
  step text, check_name text, expected text, actual text, pass boolean
);

do $$
declare
  v_selection uuid;
  v_free uuid;
  v_error text;
  v_code text;
  v_proof text := 'zz-extras-selection/123e4567-e89b-42d3-a456-426614174000.png';
  v_cv text := 'zz-extras-selection/123e4567-e89b-42d3-a456-426614174001.pdf';
  v_row record;
  v_requirements text[];
begin
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline,
                             is_public, is_demo, registration_mode)
  values ('zz-extras-selection', 'Uji CV seleksi', current_date + 40, 'open', 0, 10,
          now() + interval '30 days', false, true, 'selection') returning id into v_selection;
  insert into public.events (slug, title, event_date, status, price, capacity, registration_deadline,
                             is_public, is_demo)
  values ('zz-extras-free', 'Uji gratis biasa', current_date + 40, 'open', 0, 10,
          now() + interval '30 days', false, true) returning id into v_free;

  select selection_requirements into v_requirements from public.events where id = v_selection;
  insert into kb_selection_extras_test values ('1', 'Event baru: persyaratan kosong', '{}', v_requirements::text,
    v_requirements = '{}');

  v_code := public.create_registration(p_event_slug => 'zz-extras-selection', p_name => 'Dengan CV',
    p_phone => '081300002001', p_email => 'cv@example.test', p_reason => 'x', p_notes => null, p_consent => true,
    p_instagram_proof_path => v_proof, p_cv_path => v_cv, p_portfolio_url => 'https://instagram.com/contoh')
    -> 'registration' ->> 'registration_code';
  select cv_path, portfolio_url into v_row from public.registrations where registration_code = v_code;
  insert into kb_selection_extras_test values ('2', 'CV dan link tersimpan', v_cv || ' | https://instagram.com/contoh',
    v_row.cv_path || ' | ' || v_row.portfolio_url, v_row.cv_path = v_cv and v_row.portfolio_url = 'https://instagram.com/contoh');

  v_code := public.create_registration(p_event_slug => 'zz-extras-selection', p_name => 'Tanpa CV',
    p_phone => '081300002002', p_email => 'nocv@example.test', p_reason => 'x', p_notes => null, p_consent => true,
    p_instagram_proof_path => replace(v_proof, '4000.png', '4002.png'))
    -> 'registration' ->> 'registration_code';
  select cv_path, portfolio_url into v_row from public.registrations where registration_code = v_code;
  insert into kb_selection_extras_test values ('3', 'CV dan link tetap opsional', 'NULL | NULL',
    coalesce(v_row.cv_path, 'NULL') || ' | ' || coalesce(v_row.portfolio_url, 'NULL'),
    v_row.cv_path is null and v_row.portfolio_url is null);

  begin
    perform public.create_registration(p_event_slug => 'zz-extras-selection', p_name => 'Link http',
      p_phone => '081300002003', p_email => 'http@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_instagram_proof_path => replace(v_proof, '4000.png', '4003.png'), p_portfolio_url => 'http://contoh.test');
    v_error := 'NO ERROR';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_selection_extras_test values ('4', 'Link harus https', 'INVALID_PORTFOLIO_URL', v_error,
    v_error = 'INVALID_PORTFOLIO_URL');

  begin
    perform public.create_registration(p_event_slug => 'zz-extras-selection', p_name => 'CV slug lain',
      p_phone => '081300002004', p_email => 'slug@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_instagram_proof_path => replace(v_proof, '4000.png', '4004.png'),
      p_cv_path => 'event-lain/123e4567-e89b-42d3-a456-426614174004.pdf');
    v_error := 'NO ERROR';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_selection_extras_test values ('5', 'Path CV harus milik event ini', 'INVALID_CV', v_error,
    v_error = 'INVALID_CV');

  begin
    perform public.create_registration(p_event_slug => 'zz-extras-free', p_name => 'CV gratis biasa',
      p_phone => '081300002005', p_email => 'free@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_cv_path => 'zz-extras-free/123e4567-e89b-42d3-a456-426614174005.pdf');
    v_error := 'NO ERROR';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_selection_extras_test values ('6', 'Event gratis biasa menolak CV', 'INVALID_CV', v_error,
    v_error = 'INVALID_CV');

  begin
    perform public.create_registration(p_event_slug => 'zz-extras-free', p_name => 'Link gratis biasa',
      p_phone => '081300002006', p_email => 'freelink@example.test', p_reason => 'x', p_notes => null, p_consent => true,
      p_portfolio_url => 'https://contoh.test');
    v_error := 'NO ERROR';
  exception when others then v_error := sqlerrm;
  end;
  insert into kb_selection_extras_test values ('7', 'Event gratis biasa menolak link', 'INVALID_PORTFOLIO_URL', v_error,
    v_error = 'INVALID_PORTFOLIO_URL');

  delete from public.registrations where event_id in (v_selection, v_free);
  delete from public.events where id in (v_selection, v_free);
end
$$;

select * from kb_selection_extras_test order by step;
