const { test, expect } = require('@playwright/test');
const fixture = require('../fixtures/bill.json');
test.beforeEach(async ({ context }) => {
  await context.addInitScript((data) => {
    if (!localStorage.getItem('courier-bill-app-v2') && !localStorage.getItem('courier-bill-app-v2.sealed-v1')) localStorage.setItem('courier-bill-app-v2', JSON.stringify(data));
  }, fixture);
  // Block real API and external traffic, including localhost:5000.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: {
      authenticated: true, csrfToken: 'a'.repeat(64), expiresAt: Date.now() + 600000
    } });
    if (url.pathname === '/api/privacy/draft-key') return route.fulfill({ json: { success: true, key: Buffer.alloc(32, 7).toString('base64') } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, data: [], count: 0 } });
    if (url.origin === 'http://127.0.0.1:4187') return route.continue();
    return route.abort();
  });
});
test('load, edit weight, persist locally, and render invoice', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page).toHaveTitle(/Courier Bill/);
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 63.72');
  await page.locator('button[data-target="entry"]').click();
  await page.locator('#shipmentList input[data-field="weight"]').fill('4.5');
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 95.58');
  await page.reload();
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 95.58');
  await page.locator('button[data-target="invoice"]').click();
  await expect(page.locator('#invoicePaper')).toBeVisible();
  await expect(page.locator('#invoicePaper')).toContainText('TEST001');
  await expect(page.locator('#invoicePaper')).toContainText('95.58');
  expect(errors).toEqual([]);
});
test('add shipment, warn for missing rates, and open history safely', async ({ page }) => {
  await page.goto('/');
  await page.locator('button[data-target="entry"]').click();
  await page.locator('#addShipmentButton').click();
  await expect(page.locator('.shipment-card')).toHaveCount(2);
  await page.locator('.shipment-card').last().locator('[data-field="cno"]').fill('TEST002');
  await page.evaluate(() => {
    state.shipments[0].destination = 'UNKNOWN';
    saveState(); renderShipments(); renderAll();
  });
  await expect(page.locator('#warningBanner')).toBeVisible();
  await expect(page.locator('.amount-pill').first()).toContainText('CHECK RATE');
  await page.locator('button[data-target="history"]').click();
  await expect(page.locator('#historyInvoiceList')).toContainText('Koi past invoice nahi mili');
});
test('PDF review escapes untrusted fields and supports deleting a review row', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(() => openReviewModal({ clientInfo: { clientName: 'TEST' }, rates: [
    { targetName: 'patna', targetType: 'CITY', baseKg: '\"><img src=x onerror="window.injected=true">', perKgRate: 15 }
  ] }));
  await expect(page.locator('#pdfReviewModal')).toBeVisible();
  await expect(page.locator('#reviewRatesTableBody img')).toHaveCount(0);
  await page.locator('#reviewRatesTableBody button[data-action="delete-review"]').click();
  await expect(page.locator('#reviewRatesTableBody tr')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.locator('#closeReviewModal').click();
  await page.evaluate(() => { state.shipments[0].id = 'test" onmouseover="window.injected=true'; renderShipments(); });
  await page.locator('button[data-target="entry"]').click();
  await page.locator('#shipmentList input[data-field="weight"]').fill('4.5');
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 95.58');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});
