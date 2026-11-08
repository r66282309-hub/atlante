-- Predisposizione futura per pubblicare Geostorie su Supabase.
-- Eseguire DOPO schema.sql, quando sarà configurato il login dell'editor.
-- Non è ancora usata dall'editor locale (che salva in IndexedDB).

create table if not exists public.geostories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  title text not null,
  subtitle text not null default '',
  kicker text not null default 'DIARIO DI VIAGGIO',
  cover text not null default '',
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists geostories_published_idx
  on public.geostories (updated_at desc) where published = true;

alter table public.geostories enable row level security;

create policy "Leggi geostorie pubbliche o proprie"
on public.geostories for select to anon, authenticated
using (published = true or owner_id = (select auth.uid()));

create policy "Crea geostorie da editor abilitati"
on public.geostories for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);

create policy "Modifica geostorie proprie"
on public.geostories for update to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);

create policy "Elimina geostorie proprie"
on public.geostories for delete to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);
