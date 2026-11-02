const { test, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
const fixture = require('../fixtures/bill.json');
const { password } = require('../fixtures/auth.cjs');
const { basePlusExtraRegression: regression } = require('../fixtures/billing-golden.json');
let cookies;
test.beforeAll(async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4189' });
  const challenge = await (await client.get('/api/auth/csrf')).json();
  const login = await client.post('/api/auth/login', { headers: { 'X-CSRF-Token': challenge.csrfToken }, data: { username: 'test-admin', password } });
  expect(login.status()).toBe(200);
  cookies = (await client.storageState()).cookies;
  await client.dispose();
});
test.beforeEach(async ({ page, context }, info) => {
  await context.addCookies(cookies);
  const id = createHash('sha256').update(info.title + info.project.name).digest('hex').slice(0, 10).toUpperCase();
  const shipper = `CALC-${id}`;
  const data = structuredClone(fixture); data.bill.shipperCode = shipper; data.bill.invoiceNo = `CALC-${id}`;
  data.rates[0].client = shipper;
  data.rates.push({ id: 'second-rate', client: shipper, destination: 'RANCHI', baseKg: 2, baseRate: 60, perKgRate: 20 });
  await context.addInitScript((value) => {
    if (location.origin !== 'http://127.0.0.1:4187') return;
    if (!localStorage.getItem('courier-bill-app-v2.sealed-v1')) localStorage.setItem('courier-bill-app-v2', JSON.stringify(value));
    window.print = () => { const began = performance.now(); window.printCalls = (window.printCalls || 0) + 1; window.printedText = document.getElementById('invoicePaper').textContent; window.printCaptureMs = performance.now() - began; };
  }, data);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5000' && url.pathname.startsWith('/api/')) return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:4189${url.pathname}${url.search}` }) });
    return url.origin === 'http://127.0.0.1:4187' ? route.continue() : route.abort();
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
});
async function publish(page) {
  await page.locator('button[data-target="invoice"]').click();
  await page.locator('#publishRatesButton').click();
  await page.locator('#saveReviewedRatesButton').click();
  await expect(page.locator('#reviewStatus')).toContainText('Draft saved');
  await page.locator('#reviewApproval').check();
  await page.locator('#publishReviewedRatesButton').click();
  await expect(page.locator('#reviewStatus')).toContainText('Published version');
  await page.locator('#closeReviewModal').click();
  await expect(page.locator('#invoiceSaveMessage')).toContainText('Rates published');
}
async function finalize(page) {
  await page.locator('button[data-target="invoice"]').click();
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  await expect(page.locator('#invoiceSaveMessage')).toContainText('Server calculation verified');
  return page.evaluate(async () => (await (await window.CourierAuth.apiFetch(`${API_BASE}/invoices/${state.persistence.confirmed.id}`)).json()).data);
}
test('base-plus-extra regression: preview, published mapping, backend and historical print agree on Rs85, never Rs100', async ({ page }) => {
  await page.evaluate((card) => {
    state.rates = [{ ...state.rates[0], ...card }];
    Object.assign(state.bill, { taxMode: 'NONE', fuelPct: 0, cgstPct: 0, sgstPct: 0, igstPct: 0 });
    Object.assign(state.shipments[0], { pcs: 1, manualAmount: '' });
    saveState(); init(false);
  }, regression.card);
  await publish(page);
  // Exercise the separate API-to-browser mapping as well as the publication callback.
  const localRateId = await page.evaluate(() => state.rates[0].id);
  await page.locator('#loadPublishedRatesButton').click();
  await expect.poll(() => page.evaluate(() => state.rates[0].id)).not.toBe(localRateId);
  await expect.poll(() => page.evaluate(() => state.rates.map(({ baseKg, baseRate, perKgRate }) => ({ baseKg, baseRate, perKgRate })))).toEqual([regression.card]);
  await page.locator('button[data-target="entry"]').click();
  for (const row of regression.lines) {
    await page.locator('#shipmentList [data-field="weight"]').fill(String(row.weight));
    await expect(page.locator('.amount-pill')).toHaveText(`Rs ${row.rupees.toFixed(2)}`);
    await expect(page.locator('#summaryGross')).toHaveText(`Rs ${row.rupees.toFixed(2)}`);
    const result = await page.evaluate(async () => {
      const response = await window.CourierAuth.apiFetch(`${API_BASE}/invoices/calculate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...invoicePayload('GENERATED'), requestId: crypto.randomUUID(), expectedVersion: 0 })
      });
      return { status: response.status, body: await response.json() };
    });
    expect(result.status).toBe(200);
    expect(result.body.mismatches).toEqual([]);
    expect(result.body.calculation.lines[0].amountPaise).toBe(row.paise);
    expect(result.body.calculation.paise.fuel).toBe(0);
    expect(result.body.calculation.paise.cgst + result.body.calculation.paise.sgst + result.body.calculation.paise.igst).toBe(0);
  }
  await page.locator('#shipmentList [data-field="weight"]').fill('5');
  const original = await finalize(page);
  expect(original.shipments[0].amount).toBe(85);
  expect(original.shipments[0].amount).not.toBe(100);
  expect(original.calculationSnapshot.lines[0].amountPaise).toBe(8500);
  expect(original.calculationSnapshot.appliedRates[0].rate).toEqual(regression.card);
  expect(original.snapshot.totals.gross).toBe(85);
  // A later published price must not reprice the finalized record or its historical print.
  await page.locator('button[data-target="rates"]').click();
  await page.locator('#rateList [data-field="perKgRate"]').first().fill('99');
  await publish(page);
  await page.locator('button[data-target="history"]').click();
  const history = page.locator('.history-card').filter({ hasText: original.invoiceNumber });
  await history.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('#printButton').click();
  await expect.poll(() => page.evaluate(() => window.printCalls)).toBe(2);
  expect(await page.evaluate(() => window.printedText)).toContain('85.00');
  expect(await page.evaluate(async (id) => (await (await window.CourierAuth.apiFetch(`${API_BASE}/invoices/${id}`)).json()).data, original._id)).toEqual(original);
});

test('A: multiple destinations have explicit line amounts and a verified invoice total', async ({ page }) => {
  await page.locator('#addShipmentButton').click();
  const row = page.locator('.shipment-card').last();
  await row.locator('[data-field="cno"]').fill('TEST002');
  await row.locator('[data-field="destination"]').selectOption('RANCHI');
  await row.locator('[data-field="weight"]').fill('3.5');
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 191.16');
  await publish(page);
  const saved = await finalize(page);
  expect(saved.shipments.map((s) => s.amount)).toEqual([45, 90]); expect(saved.totalAmount).toBe(191.16);
});
test('B: fractional weight uses exact half-up paise rounding', async ({ page }) => {
  await page.locator('#shipmentList [data-field="weight"]').fill('3.333');
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 70.80');
  await publish(page);
  expect((await finalize(page)).shipments[0].amount).toBe(50);
});
test('C: rate edits recalculate locally and require explicit publication before finalizing', async ({ page }) => {
  await publish(page);
  await page.locator('button[data-target="rates"]').click();
  await page.locator('#rateList [data-field="baseRate"]').first().fill('50');
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 70.80');
  await page.locator('button[data-target="invoice"]').click();
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Failed to save');
  await expect(page.locator('#invoiceSaveMessage')).toContainText('disagree');
  await publish(page);
  expect((await finalize(page)).totalAmount).toBe(70.8);
});
test('D: rate changes after issuance never change the historical invoice', async ({ page }) => {
  await publish(page);
  const original = await finalize(page);
  await page.locator('button[data-target="rates"]').click();
  await page.locator('#rateList [data-field="baseRate"]').first().fill('99');
  await publish(page);
  const reloaded = await page.evaluate(async (id) => (await (await window.CourierAuth.apiFetch(`${API_BASE}/invoices/${id}`)).json()).data, original._id);
  expect(reloaded).toEqual(original);
  await page.locator('button[data-target="history"]').click();
  const card = page.locator('.history-card').filter({ hasText: original.invoiceNumber });
  await card.getByRole('button', { name: 'Open', exact: true }).click();
  await page.evaluate(() => { window.printedText = ''; });
  await page.locator('#printButton').click();
  await expect.poll(() => page.evaluate(() => window.printCalls)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.printedText)).toContain('63.72');
});
test('E: tampered preview total is blocked with server reconciliation', async ({ page, context }) => {
  await publish(page);
  await context.route('**/api/invoices/save', async (route) => {
    const body = route.request().postDataJSON(); body.totalAmount += 1; body.snapshot.totals.final += 1;
    const response = await route.fetch({ url: 'http://127.0.0.1:4189/api/invoices/save', postData: JSON.stringify(body) });
    expect(response.status()).toBe(422); return route.fulfill({ response });
  });
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveMessage')).toContainText('Expected total: Rs 63.72');
  expect(await page.evaluate(() => window.printCalls || 0)).toBe(0);
});
test('F: 100 synthetic shipments retain every line and printed total', async ({ page }, info) => {
  const renderMs = await page.evaluate(async () => { const began = performance.now(); state.shipments = Array.from({ length: 100 }, (_, i) => ({ ...state.shipments[0], id: `row-${i}`, cno: `TEST-${i}` })); saveState(); renderShipments(); renderAll(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return performance.now() - began; });
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 6372.00');
  await publish(page);
  const saved = await finalize(page);
  expect(saved.shipments).toHaveLength(100); expect(saved.totalAmount).toBe(6372);
  expect(await page.evaluate(() => window.printedText)).toContain('6372.00');
  // The mocked synchronous dialog has already returned and removed its print CSS state.
  // Reproduce only that authorized rendering interval after the real finalization assertions above.
  await page.evaluate(() => { if (!window.CourierAuth.isAuthenticated() || state.persistence.confirmed.status !== 'GENERATED') throw new Error('Confirmed authenticated final invoice required.'); document.body.classList.add('final-print'); });
  const pdfStarted = performance.now(); let pdf;
  try { pdf = await page.pdf({ format: 'A4', printBackground: true }); }
  finally { await page.evaluate(() => document.body.classList.remove('final-print')); }
  const pdfGenerationMs = performance.now() - pdfStarted;
  const pdfPages = (await require('../../server/node_modules/pdf-lib').PDFDocument.load(pdf)).getPageCount(); expect(pdfPages).toBeGreaterThan(1);
  const fs = require('node:fs/promises'); await fs.mkdir('outputs', { recursive: true });
  await fs.writeFile(`outputs/browser-performance-${info.project.name}.json`, JSON.stringify({ project: info.project.name, shipments: 100, samples: 1, renderAndTwoFramesMs: renderMs, printTextCaptureMs: await page.evaluate(() => window.printCaptureMs), pdfGenerationMs, pdfPages, pdfBytes: pdf.length, nativePrintDialogMeasured: false, scope: 'Synthetic Chromium rendering, print content and actual multipage PDF generation; not physical printing or hosted latency' }, null, 2));
});
test('G: backend unavailability retains draft and blocks verified final printing', async ({ page, context }) => {
  await publish(page);
  await context.route('**/api/invoices/save', (route) => route.abort('internetdisconnected'));
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Offline');
  expect(await page.evaluate(() => JSON.parse(window.DraftVault.getItem('courier-bill-app-v2')).shipments.length)).toBe(1);
  expect(await page.evaluate(() => window.printCalls || 0)).toBe(0);
});
test('H: manual override is the complete row total and is recorded explicitly', async ({ page }) => {
  await page.evaluate(() => { state.shipments[0].pcs = 2; state.shipments[0].manualAmount = '25.50'; saveState(); renderShipments(); renderAll(); });
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 36.10');
  await expect(page.locator('.amount-pill')).toContainText('(manual)');
  const saved = await finalize(page);
  expect(saved.shipments[0].manualAmount).toBe(25.5); expect(saved.calculationSnapshot.appliedRates[0].manualOverride).toBe(true);
});
test('I: authenticated calculation uses CSRF and supports explicit IGST settings', async ({ page }, info) => {
  await page.locator('.bill-details summary').click();
  await page.locator('#taxMode').selectOption('IGST');
  await page.locator('#igstPct').fill('18');
  await expect(page.locator('#cgstPct')).toHaveValue('0');
  await expect(page.locator('#sgstPct')).toHaveValue('0');
  await publish(page);
  const saved = await finalize(page);
  expect(saved.calculationSnapshot.paise.igst).toBe(972); expect(saved.calculationSnapshot.paise.cgst).toBe(0);
  expect(await page.evaluate(() => window.printedText)).toContain('IGST @ 18.00%');
  await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), `courier-phase3-${info.project.name}.png`) });
});
