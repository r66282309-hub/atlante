/* Accesso all'Atlante: il browser usa esclusivamente la chiave pubblicabile.
   Le autorizzazioni di scrittura sono verificate dalle policy RLS su Supabase. */
(() => {
  'use strict';

  const auth = {
    client: null,
    user: null,
    editor: false,
    ready: null,
    open: () => dialog?.showModal(),
    refresh: () => syncSession(),
  };
  window.atlasAuth = auth;

  let dialog;
  let openButton;
  let resolveReady;
  auth.ready = new Promise(resolve => { resolveReady = resolve; });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function buildUI() {
    const nav = document.querySelector('.atlas-nav, .story-top-nav');
    openButton = element('button', 'atlas-auth-entry', 'Accedi');
    openButton.type = 'button';
    openButton.addEventListener('click', () => dialog.showModal());
    nav?.append(openButton);

    dialog = element('dialog', 'atlas-auth-dialog');
    dialog.setAttribute('aria-labelledby', 'atlasAuthHeading');
    dialog.innerHTML = `
      <button class="atlas-auth-close" type="button" aria-label="Chiudi">×</button>
      <div class="atlas-auth-spark" aria-hidden="true">✳</div>
      <span class="atlas-auth-kicker">ATLANTE / AREA RISERVATA</span>
      <h2 id="atlasAuthHeading">Il tuo spazio<br><em>nell'Atlante.</em></h2>
      <p id="atlasAuthMessage" class="atlas-auth-message" role="status" aria-live="polite">Accedi per gestire i tuoi waypoint e le geostorie.</p>
      <form id="atlasAuthForm" class="atlas-auth-form">
        <label for="atlasAuthEmail">Email</label>
        <input id="atlasAuthEmail" name="email" type="email" autocomplete="email" required placeholder="nome@esempio.it">
        <label for="atlasAuthPassword">Password</label>
        <input id="atlasAuthPassword" name="password" type="password" autocomplete="current-password" minlength="6" required placeholder="La tua password">
        <button id="atlasAuthSubmit" class="atlas-auth-primary" type="submit">Accedi</button>
        <div class="atlas-auth-secondary">
          <button id="atlasAuthSignup" type="button">Crea account</button>
          <button id="atlasAuthReset" type="button">Password dimenticata?</button>
        </div>
      </form>
      <div id="atlasAuthConnected" class="atlas-auth-connected" hidden>
        <strong id="atlasAuthUser"></strong>
        <span id="atlasAuthRole"></span>
        <button id="atlasAuthRefresh" class="atlas-auth-primary" type="button">Ricontrolla autorizzazione</button>
        <button id="atlasAuthSignout" class="atlas-auth-logout" type="button">Esci dall'account</button>
      </div>
      <p class="atlas-auth-footnote">Solo l'account approvato può modificare il database. La mappa pubblica resta consultabile da tutti.</p>
    `;
    document.body.append(dialog);
    dialog.querySelector('.atlas-auth-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelector('#atlasAuthForm').addEventListener('submit', event => { event.preventDefault(); void submitLogin(); });
    dialog.querySelector('#atlasAuthSignup').addEventListener('click', () => void signUp());
    dialog.querySelector('#atlasAuthReset').addEventListener('click', () => void resetPassword());
    dialog.querySelector('#atlasAuthSignout').addEventListener('click', () => void signOut());
    dialog.querySelector('#atlasAuthRefresh').addEventListener('click', () => void syncSession());
    renderUI();
  }

  function status(message, error = false) {
    const node = dialog?.querySelector('#atlasAuthMessage');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', error);
  }

  function setBusy(busy) {
    dialog?.querySelectorAll('button').forEach(button => {
      if (!button.classList.contains('atlas-auth-close')) button.disabled = busy;
    });
  }

  function credentials() {
    const email = dialog.querySelector('#atlasAuthEmail').value.trim();
    const password = dialog.querySelector('#atlasAuthPassword').value;
    if (!email || !password) {
      status('Inserisci email e password per continuare.', true);
      return null;
    }
    return { email, password };
  }

  function renderUI() {
    if (!dialog) return;
    const connected = Boolean(auth.user);
    dialog.querySelector('#atlasAuthForm').hidden = connected;
    dialog.querySelector('#atlasAuthConnected').hidden = !connected;
    if (connected) {
      dialog.querySelector('#atlasAuthUser').textContent = auth.user.email || 'Account autenticato';
      dialog.querySelector('#atlasAuthRole').textContent = auth.editor
        ? '✓ Editor autorizzato: puoi modificare i contenuti.'
        : 'Account autenticato, ma non ancora abilitato alle modifiche.';
      status(auth.editor ? 'Bentornato nell’Atlante.' : 'Per sicurezza, l’abilitazione viene assegnata manualmente.');
    } else {
      status(auth.client ? 'Accedi o crea un account da abilitare come editor.' : 'Connessione Supabase non disponibile.', !auth.client);
    }
    if (openButton) {
      openButton.textContent = auth.editor ? 'Area editor ✓' : connected ? 'Account' : 'Accedi';
      openButton.classList.toggle('is-editor', auth.editor);
    }
  }

  async function syncSession() {
    if (!auth.client) return;
    try {
      const { data: { session }, error: sessionError } = await auth.client.auth.getSession();
      if (sessionError) throw sessionError;
      let user = null;
      if (session) {
        const result = await auth.client.auth.getUser();
        if (result.error) throw result.error;
        user = result.data.user;
      }
      auth.user = user;
      auth.editor = false;
      if (user) {
        const { data, error: accessError } = await auth.client.from('atlas_editors')
          .select('user_id').eq('user_id', user.id).maybeSingle();
        if (accessError) throw accessError;
        auth.editor = Boolean(data);
      }
      renderUI();
      window.dispatchEvent(new CustomEvent('atlas-auth-changed', { detail: { user: auth.user, editor: auth.editor } }));
    } catch (error) {
      console.error('Accesso Atlante:', error);
      status('Verifica accesso non riuscita. Riprova.', true);
    }
  }

  async function submitLogin() {
    const input = credentials();
    if (!input || !auth.client) return;
    setBusy(true);
    try {
      const { error } = await auth.client.auth.signInWithPassword(input);
      if (error) throw error;
      await syncSession();
    } catch (error) {
      status(error.message || 'Accesso non riuscito.', true);
    } finally { setBusy(false); }
  }

  async function signUp() {
    const input = credentials();
    if (!input || !auth.client) return;
    setBusy(true);
    try {
      const { data, error } = await auth.client.auth.signUp(input);
      if (error) throw error;
      if (data.session) await syncSession();
      else status('Controlla la tua email per confermare l’account. Poi accedi e richiedi l’abilitazione.');
    } catch (error) {
      status(error.message || 'Registrazione non riuscita.', true);
    } finally { setBusy(false); }
  }

  async function resetPassword() {
    const email = dialog.querySelector('#atlasAuthEmail').value.trim();
    if (!email) { status('Inserisci prima il tuo indirizzo email.', true); return; }
    if (!auth.client) return;
    setBusy(true);
    try {
      const { error } = await auth.client.auth.resetPasswordForEmail(email);
      if (error) throw error;
      status('Se l’account esiste, riceverai un’email per reimpostare la password.');
    } catch (error) {
      status(error.message || 'Non riesco a inviare l’email.', true);
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (!auth.client) return;
    setBusy(true);
    try {
      const { error } = await auth.client.auth.signOut();
      if (error) throw error;
      auth.user = null;
      auth.editor = false;
      renderUI();
      window.dispatchEvent(new CustomEvent('atlas-auth-changed', { detail: { user: null, editor: false } }));
    } catch (error) { status(error.message || 'Non riesco a uscire.', true); }
    finally { setBusy(false); }
  }

  async function initialize() {
    buildUI();
    const cfg = window.ATLAS_CONFIG?.supabase;
    try {
      if (!cfg?.url || !cfg?.anonKey) throw new Error('Configurazione Supabase assente');
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm');
      auth.client = createClient(cfg.url, cfg.anonKey);
      auth.client.auth.onAuthStateChange(() => { setTimeout(() => void syncSession(), 0); });
      await syncSession();
    } catch (error) {
      console.error('Supabase Auth:', error);
      renderUI();
    } finally { resolveReady(auth); }
  }
  void initialize();
})();
