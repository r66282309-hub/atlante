/* Atlante · viewer GLB e georeferenziazione manuale (metodo A).
   Usa Three.js soltanto quando il blocco entra in vista. */
(() => {
  'use strict';
  const active = new Set();
  const $ = (tag, cls = '', text = '') => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  };
  const finite = (v, min, max) => v !== '' && v !== null && v !== undefined
    && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
  const safeGLB = input => {
    try {
      const url = new URL(String(input || ''), location.href);
      return ['https:', 'http:'].includes(url.protocol) && /\.glb$/i.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  };
  const mod = () => Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/loaders/GLTFLoader.js')
  ]);

  function destroyAll() {
    for (const dispose of [...active]) { try { dispose(); } catch (error) { console.warn('Atlante 3D cleanup', error); } }
    active.clear();
  }

  async function mountViewer(stage, url) {
    const status = stage.querySelector('.atlas3d-status');
    if (!stage.isConnected) return;
    status.textContent = 'Caricamento modello GLB…';
    let lib;
    try { lib = await mod(); }
    catch (error) { status.textContent = 'Impossibile caricare il motore Three.js.'; return; }
    if (!stage.isConnected) return;
    const [THREE, { OrbitControls }, { GLTFLoader }] = lib;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) { status.textContent = 'WebGL non disponibile su questo dispositivo.'; return; }
    const width = Math.max(320, stage.clientWidth), height = Math.max(280, stage.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x172c30);
    stage.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.001, 1000000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .09;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x52636b, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.3);
    light.position.set(2, 6, 4);
    scene.add(light);
    const modelContainer = new THREE.Group();
    scene.add(modelContainer);
    let model = null, raf = 0, disposed = false, wireframe = false;
    let diagonal = 1;
    const hits = [], decorations = [];
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let measure = false;
    const measurements = stage.querySelector('.atlas3d-measurement');
    const buttons = stage.querySelector('.atlas3d-controls');

    const resetView = direction => {
      if (!model) return;
      const distance = diagonal * 1.55;
      const dirs = { reset: [1, .65, 1], front: [0, 0, 1], top: [0, 1, 0], right: [1, 0, 0] };
      const v = dirs[direction] || dirs.reset;
      controls.target.set(0, 0, 0);
      camera.position.set(v[0] * distance, v[1] * distance, v[2] * distance);
      camera.up.set(0, 1, 0);
      if (direction === 'top') camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);
      controls.update();
    };
    const clearMeasure = () => {
      hits.length = 0;
      for (const item of decorations) { scene.remove(item); item.geometry?.dispose(); item.material?.dispose(); }
      decorations.length = 0;
      measurements.textContent = measure ? 'Seleziona due punti sul modello.' : '';
    };
    const clickOnModel = event => {
      if (!measure || !model || event.button !== 0) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const intersect = raycaster.intersectObject(modelContainer, true).find(hit => hit.object.isMesh);
      if (!intersect) return;
      if (hits.length === 2) clearMeasure();
      const p = intersect.point.clone();
      hits.push(p);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(diagonal * .006, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc17b }));
      sphere.position.copy(p);
      scene.add(sphere); decorations.push(sphere);
      if (hits.length === 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hits), new THREE.LineBasicMaterial({ color: 0xffc17b }));
        scene.add(line); decorations.push(line);
        measurements.textContent = 'Distanza: ' + hits[0].distanceTo(hits[1]).toFixed(3) + ' unità modello (metri solo se in scala)';
      } else measurements.textContent = 'Seleziona il secondo punto.';
    };
    renderer.domElement.addEventListener('click', clickOnModel);
    const onClick = event => {
      const action = event.target.closest('[data-view]')?.dataset.view;
      if (action === 'measure') {
        measure = !measure;
        event.target.setAttribute('aria-pressed', String(measure));
        clearMeasure();
      } else if (action === 'wire') {
        wireframe = !wireframe;
        model?.traverse(obj => {
          if (!obj.isMesh) return;
          for (const material of [].concat(obj.material || [])) material.wireframe = wireframe;
        });
        event.target.setAttribute('aria-pressed', String(wireframe));
      } else if (action === 'fullscreen') {
        if (!document.fullscreenElement) stage.requestFullscreen?.().catch(() => {});
        else document.exitFullscreen?.().catch(() => {});
      } else if (action) resetView(action);
    };
    buttons.addEventListener('click', onClick);
    const resize = () => {
      if (disposed || !stage.isConnected) return;
      const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      buttons.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('click', clickOnModel);
      clearMeasure();
      controls.dispose();
      model?.traverse(object => {
        object.geometry?.dispose();
        for (const material of [].concat(object.material || [])) {
          for (const value of Object.values(material || {})) if (value?.isTexture) value.dispose();
          material?.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      active.delete(dispose);
    };
    active.add(dispose);
    animate();
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      if (disposed || !stage.isConnected) { gltf.scene.traverse(obj => obj.geometry?.dispose()); dispose(); return; }
      model = gltf.scene;
      // Il centro di visualizzazione è locale; NON altera le coordinate salvate.
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) throw new Error('Geometria vuota');
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      diagonal = Math.max(size.length(), .001);
      model.position.sub(center);
      modelContainer.add(model);
      camera.near = Math.max(diagonal / 10000, .001);
      camera.far = Math.max(diagonal * 300, 100);
      camera.updateProjectionMatrix();
      controls.minDistance = Math.max(diagonal / 1000, .001);
      controls.maxDistance = diagonal * 50;
      resetView('reset');
      status.hidden = true;
    } catch (error) {
      console.error('Caricamento GLB Atlante:', error);
      status.textContent = 'Errore nel GLB o accesso CORS non consentito.';
    }
  }

  function viewer(block, preview) {
    const container = $('div', 'atlas3d-container');
    const url = safeGLB(block.url);
    if (!url) { container.append($('p', 'atlas3d-empty', 'Inserisci un URL GLB pubblico oppure carica un file dal computer.')); return container; }
    const stage = $('div', 'atlas3d-stage');
    const status = $('div', 'atlas3d-status', 'Carica il modello per esplorarlo in 3D');
    const measurement = $('div', 'atlas3d-measurement');
    const buttons = $('div', 'atlas3d-controls');
    for (const [action, name] of [['reset','Isometrica'],['top','Alto'],['front','Fronte'],['right','Lato'],['wire','Mesh'],['measure','Misura'],['fullscreen','⛶']]) {
      const btn = $('button', '', name);
      btn.type = 'button';
      btn.dataset.view = action;
      btn.title = action === 'measure' ? 'Distanze nelle unità del modello' : name;
      if (['measure','wire'].includes(action)) btn.setAttribute('aria-pressed','false');
      buttons.append(btn);
    }
    buttons.hidden = true;
    const load = $('button', 'atlas3d-load', '▶ Apri modello 3D');
    load.type = 'button';
    let requested = false, activationObserver;
    const activate = () => {
      if (requested || !stage.isConnected) return;
      requested = true;
      activationObserver?.disconnect();
      load.remove();
      buttons.hidden = false;
      void mountViewer(stage, url);
    };
    load.addEventListener('click', activate);
    stage.append(status, measurement, buttons, load);
    container.append(stage);
    if (preview && 'IntersectionObserver' in window) {
      activationObserver = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) activate();
      }, { rootMargin: '300px' });
      requestAnimationFrame(() => { if (stage.isConnected) activationObserver.observe(stage); });
      active.add(() => activationObserver.disconnect());
    }
    return container;
  }

  function render(block, preview, ctx) {
    const root = $('div', 'atlas3d-block');
    const edited = (key, value) => { block[key] = value; ctx.save(); };
    if (!preview) {
      root.append(ctx.control('URL MODELLO GLB', {
        type: 'url', value: block.url || '', placeholder: 'https://…/scansione.glb', live: false,
        onChange: value => { edited('url', safeGLB(value)); ctx.renderAll(); }
      }));
      const uploadRow = $('div','atlas3d-upload-row');
      const upload = $('button','upload-button','＋ Carica GLB dal computer');
      upload.type = 'button';
      const file = $('input'); file.type = 'file'; file.accept = '.glb,model/gltf-binary'; file.hidden = true;
      const tip = $('small','','Fino a 45 MB; il modello pubblicato nello Storage è accessibile tramite URL.');
      upload.addEventListener('click',() => file.click());
      file.addEventListener('change', () => { if (file.files?.[0]) void ctx.upload(file.files[0],block.id); file.value=''; });
      uploadRow.append(upload,file,tip); root.append(uploadRow);
    }
    root.append(viewer(block, preview));
    if (!preview) {
      const picker = ctx.control('POSIZIONA SUL WAYPOINT', {
        kind: 'select', value: '',
        options: [{value:'',label:'Coordinate manuali'},...ctx.waypoints.map(p=>({value:p.id,label:p.title}))],
        onChange: value => {
          const point = ctx.waypoints.find(p => String(p.id) === value);
          if (!point) return;
          block.lat = Number(point.lat); block.lon = Number(point.lon);
          ctx.save(); ctx.renderAll();
        }
      });
      root.append(picker);
      root.append(ctx.control('ANCORAGGIO GEOGRAFICO DEL GLB', {
        kind: 'select', value: block.anchorMode === 'center' ? 'center' : 'origin',
        options: [
          { value: 'origin', label: 'Origine del file GLB → punto scelto (consigliato)' },
          { value: 'center', label: 'Centro geometrico GLB → punto scelto' }
        ],
        onChange: value => { edited('anchorMode', value); }
      }));
      root.append($('p', 'atlas3d-help', 'Il punto geografico non viene spostato. Gli offset servono a rifinire la posizione del modello rispetto all’ancora.'));
      const row = $('div','atlas3d-grid');
      const fields = [
        ['lat','LATITUDINE (WGS84)',-90,90],
        ['lon','LONGITUDINE (WGS84)',-180,180],
        ['altitude','QUOTA ELLISSOIDICA (m)',-12000,100000],
        ['heading','ROTAZIONE NORD / HEADING (°)',-360,360],
        ['pitch','INCLINAZIONE / PITCH (°)',-360,360],
        ['roll','ROLL (°)',-360,360],
        ['scale','SCALA (1 = ORIGINALE)',0.000001,1000000],
        ['offsetEast','OFFSET EST (m)',-100000,100000],
        ['offsetNorth','OFFSET NORD (m)',-100000,100000],
        ['offsetUp','OFFSET ALTO (m)',-100000,100000]
      ];
      for (const [key,label,min,max] of fields) {
        row.append(ctx.control(label, {
          type: 'number', value: block[key] ?? '', min, max, live:false,
          onChange: value => {
            if (value === '' && ['lat','lon'].includes(key)) { edited(key, null); return; }
            if (!finite(value,min,max) || (key === 'scale' && Number(value) <= 0)) { ctx.notice('Valore non valido: '+label); ctx.renderAll(); return; }
            edited(key,Number(value));
          }
        }));
      }
      root.append(row);
      const mapButton = $('button','atlas3d-map-picker','⌖ Seleziona posizione sulla mappa');
      mapButton.type = 'button';
      const host = $('div','atlas3d-map-picker-host');
      mapButton.addEventListener('click', () => {
        if (!window.L) { ctx.notice('Leaflet non disponibile'); return; }
        if (host.childNodes.length) { host.replaceChildren(); return; }
        const mapDiv = $('div','atlas3d-pick-map'); host.append(mapDiv);
        const lat = finite(block.lat,-90,90) ? Number(block.lat) : 40.08;
        const lon = finite(block.lon,-180,180) ? Number(block.lon) : 9.04;
        const map = L.map(mapDiv).setView([lat,lon],finite(block.lat,-90,90)?14:8);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
        const marker = L.marker([lat,lon], { draggable:true }).addTo(map);
        const setPoint = p => {
          block.lat = Number(p.lat.toFixed(7)); block.lon = Number(p.lng.toFixed(7));
          marker.setLatLng(p); ctx.save();
          const inputs = root.querySelectorAll('.atlas3d-grid input');
          inputs[0].value = block.lat; inputs[1].value = block.lon;
        };
        map.on('click', event=>setPoint(event.latlng));
        marker.on('dragend',()=>setPoint(marker.getLatLng()));
        const dispose = () => { try { map.remove(); } catch {} active.delete(dispose); };
        active.add(dispose);
        requestAnimationFrame(()=>map.invalidateSize());
      });
      root.append(mapButton,host);
    }
    if (safeGLB(block.url) && finite(block.lat,-90,90) && finite(block.lon,-180,180)) {
      const link = $('a','atlas3d-map-link','🌍 Visualizza questo modello sulla mappa 3D');
      const params = new URLSearchParams({story:ctx.storyId,block:block.id});
      link.href = '../3d/?'+params;
      link.target='_blank';link.rel='noopener noreferrer';
      root.append(link);
    }
    if (preview && block.caption) root.append($('p','atlas3d-caption',block.caption));
    if (!preview) root.append(ctx.control('DIDASCALIA', {value:block.caption||'',onChange:value=>edited('caption',value)}));
    return root;
  }
  window.Atlas3D = { render, destroyAll, safeGLB };
})();
