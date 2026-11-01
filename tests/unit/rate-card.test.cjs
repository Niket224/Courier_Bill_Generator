const { test } = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../../mobile-bill-app/rate-card');
const { card, pdf } = require('../fixtures/rate-card.cjs');
const { extract } = require('../../server/services/geminiParser');
const { validatePdf } = require('../../server/services/pdfValidation');
test('valid extraction and reviewed normalization retain independent base charge', () => {
  const input = card(); input.rates[0].baseRate = 50;
  const output = Contract.parse(JSON.stringify(input));
  assert.equal(output.complete, true); assert.equal(output.card.rates[0].baseRate, 50);
  assert.equal(output.card.rates[0].perKgRate, 15); assert.equal(output.card.globalRules.fuelSurchargePct, 20);
});
for (const [name, mutate] of [
  ['missing destination', c => { c.rates[0].targetName = ''; }],
  ['invalid destination type', c => { c.rates[0].targetType = 'PLANET'; }],
  ['missing base rate', c => { delete c.rates[0].baseRate; }],
  ['missing extra-weight rate', c => { c.rates[0].perKgRate = null; }],
  ['negative base charge', c => { c.rates[0].baseRate = -1; }],
  ['negative per-kg charge', c => { c.rates[0].perKgRate = -1; }],
  ['invalid base weight', c => { c.rates[0].baseKg = 'heavy'; }],
  ['NaN', c => { c.rates[0].baseRate = NaN; }],
  ['Infinity', c => { c.rates[0].perKgRate = Infinity; }],
  ['duplicate destination', c => { c.rates.push({ ...c.rates[0] }); }],
  ['conflicting duplicate', c => { c.rates.push({ ...c.rates[0], baseRate: 999 }); }],
  ['unsupported formula', c => { c.rates[0].formula = 'DIMENSIONAL_WEIGHT'; }],
  ['missing surcharge', c => { delete c.globalRules.fuelSurchargePct; }],
  ['invalid surcharge', c => { c.globalRules.fuelSurchargePct = -1; }],
  ['incorrect AI field name', c => { c.rates[0].baseCharge = 45; }],
  ['extra fields', c => { c.approved = true; }],
  ['empty rates', c => { c.rates = []; }],
  ['conflicting minimum', c => { c.globalRules.minWeightKg = 4; }]
]) test(`rate schema rejects ${name}`, () => { const input = card(); mutate(input); assert.throws(() => Contract.normalize(input)); });
test('missing AI prices remain unresolved and never default to zero or weight times rate', () => {
  const input = card(); delete input.rates[0].baseRate; input.globalRules.fuelSurchargePct = null;
  const extracted = Contract.parse(JSON.stringify(input));
  assert.equal(extracted.complete, false); assert.equal(extracted.card.rates[0].baseRate, null);
  assert.equal(extracted.card.globalRules.fuelSurchargePct, null);
  assert.throws(() => Contract.normalize(extracted.card));
});
test('duplicate AI rows remain visible for resolution rather than being silently collapsed', () => {
  const input = card(); input.rates.push({ ...input.rates[0], baseRate: 90 });
  const result = Contract.parse(JSON.stringify(input)); assert.equal(result.card.rates.length, 2); assert.equal(result.complete, false);
});
test('explicit zero and decimal charges normalize without rounding or invented charges', () => {
  const input = card(); Object.assign(input.rates[0], { baseKg: '0', baseRate: '0', perKgRate: '12.345678' }); input.globalRules.fuelSurchargePct = '0';
  const result = Contract.normalize(input).card;
  assert.equal(result.rates[0].baseRate, 0); assert.equal(result.rates[0].perKgRate, 12.345678);
});
test('malformed JSON, non-object responses and currency strings are rejected', () => {
  for (const raw of ['not-json', '[]', 'null', '12', '```json {} ```']) assert.throws(() => Contract.parse(raw));
  const input = card(); input.rates[0].baseRate = 'Rs 45'; assert.throws(() => Contract.parse(JSON.stringify(input)));
});
test('PDF signatures, corruption, active content and object streams are rejected', async () => {
  const good = await pdf(); assert.equal((await validatePdf(good)).pages, 1);
  for (const bad of [Buffer.alloc(0), Buffer.from('not PDF'), Buffer.from('%PDF-1.7\n%%EOF'), good.subarray(0, good.length - 20), Buffer.concat([good, Buffer.from('<html>')])]) await assert.rejects(validatePdf(bad));
  const active = Buffer.from(good.toString('latin1').replace('/Type /Catalog', '/Type /Catalog /OpenAction 1 0 R'), 'latin1');
  await assert.rejects(validatePdf(active));
});
test('Gemini retries only transient errors and returns validated extraction', async () => {
  let attempts = 0;
  const result = await extract(Buffer.from('synthetic'), { provider: async () => { attempts++; if (attempts < 3) throw { status: 503 }; return JSON.stringify(card()); }, delayMs: 1, timeoutMs: 50, totalMs: 500 });
  assert.equal(attempts, 3); assert.equal(result.card.rates[0].baseRate, 45);
});
for (const [status, code] of [[401, 'AI_CREDENTIALS'], [403, 'AI_CREDENTIALS'], [429, 'AI_QUOTA'], [404, 'AI_MODEL_UNAVAILABLE'], [400, 'AI_REQUEST_REJECTED']]) {
  test(`Gemini ${status} is not retried and never exposes provider text`, async () => {
    let calls = 0;
    await assert.rejects(extract(Buffer.from('x'), { provider: async () => { calls++; throw { status, message: 'secret-provider-details' }; }, delayMs: 1 }), (e) => e.code === code && !e.message.includes('secret'));
    assert.equal(calls, 1);
  });
}
test('Gemini timeout and malformed output are bounded and safe', async () => {
  let signal;
  await assert.rejects(extract(Buffer.from('x'), { provider: (_, s) => { signal = s; return new Promise(() => {}); }, timeoutMs: 10, totalMs: 20, retries: 0 }), (e) => e.code === 'AI_TIMEOUT');
  assert.equal(signal.aborted, true);
  await assert.rejects(extract(Buffer.from('x'), { provider: async () => 'sensitive raw content', retries: 0 }), (e) => e.code === 'INVALID_AI_OUTPUT' && !e.message.includes('sensitive'));
});
