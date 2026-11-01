(() => {
  let options, busy = false, epoch = 0;
  const controllers = new Set();
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const base = () => ['localhost', '127.0.0.1'].includes(location.hostname) ? `${location.protocol}//${location.hostname}:5000/api` : '/api';
  const review = () => options?.getState()?.rateReview;
  const persist = () => { if (!options?.persist()) throw new Error('Could not preserve the review locally. Free storage before submitting.'); };
  function status(text) { if (el('reviewStatus')) el('reviewStatus').textContent = text; }
  async function request(path, body, form = false) {
    const started = epoch;
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), form ? 40000 : 15000);
    try {
      const response = await window.CourierAuth.apiFetch(base() + path, { ...(body !== undefined ? { method: 'POST', body: form ? body : JSON.stringify(body), headers: form ? {} : { 'Content-Type': 'application/json' } } : {}), signal: controller.signal });
      const result = await response.json();
      if (started !== epoch || !window.CourierAuth.isAuthenticated()) throw new Error('Session changed. Sign in again to recover the review.');
      if (!response.ok || result.success !== true) throw new Error('The server did not confirm the operation. Retry the same request.');
      return result;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  function getCard() {
    const blank = (value) => value.trim() === '' ? null : value;
    return { shipperCode: el('reviewShipperCode').value, clientInfo: { clientName: el('reviewClientName').value, address: el('reviewClientAddress').value, quotationDate: el('reviewQuotationDate').value },
      globalRules: { minWeightKg: blank(el('reviewMinWeightKg').value), fuelSurchargePct: blank(el('reviewFuelSurchargePct').value), notes: el('reviewGlobalNotes').value },
      rates: Array.from(el('reviewRatesTableBody').querySelectorAll('tr')).map((row) => ({
        targetName: row.querySelector('.review-target-name').value, targetType: row.querySelector('.review-target-type').value || null,
        baseKg: blank(row.querySelector('.review-base-kg').value), baseRate: blank(row.querySelector('.review-base-rate').value),
        perKgRate: blank(row.querySelector('.review-per-kg').value), formula: row.querySelector('.review-formula').value || null,
        conditions: row.querySelector('.review-conditions').value
      })) };
  }
  function validate() {
    try {
      const result = window.RateCardContract.normalize(getCard(), { allowUnresolved: true });
      el('reviewValidation').textContent = [...result.issues.map((i) => i.message), ...result.warnings.map((w) => w.message)].join('\n');
      return result;
    } catch (error) { el('reviewValidation').textContent = error.message; return null; }
  }
  function controls() {
    const r = review(); if (!r) return;
    const pending = !!r.pending;
    for (const input of el('pdfReviewModal').querySelectorAll('.modal-body input, .modal-body textarea, .modal-body select, #addReviewRowButton, [data-action="delete-review"]')) input.disabled = busy || pending;
    el('saveReviewedRatesButton').disabled = busy || pending;
    el('publishReviewedRatesButton').disabled = busy || pending || !r.saved || !el('reviewApproval').checked;
    el('rollbackRateVersionButton').disabled = busy || pending || !r.book?.activeVersion || !el('reviewApproval').checked;
    el('retryRateReviewButton').hidden = !pending;
    el('retryRateReviewButton').disabled = busy;
    el('cancelReviewModal').disabled = busy; el('closeReviewModal').disabled = busy;
  }
  function renderRows(rates) {
    el('reviewRatesTableBody').innerHTML = rates.map((row) => `<tr>
      <td><input class="review-target-name" value="${esc(row.targetName)}" /></td>
      <td><select class="review-target-type"><option value="">Unresolved</option>${window.RateCardContract.TYPES.map((type) => `<option ${row.targetType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></td>
      <td><input class="review-base-kg" inputmode="decimal" value="${esc(row.baseKg)}" /></td>
      <td><input class="review-base-rate" inputmode="decimal" value="${esc(row.baseRate)}" /></td>
      <td><input class="review-per-kg" inputmode="decimal" value="${esc(row.perKgRate)}" /></td>
      <td><select class="review-formula"><option value="">Unresolved formula</option><option value="BASE_PLUS_EXTRA_PER_KG" ${row.formula === 'BASE_PLUS_EXTRA_PER_KG' ? 'selected' : ''}>Base + extra/kg, times pieces</option></select><input class="review-conditions" value="${esc(row.conditions)}" placeholder="Special conditions" /></td>
      <td><button type="button" data-action="delete-review">Remove</button></td></tr>`).join('');
  }
  function display() {
    const r = review(); if (!r) return;
    const card = r.card;
    el('reviewShipperCode').value = card.shipperCode ?? '';
    el('reviewClientName').value = card.clientInfo?.clientName ?? '';
    el('reviewClientAddress').value = card.clientInfo?.address ?? '';
    el('reviewQuotationDate').value = card.clientInfo?.quotationDate ?? '';
    el('reviewMinWeightKg').value = card.globalRules?.minWeightKg ?? '';
    el('reviewFuelSurchargePct').value = card.globalRules?.fuelSurchargePct ?? '';
    el('reviewGlobalNotes').value = card.globalRules?.notes ?? '';
    renderRows(card.rates || []);
    el('reviewApproval').checked = false;
    el('approvedRateVersion').innerHTML = (r.book?.versions || []).map((v) => `<option value="${v.version}">Approved version ${v.version} (${esc(v.kind)})</option>`).join('');
    const modal = el('pdfReviewModal'); modal.hidden = false; modal.classList.remove('hidden'); modal.style.display = '';
    status(r.pending ? 'Unknown request outcome. Retry the preserved request before editing.' : r.saved ? `Draft saved at revision ${r.saved.revision}. Not published.` : 'Unsaved review. Active rates are unchanged.');
    validate(); controls();
  }
  function open(card) {
    if (!options?.getState() || !window.CourierAuth.isAuthenticated()) return;
    if (review()?.pending) { display(); status('Resolve the pending request before starting a different import.'); return; }
    if (review()) {
      // Keep the preceding review recoverable without replacing the active pricing table.
      window.DraftVault.setItem(`courier-rate-review-archive-${crypto.randomUUID()}`, JSON.stringify(review()));
    }
    options.getState().rateReview = { card: structuredClone(card), saved: null, pending: null, book: null };
    persist(); display(); el('resumeRateReviewButton').hidden = false;
  }
  async function sendPending() {
    const r = review(); if (!r?.pending || busy) return;
    const mine = epoch; const pending = r.pending; busy = true; controls(); status('Saving request; waiting for backend confirmation…');
    try {
      await window.DraftVault.flush();
      const result = await request(pending.path, pending.body);
      if (mine !== epoch || !review()) return;
      if (pending.path.endsWith('/drafts')) {
        if (!result.data?._id || result.data.revision !== result.operationRevision || result.data.shipperCode !== pending.body.card.shipperCode) throw new Error('Exact draft save was not confirmed. Retry or reload the draft.');
        r.card = result.data.card; r.saved = { id: result.data._id, revision: result.data.revision, content: JSON.stringify(result.data.card) };
        r.pending = null; persist();
        const book = await request(`/rate-cards/book?shipperCode=${encodeURIComponent(r.card.shipperCode)}`);
        if (mine !== epoch) return;
        r.book = book.data; r.bookRevision = book.data?.revision || 0; persist(); display();
        status(`Draft saved at revision ${r.saved.revision}. Active version ${r.bookRevision}; explicit approval and Publish are still required.${r.bookRevision >= 35 ? ' Retention warning: the 40-version safety limit is near or reached. No versions are deleted; plan an approved archive extension before further publication or rollback.' : ''}`);
      } else {
        const book = result.data;
        if (!book || book._id !== pending.body.shipperCode || book.activeVersion !== result.operationRevision || book.revision !== result.operationRevision || !book.operations?.some((op) => op.requestId === pending.body.requestId)) throw new Error('Publication outcome is not the current active version. Reload server status before continuing.');
        const active = book.versions.find((v) => v.version === book.activeVersion);
        if (!active) throw new Error('Published version could not be confirmed.');
        r.pending = null; r.book = book; r.bookRevision = book.revision; r.card = active.card; r.saved = null; persist();
        const applied = await options.onPublished(active.card);
        display(); status(`Published version ${book.activeVersion} confirmed.${applied ? '' : ' Local draft could not be synchronized; load published rates.'}`);
      }
    } catch (error) {
      if (mine === epoch && review()) {
        if ([400, 409, 413, 422].includes(error.status)) { r.pending = null; persist(); }
        status(`Not confirmed: ${error.message} Active rates are not assumed changed.`);
      }
    } finally { if (mine === epoch) { busy = false; controls(); } }
  }
  function queue(path, body) { review().pending = { path, body: structuredClone(body) }; persist(); return sendPending(); }
  async function save() {
    if (busy || review()?.pending) return;
    try {
      const { card } = window.RateCardContract.normalize(getCard());
      const r = review(); r.card = card;
      await queue('/rate-cards/drafts', { requestId: crypto.randomUUID(), expectedRevision: r.saved?.revision || 0, ...(r.saved ? { draftId: r.saved.id } : {}), card });
    } catch (error) { status(error.message); }
  }
  async function publish(rollback = false) {
    if (busy || review()?.pending || !el('reviewApproval').checked) return;
    try {
      const r = review();
      if (rollback) {
        const sourceVersion = Number(el('approvedRateVersion').value);
        if (!sourceVersion || !confirm(`Roll back to approved version ${sourceVersion}? This creates a new publication and never changes issued invoices.`)) return;
        await queue('/rate-cards/rollback', { requestId: crypto.randomUUID(), shipperCode: r.card.shipperCode, expectedRevision: r.bookRevision, sourceVersion, approved: true });
      } else {
        const normalized = window.RateCardContract.normalize(getCard());
        if (!r.saved || JSON.stringify(normalized.card) !== r.saved.content || r.bookRevision === undefined) throw new Error('Save the reviewed values as a draft and load publication status before approval.');
        if (!confirm('Publish this exact reviewed draft? Future calculations will use it; issued invoices will not change.')) return;
        await queue('/rate-cards/publish', { requestId: crypto.randomUUID(), shipperCode: normalized.card.shipperCode, expectedRevision: r.bookRevision,
          draftId: r.saved.id, draftRevision: r.saved.revision, approved: true, acknowledgedWarnings: normalized.warnings.map((w) => w.code) });
      }
    } catch (error) { status(error.message); }
  }
  function close() { if (busy) return; const modal = el('pdfReviewModal'); modal.hidden = true; modal.style.display = 'none'; }
  function bind(value) {
    options = value;
    el('resumeRateReviewButton').hidden = !review();
    el('resumeRateReviewButton').onclick = display;
    el('triggerPdfUploadButton').onclick = () => el('pdfRateUpload').click();
    el('pdfRateUpload').onchange = () => {
      el('pdfFileNameDisplay').textContent = el('pdfRateUpload').files[0]?.name || 'No file chosen';
      el('parsePdfButton').disabled = !el('pdfRateUpload').files.length;
    };
    el('parsePdfButton').onclick = async () => {
      if (busy) return;
      const file = el('pdfRateUpload').files[0]; if (!file) return;
      if (review()?.pending) { display(); return; }
      const mine = epoch; busy = true; el('parsePdfButton').disabled = true; el('aiLoadingSpinner').hidden = false;
      el('pdfParseStatus').textContent = 'Parsing for review only…';
      try {
        const form = new FormData(); form.append('pdf', file);
        const result = await request('/rates/parse-pdf', form, true);
        if (mine !== epoch) return;
        open(result.data); el('pdfParseStatus').textContent = result.complete ? 'Extraction ready for human review. Nothing published.' : 'Extraction has unresolved values. Complete them before saving a draft.';
      } catch (error) { if (mine === epoch) el('pdfParseStatus').textContent = `Parse failed: ${error.message}`; }
      finally { if (mine === epoch) { busy = false; el('parsePdfButton').disabled = false; el('aiLoadingSpinner').hidden = true; if (review()) controls(); } }
    };
    const modal = el('pdfReviewModal');
    modal.oninput = (event) => {
      if (!review() || busy || review().pending || event.target.id === 'reviewApproval') return;
      review().card = getCard(); persist(); el('reviewApproval').checked = false; validate(); status('Review edited. Save draft before publishing.'); controls();
    };
    modal.onchange = (event) => { if (event.target.id === 'reviewApproval') controls(); };
    el('reviewRatesTableBody').onclick = (event) => {
      if (!busy && !review()?.pending && event.target.closest('[data-action="delete-review"]')) { event.target.closest('tr').remove(); review().card = getCard(); persist(); validate(); controls(); }
    };
    el('addReviewRowButton').onclick = () => { const card = getCard(); card.rates.push({}); review().card = card; persist(); renderRows(card.rates); validate(); controls(); };
    el('saveReviewedRatesButton').onclick = save;
    el('publishReviewedRatesButton').onclick = () => publish(false);
    el('rollbackRateVersionButton').onclick = () => publish(true);
    el('retryRateReviewButton').onclick = sendPending;
    el('closeReviewModal').onclick = el('cancelReviewModal').onclick = close;
    el('loadRateDraftsButton').onclick = async () => {
      const started = epoch;
      try {
        const code = options.getState().bill.shipperCode;
        const result = await request(`/rate-cards/drafts?shipperCode=${encodeURIComponent(code)}`);
        el('rateDraftSelect').innerHTML = result.data.map((d) => `<option value="${esc(d._id)}">${esc(d.shipperCode)} draft ${esc(d._id.slice(-6))}, revision ${d.revision}</option>`).join('');
      } catch (error) { if (started === epoch) el('pdfParseStatus').textContent = error.message; }
    };
    el('openRateDraftButton').onclick = async () => {
      const started = epoch;
      try {
        if (review()?.pending) { display(); return; }
        const code = options.getState().bill.shipperCode; const draftId = el('rateDraftSelect').value; if (!draftId) return;
        const result = await request(`/rate-cards/drafts/${encodeURIComponent(draftId)}?shipperCode=${encodeURIComponent(code)}`);
        open(result.data.card); const r = review();
        r.saved = { id: result.data._id, revision: result.data.revision, content: JSON.stringify(result.data.card) };
        const book = await request(`/rate-cards/book?shipperCode=${encodeURIComponent(code)}`); r.book = book.data; r.bookRevision = book.data?.revision || 0;
        persist(); display();
      } catch (error) { if (started === epoch) el('pdfParseStatus').textContent = error.message; }
    };
  }
  window.addEventListener('courier:auth', (event) => { if (!event.detail) { epoch++; busy = false; for (const controller of controllers) controller.abort(); options = null; } });
  window.RateReview = { bind, open, close };
})();
