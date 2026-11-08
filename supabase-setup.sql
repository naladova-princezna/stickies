-- ============================================================
-- Stickies – schéma databáze pro Supabase
-- Vlož celý soubor do Supabase → SQL Editor → Run. Lze spustit opakovaně.
-- ============================================================

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  color       text not null default 'violet' check (color in ('violet','teal','pink','amber','blue','lime')),
  pos         bigint not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id  uuid not null references public.categories(id) on delete cascade,
  text         text not null check (char_length(text) between 1 and 200),
  status       text not null default 'backlog' check (status in ('backlog','today','done')),
  done_at      timestamptz,
  pos          bigint not null default 0,
  updated_at   timestamptz not null default now()
);

create index if not exists categories_user_idx on public.categories (user_id);
create index if not exists tasks_user_status_idx on public.tasks (user_id, status);

-- ---------- Řízení přístupu: každý vidí a mění jen svoje řádky ----------
alter table public.categories enable row level security;
alter table public.tasks      enable row level security;

drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.categories c where c.id = category_id and c.user_id = auth.uid())
  );

-- Anonymní (nepřihlášení) nemají k tabulkám žádný přístup
revoke all on public.categories from anon;
revoke all on public.tasks      from anon;

-- ---------- Živá synchronizace mezi zařízeními ----------
do $$ begin
  alter publication supabase_realtime add table public.categories;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;
