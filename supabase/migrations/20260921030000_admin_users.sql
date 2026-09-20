create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint admin_users_role_allowed check (role in ('admin', 'super_admin'))
);

alter table public.admin_users enable row level security;

revoke all privileges on table public.admin_users from anon, authenticated;
grant select, insert, update, delete on table public.admin_users to service_role;
