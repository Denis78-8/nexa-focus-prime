-- Editable knowledge base articles (Cloud). Built-in articles stay in the app
-- code (src/lib/knowledge-base.ts) and are not copied here.
-- Structure mirrors the built-in model: category, summary, sections with typed
-- blocks (p / list / code / note / warning), important notes and related
-- article ids (built-in ids or Cloud uuids).
-- Read: every active employee. Write: the new knowledge.write permission,
-- granted to the admin role and access level 5 and managed in the existing
-- permission matrix. Authorship and timestamps are set by the database only.

insert into public.permissions(key, description) values
  ('knowledge.write', 'Создавать и редактировать статьи базы знаний')
on conflict (key) do update set description = excluded.description;
insert into public.role_permissions(role, permission_key) values ('admin', 'knowledge.write')
on conflict do nothing;
insert into public.access_level_permissions(access_level, permission_key) values (5, 'knowledge.write')
on conflict do nothing;

create table if not exists public.knowledge_base_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  category text not null check (category in ('Backend', 'Auth', 'Database', 'Security', 'DevOps')),
  summary text not null default '' check (char_length(summary) <= 600),
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  important_notes text[] not null default '{}',
  related_articles text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists knowledge_base_articles_category_idx on public.knowledge_base_articles(category);

-- Validates the sections JSON: [{ heading: text, blocks: [{ type, ... }] }].
create or replace function public.kb_sections_valid(_sections jsonb)
returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  _section jsonb;
  _block jsonb;
  _type text;
begin
  if jsonb_typeof(_sections) <> 'array' or jsonb_array_length(_sections) > 40 then return false; end if;
  for _section in select value from jsonb_array_elements(_sections) loop
    if jsonb_typeof(_section) <> 'object'
       or jsonb_typeof(_section -> 'heading') <> 'string'
       or char_length(_section ->> 'heading') not between 1 and 200
       or jsonb_typeof(_section -> 'blocks') <> 'array'
       or jsonb_array_length(_section -> 'blocks') > 60 then
      return false;
    end if;
    for _block in select value from jsonb_array_elements(_section -> 'blocks') loop
      _type := _block ->> 'type';
      if _type in ('p', 'note', 'warning') then
        if jsonb_typeof(_block -> 'text') <> 'string' or char_length(_block ->> 'text') not between 1 and 5000 then return false; end if;
      elsif _type = 'code' then
        if jsonb_typeof(_block -> 'code') <> 'string' or char_length(_block ->> 'code') not between 1 and 10000 then return false; end if;
      elsif _type = 'list' then
        if jsonb_typeof(_block -> 'items') <> 'array' or jsonb_array_length(_block -> 'items') not between 1 and 50 then return false; end if;
        if exists (select 1 from jsonb_array_elements(_block -> 'items') i where jsonb_typeof(i.value) <> 'string' or char_length(i.value #>> '{}') not between 1 and 1000) then return false; end if;
      else
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- Authorship and timestamps come from the database, never from the client.
create or replace function public.kb_articles_stamp()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.kb_sections_valid(new.sections) then
    raise exception 'Некорректная структура статьи';
  end if;
  if coalesce(array_length(new.related_articles, 1), 0) > 20 or coalesce(array_length(new.important_notes, 1), 0) > 20 then
    raise exception 'Слишком много связанных статей или важных заметок';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := new.created_at;
    new.updated_by := null;
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  if new.created_by is null then raise exception 'Требуется вход'; end if;
  return new;
end;
$$;
drop trigger if exists t_kb_articles_stamp on public.knowledge_base_articles;
create trigger t_kb_articles_stamp before insert or update on public.knowledge_base_articles
  for each row execute function public.kb_articles_stamp();

alter table public.knowledge_base_articles enable row level security;
revoke all on public.knowledge_base_articles from public, anon;
grant select, insert, update, delete on public.knowledge_base_articles to authenticated;
grant all on public.knowledge_base_articles to service_role;

drop policy if exists "Active users read articles" on public.knowledge_base_articles;
create policy "Active users read articles" on public.knowledge_base_articles for select to authenticated
  using (public.is_active_user(auth.uid()));
drop policy if exists "Writers create articles" on public.knowledge_base_articles;
create policy "Writers create articles" on public.knowledge_base_articles for insert to authenticated
  with check (public.has_permission('knowledge.write'));
drop policy if exists "Writers update articles" on public.knowledge_base_articles;
create policy "Writers update articles" on public.knowledge_base_articles for update to authenticated
  using (public.has_permission('knowledge.write')) with check (public.has_permission('knowledge.write'));
drop policy if exists "Writers delete articles" on public.knowledge_base_articles;
create policy "Writers delete articles" on public.knowledge_base_articles for delete to authenticated
  using (public.has_permission('knowledge.write'));

notify pgrst, 'reload schema';
