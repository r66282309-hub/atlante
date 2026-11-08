-- Schema di partenza per Atlante.
-- Eseguire nel SQL Editor di Supabase dopo aver verificato i permessi desiderati.

create table if not exists public.waypoints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  area text not null default '',
  category text not null default 'natura'
    check (category in ('natura', 'mare', 'borghi', 'trekking')),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  visited_at date,
  description text not null default '',
  photos text[] not null default '{}',
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waypoints_published_date_idx on public.waypoints (visited_at desc) where published = true;
alter table public.waypoints enable row level security;

-- Soltanto gli utenti elencati qui possono inserire o modificare contenuti.
-- Dopo aver creato il tuo account Auth, abilitalo nel SQL Editor:
-- insert into public.atlas_editors (user_id) values ('IL-TUO-USER-UUID');
create table if not exists public.atlas_editors (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.atlas_editors enable row level security;
create policy "Gli editor vedono solo la propria abilitazione"
on public.atlas_editors for select to authenticated
using (user_id = (select auth.uid()));

-- Visitatori: possono leggere solo waypoint pubblicati.
-- Proprietario autenticato: può leggere anche le proprie bozze.
create policy "Lettura dei waypoint pubblicati o propri"
on public.waypoints for select to anon, authenticated
using (published = true or owner_id = (select auth.uid()));

create policy "Inserimento di waypoint propri"
on public.waypoints for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);

create policy "Modifica di waypoint propri"
on public.waypoints for update to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);

create policy "Cancellazione di waypoint propri"
on public.waypoints for delete to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);

-- Le foto pubbliche sono visibili a chiunque conosca l'URL.
-- Se vorrai foto private prima della pubblicazione, useremo invece un bucket privato.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('waypoint-photos', 'waypoint-photos', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

-- Upload soltanto da utenti autenticati, in cartelle intestate al proprio user ID.
create policy "Carica foto nella propria cartella"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'waypoint-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);

create policy "Aggiorna foto nella propria cartella"
on storage.objects for update to authenticated
using (
  bucket_id = 'waypoint-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
)
with check (
  bucket_id = 'waypoint-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);

create policy "Elimina foto dalla propria cartella"
on storage.objects for delete to authenticated
using (
  bucket_id = 'waypoint-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.atlas_editors where user_id = (select auth.uid()))
);
