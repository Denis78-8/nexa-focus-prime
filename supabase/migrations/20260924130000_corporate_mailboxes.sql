-- Corporate mailbox registry. This stores NEXA lifecycle records, not mailbox credentials.
do $$ begin
  create type public.corporate_mailbox_status as enum ('pending', 'active', 'suspended', 'disabled', 'error');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.mailbox_audit_action as enum ('mailbox_created', 'mailbox_disabled', 'mailbox_enabled', 'mailbox_deleted', 'mailbox_provision_failed');
exception when duplicate_object then null;
end $$;

create table if not exists public.corporate_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  email text not null unique,
  local_part text not null,
  domain text not null,
  status public.corporate_mailbox_status not null default 'pending',
  provider text,
  provider_user_id text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  disabled_at timestamptz,
  metadata jsonb,
  constraint corporate_mailboxes_email_lowercase check (email = lower(email)),
  constraint corporate_mailboxes_email_length check (char_length(email) <= 254),
  constraint corporate_mailboxes_local_part_length check (char_length(local_part) <= 64),
  constraint corporate_mailboxes_domain_length check (char_length(domain) <= 253),
  constraint corporate_mailboxes_local_part_format check (local_part ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'),
  constraint corporate_mailboxes_domain_format check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  constraint corporate_mailboxes_address_parts check (email = local_part || '@' || domain)
);
create unique index if not exists corporate_mailboxes_one_primary_per_user
  on public.corporate_mailboxes(user_id) where is_primary;
create index if not exists corporate_mailboxes_user_created_idx
  on public.corporate_mailboxes(user_id, created_at desc);
create trigger t_corporate_mailboxes_touch before update on public.corporate_mailboxes
  for each row execute function public.touch_updated_at();

create table if not exists public.mailbox_audit_events (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references public.corporate_mailboxes(id) on delete set null,
  action public.mailbox_audit_action not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid not null,
  created_at timestamptz not null default now(),
  metadata jsonb
);
create index if not exists mailbox_audit_target_created_idx
  on public.mailbox_audit_events(target_user_id, created_at desc);

insert into public.permissions(key, description) values
  ('mailboxes.read', 'Просматривать корпоративные адреса и их статусы'),
  ('mailboxes.manage', 'Резервировать адреса и управлять корпоративными почтовыми ящиками')
on conflict (key) do update set description = excluded.description;
insert into public.role_permissions(role, permission_key)
select 'admin', key from public.permissions where key in ('mailboxes.read', 'mailboxes.manage')
on conflict do nothing;

alter table public.corporate_mailboxes enable row level security;
alter table public.mailbox_audit_events enable row level security;
revoke all on public.corporate_mailboxes, public.mailbox_audit_events from anon, authenticated;
grant select (id, user_id, email, local_part, domain, status, provider, is_primary, created_at, updated_at, disabled_at)
  on public.corporate_mailboxes to authenticated;
grant select on public.mailbox_audit_events to authenticated;
grant all on public.corporate_mailboxes, public.mailbox_audit_events to service_role;

create policy "Read own or permitted corporate mailbox" on public.corporate_mailboxes
  for select to authenticated
  using (public.is_active_user(auth.uid()) and (user_id = auth.uid() or public.has_permission('mailboxes.read')));
create policy "Read permitted mailbox audit" on public.mailbox_audit_events
  for select to authenticated
  using (public.has_permission('mailboxes.read'));

comment on table public.corporate_mailboxes is
  'Provider-neutral mailbox registry. A pending row does not mean a real mailbox exists.';
comment on column public.corporate_mailboxes.metadata is
  'Non-secret provider metadata only. Never store mailbox passwords, tokens, or invitation secrets.';
