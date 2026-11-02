const { test, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { monthly, pattern, expected, expectedPaise } = require('../fixtures/monthly-acceptance.cjs');
const { password } = require('../fixtures/auth.cjs');
const { PDFDocument } = require('../../server/node_modules/pdf-lib');
let cookies;
test.beforeAll(async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4190' });
  const challenge = await (await client.get('/api/auth/csrf')).json();
  expect((await client.post('/api/auth/login', { headers: { 'X-CSRF-Token': challenge.csrfToken }, data: { username: 'test-admin', password } })).status()).toBe(200);
  cookies = (await client.storageState()).cookies; await client.dispose();
});
test.beforeEach(async ({ page, context }, info) => {
  await context.addCookies(cookies);
  const code = `ACC-${createHash('sha256').update(info.title + info.project.name).digest('hex').slice(0, 10).toUpperCase()}`;
  const value = monthly(code, info.project.name === 'desktop' ? 'AD' : 'AM');
  await context.addInitScript(value => {
    if (location.origin !== 'http://127.0.0.1:4187') return;
    if (!localStorage.getItem('courier-bill-app-v2.sealed-v1')) localStorage.setItem('courier-bill-app-v2', JSON.stringify(value));
    window.print = () => { window.printCalls = (window.printCalls || 0) + 1; window.printedText = document.getElementById('invoicePaper').textContent; };
  }, value);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5000' && url.pathname.startsWith('/api/')) return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:4190${url.pathname}${url.search}` }) });
    return url.origin === 'http://127.0.0.1:4187' ? route.continue() : route.abort();
  });
  page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? (dialog.message().startsWith('New invoice number') ? `${code}-CORR` : 'Synthetic acceptance reference') : undefined));
  await page.goto('/'); await expect(page.locator('.app-shell')).toBeVisible();
});
async function publish(page) {
  await page.locator('button[data-target="invoice"]').click(); await page.locator('#publishRatesButton').click();
  await page.locator('#saveReviewedRatesButton').click(); await expect(page.locator('#reviewStatus')).toContainText('Draft saved');
  await page.locator('#reviewApproval').check(); await page.locator('#publishReviewedRatesButton').click();
  await expect(page.locator('#reviewStatus')).toContainText('Published version'); await page.locator('#closeReviewModal').click();
}
async function detail(page, id) { return page.evaluate(async id => (await (await window.CourierAuth.apiFetch(`${API_BASE}/invoices/${encodeURIComponent(id)}`)).json()).data, id); }
async function capture(page, name, info) {
  const record = await page.evaluate(() => state.persistence.confirmed);
  expect(['GENERATED', 'PAID', 'CANCELLED']).toContain(record.status);
  await page.evaluate(() => { if (!window.CourierAuth.isAuthenticated()) throw new Error('Authentication required'); document.body.classList.add('final-print'); });
  await fs.mkdir('output/pdf', { recursive: true }); const file = path.resolve('output/pdf', `synthetic-${name}-${info.project.name}.pdf`);
  const began = performance.now(); let bytes;
  try { bytes = await page.pdf({ path: file, format: 'A4', preferCSSPageSize: true, printBackground: true }); }
  finally { await page.evaluate(() => document.body.classList.remove('final-print')); }
  const pdf = await PDFDocument.load(bytes); const pages = pdf.getPageCount();
  for (const p of pdf.getPages()) { expect(p.getWidth()).toBeCloseTo(595.28, 0); expect(p.getHeight()).toBeCloseTo(841.89, 0); }
  return { file: path.basename(file), pages, bytes: bytes.length, generationMs: performance.now() - began };
}
async function openHistory(page, id) {
  await page.locator('button[data-target="history"]').click();
  const actions = page.locator(`[data-invoice-id="${id}"]`); await expect(actions).toBeVisible(); await actions.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('#screen-invoice')).toHaveClass(/active/);
}
test('monthly cycle: golden totals, immutable history, correction/payment/search, changed rates and lost-response retry', async ({ page, context }, info) => {
  test.setTimeout(60000);
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 11449.69'); await publish(page);
  await page.locator('#saveDraftButton').click(); await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  const draft = await detail(page, await page.evaluate(() => state.persistence.confirmed.id)); expect(draft.status).toBe('DRAFT');
  await page.locator('#printButton').click(); await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  await expect.poll(() => page.evaluate(() => window.printCalls || 0)).toBe(1);
  const original = await detail(page, draft._id); expect(original.status).toBe('GENERATED');
  expect(original.calculationSnapshot.paise).toEqual(expectedPaise); expect(original.calculationSnapshot.totals).toEqual(expected);
  original.shipments.forEach((row, i) => expect(Math.round(row.amount * 100)).toBe(pattern[i % 4].expectedPaise));
  const rejected = await page.evaluate(async () => {
    try { const payload = invoicePayload('GENERATED'); payload.requestId = crypto.randomUUID(); payload.expectedVersion = state.persistence.confirmed.revision; await window.CourierAuth.apiFetch(`${API_BASE}/invoices/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return null; } catch (error) { return error.code; }
  }); expect(rejected).toBe('INVOICE_IMMUTABLE');
  const pdfs = [await capture(page, 'monthly-100', info)]; expect(pdfs[0].pages).toBe(3);
  await page.locator('#logoutButton').click(); await expect(page.locator('#loginPanel')).toBeVisible();
  expect(await page.evaluate(() => state)).toBeNull(); expect(await page.locator('body').textContent()).not.toContain('SYNTHETIC MONTHLY CUSTOMER');
  await page.locator('#loginUsername').fill('test-admin'); await page.locator('#loginPassword').fill(password); await page.locator('#loginButton').click(); await expect(page.locator('.app-shell')).toBeVisible();
  cookies = (await context.storageState()).cookies;
  await openHistory(page, original._id); await page.locator('button[data-target="history"]').click();
  await page.locator(`[data-invoice-id="${original._id}"]`).getByRole('button', { name: 'Create correction' }).click();
  await expect(page.locator('#screen-invoice')).toHaveClass(/active/); await expect(page.locator('#invoicePaper')).toContainText(`CORRECTION OF: ${original.invoiceNumber}`);
  await page.locator('#saveDraftButton').click(); await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  // A backend-unavailable response must retain the same encrypted finalization request.
  await context.route('**/api/invoices/save', route => route.fulfill({ status: 503, json: { success: false, code: 'DATABASE_UNAVAILABLE', error: 'Synthetic backend unavailable' } }));
  await page.locator('#printButton').click(); await expect(page.locator('#invoiceSaveState')).toHaveText('Failed to save');
  const retryId = await page.evaluate(() => state.persistence.pending.payload.requestId);
  await context.unroute('**/api/invoices/save');
  // Simulate a lost response after the real server has committed the correction.
  let requestId;
  await context.route('**/api/invoices/save', async route => { requestId = route.request().postDataJSON().requestId; expect((await route.fetch({ url: 'http://127.0.0.1:4190/api/invoices/save' })).ok()).toBe(true); await route.abort('connectionreset'); });
  await page.locator('#retrySaveButton').click(); await expect(page.locator('#invoiceSaveState')).toHaveText('Offline'); expect(requestId).toBe(retryId);
  await context.unroute('**/api/invoices/save'); await page.locator('#retrySaveButton').click(); await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  const correction = await detail(page, await page.evaluate(() => state.persistence.confirmed.id));
  expect(correction.correctionOf).toBe(original.invoiceNumber); expect(correction.totalAmount).toBe(11449.69);
  expect(correction.operations.filter(op => op.requestId === requestId)).toHaveLength(1);
  pdfs.push(await capture(page, 'correction-100', info));
  await page.locator('button[data-target="history"]').click();
  await page.locator(`[data-invoice-id="${original._id}"]`).getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.locator(`[data-invoice-id="${original._id}"]`).locator('..').locator('.badge-status')).toHaveText('PAID');
  const searches = await page.evaluate(async original => {
    const base = `${API_BASE}/invoices/search?shipperCode=${encodeURIComponent(original.shipperCode)}`;
    const filters = [`q=${original.shipments[0].awb}`, `q=${encodeURIComponent(original.clientName)}`, `invoiceNumber=${original.invoiceNumber}`, 'startDate=2026-01-01&endDate=2026-01-31&status=PAID'];
    return Promise.all(filters.map(async filter => (await (await window.CourierAuth.apiFetch(`${base}&${filter}`)).json()).data.map(row => ({ id: row._id, status: row.status }))));
  }, original); searches.forEach(rows => expect(rows.some(row => row.id === original._id)).toBe(true)); expect(searches.at(-1).every(row => row.status === 'PAID')).toBe(true);
  await page.locator('#historyStatus').selectOption('PAID'); await page.locator('#executeSearchButton').click(); await expect(page.locator('.badge-status').filter({ hasNotText: 'PAID' })).toHaveCount(0);
  await page.locator('#clearSearchButton').click(); await expect(page.locator('#historyStatus')).toHaveValue('');
  await openHistory(page, original._id);
  await page.evaluate(() => { state.rates.forEach(rate => { rate.baseRate += 50; }); saveState(); renderAll(); }); await publish(page);
  const after = await detail(page, original._id); expect(after.totalAmount).toBe(11449.69); expect(after.calculationSnapshot).toEqual(original.calculationSnapshot);
  await page.locator('button[data-target="history"]').click(); await page.locator(`[data-invoice-id="${correction._id}"]`).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator(`[data-invoice-id="${correction._id}"]`).locator('..').locator('.badge-status')).toHaveText('CANCELLED');
  await openHistory(page, correction._id); await page.locator('#printButton').click(); await expect(page.locator('#invoiceSaveMessage')).toContainText('Cancelled historical record confirmed');
  await expect(page.locator('#invoicePaper')).toContainText('CANCELLED - historical record'); pdfs.push(await capture(page, 'cancelled-100', info));
  await fs.mkdir('outputs', { recursive: true }); await fs.writeFile(`outputs/monthly-acceptance-${info.project.name}.json`, JSON.stringify({ result: 'PASS', expected, shipments: 100, scenarios: 16, correctionLinked: true, lostResponseReplayedExactlyOnce: true, pdfs }, null, 2));
});
test('single-page layout: long address/tracking and signature remain within the invoice', async ({ page }, info) => {
  await page.evaluate(() => {
    state.shipments = state.shipments.slice(0, 1); state.shipments[0].cno = 'SYNTHETIC-LONG-' + '1234567890'.repeat(8);
    state.bill.billAddress = 'Synthetic long address, Building 123, Industrial Estate, Test District. '.repeat(5) + 'POSTCODE' + '1'.repeat(50);
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 60; const ctx = canvas.getContext('2d'); ctx.strokeStyle = '#12343b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(10, 45); ctx.bezierCurveTo(60, -15, 80, 80, 180, 15); ctx.stroke(); state.bill.signatureSrc = canvas.toDataURL('image/png'); saveState(); init(false);
  });
  await publish(page); await page.locator('#printButton').click(); await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  expect((await detail(page, await page.evaluate(() => state.persistence.confirmed.id))).totalAmount).toBe(59.75);
  const layout = await page.evaluate(() => { const paper = document.getElementById('invoicePaper').getBoundingClientRect(); return { width: paper.width, scrollWidth: document.getElementById('invoicePaper').scrollWidth, signature: document.querySelector('.invoice-signature-img').naturalWidth }; });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1); expect(layout.signature).toBe(200);
  const pdf = await capture(page, 'single-long-fields', info); expect(pdf.pages).toBe(1);
  await fs.mkdir('outputs', { recursive: true }); await fs.writeFile(`outputs/print-layout-${info.project.name}.json`, JSON.stringify(pdf, null, 2));
});
test('historical amount words and customer content cannot inject executable HTML', async ({ page }) => {
  await page.evaluate(() => { state.bill.billTo = '<img src=x onerror="window.invoiceInjected=true">'; renderInvoice({ snapshot: { totals: totals() }, calculationSnapshot: { amountWords: '<img src=x onerror="window.wordsInjected=true">' } }); });
  await expect(page.locator('#invoicePaper img[src="x"]')).toHaveCount(0);
  await expect(page.locator('#invoicePaper')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.invoiceInjected || window.wordsInjected)).toBeUndefined();
});
test('static hosting denies sensitive source paths and malformed URLs without crashing', async ({ request }) => {
  for (const pathname of ['/.env', '/server/.env', '/.git/config', '/%2e%2e%2fserver/.env', '/%zz', '/backups/private.cbackup']) expect((await request.get(`http://127.0.0.1:4187${pathname}`)).status()).toBe(403);
  expect((await request.get('http://127.0.0.1:4187/')).status()).toBe(200);
});
test('expiry while opening historical data cannot repopulate private memory after logout', async ({ page, context }) => {
  const invoice = await detail(page, 'RECOVERY-GENERATED');
  await page.locator('button[data-target="history"]').click();
  await expect(page.locator(`[data-invoice-id="${invoice._id}"]`)).toBeVisible();
  await page.evaluate(async () => {
    await window.DraftVault.flush(); const flush = window.DraftVault.flush;
    window.DraftVault.flush = async () => { await flush(); window.archiveWaiting = true; await new Promise(resolve => { window.releaseHistoryArchive = resolve; }); };
  });
  await page.locator(`[data-invoice-id="${invoice._id}"]`).getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.archiveWaiting)).toBe(true);
  await context.route('**/api/ops/status', route => route.fulfill({ status: 401, json: { error: 'Synthetic expiry' } }));
  await page.evaluate(async () => { await window.CourierAuth.apiFetch(`${API_BASE}/ops/status`).catch(() => {}); });
  await expect(page.locator('#loginPanel')).toBeVisible();
  await page.evaluate(() => window.releaseHistoryArchive());
  await expect.poll(() => page.evaluate(() => historyActionBusy)).toBe(false);
  expect(await page.evaluate(() => state)).toBeNull(); expect(await page.evaluate(() => historicalRecord)).toBeNull();
  expect(await page.evaluate(() => window.DraftVault.isUnlocked())).toBe(false);
  expect(await page.locator('body').textContent()).not.toContain('Synthetic Customer');
});
