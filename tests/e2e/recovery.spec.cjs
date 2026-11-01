const { test, expect } = require('@playwright/test');
const fixture = require('../fixtures/bill.json');
const { password } = require('../fixtures/auth.cjs');
let cookies;
async function routeApi(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5000' && url.pathname.startsWith('/api/')) return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:4190${url.pathname}${url.search}` }) });
    return url.origin === 'http://127.0.0.1:4187' ? route.continue() : route.abort();
  });
}
test.beforeAll(async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4190' });
  const csrf = await (await client.get('/api/auth/csrf')).json();
  expect((await client.post('/api/auth/login', { headers: { 'X-CSRF-Token': csrf.csrfToken }, data: { username: 'test-admin', password } })).status()).toBe(200);
  cookies = (await client.storageState()).cookies; await client.dispose();
});
test.beforeEach(async ({ context, page }) => {
  await context.addCookies(cookies); await routeApi(context);
  await context.addInitScript(data => {
    if (location.origin !== 'http://127.0.0.1:4187') return;
    if (!sessionStorage.getItem('synthetic-seeded') && !localStorage.getItem('courier-bill-app-v2.sealed-v1')) localStorage.setItem('courier-bill-app-v2', JSON.stringify(data));
    sessionStorage.setItem('synthetic-seeded', 'true');
    window.print = () => { window.printed = document.getElementById('invoicePaper').textContent; };
  }, fixture);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/'); await expect(page.locator('.app-shell')).toBeVisible();
});
test('A/C: migrated drafts persist encrypted across refresh and are inaccessible after session expiry', async ({ page, context }) => {
  await page.locator('#shipmentList [data-field="weight"]').fill('4.5'); await page.evaluate(() => window.DraftVault.flush());
  const stored = await page.evaluate(() => JSON.stringify(localStorage)); expect(stored).not.toContain('Synthetic Customer'); expect(stored).not.toContain('TEST001');
  expect(await page.evaluate(() => localStorage.getItem('courier-bill-app-v2'))).toBeNull();
  await page.reload(); await expect(page.locator('#shipmentList [data-field="weight"]')).toHaveValue('4.5');
  await context.route('**/api/invoices/**', route => route.fulfill({ status: 401, json: { error: 'Session expired' } }));
  await page.locator('button[data-target="history"]').click(); await expect(page.locator('#loginPanel')).toBeVisible();
  expect(await page.evaluate(() => state)).toBeNull(); expect(await page.evaluate(() => window.DraftVault.isUnlocked())).toBe(false);
  expect(await page.evaluate(() => { try { window.DraftVault.getItem('courier-bill-app-v2'); return false; } catch { return true; } })).toBe(true);
  expect(await page.locator('body').textContent()).not.toContain('Synthetic Customer');
});
test('D: browser export imports into a clean authenticated profile with archive preview and confirmation', async ({ page, browser }) => {
  await page.locator('button[data-target="tools"]').click();
  const downloaded = page.waitForEvent('download'); await page.locator('#exportButton').click();
  const download = await downloaded, stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks); const exported = JSON.parse(bytes); expect(exported.format).toBe('courier-browser-backup'); expect(exported.version).toBe(1);
  const clean = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await clean.addCookies(cookies); await routeApi(clean); const target = await clean.newPage(); let preview;
    target.on('dialog', dialog => { preview = dialog.message(); return dialog.accept(); });
    await target.goto('http://127.0.0.1:4187/'); await expect(target.locator('.app-shell')).toBeVisible(); await target.locator('button[data-target="tools"]').click();
    await target.locator('#importInput').setInputFiles({ name: 'synthetic-browser.json', mimeType: 'application/json', buffer: bytes });
    await expect(target.locator('#toast')).toContainText('Browser import verified'); expect(preview).toContain('Import preview');
    expect(await target.evaluate(() => state.shipments[0].cno)).toBe('TEST001'); expect(await target.evaluate(() => JSON.stringify(localStorage))).not.toContain('Synthetic Customer');
  } finally { await clean.close(); }
});
test('E: malformed and unsafe imports keep the current working draft intact', async ({ page }) => {
  const original = await page.evaluate(() => JSON.stringify(state)); await page.locator('button[data-target="tools"]').click();
  for (const raw of ['{broken', '{"__proto__":{"polluted":true}}', '{"format":"courier-browser-backup","version":999}']) {
    await page.locator('#importInput').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
    await expect.poll(() => page.locator('#importInput').inputValue()).toBe('');
    expect(await page.evaluate(() => JSON.stringify(state))).toBe(original); expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
  }
});
test('F/G: after clearing browser data, restored MongoDB history prints the original financial snapshot', async ({ page }, info) => {
  await page.evaluate(async () => { await window.DraftVault.flush(); localStorage.clear(); });
  await page.reload(); await expect(page.locator('.app-shell')).toBeVisible(); await page.locator('button[data-target="history"]').click();
  const invoice = page.locator('.history-card').filter({ hasText: 'RECOVERY-GENERATED' }); await expect(invoice).toBeVisible();
  await invoice.getByRole('button', { name: 'Open', exact: true }).click(); await page.locator('#printButton').click();
  await expect.poll(() => page.evaluate(() => window.printed || '')).toContain('63.72');
  expect(await page.evaluate(() => historicalRecord.calculationSnapshot.appliedRates[0].rate.baseRate)).toBe(45);
  expect(await page.evaluate(() => historicalRecord.snapshot.bill.billTo)).toBe('Synthetic Customer');
  await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), `courier-phase5-${info.project.name}.png`) });
});
test('I: 41 publication attempts retain 40 versions and reject rollback without deleting history', async ({ page }, info) => {
  const code = `BROWSER-RETENTION-${info.project.name.toUpperCase()}`;
  const outcome = await page.evaluate(async code => {
    const card = { shipperCode: code, clientInfo: { clientName: 'Synthetic retention', address: '', quotationDate: '' }, globalRules: { minWeightKg: null, fuelSurchargePct: 0, notes: '' }, rates: [{ targetName: 'PATNA', targetType: 'CITY', baseKg: 1, baseRate: 5, perKgRate: 5, formula: 'BASE_PLUS_EXTRA_PER_KG', conditions: '' }] };
    const draft = (await (await window.CourierAuth.apiFetch(`${API_BASE}/rate-cards/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), expectedRevision: 0, card }) })).json()).data;
    for (let i = 0; i < 40; i++) await window.CourierAuth.apiFetch(`${API_BASE}/rate-cards/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), shipperCode: code, expectedRevision: i, draftId: draft._id, draftRevision: 1, approved: true, acknowledgedWarnings: ['FUEL_REFERENCE'] }) });
    const rejected = [];
    for (const action of ['publish', 'rollback']) {
      try { await window.CourierAuth.apiFetch(`${API_BASE}/rate-cards/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), shipperCode: code, expectedRevision: 40, approved: true, ...(action === 'rollback' ? { sourceVersion: 1 } : { draftId: draft._id, draftRevision: 1, acknowledgedWarnings: ['FUEL_REFERENCE'] }) }) }); } catch (e) { rejected.push(e.code); }
    }
    return { rejected, book: (await (await window.CourierAuth.apiFetch(`${API_BASE}/rate-cards/book?shipperCode=${code}`)).json()).data };
  }, code);
  expect(outcome.rejected).toEqual(['VERSION_LIMIT', 'VERSION_LIMIT']); expect(outcome.book.versions).toHaveLength(40); expect(outcome.book.activeVersion).toBe(40);
});
