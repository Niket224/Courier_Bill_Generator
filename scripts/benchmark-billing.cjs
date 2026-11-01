const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const Billing = require('../mobile-bill-app/billing');
const results = [];
for (const count of [100, 500, 1000]) {
  const input = { shipments: Array.from({ length: count }, (_, i) => ({ awb: `BENCH-${i}`, weight: 1, pcs: 1, rate: { baseKg: 3, baseRate: 45, perKgRate: 15 } })),
    tax: { mode: 'SPLIT', fuelPct: 20, cgstPct: 9, sgstPct: 9 } };
  for (let i = 0; i < 10; i++) Billing.invoice(input);
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now(); const result = Billing.invoice(input); samples.push(performance.now() - start);
    assert.equal(result.paise.final, count * 6372);
  }
  samples.sort((a, b) => a - b);
  results.push({ shipments: count, samples: 50, meanMs: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3)), p95Ms: Number(samples[47].toFixed(3)), maxMs: Number(samples.at(-1).toFixed(3)) });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, scope: 'Pure calculation only, warm cache; no DOM, database or network', results }, null, 2));
