/* GSA Manager 2.0 LAB — FASE 2: backup cifrati, trasferimento manuale e controllato.
 * FASE 2A: confronto in sola lettura. FASE 2B: sincronizzazione manuale
 * protetta con baseline e blocco dei conflitti. Solo dati fittizi LAB.
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
  const compareButton = $('drive-lab-compare');
  const compareResult = $('drive-lab-compare-result');
  const filesEl = $('drive-lab-files');
  const syncInit = $('drive-lab-sync-init');
  const syncPull = $('drive-lab-sync-pull');
  const syncPush = $('drive-lab-sync-push');
  const syncResult = $('drive-lab-sync-result');
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
    compareButton.disabled = !connected || busy;
    fileInput.disabled = !connected || busy;
    for (const el of [syncInit,syncPull,syncPush]) el.disabled = !connected || busy;
  };
  function disconnectNow() {
    const oldToken = accessToken;
    accessToken = null;
    if (oldToken && window.google?.accounts?.oauth2?.revoke) {
      try { google.accounts.oauth2.revoke(oldToken, () => {}); } catch (_) { /* best effort */ }
    }
    fileInput.value = '';
    filesEl.replaceChildren();
    compareResult.textContent = '';
    syncResult.textContent = '';
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
  // FASE 2A: confronto in sola lettura. Non chiama alcuna API Drive di scrittura,
  // né importAtomic, put, metaSet o altri metodi di modifica dell'archivio.
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = stableValue(value[k]);
      return sorted;
    }
    return value;
  }
  function compareRecords(local, remote) {
    const result = {same:0, different:0, onlyLocal:0, onlyDrive:0};
    for (const name of ['condomini','visite','classificazioni']) {
      const l = new Map(local[name].map(r => [r.id, r]));
      const d = new Map(remote[name].map(r => [r.id, r]));
      for (const [id, record] of l) {
        if (!d.has(id)) result.onlyLocal++;
        else if (JSON.stringify(stableValue(record)) === JSON.stringify(stableValue(d.get(id)))) result.same++;
        else result.different++;
      }
      for (const id of d.keys()) if (!l.has(id)) result.onlyDrive++;
    }
    return result;
  }
  // FASE 2B — protocollo di hand-off, un solo PC alla volta.
  // Le snapshot sono immutabili (nuovo file per ogni pubblicazione).
  // L'ID del backup cloud + checksum costituisce il riferimento di base.
  // NON si sincronizzano eliminazioni, NON si risolvono conflitti con "ultimo vince".
  const BASE_KEY = 'labManualSyncBaseV1';
  const names = ['condomini','visite','classificazioni'];
  const idMap = data => Object.fromEntries(names.map(n => [n, data[n].map(x => x.id).sort()]));
  const hasAllIds = (data, baseIds) => names.every(n => {
    const ids = new Set(data[n].map(x => x.id));
    return (baseIds[n] || []).every(id => ids.has(id));
  });
  async function fingerprint(data) {
    const canonical = {};
    for (const n of names) canonical[n] = data[n].slice().sort((a,b) => a.id.localeCompare(b.id)).map(stableValue);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
  }
  async function getLatest() {
    const params = new URLSearchParams({
      q: "trashed = false and name contains '" + PREFIX + "'",
      fields: 'nextPageToken,files(id,name,size,createdTime,md5Checksum)',
      page_size:'100', orderBy:'createdTime desc'
    });
    const res = await api('https://www.googleapis.com/drive/v3/files?' + params);
    const data = await res.json();
    if (data.nextPageToken) throw Error('Oltre 100 backup: selezione automatica bloccata.');
    const candidates = (data.files || []).filter(f => safeFilename(f.name));
    if (!candidates.length) throw Error('Nessun backup LAB su Drive.');
    // Ordinamento esplicito, con id per spareggio: nessuna selezione ambigua.
    candidates.sort((a,b) => b.createdTime.localeCompare(a.createdTime) || b.id.localeCompare(a.id));
    if (Number(candidates[0].size) > MAX_BYTES) throw Error('Backup Drive troppo grande (20 MB).');
    return candidates[0];
  }
  async function readRemote(file) {
    const res = await api('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media');
    const content = await res.text();
    if (new Blob([content]).size > MAX_BYTES) throw Error('Backup Drive troppo grande.');
    let encrypted;
    try { encrypted = JSON.parse(content); } catch (_) { throw Error('JSON remoto non valido.'); }
    if (encrypted?.format !== 'gsa-manager-encrypted-v1') throw Error('Backup Drive non cifrato.');
    const data = await decodeBackup(encrypted); // password solo in memoria durante la lettura
    validateBackup(data);
    return data;
  }
  async function getLocal() {
    const data = await collectBackup();
    validateBackup(data);
    return data;
  }
  async function backupConfirmed() {
    const [change, verified] = await Promise.all([metaGet('lastChange'),metaGet('lastVerified')]);
    return !!verified && (!change || verified >= change);
  }
  function checkCloudIdentity(base, latest) {
    if (base.id !== latest.id || (base.md5 && latest.md5Checksum && base.md5 !== latest.md5Checksum))
      throw Error('Drive è cambiato dopo l’ultimo allineamento. Non pubblicare: ricevi prima gli aggiornamenti oppure verifica il conflitto.');
  }
  async function saveBase(file, data) {
    const entry = {id:file.id, md5:file.md5Checksum || '', name:file.name,
      hash:await fingerprint(data), ids:idMap(data), at:new Date().toISOString()};
    await metaSet(BASE_KEY, entry);
    return entry;
  }
  async function doSyncInit() {
    assertReady();
    const latest = await getLatest();
    const local = await getLocal();
    const localHash = await fingerprint(local);
    const existing = await metaGet(BASE_KEY);
    if (existing && existing.hash !== localHash)
      throw Error('Questo PC ha modifiche rispetto al punto di partenza. Non reimpostarlo: usa Pubblica o Ricevi.');
    if (!confirm('ALLINEAMENTO INIZIALE (LAB)\n\nConfronto con ' + latest.name +
      '\nSarà richiesta la password del backup Drive.\nNessun condominio sarà modificato.')) return;
    const remote = await readRemote(latest);
    if (localHash !== await fingerprint(remote))
      throw Error('Archivio locale e Drive sono diversi. Allineamento bloccato. Verifica prima quale archivio contiene i dati corretti.');
    assertReady();
    // Il cloud non deve essere cambiato durante la lettura.
    const check = await getLatest();
    if (check.id !== latest.id || (latest.md5Checksum && check.md5Checksum !== latest.md5Checksum))
      throw Error('Drive è cambiato durante il controllo. Riprova.');
    await saveBase(check, local);
    syncResult.textContent = 'PUNTO DI PARTENZA ALLINEATO\n' + check.name +
      '\nArchivio locale identico al backup Drive. Nessun dato modificato.\nOra potrai pubblicare modifiche future o ricevere aggiornamenti.';
  }
  async function doSyncPull() {
    assertReady();
    const latest = await getLatest();
    const base = await metaGet(BASE_KEY);
    const local = await getLocal();
    const localHash = await fingerprint(local);
    if (!base) throw Error('Prima usa «Allinea punto di partenza» con archivi identici. Non verranno sovrascritti dati non allineati.');
    if (localHash !== base.hash)
      throw Error('Ci sono modifiche locali non pubblicate. Ricezione bloccata per evitare sovrascritture.');
    if (latest.id === base.id) {
      checkCloudIdentity(base, latest);
      syncResult.textContent = 'GIÀ ALLINEATO — Drive non contiene nuovi backup. Nessun dato modificato.';
      return;
    }
    if (!await backupConfirmed())
      throw Error('Prima scarica e conferma un backup cifrato di questo PC nella sezione Backup e trasferimento.');
    if (!confirm('RICEVI AGGIORNAMENTI (LAB)\n\nBackup più recente: ' + latest.name +
      '\nIl PC non ha modifiche locali rispetto alla base.\nLe eliminazioni e i conflitti saranno bloccati.\nHai conservato un backup cifrato locale verificato?')) return;
    const remote = await readRemote(latest);
    if (!hasAllIds(remote, base.ids))
      throw Error('Il backup remoto ha eliminato record presenti nella base. Eliminazioni non supportate: operazione bloccata.');
    const r = compareRecords(local, remote);
    if (r.onlyLocal) throw Error('Drive non contiene alcuni record locali. Ricezione bloccata.');
    for (const n of names) {
      const m = new Map(local[n].map(x => [x.id,x]));
      for (const item of remote[n]) {
        const old = m.get(item.id);
        if (old && JSON.stringify(stableValue(old)) !== JSON.stringify(stableValue(item)) &&
            item.updated <= old.updated)
          throw Error('Conflitto di data nel record ' + n + '/' + item.id + '. Ricezione bloccata.');
      }
    }
    // Ricontrolla che non siano cambiati né cloud né locale prima di scrivere.
    const cloudNow = await getLatest();
    if (cloudNow.id !== latest.id || (latest.md5Checksum && cloudNow.md5Checksum !== latest.md5Checksum))
      throw Error('Drive è cambiato durante il controllo. Ricezione bloccata.');
    if (await fingerprint(await getLocal()) !== localHash)
      throw Error('L’archivio locale è cambiato durante il controllo. Ricezione bloccata.');
    assertReady();
    const stats = await importAtomic(remote);
    const after = await getLocal();
    if (await fingerprint(after) !== await fingerprint(remote))
      throw Error('Importazione parziale o archivio non identico: punto di partenza NON aggiornato. Conserva i backup e interrompi i test.');
    await saveBase(cloudNow, after);
    await show('dashboard');
    syncResult.textContent = 'RICEZIONE COMPLETATA\n' + cloudNow.name +
      '\nNuovi: ' + stats.aggiunti + ' · Aggiornati: ' + stats.aggiornati +
      ' · Invariati: ' + stats.ignorati + '\nArchivi equivalenti. Conserva i backup cifrati.';
  }
  async function doSyncPush() {
    assertReady();
    const base = await metaGet(BASE_KEY);
    if (!base) throw Error('Prima usa «Allinea punto di partenza» con archivi identici.');
    const latest = await getLatest();
    checkCloudIdentity(base, latest);
    const local = await getLocal();
    const localHash = await fingerprint(local);
    if (localHash === base.hash) {
      syncResult.textContent = 'NESSUNA MODIFICA DA PUBBLICARE. Nessun file caricato.';
      return;
    }
    if (!hasAllIds(local, base.ids))
      throw Error('Hai eliminato record rispetto alla base. Eliminazioni non sincronizzate: pubblicazione bloccata.');
    if (!await backupConfirmed())
      throw Error('Prima scarica e conferma un backup cifrato aggiornato di questo PC.');
    if (!confirm('PUBBLICA MODIFICHE (LAB)\n\nVerrà creato un NUOVO backup cifrato su Drive.\nIl programma non elimina file e non sovrascrive altri backup.\nNon usare l’altro PC contemporaneamente.\nProcedere?')) return;
    const pass = prompt('Scegli la password per il NUOVO backup cifrato (almeno 12 caratteri). Non viene salvata:');
    if (pass === null) return;
    if (pass.length < 12) throw Error('Password troppo corta (minimo 12 caratteri).');
    const again = prompt('Ripeti la password del nuovo backup cifrato:');
    if (again !== pass) throw Error('Le password non coincidono. Nessun file caricato.');
    const encrypted = await encryptBackup(local, pass);
    // Prima dell'upload controlliamo di nuovo cloud e dati locali.
    const cloudNow = await getLatest();
    checkCloudIdentity(base, cloudNow);
    if (await fingerprint(await getLocal()) !== localHash)
      throw Error('Archivio locale cambiato durante la preparazione. Pubblicazione bloccata.');
    assertReady();
    const name = PREFIX + new Date().toISOString().replace(/[:.]/g,'-') + '.json';
    const boundary = 'gsa_lab_' + crypto.randomUUID().replaceAll('-','');
    const metadata = JSON.stringify({name, mimeType:'application/json'});
    const content = JSON.stringify(encrypted);
    if (new Blob([content]).size > MAX_BYTES) throw Error('Backup cifrato oltre 20 MB: caricamento bloccato.');
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n' +
      '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + content + '\r\n--' + boundary + '--';
    const res = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,md5Checksum', {
      method:'POST', headers:{'Content-Type':'multipart/related; boundary=' + boundary}, body
    });
    const created = await res.json();
    const check = await getLatest();
    if (check.id !== created.id) {
      syncResult.textContent = 'ATTENZIONE: backup creato (' + created.name +
        '), ma Drive mostra una copia più recente diversa. Non cambiare PC: conflitto di pubblicazione da verificare.';
      throw Error('Pubblicazione concorrente rilevata. Non considerare il dispositivo allineato.');
    }
    await saveBase(check, local);
    await listFiles();
    syncResult.textContent = 'PUBBLICAZIONE COMPLETATA\n' + created.name +
      '\nCopia cifrata aggiunta a Drive.\nPrima di lavorare dall’altro PC, usa «Ricevi da Drive».\nConserva la password del backup.';
  }
  function syncJob(fn) {
    return runJob(async () => {
      syncResult.textContent = 'Operazione in corso…';
      try { await fn(); }
      catch (e) { syncResult.textContent = 'OPERAZIONE INTERROTTA: ' + e.message + '\nSe era in corso un caricamento, verifica l’elenco dei backup Drive prima di riprovare.'; throw e; }
    });
  }
  syncInit.addEventListener('click', () => syncJob(doSyncInit));
  syncPull.addEventListener('click', () => syncJob(doSyncPull));
  syncPush.addEventListener('click', () => syncJob(doSyncPush));

  async function checkSyncReadOnly() {
    assertReady();
    compareResult.textContent = 'Controllo in corso: nessun dato verrà modificato…';
    const params = new URLSearchParams({
      q: "trashed = false and name contains '" + PREFIX + "'",
      fields: 'nextPageToken,files(id,name,size,createdTime)',
      page_size: '100', orderBy: 'createdTime desc'
    });
    const response = await api('https://www.googleapis.com/drive/v3/files?' + params);
    const list = await response.json();
    const candidates = (list.files || []).filter(f => safeFilename(f.name));
    if (!candidates.length) throw Error('Nessun backup LAB su Drive da confrontare.');
    if (list.nextPageToken) throw Error('Oltre 100 backup presenti: confronto automatico sospeso per evitare di scegliere la copia sbagliata.');
    // La copia più recente è solo un riferimento per il test, NON la fonte di verità.
    const selected = candidates[0];
    if (Number(selected.size) > MAX_BYTES) throw Error('Backup remoto oltre 20 MB: controllo sospeso.');
    if (!confirm('CONTROLLO SINCRONIZZAZIONE — SOLA LETTURA\n\nConfrontare l’archivio locale con il backup Drive più recente?\n' + selected.name + '\n\nSarà richiesta la password del BACKUP.\nNessun dato sarà modificato.')) {
      compareResult.textContent = 'Controllo annullato. Nessun dato modificato.';
      return;
    }
    const file = await api('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(selected.id) + '?alt=media');
    const rawText = await file.text();
    if (new Blob([rawText]).size > MAX_BYTES) throw Error('Backup remoto oltre 20 MB: controllo sospeso.');
    let encrypted;
    try { encrypted = JSON.parse(rawText); } catch (_) { throw Error('Backup Drive non è JSON valido.'); }
    if (encrypted?.format !== 'gsa-manager-encrypted-v1') throw Error('Backup remoto non cifrato: confronto bloccato.');
    // decodeBackup chiede la password ed esegue AES-GCM localmente nel browser.
    const remote = await decodeBackup(encrypted);
    validateBackup(remote);
    const local = await collectBackup();
    validateBackup(local);
    assertReady();
    const r = compareRecords(local, remote);
    const total = r.same + r.different + r.onlyLocal + r.onlyDrive;
    const report = [
      'CONTROLLO COMPLETATO — NESSUN DATO MODIFICATO',
      'Backup Drive confrontato: ' + selected.name,
      'Record uguali: ' + r.same,
      'Record presenti in entrambi ma differenti: ' + r.different,
      'Record presenti solo su questo dispositivo: ' + r.onlyLocal,
      'Record presenti solo nel backup Drive: ' + r.onlyDrive,
      'Totale voci esaminate: ' + total,
      r.different + r.onlyLocal + r.onlyDrive === 0
        ? 'ESITO: archivi equivalenti per i record confrontati.'
        : 'ESITO: differenze rilevate. Nessuna fusione o sovrascrittura eseguita.',
      'NOTA: questo è il confronto con un singolo backup, non una sincronizzazione. Le eliminazioni e i conflitti storici non sono ancora gestiti.'
    ].join('\n');
    compareResult.textContent = report;
    setStatus('Confronto in sola lettura completato. Nessun dato modificato.');
  }
  compareButton.addEventListener('click', () => runJob(async () => {
    try { await checkSyncReadOnly(); }
    catch (err) { compareResult.textContent = 'Controllo non completato: ' + err.message + '\nNessun dato modificato.'; throw err; }
  }));
  connect.addEventListener('click', () => {
    if (!isVaultUnlocked()) { setStatus('Sblocca prima l’archivio LAB.'); return; }
    if (initGoogle()) { setStatus('Attendo autorizzazione Google…'); tokenClient.requestAccessToken({prompt:'consent'}); }
  });
  disconnect.addEventListener('click', () => { disconnectNow(); setStatus('Disconnesso. Nessun dato modificato.'); });
  upload.addEventListener('click', () => runJob(async () => {
    assertReady();
    const existingBase = await metaGet(BASE_KEY);
    if (existingBase) throw Error('Questo PC ha già una base di sincronizzazione: usa «Pubblica su Drive» e non il caricamento manuale legacy.');
    const content = await parseEncryptedFile(fileInput.files?.[0]);
    // Controllo obbligatorio del contenuto prima di creare una nuova copia su Drive.
    // Evita di scegliere per errore un backup vecchio (1 condominio anziché 2).
    const decrypted = await decodeBackup(JSON.parse(content));
    const counts = validateBackup(decrypted);
    if (!confirm('ATTENZIONE — LAB\n\nBACKUP SELEZIONATO:\n' +
      counts.condomini + ' condomini, ' + counts.visite + ' sopralluoghi, ' + counts.classificazioni +
      ' classificazioni.\nEsportato: ' + humanDate(decrypted.exported) +
      '\n\nCaricare una NUOVA copia CIFRATA su Drive?\nNon verrà importato o sincronizzato automaticamente.\nNon usare dati reali.')) return;
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
