const { test, expect } = require('@playwright/test');
const fixture = require('../fixtures/bill.json');
const { password } = require('../fixtures/auth.cjs');
test.beforeEach(async ({ context }, testInfo) => {
  await context.addInitScript((data) => {
    if (!localStorage.getItem('courier-bill-app-v2')) localStorage.setItem('courier-bill-app-v2', JSON.stringify(data));
    window.print = () => { window.printCalls = (window.printCalls || 0) + 1; };
  }, { ...fixture, bill: { ...fixture.bill, invoiceNo: testInfo.title.startsWith('draft revisions')
    ? (testInfo.project.name === 'mobile' ? '103/2026' : '102/2026')
    : (testInfo.project.name === 'mobile' ? '101/2026' : '100/2026') } });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5000' && url.pathname.startsWith('/api/')) {
      // The browser sends real cookies/CSRF headers; only the transport destination changes.
      const response = await route.fetch({ url: `http://127.0.0.1:4188${url.pathname}${url.search}` });
      return route.fulfill({ response });
    }
    if (url.origin === 'http://127.0.0.1:4187') return route.continue();
    return route.abort();
  });
});
async function login(page) {
  await page.goto('/');
  await expect(page.locator('#loginMessage')).toContainText('Sign in');
  await page.locator('#loginUsername').fill('test-admin');
  await page.locator('#loginPassword').fill(password);
  await page.locator('#loginButton').click();
  await expect(page.locator('.app-shell')).toBeVisible();
}
test('authorized login → billing → saved MongoDB invoice → history → logout', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.locator('button[data-target="entry"]').click();
  await page.locator('#shipmentList input[data-field="weight"]').fill('4.5');
  await expect(page.locator('#summaryFinal')).toHaveText('Rs 95.58');
  await page.locator('button[data-target="invoice"]').click();
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/invoices/save') && response.request().method() === 'POST');
  await page.locator('#printButton').click();
  expect((await saved).status()).toBe(201);
  await expect.poll(() => page.evaluate(() => window.printCalls)).toBe(1);
  await page.locator('button[data-target="history"]').click();
  await expect(page.locator('#historyInvoiceList')).toContainText(testInfo.project.name === 'mobile' ? '101/2026' : '100/2026');
  await expect(page.locator('#historyInvoiceList')).toContainText('95.58');
  await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), `courier-phase1-${testInfo.project.name}.png`) });
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === 'courier.sid').httpOnly).toBe(true);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain(password);
  expect(storage).not.toContain('csrfToken');
  await page.locator('#logoutButton').click();
  await expect(page.locator('#loginMessage')).toContainText('Signed out');
  await expect(page.locator('.app-shell')).toBeHidden();
  await page.reload();
  await expect(page.locator('#loginPanel')).toBeVisible();
  expect(errors).toEqual([]);
});
test('incorrect login shows an understandable error and clears password', async ({ page }) => {
  await page.goto('/');
  await page.locator('#loginUsername').fill('test-admin');
  await page.locator('#loginPassword').fill('incorrect-test-password');
  await page.locator('#loginButton').click();
  await expect(page.locator('#loginMessage')).toContainText('Invalid username or password');
  await expect(page.locator('#loginPassword')).toHaveValue('');
  await expect(page.locator('.app-shell')).toBeHidden();
});
test('API session expiry returns to login without losing draft', async ({ page, context }) => {
  await login(page);
  await context.route('**/api/invoices/search?*', (route) => route.fulfill({ status: 401, json: { error: 'Please sign in.' } }));
  await page.locator('button[data-target="history"]').click();
  await expect(page.locator('#loginMessage')).toContainText('session expired');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('courier-bill-app-v2')).shipments[0].cno)).toBe('TEST001');
});
test('absolute session timer locks the frontend', async ({ page }) => {
  await page.clock.install();
  await login(page);
  await page.clock.fastForward(481 * 60000);
  await expect(page.locator('#loginMessage')).toContainText('session expired');
  await expect(page.locator('.app-shell')).toBeHidden();
});
test('draft revisions, lost save acknowledgement, paid/cancelled history and linked correction', async ({ page, context }, testInfo) => {
  await login(page);
  const invoiceNumber = testInfo.project.name === 'mobile' ? '103/2026' : '102/2026';
  await page.locator('button[data-target="invoice"]').click();
  await page.getByText('Additional invoice details', { exact: true }).click();
  await page.locator('#invoiceDueDate').fill('2026-03-01');
  await page.locator('#invoiceNotes').fill('Synthetic terms retained');
  await page.locator('#saveDraftButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  await page.locator('button[data-target="entry"]').click();
  await page.locator('#shipmentList input[data-field="weight"]').fill('3.5');
  await page.locator('button[data-target="invoice"]').click();
  await page.locator('#saveDraftButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  const finalizedRequests = [];
  await context.route('**/api/invoices/save', async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.status !== 'GENERATED') return route.fallback();
    finalizedRequests.push(payload);
    const response = await route.fetch({ url: 'http://127.0.0.1:4188/api/invoices/save' });
    if (finalizedRequests.length === 1) { expect(response.status()).toBe(200); return route.abort('connectionreset'); }
    expect((await response.json()).replayed).toBe(true);
    return route.fulfill({ response });
  });
  await page.locator('#printButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Offline');
  expect(await page.evaluate(() => window.printCalls || 0)).toBe(0);
  await page.locator('#retrySaveButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  expect(finalizedRequests[1]).toEqual(finalizedRequests[0]);
  await page.locator('#printButton').click();
  await expect.poll(() => page.evaluate(() => window.printCalls)).toBe(1);
  await page.locator('button[data-target="history"]').click();
  const card = page.locator('.history-card').filter({ hasText: `Invoice #${invoiceNumber}` });
  page.on('dialog', (dialog) => dialog.accept(dialog.message().startsWith('New invoice number') ? `C-${invoiceNumber}` : 'Synthetic lifecycle reason'));
  await card.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(card.locator('.badge-status')).toHaveText('PAID');
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.locator('.badge-status')).toHaveText('CANCELLED');
  await card.getByRole('button', { name: 'Create correction', exact: true }).click();
  await expect(page.locator('#invoicePaper')).toContainText(`C-${invoiceNumber}`);
  await page.locator('#saveDraftButton').click();
  await expect(page.locator('#invoiceSaveState')).toHaveText('Saved');
  const records = await page.evaluate(async () => (await (await window.CourierAuth.apiFetch(`${API_BASE}/invoices?limit=100`)).json()).data);
  const originalId = records.find((record) => record.invoiceNumber === invoiceNumber)._id;
  const original = await page.evaluate(async (id) => (await (await window.CourierAuth.apiFetch(`${API_BASE}/invoices/${id}`)).json()).data, originalId);
  expect(original.status).toBe('CANCELLED'); expect(original.totalAmount).toBe(74.34); expect(original.operations.length).toBe(5);
  expect(original.notes).toBe('Synthetic terms retained'); expect(original.dueDate).toContain('2026-03-01');
  expect(records.find((record) => record.invoiceNumber === `C-${invoiceNumber}`).correctionOf).toBe(invoiceNumber);
  await page.locator('button[data-target="entry"]').click();
  await page.locator('#newBillButton').click();
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('courier-bill-archive-')))).toBe(true);
});
