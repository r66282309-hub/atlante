# Atlante — diario geografico personale

Un sito statico pensato per GitHub Pages: **Leaflet + OpenStreetMap + vista satellite**, elenco di waypoint, fotografie, ricerca, filtri, coordinate ed esportazione GeoJSON. È già predisposto alla lettura da **Supabase**. Comprende anche lo **studio Geostorie** per comporre racconti geografici multimediali.

## Geostorie (`dist/storie/`)

L'editor è accessibile dalla voce **Geostorie** dell'Atlante dopo il login di un account autorizzato. Puoi:

- Creare e gestire più bozze, duplicarle o eliminarle con conferma;
- Aggiungere titoli, paragrafi, waypoint collegati all'Atlante, fotografie, video YouTube e mini-mappe Leaflet (OSM o satellite), cambiandone l'ordine;
- Inserire foto tramite URL o caricamento dal computer. Le immagini locali vengono ridimensionate e conservate nella bozza;
- Passare da modifica ad anteprima, importare ed esportare storie in **JSON**, incluse le foto incorporate.

**Importante:** il login protegge l'interfaccia, ma **le bozze dell'editor attuale sono ancora salvate nell'IndexedDB del browser**. Non sono sincronizzate fra PC. Usa **Esporta** per una copia di sicurezza. Il pulsante «Aggiungi luogo» nella mappa è predisposto all'autenticazione; il modulo di inserimento verrà collegato nel passo successivo.

Il progetto Supabase `atlante-enrico` dispone già delle tabelle `waypoints`, `geostories`, `geostory_waypoints`, `atlas_editors` e del bucket `waypoint-photos`. **Non rieseguire gli script SQL iniziali**, già applicati.

## Avvio

- Il sito è interamente nella cartella `dist/`. Per provarlo in locale, usa un server HTTP (per esempio `python -m http.server 8000 --directory dist`), poi apri `http://localhost:8000`.
- Finché non ci sono waypoint pubblicati su Supabase, mostra **cinque waypoint dimostrativi** con immagini illustrative, non foto reali dei luoghi.
- I punti dimostrativi si trovano in `dist/data/waypoints.json` e possono essere modificati o sostituiti.

## Pubblicazione su GitHub Pages

1. Crea un repository GitHub, per esempio `atlante`, e carica **tutti i file del progetto**, inclusa la cartella nascosta `.github`.
2. Nelle impostazioni del repository vai su **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Un push su `main` avvia il workflow `.github/workflows/pages.yml`, che pubblica il contenuto di `dist/`.
4. Visita `https://<tuo-username>.github.io/atlante/` (il nome finale dipende dal repository).

Non serve un backend dedicato né un processo di compilazione.

## Accesso amministratore con Supabase Auth

1. Apri la mappa o le geostorie e premi **Accedi**. Se non hai ancora un utente Supabase, inserisci email e password e premi **Crea account**.
2. Conferma la registrazione tramite email, se richiesta da Supabase, quindi accedi.
3. Il tuo account sarà **autenticato ma senza permessi di modifica** fino a quando il suo UUID non sarà inserito dall'amministratore in `public.atlas_editors`.
4. Per autorizzare un utente verificato: nel SQL Editor del progetto **atlante-enrico** (non `soil_point`), esegui `insert into public.atlas_editors (user_id) values ('UUID-UTENTE-VERIFICATO');`. Gli UUID si trovano sotto **Authentication → Users**. La chiave di servizio non deve mai essere incorporata nel sito.
5. Torna al sito, apri **Account** e premi **Ricontrolla autorizzazione**. Adesso l'editor sarà accessibile.

Il frontend usa soltanto la **publishable key** di Supabase. Le autorizzazioni vere sono nel database, mediante **RLS** e la lista `atlas_editors`. Gli altri utenti possono consultare solo i record `published = true` e **non possono scrivere**.

Prima di inviare email di conferma e recupero password, in **Supabase → Authentication → URL Configuration** imposta il Site URL del tuo Atlante e aggiungi agli URL di redirect sia la versione GitHub Pages sia quella Sites (se le usi entrambe).

Le policy per consentire agli editor autorizzati le modifiche sono in `supabase/enable_editor_access.sql`, **già applicato** al progetto.

Per ora il sito legge i waypoint pubblicati e offre il login. Il **salvataggio remoto di nuovi waypoint, geostorie e fotografie** sarà il prossimo passo; le bozze esistenti restano locali.

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
| `owner_id` | `uuid` (facoltativo) | Utente Auth che ha creato il record, oppure nullo per gestione amministrativa |

L'esportazione GeoJSON utilizza longitudine, latitudine nell'ordine richiesto dalla specifica GeoJSON.

## Sfondi cartografici

- OSM usa il servizio pubblico `tile.openstreetmap.org`, con attribuzione visibile. Per traffico consistente o funzionalità avanzate, segui la [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- La modalità Satellite usa **l'URL non ufficiale fornito nel brief** (`mt0.google.com/vt/lyrs=s...`), configurato in `dist/config.js`. **Non è una integrazione autorizzata tramite Google Maps Platform**: disponibilità, limiti e termini d'uso non sono garantiti. Prima di distribuire pubblicamente su larga scala, migra a un servizio imagery con licenza compatibile, per esempio la [Google Maps Tile API ufficiale](https://developers.google.com/maps/documentation/tile) con le relative policy, chiave e fatturazione.

## Struttura

```text
dist/
  index.html            Interfaccia Leaflet
  styles.css            Layout e responsive
  auth.css / auth.js     Login e stato dell'editor
  app.js                Ricerca, filtri, marker, dettagli e Supabase (lettura)
  config.js             Configurazione sfondi e Supabase
  data/waypoints.json   Esempi dimostrativi
  storie/               Studio Geostorie (HTML, CSS, JS)
supabase/schema.sql     Tabelle e policy di accesso
supabase/geostories.sql Schema per le geostorie future
supabase/enable_editor_access.sql  Permessi per gli editor autorizzati
.github/workflows/     Deploy GitHub Pages
```

Il sito funziona su GitHub Pages e altri host statici. I percorsi delle risorse sono relativi, quindi anche un URL con sottocartella (`/atlante/`) è supportato.
