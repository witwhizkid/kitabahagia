create or replace function public.update_admin_user_safely(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role text default null,
  p_is_active boolean default null
)
returns table (
  user_id uuid,
  role text,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.admin_users%rowtype;
  target public.admin_users%rowtype;
  next_role text;
  next_is_active boolean;
  active_super_admins bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin-user-management', 0));

  select * into actor
    from public.admin_users
   where admin_users.user_id = p_actor_user_id
   for update;

  if not found or actor.is_active is not true or actor.role <> 'super_admin' then
    raise exception using errcode = 'P0001', message = 'ADMIN_FORBIDDEN';
  end if;

  select * into target
    from public.admin_users
   where admin_users.user_id = p_target_user_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ADMIN_NOT_FOUND';
  end if;

  next_role := coalesce(p_role, target.role);
  next_is_active := coalesce(p_is_active, target.is_active);

  if next_role not in ('admin', 'super_admin') then
    raise exception using errcode = 'P0001', message = 'INVALID_ADMIN_ROLE';
  end if;

  if p_target_user_id = p_actor_user_id and next_is_active is false then
    raise exception using errcode = 'P0001', message = 'SELF_DEACTIVATE';
  end if;

  if target.role = 'super_admin'
     and target.is_active is true
     and (next_role <> 'super_admin' or next_is_active is false) then
    select count(*) into active_super_admins
      from public.admin_users
     where admin_users.role = 'super_admin'
       and admin_users.is_active is true;

    if active_super_admins <= 1 then
      raise exception using errcode = 'P0001', message = 'LAST_SUPER_ADMIN';
    end if;
  end if;

  return query
  update public.admin_users
     set role = next_role,
         is_active = next_is_active
   where admin_users.user_id = p_target_user_id
  returning admin_users.user_id, admin_users.role, admin_users.is_active, admin_users.created_at;
end;
$$;

revoke all on function public.update_admin_user_safely(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.update_admin_user_safely(uuid, uuid, text, boolean) to service_role;

comment on function public.update_admin_user_safely(uuid, uuid, text, boolean)
is 'Updates an admin role or active state atomically while preserving at least one active super admin.';
