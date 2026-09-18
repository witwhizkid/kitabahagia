-- Apply signed Midtrans notifications atomically. Only the webhook's service_role may call this RPC.
create or replace function public.apply_midtrans_notification(
  p_order_id text,
  p_provider_transaction_id text,
  p_gross_amount numeric,
  p_transaction_status text,
  p_fraud_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_attempts%rowtype;
  v_registration public.registrations%rowtype;
  v_attempt_status text;
  v_registration_payment_status text;
begin
  if p_order_id is null or p_order_id = ''
     or p_provider_transaction_id is null or p_provider_transaction_id = ''
     or p_gross_amount is null or p_gross_amount <= 0
     or p_transaction_status is null
     or p_transaction_status not in (
       'pending', 'settlement', 'capture', 'expire', 'deny', 'cancel',
       'refund', 'partial_refund'
     ) then
    raise exception using errcode = 'P0001', message = 'INVALID_NOTIFICATION';
  end if;

  select attempt.* into v_attempt
    from public.payment_attempts as attempt
   where attempt.order_id = p_order_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.provider <> 'midtrans' or v_attempt.order_id <> p_order_id
     or v_attempt.amount::numeric <> p_gross_amount
     or (v_attempt.provider_transaction_id is not null
         and v_attempt.provider_transaction_id <> p_provider_transaction_id) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_IDENTITY_MISMATCH';
  end if;

  select registration.* into v_registration
    from public.registrations as registration
   where registration.id = v_attempt.registration_id
   for update;
  if not found or v_registration.amount <> v_attempt.amount then
    raise exception using errcode = 'P0001', message = 'PAYMENT_IDENTITY_MISMATCH';
  end if;

  if p_transaction_status in ('settlement', 'capture')
     and (p_fraud_status is not null and p_fraud_status <> 'accept') then
    raise exception using errcode = 'P0001', message = 'PAYMENT_FRAUD_NOT_ACCEPTED';
  end if;
  if v_attempt.status = 'creating' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_READY';
  end if;

  -- A refund is a later state than paid; neither a duplicate nor an older status may undo it.
  if v_attempt.status = 'refunded' then
    v_attempt_status := v_attempt.status;
  elsif p_transaction_status in ('refund', 'partial_refund') then
    if v_attempt.status <> 'paid' then
      raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_READY';
    end if;
    update public.payment_attempts
       set status = 'refunded', provider_status = p_transaction_status
     where id = v_attempt.id;
    if v_registration.payment_reference = p_order_id
       and v_registration.payment_status = 'paid' then
      update public.registrations
         set payment_status = 'refunded'
       where id = v_registration.id;
    end if;
    v_attempt_status := 'refunded';
  elsif v_attempt.status = 'paid' then
    -- Settlement can follow capture, but pending/expire/deny/cancel cannot downgrade paid.
    if p_transaction_status = 'settlement'
       and v_attempt.provider_status is distinct from 'settlement' then
      update public.payment_attempts
         set provider_status = 'settlement'
       where id = v_attempt.id;
    end if;
    v_attempt_status := 'paid';
  elsif p_transaction_status in ('settlement', 'capture') then
    if v_registration.registration_status = 'cancelled' then
      raise exception using errcode = 'P0001', message = 'REGISTRATION_NOT_ELIGIBLE';
    end if;
    update public.payment_attempts
       set status = 'paid', provider_status = p_transaction_status,
           provider_transaction_id = p_provider_transaction_id
     where id = v_attempt.id;
    -- A different already-paid order retains its authoritative reference.
    if not (v_registration.payment_status = 'paid'
            and v_registration.payment_reference is distinct from p_order_id) then
      update public.registrations
         set registration_status = 'confirmed', payment_status = 'paid',
             payment_reference = p_order_id
       where id = v_registration.id;
    end if;
    v_attempt_status := 'paid';
  elsif p_transaction_status = 'pending' then
    if v_attempt.status = 'pending' then
      update public.payment_attempts
         set provider_status = 'pending',
             provider_transaction_id = p_provider_transaction_id
       where id = v_attempt.id
         and (provider_status is distinct from 'pending'
              or provider_transaction_id is null);
      if v_registration.registration_status = 'pending_payment'
         and v_registration.payment_status not in ('paid', 'refunded')
         and (v_registration.payment_reference is null
              or v_registration.payment_reference = p_order_id) then
        update public.registrations
           set payment_status = 'pending', payment_reference = p_order_id
         where id = v_registration.id
           and (payment_status is distinct from 'pending'
                or payment_reference is distinct from p_order_id);
      end if;
    end if;
    v_attempt_status := v_attempt.status;
  else
    -- Terminal failure notifications are ignored after paid/refunded and after
    -- another terminal outcome. Cancellation does not cancel the registration.
    if v_attempt.status = 'pending' then
      v_attempt_status := case p_transaction_status
        when 'expire' then 'expired'
        when 'cancel' then 'cancelled'
        else 'failed'
      end;
      update public.payment_attempts
         set status = v_attempt_status, provider_status = p_transaction_status,
             provider_transaction_id = p_provider_transaction_id
       where id = v_attempt.id;
      if v_registration.registration_status = 'pending_payment'
         and v_registration.payment_reference = p_order_id
         and v_registration.payment_status not in ('paid', 'refunded') then
        update public.registrations
           set payment_status = case when p_transaction_status = 'expire'
                                     then 'expired' else 'failed' end
         where id = v_registration.id;
      end if;
    else
      v_attempt_status := v_attempt.status;
    end if;
  end if;

  select registration.payment_status into v_registration_payment_status
    from public.registrations as registration
   where registration.id = v_registration.id;
  return pg_catalog.jsonb_build_object(
    'order_id', p_order_id,
    'attempt_status', v_attempt_status,
    'payment_status', v_registration_payment_status
  );
end;
$$;

revoke all on function public.apply_midtrans_notification(text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_midtrans_notification(text, text, numeric, text, text)
  to service_role;
comment on function public.apply_midtrans_notification(text, text, numeric, text, text)
  is 'Applies signed Midtrans webhook state atomically to a known payment attempt and registration.';
