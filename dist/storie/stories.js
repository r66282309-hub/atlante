(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const config = window.ATLAS_CONFIG;
  const TYPES = ['heading', 'paragraph', 'waypoint', 'image', 'video', 'map'];
  const TYPE_NAMES = { heading: 'Titolo', paragraph: 'Testo', waypoint: 'Waypoint', image: 'Fotografia', video: 'Video YouTube', map: 'Mini-mappa' };
  const TYPE_ICONS = { heading: 'T', paragraph: '≡', waypoint: '⌖', image: '▧', video: '▶', map: '◇' };
  const state = { stories: [], current: null, waypoints: [], preview: false, maps: [], saveTimer: null, dirty: false, revision: 0, pendingImageId: null, storageError: false };
  let editorInitialized = false;
  let authChecked = false;
  let dbPromise;
  let toastTimer;

  const uid = () => globalThis.crypto?.randomUUID?.() || `story-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clone = value => structuredClone(value);
  const asText = (value, limit = 20000) => String(value ?? '').slice(0, limit);

  function imageUrl(value) {
    if (typeof value !== 'string') return '';
    if (/^data:image\/(jpeg|png|webp|avif);base64,[a-z0-9+/=]+$/i.test(value) && value.length < 18000000) return value;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function youtubeId(input) {
    if (!input) return null;
    try {
      const u = new URL(input.trim());
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      let id;
      if (host === 'youtu.be') id = u.pathname.split('/')[1];
      else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
        id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
      }
      return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
    } catch { return null; }
  }

  function dateLabel(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : 'Oggi';
  }

  function notice(message) {
    const toast = $('storyToast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  function setSaveStatus(text, saving = false) {
    const node = $('saveIndicator');
    node.classList.toggle('is-saving', saving);
    node.lastChild.textContent = ` ${text}`;
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB non disponibile')); return; }
      const request = indexedDB.open('atlante-geostorie', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('stories')) request.result.createObjectStore('stories', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Impossibile aprire IndexedDB'));
    });
    return dbPromise;
  }

  async function dbAction(mode, method, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('stories', mode);
      const request = tx.objectStore('stories')[method](value);
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error('Errore di salvataggio'));
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('Transazione interrotta'));
    });
  }

  const allStories = () => dbAction('readonly', 'getAll');
  const putStory = story => dbAction('readwrite', 'put', story);
  const deleteStory = id => dbAction('readwrite', 'delete', id);

  function blankStory() {
    const now = new Date().toISOString();
    return { id: uid(), title: 'Una nuova geostoria', subtitle: '', kicker: 'DIARIO DI VIAGGIO', cover: '', created_at: now, updated_at: now, blocks: [{ id: uid(), type: 'paragraph', text: '' }] };
  }

  function exampleStory() {
    const now = new Date().toISOString();
    return {
      id: uid(), title: 'Acqua, roccia e silenzio', subtitle: 'Un esempio di racconto geografico tra i paesaggi della Sardegna.',
      kicker: 'GEOSTORIA DIMOSTRATIVA', cover: 'https://images.unsplash.com/photo-1472396961693-142e6e269027?w=1600&q=85',
      created_at: now, updated_at: now,
      blocks: [
        { id: uid(), type: 'heading', text: 'Comincia dal paesaggio' },
        { id: uid(), type: 'paragraph', text: 'Una geostoria non è soltanto un elenco di punti: è un percorso fatto di osservazioni, immagini e luoghi. Questo racconto è un esempio modificabile. Le fotografie sono illustrative e non documentano i posti descritti.' },
        { id: uid(), type: 'waypoint', waypointId: 'demo-sa-stiddiosa', caption: 'Una tappa da collegare ai waypoint presenti nell’Atlante.' },
        { id: uid(), type: 'image', src: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=1200&q=85', caption: 'Fotografia illustrativa: sostituiscila con uno scatto personale.' },
        { id: uid(), type: 'heading', text: 'Ogni posto ha le sue coordinate' },
        { id: uid(), type: 'map', lat: 39.869, lon: 9.228, zoom: 12, basemap: 'osm', caption: 'Una mini-mappa Leaflet per contestualizzare la tappa.' }
      ]
    };
  }

  async function loadWaypoints() {
    const sb = config.supabase || {};
    if (sb.url && sb.anonKey) {
      try {
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        const client = createClient(sb.url, sb.anonKey);
        const { data, error } = await client.from(sb.table || 'waypoints').select('id,title,area,lat,lon,photos,published').eq('published', true).order('visited_at', { ascending: false });
        if (error) throw error;
        state.waypoints = (data || []).map(row => ({
          ...row,
          photos: (Array.isArray(row.photos) ? row.photos : []).map(src => /^https?:\/\//i.test(src) ? imageUrl(src) : imageUrl(client.storage.from(sb.photoBucket || 'waypoint-photos').getPublicUrl(src).data.publicUrl)).filter(Boolean)
        }));
        return;
      } catch (error) { console.warn('Supabase waypoint non disponibili; uso gli esempi.', error); }
    }
    try {
      const response = await fetch('../data/waypoints.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.waypoints = await response.json();
    } catch (error) { console.error(error); state.waypoints = []; }
  }

  function statusFromError(error) {
    console.error(error);
    state.storageError = true;
    setSaveStatus('Salvataggio non disponibile', true);
    notice('Impossibile salvare in questo browser. Esporta una copia JSON.');
  }

  async function saveNow() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.current || !state.dirty) return;
    const story = clone(state.current);
    const capturedRevision = state.revision;
    story.updated_at = new Date().toISOString();
    try {
      await putStory(story);
      state.current.updated_at = story.updated_at;
      const idx = state.stories.findIndex(item => item.id === story.id);
      if (idx >= 0) state.stories[idx] = clone(story);
      else state.stories.push(clone(story));
      state.dirty = capturedRevision !== state.revision;
      if (state.dirty) {
        setSaveStatus('Salvataggio in corso…', true);
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(() => void saveNow(), 250);
      } else setSaveStatus('Salvato in questo browser');
      renderLibrary();
      $('storyUpdatedAt').textContent = `Aggiornato ${dateLabel(story.updated_at)}`;
    } catch (error) { statusFromError(error); }
  }

  function queueSave() {
    state.revision += 1;
    state.dirty = true;
    setSaveStatus('Salvataggio in corso…', true);
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => void saveNow(), 450);
  }

  function renderLibrary() {
    const container = $('storyList');
    container.replaceChildren();
    state.stories.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    $('storyCount').textContent = state.stories.length;
    for (const story of state.stories) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `draft-item${story.id === state.current?.id ? ' active' : ''}`;
      button.setAttribute('aria-label', `Apri geostoria ${story.title}`);
      const icon = document.createElement('span');
      icon.className = 'draft-icon';
      icon.textContent = '✳';
      const copy = document.createElement('span');
      copy.className = 'draft-copy';
      const title = document.createElement('strong');
      title.textContent = story.title || 'Senza titolo';
      const date = document.createElement('small');
      date.textContent = `${story.blocks.length} blocchi · ${dateLabel(story.updated_at)}`;
      const arrow = document.createElement('span');
      arrow.className = 'draft-chevron';
      arrow.textContent = '›';
      copy.append(title, date);
      button.append(icon, copy, arrow);
      button.addEventListener('click', () => void selectStory(story.id));
      container.append(button);
    }
  }

  async function selectStory(id) {
    await saveNow();
    const story = state.stories.find(item => item.id === id);
    if (!story) return;
    state.current = clone(story);
    state.preview = false;
    renderStory();
    renderLibrary();
    $('storyStage').scrollTop = 0;
    setSaveStatus('Salvato in questo browser');
  }

  async function createStory() {
    await saveNow();
    const story = blankStory();
    try { await putStory(story); }
    catch (error) { statusFromError(error); return; }
    state.stories.push(clone(story));
    await selectStory(story.id);
    notice('Nuova geostoria creata: puoi iniziare a scrivere.');
    $('storyTitle').focus();
  }

  async function duplicateCurrent() {
    await saveNow();
    const story = clone(state.current);
    story.id = uid();
    story.title = `${story.title} (copia)`;
    story.blocks = story.blocks.map(block => ({ ...block, id: uid() }));
    story.created_at = story.updated_at = new Date().toISOString();
    try { await putStory(story); }
    catch (error) { statusFromError(error); return; }
    state.stories.push(clone(story));
    await selectStory(story.id);
    notice('Geostoria duplicata.');
  }

  async function deleteCurrent() {
    if (!state.current) return;
    if (!confirm(`Eliminare definitivamente la bozza “${state.current.title}” da questo browser? Esporta prima un JSON se vuoi conservarla.`)) return;
    await saveNow();
    const id = state.current.id;
    try { await deleteStory(id); }
    catch (error) { statusFromError(error); return; }
    state.stories = state.stories.filter(story => story.id !== id);
    if (!state.stories.length) {
      const fresh = blankStory();
      await putStory(fresh);
      state.stories.push(clone(fresh));
    }
    await selectStory(state.stories[0].id);
    notice('Bozza eliminata dal browser.');
  }

  function resizeTextarea(element) {
    element.style.height = 'auto';
    element.style.height = `${Math.max(element.scrollHeight, element.id === 'storyTitle' ? 96 : 46)}px`;
  }

  function renderHeading() {
    const story = state.current;
    $('toolbarStoryTitle').textContent = story.title || 'Senza titolo';
    $('storyTitle').value = story.title;
    $('storySubtitle').value = story.subtitle;
    $('storyKicker').value = story.kicker;
    $('storyUpdatedAt').textContent = `Aggiornato ${dateLabel(story.updated_at)}`;
    resizeTextarea($('storyTitle'));
    resizeTextarea($('storySubtitle'));
    const cover = imageUrl(story.cover);
    $('storyCover').style.backgroundImage = cover ? `url(${JSON.stringify(cover)})` : '';
    $('coverUrl').value = /^https?:\/\//.test(story.cover || '') ? story.cover : '';
  }

  function renderStory() {
    const preview = state.preview;
    $('storyApp').classList.toggle('is-preview', preview);
    $('previewButton').setAttribute('aria-pressed', String(preview));
    $('previewIcon').textContent = preview ? '✎' : '◉';
    $('previewLabel').textContent = preview ? 'Modifica' : 'Anteprima';
    renderHeading();
    ['storyTitle', 'storySubtitle', 'storyKicker'].forEach(id => { $(id).readOnly = preview; });
    renderBlocks();
  }

  function makeControl(label, { kind = 'input', type = 'text', value = '', placeholder = '', options = [], live = true, rows = 3, min, max, onChange }) {
    const wrap = document.createElement('div');
    const text = document.createElement('label');
    text.className = 'field-label';
    text.textContent = label;
    const field = document.createElement(kind === 'textarea' ? 'textarea' : kind === 'select' ? 'select' : 'input');
    field.className = kind === 'select' ? 'block-select' : kind === 'textarea' ? 'block-textarea' : 'block-input';
    if (kind === 'select') {
      options.forEach(option => {
        const item = document.createElement('option');
        item.value = String(option.value);
        item.textContent = option.label;
        field.append(item);
      });
    } else if (kind === 'input') {
      field.type = type;
      if (min !== undefined) field.min = String(min);
      if (max !== undefined) field.max = String(max);
      if (type === 'number') field.step = 'any';
    } else field.rows = rows;
    field.value = value ?? '';
    field.placeholder = placeholder;
    field.addEventListener(live ? 'input' : 'change', event => onChange?.(event.target.value, field));
    wrap.append(text, field);
    return wrap;
  }

  function blockTitle(block) {
    switch (block.type) {
      case 'heading': return block.text || 'Nuovo titolo';
      case 'paragraph': return (block.text || '').slice(0, 35) || 'Paragrafo';
      case 'waypoint': return state.waypoints.find(point => String(point.id) === block.waypointId)?.title || 'Waypoint';
      case 'image': return block.caption || 'Fotografia';
      case 'video': return block.caption || 'Video YouTube';
      case 'map': return block.caption || 'Mini-mappa';
      default: return 'Blocco';
    }
  }

  function renderOutline() {
    const list = $('storyOutline');
    list.replaceChildren();
    const blocks = state.current.blocks;
    $('blockCount').textContent = `${blocks.length} ${blocks.length === 1 ? 'blocco' : 'blocchi'}`;
    blocks.forEach((block, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      const title = document.createElement('span');
      title.textContent = `${String(index + 1).padStart(2, '0')} · ${blockTitle(block)}`;
      button.append(title);
      button.addEventListener('click', () => document.getElementById(`block-${block.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      list.append(button);
    });
  }

  function appendCaption(parent, text) {
    if (!text) return;
    const caption = document.createElement('figcaption');
    caption.className = 'preview-caption';
    caption.textContent = text;
    parent.append(caption);
  }

  function waypointCard(point) {
    const card = document.createElement('div');
    card.className = 'waypoint-embed';
    const image = document.createElement('div');
    image.className = 'waypoint-embed-image';
    const src = imageUrl(point?.photos?.[0]);
    if (src) image.style.backgroundImage = `url(${JSON.stringify(src)})`;
    const body = document.createElement('div');
    body.className = 'waypoint-embed-body';
    const tag = document.createElement('span');
    tag.className = 'waypoint-eyebrow';
    tag.textContent = '⌖ TAPPA DELL’ATLANTE';
    const title = document.createElement('h3');
    title.textContent = point?.title || 'Waypoint non trovato';
    const area = document.createElement('p');
    area.textContent = point?.area || 'Seleziona un waypoint presente nella mappa.';
    const link = document.createElement('a');
    link.textContent = 'Apri sulla mappa ↗';
    link.href = point ? `../?waypoint=${encodeURIComponent(point.id)}` : '../';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    body.append(tag, title, area, link);
    card.append(image, body);
    return card;
  }

  function imageDisplay(src, caption = '') {
    const figure = document.createElement('figure');
    figure.className = 'preview-figure';
    const valid = imageUrl(src);
    if (valid) {
      const image = document.createElement('img');
      image.src = valid;
      image.alt = caption || 'Fotografia della geostoria';
      image.loading = 'lazy';
      image.onerror = () => image.replaceWith(emptyMedia('Immagine non disponibile'));
      figure.append(image);
    } else figure.append(emptyMedia('La tua foto apparirà qui', '▧'));
    appendCaption(figure, caption);
    return figure;
  }

  function emptyMedia(label, symbol = '✳') {
    const div = document.createElement('div');
    div.className = 'media-empty';
    const span = document.createElement('span');
    span.textContent = symbol;
    div.append(span, document.createTextNode(label));
    return div;
  }

  function videoDisplay(url) {
    const id = youtubeId(url);
    if (!id) {
      const empty = document.createElement('div');
      empty.className = 'youtube-placeholder';
      empty.append(emptyMedia('Incolla un link YouTube valido', '▶'));
      return empty;
    }
    const container = document.createElement('div');
    container.className = 'youtube-frame';
    const iframe = document.createElement('iframe');
    // Native YouTube click-to-play/pause remains active; only the standard
    // control strip is hidden. YouTube attribution may still be displayed.
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?controls=0&playsinline=1&rel=0`;
    iframe.title = 'Video YouTube incorporato nella geostoria';
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    container.append(iframe);
    return container;
  }

  function makeMiniMap(block) {
    const map = document.createElement('div');
    map.className = 'mini-map';
    map.dataset.miniMap = block.id;
    map.setAttribute('role', 'application');
    map.setAttribute('aria-label', `Mini-mappa alle coordinate ${block.lat}, ${block.lon}`);
    return map;
  }

  function renderBlock(block, index) {
    const preview = state.preview;
    const article = document.createElement('section');
    article.className = `story-block${preview ? ' is-preview' : ''}`;
    article.id = `block-${block.id}`;
    if (!preview) {
      const bar = document.createElement('div');
      bar.className = 'block-toolbar';
      const label = document.createElement('div');
      label.className = 'block-toolbar-label';
      const glyph = document.createElement('span');
      glyph.textContent = TYPE_ICONS[block.type];
      label.append(glyph, document.createTextNode(`${TYPE_NAMES[block.type].toUpperCase()} · ${String(index + 1).padStart(2, '0')}`));
      const actions = document.createElement('div');
      actions.className = 'block-actions';
      for (const [action, glyphText, title] of [['up', '↑', 'Sposta su'], ['down', '↓', 'Sposta giù'], ['copy', '⧉', 'Duplica blocco'], ['remove', '×', 'Elimina blocco']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = glyphText;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.disabled = (action === 'up' && index === 0) || (action === 'down' && index === state.current.blocks.length - 1);
        button.addEventListener('click', () => alterBlock(block.id, action));
        actions.append(button);
      }
      bar.append(label, actions);
      article.append(bar);
    }

    const content = document.createElement('div');
    if (!preview) content.className = 'block-editor-content';
    switch (block.type) {
      case 'heading': {
        if (preview) {
          const h = document.createElement('h2');
          h.className = 'preview-heading';
          h.textContent = block.text || 'Nuova sezione';
          content.append(h);
        } else {
          const field = makeControl('TITOLO DELLA SEZIONE', { value: block.text, placeholder: 'Il titolo della sezione…', onChange: value => { block.text = value; queueSave(); } });
          field.querySelector('input').classList.add('heading-field');
          content.append(field);
        }
        break;
      }
      case 'paragraph': {
        if (preview) {
          const p = document.createElement('p');
          p.className = 'preview-paragraph';
          p.textContent = block.text || 'Qui inizierà il tuo racconto…';
          content.append(p);
        } else content.append(makeControl('IL RACCONTO', { kind: 'textarea', rows: 5, value: block.text, placeholder: 'Scrivi un ricordo, una descrizione, una nota di viaggio…', onChange: value => { block.text = value; queueSave(); } }));
        break;
      }
      case 'waypoint': {
        const point = state.waypoints.find(item => String(item.id) === String(block.waypointId));
        if (!preview) {
          const options = [{ value: '', label: 'Scegli un waypoint…' }, ...state.waypoints.map(item => ({ value: String(item.id), label: `${item.title} · ${item.area || 'Atlante'}` }))];
          content.append(makeControl('COLLEGA UN LUOGO DALL’ATLANTE', { kind: 'select', value: block.waypointId || '', options, onChange: value => { block.waypointId = value; queueSave(); renderBlocks(); } }));
        }
        content.append(waypointCard(point));
        if (preview) appendCaption(content, block.caption);
        else content.append(makeControl('DIDASCALIA (FACOLTATIVA)', { value: block.caption, placeholder: 'Perché è importante questa tappa?', onChange: value => { block.caption = value; queueSave(); } }));
        break;
      }
      case 'image': {
        if (!preview) {
          content.append(makeControl('URL DELL’IMMAGINE', { type: 'url', value: /^https?:\/\//.test(block.src || '') ? block.src : '', placeholder: 'https://…', live: false, onChange: value => { block.src = imageUrl(value); queueSave(); renderBlocks(); } }));
          const row = document.createElement('div');
          row.className = 'upload-row';
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'upload-button';
          button.textContent = '▧  Scegli foto dal computer';
          button.addEventListener('click', () => { state.pendingImageId = block.id; $('blockImageInput').click(); });
          const hint = document.createElement('small');
          hint.textContent = 'La foto resta nella bozza locale.';
          row.append(button, hint);
          content.append(row);
        }
        const previewImage = imageDisplay(block.src, preview ? block.caption : '');
        if (!preview) previewImage.classList.add('block-media-preview');
        content.append(previewImage);
        if (!preview) content.append(makeControl('DIDASCALIA', { value: block.caption, placeholder: 'Descrivi questa fotografia…', onChange: value => { block.caption = value; queueSave(); } }));
        break;
      }
      case 'video': {
        if (!preview) content.append(makeControl('LINK A YOUTUBE', { type: 'url', value: block.url, placeholder: 'https://www.youtube.com/watch?v=…', live: false, onChange: value => { block.url = value; queueSave(); renderBlocks(); } }));
        const media = videoDisplay(block.url);
        media.style.marginTop = preview ? '0' : '13px';
        content.append(media);
        if (preview) appendCaption(content, block.caption);
        else content.append(makeControl('DIDASCALIA', { value: block.caption, placeholder: 'Una nota sul video…', onChange: value => { block.caption = value; queueSave(); } }));
        break;
      }
      case 'map': {
        if (!preview) {
          const options = [{ value: '', label: 'Coordinate manuali' }, ...state.waypoints.map(point => ({ value: String(point.id), label: point.title }))];
          const link = makeControl('CENTRA SU UN WAYPOINT (OPZIONALE)', { kind: 'select', value: '', options, onChange: value => {
            const point = state.waypoints.find(item => String(item.id) === value);
            if (point) { block.lat = Number(point.lat); block.lon = Number(point.lon); queueSave(); renderBlocks(); }
          } });
          content.append(link);
          const grid = document.createElement('div');
          grid.className = 'block-field-grid three';
          grid.append(
            makeControl('LATITUDINE', { type: 'number', value: block.lat, min: -90, max: 90, live: false, onChange: value => changeMapNumber(block, 'lat', value, -90, 90) }),
            makeControl('LONGITUDINE', { type: 'number', value: block.lon, min: -180, max: 180, live: false, onChange: value => changeMapNumber(block, 'lon', value, -180, 180) }),
            makeControl('ZOOM', { type: 'number', value: block.zoom, min: 5, max: 18, live: false, onChange: value => changeMapNumber(block, 'zoom', value, 5, 18) })
          );
          content.append(grid);
          const styleGrid = document.createElement('div');
          styleGrid.className = 'block-field-grid';
          styleGrid.append(makeControl('BASE CARTOGRAFICA', { kind: 'select', value: block.basemap, options: [{ value: 'osm', label: 'OpenStreetMap' }, { value: 'satellite', label: 'Google Satellite' }], onChange: value => { block.basemap = value; queueSave(); renderBlocks(); } }));
          content.append(styleGrid);
        }
        content.append(makeMiniMap(block));
        if (preview) appendCaption(content, block.caption);
        else {
          const tip = document.createElement('p');
          tip.className = 'mini-map-note';
          tip.textContent = 'Puoi trascinare la mappa; fai clic per cambiare il punto centrale.';
          content.append(tip);
          content.append(makeControl('DIDASCALIA', { value: block.caption, placeholder: 'Localizzazione e contesto…', onChange: value => { block.caption = value; queueSave(); } }));
        }
        break;
      }
    }
    article.append(content);
    return article;
  }

  function changeMapNumber(block, key, value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) { notice(`Valore non valido per ${key}.`); renderBlocks(); return; }
    block[key] = key === 'zoom' ? Math.round(number) : number;
    queueSave();
    renderBlocks();
  }

  function clearMiniMaps() {
    state.maps.forEach(map => { try { map.remove(); } catch { /* map already detached */ } });
    state.maps = [];
  }

  function renderBlocks() {
    clearMiniMaps();
    const container = $('storyBlocks');
    container.replaceChildren();
    state.current.blocks.forEach((block, index) => container.append(renderBlock(block, index)));
    renderOutline();
    requestAnimationFrame(initializeMiniMaps);
  }

  function initializeMiniMaps() {
    if (!window.L) return;
    document.querySelectorAll('[data-mini-map]').forEach(element => {
      const block = state.current.blocks.find(item => item.id === element.dataset.miniMap);
      if (!block || !Number.isFinite(Number(block.lat)) || !Number.isFinite(Number(block.lon))) return;
      const point = [Number(block.lat), Number(block.lon)];
      const map = L.map(element, { center: point, zoom: block.zoom || 11, minZoom: 4, maxZoom: 19, scrollWheelZoom: false, zoomControl: true, attributionControl: true });
      const sat = block.basemap === 'satellite';
      L.tileLayer(sat ? config.satellite.url : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: sat ? (config.satellite.attribution || '&copy; Google') : '&copy; OpenStreetMap contributors', maxZoom: 19
      }).addTo(map);
      const marker = L.circleMarker(point, { radius: 7, color: '#fff', weight: 3, fillColor: '#b77956', fillOpacity: 1 }).addTo(map);
      if (!state.preview) map.on('click', event => {
        block.lat = Number(event.latlng.lat.toFixed(6));
        block.lon = Number(event.latlng.lng.toFixed(6));
        marker.setLatLng(event.latlng);
        const editor = element.closest('.block-editor-content');
        const inputs = editor?.querySelectorAll('input[type="number"]');
        if (inputs?.[0]) inputs[0].value = block.lat;
        if (inputs?.[1]) inputs[1].value = block.lon;
        queueSave();
      });
      state.maps.push(map);
      setTimeout(() => map.invalidateSize(), 50);
    });
  }

  function defaultBlock(type) {
    const common = { id: uid(), type };
    switch (type) {
      case 'heading': return { ...common, text: 'Una nuova sezione' };
      case 'paragraph': return { ...common, text: '' };
      case 'waypoint': return { ...common, waypointId: String(state.waypoints[0]?.id || ''), caption: '' };
      case 'image': return { ...common, src: '', caption: '' };
      case 'video': return { ...common, url: '', caption: '' };
      case 'map': return { ...common, lat: Number(state.waypoints[0]?.lat || 40.08), lon: Number(state.waypoints[0]?.lon || 9.04), zoom: 11, basemap: 'osm', caption: '' };
      default: return { ...common, text: '' };
    }
  }

  function revealNewBlock(id) {
    const block = document.getElementById(`block-${id}`);
    if (!block) return;

    // Keep keyboard focus on the newly-created section without letting the
    // browser move a different scroll container behind the editor.
    const field = block.querySelector('input, textarea, select');
    field?.focus({ preventScroll: true });

    const stage = $('storyStage');
    if (getComputedStyle(stage).overflowY === 'visible') {
      // On mobile the document scrolls, while desktop uses its own stage.
      block.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const top = block.getBoundingClientRect().top
      - stage.getBoundingClientRect().top + stage.scrollTop - 28;
    stage.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function addBlock(type) {
    if (!TYPES.includes(type)) return;
    if (state.preview) { state.preview = false; renderStory(); }
    const block = defaultBlock(type);
    state.current.blocks.push(block);
    queueSave();
    renderBlocks();
    // Let the new section and its Leaflet map finish layout before scrolling.
    requestAnimationFrame(() => requestAnimationFrame(() => revealNewBlock(block.id)));
    notice(`${TYPE_NAMES[type]} aggiunto alla geostoria.`);
  }

  function alterBlock(id, action) {
    const blocks = state.current.blocks;
    const index = blocks.findIndex(block => block.id === id);
    if (index === -1) return;
    if (action === 'remove') blocks.splice(index, 1);
    if (action === 'up' && index > 0) [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]];
    if (action === 'down' && index < blocks.length - 1) [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]];
    if (action === 'copy') blocks.splice(index + 1, 0, { ...clone(blocks[index]), id: uid() });
    queueSave();
    renderBlocks();
  }

  async function imageToDataUrl(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('Scegli un file immagine.');
    if (file.size > 25000000) throw new Error('Immagine troppo grande: limite 25 MB.');
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', .85);
  }

  async function uploadLocalImage(file, blockId = null) {
    if (!file) return;
    const activeStoryId = state.current?.id;
    try {
      setSaveStatus('Elaboro la fotografia…', true);
      const src = await imageToDataUrl(file);
      if (activeStoryId !== state.current?.id) return;
      if (blockId) {
        const block = state.current.blocks.find(item => item.id === blockId);
        if (!block) return;
        block.src = src;
        renderBlocks();
      } else {
        state.current.cover = src;
        renderHeading();
      }
      queueSave();
      await saveNow();
      notice('Fotografia salvata nella bozza locale.');
    } catch (error) { console.error(error); notice(error.message || 'Impossibile elaborare la foto.'); }
  }

  async function exportCurrent() {
    await saveNow();
    const envelope = { format: 'atlante-geostoria', version: 1, exported_at: new Date().toISOString(), story: state.current };
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `geostoria-${(state.current.title || 'senza-titolo').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    notice('Geostoria esportata con tutte le foto locali.');
  }

  function normalizedStory(raw) {
    if (!raw || !Array.isArray(raw.blocks)) throw new Error('Formato geostoria non valido.');
    const base = blankStory();
    base.title = asText(raw.title || 'Geostoria importata', 180);
    base.subtitle = asText(raw.subtitle, 400);
    base.kicker = asText(raw.kicker || 'GEOSTORIA IMPORTATA', 70);
    base.cover = imageUrl(raw.cover);
    base.blocks = raw.blocks.slice(0, 150).filter(item => item && TYPES.includes(item.type)).map(item => {
      const block = defaultBlock(item.type);
      if (['heading', 'paragraph'].includes(item.type)) block.text = asText(item.text);
      if (item.type === 'waypoint') { block.waypointId = asText(item.waypointId, 100); block.caption = asText(item.caption, 1000); }
      if (item.type === 'image') { block.src = imageUrl(item.src); block.caption = asText(item.caption, 1000); }
      if (item.type === 'video') { block.url = youtubeId(item.url) ? asText(item.url, 500) : ''; block.caption = asText(item.caption, 1000); }
      if (item.type === 'map') {
        block.lat = Number(item.lat) >= -90 && Number(item.lat) <= 90 ? Number(item.lat) : 40.08;
        block.lon = Number(item.lon) >= -180 && Number(item.lon) <= 180 ? Number(item.lon) : 9.04;
        block.zoom = Number(item.zoom) >= 5 && Number(item.zoom) <= 18 ? Math.round(Number(item.zoom)) : 11;
        block.basemap = item.basemap === 'satellite' ? 'satellite' : 'osm';
        block.caption = asText(item.caption, 1000);
      }
      return block;
    });
    return base;
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > 30000000) { notice('Il file supera il limite di 30 MB.'); return; }
    try {
      const object = JSON.parse(await file.text());
      if (object.format !== 'atlante-geostoria' || object.version !== 1) throw new Error('Esporta il file dal formato Geostorie v1.');
      const story = normalizedStory(object.story);
      await saveNow();
      await putStory(story);
      state.stories.push(clone(story));
      await selectStory(story.id);
      notice('Geostoria importata nell’archivio locale.');
    } catch (error) { console.error(error); notice(`Importazione non riuscita: ${error.message}`); }
  }

  function bindEvents() {
    $('newStoryButton').addEventListener('click', () => void createStory());
    $('duplicateButton').addEventListener('click', () => void duplicateCurrent());
    $('deleteStoryButton').addEventListener('click', () => void deleteCurrent());
    $('previewButton').addEventListener('click', async () => { await saveNow(); state.preview = !state.preview; renderStory(); $('storyStage').scrollTop = 0; });
    $('blockPicker').addEventListener('click', event => {
      const button = event.target.closest('[data-add]');
      if (button) addBlock(button.dataset.add);
    });
    $('appendBlockButton').addEventListener('click', () => $('blockChoiceDialog').showModal());
    $('blockChoicePicker').addEventListener('click', event => {
      const button = event.target.closest('[data-add]');
      if (!button) return;
      $('blockChoiceDialog').close();
      addBlock(button.dataset.add);
    });
    $('storyTitle').addEventListener('input', event => {
      state.current.title = event.target.value;
      $('toolbarStoryTitle').textContent = state.current.title || 'Senza titolo';
      resizeTextarea(event.target);
      queueSave();
    });
    $('storySubtitle').addEventListener('input', event => { state.current.subtitle = event.target.value; resizeTextarea(event.target); queueSave(); });
    $('storyKicker').addEventListener('input', event => { state.current.kicker = event.target.value; queueSave(); });
    $('coverUrl').addEventListener('change', event => {
      state.current.cover = imageUrl(event.target.value);
      queueSave();
      renderHeading();
    });
    $('coverUploadButton').addEventListener('click', () => $('coverFileInput').click());
    $('coverFileInput').addEventListener('change', event => { void uploadLocalImage(event.target.files?.[0]); event.target.value = ''; });
    $('blockImageInput').addEventListener('change', event => { void uploadLocalImage(event.target.files?.[0], state.pendingImageId); event.target.value = ''; });
    $('exportButton').addEventListener('click', () => void exportCurrent());
    $('importButton').addEventListener('click', () => $('importFileInput').click());
    $('importFileInput').addEventListener('change', event => { void importFile(event.target.files?.[0]); event.target.value = ''; });
    $('helpButton').addEventListener('click', () => $('helpDialog').showModal());
    window.addEventListener('pagehide', () => { if (state.dirty) void saveNow(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && state.dirty) void saveNow(); });
  }

  function showAccessGate() {
    $('newStoryButton').hidden = true;
    $('storyCount').textContent = '—';
    $('storyList').replaceChildren();
    const note = document.createElement('p');
    note.className = 'draft-loading';
    note.textContent = 'Le geostorie pubblicate compariranno qui. L’editor è riservato al proprietario.';
    $('storyList').append(note);
    document.querySelector('.story-tools').hidden = true;
    const stage = $('storyStage');
    stage.replaceChildren();
    const gate = document.createElement('section');
    gate.className = 'story-access-gate';
    gate.innerHTML = `<div class="story-access-spark" aria-hidden="true">✳</div>
      <h2>Storie da vivere,<br><em>luoghi da raccontare.</em></h2>
      <p id="storyGateDescription"></p>
      <button type="button">Accesso all’editor</button>`;
    gate.querySelector('#storyGateDescription').textContent = window.atlasAuth?.user
      ? 'Account autenticato. Per modificare le geostorie serve anche l’abilitazione del proprietario.'
      : 'L’Atlante è pubblico, ma l’editor delle geostorie è riservato all’amministratore.';
    gate.querySelector('button').addEventListener('click', () => window.atlasAuth?.open());
    stage.append(gate);
    setSaveStatus('Accesso riservato');
  }

  async function initialize() {
    await window.atlasAuth?.ready;
    authChecked = true;
    if (!window.atlasAuth?.editor) { showAccessGate(); return; }
    if (editorInitialized) return;
    editorInitialized = true;
    bindEvents();
    try {
      await Promise.all([openDatabase(), loadWaypoints()]);
      state.stories = await allStories();
      if (!state.stories.length) {
        const first = localStorage.getItem('atlante-geostorie-seeded') ? blankStory() : exampleStory();
        await putStory(first);
        state.stories.push(clone(first));
        localStorage.setItem('atlante-geostorie-seeded', '1');
      }
      const selected = state.stories.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
      await selectStory(selected.id);
    } catch (error) {
      statusFromError(error);
      state.current = exampleStory();
      state.stories = [clone(state.current)];
      renderStory();
      renderLibrary();
    }
  }

  window.addEventListener('atlas-auth-changed', () => {
    if (authChecked && Boolean(window.atlasAuth?.editor) !== editorInitialized) window.location.reload();
  });
  void initialize();
})();
