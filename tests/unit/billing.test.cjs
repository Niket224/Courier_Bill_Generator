const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../fixtures/bill.json');
const { basePlusExtraRegression: regression } = require('../fixtures/billing-golden.json');

function browserLogic() {
  const context = vm.createContext({
    structuredClone, window: { BrowserData: require('../../mobile-bill-app/browser-data'), DraftVault: { getItem: () => JSON.stringify(fixture) }, CourierBilling: require('../../mobile-bill-app/billing'), location: { hostname: 'localhost' }, crypto: { randomUUID: () => 'test-id' }, addEventListener() {}, CourierAuth: { isAuthenticated: () => true } },
    localStorage: { getItem: () => JSON.stringify(fixture) },
    document: { getElementById: () => null, querySelector: () => null }
  });
  // Execute the actual legacy script, suppressing only its final DOM bootstrap.
  const source = fs.readFileSync(path.resolve(__dirname, '../../mobile-bill-app/app.js'), 'utf8');
  assert.ok(source.includes('if (window.CourierAuth.isAuthenticated()) activateWorkspace();'));
  vm.runInContext(source.replace('if (window.CourierAuth.isAuthenticated()) activateWorkspace();', ''), context);
  vm.runInContext('state = loadState();', context);
  return (expression) => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

test('base charge, excess kilograms, pieces, and normalized rate lookup', () => {
  const run = browserLogic();
  assert.equal(run('calculateShipment(state.shipments[0]).amount'), 45);
  assert.equal(run('calculateShipment({...state.shipments[0], destination: " patna ", weight: 4.5, pcs: 2}).amount'), 135);
});
for (const row of regression.lines) test(`actual frontend preview: ${row.weight}kg has Rs${row.rupees} shipping before fuel/GST`, () => {
  const run = browserLogic();
  run(`Object.assign(state.rates[0], ${JSON.stringify(regression.card)})`);
  const result = run(`calculateShipment({...state.shipments[0], weight: ${row.weight}, pcs: 1, manualAmount: ''})`);
  assert.deepEqual(result, { amount: row.rupees, status: 'ok' });
  if (row.weight === 5) assert.notEqual(result.amount, 100);
});

test('manual amount and missing-rate status', () => {
  const run = browserLogic();
  assert.deepEqual(run('calculateShipment({...state.shipments[0], manualAmount: "25.50"})'), { amount: 25.5, status: 'manual' });
  assert.deepEqual(run('calculateShipment({...state.shipments[0], destination: "UNKNOWN"})'), { amount: 0, status: 'missing' });
});
test('fuel and split GST are applied to the expected bases', () => {
  assert.deepEqual(browserLogic()('totals()'), { gross: 45, fuel: 9, subtotal: 54, cgst: 4.86, sgst: 4.86, final: 63.72 });
});
test('bulk input and invoice numbering', () => {
  const run = browserLogic();
  assert.equal(run('nextInvoiceNo("100/2026")'), '101/2026');
  const rows = run('parseBulkShipments("TEST002,02/01/2026,PATNA,D,2,4.5")');
  assert.equal(rows[0].date, '2026-01-02');
  assert.equal(rows[0].cno, 'TEST002');
  assert.equal(run('numberToWordsIndian(123.45)'), 'ONE HUNDRED TWENTY THREE AND FORTY FIVE PAISE');
});
test('imported image sources and HTML attributes cannot inject executable markup', () => {
  const run = browserLogic();
  assert.equal(run('safeImageSource("assets/logo.png")'), 'assets/logo.png');
  assert.equal(run('safeImageSource("data:image/png;base64,YQ==")'), 'data:image/png;base64,YQ==');
  assert.equal(run('safeImageSource("javascript:alert(1)")'), '');
  assert.equal(run('safeImageSource("https://external.example/image.png")'), '');
  assert.equal(run('escapeHtml(\'" onerror="alert(1)\')'), '&quot; onerror=&quot;alert(1)');
  assert.equal(run('formatDate("2026-01-02")'), '02/01/2026');
  assert.equal(run('formatDate("2026-01-<img src=x>")'), '');
});
