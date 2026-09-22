create table if not exists public.skl_state (
  id integer primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.skl_state enable row level security;

revoke all on public.skl_state from anon, authenticated;

grant select, insert, update, delete on public.skl_state to service_role;
