(() => {
  'use strict';

  const config = window.ATLAS_CONFIG;
  const $ = id => document.getElementById(id);
  const labels = { natura: 'Natura', mare: 'Mare', borghi: 'Borghi', trekking: 'Trekking' };
  const symbols = { natura: '✳', mare: '≈', borghi: '⌂', trekking: '▲' };
  const state = { all: [], visible: [], selectedId: null, category: 'tutti', query: '', demo: true, markers: new Map(), storiesByWaypoint: new Map(), photoIndex: 0, currentLayer: 'osm', editingId: null, retainedPhotos: [], saving: false, picking: false };
  let map;
  let markersGroup;
  let osmLayer;
  let satelliteLayer;
  let toastTimer;
  let supabase;
  let userPosition;

  function safeImage(input) {
    if (typeof input !== 'string' || !input.trim()) return null;
    try {
      const url = new URL(input, location.href);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function toWaypoint(row, demo = false) {
    const lat = Number(row.lat ?? row.latitude);
    const lon = Number(row.lon ?? row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const photos = Array.isArray(row.photos) ? row.photos : [];
    return {
      id: String(row.id), title: String(row.title || 'Senza titolo'),
      area: String(row.area || ''), category: labels[row.category] ? row.category : 'natura',
      lat, lon, visited_at: row.visited_at || null,
      description: String(row.description || 'Nessuna descrizione disponibile.'),
      photoPaths: photos.slice(),
      published: Boolean(row.published),
      photos: photos.map(photo => {
        if (typeof photo !== 'string') return null;
        if (/^https?:\/\//i.test(photo)) return safeImage(photo);
        if (supabase) return safeImage(supabase.storage.from(config.supabase.photoBucket).getPublicUrl(photo).data.publicUrl);
        return null;
      }).filter(Boolean),
      demo: demo || Boolean(row.demo)
    };
  }

  function formatDate(input) {
    if (!input) return '';
    const date = new Date(`${String(input).slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function showToast(message) {
    const toast = $('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  function initMap() {
    if (!window.L) {
      $('map').textContent = 'Impossibile caricare Leaflet. Controlla la connessione Internet.';
      return false;
    }
    map = L.map('map', { zoomControl: false, scrollWheelZoom: true, minZoom: config.map.minZoom, maxZoom: config.map.maxZoom })
      .setView(config.map.center, config.map.zoom);
    L.control.zoom({ position: 'topleft' }).addTo(map);
    osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    satelliteLayer = L.tileLayer(config.satellite.url, {
      attribution: config.satellite.attribution,
      maxNativeZoom: config.satellite.maxNativeZoom || 20,
      maxZoom: config.map.maxZoom,
      crossOrigin: false
    });
    markersGroup = L.featureGroup().addTo(map);
    let satelliteErrors = 0;
    satelliteLayer.on('tileerror', () => {
      if (state.currentLayer !== 'satellite') return;
      if (++satelliteErrors === 4) {
        setBaseLayer('osm');
        showToast('Satellite non disponibile. Ripristinata OpenStreetMap.');
      }
    });
    satelliteLayer.on('loading', () => { satelliteErrors = 0; });
    return true;
  }

  function markerIcon(place, isSelected = false) {
    const category = place.category;
    return L.divIcon({
      className: 'atlas-marker-wrap',
      html: `<span class="atlas-marker ${category}${isSelected ? ' selected' : ''}${place.published || place.demo ? '' : ' is-draft'}"><i aria-hidden="true">${symbols[category]}</i></span>`,
      iconSize: [42, 42], iconAnchor: [19, 39]
    });
  }

  function setBaseLayer(mode) {
    if (!map || state.currentLayer === mode) return;
    if (mode === 'satellite') {
      map.removeLayer(osmLayer);
      satelliteLayer.addTo(map);
    } else {
      map.removeLayer(satelliteLayer);
      osmLayer.addTo(map);
    }
    state.currentLayer = mode;
    $('osmButton').classList.toggle('is-active', mode === 'osm');
    $('satelliteButton').classList.toggle('is-active', mode === 'satellite');
    $('osmButton').setAttribute('aria-pressed', String(mode === 'osm'));
    $('satelliteButton').setAttribute('aria-pressed', String(mode === 'satellite'));
  }

  function makePlaceCard(place) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `place-card${state.selectedId === place.id ? ' selected' : ''}${!place.demo && !place.published ? ' is-draft' : ''}`;
    item.setAttribute('aria-label', `Mostra ${place.title} sulla mappa`);

    const thumb = document.createElement('span');
    thumb.className = 'place-thumb';
    if (place.photos[0]) {
      const image = document.createElement('img');
      image.src = place.photos[0];
      image.alt = place.demo ? 'Immagine illustrativa' : `Foto di ${place.title}`;
      image.loading = 'lazy';
      image.onerror = () => image.remove();
      thumb.append(image);
    }
    const data = document.createElement('span');
    data.className = 'place-data';
    const category = document.createElement('span');
    category.className = 'place-category';
    category.textContent = `${labels[place.category]}${!place.demo && !place.published ? ' · BOZZA' : ''}`;
    const name = document.createElement('span');
    name.className = 'place-name';
    name.textContent = place.title;
    const area = document.createElement('span');
    area.className = 'place-area';
    area.textContent = place.area || `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`;
    data.append(category, name, area);
    const arrow = document.createElement('span');
    arrow.className = 'place-arrow';
    arrow.textContent = '↗';
    item.append(thumb, data, arrow);
    item.addEventListener('click', () => openPlace(place.id));
    return item;
  }

  function renderList() {
    const list = $('placeList');
    list.replaceChildren();
    $('visibleCount').textContent = String(state.visible.length);
    if (!state.visible.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const heading = document.createElement('strong');
      heading.textContent = state.all.length ? 'Nessun risultato' : 'La mappa ti aspetta';
      const body = document.createElement('span');
      body.textContent = state.all.length ? 'Prova un’altra ricerca o categoria.' : 'I tuoi waypoint compariranno qui.';
      empty.append(heading, body);
      list.append(empty);
      return;
    }
    state.visible.forEach(place => list.append(makePlaceCard(place)));
  }

  function renderMarkers() {
    if (!map) return;
    markersGroup.clearLayers();
    state.markers.clear();
    state.visible.forEach(place => {
      const marker = L.marker([place.lat, place.lon], { icon: markerIcon(place, place.id === state.selectedId), title: place.title });
      marker.on('click', () => openPlace(place.id));
      marker.addTo(markersGroup);
      state.markers.set(place.id, marker);
    });
  }

  function filterPlaces() {
    const query = state.query.trim().toLocaleLowerCase('it-IT');
    state.visible = state.all.filter(place =>
      (state.category === 'tutti' || place.category === state.category) &&
      (!query || [place.title, place.area, place.description].some(value => value.toLocaleLowerCase('it-IT').includes(query)))
    );
    if (state.selectedId && !state.visible.some(place => place.id === state.selectedId)) closePlace();
    renderList();
    renderMarkers();
  }

  function fitAll() {
    if (!map) return;
    if (!state.visible.length) { map.setView(config.map.center, config.map.zoom); return; }
    if (state.visible.length === 1) { map.flyTo([state.visible[0].lat, state.visible[0].lon], 12, { duration: .6 }); return; }
    const bounds = L.latLngBounds(state.visible.map(place => [place.lat, place.lon]));
    map.flyToBounds(bounds, { padding: [75, 75], maxZoom: 12, duration: .7 });
  }

  function setDetailImage(place, index) {
    state.photoIndex = index;
    const cover = $('detailPhoto');
    cover.style.backgroundImage = place.photos[index] ? `linear-gradient(0deg,rgba(15,45,40,.18),rgba(15,45,40,.02)),url("${place.photos[index].replaceAll('"', '%22')}")` : '';
    cover.querySelector('.detail-photo-tag').textContent = place.demo ? 'FOTO ILLUSTRATIVA' : place.photos.length ? `FOTO ${index + 1} / ${place.photos.length}` : 'NESSUNA FOTOGRAFIA';
    [...$('photoStrip').children].forEach((button, i) => button.classList.toggle('active', i === index));
  }

  function renderRelatedStories(place) {
    const section = $('placeStories');
    const list = $('placeStoriesList');
    const stories = state.storiesByWaypoint.get(place.id) || [];
    list.replaceChildren();
    section.hidden = !stories.length;
    for (const story of stories) {
      const link = document.createElement('a');
      link.className = 'place-story-link';
      link.href = `./storie/?story=${encodeURIComponent(story.id)}`;
      const text = document.createElement('span');
      text.textContent = story.title || 'Geostoria senza titolo';
      const arrow = document.createElement('span');
      arrow.className = 'place-story-arrow';
      arrow.textContent = '↗';
      link.append(text, arrow);
      if (!story.published && window.atlasAuth?.editor) {
        const draft = document.createElement('small');
        draft.textContent = 'BOZZA PRIVATA';
        text.append(draft);
      }
      list.append(link);
    }
  }

  function openPlace(id) {
    const place = state.all.find(item => item.id === id);
    if (!place || !state.visible.includes(place)) return;
    state.selectedId = id;
    renderList();
    renderMarkers();
    $('detailCategory').textContent = `${labels[place.category].toLocaleUpperCase('it-IT')}${!place.demo && !place.published ? ' · BOZZA' : ''}`;
    $('detailDate').textContent = formatDate(place.visited_at);
    $('detailTitle').textContent = place.title;
    $('detailArea').textContent = place.area;
    $('detailDescription').textContent = place.description;
    renderRelatedStories(place);
    $('detailCoords').textContent = `${place.lat.toFixed(5)}° N, ${place.lon.toFixed(5)}° E`;
    $('editPlaceButton').hidden = !(window.atlasAuth?.editor && !place.demo);
    const strip = $('photoStrip');
    strip.replaceChildren();
    place.photos.forEach((url, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Mostra foto ${i + 1} di ${place.title}`);
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Anteprima foto ${i + 1}`;
      button.append(img);
      button.addEventListener('click', () => setDetailImage(place, i));
      strip.append(button);
    });
    strip.style.display = place.photos.length > 1 ? 'flex' : 'none';
    setDetailImage(place, 0);
    const panel = $('detailPanel');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    map.flyTo([place.lat, place.lon], Math.max(map.getZoom(), 11), { duration: .7 });
    if (window.innerWidth > 760) setTimeout(() => map.panBy([Math.min(165, map.getSize().x * .12), 0], { animate: true, duration: .3 }), 760);
  }

  function closePlace() {
    state.selectedId = null;
    $('detailPanel').classList.remove('open');
    $('detailPanel').setAttribute('aria-hidden', 'true');
    renderList();
    renderMarkers();
  }

  function downloadGeoJSON() {
    const collection = {
      type: 'FeatureCollection',
      name: 'atlante-waypoints',
      features: state.visible.map(place => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
        properties: { id: place.id, title: place.title, area: place.area, category: place.category, visited_at: place.visited_at, description: place.description, photos: place.photos }
      }))
    };
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(collection, null, 2)], { type: 'application/geo+json' }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'atlante-waypoints.geojson';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    showToast(`${state.visible.length} waypoint esportati in GeoJSON`);
  }

  function locateMe() {
    if (!navigator.geolocation) { showToast('Geolocalizzazione non disponibile in questo browser.'); return; }
    showToast('Ricerca della tua posizione…');
    navigator.geolocation.getCurrentPosition(position => {
      const point = [position.coords.latitude, position.coords.longitude];
      if (userPosition) map.removeLayer(userPosition);
      userPosition = L.circleMarker(point, { radius: 7, color: '#fff', weight: 3, fillColor: '#3a85bd', fillOpacity: 1 }).addTo(map);
      userPosition.bindTooltip('La tua posizione');
      map.flyTo(point, 12, { duration: .8 });
    }, () => showToast('Posizione non disponibile o autorizzazione negata.'), { enableHighAccuracy: false, timeout: 12000 });
  }

  function formMessage(message, error = false) {
    const node = $('waypointFormStatus');
    node.textContent = message;
    node.classList.toggle('is-error', error);
  }

  function imageLink(path) {
    if (/^https?:\/\//i.test(path)) return safeImage(path);
    return safeImage(supabase.storage.from(config.supabase.photoBucket).getPublicUrl(path).data.publicUrl);
  }

  function renderExistingPhotos() {
    const list = $('waypointExistingPhotos');
    list.replaceChildren();
    state.retainedPhotos.forEach((path, i) => {
      const url = imageLink(path);
      if (!url) return;
      const wrapper = document.createElement('span');
      wrapper.className = 'waypoint-existing-photo';
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Fotografia ${i + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Rimuovi la fotografia dal waypoint';
      remove.setAttribute('aria-label', `Rimuovi foto ${i + 1}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => { state.retainedPhotos.splice(i, 1); renderExistingPhotos(); });
      wrapper.append(img, remove);
      list.append(wrapper);
    });
  }

  function openWaypointEditor(id = null) {
    if (!window.atlasAuth?.editor) { window.atlasAuth?.open(); return; }
    const place = state.all.find(item => item.id === id && !item.demo);
    state.editingId = place?.id || null;
    state.retainedPhotos = place ? place.photoPaths.slice() : [];
    $('waypointForm').reset();
    $('waypointDialogTitle').innerHTML = place ? 'Modifica <em>luogo.</em>' : 'Nuovo <em>luogo.</em>';
    $('waypointTitle').value = place?.title || '';
    $('waypointArea').value = place?.area || '';
    $('waypointCategory').value = place?.category || 'natura';
    $('waypointLat').value = place?.lat ?? map.getCenter().lat.toFixed(6);
    $('waypointLon').value = place?.lon ?? map.getCenter().lng.toFixed(6);
    $('waypointVisited').value = place?.visited_at || '';
    $('waypointDescription').value = place?.description === 'Nessuna descrizione disponibile.' ? '' : place?.description || '';
    $('waypointPublished').checked = place?.published || false;
    $('waypointDelete').hidden = !place;
    formMessage('');
    renderExistingPhotos();
    $('waypointDialog').showModal();
    $('waypointTitle').focus();
  }

  function pickPointOnMap() {
    if (state.picking || state.saving) return;
    state.picking = true;
    $('waypointDialog').close();
    const banner = document.createElement('div');
    banner.className = 'waypoint-pick-banner';
    banner.textContent = 'Fai clic sulla mappa per posizionare il waypoint';
    document.querySelector('.map-area').append(banner);
    map.getContainer().style.cursor = 'crosshair';
    map.once('click', event => {
      $('waypointLat').value = event.latlng.lat.toFixed(6);
      $('waypointLon').value = event.latlng.lng.toFixed(6);
      banner.remove();
      map.getContainer().style.cursor = '';
      state.picking = false;
      $('waypointDialog').showModal();
      formMessage('Coordinate selezionate dalla mappa.');
    });
  }

  async function saveWaypoint(event) {
    event.preventDefault();
    if (!window.atlasAuth?.editor || !supabase || state.saving) return;
    const lat = Number($('waypointLat').value);
    const lon = Number($('waypointLon').value);
    if (!$('waypointTitle').value.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      formMessage('Compila il nome e le coordinate valide.', true); return;
    }
    const files = Array.from($('waypointPhotos').files || []);
    if (files.some(file => !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size > 10000000)) {
      formMessage('Usa JPG, PNG, WebP o AVIF, massimo 10 MB a fotografia.', true); return;
    }
    state.saving = true;
    $('waypointSave').disabled = true;
    $('waypointDelete').disabled = true;
    try {
      const id = state.editingId || crypto.randomUUID();
      const photos = state.retainedPhotos.slice();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        formMessage(`Caricamento fotografia ${i + 1} di ${files.length}…`);
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }[file.type];
        const path = `${window.atlasAuth.user.id}/waypoints/${id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from(config.supabase.photoBucket).upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        photos.push(path);
      }
      formMessage('Salvataggio nel database…');
      const payload = {
        id, owner_id: window.atlasAuth.user.id,
        title: $('waypointTitle').value.trim(), area: $('waypointArea').value.trim(),
        category: $('waypointCategory').value, lat, lon,
        visited_at: $('waypointVisited').value || null,
        description: $('waypointDescription').value.trim(), photos,
        published: $('waypointPublished').checked
      };
      const { error } = await supabase.from(config.supabase.table).upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      $('waypointDialog').close();
      showToast(payload.published ? 'Waypoint pubblicato con successo.' : 'Waypoint salvato come bozza privata.');
      await loadPlaces(false);
      if (state.visible.some(place => place.id === id)) openPlace(id);
    } catch (error) {
      console.error('Salvataggio waypoint:', error);
      formMessage(`Non è stato possibile salvare: ${error.message || 'errore sconosciuto'}.`, true);
    } finally {
      state.saving = false;
      $('waypointSave').disabled = false;
      $('waypointDelete').disabled = false;
    }
  }

  async function deleteWaypoint() {
    if (!state.editingId || !window.atlasAuth?.editor || state.saving) return;
    if (!confirm('Eliminare definitivamente questo waypoint? Le fotografie già caricate nello Storage non saranno cancellate.')) return;
    state.saving = true;
    try {
      const { error } = await supabase.from(config.supabase.table).delete().eq('id', state.editingId);
      if (error) throw error;
      $('waypointDialog').close();
      closePlace();
      await loadPlaces(false);
      showToast('Waypoint eliminato.');
    } catch (error) { formMessage(`Eliminazione non riuscita: ${error.message}`, true); }
    finally { state.saving = false; }
  }

  async function loadRelatedStories() {
    state.storiesByWaypoint = new Map();
    if (!supabase) return;
    try {
      let storiesQuery = supabase.from('geostories').select('id,title,published');
      if (!window.atlasAuth?.editor) storiesQuery = storiesQuery.eq('published', true);
      const [storiesResult, linksResult] = await Promise.all([
        storiesQuery,
        supabase.from('geostory_waypoints').select('geostory_id,waypoint_id,position').order('position', { ascending: true })
      ]);
      if (storiesResult.error) throw storiesResult.error;
      if (linksResult.error) throw linksResult.error;
      const stories = new Map((storiesResult.data || []).map(story => [story.id, story]));
      for (const link of linksResult.data || []) {
        const story = stories.get(link.geostory_id);
        if (!story) continue;
        if (!state.storiesByWaypoint.has(link.waypoint_id)) state.storiesByWaypoint.set(link.waypoint_id, []);
        const related = state.storiesByWaypoint.get(link.waypoint_id);
        if (!related.some(item => item.id === story.id)) related.push(story);
      }
      if (state.selectedId) {
        const place = state.all.find(item => item.id === state.selectedId);
        if (place) renderRelatedStories(place);
      }
    } catch (error) { console.warn('Geostorie associate non disponibili:', error); }
  }

  async function loadPlaces(firstLoad = true) {
    const settings = config.supabase;
    if (settings.url && settings.anonKey) {
      try {
        await window.atlasAuth?.ready;
        supabase = window.atlasAuth?.client;
        if (!supabase) throw new Error('Client Supabase non disponibile');
        let query = supabase.from(settings.table).select('id,title,area,category,lat,lon,visited_at,description,photos,published').order('visited_at', { ascending: false });
        if (!window.atlasAuth?.editor) query = query.eq('published', true);
        const { data, error } = await query;
        if (error) throw error;
        state.demo = !data?.length && !window.atlasAuth?.editor;
        state.all = (data || []).map(row => toWaypoint(row)).filter(Boolean);
        await loadRelatedStories();
        if (!state.demo) {
          $('dataStatus').textContent = window.atlasAuth?.editor ? 'Area editor · bozze e pubblicati' : 'Dati pubblicati su Supabase';
          document.querySelector('.data-state').classList.add('connected');
        } else {
          $('dataStatus').textContent = 'Atlante in preparazione · luoghi dimostrativi';
        }
      } catch (error) {
        console.error('Caricamento Supabase:', error);
        $('dataStatus').textContent = 'Supabase non raggiungibile · demo';
        showToast('Errore Supabase: visualizzo i waypoint di esempio.');
      }
    }
    if (state.demo) {
      try {
        const response = await fetch('./data/waypoints.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.all = data.map(row => toWaypoint(row, true)).filter(Boolean);
      } catch (error) {
        console.error('Caricamento esempi:', error);
        showToast('Non riesco a leggere i waypoint dimostrativi.');
      }
    }
    state.all.sort((a, b) => (b.visited_at || '').localeCompare(a.visited_at || ''));
    $('totalCount').textContent = String(state.all.length).padStart(2, '0');
    $('photoCount').textContent = String(state.all.reduce((total, place) => total + place.photos.length, 0)).padStart(2, '0');
    filterPlaces();
    if (firstLoad) {
      const linkedWaypoint = new URLSearchParams(window.location.search).get('waypoint');
      setTimeout(() => {
        if (linkedWaypoint && state.visible.some(place => place.id === linkedWaypoint)) openPlace(linkedWaypoint);
        else fitAll();
      }, 300);
    }
  }

  function bindActions() {
    $('osmButton').addEventListener('click', () => setBaseLayer('osm'));
    $('satelliteButton').addEventListener('click', () => setBaseLayer('satellite'));
    $('fitMapButton').addEventListener('click', fitAll);
    $('fitListButton').addEventListener('click', fitAll);
    $('locateButton').addEventListener('click', locateMe);
    $('searchInput').addEventListener('input', event => { state.query = event.target.value; filterPlaces(); });
    $('filters').addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      state.category = button.dataset.category;
      document.querySelectorAll('.filter').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      filterPlaces();
      fitAll();
    });
    $('closeDetailButton').addEventListener('click', closePlace);
    $('copyCoordsButton').addEventListener('click', async () => {
      const place = state.all.find(item => item.id === state.selectedId);
      if (!place) return;
      try { await navigator.clipboard.writeText(`${place.lat}, ${place.lon}`); showToast('Coordinate copiate negli appunti.'); }
      catch { showToast(`${place.lat}, ${place.lon}`); }
    });
    $('exportButton').addEventListener('click', downloadGeoJSON);
    $('aboutButton').addEventListener('click', () => $('infoDialog').showModal());
    $('addButton').addEventListener('click', () => openWaypointEditor());
    $('editPlaceButton').addEventListener('click', () => openWaypointEditor(state.selectedId));
    $('closeWaypointDialog').addEventListener('click', () => $('waypointDialog').close());
    $('waypointPickMap').addEventListener('click', pickPointOnMap);
    $('waypointForm').addEventListener('submit', event => void saveWaypoint(event));
    $('waypointDelete').addEventListener('click', () => void deleteWaypoint());
    window.addEventListener('atlas-auth-changed', () => { if (supabase) void loadPlaces(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.selectedId) closePlace(); });
  }

  bindActions();
  if (initMap()) loadPlaces();
})();
