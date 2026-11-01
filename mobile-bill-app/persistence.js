// The same pure input adapter runs in browser and characterization tests.
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.InvoicePersistence = value;
})(typeof window === 'undefined' ? globalThis : window, () => {
  function numeric(value, name) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`Enter a valid ${name}.`);
    return Number(value);
  }
  function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
  function payload(state, status, calculate, totals) {
    if (!state || !['DRAFT', 'GENERATED'].includes(status)) throw new Error('Sign in and open a draft first.');
    const bill = { ...state.bill };
    for (const key of ['businessName', 'billTo', 'shipperCode', 'invoiceNo']) if (typeof bill[key] !== 'string' || !bill[key].trim()) throw new Error(`Complete ${key} before saving.`);
    for (const key of ['invoiceDate', 'periodStart', 'periodEnd']) if (!validDate(bill[key])) throw new Error(`Enter a valid ${key}.`);
    if (bill.periodStart > bill.periodEnd) throw new Error('Billing period end must follow its start.');
    const dueDate = state.invoiceMetadata?.dueDate;
    if (dueDate && (!validDate(dueDate) || dueDate < bill.invoiceDate)) throw new Error('Due date must be a valid date on or after the invoice date.');
    for (const key of ['fuelPct', 'cgstPct', 'sgstPct']) bill[key] = numeric(bill[key], key);
    const rates = state.rates.filter((r) => String(r.client).trim().toUpperCase() === bill.shipperCode.trim().toUpperCase()).map((rate) => ({
      id: String(rate.id), client: String(rate.client), destination: String(rate.destination),
      baseKg: numeric(rate.baseKg, 'base kg'), baseRate: numeric(rate.baseRate, 'base rate'), perKgRate: numeric(rate.perKgRate, 'per kg rate')
    }));
    if (status === 'GENERATED' && !state.shipments.length) throw new Error('Add at least one complete shipment before final printing.');
    const shipments = state.shipments.map((shipment) => {
      if (!String(shipment.cno || '').trim() || !String(shipment.destination || '').trim() || !validDate(shipment.date)) throw new Error('Every shipment needs a C/NO, destination and valid date.');
      const weight = numeric(shipment.weight, 'shipment weight');
      const pcs = numeric(shipment.pcs, 'pieces');
      if (!Number.isInteger(pcs) || pcs < 1) throw new Error('Pieces must be a positive whole number.');
      const manualAmount = shipment.manualAmount === '' || shipment.manualAmount === undefined ? '' : numeric(shipment.manualAmount, 'manual amount');
      const result = calculate(shipment);
      if (result.status === 'missing') throw new Error('A shipment rate is missing. Fix rates before saving or printing.');
      const rate = rates.find((r) => r.destination.trim().toUpperCase() === String(shipment.destination).trim().toUpperCase());
      return { id: String(shipment.id), awb: String(shipment.cno).trim(), bookingDate: shipment.date,
        destination: String(shipment.destination), origin: shipment.origin || '', receiverName: shipment.receiverName || '',
        actualWeight: weight, chargedWeight: shipment.chargedWeight === undefined ? weight : numeric(shipment.chargedWeight, 'charged weight'), pcs, type: shipment.type || 'D', manualAmount,
        rate: shipment.rate === undefined ? (rate?.perKgRate ?? 0) : numeric(shipment.rate, 'recorded rate'), rateSnapshot: rate ? { baseKg: rate.baseKg, baseRate: rate.baseRate, perKgRate: rate.perKgRate } : null,
        amount: numeric(result.amount, 'shipment amount') };
    });
    if (new Set(shipments.map((s) => s.awb)).size !== shipments.length) throw new Error('Duplicate C/NO values must be corrected.');
    const summary = totals();
    for (const [name, amount] of Object.entries(summary)) numeric(amount, name);
    return { invoiceNumber: bill.invoiceNo.trim().toUpperCase(), shipperCode: bill.shipperCode.trim().toUpperCase(), clientName: bill.billTo,
      clientGst: bill.gstNo, invoiceDate: bill.invoiceDate, shipments, subtotal: summary.subtotal,
      taxRate: bill.cgstPct + bill.sgstPct, taxAmount: summary.cgst + summary.sgst, totalAmount: summary.final, status,
      client: state.invoiceMetadata?.client ?? null, notes: state.invoiceMetadata?.notes || '', dueDate: state.invoiceMetadata?.dueDate || undefined,
      snapshot: { bill, rates, totals: summary }, correctionOf: state.correctionOf || '', correctionReason: state.correctionReason || '' };
  }
  function content(value) { const { status, requestId, expectedVersion, ...rest } = value; return JSON.stringify(rest); }
  return { payload, content, validDate };
});
