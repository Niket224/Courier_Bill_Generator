const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { validateInvoice, validateTransition } = require('../../server/services/invoiceValidation');
const adapter = require('../../mobile-bill-app/persistence');
test('Phase 2 canonical request hash remains byte-compatible', () => {
  const { fingerprint } = require('../../server/services/invoiceValidation');
  const input = { requestId: '11111111-1111-4111-8111-111111111111', expectedVersion: 0, invoiceNumber: 'LEGACY-HASH', shipperCode: 'TEST', invoiceDate: '2026-01-02', status: 'GENERATED', shipments: [{ awb: 'TEST-AWB', bookingDate: '2026-01-02', weight: 2, amount: 100 }] };
  // Independently captured from the committed Phase 2 validator before these changes.
  assert.equal(fingerprint({ action: 'SAVE', expectedVersion: 0, data: validateInvoice(input).data }), 'e0bf99cf4d9b693f78871c1ee4ce23a347677e8f73138a16dfa744863e0a2507');
});
const fixture = require('../fixtures/bill.json');
function valid(patch = {}) {
  return { requestId: randomUUID(), expectedVersion: 0, invoiceNumber: 'TEST-NEW', shipperCode: 'TEST', invoiceDate: '2026-01-02',
    status: 'GENERATED', shipments: [{ awb: 'TEST-AWB', bookingDate: '2026-01-02', amount: 100, weight: 2 }], ...patch };
}
test('invoice validator preserves legacy fallback arithmetic without claiming verification', () => {
  const { data } = validateInvoice(valid());
  assert.equal(data.subtotal, 100); assert.equal(data.taxAmount, 18); assert.equal(data.totalAmount, 118);
  const supplied = validateInvoice(valid({ subtotal: 123, taxAmount: 4, totalAmount: 127 }));
  assert.equal(supplied.data.totalAmount, 127); // caller amounts remain recorded, not repriced
});
test('strict invoice field, date, monetary and shipment validation', () => {
  for (const patch of [{ status: 'PAID' }, { status: 'invalid' }, { expectedVersion: -1 }, { requestId: 'unsafe' },
    { unexpected: true }, { invoiceDate: '2026-02-30' }, { invoiceDate: 'yesterday' }, { totalAmount: NaN }, { subtotal: Infinity },
    { totalAmount: -1 }, { totalAmount: '100' }, { taxRate: null }, { client: {} }, { shipments: 'invalid' }, { shipments: [] },
    { shipments: [null] }, { shipments: [{ awb: '', bookingDate: '2026-01-02', amount: 1 }] },
    { shipments: [{ awb: 'TEST', bookingDate: '2026-01-02', amount: 1, pcs: 1.5 }] },
    { shipments: [{ awb: 'TEST', cno: 'CONFLICT', bookingDate: '2026-01-02', amount: 1 }] },
    { dueDate: '2025-01-01' }, { correctionOf: 'TEST-NEW', correctionReason: 'self' }]) {
    assert.throws(() => validateInvoice(valid(patch)), /Invalid invoice field/);
  }
});
test('lifecycle validation requires version, request ID and reason', () => {
  assert.throws(() => validateTransition({ requestId: randomUUID(), expectedVersion: 1, status: 'PAID', reason: '' }));
  assert.throws(() => validateTransition({ requestId: randomUUID(), expectedVersion: 1, status: 'DRAFT', reason: 'bad transition' }));
  assert.equal(validateTransition({ requestId: randomUUID(), expectedVersion: 1, status: 'CANCELLED', reason: 'duplicate booking' }).status, 'CANCELLED');
});
test('browser payload preserves full snapshot, pieces, manual amount and selected rate', () => {
  const state = structuredClone(fixture);
  state.shipments[0].pcs = 2; state.shipments[0].manualAmount = '51.25';
  state.invoiceMetadata = { notes: 'Synthetic payment terms', dueDate: '2026-02-01' };
  state.shipments[0].chargedWeight = 3;
  const payload = adapter.payload(state, 'GENERATED', () => ({ status: 'manual', amount: 51.25 }), () => ({ gross: 51.25, fuel: 10.25, subtotal: 61.5, cgst: 5.54, sgst: 5.54, final: 72.58 }));
  assert.equal(payload.shipments[0].pcs, 2); assert.equal(payload.shipments[0].manualAmount, 51.25);
  assert.equal(payload.shipments[0].chargedWeight, 3); assert.equal(payload.notes, 'Synthetic payment terms'); assert.equal(payload.dueDate, '2026-02-01');
  assert.equal(payload.shipments[0].rateSnapshot.baseRate, 45); assert.equal(payload.snapshot.bill.businessName, 'Test Courier');
  const normalized = validateInvoice({ ...payload, requestId: randomUUID(), expectedVersion: 0 });
  assert.equal(normalized.data.snapshot.totals.fuel, 10.25);
});
test('browser refuses incomplete/invalid invoices before a request', () => {
  for (const mutate of [s => { s.shipments[0].cno = ''; }, s => { s.bill.invoiceDate = '2026-02-31'; },
    s => { s.shipments[0].weight = '-1'; }, s => { s.shipments[0].pcs = '1.5'; }, s => { s.shipments[0].manualAmount = 'NaN'; }]) {
    const state = structuredClone(fixture); mutate(state);
    assert.throws(() => adapter.payload(state, 'GENERATED', () => ({ status: 'ok', amount: 1 }), () => ({ final: 1 })));
  }
});
