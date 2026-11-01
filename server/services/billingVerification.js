const Billing = require('../../mobile-bill-app/billing');
const { activeRates } = require('./rateCards');
const { InvoiceError } = require('./invoiceValidation');
async function calculate(data) {
  const config = data.tax || (data.snapshot ? {
    mode: data.snapshot.bill.taxMode || 'SPLIT', fuelPct: data.snapshot.bill.fuelPct,
    cgstPct: data.snapshot.bill.cgstPct, sgstPct: data.snapshot.bill.sgstPct, igstPct: data.snapshot.bill.igstPct ?? 0
  } : null);
  if (!config) throw new InvoiceError(400, 'TAX_CONFIGURATION_REQUIRED', 'Explicit tax settings or a billing snapshot are required for financial verification.');
  if (data.tax && data.snapshot) {
    const bill = data.snapshot.bill;
    if (data.tax.mode !== (bill.taxMode || 'SPLIT') || ['fuelPct', 'cgstPct', 'sgstPct', 'igstPct'].some((key) => Number(data.tax[key] || 0) !== Number(bill[key] || 0))) {
      throw new InvoiceError(400, 'INVALID_TAX_CONFIGURATION', 'Tax settings and the billing snapshot disagree.');
    }
  }
  const cards = (await activeRates(data.shipperCode)).filter((rate) => rate.targetType === 'CITY');
  const byDestination = new Map(cards.map((card) => [card.targetName, card]));
  const selected = [];
  const shipments = data.shipments.map((row) => {
    const manual = row.manualAmount !== null && row.manualAmount !== undefined && row.manualAmount !== '';
    const card = byDestination.get(row.destination.trim().toLowerCase());
    if (!manual && (!card || card.baseRate === undefined)) {
      throw new InvoiceError(422, 'RATE_REVIEW_REQUIRED', `Publish an explicit base-charge rate for destination ${row.destination} before finalizing.`);
    }
    const rate = !manual ? { baseKg: card.baseKg, baseRate: card.baseRate, perKgRate: card.perKgRate } : null;
    selected.push({ awb: row.awb, manualOverride: manual, rateId: manual ? null : String(card._id), rateRevision: manual ? null : card.revision ?? 0, rate });
    return { awb: row.awb, weight: row.actualWeight, pcs: row.pcs, manualAmount: row.manualAmount, rate };
  });
  try {
    const result = Billing.invoice({ shipments, tax: config });
    return { ...result, tax: config, appliedRates: selected, inputs: shipments };
  } catch (error) { throw new InvoiceError(400, 'INVALID_CALCULATION', error.message); }
}
function differences(data, result) {
  const mismatches = [];
  const compare = (field, supplied, expected) => {
    try { if (Billing.money(supplied, field) !== expected) mismatches.push({ field, supplied, expected: Billing.rupees(expected) }); }
    catch { mismatches.push({ field, supplied, expected: Billing.rupees(expected) }); }
  };
  data.shipments.forEach((row, index) => compare(`shipments[${index}].amount`, row.amount, result.lines[index].amountPaise));
  compare('subtotal', data.subtotal, result.paise.subtotal);
  compare('taxAmount', data.taxAmount, result.paise.cgst + result.paise.sgst + result.paise.igst);
  compare('totalAmount', data.totalAmount, result.paise.final);
  if (data.snapshot) {
    for (const key of ['gross', 'fuel', 'subtotal', 'cgst', 'sgst', 'igst', 'final']) compare(`snapshot.totals.${key}`, data.snapshot.totals[key] ?? 0, result.paise[key]);
  }
  // A supplied snapshot must describe the actual cards, not just total the same.
  result.appliedRates.forEach((applied, index) => {
      if (applied.manualOverride) return;
      const clientRate = data.shipments[index].rateSnapshot;
      const preview = data.snapshot?.rates.find((r) => r.destination.trim().toLowerCase() === data.shipments[index].destination.trim().toLowerCase() && r.client.trim().toUpperCase() === data.shipperCode);
      for (const key of ['baseKg', 'baseRate', 'perKgRate']) {
        if (((clientRate || data.snapshot) && clientRate?.[key] !== applied.rate[key]) || (data.snapshot && preview?.[key] !== applied.rate[key])) mismatches.push({ field: `shipments[${index}].rateSnapshot.${key}`, supplied: clientRate?.[key] ?? null, expected: applied.rate[key] });
      }
    });
  const expectedTaxRate = Billing.percentSum(result.tax.cgstPct, result.tax.sgstPct, result.tax.igstPct);
  try {
    if (Billing.decimal(data.taxRate, 'taxRate') !== Billing.decimal(expectedTaxRate, 'taxRate')) mismatches.push({ field: 'taxRate', supplied: data.taxRate, expected: expectedTaxRate });
  } catch { mismatches.push({ field: 'taxRate', supplied: data.taxRate, expected: expectedTaxRate }); }
  return mismatches;
}
async function verify(data) {
  const calculation = await calculate(data);
  const mismatches = differences(data, calculation);
  if (mismatches.length) {
    const error = new InvoiceError(422, 'CALCULATION_MISMATCH', 'Preview and server calculation disagree. Review the amounts and published rates; nothing was finalized.');
    error.reconciliation = { version: Billing.VERSION, mismatches, expected: calculation.totals };
    throw error;
  }
  return calculation;
}
module.exports = { calculate, verify, differences };
