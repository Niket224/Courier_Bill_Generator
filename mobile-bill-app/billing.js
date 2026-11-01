(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourierBilling = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  'use strict';
  const VERSION = 'courier-v1';
  const SCALE = 1000000n;
  const MAX = 100000000000000n; // paise: Rs 1 trillion, within exact JSON integer range
  function fail(field, code = 'INVALID_CALCULATION') { const e = new Error(`Invalid ${field}.`); e.code = code; throw e; }
  function decimal(value, field) {
    if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) fail(field);
    const text = String(value).trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(text) || text.length > 24) fail(field);
    const [whole, fraction = ''] = text.split('.');
    const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
    if (result > 1000000000000n * SCALE) fail(field);
    return result;
  }
  function round(numerator, denominator) { return (numerator * 2n + denominator) / (denominator * 2n); }
  function checked(paise) { if (paise < 0n || paise > MAX) fail('amount limit'); return Number(paise); }
  function money(value, field = 'amount') {
    const parsed = decimal(value, field);
    if (parsed % 10000n !== 0n) fail(`${field} (whole paise required)`);
    return checked(parsed / 10000n);
  }
  function rupees(paise) { return checked(BigInt(paise)) / 100; }
  function rate(input) {
    if (!input) fail('shipment rate', 'MISSING_RATE');
    return { baseKg: decimal(input.baseKg, 'base weight'), baseRate: decimal(input.baseRate, 'base charge'), perKgRate: decimal(input.perKgRate, 'extra-weight rate') };
  }
  function shipment(input, card, options = {}) {
    const weight = decimal(input.weight, 'weight');
    const pcs = decimal(input.pcs === undefined ? 1 : input.pcs, 'pieces');
    if (pcs % SCALE || pcs < SCALE || pcs > 100000n * SCALE) fail('pieces');
    if (input.manualAmount !== undefined && input.manualAmount !== null && input.manualAmount !== '') {
      const amountPaise = money(input.manualAmount, 'manual override');
      return { amountPaise, amount: rupees(amountPaise), status: 'manual', manualOverride: true };
    }
    if (!card) fail('shipment rate', 'MISSING_RATE');
    const r = options.legacyBase ? { baseKg: decimal(card.baseKg, 'base weight'), perKgRate: decimal(card.perKgRate, 'extra-weight rate') } : rate(card);
    const extra = weight > r.baseKg ? weight - r.baseKg : 0n;
    const base = options.legacyBase ? r.baseKg * r.perKgRate : r.baseRate * SCALE;
    const amountPaise = checked(round((base + extra * r.perKgRate) * (pcs / SCALE) * 100n, SCALE * SCALE));
    return { amountPaise, amount: rupees(amountPaise), status: 'ok', manualOverride: false };
  }
  function taxes(input = {}) {
    const mode = input.mode === undefined ? 'SPLIT' : input.mode;
    if (!['SPLIT', 'IGST', 'NONE'].includes(mode)) fail('tax mode');
    const out = { mode };
    for (const key of ['fuelPct', 'cgstPct', 'sgstPct', 'igstPct']) {
      const value = decimal(input[key] === undefined ? 0 : input[key], key);
      if (value > 1000n * SCALE) fail(key);
      out[key] = value;
    }
    if ((mode === 'SPLIT' && out.igstPct !== 0n) || (mode === 'IGST' && (out.cgstPct || out.sgstPct)) ||
        (mode === 'NONE' && (out.cgstPct || out.sgstPct || out.igstPct))) fail('mutually exclusive tax components');
    return out;
  }
  function components(lines, config) {
    const t = taxes(config);
    const gross = lines.reduce((sum, row) => sum + BigInt(row.amountPaise), 0n);
    const fuel = round(gross * t.fuelPct, 100n * SCALE);
    const subtotal = gross + fuel;
    const cgst = round(subtotal * t.cgstPct, 100n * SCALE);
    const sgst = round(subtotal * t.sgstPct, 100n * SCALE);
    const igst = round(subtotal * t.igstPct, 100n * SCALE);
    const paise = Object.fromEntries(Object.entries({ gross, fuel, subtotal, cgst, sgst, igst, final: subtotal + cgst + sgst + igst }).map(([key, value]) => [key, checked(value)]));
    return { paise, totals: Object.fromEntries(Object.entries(paise).map(([key, value]) => [key, rupees(value)])) };
  }
  function invoice(input) {
    if (!Array.isArray(input.shipments) || input.shipments.length > 1000) fail('shipment count');
    const seen = new Set();
    const lines = input.shipments.map((row) => {
      const awb = String(row.awb ?? '').trim();
      if (!awb || seen.has(awb)) fail('duplicate or missing tracking number');
      seen.add(awb);
      return { awb, ...shipment(row, row.rate) };
    });
    const result = components(lines, input.tax);
    return { version: VERSION, lines, ...result, amountWords: wordsPaise(result.paise.final) };
  }
  function wordsPaise(value) {
    const n = BigInt(checked(BigInt(value)));
    const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
    const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
    function convert(num) {
      if (!num) return 'ZERO';
      if (num < 20n) return ones[Number(num)];
      if (num < 100n) return [tens[Number(num / 10n)], num % 10n ? ones[Number(num % 10n)] : ''].filter(Boolean).join(' ');
      for (const [unit, name] of [[10000000n, 'CRORE'], [100000n, 'LAKH'], [1000n, 'THOUSAND'], [100n, 'HUNDRED']]) {
        if (num >= unit) return `${convert(num / unit)} ${name}${num % unit ? ' ' + convert(num % unit) : ''}`;
      }
    }
    return `${convert(n / 100n)}${n % 100n ? ` AND ${convert(n % 100n)} PAISE` : ''}`;
  }
  function words(value) { return wordsPaise(checked(round(decimal(value, 'amount in words'), 10000n))); }
  function percentSum(...values) { return Number(values.reduce((sum, value) => sum + decimal(value ?? 0, 'percentage'), 0n)) / Number(SCALE); }
  return { VERSION, decimal, money, rupees, rate, shipment, components, invoice, words, wordsPaise, percentSum };
});
