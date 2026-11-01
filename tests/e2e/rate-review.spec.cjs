const { test, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
const fixture = require('../fixtures/bill.json');
const { password } = require('../fixtures/auth.cjs');
const { card, pdf } = require('../fixtures/rate-card.cjs');
let cookies;
test.beforeAll(async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4189' });
  const challenge = await (await client.get('/api/auth/csrf')).json();
  expect((await client.post('/api/auth/login', { headers: { 'X-CSRF-Token': challenge.csrfToken }, data: { username: 'test-admin', password } })).status()).toBe(200);
  cookies = (await client.storageState()).cookies; await client.dispose();
});
test.beforeEach(async ({ page, context }, info) => {
  await context.addCookies(cookies);
  const id = createHash('sha256').update(info.title + info.project.name).digest('hex').slice(0, 10).toUpperCase();
  const data = structuredClone(fixture); data.bill.shipperCode = `REVIEW-${id}`; data.bill.invoiceNo = `REVIEW-${id}`; data.rates[0].client = data.bill.shipperCode;
  await context.addInitScript(value => {
    if (location.origin !== 'http://127.0.0.1:4187') return;
    if (!localStorage.getItem('courier-bill-app-v2')) localStorage.setItem('courier-bill-app-v2', JSON.stringify(value));
    window.print = () => { window.printCalls = (window.printCalls || 0) + 1; };
  }, data);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5000' && url.pathname.startsWith('/api/')) return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:4189${url.pathname}${url.search}` }) });
    return url.origin === 'http://127.0.0.1:4187' ? route.continue() : route.abort();
  });
  page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await expect(page.locator('.app-shell')).toBeVisible();
});
async function localReview(page) {
  await page.locator('button[data-target="invoice"]').click(); await page.locator('#publishRatesButton').click();
}
async function draft(page) {
  await page.locator('#saveReviewedRatesButton').click(); await expect(page.locator('#reviewStatus')).toContainText('Draft saved');
  await page.locator('#reviewApproval').check();
}
async function publish(page) {
  await page.locator('#publishReviewedRatesButton').click(); await expect(page.locator('#reviewStatus')).toContainText('Published version');
}
async function upload(page, buffer) {
  await page.locator('button[data-target="rates"]').click();
  await page.locator('#pdfRateUpload').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer });
  await page.locator('#parsePdfButton').click();
}
test('A: synthetic PDF review corrects independent base charge and publishes verified calculations', async ({ page }, info) => {
  const code = await page.evaluate(() => state.bill.shipperCode);
  await upload(page, await pdf()); await expect(page.locator('#pdfReviewModal')).toBeVisible();
  expect(await page.locator('.review-base-rate').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(80);
  await expect(page.locator('#reviewApproval')).toHaveCSS('width', '20px');
  await page.locator('#reviewShipperCode').fill(code); await page.locator('.review-base-rate').fill('50');
  await draft(page); await publish(page);
  await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), `courier-phase4-${info.project.name}.png`) });
  await page.locator('#closeReviewModal').click(); await expect(page.locator('#summaryFinal')).toHaveText('Rs 70.80');
  await page.locator('button[data-target="invoice"]').click(); await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved'); await expect(page.locator('#invoiceSaveMessage')).toContainText('Server calculation verified');
});
test('B: malformed PDF leaves active local rates unchanged', async ({ page }) => {
  const before = await page.evaluate(() => JSON.stringify(state.rates));
  await upload(page, Buffer.from('not a PDF')); await expect(page.locator('#pdfParseStatus')).toContainText('Parse failed');
  expect(await page.evaluate(() => JSON.stringify(state.rates))).toBe(before);
});
test('C: unresolved AI base charge blocks draft and publication without inventing zero', async ({ page, context }) => {
  const value = card(); value.rates[0].baseRate = null;
  await context.route('**/api/rates/parse-pdf', route => route.fulfill({ json: { success: true, data: value, complete: false } }));
  await upload(page, await pdf()); await expect(page.locator('.review-base-rate')).toHaveValue('');
  await page.locator('#saveReviewedRatesButton').click(); await expect(page.locator('#reviewStatus')).toContainText('baseRate');
  await expect(page.locator('#publishReviewedRatesButton')).toBeDisabled();
});
test('D: publication outage and HTTP 200 failure payload never claim publication', async ({ page, context }) => {
  await localReview(page); await draft(page);
  await context.route('**/api/rate-cards/publish', route => route.abort('internetdisconnected'));
  await page.locator('#publishReviewedRatesButton').click(); await expect(page.locator('#reviewStatus')).toContainText('Not confirmed');
  await context.unroute('**/api/rate-cards/publish');
  await context.route('**/api/rate-cards/publish', route => route.fulfill({ json: { success: false } }));
  await page.locator('#retryRateReviewButton').click(); await expect(page.locator('#reviewStatus')).toContainText('did not confirm');
  expect(await page.evaluate(() => state.rateReview.pending.body.requestId)).toBeTruthy();
});
test('F: lost publication response retries the same operation without duplicate versions', async ({ page, context }) => {
  await localReview(page); await draft(page); let requestId;
  await context.route('**/api/rate-cards/publish', async route => {
    requestId = route.request().postDataJSON().requestId;
    expect((await route.fetch({ url: 'http://127.0.0.1:4189/api/rate-cards/publish' })).status()).toBe(200);
    await route.abort('connectionreset');
  });
  await page.locator('#publishReviewedRatesButton').click(); await expect(page.locator('#reviewStatus')).toContainText('Not confirmed');
  await context.unroute('**/api/rate-cards/publish'); await page.locator('#retryRateReviewButton').click();
  await expect(page.locator('#reviewStatus')).toContainText('Published version 1');
  const book = await page.evaluate(() => state.rateReview.book);
  expect(book.versions).toHaveLength(1); expect(book.operations[0].requestId).toBe(requestId);
});
test('G: session expiry preserves edited review through reauthentication and retry', async ({ page, context }) => {
  await localReview(page); await page.locator('.review-base-rate').fill('51');
  await context.route('**/api/rate-cards/drafts', route => route.fulfill({ status: 401, json: { success: false, error: 'Session expired' } }));
  await page.locator('#saveReviewedRatesButton').click(); await expect(page.locator('#loginPanel')).toBeVisible();
  await expect(page.locator('#pdfReviewModal')).not.toBeVisible();
  await context.unroute('**/api/rate-cards/drafts');
  await page.locator('#loginUsername').fill('test-admin'); await page.locator('#loginPassword').fill(password); await page.locator('#loginButton').click();
  await expect(page.locator('.app-shell')).toBeVisible(); await page.locator('button[data-target="rates"]').click();
  await page.locator('#resumeRateReviewButton').click(); await expect(page.locator('.review-base-rate')).toHaveValue('51');
  await page.locator('#retryRateReviewButton').click(); await expect(page.locator('#reviewStatus')).toContainText('Draft saved');
  cookies = (await context.storageState()).cookies;
});
test('untrusted extracted names remain inert through server draft storage and reload', async ({ page }) => {
  const value = card(); value.clientInfo.clientName = '<img src=x onerror="window.injected=true">';
  await page.evaluate(value => { value.shipperCode = state.bill.shipperCode; window.RateReview.open(value); }, value);
  await draft(page); await page.reload(); await page.locator('button[data-target="rates"]').click();
  await page.locator('#loadRateDraftsButton').click(); await expect(page.locator('#rateDraftSelect option')).toHaveCount(1);
  await page.locator('#openRateDraftButton').click(); await expect(page.locator('#reviewClientName')).toHaveValue(value.clientInfo.clientName);
  expect(await page.evaluate(() => window.injected)).toBeUndefined(); await expect(page.locator('#pdfReviewModal img')).toHaveCount(0);
});
