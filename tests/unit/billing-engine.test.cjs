const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Billing = require('../../mobile-bill-app/billing');
const golden = require('../fixtures/billing-golden.json');
for (const row of golden.lines) test(`golden shipment: ${row.name}`, () => {
  assert.equal(Billing.shipment(row, golden.card).amountPaise, row.paise);
});
for (const row of golden.basePlusExtraRegression.lines) test(`base 3kg/Rs45 plus Rs20/kg: ${row.weight}kg ships for Rs${row.rupees} before fuel/GST`, () => {
  const result = Billing.shipment(row, golden.basePlusExtraRegression.card);
  assert.equal(result.amountPaise, row.paise);
  assert.equal(result.amount, row.rupees);
  if (row.weight === 5) {
    assert.equal(result.amountPaise, 8500);
    assert.notEqual(result.amountPaise, 10000, 'The base charge is Rs45, not baseKg * perKgRate.');
  }
});

test('golden invoice has independently specified gross, fuel, split taxes and words', () => {
  const input = { ...golden.invoice, shipments: golden.invoice.shipments.map((row) => ({ ...row, rate: golden.card })) };
  const result = Billing.invoice(input);
  assert.deepEqual(result.paise, golden.invoice.paise);
  assert.equal(result.amountWords, golden.invoice.words);
});
for (const [label, patch] of [['negative weight', { weight: -1 }], ['invalid weight', { weight: 'oops' }], ['blank weight', { weight: '' }], ['missing weight', { weight: undefined }],
  ['NaN', { weight: NaN }], ['Infinity', { weight: Infinity }], ['zero pieces', { pcs: 0 }], ['negative pieces', { pcs: -1 }],
  ['fractional pieces', { pcs: 1.5 }], ['negative override', { manualAmount: -1 }], ['invalid override', { manualAmount: 'no' }],
  ['null weight', { weight: null }], ['null pieces', { pcs: null }],
  ['sub-paise override', { manualAmount: '1.005' }], ['excess precision', { weight: '0.0000001' }], ['excessive value', { weight: 1e13 }]]) {
  test(`reject ${label}`, () => assert.throws(() => Billing.shipment({ weight: 1, pcs: 1, ...patch }, golden.card)));
}
test('missing rate and unknown destination selection cannot produce a normal charge', () => {
  assert.throws(() => Billing.shipment({ weight: 1, pcs: 1 }), /rate/);
});
test('zero base, zero extra rate and zero manual override are permitted', () => {
  assert.equal(Billing.shipment({ weight: 1, pcs: 1 }, { baseKg: 3, baseRate: 0, perKgRate: 15 }).amountPaise, 0);
  assert.equal(Billing.shipment({ weight: 9, pcs: 2 }, { baseKg: 3, baseRate: 45, perKgRate: 0 }).amountPaise, 9000);
  assert.equal(Billing.shipment({ weight: 1, pcs: 2, manualAmount: 0 }).amountPaise, 0);
});
test('half-up line rounding is exact, with no weight ceiling', () => {
  assert.equal(Billing.shipment({ weight: '3.333', pcs: 1 }, golden.card).amountPaise, 5000); // 49.995 -> 50.00
  assert.equal(Billing.shipment({ weight: '3.000001', pcs: 1 }, golden.card).amountPaise, 4500);
  assert.equal(Billing.shipment({ weight: 0, pcs: 1 }, { baseKg: 0, baseRate: '1.005', perKgRate: 0 }).amountPaise, 101);
});
test('zero fuel, fractional fuel and separately rounded taxes', () => {
  const lines = [{ amountPaise: 10001 }];
  assert.equal(Billing.components(lines, { mode: 'NONE', fuelPct: 0 }).paise.final, 10001);
  assert.deepEqual(Billing.components(lines, { fuelPct: 2.5, cgstPct: 9, sgstPct: 9 }).paise,
    { gross: 10001, fuel: 250, subtotal: 10251, cgst: 923, sgst: 923, igst: 0, final: 12097 });
});
test('IGST and explicit no-tax mode do not infer legal eligibility', () => {
  assert.equal(Billing.components([{ amountPaise: 10000 }], { mode: 'IGST', fuelPct: 20, igstPct: 18 }).paise.final, 14160);
  assert.equal(Billing.components([{ amountPaise: 10000 }], { mode: 'NONE', fuelPct: 20 }).paise.final, 12000);
  assert.throws(() => Billing.components([], { mode: 'IGST', cgstPct: 9, igstPct: 18 }));
  assert.throws(() => Billing.components([], { mode: 'NONE', sgstPct: 9 }));
  assert.throws(() => Billing.components([], { mode: null }));
  assert.throws(() => Billing.components([], { cgstPct: null }));
});
test('sum of rounded components exactly equals the final paise', () => {
  const result = Billing.components([{ amountPaise: 1 }], { cgstPct: 50, sgstPct: 50 }).paise;
  assert.deepEqual(result, { gross: 1, fuel: 0, subtotal: 1, cgst: 1, sgst: 1, igst: 0, final: 3 });
});
test('Indian words carry paise and handle large crore values', () => {
  assert.equal(Billing.words('1.999'), 'TWO');
  assert.equal(Billing.words('0.01'), 'ZERO AND ONE PAISE');
  assert.equal(Billing.words('12345678.90'), 'ONE CRORE TWENTY THREE LAKH FORTY FIVE THOUSAND SIX HUNDRED SEVENTY EIGHT AND NINETY PAISE');
  assert.equal(Billing.words('1000000000'), 'ONE HUNDRED CRORE');
});
test('duplicate tracking numbers and workload limit are enforced', () => {
  const row = { awb: 'A', weight: 1, pcs: 1, rate: golden.card };
  assert.throws(() => Billing.invoice({ shipments: [row, row], tax: {} }));
  assert.throws(() => Billing.invoice({ shipments: Array(1001).fill(row), tax: {} }));
});
test('1000 lines, repeated runs and browser-loaded module have exact parity', () => {
  const input = { shipments: Array.from({ length: 1000 }, (_, i) => ({ awb: String(i), weight: 1, pcs: 1, rate: golden.card })), tax: golden.invoice.tax };
  const server = Billing.invoice(input);
  assert.equal(server.paise.gross, 4500000); assert.equal(server.paise.final, 6372000);
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../mobile-bill-app/billing.js'), 'utf8'), context);
  assert.equal(JSON.stringify(context.window.CourierBilling.invoice(input)), JSON.stringify(server));
  assert.deepEqual(Billing.invoice(input), server);
});
test('rate changes cannot mutate an earlier pure result or input', () => {
  const input = { shipments: [{ awb: 'A', weight: 1, pcs: 1, rate: { ...golden.card } }], tax: {} };
  const result = Billing.invoice(input); input.shipments[0].rate.baseRate = 99;
  assert.equal(result.paise.final, 4500); assert.equal(Billing.invoice(input).paise.final, 9900);
});
test('large totals stay exact up to the explicit limit and overflow is rejected', () => {
  const input = { shipments: Array.from({ length: 1000 }, (_, i) => ({ awb: String(i), weight: 0, pcs: 1, rate: { baseKg: 0, baseRate: 1000000000, perKgRate: 0 } })), tax: { mode: 'NONE' } };
  assert.equal(Billing.invoice(input).paise.final, 100000000000000);
  assert.throws(() => Billing.invoice({ ...input, tax: { mode: 'NONE', fuelPct: 1 } }), /limit/);
});
