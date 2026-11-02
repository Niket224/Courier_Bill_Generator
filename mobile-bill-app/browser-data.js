(function (root, factory) {
  const value = factory(); if (typeof module === 'object' && module.exports) module.exports = value; else root.BrowserData = value;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const MAX = 8 * 1024 * 1024;
  const privateKey = k => k === 'courier-bill-app-v2' || /^(courier-bill-archive-|courier-rate-review-archive-|courier-invoice-transition-)/.test(k);
  function parse(text, limit = MAX) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > limit) throw new Error('Browser backup is too large.');
    return JSON.parse(text, (key, value) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key) || /^(password|passwordHash|adminPasswordHash|sessionSecret|csrfToken|accessToken|refreshToken|apiKey|mongoUri|SESSION_SECRET|ADMIN_PASSWORD_HASH|BROWSER_DRAFT_KEY|GEMINI_API_KEY|MONGO_URI)$/i.test(key)) throw new Error('Unsafe or secret fields are not permitted in browser backups.');
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite values are not supported.');
      return value;
    });
  }
  function state(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.bill || typeof value.bill !== 'object' || Array.isArray(value.bill) || !Array.isArray(value.rates) || !Array.isArray(value.shipments)) throw new Error('Backup needs bill, rates and shipments.');
    const fields = ['bill', 'rates', 'shipments', 'persistence', 'correctionOf', 'correctionReason', 'invoiceMetadata', 'rateReview'];
    if (Object.keys(value).some(k => !fields.includes(k)) || value.shipments.length > 1000 || value.rates.length > 10000) throw new Error('Unsupported browser draft fields or size.');
    if (!['businessName', 'billTo', 'shipperCode', 'invoiceNo', 'invoiceDate', 'periodStart', 'periodEnd'].every(k => typeof value.bill[k] === 'string')) throw new Error('Missing mandatory bill fields.');
    for (const k of ['persistence', 'invoiceMetadata', 'rateReview']) if (value[k] !== undefined && (!value[k] || typeof value[k] !== 'object' || Array.isArray(value[k]))) throw new Error('Invalid draft metadata.');
    for (const k of ['correctionOf', 'correctionReason']) if (value[k] !== undefined && typeof value[k] !== 'string') throw new Error('Invalid correction metadata.');
    if (value.rateReview?.pending && !['/rate-cards/drafts', '/rate-cards/publish', '/rate-cards/rollback'].includes(value.rateReview.pending.path)) throw new Error('Invalid pending review operation.');
    const numeric = v => (typeof v === 'number' || typeof v === 'string') && v !== '' && /^\d+(\.\d{1,6})?$/.test(String(v)) && Number(v) <= 1e9;
    for (const [key, v] of Object.entries(value.bill)) {
      if (typeof v !== 'string' && typeof v !== 'number') throw new Error('Invalid bill field.');
      if (['fuelPct', 'cgstPct', 'sgstPct', 'igstPct'].includes(key) && !numeric(v)) throw new Error('Invalid tax or fuel value.');
      if (['invoiceDate', 'periodStart', 'periodEnd'].includes(key) && v && (!/^\d{4}-\d\d-\d\d$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw new Error('Invalid bill date.');
      if (['logoSrc', 'signatureSrc'].includes(key) && v && !['none', 'assets/logo.png'].includes(v) && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) throw new Error('Unsafe image source.');
    }
    for (const row of value.rates) {
      if (!row || typeof row.id !== 'string' || typeof row.client !== 'string' || typeof row.destination !== 'string' || !['baseKg', 'perKgRate'].every(k => numeric(row[k])) || row.baseRate !== undefined && !numeric(row.baseRate)) throw new Error('Invalid rate structure.');
    }
    for (const row of value.shipments) {
      if (!row || typeof row.id !== 'string' || !['cno', 'destination', 'date'].every(k => typeof row[k] === 'string') || !numeric(row.weight) || !numeric(row.pcs) || !Number.isInteger(Number(row.pcs)) || Number(row.pcs) < 1 || row.manualAmount !== '' && row.manualAmount !== undefined && !numeric(row.manualAmount)) throw new Error('Invalid shipment structure.');
    }
    return value;
  }
  function importBackup(text) {
    const input = parse(text);
    if (input?.format === undefined) return { state: state(input), records: {}, legacy: true };
    if (input.format !== 'courier-browser-backup' || input.version !== 1 || typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt)) || !input.records || typeof input.records !== 'object' || Array.isArray(input.records)) throw new Error('Unsupported browser backup format.');
    state(input.state);
    for (const [key, raw] of Object.entries(input.records)) {
      if (!privateKey(key) || typeof raw !== 'string') throw new Error('Invalid browser archive entry.');
      const item = parse(raw);
      if (key === 'courier-bill-app-v2') state(item);
      else if (key.startsWith('courier-bill-archive-')) { if (!item.createdAt) throw new Error('Invalid archive date.'); state(item.state); }
      else if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid recovery record.');
    }
    return { state: input.state, records: input.records, legacy: false };
  }
  function exportBackup(value, records) {
    const output = { format: 'courier-browser-backup', version: 1, createdAt: new Date().toISOString(), state: value, records };
    importBackup(JSON.stringify(output)); return output;
  }
  return { parse, state, importBackup, exportBackup, privateKey, MAX };
});
