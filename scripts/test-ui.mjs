import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const script = await fs.readFile(new URL('../assets/app.js', import.meta.url), 'utf8');
const index = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const base = {
  target: '2026-11-17', asOf: '2026-11-11', generatedAt: new Date().toISOString(), confidence: 'low', basis: 'singapore', singaporeThrough: '2026-11-10',
  fuels: { gasoline: { value: -3, low: -5, high: -1, direction: 'decrease', daysOfData: 2 } },
  market: { fx: { pct: 0 }, mogas: { pct: -1 } },
  history: [{ date: '2026-11-10', provisional: true, source: 'News <unsafe>', items: [{ link: 'https://www.philstar.com/fuel' }], fuels: { gasoline: { forecast: -4, actual: -4.7 }, diesel: { forecast: null, actual: -6.4 }, kerosene: { forecast: null, actual: -6.9 } } }],
  liveTrack: { weeks: 0, pending: ['2026-11-17'], stages: [] },
};
async function render(data) {
  const elements = {};
  const document = { querySelector: (id) => elements[id] ??= { innerHTML: '', textContent: '', hidden: false } };
  vm.runInNewContext(script, { document, fetch: async () => ({ ok: true, json: async () => data }), Date, console });
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(elements['#sub'].textContent, /could not be loaded/);
  return elements;
}
let elements = await render({
  ...base, benchmark: { checks: [
    { date: '2026-11-03', source: 'https://doe.gov.ph/report.pdf', status: 'matched', tolerance: 0.15, fuels: { gasoline: { doe: 2.8, opinet: 2.8, difference: 0 } } },
  ] },
});
assert.match(elements['#history'].innerHTML, /provisional/i);
assert.match(elements['#history'].innerHTML, /https:\/\/www.philstar.com\/fuel/);
assert.doesNotMatch(elements['#history'].innerHTML, /<unsafe>/);
assert.match(elements['#benchmark'].innerHTML, /2\.80/);
assert.match(elements['#benchmark'].innerHTML, /USD\/barrel/);
assert.match(elements['#benchmark'].innerHTML, /https:\/\/doe.gov.ph\/report.pdf/);
assert.doesNotMatch(elements['#board'].innerHTML, /3 of 4/);
assert.doesNotMatch(elements['#live'].innerHTML, /Every row above/);
elements = await render({ ...base, benchmark: { checks: [{ date: '2026-10-27', source: 'javascript:alert(1)', status: 'report-window-mismatch', fuels: {} }] } });
assert.doesNotMatch(elements['#banner'].innerHTML, /benchmark/i);
assert.match(elements['#benchmark'].innerHTML, /trading dates/i);
assert.doesNotMatch(elements['#benchmark'].innerHTML, /href="javascript/);
elements = await render(base);
assert.match(elements['#benchmark'].innerHTML, /not available|not yet/i);
for (const host of ['opinet.co.kr', 'doe.gov.ph', 'frankfurter.dev', 'finance.yahoo.com', 'news.google.com']) assert.ok(index.includes(host), `source link: ${host}`);
elements = await render({
  ...base, liveTrack: { weeks: 1, pending: [], stages: [{ key: '2', metrics: {
    gasoline: { n: 1, mae: 0.5, bias: -0.5, directionCorrect: 1, covered: 1, intervalN: 1 },
    diesel: { n: 0, mae: null, bias: null, directionCorrect: 0, covered: 0, intervalN: 0 },
    kerosene: { n: 0, mae: null, bias: null, directionCorrect: 0, covered: 0, intervalN: 0 },
  } }] },
});
assert.match(elements['#live'].innerHTML, /n=1/);
assert.match(elements['#live'].innerHTML, /Bias/);
assert.match(elements['#live'].innerHTML, /Coverage/);
console.log('Reader presentation tests passed');
