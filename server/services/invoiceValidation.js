const { createHash } = require('node:crypto');
class InvoiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function invalid(field) { throw new InvoiceError(400, 'INVALID_INVOICE', `Invalid invoice field: ${field}.`); }
function object(value, fields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) invalid(name);
  return value;
}
function text(value, name, max = 200, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || (required && !value.trim())) invalid(name);
  return value.trim();
}
function number(value, name, fallback, max = 1e12) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) invalid(name);
  return value;
}
function date(value, name, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid(name);
  return value;
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) invalid('requestId');
  return value;
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid('expectedVersion');
  return value;
}
const billText = ['businessName', 'courierBrand', 'businessAddress', 'mobileNo', 'sacCode', 'billTo', 'billAddress', 'gstNo', 'branchCode', 'shipperCode', 'invoiceNo'];
const billDates = ['invoiceDate', 'periodStart', 'periodEnd'];
function image(value, name) {
  if (value === '' || value === 'none' || value === 'assets/logo.png') return value;
  if (typeof value !== 'string' || value.length > 700000 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) invalid(name);
  return value;
}
function snapshot(value) {
  if (value === undefined) return undefined;
  object(value, ['bill', 'rates', 'totals'], 'snapshot');
  object(value.bill, [...billText, ...billDates, 'fuelPct', 'cgstPct', 'sgstPct', 'logoSrc', 'signatureSrc'], 'snapshot.bill');
  const bill = {};
  for (const key of billText) bill[key] = text(value.bill[key], `snapshot.bill.${key}`, 2000, ['businessName', 'billTo', 'invoiceNo', 'shipperCode'].includes(key));
  for (const key of billDates) bill[key] = date(value.bill[key], `snapshot.bill.${key}`);
  if (bill.periodStart > bill.periodEnd) invalid('snapshot.bill.periodEnd');
  for (const key of ['fuelPct', 'cgstPct', 'sgstPct']) bill[key] = number(value.bill[key], key, undefined, 1000);
  for (const key of ['logoSrc', 'signatureSrc']) bill[key] = image(value.bill[key] ?? '', key);
  if (!Array.isArray(value.rates) || value.rates.length > 1000) invalid('snapshot.rates');
  const rates = value.rates.map((rate) => {
    object(rate, ['id', 'client', 'destination', 'baseKg', 'baseRate', 'perKgRate'], 'snapshot.rate');
    return { id: text(rate.id, 'rate.id'), client: text(rate.client, 'rate.client', 200, true), destination: text(rate.destination, 'rate.destination', 200, true),
      baseKg: number(rate.baseKg, 'baseKg'), baseRate: number(rate.baseRate, 'baseRate'), perKgRate: number(rate.perKgRate, 'perKgRate') };
  });
  const keys = ['gross', 'fuel', 'subtotal', 'cgst', 'sgst', 'final'];
  object(value.totals, keys, 'snapshot.totals');
  return { bill, rates, totals: Object.fromEntries(keys.map((key) => [key, number(value.totals[key], `totals.${key}`)])) };
}
function validateInvoice(input) {
  object(input, ['requestId', 'expectedVersion', 'invoiceNumber', 'shipperCode', 'client', 'clientName', 'clientGst', 'invoiceDate', 'dueDate', 'shipments', 'subtotal', 'taxRate', 'taxAmount', 'totalAmount', 'status', 'notes', 'snapshot', 'correctionOf', 'correctionReason'], 'body');
  const id = requestId(input.requestId);
  const expectedVersion = version(input.expectedVersion);
  const invoiceNumber = text(input.invoiceNumber, 'invoiceNumber', 100, true).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 /_.-]*$/.test(invoiceNumber)) invalid('invoiceNumber');
  const status = input.status ?? 'DRAFT';
  if (!['DRAFT', 'GENERATED'].includes(status)) invalid('status');
  if (!Array.isArray(input.shipments) || input.shipments.length > 1000 || (status === 'GENERATED' && !input.shipments.length)) invalid('shipments');
  const shipments = input.shipments.map((item) => {
    object(item, ['id', 'awb', 'cno', 'bookingDate', 'date', 'origin', 'destination', 'receiverName', 'actualWeight', 'weight', 'chargedWeight', 'rate', 'amount', 'pcs', 'type', 'manualAmount', 'rateSnapshot'], 'shipments');
    if ((item.awb !== undefined && item.cno !== undefined) || (item.bookingDate !== undefined && item.date !== undefined) || (item.actualWeight !== undefined && item.weight !== undefined)) invalid('shipment aliases');
    const result = { sourceId: text(item.id, 'shipment.id'), awb: text(item.awb ?? item.cno, 'shipment.awb', 100, true),
      bookingDate: date(item.bookingDate ?? item.date, 'shipment.bookingDate'), origin: text(item.origin, 'shipment.origin'),
      destination: text(item.destination, 'shipment.destination'), receiverName: text(item.receiverName, 'shipment.receiverName'),
      actualWeight: number(item.actualWeight ?? item.weight, 'actualWeight', 0), chargedWeight: number(item.chargedWeight ?? item.actualWeight ?? item.weight, 'chargedWeight', 0),
      rate: number(item.rate, 'rate', 0), amount: number(item.amount, 'amount'), pcs: number(item.pcs, 'pcs', 1, 100000), type: text(item.type, 'shipment.type', 20),
      manualAmount: item.manualAmount === '' || item.manualAmount === undefined ? null : number(item.manualAmount, 'manualAmount') };
    if (!Number.isInteger(result.pcs) || result.pcs < 1) invalid('shipment.pcs');
    if (item.rateSnapshot !== undefined && item.rateSnapshot !== null) {
      object(item.rateSnapshot, ['baseKg', 'baseRate', 'perKgRate'], 'rateSnapshot');
      result.rateSnapshot = Object.fromEntries(['baseKg', 'baseRate', 'perKgRate'].map((key) => [key, number(item.rateSnapshot[key], `rateSnapshot.${key}`)]));
    }
    return result;
  });
  if (new Set(shipments.map((s) => s.awb)).size !== shipments.length) invalid('duplicate shipment.awb');
  // Compatibility only: retain the historical fallback arithmetic. This is NOT rate verification.
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const subtotal = number(input.subtotal, 'subtotal', shipments.reduce((sum, s) => sum + s.amount, 0));
  const taxRate = number(input.taxRate, 'taxRate', 18, 1000);
  const taxAmount = number(input.taxAmount, 'taxAmount', round(subtotal * taxRate / 100));
  const totalAmount = number(input.totalAmount, 'totalAmount', round(subtotal + taxAmount));
  for (const [name, value] of Object.entries({ subtotal, taxAmount, totalAmount })) number(value, name);
  const data = { invoiceNumber, shipperCode: text(input.shipperCode, 'shipperCode', 200, true).toUpperCase(),
    client: input.client ?? null, clientName: text(input.clientName, 'clientName'), clientGst: text(input.clientGst, 'clientGst', 100).toUpperCase(),
    invoiceDate: date(input.invoiceDate, 'invoiceDate'), dueDate: date(input.dueDate, 'dueDate', true), shipments,
    subtotal, taxRate, taxAmount, totalAmount, status, notes: text(input.notes, 'notes', 4000), snapshot: snapshot(input.snapshot),
    correctionOf: text(input.correctionOf, 'correctionOf', 100).toUpperCase(), correctionReason: text(input.correctionReason, 'correctionReason', 1000) };
  if (data.client !== null && (typeof data.client !== 'string' || !/^[a-f0-9]{24}$/i.test(data.client))) invalid('client');
  if (data.dueDate && data.dueDate < data.invoiceDate) invalid('dueDate');
  if (data.correctionOf && (!data.correctionReason || data.correctionOf === invoiceNumber)) invalid('correctionOf');
  if (data.snapshot && (data.snapshot.bill.invoiceNo.toUpperCase() !== invoiceNumber || data.snapshot.bill.shipperCode.toUpperCase() !== data.shipperCode ||
      data.snapshot.bill.invoiceDate !== data.invoiceDate || data.snapshot.bill.billTo !== data.clientName || data.snapshot.totals.subtotal !== subtotal || data.snapshot.totals.final !== totalAmount)) invalid('snapshot identity/totals');
  return { requestId: id, expectedVersion, data };
}
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function validateTransition(input) {
  object(input, ['requestId', 'expectedVersion', 'status', 'reason'], 'body');
  const result = { requestId: requestId(input.requestId), expectedVersion: version(input.expectedVersion), status: input.status, reason: text(input.reason, 'reason', 1000, true) };
  if (!['PAID', 'CANCELLED'].includes(result.status)) invalid('status');
  return result;
}
module.exports = { validateInvoice, validateTransition, fingerprint, InvoiceError, date };
