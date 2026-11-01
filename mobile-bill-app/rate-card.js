(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./billing') : root.CourierBilling);
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.RateCardContract = value;
})(typeof window === 'undefined' ? globalThis : window, (Billing) => {
  const FORMULA = 'BASE_PLUS_EXTRA_PER_KG';
  const TYPES = ['CITY', 'STATE', 'CUSTOM_ZONE', 'REGION', 'DEFAULT'];
  function fail(field) { const e = new Error(`Invalid rate-card field: ${field}.`); e.code = 'INVALID_RATE_CARD'; throw e; }
  function object(value, keys, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) fail(field);
  }
  function text(value, field, max = 2000) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(field);
    return value.trim();
  }
  function normalize(input, { allowUnresolved = false, extraction = false } = {}) {
    object(input, ['shipperCode', 'clientInfo', 'globalRules', 'rates'], 'body');
    const issues = [], warnings = [];
    const missing = (field) => { issues.push({ field, message: `${field} must be explicitly reviewed and completed.` }); return null; };
    function amount(value, field, optional = false) {
      if (value === undefined || value === null || value === '') return optional ? null : missing(field);
      if (extraction && typeof value !== 'number') fail(field);
      try {
        const exact = Billing.decimal(value, field);
        if (exact !== Billing.decimal(Number(value), field)) fail(field);
      } catch { fail(field); }
      return Number(value);
    }
    const shipperCode = text(input.shipperCode, 'shipperCode', 128).toUpperCase();
    if (!shipperCode) missing('shipperCode');
    const client = input.clientInfo ?? {};
    object(client, ['clientName', 'address', 'quotationDate'], 'clientInfo');
    const clientInfo = { clientName: text(client.clientName, 'clientName', 200), address: text(client.address, 'address'), quotationDate: text(client.quotationDate, 'quotationDate', 10) };
    if (clientInfo.quotationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(clientInfo.quotationDate) || !Number.isFinite(Date.parse(clientInfo.quotationDate)) || new Date(clientInfo.quotationDate).toISOString().slice(0, 10) !== clientInfo.quotationDate)) fail('quotationDate');
    const global = input.globalRules ?? {};
    object(global, ['minWeightKg', 'fuelSurchargePct', 'notes'], 'globalRules');
    const globalRules = { minWeightKg: amount(global.minWeightKg, 'minWeightKg', true), fuelSurchargePct: amount(global.fuelSurchargePct, 'fuelSurchargePct'), notes: text(global.notes, 'notes') };
    if (globalRules.fuelSurchargePct > 1000) fail('fuelSurchargePct');
    if (!Array.isArray(input.rates) || !input.rates.length || input.rates.length > 1000) fail('rates (1–1000 rows required)');
    const seen = new Set();
    const rates = input.rates.map((row, index) => {
      const at = `rates[${index}]`;
      object(row, ['targetName', 'targetType', 'baseKg', 'baseRate', 'perKgRate', 'formula', 'conditions'], at);
      const targetName = text(row.targetName, `${at}.targetName`, 200).toLowerCase();
      if (!targetName) missing(`${at}.targetName`);
      const targetType = row.targetType == null || row.targetType === '' ? missing(`${at}.targetType`) : row.targetType;
      if (targetType !== null && !TYPES.includes(targetType)) fail(`${at}.targetType`);
      const formula = row.formula == null || row.formula === '' ? missing(`${at}.formula`) : row.formula;
      if (formula !== null && formula !== FORMULA) fail(`${at}.formula (unsupported charging formula)`);
      const value = { targetName, targetType, baseKg: amount(row.baseKg, `${at}.baseKg`), baseRate: amount(row.baseRate, `${at}.baseRate`), perKgRate: amount(row.perKgRate, `${at}.perKgRate`), formula, conditions: text(row.conditions, `${at}.conditions`, 500) };
      const key = `${targetType}:${targetName}`;
      if (targetName && seen.has(key)) issues.push({ field: at, message: 'Duplicate destination/type; resolve both identical and conflicting rows.' });
      seen.add(key);
      if (globalRules.minWeightKg !== null && value.baseKg !== null && value.baseKg < globalRules.minWeightKg) issues.push({ field: `${at}.baseKg`, message: 'Base weight conflicts with the stated global minimum.' });
      return value;
    });
    if (rates.some((row) => row.targetType !== 'CITY')) warnings.push({ code: 'NON_EXACT_DESTINATIONS', message: 'Invoice verification uses CITY exact labels. Other types are quotation estimates; no geographic rules are inferred.' });
    if (globalRules.notes || rates.some((row) => row.conditions)) warnings.push({ code: 'SPECIAL_CONDITIONS', message: 'Special conditions are stored for review, not executed. Do not approve a card whose conditions change the supported formula.' });
    warnings.push({ code: 'FUEL_REFERENCE', message: 'Fuel is a reviewed reference. It does not silently replace the invoice fuel setting; review that setting separately.' });
    const card = { shipperCode, clientInfo, globalRules, rates };
    if (new TextEncoder().encode(JSON.stringify(card)).byteLength > 256 * 1024) fail('card size');
    if (!allowUnresolved && issues.length) { const e = new Error(issues.map((item) => item.message).join(' ')); e.code = 'UNRESOLVED_RATE_CARD'; e.issues = issues; throw e; }
    return { card, issues, warnings, complete: issues.length === 0 };
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > 256 * 1024) fail('provider response size');
    let input;
    try { input = JSON.parse(text); } catch { fail('provider JSON'); }
    return normalize(input, { allowUnresolved: true, extraction: true });
  }
  return { FORMULA, TYPES, normalize, parse };
});
