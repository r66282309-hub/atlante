/* Le chiavi publishable/anon di Supabase sono pubbliche per definizione.
   NON inserire mai qui una service_role key o altre credenziali segrete.
   Configura sempre le policy RLS prima di connettere il progetto. */
window.ATLAS_CONFIG = {
  map: {
    center: [40.08, 9.04],
    zoom: 8,
    minZoom: 5,
    maxZoom: 19
  },
  satellite: {
    // Endpoint fornito dall'utente: non è l'API Google Maps Tiles ufficiale.
    // Potrebbe essere soggetto a limitazioni d'uso o cessare di funzionare.
    url: 'https://mt0.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}',
    attribution: '&copy; Google',
    maxNativeZoom: 20
  },
  supabase: {
    url: 'https://rcfbtwxnxvfzgtgzxwdn.supabase.co',
    anonKey: 'sb_publishable_5C89qxe4wIj2lAqBy1v4vw_Z2g0InMU',
    table: 'waypoints',
    photoBucket: 'waypoint-photos'
  }
};
