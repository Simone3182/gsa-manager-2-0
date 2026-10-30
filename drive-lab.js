/* GSA Manager 2.0 LAB — FASE 2: backup cifrati, trasferimento manuale e controllato.
 * NESSUNA lettura dell'archivio locale. NESSUNA importazione automatica.
 * Solo backup già cifrati in formato gsa-manager-encrypted-v1.
 */
(() => {
  'use strict';
  const CLIENT_ID = '747946909464-8p17rmoft41mdeqgio443uhmauuo9kgj.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const PREFIX = 'GSA-2.0-LAB-backup-';
  const MAX_BYTES = 20 * 1024 * 1024; // Limite prudenziale per questo primo test.
  const $ = id => document.getElementById(id);
  const status = $('drive-lab-status');
  const connect = $('drive-lab-connect');
  const disconnect = $('drive-lab-disconnect');
  const transfer = $('drive-lab-transfer');
  const fileInput = $('drive-lab-file');
  const upload = $('drive-lab-upload');
  const refresh = $('drive-lab-list');
  const filesEl = $('drive-lab-files');
  let tokenClient = null;
  let accessToken = null;
  let busy = false;
  const isVaultUnlocked = () => {
    const overlay = $('privacy-lock');
    return overlay && getComputedStyle(overlay).display === 'none';
  };
  const setStatus = msg => { status.textContent = msg; };
  const setControls = () => {
    const connected = !!accessToken;
    connect.disabled = connected || busy;
    disconnect.disabled = !connected || busy;
    transfer.hidden = !connected;
    upload.disabled = !connected || busy;
    refresh.disabled = !connected || busy;
    fileInput.disabled = !connected || busy;
  };
  function disconnectNow() {
    const oldToken = accessToken;
    accessToken = null;
    if (oldToken && window.google?.accounts?.oauth2?.revoke) {
      try { google.accounts.oauth2.revoke(oldToken, () => {}); } catch (_) { /* best effort */ }
    }
    fileInput.value = '';
    filesEl.replaceChildren();
    setControls();
  }
  function assertReady() {
    if (!accessToken) throw Error('Collega prima Google Drive.');
    if (!isVaultUnlocked()) { disconnectNow(); throw Error('Archivio LAB bloccato. Ricollega Google Drive.'); }
  }
  async function api(url, options={}) {
    assertReady();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', 'Bearer ' + accessToken);
    const res = await fetch(url, { ...options, headers, cache: 'no-store' });
    if (!res.ok) {
      if (res.status === 401) { disconnectNow(); throw Error('Accesso Google scaduto. Ricollega Google Drive.'); }
      throw Error('Google Drive API: HTTP ' + res.status);
    }
    return res;
  }
  function initGoogle() {
    if (!window.google?.accounts?.oauth2) { setStatus('Google Identity Services non disponibile. Controlla la connessione.'); return false; }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: async response => {
          if (response.error || !response.access_token) { setStatus('Autorizzazione non riuscita: ' + (response.error || 'nessun token')); return; }
          accessToken = response.access_token;
          setControls();
          try {
            const res = await api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
            const data = await res.json();
            setStatus('Collegamento riuscito con ' + (data.user?.emailAddress || 'account Google') + '. Nessun backup caricato automaticamente.');
          } catch (err) { disconnectNow(); setStatus('Verifica accesso non riuscita: ' + err.message); }
        },
        error_callback: err => setStatus('Autorizzazione non completata: ' + (err?.type || 'finestra chiusa'))
      });
    }
    return true;
  }
  async function runJob(fn) {
    if (busy) return;
    busy = true; setControls();
    try { await fn(); } catch (err) { setStatus('Operazione non riuscita: ' + err.message); }
    finally { busy = false; setControls(); }
  }
  async function parseEncryptedFile(file) {
    if (!file) throw Error('Seleziona prima un file JSON cifrato.');
    if (file.size > MAX_BYTES) throw Error('File oltre 20 MB: questa prima prova non gestisce backup grandi.');
    const content = await file.text();
    let data;
    try { data = JSON.parse(content); } catch (_) { throw Error('Il file non è un JSON valido.'); }
    if (!data || data.format !== 'gsa-manager-encrypted-v1' || data.algorithm !== 'AES-256-GCM' ||
        data.kdf !== 'PBKDF2-SHA256' || data.iterations !== 310000 ||
        !['salt','iv','cipher'].every(k => typeof data[k] === 'string' && data[k].length > 0)) {
      throw Error('Non è un backup cifrato GSA riconosciuto. Non verrà caricato.');
    }
    // La validazione completa del contenuto richiede la password e si fa nella pagina Backup del LAB.
    return content;
  }
  function safeFilename(name) { return typeof name === 'string' && /^GSA-2\.0-LAB-backup-[0-9TZ-]+\.json$/.test(name); }
  function downloadText(content, filename) {
    const blob = new Blob([content], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function listFiles() {
    const query = "trashed = false and name contains '" + PREFIX + "'";
    const params = new URLSearchParams({q:query,fields:'nextPageToken,files(id,name,size,createdTime)',page_size:'100',orderBy:'createdTime desc'});
    const res = await api('https://www.googleapis.com/drive/v3/files?' + params);
    const data = await res.json();
    filesEl.replaceChildren();
    const matching = (data.files || []).filter(f => safeFilename(f.name));
    if (!matching.length) { filesEl.textContent = 'Nessun backup LAB creato da questa app su Google Drive.'; return; }
    const heading = document.createElement('div');
    heading.textContent = 'Backup cifrati creati da questa app:';
    heading.style.fontWeight = '700'; filesEl.append(heading);
    for (const f of matching) {
      const row = document.createElement('div'); row.style.marginTop = '8px';
      const label = document.createElement('span');
      label.textContent = f.name + ' (' + Math.round(Number(f.size || 0)/1024) + ' KB) ';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = 'Scarica copia';
      btn.addEventListener('click', () => runJob(async () => {
        if (!confirm('Scaricare il backup cifrato ' + f.name + '? Non verrà importato nell’archivio.')) return;
        const res = await api('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(f.id) + '?alt=media');
        const content = await res.text();
        // Verifica preliminare che il contenuto remoto sia un backup cifrato.
        const check = JSON.parse(content);
        if (check?.format !== 'gsa-manager-encrypted-v1') throw Error('Il file remoto non è un backup cifrato riconosciuto.');
        downloadText(content, f.name);
        setStatus('Download avviato. Prima di importare, usa «Controlla backup» nella sezione Backup del LAB.');
      }));
      row.append(label, btn); filesEl.append(row);
    }
    if (data.nextPageToken) {
      const note=document.createElement('div'); note.textContent='Sono mostrati solo i primi 100 backup. Non creare archivi di prova inutili.'; filesEl.append(note);
    }
  }
  connect.addEventListener('click', () => {
    if (!isVaultUnlocked()) { setStatus('Sblocca prima l’archivio LAB.'); return; }
    if (initGoogle()) { setStatus('Attendo autorizzazione Google…'); tokenClient.requestAccessToken({prompt:'consent'}); }
  });
  disconnect.addEventListener('click', () => { disconnectNow(); setStatus('Disconnesso. Nessun dato modificato.'); });
  upload.addEventListener('click', () => runJob(async () => {
    assertReady();
    const content = await parseEncryptedFile(fileInput.files?.[0]);
    if (!confirm('ATTENZIONE — LAB\nCaricare una NUOVA copia di questo backup cifrato su Il mio Drive?\nNon verrà sincronizzato o importato automaticamente.\nNon usare dati reali.')) return;
    const name = PREFIX + new Date().toISOString().replace(/[:.]/g,'-') + '.json';
    const boundary = 'gsa_lab_' + crypto.randomUUID().replaceAll('-','');
    const metadata = JSON.stringify({name, mimeType:'application/json'});
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n' +
      '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + content + '\r\n--' + boundary + '--';
    const res = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size', {
      method:'POST', headers:{'Content-Type':'multipart/related; boundary=' + boundary}, body
    });
    const created = await res.json();
    setStatus('Backup cifrato caricato su Drive come ' + created.name + '. Verifica scaricandone una copia.');
    fileInput.value = '';
    await listFiles();
  }));
  refresh.addEventListener('click', () => runJob(async () => { await listFiles(); setStatus('Elenco Drive aggiornato.'); }));
  const overlay = $('privacy-lock');
  if (overlay) new MutationObserver(() => {
    if (getComputedStyle(overlay).display !== 'none' && accessToken) {
      disconnectNow(); setStatus('Archivio LAB bloccato: collegamento Drive interrotto.');
    }
  }).observe(overlay,{attributes:true,attributeFilter:['style']});
  setControls();
})();
