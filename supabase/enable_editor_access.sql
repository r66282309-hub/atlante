-- Eseguire nel progetto atlante-enrico. Solo i singoli UID elencati
-- in public.atlas_editors possono modificare i dati dal sito.
-- Non inserire indirizzi email o password in questo file pubblico.

grant insert, update, delete on public.waypoints, public.geostories,
  public.geostory_waypoints to authenticated;

-- SELECT pubblico rimane protetto dalle policy published = true.
-- La policy FOR ALL concede agli editor autorizzati accesso anche alle bozze.
create policy "Atlante editor waypoint"
on public.waypoints for all to authenticated
using (
  exists (select 1 from public.atlas_editors e where e.user_id = (select auth.uid()))
)
with check (
  (owner_id is null or owner_id = (select auth.uid()))
  and exists (select 1 from public.atlas_editors e where e.user_id = (select auth.uid()))
);

create policy "Atlante editor geostorie"
on public.geostories for all to authenticated
using (
  exists (select 1 from public.atlas_editors e where e.user_id = (select auth.uid()))
)
with check (
  (owner_id is null or owner_id = (select auth.uid()))
  and exists (select 1 from public.atlas_editors e where e.user_id = (select auth.uid()))
);

create policy "Atlante editor collegamenti"
on public.geostory_waypoints for all to authenticated
using (
  exists (select 1 from public.atlas_editors e where e.user_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.atlas_editors e where e.user_id = (select auth.uid()))
);

-- I contenuti Storage sono pubblici in download; modifiche solo tramite UID
-- autorizzato e nella cartella intestata al relativo utente.
create policy "Atlante editor fotografie"
on storage.objects for all to authenticated
using (
  bucket_id = 'waypoint-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.atlas_editors e where e.user_id = (select auth.uid()))
)
with check (
  bucket_id = 'waypoint-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.atlas_editors e where e.user_id = (select auth.uid()))
);
