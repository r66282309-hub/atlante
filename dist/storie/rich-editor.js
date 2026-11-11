(() => {
  'use strict';

  // Visual editor for the existing Markdown strings; no HTML is stored.
  const fonts = [['', 'Carattere…'], ['DM Sans','Moderno'],
    ['DM Serif Display','Editoriale'], ['Cormorant Garamond','Corsivo elegante']];
  const colors = [['Bosco','#315D47'],['Terracotta','#A5664F'],
    ['Ardesia','#526F84'],['Ocra','#A0783A'],['Grafite','#3C4A43']];

  function hexColor(value) {
    const raw = String(value || '').trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
    if (hex) return '#' + (hex[1].length === 3
      ? hex[1].split('').map(c => c + c).join('') : hex[1]).toUpperCase();
    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,[^)]*)?\)$/.exec(raw);
    if (!rgb || rgb.slice(1,4).some(n => Number(n) > 255)) return '';
    return '#' + rgb.slice(1,4).map(n => Number(n).toString(16).padStart(2,'0')).join('').toUpperCase();
  }

  function decorate(node, content) {
    const tag = node.tagName?.toLowerCase();
    const style = node.style || {};
    const family = String(node.getAttribute?.('face') || style.fontFamily || '').toLowerCase();
    let font = node.classList?.contains('atlas-script') ? 'script'
      : node.classList?.contains('atlas-serif') ? 'serif'
      : node.classList?.contains('atlas-sans') ? 'sans' : '';
    if (!font) font = family.includes('cormorant') ? 'script'
      : family.includes('dm serif') ? 'serif' : family.includes('dm sans') ? 'sans' : '';
    const color = hexColor(node.getAttribute?.('color') || style.color);
    let output = content;
    if (!output) return '';
    if (tag === 'strong' || tag === 'b' || style.fontWeight === 'bold' || Number(style.fontWeight) >= 600)
      output = '**' + output + '**';
    if (tag === 'em' || tag === 'i' || style.fontStyle === 'italic')
      output = '*' + output + '*';
    if (tag === 'del' || tag === 's' || tag === 'strike' || style.textDecoration?.includes('line-through'))
      output = '~~' + output + '~~';
    if (font) output = '<span class="atlas-' + font + '">' + output + '</span>';
    if (color) output = '<span style="color:' + color + '">' + output + '</span>';
    return output;
  }

  function inline(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (['script','style','img'].includes(tag)) return '';
    const content = [...node.childNodes].map(inline).join('');
    if (tag === 'code') return String.fromCharCode(96) + content + String.fromCharCode(96);
    if (tag === 'a') {
      try {
        const url = new URL(node.getAttribute('href') || '');
        if (['http:', 'https:'].includes(url.protocol))
          return '[' + content + '](' + url.href + ')';
      } catch { /* Invalid links become plain text. */ }
      return content;
    }
    return decorate(node,content);
  }

  function block(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return inline(node);
    const tag = node.tagName.toLowerCase();
    const children = () => [...node.childNodes].map(inline).join('');
    if (/^h[2-4]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + decorate(node,children());
    if (tag === 'hr') return '---';
    if (tag === 'pre') {
      const fence = String.fromCharCode(96).repeat(3);
      return fence + '\n' + (node.textContent || '') + '\n' + fence;
    }
    if (tag === 'ul' || tag === 'ol') {
      return [...node.children].filter(li => li.tagName.toLowerCase() === 'li')
        .map((li,i) => (tag === 'ul' ? '- ' : i + 1 + '. ')
          + decorate(li,[...li.childNodes].map(inline).join(''))).join('\n');
    }
    if (tag === 'blockquote') return children().split('\n').map(line => '> ' + line).join('\n');
    return decorate(node,children());
  }

  function toMarkdown(surface, heading) {
    if (heading) return [...surface.childNodes].map(inline).join('').replace(/\n/g,' ');
    const parts = [], buffered = [];
    const flush = () => { if (buffered.length) parts.push(buffered.splice(0).map(inline).join('')); };
    for (const node of surface.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && /^(p|div|h[1-6]|ul|ol|blockquote|pre|hr)$/.test(node.tagName.toLowerCase())) {
        flush(); parts.push(block(node));
      } else buffered.push(node);
    }
    flush();
    return parts.join('\n\n');
  }

  function mount({block, heading = false, renderMarkdown, appendMarkdownInline, queueSave}) {
    const shell = document.createElement('div');
    shell.className = 'rich-editor-shell';
    const head = document.createElement('div');
    head.className = 'rich-editor-head';
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = heading ? 'TITOLO · TESTO FORMATTATO' : 'TESTO · ANTEPRIMA IN TEMPO REALE';

    const toolbar = document.createElement('div');
    toolbar.className = 'markdown-format-toolbar rich-format-toolbar';
    toolbar.setAttribute('role','toolbar');
    toolbar.setAttribute('aria-label','Formattazione del testo selezionato');
    const surface = document.createElement('div');
    surface.className = heading ? 'rich-markdown-surface rich-heading-surface'
      : 'rich-markdown-surface preview-markdown';
    surface.contentEditable = 'true';
    surface.spellcheck = true;
    surface.setAttribute('role','textbox');
    surface.setAttribute('aria-multiline',String(!heading));
    surface.setAttribute('aria-label',heading ? 'Titolo della sezione' : 'Racconto formattato');
    surface.dataset.placeholder = heading ? 'Titolo della sezione…' : 'Scrivi qui il racconto…';

    const paint = () => {
      if (!block.text) { surface.replaceChildren(); return; }
      if (heading) {
        surface.replaceChildren();
        appendMarkdownInline(surface,block.text);
      } else {
        const dom = renderMarkdown(block.text);
        surface.replaceChildren(...dom.childNodes);
      }
    };
    paint();

    const sourcePanel = document.createElement('div');
    sourcePanel.className = 'rich-source-panel';
    sourcePanel.hidden = true;
    const source = document.createElement('textarea');
    source.className = 'block-textarea rich-source-textarea';
    source.rows = heading ? 2 : 10;
    source.setAttribute('aria-label','Sorgente Markdown');
    const live = document.createElement('div');
    live.className = 'rich-source-preview preview-markdown';
    const previewLabel = document.createElement('small');
    previewLabel.className = 'rich-source-caption';
    previewLabel.textContent = 'ANTEPRIMA IN TEMPO REALE';
    const preview = document.createElement('div');
    const repaintPreview = () => {
      preview.replaceChildren();
      if (heading) appendMarkdownInline(preview,source.value);
      else preview.replaceChildren(...renderMarkdown(source.value).childNodes);
    };
    live.append(previewLabel,preview);
    sourcePanel.append(source,live);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'rich-source-toggle';
    toggle.textContent = '</> Markdown';
    toggle.title = 'Mostra o nascondi i caratteri Markdown';
    toggle.setAttribute('aria-pressed','false');
    head.append(label,toggle);

    let sourceMode = false;
    let selectedRange = null;
    let restoringSelection = false;
    const captureSelection = () => {
      // Keep the last selection made INSIDE the editor. Opening a font menu
      // moves focus away; a subsequent focus event must not overwrite it.
      if (restoringSelection) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (surface.contains(range.commonAncestorContainer))
        selectedRange = range.cloneRange();
    };
    ['keyup','mouseup','pointerup','touchend','input'].forEach(event =>
      surface.addEventListener(event,captureSelection));
    // Snapshot before a dropdown or color button steals focus. This also
    // works for a selection spanning several paragraphs.
    toolbar.addEventListener('pointerdown',captureSelection,true);
    const changed = () => { block.text = toMarkdown(surface,heading); queueSave(); };
    surface.addEventListener('input',changed);
    surface.addEventListener('paste',event => {
      event.preventDefault();
      const pasted = event.clipboardData?.getData('text/plain') || '';
      if (!pasted) return;
      if (!heading && (pasted.includes('**') || pasted.includes('__') || pasted.includes('<span '))) {
        const rendered = renderMarkdown(pasted);
        if (!surface.textContent.trim()) {
          surface.replaceChildren(...rendered.childNodes);
          const range = document.createRange();
          range.selectNodeContents(surface);
          range.collapse(false);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          changed();
        } else document.execCommand('insertHTML',false,rendered.innerHTML);
      } else document.execCommand('insertText',false,pasted);
    });
    surface.addEventListener('drop',event => event.preventDefault());
    if (heading) surface.addEventListener('keydown',event => {
      if (event.key === 'Enter') event.preventDefault();
    });
    source.addEventListener('input',() => {
      block.text = source.value;
      repaintPreview();
      queueSave();
    });
    const restoreSelection = () => {
      // Focus itself can collapse the browser selection; restore the saved
      // clone only AFTER focusing, with selection capture suspended.
      const range = selectedRange?.cloneRange();
      if (!range || !surface.contains(range.commonAncestorContainer)) return false;
      restoringSelection = true;
      try {
        surface.focus({preventScroll:true});
        const selection = window.getSelection();
        if (!selection) return false;
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      } catch (error) {
        console.warn('Selezione testo non ripristinabile:',error);
        return false;
      } finally { restoringSelection = false; }
    };
    const execute = (command,value) => {
      if (sourceMode || !restoreSelection()) return;
      // In Chrome/Firefox these commands create CSS spans that can be
      // faithfully saved back as the existing safe Markdown font/color tags.
      if (command === 'fontName' || command === 'foreColor')
        document.execCommand('styleWithCSS',false,true);
      const success = document.execCommand(command,false,value ?? null);
      if (!success) {
        console.warn('Formattazione non applicata:',command);
        return;
      }
      captureSelection();
      changed();
    };

    const basic = document.createElement('div');
    basic.className = 'markdown-toolbar-group';
    for (const [glyph,title,command,cls] of [
      ['B','Grassetto','bold','markdown-bold'],
      ['I','Corsivo','italic','markdown-italic'],
      ['S','Barrato','strikeThrough','markdown-strike'],
      ['⌁','Inserisci collegamento','link','markdown-link']
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = glyph; btn.title = title;
      btn.setAttribute('aria-label',title); btn.className = cls;
      btn.addEventListener('mousedown',event => event.preventDefault());
      btn.addEventListener('click',() => {
        if (command !== 'link') { execute(command); return; }
        const input = prompt('Indirizzo del collegamento (https://...)','https://');
        if (!input) return;
        try {
          const url = new URL(input);
          if (!['http:','https:'].includes(url.protocol)) throw Error('URL non valido');
          execute('createLink',url.href);
        } catch { alert('Il collegamento deve iniziare con http:// o https://'); }
      });
      basic.append(btn);
    }
    toolbar.append(basic);

    const fontPicker = document.createElement('select');
    fontPicker.className = 'markdown-font-select';
    fontPicker.setAttribute('aria-label','Carattere del testo selezionato');
    for (const [id,name] of fonts) {
      const option = document.createElement('option');
      option.value = id; option.textContent = name;
      fontPicker.append(option);
    }
    fontPicker.addEventListener('change',() => {
      if (fontPicker.value) execute('fontName',fontPicker.value);
      fontPicker.value = '';
    });
    toolbar.append(fontPicker);

    const palette = document.createElement('div');
    palette.className = 'markdown-toolbar-group markdown-color-group';
    for (const [name,color] of colors) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'markdown-color-swatch';
      btn.style.setProperty('--swatch',color);
      btn.setAttribute('aria-label','Colore ' + name); btn.title = 'Colore ' + name;
      btn.addEventListener('mousedown',event => event.preventDefault());
      btn.addEventListener('click',() => execute('foreColor',color));
      palette.append(btn);
    }
    toolbar.append(palette);

    toggle.addEventListener('click',() => {
      sourceMode = !sourceMode;
      if (sourceMode) {
        block.text = toMarkdown(surface,heading);
        source.value = block.text;
        repaintPreview();
      } else {
        block.text = source.value;
        paint();
      }
      surface.hidden = sourceMode;
      toolbar.hidden = sourceMode;
      sourcePanel.hidden = !sourceMode;
      toggle.setAttribute('aria-pressed',String(sourceMode));
      toggle.textContent = sourceMode ? '✓ Testo formattato' : '</> Markdown';
      selectedRange = null;
      (sourceMode ? source : surface).focus({preventScroll:true});
    });

    shell.append(head,toolbar,surface,sourcePanel);
    return shell;
  }
  window.AtlasRichEditor = { mount };
})();
