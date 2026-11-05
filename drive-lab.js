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
  const syncResolve = $('drive-lab-sync-resolve');
  const resolveFile = $('drive-lab-resolve-file');
  const syncResult = $('drive-lab-sync-result');
  const autoResult = $('drive-lab-auto-result');
  const fieldButton = $('drive-lab-field-compare');
  const fieldResult = $('drive-lab-field-result');
  let autoChecking = false;
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
    fieldButton.disabled = !connected || busy;
    fileInput.disabled = !connected || busy;
    for (const el of [syncInit,syncPull,syncPush,syncResolve,resolveFile]) el.disabled = !connected || busy;
  };
  function disconnectNow() {
    const oldToken = accessToken;
    accessToken = null;
    if (oldToken && window.google?.accounts?.oauth2?.revoke) {
      try { google.accounts.oauth2.revoke(oldToken, () => {}); } catch (_) { /* best effort */ }
    }
    fileInput.value = '';
    resolveFile.value = '';
    filesEl.replaceChildren();
    compareResult.textContent = '';
    fieldResult.textContent = 'In attesa del confronto.';
    syncResult.textContent = '';
    autoResult.textContent = 'Drive scollegato. Nessun controllo in corso.';
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
            void autoCheck();
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
  // FASE 2C.2: analisi delle differenze dei campi, SENZA scritture.
  // Non conserva valori, non propone un merge e non tratta 'updated' come prova di paternità.
  const fieldLabels = {
    nome:'Denominazione', cf:'Codice fiscale', indirizzo:'Indirizzo', comune:'Comune',
    provincia:'Provincia', amministratore:'Amministratore', email:'Email', telefono:'Telefono',
    altezza:'Altezza', piani:'Piani', scale:'Scale', unita:'Unità immobiliari',
    ascensore:'Ascensore', autorimessa:'Autorimessa', impianti:'Altri impianti / note',
    fotoEdificio:'Fotografia edificio', updated:'Data aggiornamento'
  };
  function fieldDiffReport(local, remote, base, file) {
    const lines = ['ANALISI PER CAMPO — NESSUN DATO MODIFICATO',
      'Backup Drive: ' + file.name];
    const possibleConflict = !!base && base.id !== file.id;
    const entries = [];
    let changed = 0, onlyLocal = 0, onlyDrive = 0, same = 0;
    for (const name of names) {
      const l = new Map(local[name].map(r => [r.id, r]));
      const d = new Map(remote[name].map(r => [r.id, r]));
      const ids = [...new Set([...l.keys(), ...d.keys()])].sort();
      for (const id of ids) {
        const left = l.get(id), right = d.get(id);
        const title = (left?.nome || right?.nome || id).toString().slice(0,90);
        const head = name + ' / ' + title + ' (ID ' + id.slice(0,12) + '…)';
        if (!left) { onlyDrive++; entries.push('SOLO DRIVE: ' + head); continue; }
        if (!right) { onlyLocal++; entries.push('SOLO PC: ' + head); continue; }
        const keys = [...new Set([...Object.keys(left),...Object.keys(right)])].sort();
        const diff = keys.filter(k => JSON.stringify(stableValue(left[k])) !== JSON.stringify(stableValue(right[k])));
        if (!diff.length) { same++; continue; }
        changed++;
        const meaningful = diff.filter(k => k !== 'updated');
        const labels = meaningful.map(k => fieldLabels[k] || k);
        entries.push('DIVERSO: ' + head + '\n  Campi: ' + (labels.length ? labels.join(', ') : 'solo data aggiornamento') +
          (diff.includes('updated') ? ' [data aggiornamento diversa]' : ''));
      }
    }
    lines.push('Uguali: ' + same + ' · Differenti: ' + changed +
      ' · Solo PC: ' + onlyLocal + ' · Solo Drive: ' + onlyDrive);
    if (possibleConflict) lines.push('ATTENZIONE: Drive è cambiato rispetto alla base di questo PC. Le differenze potrebbero essere conflitti.');
    if (!base) lines.push('ATTENZIONE: punto di partenza assente; impossibile attribuire le modifiche.');
    lines.push('Non è possibile stabilire chi abbia modificato ogni campo senza uno storico completo.');
    if (entries.length) {
      lines.push('--- DETTAGLIO (massimo 50 record) ---');
      lines.push(...entries.slice(0,50));
      if (entries.length > 50) lines.push('Altri ' + (entries.length - 50) + ' record non visualizzati.');
    } else lines.push('Nessuna differenza nei record.');
    lines.push('NESSUNA FUSIONE, IMPORTAZIONE O PUBBLICAZIONE ESEGUITA.');
    return lines.join('\n');
  }
  async function doFieldCompare() {
    assertReady();
    const latest = await getLatest();
    if (!confirm('ANALISI DIFFERENZE PER CAMPO — SOLA LETTURA\n\n' +
      'Confrontare con ' + latest.name + '?\nSarà richiesta la password del backup Drive.\n' +
      'Non verrà modificato alcun dato.')) {
      fieldResult.textContent = 'Confronto annullato. Nessun dato modificato.';
      return;
    }
    const local = await getLocal();
    const before = await fingerprint(local);
    const remote = await readRemote(latest);
    const [now, current, base] = await Promise.all([getLatest(),getLocal(),metaGet(BASE_KEY)]);
    if (now.id !== latest.id || (latest.md5Checksum && now.md5Checksum !== latest.md5Checksum))
      throw Error('Drive è cambiato durante la lettura. Riprova il confronto.');
    if (await fingerprint(current) !== before)
      throw Error('Archivio locale cambiato durante la lettura. Riprova il confronto.');
    assertReady();
    fieldResult.textContent = fieldDiffReport(local, remote, base, latest);
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


// FASE 2B — risoluzione MANUALE di un conflitto circoscritto alle note.
// Non è un merge automatico: ammette solo un condominio differente e
// solo i campi "impianti" e "updated". Ogni altra differenza blocca tutto.
function inspectReconciledNotes(local, remote, base) {
  if (!hasAllIds(local, base.ids) || !hasAllIds(remote, base.ids))
    throw Error('Un record del precedente punto di partenza è mancante. Risoluzione bloccata.');
  const r = compareRecords(local, remote);
  if (r.onlyLocal || r.onlyDrive || r.different !== 1)
    throw Error('La risoluzione guidata richiede gli stessi record su PC e Drive e un solo condominio differente. Risultato: ' +
      r.same + ' uguali, ' + r.different + ' differenti, ' + r.onlyLocal + ' solo PC, ' + r.onlyDrive + ' solo Drive.');

  let changed = null;
  for (const name of names) {
    const remoteMap = new Map(remote[name].map(x => [x.id, x]));
    for (const item of local[name]) {
      const other = remoteMap.get(item.id);
      if (!other) throw Error('Record mancante nel backup Drive: ' + name + '/' + item.id);
      if (JSON.stringify(stableValue(item)) === JSON.stringify(stableValue(other))) continue;
      if (name !== 'condomini' || changed)
        throw Error('Sono presenti differenze fuori dall’unico condominio previsto. Operazione bloccata.');
      const fields = [...new Set([...Object.keys(item), ...Object.keys(other)])]
        .filter(k => JSON.stringify(stableValue(item[k])) !== JSON.stringify(stableValue(other[k])));
      const contentFields = fields.filter(k => k !== 'updated');
      if (contentFields.length !== 1 || contentFields[0] !== 'impianti')
        throw Error('Differenze anche in altri campi (' + contentFields.join(', ') + '). Non è sicuro pubblicare automaticamente: verifica il record.');
      const driveNote = typeof other.impianti === 'string' ? other.impianti.trim() : '';
      const localNote = typeof item.impianti === 'string' ? item.impianti.trim() : '';
      if (!driveNote || !localNote || localNote === driveNote || !localNote.includes(driveNote))
        throw Error('Le note locali non contengono integralmente quelle presenti su Drive. Fusione manuale da ricontrollare.');
      if (!(item.updated > other.updated))
        throw Error('La data di modifica locale non è successiva a quella su Drive. Risoluzione bloccata.');
      changed = {name: item.nome || item.id, driveNote, localNote};
    }
  }
  if (!changed) throw Error('Nessuna modifica alle note da riconciliare.');
  return changed;
}

async function doSyncResolve(backupFile) {
  assertReady();
  if (!backupFile || backupFile.size > MAX_BYTES)
    throw Error('Seleziona il backup cifrato e verificato di questo PC (massimo 20 MB).');
  const base = await metaGet(BASE_KEY);
  if (!base) throw Error('Punto di partenza assente. Questa funzione non può inizializzare una sincronizzazione.');
  const latest = await getLatest();
  if (latest.id === base.id) throw Error('Drive non è cambiato: usa la normale funzione «Pubblica su Drive».');
  const local = await getLocal();
  const localHash = await fingerprint(local);
  if (localHash === base.hash) throw Error('Nessuna modifica locale: usa «Ricevi da Drive».');

  // Il backup su disco deve essere CIFRATO e contenere esattamente l'archivio
  // locale corrente. La semplice conferma manuale del download non basta.
  let encryptedLocal;
  try { encryptedLocal = JSON.parse(await backupFile.text()); }
  catch (_) { throw Error('Il backup locale selezionato non è un JSON valido.'); }
  if (encryptedLocal?.format !== 'gsa-manager-encrypted-v1')
    throw Error('È obbligatorio un backup locale CIFRATO.');
  const savedLocal = await decodeBackup(encryptedLocal);
  validateBackup(savedLocal);
  if (await fingerprint(savedLocal) !== localHash)
    throw Error('Il backup selezionato non corrisponde all’archivio corrente. Scarica e verifica un nuovo backup cifrato.');

  const remote = await readRemote(latest);
  const info = inspectReconciledNotes(local, remote, base);
  const check = await getLatest();
  if (check.id !== latest.id || (latest.md5Checksum && check.md5Checksum !== latest.md5Checksum))
    throw Error('Drive è cambiato durante la verifica. Non pubblicare.');
  if (await fingerprint(await getLocal()) !== localHash)
    throw Error('Archivio locale cambiato durante la verifica. Non pubblicare.');

  if (!confirm('RISOLUZIONE MANUALE — SOLO LAB\n\nCondominio: ' + info.name +
    '\n\nNote attuali su Drive:\n' + info.driveNote.slice(0, 500) +
    '\n\nNote riunite sul PC:\n' + info.localNote.slice(0, 700) +
    '\n\nSono stati verificati gli stessi record e nessun altro campo differente.\n' +
    'Hai controllato che le note riunite siano corrette?')) return;
  if (!confirm('CONFERMA PUBBLICAZIONE PROTETTA — SOLO LAB\n\n' +
    'Il backup cifrato locale è stato aperto e confrontato con l’archivio corrente.\n' +
    'Verrà aggiunta una NUOVA copia cifrata su Drive; le copie precedenti non verranno cancellate.\n' +
    'L’altro PC non deve essere utilizzato durante questa operazione.\n\nProcedere?')) return;

  const pass = prompt('Scegli la password del NUOVO backup cifrato su Drive (almeno 12 caratteri):');
  if (pass === null) return;
  if (pass.length < 12) throw Error('Password troppo corta (minimo 12 caratteri).');
  const again = prompt('Ripeti la password del nuovo backup cifrato:');
  if (again !== pass) throw Error('Le password non coincidono. Nessun file caricato.');
  const encrypted = await encryptBackup(local, pass);
  const cloudNow = await getLatest();
  if (cloudNow.id !== latest.id || (latest.md5Checksum && cloudNow.md5Checksum !== latest.md5Checksum))
    throw Error('Drive è cambiato prima della pubblicazione. Nessun caricamento eseguito.');
  if (await fingerprint(await getLocal()) !== localHash)
    throw Error('Archivio locale cambiato prima della pubblicazione. Nessun caricamento eseguito.');
  assertReady();

  const name = PREFIX + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  const boundary = 'gsa_lab_' + crypto.randomUUID().replaceAll('-', '');
  const metadata = JSON.stringify({name, mimeType:'application/json'});
  const content = JSON.stringify(encrypted);
  if (new Blob([content]).size > MAX_BYTES) throw Error('Backup cifrato oltre 20 MB. Nessun caricamento.');
  const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n' +
    '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + content + '\r\n--' + boundary + '--';
  const res = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,md5Checksum', {
    method:'POST', headers:{'Content-Type':'multipart/related; boundary=' + boundary}, body
  });
  const created = await res.json();
  const newest = await getLatest();
  if (newest.id !== created.id) {
    syncResult.textContent = 'ATTENZIONE: backup creato (' + created.name +
      '), ma è presente una copia più recente. Non cambiare PC; verifica il conflitto.';
    throw Error('Pubblicazione concorrente rilevata. Il dispositivo NON è allineato.');
  }
  await saveBase(newest, local);
  try { await listFiles(); } catch (_) { /* l'elenco non è necessario per confermare il salvataggio */ }
  syncResult.textContent = 'RISOLUZIONE E PUBBLICAZIONE COMPLETATE\n' + created.name +
    '\nUn solo condominio: note riunite e nessun altro campo modificato rispetto a Drive.\n' +
    'Backup cifrato precedente conservato. Prima di usare il PC di casa, ricevi il nuovo backup da Drive.';
}

  // FASE 2C.1: controllo automatico NON distruttivo. Non apre il backup remoto,
  // non chiede password e non modifica dati locali/Drive. La base 2B rimane invariata.
  async function autoCheck() {
    if (autoChecking || busy || !accessToken || !isVaultUnlocked()) return;
    autoChecking = true;
    autoResult.textContent = 'Controllo automatico in corso (sola lettura)…';
    try {
      const base = await metaGet(BASE_KEY);
      const latest = await getLatest();
      const local = await getLocal();
      const localHash = await fingerprint(local);
      if (!accessToken || !isVaultUnlocked()) return;
      const remoteChanged = !!base && (base.id !== latest.id ||
        (!!base.md5 && !!latest.md5Checksum && base.md5 !== latest.md5Checksum));
      const localChanged = !!base && base.hash !== localHash;
      const stamp = new Date().toLocaleTimeString('it-IT');
      const prefix = 'Controllo automatico ' + stamp + '\nBackup più recente: ' + latest.name + '\n';
      if (!base) {
        autoResult.textContent = prefix + 'PUNTO DI PARTENZA ASSENTE. Usa la procedura manuale protetta per allineare i dispositivi. Nessun dato modificato.';
      } else if (remoteChanged && localChanged) {
        autoResult.textContent = prefix + 'ATTENZIONE: modifiche sia su questo PC sia su Drive. Possibile conflitto. Non ricevere né pubblicare prima di un confronto protetto. Nessun dato modificato.';
      } else if (remoteChanged) {
        autoResult.textContent = prefix + 'NOVITÀ SU DRIVE: è disponibile un backup successivo al punto di partenza. Nessuna modifica locale rilevata. Per ora usa «Ricevi da Drive» con backup di sicurezza.';
      } else if (localChanged) {
        autoResult.textContent = prefix + 'MODIFICHE LOCALI: Drive non risulta cambiato. Per ora usa «Pubblica su Drive» con la procedura protetta.';
      } else {
        autoResult.textContent = prefix + 'NESSUNA MODIFICA rispetto all’ultimo allineamento. Nessun dato trasferito.';
      }
    } catch (err) {
      autoResult.textContent = 'Controllo automatico non riuscito: ' + err.message + '\nNessun dato modificato.';
    } finally {
      autoChecking = false;
    }
  }
  // Solo durante una sessione già autorizzata: mai riaprire automaticamente OAuth.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void autoCheck();
  });
  setInterval(() => { if (!document.hidden) void autoCheck(); }, 120000);

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
  syncResolve.addEventListener('click', () => { if (!busy) resolveFile.click(); });
  resolveFile.addEventListener('change', () => {
    const file = resolveFile.files?.[0];
    if (!file) return;
    syncJob(async () => { try { await doSyncResolve(file); } finally { resolveFile.value = ''; } });
  });

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
  fieldButton.addEventListener('click', () => runJob(async () => {
    fieldResult.textContent = 'Analisi in corso (sola lettura)…';
    try { await doFieldCompare(); }
    catch (err) { fieldResult.textContent = 'ANALISI INTERROTTA: ' + err.message + '\nNessun dato modificato.'; throw err; }
  }));
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
