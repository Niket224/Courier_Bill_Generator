// Read only the explicitly named synthetic acceptance artifacts. No production paths or PDFs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
async function main() {
  const option = process.argv.indexOf('--bin-dir'); const bin = option === -1 ? '' : process.argv[option + 1];
  const command = name => bin ? path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const execute = (name, args) => { const result = spawnSync(command(name), args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); if (result.status !== 0) throw new Error(`${name} unavailable or PDF inspection failed.`); return result.stdout; };
  const results = [];
  for (const viewport of ['desktop', 'mobile']) for (const kind of ['monthly-100', 'correction-100', 'cancelled-100', 'single-long-fields']) {
    const file = path.resolve('output/pdf', `synthetic-${kind}-${viewport}.pdf`);
    const info = execute('pdfinfo', [file]); const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    assert.equal(pages, kind === 'single-long-fields' ? 1 : 3);
    const text = execute('pdftotext', ['-layout', file, '-']);
    assert.ok(text.includes('SYNTHETIC COURIER ACCEPTANCE')); assert.ok(text.includes(kind === 'single-long-fields' ? '59.75' : '11449.69'));
    assert.ok(text.includes('PROPRIETOR / AUTHORISED SIGNATORY'));
    if (kind.includes('100')) {
      const prefix = viewport === 'desktop' ? 'AD' : 'AM';
      for (let i = 1; i <= 100; i++) assert.equal(text.match(new RegExp(`\\b${prefix}${String(i).padStart(3, '0')}\\b`, 'g'))?.length, 1, `Missing/duplicate synthetic AWB ${i}`);
      for (const total of ['8625.00', '1078.13', '9703.13', '873.28']) assert.ok(text.includes(total));
    } else assert.ok(execute('pdftotext', ['-raw', file, '-']).replace(/\s/g, '').includes('SYNTHETIC-LONG-' + '1234567890'.repeat(8)));
    if (kind.startsWith('correction') || kind.startsWith('cancelled')) assert.ok(text.includes('CORRECTION OF:'));
    if (kind.startsWith('cancelled')) assert.ok(text.includes('CANCELLED - historical record'));
    const bbox = execute('pdftotext', ['-bbox-layout', file, '-']); let words = 0;
    for (const page of bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
      for (const word of page[3].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/g)) {
        words++; assert.ok(+word[1] >= 20 && +word[2] >= 20 && +word[3] <= +page[1] - 20 && +word[4] <= +page[2] - 20, 'PDF word exceeds safe page bounds');
      }
    }
    assert.ok(words > 40); results.push({ file: path.basename(file), pages, words, content: 'PASS', pageBounds: 'PASS' });
  }
  const report = { scope: 'Synthetic PDF text, page count and bounds; visual review is separate; physical printing NOT VERIFIED', result: 'PASS', results };
  await fs.writeFile('docs/phase7-pdf-inspection.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
