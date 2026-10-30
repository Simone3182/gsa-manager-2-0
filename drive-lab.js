/* GSA Manager 2.0 LAB — solo test OAuth Google Drive.
 * Nessun dato dell'archivio è letto, inviato, salvato o sincronizzato.
 * OAuth client ID pubblico; NON inserire client secret nel browser.
 */
(() => {
  'use strict';
  const CLIENT_ID = '747946909464-8p17rmoft41mdeqgio443uhmauuo9kgj.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const status = document.getElementById('drive-lab-status');
  const connect = document.getElementById('drive-lab-connect');
  const disconnect = document.getElementById('drive-lab-disconnect');
  let tokenClient = null;
  let accessToken = null;

  function setStatus(message, connected=false) {
    status.textContent = message;
    connect.disabled = connected;
    disconnect.disabled = !connected;
  }
  function isVaultUnlocked() {
    const overlay = document.getElementById('privacy-lock');
    return overlay && getComputedStyle(overlay).display === 'none';
  }
  function init() {
    if (!window.google?.accounts?.oauth2) {
      setStatus('Google Identity Services non disponibile. Controlla connessione internet e blocchi del browser.');
      return false;
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: async (response) => {
          if (response.error || !response.access_token) {
            setStatus('Autorizzazione non riuscita: ' + (response.error || 'nessun token'));
            return;
          }
          accessToken = response.access_token; // Solo in memoria, mai in localStorage/IndexedDB
          try {
            const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', {
              headers: { Authorization: 'Bearer ' + accessToken },
              cache: 'no-store'
            });
            if (!r.ok) throw new Error('Google Drive API: HTTP ' + r.status);
            const data = await r.json();
            if (!isVaultUnlocked()) {
              disconnectNow();
              setStatus('Archivio LAB bloccato: collegamento Drive interrotto.');
              return;
            }
            setStatus('Collegamento riuscito con ' + (data.user?.emailAddress || 'account Google') +
              '. TEST riuscito: nessun file caricato o modificato.', true);
          } catch (err) {
            disconnectNow();
            setStatus('Accesso autorizzato, ma verifica Drive non riuscita: ' + err.message);
          }
        },
        error_callback: (err) => {
          setStatus('Finestra Google non completata: ' + (err?.type || 'errore o chiusura'));
        }
      });
    }
    return true;
  }
  function disconnectNow() {
    if (accessToken && window.google?.accounts?.oauth2?.revoke) {
      try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (e) { /* best effort */ }
    }
    accessToken = null;
  }
  connect.addEventListener('click', () => {
    if (!isVaultUnlocked()) {
      setStatus('Sblocca prima l’archivio LAB con la password locale.');
      return;
    }
    if (init()) {
      setStatus('Attendo autorizzazione Google…');
      tokenClient.requestAccessToken({prompt: 'consent'});
    }
  });
  disconnect.addEventListener('click', () => {
    disconnectNow();
    setStatus('Disconnesso. Nessun dato modificato.');
  });
  // Interrompi la sessione OAuth se l'archivio viene bloccato per inattività.
  const overlay = document.getElementById('privacy-lock');
  if (overlay) {
    new MutationObserver(() => {
      if (getComputedStyle(overlay).display !== 'none' && accessToken) {
        disconnectNow();
        setStatus('Archivio LAB bloccato: collegamento Drive interrotto.');
      }
    }).observe(overlay, {attributes:true,attributeFilter:['style']});
  }
  setStatus('Non collegato. Nessun file verrà caricato o modificato su Drive.');
})();
