(() => {
  'use strict';
  // Narrative blocks plug into the existing JSONB story blocks. All media
  // is rendered via DOM APIs rather than inserting user-authored HTML.
  const $ = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const textField = (label, value, onInput, options = {}) => {
    const row = $('label', 'narrative-field');
    const title = $('span', '', label);
    const el = document.createElement(options.select ? 'select' : options.multiline ? 'textarea' : 'input');
    if (options.select) {
      options.select.forEach(([id, name]) => {
        const opt = $('option', '', name); opt.value = id; el.append(opt);
      });
    } else if (options.multiline) el.rows = options.rows || 3;
    else el.type = options.type || 'text';
    el.value = value || '';
    el.placeholder = options.placeholder || '';
    el.addEventListener(options.commit ? 'change' : 'input', () => onInput(el.value));
    row.append(title, el);
    return row;
  };
  const button = (label, action, cls = '') => {
    const btn = $('button', cls, label);
    btn.type = 'button';
    btn.addEventListener('click', action);
    return btn;
  };
  const image = (src, caption, ctx) => {
    const url = ctx.imageUrl(src);
    if (!url) return $('div','narrative-empty','▧  La fotografia apparirà qui');
    const img = $('img'); img.src = url; img.alt = caption || 'Fotografia della geostoria';
    img.loading = 'lazy'; img.decoding = 'async';
    img.onerror = () => img.replaceWith($('div','narrative-empty','Immagine non disponibile'));
    return img;
  };
  const imageUpload = (block, key, ctx, multiple = false) => {
    const row = $('div','narrative-upload');
    const input = $('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = multiple; input.hidden = true;
    const trigger = button(multiple ? '＋ Carica fotografie' : '▧ Carica immagine', () => input.click());
    input.addEventListener('change', () => {
      if (input.files?.length) void ctx.uploadImages([...input.files],block.id,key);
      input.value = '';
    });
    row.append(trigger,input);
    return row;
  };
  const safeItems = block => (Array.isArray(block.photos) ? block.photos : []).filter(item => item && typeof item.src === 'string').slice(0,12);

  function showGallery(block,ctx) {
    const items = safeItems(block).filter(item => ctx.imageUrl(item.src));
    if (!items.length) return $('div','narrative-gallery narrative-empty','Aggiungi fotografie per creare la galleria');
    const root = $('div','narrative-gallery');
    const frame = $('div','narrative-gallery-frame');
    const photoButton = button('', () => {
      const dialog = $('dialog','narrative-lightbox');
      const close = button('×',() => { dialog.close();dialog.remove(); },'narrative-lightbox-close');
      close.setAttribute('aria-label','Chiudi foto ingrandita');
      const large = image(items[position].src,items[position].caption,ctx);
      dialog.append(close,large);
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});
      document.body.append(dialog); dialog.showModal();
    },'narrative-gallery-photo');
    photoButton.setAttribute('aria-label','Apri la fotografia a schermo intero');
    const count = $('span','narrative-photo-counter');
    const caption = $('p','narrative-gallery-caption');
    const previous = button('‹',()=>move(-1),'narrative-gallery-nav narrative-prev');
    const next = button('›',()=>move(1),'narrative-gallery-nav narrative-next');
    previous.setAttribute('aria-label','Foto precedente'); next.setAttribute('aria-label','Foto successiva');
    const thumbs = $('div','narrative-gallery-thumbs');
    let position = 0;
    function move(delta) { position = (position + delta + items.length) % items.length; refresh(); }
    function refresh() {
      photoButton.replaceChildren(image(items[position].src,items[position].caption,ctx));
      caption.textContent = items[position].caption || '';
      caption.hidden = !items[position].caption;
      count.textContent = (position + 1) + ' / ' + items.length;
      for (const [i,child] of [...thumbs.children].entries()) {
        child.classList.toggle('is-active',i===position);
        child.setAttribute('aria-pressed',String(i===position));
      }
    }
    items.forEach((item,i) => {
      const thumb = button('',()=>{position=i;refresh();},'narrative-gallery-thumb');
      thumb.title = item.caption || 'Fotografia ' + (i+1);
      thumb.setAttribute('aria-label','Vai alla fotografia ' + (i+1));
      thumb.append(image(item.src,item.caption,ctx)); thumbs.append(thumb);
    });
    if (items.length < 2) { previous.hidden = true;next.hidden = true;thumbs.hidden = true; }
    frame.append(photoButton,previous,next,count);
    root.append(frame,caption,thumbs);
    refresh();
    return root;
  }

  function showQuote(block,ctx) {
    const wrap = $('blockquote','narrative-quote');
    wrap.append($('span','narrative-quote-mark','“'));
    const main = $('div','narrative-quote-text');
    ctx.appendMarkdownInline(main,block.text || 'Una frase da ricordare, un momento da custodire.');
    wrap.append(main);
    if (block.credit) wrap.append($('cite','narrative-quote-credit','— '+block.credit));
    return wrap;
  }
  const themeNames = {geologia:'Geologia',storia:'Storia',natura:'Natura',curiosita:'Lo sapevi?',nota:'Una nota'};
  const themeGlyphs = {geologia:'◈',storia:'⌛',natura:'✳',curiosita:'✦',nota:'✎'};
  function showInsight(block,ctx) {
    const theme = Object.hasOwn(themeNames,block.theme) ? block.theme : 'curiosita';
    const wrap = $('aside','narrative-insight theme-'+theme);
    const tag = $('div','narrative-insight-tag',themeGlyphs[theme]+'  '+themeNames[theme]);
    const title = $('h3','',block.title || 'Un dettaglio da scoprire');
    wrap.append(tag,title,ctx.renderMarkdown(block.text || 'Aggiungi qui una curiosità o un approfondimento sul luogo.'));
    return wrap;
  }

  const validPoint = values => {
    if (!Array.isArray(values) || values.length < 2 || values[0] == null || values[1] == null || values[0] === '' || values[1] === '') return null;
    const lat=Number(values[0]),lon=Number(values[1]),elevation=values[2] == null ? null : Number(values[2]);
    if (!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) return null;
    return Number.isFinite(elevation) ? [lat,lon,elevation] : [lat,lon];
  };
  function routeStats(segments) {
    let distance=0,ascent=0,points=0;
    for (const segment of segments) {
      for (let i=0;i<segment.length;i++) {
        points++;
        if (!i) continue;
        const a=segment[i-1],b=segment[i],rad=Math.PI/180;
        const deltaLat=(b[0]-a[0])*rad,deltaLon=(b[1]-a[1])*rad;
        const h=Math.sin(deltaLat/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(deltaLon/2)**2;
        distance+=12742*Math.asin(Math.min(1,Math.sqrt(h)));
        if (Number.isFinite(a[2])&&Number.isFinite(b[2])) ascent+=Math.max(0,b[2]-a[2]);
      }
    }
    return {distance,ascent,points};
  }
  function showRoute(block) {
    const root=$('div','narrative-route');
    const segments=Array.isArray(block.segments) ? block.segments : [];
    if (!segments.some(s=>Array.isArray(s)&&s.length>1))
      return $('div','narrative-empty','⌖  Carica una traccia GPX o GeoJSON per visualizzare il percorso');
    const map=$('div','narrative-route-map');
    map.dataset.routeBlock=block.id;
    map.setAttribute('aria-label','Mappa del percorso '+(block.title || ''));
    root.append(map);
    const stats=routeStats(segments);
    const info=$('div','narrative-route-summary');
    if (block.title) info.append($('strong','',block.title));
    info.append($('span','',stats.distance.toFixed(1).replace('.',',')+' km'));
    info.append($('span','',stats.points+' punti'));
    if (stats.ascent>0) info.append($('span','',Math.round(stats.ascent)+' m D+'));
    root.append(info);
    if (block.caption) root.append($('p','narrative-route-caption',block.caption));
    return root;
  }

  function showCompare(block,ctx) {
    const before=ctx.imageUrl(block.before),after=ctx.imageUrl(block.after);
    if (!before || !after) return $('div','narrative-empty','▧  Scegli due immagini per il confronto');
    const root=$('figure','narrative-compare');
    const stage=$('div','narrative-compare-frame');
    const old=image(before,block.beforeLabel||'Prima',ctx);
    old.className='narrative-compare-after';
    old.alt=block.beforeLabel||'Prima';
    const newer=image(after,block.afterLabel||'Dopo',ctx);
    newer.className='narrative-compare-before';
    newer.alt=block.afterLabel||'Dopo';
    const divider=$('div','narrative-compare-divider');
    const knob=$('span','', '↔');divider.append(knob);
    const labelBefore=$('span','narrative-compare-label label-before',block.beforeLabel || 'Prima');
    const labelAfter=$('span','narrative-compare-label label-after',block.afterLabel || 'Dopo');
    stage.append(old,newer,divider,labelBefore,labelAfter);
    const range=$('input','narrative-compare-slider');
    range.type='range';range.min='0';range.max='100';range.value='50';
    range.setAttribute('aria-label','Scorri per confrontare le due fotografie');
    const setPosition=()=>stage.style.setProperty('--compare-position',range.value+'%');
    range.addEventListener('input',setPosition);
    stage.append(range);
    root.append(stage);
    if (block.caption) root.append($('figcaption','narrative-route-caption',block.caption));
    setPosition();
    return root;
  }

  function showTimeline(block,ctx) {
    const root=$('div','narrative-timeline');
    const events=Array.isArray(block.events)?block.events.slice(0,20):[];
    if(!events.length)return $('div','narrative-empty','⌛  Aggiungi tappe alla tua linea del tempo');
    for(const event of events) {
      const row=$('div','narrative-timeline-event');
      const head=$('div','narrative-timeline-head');
      if(event.date)head.append($('time','narrative-timeline-date',event.date));
      head.append($('h3','',event.title||'Una tappa'));
      row.append(head);
      if(event.text) {
        const detail=$('div','narrative-timeline-detail');
        ctx.appendMarkdownInline(detail,event.text);
        row.append(detail);
      }
      root.append(row);
    }
    return root;
  }
  function showChapter(block,ctx) {
    const root=$('section','narrative-chapter');
    const url=ctx.imageUrl(block.src);
    if(url) {
      root.classList.add('has-image');
      root.append(image(url,block.title||'Apertura capitolo',ctx));
    }
    const overlay=$('div','narrative-chapter-overlay');
    if(block.kicker)overlay.append($('small','',block.kicker));
    overlay.append($('h2','',block.title||'Un nuovo capitolo'));
    if(block.subtitle)overlay.append($('p','',block.subtitle));
    root.append(overlay);
    return root;
  }
  const previews={gallery:showGallery,quote:showQuote,insight:showInsight,route:showRoute,compare:showCompare,timeline:showTimeline,chapter:showChapter};

  function render(block,preview,ctx) {
    const root=$('div','narrative-root narrative-'+block.type);
    const stage=$('div','narrative-stage');
    const refresh=()=>stage.replaceChildren(previews[block.type](block,ctx));
    const edit=$('div','narrative-edit');
    const field=(label,key,option={})=>edit.append(textField(label,block[key],value=>{
      block[key]=value;ctx.save();if(block.type!=='route')refresh();
    },option));
    const refreshAll=()=>ctx.renderAll();
    if(!preview) {
      switch(block.type) {
        case 'gallery': {
          edit.append(imageUpload(block,'gallery',ctx,true));
          const urlRow=$('div','narrative-url-row');
          const input=$('input');input.type='url';input.placeholder='Oppure incolla un URL immagine…';
          urlRow.append(input,button('Aggiungi URL',()=>{
            const valid=ctx.imageUrl(input.value);
            if(!valid)return ctx.notice('Inserisci un URL immagine valido.');
            block.photos=Array.isArray(block.photos)?block.photos:[];
            if(block.photos.length>=12)return ctx.notice('Massimo 12 fotografie per galleria.');
            block.photos.push({src:valid,caption:''});ctx.save();refreshAll();
          }));
          edit.append(urlRow);
          safeItems(block).forEach((item,i)=>{
            const card=$('div','narrative-photo-edit-row');
            card.append($('span','',String(i+1).padStart(2,'0')));
            const caption=textField('DIDASCALIA',item.caption||'',value=>{item.caption=value;ctx.save();refresh();},{placeholder:'Descrizione della foto…'});
            const controls=$('div','narrative-photo-edit-controls');
            controls.append(button('←',()=>{if(i>0){[block.photos[i-1],block.photos[i]]=[block.photos[i],block.photos[i-1]];ctx.save();refreshAll();}},'narrative-mini-button'));
            controls.append(button('→',()=>{if(i<block.photos.length-1){[block.photos[i+1],block.photos[i]]=[block.photos[i],block.photos[i+1]];ctx.save();refreshAll();}},'narrative-mini-button'));
            controls.append(button('×',()=>{block.photos.splice(i,1);ctx.save();refreshAll();},'narrative-mini-button'));
            card.append(caption,controls);edit.append(card);
          });
          break;
        }
        case 'quote': field('CITAZIONE','text',{multiline:true,rows:3,placeholder:'Una frase che resta…'});field('FONTE O FIRMA','credit',{placeholder:'Autore, luogo o data'});break;
        case 'insight':
          field('TIPO DI APPROFONDIMENTO','theme',{select:Object.entries(themeNames)});
          field('TITOLO','title',{placeholder:'Un dettaglio da scoprire'});
          const rich=ctx.makeRichText(block);
          rich.addEventListener('input',refresh);
          edit.append(rich);
          break;
        case 'route': {
          field('TITOLO DEL PERCORSO','title',{placeholder:'Il sentiero verso…'});
          const row=$('div','narrative-upload');
          const input=$('input');input.type='file';input.accept='.gpx,.geojson,.json,application/geo+json,application/gpx+xml';input.hidden=true;
          input.addEventListener('change',async()=>{
            if(!input.files?.[0])return;
            try{
              const segments=await parseRouteFile(input.files[0]);
              block.segments=segments;ctx.save();refreshAll();
              ctx.notice('Percorso importato: '+routeStats(segments).distance.toFixed(1)+' km.');
            }catch(err){ctx.notice('Traccia non valida: '+err.message);}
            input.value='';
          });
          row.append(button('⌖ Importa GPX / GeoJSON',()=>input.click()),input);
          edit.append(row);
          field('DIDASCALIA','caption',{multiline:true,rows:2});
          if(block.segments?.length)edit.append(button('Rimuovi tracciato',()=>{block.segments=[];ctx.save();refreshAll();},'narrative-danger'));
          break;
        }
        case 'compare':
          field('URL PRIMA','before',{type:'url',commit:true});
          edit.append(imageUpload(block,'before',ctx));
          field('URL DOPO','after',{type:'url',commit:true});
          edit.append(imageUpload(block,'after',ctx));
          field('ETICHETTA PRIMA','beforeLabel');
          field('ETICHETTA DOPO','afterLabel');
          field('DIDASCALIA','caption',{multiline:true,rows:2});
          break;
        case 'timeline':
          edit.append(button('＋ Aggiungi una tappa',()=>{
            block.events=Array.isArray(block.events)?block.events:[];
            block.events.push({date:'',title:'',text:''});ctx.save();refreshAll();
          }));
          (block.events||[]).forEach((event,i)=>{
            const card=$('div','narrative-event-edit');
            const top=$('div','narrative-event-controls');
            top.append($('strong','', 'Tappa '+(i+1)));
            top.append(button('↑',()=>{if(i){[block.events[i],block.events[i-1]]=[block.events[i-1],block.events[i]];ctx.save();refreshAll();}},'narrative-mini-button'));
            top.append(button('↓',()=>{if(i<block.events.length-1){[block.events[i],block.events[i+1]]=[block.events[i+1],block.events[i]];ctx.save();refreshAll();}},'narrative-mini-button'));
            top.append(button('×',()=>{block.events.splice(i,1);ctx.save();refreshAll();},'narrative-mini-button'));
            card.append(top);
            for(const [label,key,opts] of [['DATA / EPOCA','date',{}],['TITOLO','title',{}],['BREVE RACCONTO','text',{multiline:true,rows:2}]]) {
              card.append(textField(label,event[key],v=>{event[key]=v;ctx.save();refresh();},opts));
            }
            edit.append(card);
          });
          break;
        case 'chapter':
          field('SOPRATITOLO','kicker',{placeholder:'CAPITOLO 01'});
          field('TITOLO','title',{placeholder:'Dentro la valle'});
          field('SOTTOTITOLO','subtitle',{multiline:true,rows:2});
          field('URL FOTO PANORAMICA','src',{type:'url',commit:true});
          edit.append(imageUpload(block,'chapter',ctx));
          break;
      }
      root.append(edit);
    }
    root.append(stage);
    refresh();
    return root;
  }

  function parseRouteFile(file) {
    if(file.size>3*1024*1024)throw Error('file troppo grande (massimo 3 MB)');
    return file.text().then(text=>{
      let segments=[];
      if(/\.gpx$/i.test(file.name)){
        const xml=new DOMParser().parseFromString(text,'application/xml');
        if(xml.querySelector('parsererror'))throw Error('GPX malformato');
        const tracks=[...xml.getElementsByTagNameNS('*','trkseg')];
        const collections=tracks.length?tracks:[...xml.getElementsByTagNameNS('*','rte')];
        for(const item of collections){
          const points=[...item.getElementsByTagNameNS('*',tracks.length?'trkpt':'rtept')].map(node=>{
            const ele=node.getElementsByTagNameNS('*','ele')[0]?.textContent;
            return validPoint([node.getAttribute('lat'),node.getAttribute('lon'),ele||null]);
          }).filter(Boolean);
          if(points.length>1)segments.push(points);
        }
      }else{
        let data;try{data=JSON.parse(text)}catch{throw Error('JSON non valido')}
        const scan=(geo,depth=0)=>{
          if(!geo||depth>6)return;
          if(geo.type==='FeatureCollection'){(geo.features||[]).slice(0,60).forEach(g=>scan(g,depth+1));return}
          if(geo.type==='Feature'){scan(geo.geometry,depth+1);return}
          if(geo.type==='GeometryCollection'){(geo.geometries||[]).slice(0,60).forEach(g=>scan(g,depth+1));return}
          const add=line=>{
            if(!Array.isArray(line))return;
            const coordinates=line.map(p=>validPoint([p?.[1],p?.[0],p?.[2]])).filter(Boolean);
            if(coordinates.length>1)segments.push(coordinates);
          };
          if(geo.type==='LineString')add(geo.coordinates);
          if(geo.type==='MultiLineString')for(const line of (geo.coordinates||[]))add(line);
        };
        scan(data);
      }
      if(!segments.length)throw Error('nessuna traccia lineare trovata');
      // Bound JSONB size and map performance; maintain both endpoints.
      let count=segments.reduce((sum,line)=>sum+line.length,0);
      if(count>4500){
        const stride=Math.ceil(count/4500);
        segments=segments.map(line=>line.filter((_,i)=>i%stride===0||i===line.length-1)).filter(line=>line.length>1);
      }
      return segments;
    });
  }

  function initializeRoutes(container,blocks,maps,config) {
    if(!window.L)return;
    const lookup=new Map(blocks.filter(b=>b.type==='route').map(b=>[String(b.id),b]));
    container.querySelectorAll('[data-route-block]').forEach(el=>{
      const block=lookup.get(el.dataset.routeBlock);
      if(!block)return;
      const segments=(block.segments||[]).filter(s=>Array.isArray(s)&&s.length>1);
      if(!segments.length)return;
      const map=L.map(el,{zoomControl:true,scrollWheelZoom:false,attributionControl:true});
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution:'&copy; OpenStreetMap contributors',maxZoom:19
      }).addTo(map);
      const valid=segments.map(line=>line.map(validPoint).filter(Boolean).map(p=>[p[0],p[1]])).filter(line=>line.length>1);
      if(!valid.length){map.remove();return}
      L.polyline(valid,{color:'#fffef6',weight:8,opacity:.93}).addTo(map);
      const route=L.polyline(valid,{color:'#c67855',weight:4,opacity:1}).addTo(map);
      const first=valid[0][0],last=valid[valid.length-1].at(-1);
      L.circleMarker(first,{radius:7,color:'#fff',weight:2,fillColor:'#43765c',fillOpacity:1}).bindTooltip('Partenza').addTo(map);
      L.circleMarker(last,{radius:7,color:'#fff',weight:2,fillColor:'#b76e52',fillOpacity:1}).bindTooltip('Arrivo').addTo(map);
      map.fitBounds(route.getBounds(),{padding:[27,27],maxZoom:15});
      maps.push(map);
      requestAnimationFrame(()=>map.invalidateSize());
    });
  }

  window.AtlasNarrative={render,initializeRoutes,parseRouteFile};
})();
