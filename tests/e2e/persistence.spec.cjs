const { test, expect } = require('@playwright/test');
const fixture = require('../fixtures/bill.json');
function receipt(payload) {
  return { success: true, operationVersion: payload.expectedVersion + 1, data: {
    ...payload, _id: 'a'.repeat(24), revision: payload.expectedVersion + 1,
    operations: [{ requestId: payload.requestId }], totalsVerified: false
  } };
}
test.beforeEach(async ({ context }) => {
  await context.addInitScript((data) => {
    if (!localStorage.getItem('courier-bill-app-v2')) localStorage.setItem('courier-bill-app-v2', JSON.stringify(data));
    window.print = () => { window.printCalls = (window.printCalls || 0) + 1; };
  }, fixture);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { authenticated: true, csrfToken: 'a'.repeat(64), expiresAt: Date.now() + 600000 } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, data: [] } });
    return url.origin === 'http://127.0.0.1:4187' ? route.continue() : route.abort();
  });
});
async function open(page) {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('button[data-target="invoice"]').click();
}
for (const [label, status, body] of [
  ['backend rejection', 400, { success: false, error: 'Invalid invoice.' }],
  ['disconnected database', 503, { success: false, error: 'Invoice storage is unavailable.' }],
  ['HTTP 200 success:false', 200, { success: false }],
  ['missing CSRF token', 403, { success: false, error: 'Security check failed.' }]
]) {
  test(`${label} preserves draft and prevents final printing`, async ({ page }) => {
    await page.route('**/api/invoices/save', (route) => route.fulfill({ status, json: body }));
    await open(page);
    await page.locator('#printButton').click();
    await expect(page.locator('#invoiceSaveState')).toHaveText('Failed to save');
    expect(await page.evaluate(() => window.printCalls || 0)).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('courier-bill-app-v2')).shipments[0].cno)).toBe('TEST001');
  });
}
test('duplicate save clicks share one request and printing waits for confirmation', async ({ page }) => {
  let pending, calls = 0;
  await page.route('**/api/invoices/save', (route) => { calls++; pending = route; });
  await open(page);
  await page.evaluate(() => { printInvoice(); printInvoice(); });
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saving');
  await expect.poll(() => calls).toBe(1);
  expect(await page.evaluate(() => window.printCalls || 0)).toBe(0);
  const payload = pending.request().postDataJSON();
  expect(pending.request().headers()['x-csrf-token']).toBe('a'.repeat(64));
  await pending.fulfill({ status: 201, json: receipt(payload) });
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  await expect.poll(() => page.evaluate(() => window.printCalls)).toBe(1);
});
test('timeout is explicit and retains a stable retry request', async ({ page }) => {
  await page.clock.install();
  let pending;
  await page.route('**/api/invoices/save', (route) => { pending = route; });
  await open(page);
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saving');
  await expect.poll(() => !!pending).toBe(true);
  await page.clock.fastForward(16000);
  await expect(page.locator('#invoiceSaveState')).toHaveText('Failed to save');
  await expect(page.locator('#invoiceSaveMessage')).toContainText('timed out');
  expect(await page.evaluate(() => !!JSON.parse(localStorage.getItem('courier-bill-app-v2')).persistence.pending.payload.requestId)).toBe(true);
  expect(await page.evaluate(() => window.printCalls || 0)).toBe(0);
  await pending.abort().catch(() => {});
});
test('offline retry survives refresh and never changes the original request ID', async ({ page }) => {
  const payloads = [];
  await page.route('**/api/invoices/save', (route) => {
    payloads.push(route.request().postDataJSON());
    return payloads.length === 1 ? route.abort('internetdisconnected') : route.fulfill({ status: 200, json: receipt(payloads[0]) });
  });
  await open(page);
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Offline');
  await page.reload();
  await page.locator('button[data-target="invoice"]').click();
  expect(payloads.length).toBe(1); // no automatic retry on reload
  await page.locator('#retrySaveButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  expect(payloads[1]).toEqual(payloads[0]);
  expect(await page.evaluate(() => window.printCalls || 0)).toBe(0); // retry confirms; user explicitly prints afterwards
});
test('refresh preserves unsaved edits and New Bill archives the old work', async ({ page }) => {
  await open(page);
  await page.locator('button[data-target="entry"]').click();
  await page.locator('#shipmentList input[data-field="weight"]').fill('4.5');
  await page.reload();
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 95.58');
  await page.locator('button[data-target="invoice"]').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Unsaved');
  await page.locator('button[data-target="entry"]').click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#newBillButton').click();
  await expect(page.locator('.shipment-card')).toHaveCount(0);
  const archive = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('courier-bill-archive-')))));
  expect(archive.state.shipments[0].weight).toBe('4.5'); expect(archive.state.bill.invoiceNo).toBe('100/2026');
  await page.locator('button[data-target="tools"]').click();
  await page.locator('#restoreArchiveButton').click();
  await expect(page.locator('#invoicePaper')).toContainText('TEST001');
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 95.58');
});
test('session expiry during save clears private DOM and keeps the retry draft', async ({ page }) => {
  await page.route('**/api/invoices/save', (route) => route.fulfill({ status: 401, json: { error: 'Please sign in again.' } }));
  await open(page);
  await page.locator('#printButton').click();
  await expect(page.locator('#loginPanel')).toBeVisible();
  await expect(page.locator('#invoicePaper')).toBeEmpty();
  expect(await page.evaluate(() => state)).toBeNull();
  expect(await page.evaluate(() => document.body.textContent.includes('TEST001'))).toBe(false);
  expect(await page.evaluate(() => !!JSON.parse(localStorage.getItem('courier-bill-app-v2')).persistence.pending)).toBe(true);
  expect(await page.evaluate(() => window.printCalls || 0)).toBe(0);
});
test('logout removes draft and open review data from DOM, not just navigation', async ({ page }) => {
  await open(page);
  await page.evaluate(() => openReviewModal({ clientInfo: { clientName: 'Private synthetic name' }, rates: [] }));
  await page.locator('#closeReviewModal').click();
  await page.locator('#logoutButton').click();
  await expect(page.locator('#loginPanel')).toBeVisible();
  await expect(page.locator('#reviewClientName')).toHaveValue('');
  await expect(page.locator('#invoicePaper')).toBeEmpty();
  expect(await page.evaluate(() => state)).toBeNull();
  await page.evaluate(() => { document.querySelector('.app-shell').hidden = false; });
  expect(await page.evaluate(() => document.body.textContent.includes('TEST001'))).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('courier-bill-app-v2')).shipments[0].cno)).toBe('TEST001');
});
test('incomplete invoice validation blocks requests and final printing', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/invoices/save', (route) => { calls++; return route.abort(); });
  await open(page);
  await page.evaluate(() => { state.shipments[0].cno = ''; });
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Failed to save');
  expect(calls).toBe(0); expect(await page.evaluate(() => window.printCalls || 0)).toBe(0);
});
test('unauthenticated initial page never loads private browser draft into state or DOM', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({ status: 401, json: { error: 'Sign in' } }));
  await page.goto('/');
  await expect(page.locator('#loginMessage')).toContainText('Sign in');
  expect(await page.evaluate(() => state)).toBeNull();
  await expect(page.locator('#invoicePaper')).toBeEmpty();
  expect(await page.evaluate(() => document.body.textContent.includes('Synthetic Customer'))).toBe(false);
});
test('a definitive rejection permits corrected data with a fresh request ID', async ({ page }) => {
  const inputs = [];
  await page.route('**/api/invoices/save', (route) => {
    const body = route.request().postDataJSON(); inputs.push(body);
    return inputs.length === 1 ? route.fulfill({ status: 409, json: { success: false, error: 'Invoice number already exists.' } }) : route.fulfill({ status: 201, json: receipt(body) });
  });
  await open(page);
  await page.locator('#saveDraftButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Failed to save');
  await page.evaluate(() => { state.bill.invoiceNo = 'CORRECTED-TEST'; saveState(); });
  await page.locator('#saveDraftButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  expect(inputs[1].requestId).not.toBe(inputs[0].requestId);
  expect(inputs[1].invoiceNumber).toBe('CORRECTED-TEST');
});
test('corrupt local draft is retained and offered for recovery after authentication', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('courier-bill-app-v2', '{synthetic-corrupt-draft'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Download draft for recovery' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('courier-bill-app-v2'))).toBe('{synthetic-corrupt-draft');
  expect(await page.evaluate(() => state)).toBeNull();
});
test('a cross-tab draft change archives this tab instead of silently overwriting the other draft', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'courier-bill-app-v2', newValue: '{"otherTab":true}' })));
  await expect(page.locator('#invoiceSaveState')).toHaveText('Failed to save');
  await expect(page.locator('#invoiceSaveMessage')).toContainText('Another tab');
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('courier-bill-archive-')))).toBe(true);
});
test('New Bill refuses to clear work when its recovery archive cannot be stored', async ({ page }) => {
  await open(page);
  await page.locator('button[data-target="entry"]').click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('courier-bill-archive-')) throw new DOMException('Full', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await page.locator('#newBillButton').click();
  await expect(page.locator('.shipment-card')).toHaveCount(1);
  expect(await page.evaluate(() => state.bill.invoiceNo)).toBe('100/2026');
});
test('a print-dialog error does not misreport a confirmed save as failed', async ({ page }) => {
  await page.route('**/api/invoices/save', (route) => route.fulfill({ status: 201, json: receipt(route.request().postDataJSON()) }));
  await open(page);
  await page.evaluate(() => { window.print = () => { throw new Error('Synthetic printer failure'); }; });
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  await expect(page.locator('#toast')).toContainText('print dialog could not open');
});
test('historical final printing uses recorded amounts rather than recalculating them', async ({ page }) => {
  const record = { _id: 'b'.repeat(24), invoiceNumber: 'HISTORY-TEST', shipperCode: 'TEST', clientName: 'Synthetic Customer', invoiceDate: '2026-01-01T00:00:00.000Z',
    schemaVersion: 2, revision: 1, status: 'GENERATED', totalAmount: 99, operations: [],
    snapshot: { bill: { ...fixture.bill, invoiceNo: 'HISTORY-TEST' }, rates: fixture.rates, totals: { gross: 45, fuel: 9, subtotal: 54, cgst: 4.86, sgst: 4.86, final: 99 } },
    shipments: [{ sourceId: 'shipment-test', awb: 'TEST001', bookingDate: '2026-01-02T00:00:00.000Z', destination: 'PATNA', actualWeight: 1, chargedWeight: 1, pcs: 1, type: 'D', amount: 45, rate: 15, manualAmount: null }] };
  await page.route('**/api/invoices/search?*', (route) => route.fulfill({ json: { success: true, data: [record] } }));
  await page.route(`**/api/invoices/${record._id}`, (route) => route.fulfill({ json: { success: true, data: record } }));
  await open(page);
  await page.locator('button[data-target="history"]').click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('#invoicePaper')).toContainText('99.00');
  await page.evaluate(() => { window.print = () => { window.printedText = document.getElementById('invoicePaper').textContent; }; });
  await page.locator('#printButton').click();
  await expect.poll(() => page.evaluate(() => window.printedText || '')).toContain('99.00');
});
test('legacy history can start an empty linked correction without fabricating missing shipments', async ({ page }) => {
  const record = { _id: 'b'.repeat(24), invoiceNumber: 'LEGACY-TEST', shipperCode: 'TEST', clientName: 'Synthetic Customer', invoiceDate: '2020-01-01', status: 'GENERATED', totalAmount: 100, shipments: [] };
  await page.route('**/api/invoices/search?*', (route) => route.fulfill({ json: { success: true, data: [record] } }));
  await page.route(`**/api/invoices/${record._id}`, (route) => route.fulfill({ json: { success: true, data: record } }));
  await open(page);
  await page.locator('button[data-target="history"]').click();
  page.on('dialog', (dialog) => dialog.accept(dialog.message().startsWith('New invoice number') ? 'NEW-LEGACY-CORRECTION' : 'Synthetic reason'));
  await page.getByRole('button', { name: 'Create correction', exact: true }).click();
  await expect(page.locator('#invoicePaper')).toContainText('NEW-LEGACY-CORRECTION');
  expect(await page.evaluate(() => state.correctionOf)).toBe('LEGACY-TEST');
  expect(await page.evaluate(() => state.shipments.length)).toBe(0);
});
