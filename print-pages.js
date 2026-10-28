/* GSA Manager 1.9.9.4: paginazione A4 esplicita, indipendente dai margini Edge/Chrome. */
(() => {
  const ROOT_ID = 'gsa-print-root';
  let busy = false;
  const waitFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  function removePrintRoot() { document.getElementById(ROOT_ID)?.remove(); }
  function makeSheet(root, cover = false) {
    const sheet = document.createElement('div');
    sheet.className = 'gsa-print-sheet' + (cover ? ' gsa-print-cover-sheet' : '');
    if (!cover) {
      const frame = document.createElement('div');
      frame.className = 'gsa-print-inner-frame';
      frame.setAttribute('aria-hidden', 'true');
      sheet.append(frame);
      const footer=document.createElement('div');
      footer.className='gsa-print-page-footer';
      sheet.append(footer);
    }
    const area = document.createElement('div');
    area.className = cover ? 'gsa-print-cover-area' : 'gsa-print-sheet-area gsa-report-body';
    sheet.append(area);
    root.append(sheet);
    return area;
  }
  function fits(area) { return area.scrollHeight <= area.clientHeight + 2; }
  function addNode(area, node) {
    area.append(node);
    if (fits(area)) return true;
    node.remove();
    return false;
  }
  function newInner(root) { return makeSheet(root); }
  function splitTable(node, root, current) {
    const rows = [...node.querySelectorAll(':scope > tbody > tr')];
    if (!rows.length) return null;
    let table = null, body = null;
    function fresh() {
      table = node.cloneNode(false);
      for (const child of node.children) if (child.tagName !== 'TBODY') table.append(child.cloneNode(true));
      body = document.createElement('tbody'); table.append(body);
      if (!addNode(current, table)) { current = newInner(root); current.append(table); }
    }
    fresh();
    for (const row of rows) {
      const copy = row.cloneNode(true);
      body.append(copy);
      if (!fits(current)) {
        copy.remove();
        if (body.children.length === 0) { // One unusually tall row: allow it rather than looping.
          body.append(copy);
        } else {
          current = newInner(root); fresh(); body.append(copy);
        }
      }
    }
    return current;
  }
  function splitContainer(node, root, current) {
    if (!node.children.length || node.children.length === 1) return null;
    const tag = node.tagName.toLowerCase();
    if (!['section','div','dl'].includes(tag)) return null;
    const parts = [...node.children];
    let container = null;
    for (const part of parts) {
      const copy = part.cloneNode(true);
      if (!container) {
        container = node.cloneNode(false);
        if (!addNode(current, container)) { current = newInner(root); current.append(container); }
      }
      container.append(copy);
      if (!fits(current)) {
        copy.remove();
        if (container.children.length === 0) container.append(copy);
        else {
          current = newInner(root);
          container = node.cloneNode(false);
          current.append(container);
          container.append(copy);
        }
      }
    }
    return current;
  }
  async function buildPrintRoot() {
    removePrintRoot();
    const report = document.querySelector('#report');
    if (!report) throw new Error('Apri prima un verbale da stampare.');
    const cover = report.querySelector('.gsa-cover');
    const body = report.querySelector('.gsa-report-body');
    if (!cover || !body) throw new Error('Il verbale non contiene le pagine previste.');
    await Promise.all([...report.querySelectorAll('img')].map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })));
    const root = document.createElement('div'); root.id = ROOT_ID;
    document.body.append(root);
    makeSheet(root, true).append(cover.cloneNode(true));
    let current = newInner(root);
    const signature = body.querySelector(':scope > .gsa-signature-block');
    const nodes = [...body.children].filter(node => node !== signature);
    for (let i = 0; i < nodes.length; i++) {
      const original = nodes[i];
      const clone = original.cloneNode(true);
      // Keep headings together with the following content.
      if (/^H[234]$/.test(original.tagName) && nodes[i + 1]) {
        const next = nodes[i + 1].cloneNode(true);
        current.append(clone, next);
        if (!fits(current)) { clone.remove(); next.remove(); current = newInner(root); }
        else { next.remove(); continue; }
        next.remove();
      }
      if (addNode(current, clone)) continue;
      const isEmpty = current.children.length === 0;
      if (!isEmpty) {
        current = newInner(root);
        if (addNode(current, clone)) continue;
      }
      // Oversized table/container: distribute its children across sheets.
      if (original.tagName === 'TABLE') {
        const split = splitTable(original, root, current);
        if (split) { current = split; continue; }
      }
      const split = splitContainer(original, root, current);
      if (split) { current = split; continue; }
      current.append(clone); // Extremely long single item: do not silently discard content.
    }
    // La firma del tecnico deve stare in basso a destra nell'ultima pagina,
    // senza coprire contenuti. Se lo spazio e' occupato, crea una nuova pagina.
    if (signature) {
      const reserveMm = 46; // 38 mm firma + 7 mm distacco dal bordo inferiore + tolleranza
      const mmPx = 96 / 25.4;
      let lastArea = root.querySelector('.gsa-print-sheet:last-child .gsa-print-sheet-area');
      const lastChild = lastArea?.lastElementChild;
      if (lastArea && lastChild) {
        const occupied = lastChild.getBoundingClientRect().bottom - lastArea.getBoundingClientRect().top;
        if (occupied > lastArea.clientHeight - reserveMm * mmPx) lastArea = newInner(root);
      }
      if (lastArea) lastArea.append(signature.cloneNode(true));
    }
    // Remove trailing empty sheet if any.
    const last = root.lastElementChild;
    if (last?.querySelector('.gsa-print-sheet-area')?.children.length === 0) last.remove();
    // Footer su tutte le pagine interne; la copertina resta invariata.
    const name = report.querySelector('.gsa-cover-data > div:first-child b')?.textContent?.trim() || 'Condominio';
    const address = report.querySelector('.gsa-cover-data > div:nth-child(2) b')?.textContent?.trim() || '';
    const innerSheets=[...root.querySelectorAll('.gsa-print-sheet:not(.gsa-print-cover-sheet)')];
    const total=innerSheets.length+1;
    innerSheets.forEach((sheet,i)=>{
      const footer=sheet.querySelector('.gsa-print-page-footer');
      if(footer){
        const left=document.createElement('span');left.textContent=name+(address?' · '+address:'');
        const right=document.createElement('strong');right.textContent='Pagina '+(i+2)+' di '+total;
        footer.replaceChildren(left,right);
      }
    });
    await Promise.all([...root.querySelectorAll('img')].map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })));
    await waitFrame();
    // Images may affect height after load. This is caught by the test report below.
    return root;
  }
  window.gsaPreparePrint = buildPrintRoot;
  window.gsaPrint = async function() {
    if (busy) return;
    busy = true;
    try {
      await document.fonts.ready;
      await buildPrintRoot();
      window.print();
    } catch (e) {
      alert('Impossibile preparare la stampa: ' + e.message);
    } finally { busy = false; }
  };
  window.addEventListener('afterprint', () => { setTimeout(removePrintRoot, 500); });
})();
