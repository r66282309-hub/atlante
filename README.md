# Atlante — diario geografico personale

Un sito statico pensato per GitHub Pages: **Leaflet + OpenStreetMap + vista satellite**, elenco di waypoint, fotografie, ricerca, filtri, coordinate ed esportazione GeoJSON. È già predisposto alla lettura da **Supabase**.

## Avvio

- Il sito è interamente nella cartella `dist/`. Per provarlo in locale, usa un server HTTP (per esempio `python -m http.server 8000 --directory dist`), poi apri `http://localhost:8000`.
- In assenza di configurazione Supabase mostra **cinque waypoint dimostrativi** con immagini illustrative, non foto reali dei luoghi.
- I punti dimostrativi si trovano in `dist/data/waypoints.json` e possono essere modificati o sostituiti.

## Pubblicazione su GitHub Pages

1. Crea un repository GitHub, per esempio `atlante`, e carica **tutti i file del progetto**, inclusa la cartella nascosta `.github`.
2. Nelle impostazioni del repository vai su **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Un push su `main` avvia il workflow `.github/workflows/pages.yml`, che pubblica il contenuto di `dist/`.
4. Visita `https://<tuo-username>.github.io/atlante/` (il nome finale dipende dal repository).

Non serve un backend dedicato né un processo di compilazione.

## Quando collegherai Supabase

1. Crea un progetto Supabase ed esegui `supabase/schema.sql` nel suo SQL Editor. **Leggi le policy e verifica che l'accesso corrisponda a ciò che vuoi pubblicare.**
2. Apri `dist/config.js` e inserisci `supabase.url` e `supabase.anonKey` (oppure la nuova *publishable key*). Questi valori sono progettati per il frontend; **non inserire mai la service role key**.
3. Crea un utente per te in Supabase Auth. Recupera il suo UUID dalla sezione Users ed esegui nel SQL Editor `insert into public.atlas_editors (user_id) values ('IL-TUO-USER-UUID');`. In questo modo **solo gli account che autorizzi** potranno caricare o modificare luoghi. Per i futuri upload, ogni waypoint avrà `owner_id = auth.uid()`, e le foto andranno nel bucket `waypoint-photos` con un percorso del tipo `<user-id>/foto.jpg`.
4. I waypoint con `published = true` verranno letti automaticamente all'apertura del sito. Quando il collegamento è attivo, gli esempi scompaiono.

La prima versione integra **solo la lettura** dal database: il pulsante «Aggiungi luogo» mostra un pannello informativo. L'editor protetto da autenticazione e l'upload di foto saranno implementati nel passo successivo, quando saranno disponibili i dati del progetto Supabase e decideremo come gestire il login.

### Colonne attese

| Campo | Tipo | Uso |
| --- | --- | --- |
| `id` | `uuid` | Identificativo |
| `title` | `text` | Nome del luogo |
| `area` | `text` | Località, provincia o zona |
| `category` | `text` | `natura`, `mare`, `borghi`, `trekking` |
| `lat`, `lon` | `double precision` | Coordinate WGS84 (EPSG:4326) |
| `visited_at` | `date` | Data della visita |
| `description` | `text` | Descrizione o appunti |
| `photos` | `text[]` | Percorsi delle fotografie nel bucket o URL HTTP(S) |
| `published` | `boolean` | Mostra il luogo sul sito pubblico |
| `owner_id` | `uuid` | Proprietario autenticato |

L'esportazione GeoJSON utilizza longitudine, latitudine nell'ordine richiesto dalla specifica GeoJSON.

## Sfondi cartografici

- OSM usa il servizio pubblico `tile.openstreetmap.org`, con attribuzione visibile. Per traffico consistente o funzionalità avanzate, segui la [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- La modalità Satellite usa **l'URL non ufficiale fornito nel brief** (`mt0.google.com/vt/lyrs=s...`), configurato in `dist/config.js`. **Non è una integrazione autorizzata tramite Google Maps Platform**: disponibilità, limiti e termini d'uso non sono garantiti. Prima di distribuire pubblicamente su larga scala, migra a un servizio imagery con licenza compatibile, per esempio la [Google Maps Tile API ufficiale](https://developers.google.com/maps/documentation/tile) con le relative policy, chiave e fatturazione.

## Struttura

```text
dist/
  index.html            Interfaccia Leaflet
  styles.css            Layout e responsive
  app.js                Ricerca, filtri, marker, dettagli e Supabase (lettura)
  config.js             Configurazione sfondi e Supabase
  data/waypoints.json   Esempi dimostrativi
supabase/schema.sql     Tabelle e policy di accesso
.github/workflows/     Deploy GitHub Pages
```

Il sito funziona su GitHub Pages e altri host statici. I percorsi delle risorse sono relativi, quindi anche un URL con sottocartella (`/atlante/`) è supportato.
