(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const config = window.ATLAS_CONFIG;
  const TYPES = ['heading', 'paragraph', 'waypoint', 'image', 'video', 'separator', 'map', 'gallery', 'quote', 'insight', 'route', 'compare', 'timeline', 'chapter'];
  const TYPE_NAMES = { heading: 'Titolo', paragraph: 'Testo', waypoint: 'Waypoint', image: 'Fotografia', video: 'Video', separator: 'Separatore', map: 'Mini-mappa', gallery: 'Galleria', quote: 'Citazione', insight: 'Approfondimento', route: 'Percorso', compare: 'Prima / dopo', timeline: 'Linea del tempo', chapter: 'Capitolo immersivo' };
  const TYPE_ICONS = { heading: 'T', paragraph: '≡', waypoint: '⌖', image: '▧', video: '▶', separator: '✳', map: '◇', gallery: '▤', quote: '❝', insight: '◈', route: '⌁', compare: '◫', timeline: '◷', chapter: '▣' };
  const state = { stories: [], current: null, waypoints: [], localStories: [], preview: false, maps: [], saveTimer: null, savingPromise: null, dirty: false, revision: 0, pendingImageId: null, storageError: false };
  let editorInitialized = false;
  let authChecked = false;
  let dbPromise;
  let toastTimer;
  const client = () => window.atlasAuth?.client;
  const isEditor = () => Boolean(window.atlasAuth?.editor && window.atlasAuth?.user && client());
  const isUUID = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

  const uid = () => globalThis.crypto?.randomUUID?.() || `story-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clone = value => structuredClone(value);
  const asText = (value, limit = 20000) => String(value ?? '').slice(0, limit);

  // Safe Markdown extensions: inline font and color spans are created as DOM
  // nodes from a small allowlist. Arbitrary HTML is always displayed as text.
  function appendMarkdownInline(parent, source, depth = 0) {
    const input = String(source ?? '');
    if (depth > 15) { parent.append(document.createTextNode(input)); return; }
    const stack = [{ node: parent, marker: '' }];
    let buffer = '';
    const here = () => stack[stack.length - 1].node;
    const flush = () => { if (buffer) { here().append(document.createTextNode(buffer)); buffer = ''; } };
    const hasCloser = (marker, from) => {
      for (let j = input.indexOf(marker, from); j >= 0; j = input.indexOf(marker, j + 1)) {
        if ((marker === '*' || marker === '_') && (input[j - 1] === marker || input[j + 1] === marker)) continue;
        return true;
      }
      return false;
    };
    let i = 0;
    while (i < input.length) {
      const rest = input.slice(i);
      const font = /^<span class="atlas-(sans|serif|script)">/.exec(rest);
      const color = /^<span style="color:\s*(#[0-9a-fA-F]{6})">/.exec(rest);
      if (font || color) {
        flush();
        const span = document.createElement('span');
        if (font) span.className = 'atlas-' + font[1];
        else span.style.color = color[1];
        here().append(span);
        stack.push({ node: span, marker: 'span' });
        i += (font || color)[0].length;
        continue;
      }
      if (rest.startsWith('</span>') && stack[stack.length - 1].marker === 'span') {
        flush(); stack.pop(); i += 7; continue;
      }
      const link = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(rest);
      if (link) {
        flush();
        try {
          const url = new URL(link[2]);
          if (!['http:', 'https:'].includes(url.protocol)) throw Error('URL');
          const a = document.createElement('a');
          a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
          appendMarkdownInline(a, link[1], depth + 1);
          here().append(a);
        } catch { here().append(document.createTextNode(link[0])); }
        i += link[0].length; continue;
      }
      if (input.charCodeAt(i) === 96) {
        const close = input.indexOf(String.fromCharCode(96), i + 1);
        if (close > i && !input.slice(i + 1,close).includes('\n')) {
          flush();
          const code = document.createElement('code');
          code.textContent = input.slice(i + 1,close);
          here().append(code);
          i = close + 1; continue;
        }
      }
      let formatted = false;
      for (const marker of ['**', '__', '~~', '*', '_']) {
        if (!rest.startsWith(marker)) continue;
        if (stack[stack.length - 1].marker === marker) {
          flush(); stack.pop(); i += marker.length; formatted = true; break;
        }
        if (!hasCloser(marker, i + marker.length)) continue;
        flush();
        const node = document.createElement(marker === '~~' ? 'del' : marker.length === 2 ? 'strong' : 'em');
        here().append(node);
        stack.push({ node, marker });
        i += marker.length; formatted = true; break;
      }
      if (formatted) continue;
      if (input[i] === '\\' && /[*_~\\]/.test(input[i + 1] || '')) {
        buffer += input[i + 1]; i += 2;
      } else buffer += input[i++];
    }
    flush();
  }

  function normalizeMultilineFormatting(source) {
    // Preserve nested Markdown literally. The old regex rewrite broke
    // italic passages containing already-bold words.
    return String(source ?? '').replace(/\r\n?/g, '\n');
  }

  function renderMarkdown(source) {
    const root = document.createElement('div');
    root.className = 'preview-markdown';
    const lines = normalizeMultilineFormatting(source).split('\n');
    const heading = line => /^(#{1,4})\s+(.+)$/.exec(line.trim());
    const divider = line => /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim());
    const listItem = line => /^\s*([-*+]\s+|\d+\.\s+)(.+)$/.exec(line);
    const special = line => heading(line) || divider(line) || listItem(line) || /^\s*>\s?/.test(line) || /^\s*```/.test(line);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const title = heading(line);
      if (title) {
        const level = title[1].length <= 2 ? 2 : title[1].length === 3 ? 3 : 4;
        const element = document.createElement(`h${level}`);
        appendMarkdownInline(element, title[2]);
        root.append(element);
        i++;
      } else if (divider(line)) {
        root.append(document.createElement('hr'));
        i++;
      } else if (/^\s*```/.test(line)) {
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        const pre = document.createElement('pre');
        const child = document.createElement('code');
        child.textContent = code.join('\n');
        pre.append(child);
        root.append(pre);
      } else if (listItem(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const list = document.createElement(ordered ? 'ol' : 'ul');
        while (i < lines.length) {
          const item = listItem(lines[i]);
          if (!item || /^\s*\d+\.\s+/.test(lines[i]) !== ordered) break;
          const li = document.createElement('li');
          appendMarkdownInline(li, item[2]);
          list.append(li);
          i++;
        }
        root.append(list);
      } else if (/^\s*>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        const block = document.createElement('blockquote');
        appendMarkdownInline(block, quote.join('\n'));
        root.append(block);
      } else {
        const paragraph = [line];
        i++;
        while (i < lines.length && lines[i].trim() && !special(lines[i])) paragraph.push(lines[i++]);
        const p = document.createElement('p');
        appendMarkdownInline(p, paragraph.join('\n'));
        root.append(p);
      }
    }
    if (!root.childNodes.length) {
      const placeholder = document.createElement('p');
      placeholder.textContent = 'Qui inizierà il tuo racconto…';
      root.append(placeholder);
    }
    return root;
  }

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
    return { id: uid(), title: 'Una nuova geostoria', subtitle: '', kicker: 'DIARIO DI VIAGGIO', cover: '', soundtrack_url: '', published: false, created_at: now, updated_at: now, linkedWaypointIds: [], blocks: [{ id: uid(), type: 'paragraph', text: '' }] };
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
        const api = client();
        if (!api) throw new Error('Connessione Supabase non disponibile');
        let query = api.from(sb.table || 'waypoints').select('id,title,area,lat,lon,photos,published').order('visited_at', { ascending: false });
        if (!isEditor()) query = query.eq('published', true);
        const { data, error } = await query;
        if (error) throw error;
        state.waypoints = (data || []).map(row => ({
          ...row,
          photos: (Array.isArray(row.photos) ? row.photos : []).map(src => /^https?:\/\//i.test(src) ? imageUrl(src) : imageUrl(api.storage.from(sb.photoBucket || 'waypoint-photos').getPublicUrl(src).data.publicUrl)).filter(Boolean)
        }));
        if (!state.waypoints.length && isEditor()) return;
        if (state.waypoints.length) return;
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
    setSaveStatus('Non sincronizzato · riprova', false);
    notice(`Non riesco a salvare su Supabase: ${error.message || error}. Esporta un JSON per sicurezza.`);
  }

  async function syncStoryWaypoints(story) {
    const api = client();
    const ids = [];
    (story.linkedWaypointIds || []).forEach(id => {
      if (isUUID(id) && state.waypoints.some(point => point.id === id) && !ids.includes(id)) ids.push(id);
    });
    story.blocks.forEach(block => {
      if (block.type === 'waypoint' && isUUID(block.waypointId) && state.waypoints.some(point => point.id === block.waypointId) && !ids.includes(block.waypointId)) ids.push(block.waypointId);
    });
    const { data: previous, error: lookupError } = await api.from('geostory_waypoints').select('waypoint_id,position').eq('geostory_id', story.id);
    if (lookupError) throw lookupError;
    const unchanged = (previous || []).length === ids.length && (previous || []).every(row => ids[row.position] === row.waypoint_id);
    if (unchanged) return;
    if (previous?.length) {
      const { error } = await api.from('geostory_waypoints').delete().eq('geostory_id', story.id);
      if (error) throw error;
    }
    if (ids.length) {
      const { error } = await api.from('geostory_waypoints').insert(ids.map((waypoint_id, position) => ({ geostory_id: story.id, waypoint_id, position })));
      if (error) throw error;
    }
  }

  async function persistStory(story) {
    if (!isEditor()) throw new Error('Accesso editor necessario.');
    const payload = {
      id: story.id, owner_id: window.atlasAuth.user.id,
      slug: `storia-${story.id}`,
      title: story.title.trim() || 'Senza titolo',
      subtitle: story.subtitle || '', kicker: story.kicker || '', cover: story.cover || '', soundtrack_url: story.soundtrack_url || '',
      blocks: story.blocks, published: Boolean(story.published)
    };
    const { error } = await client().from('geostories').upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    await syncStoryWaypoints(story);
  }

  async function saveNow() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (state.savingPromise) {
      const completed = await state.savingPromise;
      // An error must not start an unbounded chain of retries.
      if (!completed) return false;
      if (state.current?.id && state.dirty) {
        await new Promise(resolve => setTimeout(resolve, 0));
        return saveNow();
      }
      return true;
    }
    if (!state.current || !state.dirty) return true;
    if (!isEditor()) return false;
    const story = clone(state.current);
    const capturedRevision = state.revision;
    story.updated_at = new Date().toISOString();
    state.savingPromise = (async () => {
      try {
        // A backup in IndexedDB protects edits in case the connection drops.
        await putStory(story).catch(error => console.warn('Backup locale non disponibile:', error));
        await persistStory(story);
        if (state.current?.id === story.id) state.current.updated_at = story.updated_at;
        const idx = state.stories.findIndex(item => item.id === story.id);
        if (idx >= 0) state.stories[idx] = clone(story);
        else state.stories.push(clone(story));
        state.dirty = capturedRevision !== state.revision;
        if (state.dirty) {
          setSaveStatus('Nuove modifiche da salvare…', true);
        } else setSaveStatus('Salvato su Supabase ✓');
        renderLibrary();
        $('storyUpdatedAt').textContent = `Aggiornato ${dateLabel(story.updated_at)}`;
        return true;
      } catch (error) { statusFromError(error); return false; }
    })();
    let result;
    try { result = await state.savingPromise; }
    finally { state.savingPromise = null; }
    if (result && state.dirty) {
      state.saveTimer = setTimeout(() => void saveNow(), 220);
    }
    return result;
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
      date.textContent = `${story.blocks.length} blocchi · ${story.published ? 'PUBBLICATA' : 'BOZZA'} · ${dateLabel(story.updated_at)}`;
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
    if (!(await saveNow())) return;
    const story = state.stories.find(item => item.id === id);
    if (!story) return;
    state.current = clone(story);
    if (isUUID(id)) {
      const url = new URL(window.location.href);
      url.searchParams.set('story', id);
      window.history.replaceState(null, '', url);
    }
    state.preview = !isEditor();
    renderStory();
    renderLibrary();
    $('storyStage').scrollTop = 0;
    setSaveStatus(isEditor() ? 'Salvato su Supabase ✓' : 'Geostoria pubblicata');
  }

  async function createStory() {
    if (!(await saveNow())) return;
    const story = blankStory();
    try { await persistStory(story); }
    catch (error) { statusFromError(error); return; }
    state.stories.push(clone(story));
    await selectStory(story.id);
    notice('Nuova geostoria creata: puoi iniziare a scrivere.');
    $('storyTitle').focus();
  }

  async function duplicateCurrent() {
    if (!(await saveNow())) return;
    const story = clone(state.current);
    story.id = uid();
    story.title = `${story.title} (copia)`;
    story.published = false;
    story.blocks = story.blocks.map(block => ({ ...block, id: uid() }));
    story.created_at = story.updated_at = new Date().toISOString();
    try { await persistStory(story); }
    catch (error) { statusFromError(error); return; }
    state.stories.push(clone(story));
    await selectStory(story.id);
    notice('Geostoria duplicata.');
  }

  async function deleteCurrent() {
    if (!state.current) return;
    if (!confirm(`Eliminare definitivamente da Supabase la geostoria “${state.current.title}”? Esporta prima un JSON se vuoi conservarla.`)) return;
    if (!(await saveNow())) return;
    const id = state.current.id;
    try {
      const { error: linksError } = await client().from('geostory_waypoints').delete().eq('geostory_id', id);
      if (linksError) throw linksError;
      const { error } = await client().from('geostories').delete().eq('id', id);
      if (error) throw error;
      await deleteStory(id).catch(localError => console.warn('Backup locale non eliminato:', localError));
    }
    catch (error) { statusFromError(error); return; }
    state.stories = state.stories.filter(story => story.id !== id);
    if (state.stories.length) await selectStory(state.stories[0].id);
    else { state.current = null; renderLibrary(); showEmptyStories(true); }
    notice('Geostoria eliminata da Supabase.');
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
    const publish = $('publishStoryButton');
    publish.textContent = story.published ? '● Pubblicata' : '○ Bozza privata';
    publish.setAttribute('aria-pressed', String(Boolean(story.published)));
    publish.classList.toggle('is-published', Boolean(story.published));
    const linked = new Set([...(story.linkedWaypointIds || []), ...story.blocks.filter(block => block.type === 'waypoint').map(block => block.waypointId)]);
    $('linkedWaypointCount').textContent = String([...linked].filter(id => state.waypoints.some(point => point.id === id)).length);
  }

  function openLinkedWaypoints() {
    if (!isEditor() || !state.current) return;
    const list = $('linkedWaypointList');
    list.replaceChildren();
    $('linkedWaypointSearch').value = '';
    $('linkedWaypointWarning').hidden = true;
    const embedded = new Set(state.current.blocks.filter(block => block.type === 'waypoint').map(block => block.waypointId));
    const selected = new Set([...(state.current.linkedWaypointIds || []), ...embedded]);
    if (!state.waypoints.length) {
      const message = document.createElement('p');
      message.className = 'story-link-empty';
      message.textContent = 'Non hai ancora waypoint. Creane uno dalla mappa, poi potrai associarlo alla geostoria.';
      list.append(message);
    }
    for (const point of state.waypoints) {
      const row = document.createElement('label');
      row.className = 'story-link-item';
      row.dataset.search = `${point.title} ${point.area || ''}`.toLocaleLowerCase('it-IT');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = point.id;
      input.checked = selected.has(point.id);
      input.disabled = embedded.has(point.id);
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = point.title;
      const note = document.createElement('small');
      note.textContent = `${point.area || 'Luogo senza località'}${!point.published ? ' · BOZZA' : ''}${embedded.has(point.id) ? ' · PRESENTE NEI BLOCCHI' : ''}`;
      copy.append(name, note);
      row.append(input, copy);
      list.append(row);
    }
    $('linkedWaypointsDialog').showModal();
    $('linkedWaypointSearch').focus();
  }

  async function saveLinkedWaypoints() {
    if (!isEditor() || !state.current) return;
    const dialog = $('linkedWaypointsDialog');
    const button = $('saveLinkedWaypoints');
    const selected = [...$('linkedWaypointList').querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
    const previous = state.current.linkedWaypointIds || [];
    const storyId = state.current.id;
    button.disabled = true;
    state.current.linkedWaypointIds = selected;
    queueSave();
    renderHeading();
    try {
      if (!(await saveNow())) throw new Error('Controlla la connessione e riprova.');
      if (state.current?.id === storyId) dialog.close();
      notice(`${selected.length} waypoint associati alla geostoria.`);
    } catch (error) {
      if (state.current?.id === storyId) state.current.linkedWaypointIds = previous;
      renderHeading();
      const warning = $('linkedWaypointWarning');
      warning.textContent = `Collegamenti non salvati: ${error.message}`;
      warning.hidden = false;
    } finally { button.disabled = false; }
  }

  // Public soundtrack URLs: keep playable source links restricted to this
  // project's audio bucket, rather than allowing arbitrary protocols.
  function safeSoundtrackUrl(input) {
    if (typeof input !== 'string' || !input) return '';
    try {
      const url = new URL(input);
      const prefix = new URL(config.supabase.url);
      if (url.protocol !== 'https:' || url.origin !== prefix.origin) return '';
      if (!url.pathname.startsWith('/storage/v1/object/public/geostory-audio/')) return '';
      if (!/\.mp3$/i.test(decodeURIComponent(url.pathname))) return '';
      return url.href;
    } catch { return ''; }
  }

  let activeSoundtrackStoryId = null;
  function renderSoundtrack() {
    const story = state.current;
    const audio = $('storySoundtrackAudio');
    const panel = $('storySoundtrackPanel');
    const url = safeSoundtrackUrl(story?.soundtrack_url);
    const changed = activeSoundtrackStoryId !== story?.id || audio.dataset.track !== url;
    if (changed) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.dataset.track = url;
      activeSoundtrackStoryId = story?.id || null;
      if (url) audio.src = url;
      audio.muted = false;
      audio.loop = true;
    }
    panel.hidden = !url && !isEditor();
    $('soundtrackListenerControls').hidden = !url;
    $('soundtrackEditorControls').hidden = !isEditor();
    $('soundtrackRemoveButton').hidden = !url;
    const soundtrackStatus = $('soundtrackStatus');
    soundtrackStatus.textContent = url ? 'Colonna sonora' : 'Nessuna traccia associata';
    // Hide technical soundtrack metadata from the published story and preview.
    soundtrackStatus.hidden = Boolean(url) && (state.preview || !isEditor());
    $('soundtrackPlayButton').textContent = audio.paused ? '▶ Ascolta' : 'Ⅱ Pausa';
    $('soundtrackMuteButton').textContent = audio.muted ? '🔇 Riattiva audio' : '🔊 Mute';
    $('soundtrackMuteButton').setAttribute('aria-pressed', String(audio.muted));
  }

  async function uploadSoundtrack(file) {
    if (!file || !isEditor() || !state.current) return;
    const storyId = state.current.id;
    const isMp3 = /\.mp3$/i.test(file.name) && ['audio/mpeg','audio/mp3','application/octet-stream',''].includes(file.type);
    if (!isMp3) { notice('Scegli un file MP3 valido.'); return; }
    if (!file.size || file.size > 20 * 1024 * 1024) {
      notice('Il file MP3 deve essere inferiore a 20 MB.');
      return;
    }
    const button = $('soundtrackUploadButton');
    button.disabled = true;
    try {
      setSaveStatus('Caricamento musica MP3…',true);
      const path = window.atlasAuth.user.id + '/geostories/' + storyId + '/' + uid() + '.mp3';
      const bucket = client().storage.from('geostory-audio');
      const { error } = await bucket.upload(path,file,{contentType:'audio/mpeg',upsert:false});
      if (error) throw error;
      const url = bucket.getPublicUrl(path).data.publicUrl;
      if (!safeSoundtrackUrl(url)) throw new Error('URL audio non valido.');
      if (state.current?.id !== storyId) {
        notice('Musica caricata; torna alla storia originaria per associarla.');
        return;
      }
      state.current.soundtrack_url = url;
      queueSave();
      renderSoundtrack();
      if (await saveNow()) notice('Musica associata alla Geostoria. Avvio su richiesta, loop automatico.');
    } catch (error) {
      console.error('Errore MP3',error);
      notice('Caricamento MP3 non riuscito: ' + (error.message || error));
      setSaveStatus('Controlla il caricamento MP3');
    } finally { button.disabled = false; }
  }

  function bindSoundtrackEvents() {
    const audio = $('storySoundtrackAudio');
    const play = $('soundtrackPlayButton');
    const mute = $('soundtrackMuteButton');
    const fileInput = $('soundtrackFileInput');
    const upload = $('soundtrackUploadButton');
    const remove = $('soundtrackRemoveButton');
    play.addEventListener('click',async () => {
      if (!audio.src) return;
      if (!audio.paused) { audio.pause(); return; }
      try { await audio.play(); }
      catch (error) {
        console.warn('Riproduzione audio non disponibile:',error);
        notice('Il browser non ha avviato la musica: riprova con Ascolta.');
      }
    });
    mute.addEventListener('click',() => {
      audio.muted = !audio.muted;
      renderSoundtrack();
    });
    for (const type of ['play','pause','ended','volumechange']) audio.addEventListener(type,() => {
      play.textContent = audio.paused ? '▶ Ascolta' : 'Ⅱ Pausa';
      mute.textContent = audio.muted ? '🔇 Riattiva audio' : '🔊 Mute';
      mute.setAttribute('aria-pressed',String(audio.muted));
    });
    audio.addEventListener('error',() => {
      if (audio.currentSrc) notice('Impossibile caricare il file MP3. Controlla che sia disponibile.');
    });
    upload.addEventListener('click',() => fileInput.click());
    fileInput.addEventListener('change',event => {
      void uploadSoundtrack(event.target.files?.[0]);
      event.target.value = '';
    });
    remove.addEventListener('click',async () => {
      if (!isEditor() || !state.current?.soundtrack_url) return;
      state.current.soundtrack_url = '';
      queueSave();
      renderSoundtrack();
      if (await saveNow()) notice('Colonna sonora rimossa dalla Geostoria.');
    });
  }

  function renderStory() {
    const preview = state.preview;
    $('storyDocument').hidden = false;
    $('storyStage').querySelector('.story-access-gate')?.remove();
    $('storyApp').classList.toggle('is-preview', preview);
    $('previewButton').setAttribute('aria-pressed', String(preview));
    $('previewIcon').textContent = preview ? '✎' : '◉';
    $('previewLabel').textContent = preview ? 'Modifica' : 'Anteprima';
    renderHeading();
    renderSoundtrack();
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

  function makeMarkdownToolbar(block, field) {
    const toolbar = document.createElement('div');
    toolbar.className = 'markdown-format-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Formattazione Markdown del testo selezionato');

    let selection = null;
    const remember = () => { selection = { start: field.selectionStart, end: field.selectionEnd }; };
    ['select', 'keyup', 'mouseup', 'input'].forEach(event => field.addEventListener(event, remember));

    const wrapSelected = (prefix, suffix, fallback = 'testo') => {
      const start = Math.min(field.value.length, selection?.start ?? field.selectionStart ?? field.value.length);
      const end = Math.min(field.value.length, selection?.end ?? field.selectionEnd ?? start);
      const chosen = field.value.slice(start, end) || fallback;
      const multiline = chosen.includes('\n');
      const formatLine = line => {
        if (!line.trim()) return line;
        const marker = /^(\s*(?:#{1,4}\s+|[-*+]\s+|\d+\.\s+|>\s?))/.exec(line)?.[0] || '';
        return marker + prefix + line.slice(marker.length) + suffix;
      };
      const replacement = multiline ? chosen.split('\n').map(formatLine).join('\n') : prefix + chosen + suffix;
      field.setRangeText(replacement, start, end, 'end');
      block.text = field.value;
      field.focus({ preventScroll: true });
      if (multiline) field.setSelectionRange(start, start + replacement.length);
      else field.setSelectionRange(start + prefix.length, start + prefix.length + chosen.length);
      remember();
      queueSave();
    };

    const addButton = (parent, label, title, prefix, suffix, className = '') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => wrapSelected(prefix, suffix));
      parent.append(button);
    };

    const formats = document.createElement('div');
    formats.className = 'markdown-toolbar-group';
    addButton(formats, 'B', 'Grassetto · **testo**', '**', '**', 'markdown-bold');
    addButton(formats, 'I', 'Corsivo · *testo*', '*', '*', 'markdown-italic');
    addButton(formats, 'S', 'Barrato · ~~testo~~', '~~', '~~', 'markdown-strike');
    addButton(formats, '⌁', 'Collegamento Markdown', '[', '](https://esempio.it)', 'markdown-link');
    toolbar.append(formats);

    const fonts = document.createElement('select');
    fonts.className = 'markdown-font-select';
    fonts.setAttribute('aria-label', 'Carattere del testo selezionato');
    for (const [value, name] of [['', 'Carattere…'], ['sans', 'Moderno'], ['serif', 'Editoriale'], ['script', 'Corsivo elegante']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = name;
      fonts.append(option);
    }
    fonts.addEventListener('change', () => {
      if (fonts.value) wrapSelected('<span class="atlas-' + fonts.value + '">', '</span>');
      fonts.value = '';
    });
    toolbar.append(fonts);

    const colors = document.createElement('div');
    colors.className = 'markdown-toolbar-group markdown-color-group';
    colors.setAttribute('aria-label', 'Colori del testo');
    for (const [name, color] of [['Bosco', '#315D47'], ['Terracotta', '#A5664F'], ['Ardesia', '#526F84'], ['Ocra', '#A0783A'], ['Grafite', '#3C4A43']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'markdown-color-swatch';
      button.title = 'Colore ' + name + ' sul testo selezionato';
      button.setAttribute('aria-label', button.title);
      button.style.setProperty('--swatch', color);
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => wrapSelected('<span style="color:' + color + '">', '</span>'));
      colors.append(button);
    }
    toolbar.append(colors);
    return toolbar;
  }

  function blockTitle(block) {
    switch (block.type) {
      case 'heading': return block.text || 'Nuovo titolo';
      case 'paragraph': return (block.text || '').slice(0, 35) || 'Paragrafo';
      case 'waypoint': return state.waypoints.find(point => String(point.id) === block.waypointId)?.title || 'Waypoint';
      case 'image': return block.caption || 'Fotografia';
      case 'video': return block.caption || 'Video';
      case 'separator': return 'Separatore · ' + ({ line: 'Linea', ornament: 'Ornamento', dots: 'Puntini' }[block.style] || 'Ornamento');
      case 'gallery': return 'Galleria · ' + (block.photos?.length || 0) + ' foto';
      case 'quote': return (block.text || '').slice(0,35) || 'Citazione';
      case 'insight': return block.title || 'Approfondimento';
      case 'route': return block.title || 'Percorso';
      case 'compare': return block.caption || 'Prima / dopo';
      case 'timeline': return 'Linea del tempo · ' + (block.events?.length || 0) + ' tappe';
      case 'chapter': return block.title || 'Capitolo';
      case 'map': return block.caption || 'Mini-mappa';
      default: return 'Blocco';
    }
  }


  // Chapter navigation appears automatically in long published stories.
  function renderChapterNav() {
    const nav=$('storyChapterNav');
    if(!nav)return;
    const chapters=state.current.blocks.filter(block =>
      ['heading','chapter'].includes(block.type) && (block.title||block.text||'').trim()
    );
    nav.hidden=!state.preview||chapters.length<2;
    nav.replaceChildren();
    if(nav.hidden)return;
    const label=document.createElement('strong');
    label.className='story-chapter-nav-title';
    label.textContent='Nel racconto';
    nav.append(label);
    const links=document.createElement('div');
    links.className='story-chapter-links';
    chapters.forEach((block,index)=>{
      const link=document.createElement('button');
      link.type='button';
      link.className='story-chapter-link';
      link.textContent=String(index+1).padStart(2,'0')+'  '+(block.title||block.text||'').replace(/<[^>]*>|[*_#]/g,'').slice(0,55);
      link.addEventListener('click',()=>document.getElementById('block-'+block.id)?.scrollIntoView({behavior:'smooth',block:'start'}));
      links.append(link);
    });
    nav.append(links);
  }
  function updateReadingProgress() {
    const bar=$('storyReadingProgress'),fill=$('storyReadingProgressFill');
    if(!bar||!fill)return;
    bar.hidden=!state.preview||$('storyDocument').hidden;
    if(bar.hidden)return;
    const stage=$('storyStage'),height=stage.scrollHeight-stage.clientHeight;
    let ratio;
    if(height>10&&getComputedStyle(stage).overflowY!=='visible'){
      ratio=stage.scrollTop/height;
    }else{
      const rect=$('storyDocument').getBoundingClientRect();
      ratio=(window.innerHeight*.2-rect.top)/Math.max(1,rect.height-window.innerHeight*.8);
    }
    fill.style.width=Math.round(Math.max(0,Math.min(1,ratio))*100)+'%';
  }
  function bindReadingProgress() {
    $('storyStage').addEventListener('scroll',updateReadingProgress,{passive:true});
    window.addEventListener('scroll',updateReadingProgress,{passive:true});
    window.addEventListener('resize',updateReadingProgress,{passive:true});
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

  function imageKitVideoUrl(input) {
    if (typeof input !== 'string' || !input.trim()) return '';
    try {
      const url = new URL(input.trim());
      return url.protocol === 'https:' && url.hostname.toLowerCase() === 'ik.imagekit.io' && /\.mp4$/i.test(decodeURIComponent(url.pathname)) ? url.href : '';
    } catch { return ''; }
  }

  function imageKitVideoDisplay(url) {
    const frame = document.createElement('div');
    frame.className = 'imagekit-frame';
    const video = document.createElement('video');
    video.src = url;
    video.preload = 'metadata';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-label', 'Video della geostoria');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'imagekit-video-toggle';
    const icon = document.createElement('span');
    icon.className = 'imagekit-play-icon';
    icon.setAttribute('aria-hidden', 'true');
    toggle.append(icon);

    const updatePlayback = () => {
      const paused = video.paused || video.ended;
      toggle.classList.toggle('is-playing', !paused);
      toggle.setAttribute('aria-label', paused ? 'Riproduci video' : 'Metti in pausa');
      icon.textContent = paused ? '▶' : 'Ⅱ';
    };
    toggle.addEventListener('click', () => {
      if (video.paused || video.ended) video.play().catch(() => updatePlayback());
      else video.pause();
    });
    ['play', 'pause', 'ended'].forEach(event => video.addEventListener(event, updatePlayback));
    video.addEventListener('error', () => {
      toggle.title = 'Impossibile caricare il video';
      updatePlayback();
    });

    const fullscreen = document.createElement('button');
    fullscreen.type = 'button';
    fullscreen.className = 'imagekit-video-fullscreen';
    fullscreen.textContent = '⛶';
    fullscreen.setAttribute('aria-label', 'Schermo intero');
    fullscreen.title = 'Schermo intero';
    fullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
      if (frame.requestFullscreen) frame.requestFullscreen().catch(() => video.webkitEnterFullscreen?.());
      else video.webkitEnterFullscreen?.();
    });

    frame.append(video, toggle, fullscreen);
    updatePlayback();
    return frame;
  }

  function videoDisplay(url) {
    const mp4 = imageKitVideoUrl(url);
    if (mp4) return imageKitVideoDisplay(mp4);
    const id = youtubeId(url);
    if (!id) {
      const empty = document.createElement('div');
      empty.className = 'youtube-placeholder';
      empty.append(emptyMedia('Incolla un link YouTube o MP4 ImageKit valido', '▶'));
      return empty;
    }
    const container = document.createElement('div');
    container.className = 'youtube-frame';
    const iframe = document.createElement('iframe');
    // Existing YouTube blocks remain compatible.
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + id + '?controls=0&playsinline=1&rel=0';
    iframe.title = 'Video YouTube incorporato nella geostoria';
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    container.append(iframe);
    return container;
  }

  function separatorDisplay(style) {
    const allowed = ['line', 'ornament', 'dots'];
    const variant = allowed.includes(style) ? style : 'ornament';
    const separator = document.createElement('div');
    separator.className = 'story-decorative-separator style-' + variant;
    separator.setAttribute('role', 'separator');
    separator.setAttribute('aria-label', 'Separatore decorativo');
    const mark = document.createElement('span');
    mark.className = 'separator-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = variant === 'ornament' ? '✳' : variant === 'dots' ? '• • •' : '';
    separator.append(mark);
    return separator;
  }

  function makeMiniMap(block) {
    const map = document.createElement('div');
    map.className = 'mini-map';
    map.dataset.miniMap = block.id;
    map.setAttribute('role', 'application');
    map.setAttribute('aria-label', `Mini-mappa alle coordinate ${block.lat}, ${block.lon}`);
    return map;
  }


  // Presentation settings belong to each block in the existing JSONB 'blocks'
  // value, so old stories keep working and Supabase needs no schema change.
  const BLOCK_LAYOUT_CHOICES = {
    width: [['full', '100%'], ['wide', '75%'], ['half', '50%']],
    align: [['left', 'Sinistra'], ['center', 'Centro'], ['right', 'Destra']],
    background: [['none', 'Nessuno'], ['mist', 'Nebbia'], ['sage', 'Salvia'], ['sand', 'Sabbia'], ['sky', 'Cielo']],
    motion: [['rise', 'Scorrimento lieve'], ['fade', 'Dissolvenza'], ['none', 'Nessuna']]
  };
  const BLOCK_LAYOUT_DEFAULTS = { width: 'full', align: 'left', background: 'none', motion: 'rise' };

  function normalizeBlockLayout(value) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const layout = {};
    for (const [key, options] of Object.entries(BLOCK_LAYOUT_CHOICES)) {
      layout[key] = options.some(([id]) => id === raw[key]) ? raw[key] : BLOCK_LAYOUT_DEFAULTS[key];
    }
    return layout;
  }

  function applyBlockLayout(article, block) {
    const layout = normalizeBlockLayout(block.layout);
    article.dataset.blockWidth = layout.width;
    article.dataset.blockAlign = layout.align;
    article.dataset.blockBackground = layout.background;
    article.dataset.blockMotion = layout.motion;
  }

  function makeBlockAppearancePanel(article, block) {
    const details = document.createElement('details');
    details.className = 'block-layout-panel';
    const summary = document.createElement('summary');
    const getLabel = (key, choice) => BLOCK_LAYOUT_CHOICES[key].find(([id]) => id === choice)?.[1] || choice;
    const refreshSummary = () => {
      const layout = normalizeBlockLayout(block.layout);
      summary.textContent = `Aspetto · ${getLabel('width', layout.width)} · ${getLabel('align', layout.align)} · ${getLabel('background', layout.background)}`;
    };
    refreshSummary();
    const controls = document.createElement('div');
    controls.className = 'block-layout-fields';
    for (const [key, caption] of [['width', 'LARGHEZZA'], ['align', 'ALLINEAMENTO'], ['background', 'SFONDO'], ['motion', 'ANIMAZIONE']]) {
      const label = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = caption;
      const select = document.createElement('select');
      select.className = 'block-layout-select';
      for (const [value, title] of BLOCK_LAYOUT_CHOICES[key]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = title;
        select.append(option);
      }
      select.value = normalizeBlockLayout(block.layout)[key];
      select.addEventListener('change', () => {
        block.layout = { ...normalizeBlockLayout(block.layout), [key]: select.value };
        applyBlockLayout(article, block);
        refreshSummary();
        queueSave();
        if (key === 'width') requestAnimationFrame(() => state.maps.forEach(map => map.invalidateSize()));
      });
      label.append(name, select);
      controls.append(label);
    }
    const tip = document.createElement('p');
    tip.className = 'block-layout-tip';
    tip.textContent = 'Due blocchi consecutivi al 50% si affiancano. Su schermi piccoli tornano in colonna.';
    details.append(summary, controls, tip);
    return details;
  }

  function initializeBlockReveals(container) {
    state.revealObserver?.disconnect();
    state.revealObserver = null;
    if (!state.preview || typeof IntersectionObserver !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const blocks = [...container.querySelectorAll('.story-block[data-block-motion]:not([data-block-motion="none"])')];
    if (!blocks.length) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('story-block-revealed');
        observer.unobserve(entry.target);
      }
    }, { threshold: .08, rootMargin: '0px 0px -20px 0px' });
    state.revealObserver = observer;
    blocks.forEach((block, index) => {
      block.style.setProperty('--reveal-delay', `${index % 3 * 70}ms`);
      block.classList.add('story-block-reveal');
      observer.observe(block);
    });
  }

  function renderBlock(block, index) {
    const preview = state.preview;
    const article = document.createElement('section');
    article.className = `story-block${preview ? ' is-preview' : ''}`;
    if (block.type === 'separator') article.classList.add('separator-block');
    article.id = `block-${block.id}`;
    applyBlockLayout(article, block);
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
      article.append(makeBlockAppearancePanel(article, block));
    }

    const content = document.createElement('div');
    if (!preview) content.className = 'block-editor-content';
    switch (block.type) {
      case 'heading': {
        if (preview) {
          const h = document.createElement('h2');
          h.className = 'preview-heading';
          appendMarkdownInline(h, block.text || 'Nuova sezione');
          content.append(h);
        } else {
          content.append(window.AtlasRichEditor.mount({ block, heading: true, renderMarkdown, appendMarkdownInline, queueSave }));
        }
        break;
      }
      case 'paragraph': {
        if (preview) {
          content.append(renderMarkdown(block.text));
        } else {
          content.append(window.AtlasRichEditor.mount({ block, heading: false, renderMarkdown, appendMarkdownInline, queueSave }));
        }
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
          hint.textContent = 'La foto verrà caricata su Supabase Storage.';
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
        if (!preview) content.append(makeControl('URL DEL VIDEO · YOUTUBE O IMAGEKIT MP4', { type: 'url', value: block.url, placeholder: 'https://ik.imagekit.io/.../filmato.mp4', live: false, onChange: value => { block.url = value; queueSave(); renderBlocks(); } }));
        const media = videoDisplay(block.url);
        media.style.marginTop = preview ? '0' : '13px';
        content.append(media);
        if (preview) appendCaption(content, block.caption);
        else content.append(makeControl('DIDASCALIA', { value: block.caption, placeholder: 'Una nota sul video…', onChange: value => { block.caption = value; queueSave(); } }));
        break;
      }
      case 'separator': {
        if (!preview) {
          content.append(makeControl('STILE DEL SEPARATORE', {
            kind: 'select', value: block.style || 'ornament',
            options: [{ value: 'line', label: 'Linea sottile' }, { value: 'ornament', label: 'Piccolo ornamento' }, { value: 'dots', label: 'Tre puntini' }],
            onChange: value => { block.style = value; queueSave(); renderBlocks(); }
          }));
        }
        content.append(separatorDisplay(block.style));
        break;
      }
      case 'gallery':
      case 'quote':
      case 'insight':
      case 'route':
      case 'compare':
      case 'timeline':
      case 'chapter': {
        content.append(window.AtlasNarrative.render(block, preview, {
          imageUrl, renderMarkdown, appendMarkdownInline,
          save: queueSave, renderAll: renderBlocks, notice,
          isActive: id => Boolean(state.current?.blocks.some(item => item.id === id)),
          uploadImages: uploadNarrativeImages,
          makeRichText: item => window.AtlasRichEditor.mount({
            block: item, heading: false, renderMarkdown, appendMarkdownInline, queueSave
          })
        }));
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
    container.classList.add('story-blocks-layout');
    state.current.blocks.forEach((block, index) => container.append(renderBlock(block, index)));
    initializeBlockReveals(container);
    renderOutline();
    renderChapterNav();
    requestAnimationFrame(() => {
      initializeMiniMaps();
      window.AtlasNarrative?.initializeRoutes(container, state.current.blocks, state.maps, config);
      updateReadingProgress();
    });
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
    const common = { id: uid(), type, layout: normalizeBlockLayout() };
    switch (type) {
      case 'heading': return { ...common, text: 'Una nuova sezione' };
      case 'paragraph': return { ...common, text: '' };
      case 'waypoint': return { ...common, waypointId: String(state.waypoints[0]?.id || ''), caption: '' };
      case 'image': return { ...common, src: '', caption: '' };
      case 'video': return { ...common, url: '', caption: '' };
      case 'separator': return { ...common, style: 'ornament' };
      case 'gallery': return { ...common, photos: [] };
      case 'quote': return { ...common, text: '', credit: '' };
      case 'insight': return { ...common, theme: 'curiosita', title: '', text: '' };
      case 'route': return { ...common, title: '', caption: '', segments: [] };
      case 'compare': return { ...common, before: '', after: '', beforeLabel: 'Prima', afterLabel: 'Dopo', caption: '' };
      case 'timeline': return { ...common, events: [] };
      case 'chapter': return { ...common, kicker: 'UN NUOVO CAPITOLO', title: 'Una nuova tappa', subtitle: '', src: '' };
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

  async function uploadImageData(src, storyId) {
    if (!isEditor()) throw new Error('Effettua l’accesso come editor per caricare le foto.');
    const blob = await (await fetch(src)).blob();
    if (blob.size > 10000000) throw new Error('Foto troppo grande per lo Storage (10 MB).');
    const path = `${window.atlasAuth.user.id}/geostories/${storyId}/${uid()}.jpg`;
    const { error } = await client().storage.from(config.supabase.photoBucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    return client().storage.from(config.supabase.photoBucket).getPublicUrl(path).data.publicUrl;
  }


  async function uploadNarrativeImages(files,blockId,target) {
    if(!isEditor()||!state.current)return;
    const storyId=state.current.id;
    const block=state.current.blocks.find(b=>b.id===blockId);
    if(!block)return;
    const batch=Array.from(files||[]).slice(0,12);
    let uploaded=0;
    try {
      for(const file of batch) {
        if(!file?.type?.startsWith('image/'))throw new Error('Seleziona soltanto fotografie.');
        if(state.current?.id!==storyId)return;
        if(target==='gallery'&&(block.photos?.length||0)>=12)break;
        setSaveStatus('Caricamento fotografia '+(uploaded+1)+'/'+batch.length+'…',true);
        const jpeg=await imageToDataUrl(file);
        const src=await uploadImageData(jpeg,storyId);
        if(state.current?.id!==storyId)return;
        if(target==='gallery'){
          block.photos=Array.isArray(block.photos)?block.photos:[];
          block.photos.push({src,caption:''});
        }else if(target==='before'||target==='after')block[target]=src;
        else if(target==='chapter')block.src=src;
        uploaded++;queueSave();
      }
      if(state.current?.id===storyId){
        renderBlocks();
        if(uploaded){if(await saveNow())notice(uploaded+' fotografie caricate.');}
        else notice('Nessuna fotografia aggiunta (massimo 12 nella galleria).');
      }
    }catch(error){
      console.error('Fotografia narrativa:',error);
      if(state.current?.id===storyId){renderBlocks();notice(error.message||'Caricamento non riuscito.');}
    }
  }

  async function uploadLocalImage(file, blockId = null) {
    if (!file) return;
    const activeStoryId = state.current?.id;
    try {
      setSaveStatus('Elaboro la fotografia…', true);
      const dataUrl = await imageToDataUrl(file);
      setSaveStatus('Caricamento fotografia nel cloud…', true);
      const src = await uploadImageData(dataUrl, activeStoryId);
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
      if (await saveNow()) notice('Fotografia caricata su Supabase.');
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
    notice('Geostoria esportata in JSON. Le foto online sono collegate tramite URL.');
  }

  function normalizedStory(raw) {
    if (!raw || !Array.isArray(raw.blocks)) throw new Error('Formato geostoria non valido.');
    const base = blankStory();
    base.title = asText(raw.title || 'Geostoria importata', 180);
    base.subtitle = asText(raw.subtitle, 400);
    base.kicker = asText(raw.kicker || 'GEOSTORIA IMPORTATA', 70);
    base.cover = imageUrl(raw.cover);
    base.soundtrack_url = safeSoundtrackUrl(raw.soundtrack_url);
    base.linkedWaypointIds = [...new Set((Array.isArray(raw.linkedWaypointIds) ? raw.linkedWaypointIds : []).filter(isUUID))];
    base.blocks = raw.blocks.slice(0, 150).filter(item => item && TYPES.includes(item.type)).map(item => {
      const block = defaultBlock(item.type);
      block.layout = normalizeBlockLayout(item.layout);
      if (['heading', 'paragraph'].includes(item.type)) block.text = asText(item.text);
      if (item.type === 'waypoint') { block.waypointId = asText(item.waypointId, 100); block.caption = asText(item.caption, 1000); }
      if (item.type === 'image') { block.src = imageUrl(item.src); block.caption = asText(item.caption, 1000); }
      if (item.type === 'video') { block.url = (youtubeId(item.url) || imageKitVideoUrl(item.url)) ? asText(item.url, 500) : ''; block.caption = asText(item.caption, 1000); }
      if (item.type === 'separator') block.style = ['line', 'ornament', 'dots'].includes(item.style) ? item.style : 'ornament';

      if (item.type === 'gallery') block.photos = (Array.isArray(item.photos) ? item.photos : []).slice(0,12)
        .map(p => ({src:imageUrl(p?.src),caption:asText(p?.caption,500)})).filter(p=>p.src);
      if (item.type === 'quote') {block.text=asText(item.text,5000);block.credit=asText(item.credit,250);}
      if (item.type === 'insight') {
        block.theme=['geologia','storia','natura','curiosita','nota'].includes(item.theme)?item.theme:'curiosita';
        block.title=asText(item.title,150);block.text=asText(item.text,10000);
      }
      if (item.type === 'route') {
        block.title=asText(item.title,150);block.caption=asText(item.caption,1000);
        let pointCount=0;
        block.segments=(Array.isArray(item.segments)?item.segments:[]).slice(0,30).map(segment=>
          (Array.isArray(segment)?segment:[]).slice(0,4500).map(point=>{
            const lat=Number(point?.[0]),lon=Number(point?.[1]);
            const elevation=point?.[2] === undefined || point?.[2] === null ? null : Number(point[2]);
            if(Math.abs(lat)>90||Math.abs(lon)>180||!Number.isFinite(lat)||!Number.isFinite(lon)||++pointCount>4500)return null;
            return Number.isFinite(elevation)?[lat,lon,elevation]:[lat,lon];
          }).filter(Boolean)).filter(segment=>segment.length>1);
      }
      if (item.type === 'compare') {
        block.before=imageUrl(item.before);block.after=imageUrl(item.after);
        block.beforeLabel=asText(item.beforeLabel||'Prima',70);block.afterLabel=asText(item.afterLabel||'Dopo',70);
        block.caption=asText(item.caption,1000);
      }
      if (item.type === 'timeline') block.events=(Array.isArray(item.events)?item.events:[]).slice(0,20)
        .map(e=>({date:asText(e?.date,90),title:asText(e?.title,160),text:asText(e?.text,1500)}));
      if (item.type === 'chapter') {
        block.kicker=asText(item.kicker,90);block.title=asText(item.title,180);
        block.subtitle=asText(item.subtitle,450);block.src=imageUrl(item.src);
      }
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
      if (!(await saveNow())) return;
      await moveEmbeddedImagesToStorage(story);
      await persistStory(story);
      state.stories.push(clone(story));
      await selectStory(story.id);
      notice('Geostoria importata su Supabase come bozza.');
    } catch (error) { console.error(error); notice(`Importazione non riuscita: ${error.message}`); }
  }

  async function moveEmbeddedImagesToStorage(story) {
    if (String(story.cover || '').startsWith('data:image/')) story.cover = await uploadImageData(story.cover, story.id);
    for (const block of story.blocks) {
      if (block.type === 'image' && String(block.src || '').startsWith('data:image/')) {
        block.src = await uploadImageData(block.src, story.id);
      }
    }
  }

  async function importLocalStories() {
    if (!isEditor()) return;
    const imported = JSON.parse(localStorage.getItem('atlante-imported-local-stories') || '[]');
    const candidates = state.localStories.filter(story => !imported.includes(story.id) && !state.stories.some(cloud => cloud.id === story.id));
    if (!candidates.length) { notice('Non ci sono nuove bozze locali da importare.'); return; }
    if (!confirm(`Importare ${candidates.length} geostorie da questo browser su Supabase? Le copie locali non saranno eliminate e le storie importate resteranno bozze.`)) return;
    if (!(await saveNow())) return;
    let completed = 0;
    for (const source of candidates) {
      try {
        setSaveStatus(`Importazione ${completed + 1}/${candidates.length}…`, true);
        const story = normalizedStory(source);
        story.title = asText(source.title, 180);
        story.published = false;
        await moveEmbeddedImagesToStorage(story);
        await persistStory(story);
        state.stories.push(clone(story));
        imported.push(source.id);
        localStorage.setItem('atlante-imported-local-stories', JSON.stringify(imported));
        completed += 1;
      } catch (error) { console.error('Importazione bozza:', error); notice(`Importazione interrotta dopo ${completed} storie: ${error.message}`); break; }
    }
    $('importLocalButton').hidden = !state.localStories.some(story => !imported.includes(story.id) && !state.stories.some(cloud => cloud.id === story.id));
    renderLibrary();
    if (completed) { await selectStory(state.stories[state.stories.length - 1].id); notice(`${completed} geostorie importate. Le bozze originali sono ancora in questo browser.`); }
  }

  function bindEvents() {
    $('newStoryButton').addEventListener('click', () => void createStory());
    $('duplicateButton').addEventListener('click', () => void duplicateCurrent());
    $('deleteStoryButton').addEventListener('click', () => void deleteCurrent());
    $('publishStoryButton').addEventListener('click', async () => {
      if (!isEditor() || !state.current) return;
      if (!(await saveNow())) return;
      const original = Boolean(state.current.published);
      const associated = new Set([...(state.current.linkedWaypointIds || []), ...state.current.blocks.filter(block => block.type === 'waypoint').map(block => block.waypointId)]);
      if (!original && state.waypoints.some(point => associated.has(point.id) && !point.published)) {
        notice('Per pubblicare la storia, pubblica prima i waypoint associati ancora in bozza.');
        return;
      }
      state.current.published = !original;
      queueSave();
      renderHeading();
      const saved = await saveNow();
      if (!saved) {
        state.current.published = original;
        queueSave();
        renderHeading();
      } else notice(state.current.published ? 'Geostoria pubblicata: ora è visibile ai visitatori.' : 'Geostoria riportata a bozza privata.');
    });
    $('importLocalButton').addEventListener('click', () => void importLocalStories());
    $('linkWaypointsButton').addEventListener('click', openLinkedWaypoints);
    $('linkedWaypointSearch').addEventListener('input', event => {
      const query = event.target.value.trim().toLocaleLowerCase('it-IT');
      $('linkedWaypointList').querySelectorAll('.story-link-item').forEach(row => { row.hidden = !row.dataset.search.includes(query); });
    });
    $('cancelLinkedWaypoints').addEventListener('click', () => $('linkedWaypointsDialog').close());
    $('saveLinkedWaypoints').addEventListener('click', () => void saveLinkedWaypoints());
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

  function showEmptyStories(editor) {
    const stage = $('storyStage');
    $('storyDocument').hidden = true;
    if ($('storyReadingProgress')) $('storyReadingProgress').hidden = true;
    if ($('storyChapterNav')) $('storyChapterNav').hidden = true;
    $('storySoundtrackAudio')?.pause();
    $('storySoundtrackPanel').hidden = true;
    stage.querySelector('.story-access-gate')?.remove();
    const gate = document.createElement('section');
    gate.className = 'story-access-gate';
    const spark = document.createElement('div');
    spark.className = 'story-access-spark';
    spark.textContent = '✳';
    spark.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h2');
    title.innerHTML = editor ? 'La tua prima storia<br><em>comincia qui.</em>' : 'Storie da vivere,<br><em>luoghi da raccontare.</em>';
    const message = document.createElement('p');
    message.textContent = editor ? 'Non hai ancora geostorie su Supabase. Creane una, oppure importa quelle salvate in passato su questo browser.' : 'Le geostorie pubblicate compariranno qui. Le bozze restano riservate all’autore.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = editor ? '＋ Crea la prima geostoria' : 'Accesso all’editor';
    button.addEventListener('click', () => editor ? void createStory() : window.atlasAuth?.open());
    gate.append(spark, title, message, button);
    stage.prepend(gate);
    setSaveStatus(editor ? 'Pronto a scrivere' : 'Archivio pubblico');
  }

  async function initialize() {
    await window.atlasAuth?.ready;
    authChecked = true;
    if (editorInitialized) return;
    editorInitialized = isEditor();
    bindSoundtrackEvents();
    bindReadingProgress();
    if (editorInitialized) bindEvents();
    else {
      $('newStoryButton').hidden = true;
      document.querySelector('.story-toolbar-actions').hidden = true;
      document.querySelector('.story-local-note').hidden = true;
      document.querySelector('.story-tools').hidden = true;
    }
    try {
      await loadWaypoints();
      if (!client()) throw new Error('Connessione Supabase non disponibile');
      let query = client().from('geostories').select('id,title,subtitle,kicker,cover,soundtrack_url,blocks,published,created_at,updated_at').order('updated_at', { ascending: false });
      if (!isEditor()) query = query.eq('published', true);
      const { data, error } = await query;
      if (error) throw error;
      const { data: links, error: linksError } = await client().from('geostory_waypoints').select('geostory_id,waypoint_id,position').order('position', { ascending: true });
      if (linksError) throw linksError;
      const linkedByStory = new Map();
      for (const link of links || []) {
        if (!linkedByStory.has(link.geostory_id)) linkedByStory.set(link.geostory_id, []);
        linkedByStory.get(link.geostory_id).push(link.waypoint_id);
      }
      state.stories = (data || []).map(row => ({ ...row, blocks: Array.isArray(row.blocks) ? row.blocks : [], linkedWaypointIds: linkedByStory.get(row.id) || [] }));
      if (isEditor()) {
        try {
          state.localStories = await allStories();
          const imported = JSON.parse(localStorage.getItem('atlante-imported-local-stories') || '[]');
          $('importLocalButton').hidden = !state.localStories.some(story => !imported.includes(story.id) && !state.stories.some(cloud => cloud.id === story.id));
        } catch (localError) { console.warn('Archivio precedente non accessibile:', localError); }
      }
      renderLibrary();
      const requestedId = new URLSearchParams(window.location.search).get('story');
      if (state.stories.length) await selectStory(state.stories.find(story => story.id === requestedId)?.id || state.stories[0].id);
      else showEmptyStories(isEditor());
    } catch (error) {
      console.error('Lettura geostorie Supabase:', error);
      setSaveStatus('Connessione non disponibile');
      notice('Errore nel caricamento delle geostorie. Controlla la connessione e riprova.');
      showEmptyStories(isEditor());
    }
  }

  window.addEventListener('atlas-auth-changed', () => {
    if (authChecked && Boolean(window.atlasAuth?.editor) !== editorInitialized) window.location.reload();
  });
  void initialize();
})();
