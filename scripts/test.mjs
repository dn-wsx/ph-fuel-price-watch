import assert from 'node:assert/strict';
import { windows, rawChange, calibrate, forecast, confidence } from './model.mjs';
import { listReports, parseYtd, recordFromDoe } from './doe.mjs';

// Window logic: a Tuesday looks ahead to the following Tuesday.
assert.deepEqual(windows('2026-11-10').cur, ['2026-11-09', '2026-11-13']);
assert.equal(windows('2026-11-10').target, '2026-11-17');
assert.equal(windows('2026-11-14').target, '2026-11-17'); // Saturday
assert.equal(windows('2026-11-16').target, '2026-11-17'); // Monday
assert.equal(windows('2026-11-17').target, '2026-11-24'); // Tuesday itself

// Flat prices -> zero change. +0.10 USD/gal at 58 PHP -> 0.10/3.78541*58*1.12 PHP/L.
const w = windows('2026-11-14');
const days = (start, n, v) => Object.fromEntries(Array.from({ length: n }, (_, i) => [new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10), v]));
const fx = { '2026-10-01': 58 };
const flat = { ...days('2026-11-02', 5, 2.0), ...days('2026-11-09', 5, 2.0) };
assert.equal(rawChange(flat, fx, w).raw, 0);
const up = { ...days('2026-11-02', 5, 2.0), ...days('2026-11-09', 5, 2.1) };
assert.ok(Math.abs(rawChange(up, fx, w).raw - (0.1 / 3.78541) * 58 * 1.12) < 1e-9);
assert.equal(rawChange({ ...days('2026-11-02', 2, 2.0), ...days('2026-11-09', 5, 2.1) }, fx, w), null); // prior week too thin

// Calibration: actual = 0.8 * raw exactly -> scale 0.8, rmse 0.
const pairs = [1, -0.5, 0.7, 1.4, -1, 0.3].map((r) => [r, 0.8 * r]);
const cal = calibrate(pairs);
assert.ok(Math.abs(cal.scale - 0.8) < 1e-9 && cal.rmse < 1e-9 && cal.fitted);
assert.equal(calibrate(pairs.slice(0, 3)).scale, 1); // too little history -> unchanged

const f = forecast(1.0, { scale: 1, rmse: 0.6 }, null);
assert.deepEqual([f.direction, f.low, f.high], ['increase', 0.4, 1.6]);
assert.equal(forecast(1.0, { scale: 1, rmse: 0.6 }, [0, 0]).value, 0.5); // 50/50 blend
assert.equal(confidence(5, 10), 'high'); assert.equal(confidence(2, 10), 'low');


// ---- DOE Oil Monitor reader (wording copied from real 2026 reports) ----
assert.deepEqual(parseYtd('The 37th price movement this year resulted in a total net increase of:\n| • | P65.02/liter for gasoline, |\n| • | P64.86/liter for diesel, and |\n| • | P58.07/liter for kerosene |'), { n: 37, gasoline: 65.02, diesel: 64.86, kerosene: 58.07 });
assert.deepEqual(parseYtd('The 25th price movement this year resulted in a total net increase of P43.12/liter for gasoline,. P30.71/liter for diesel and P27.50/liter for kerosene.'), { n: 25, gasoline: 43.12, diesel: 30.71, kerosene: 27.5 });
assert.equal(parseYtd('The 5th price movement this year resulted in a total net decrease of P1.00/liter for gasoline, P2.00/liter for diesel and P3.00/liter for kerosene').diesel, -2);
assert.equal(parseYtd('Prices increased by P1.20 per liter this week.'), null);

const html = ['Oil Monitor 03 November', 'Oil Monitor 27 October', 'Oil Monitor As of 01 September 2026-1', 'Oil Monitor 18 August-1', 'Oil Monitor As of 29 December 2025']
  .map((n) => `<a href="https://d24qbtp4vooyzi.cloudfront.net/api/media/file/${encodeURIComponent(n)}.pdf?prefix=dev%2Fmedia">${n}</a>`).join('');
const rep = listReports(html, '2026-11-10');
assert.deepEqual(rep.map((r) => r.date), ['2026-11-03', '2026-10-27', '2026-09-01', '2026-08-18', '2025-12-29']);
assert.deepEqual(listReports(String.raw`{"u":"https:\/\/x.example\/Oil Monitor 03 November.pdf"}`, '2026-11-10').map((r) => r.date), ['2026-11-03']); // JSON-escaped slashes, unencoded spaces
assert.equal(listReports('Oil Monitor 29 December.pdf <a href="https://x.example/Oil%20Monitor%2029%20December.pdf">', '2026-01-05')[0].date, '2025-12-29'); // no year, last year

const text = (n, g, d, k) => `The ${n}th price movement this year resulted in a total net increase of P${g}/liter for gasoline, P${d}/liter for diesel and P${k}/liter for kerosene.`;
const reports = { 'Oil Monitor 03 November': text(44, '72.05', '64.63', '61.35'), 'Oil Monitor 27 October': text(43, '68.55', '65.63', '63.25') };
const mkFetch = (rs, overrides = {}) => async (url) => {
  if (url.includes('oil-monitor')) return { ok: true, status: 200, text: async () => Object.keys(rs).map((n) => `<a href="https://x.example/${encodeURIComponent(n)}.pdf">${n}</a>`).join('') };
  const name = decodeURIComponent(url.split('/').pop().replace('.pdf', ''));
  return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(overrides[name] ?? rs[name]) };
};
const pdfText = (buf) => buf.toString();
let actuals = {}, ytd = {};
let r = await recordFromDoe({ actuals, ytd, today: '2026-11-10', fetchImpl: mkFetch(reports), pdfText });
assert.deepEqual(r.added, ['2026-11-03']);
assert.deepEqual([actuals['2026-11-03'].gasoline, actuals['2026-11-03'].diesel, actuals['2026-11-03'].kerosene], [3.5, -1, -1.9]); // matches the announced Nov 3 adjustment
// A manual value is never overwritten; a missing fuel is filled in.
actuals = { '2026-11-03': { diesel: -0.95 } }; ytd = {};
await recordFromDoe({ actuals, ytd, today: '2026-11-10', fetchImpl: mkFetch(reports), pdfText });
assert.deepEqual([actuals['2026-11-03'].gasoline, actuals['2026-11-03'].diesel], [3.5, -0.95]);
// Movement numbers that do not line up are skipped, not guessed.
actuals = {}; ytd = {};
r = await recordFromDoe({ actuals, ytd, today: '2026-11-10', fetchImpl: mkFetch(reports, { 'Oil Monitor 27 October': text(41, '68.55', '65.63', '63.25') }), pdfText });
assert.deepEqual([r.added.length, Object.keys(actuals).length], [0, 0]); assert.ok(r.problems.some((p) => p.includes('do not line up')));
// First movement of a new year starts from zero.
actuals = {}; ytd = {};
r = await recordFromDoe({ actuals, ytd, today: '2026-01-10', fetchImpl: mkFetch({ 'Oil Monitor 06 January 2026': text(1, '0.20', '0.40', '0.10').replace('1th', '1st') }), pdfText });
assert.equal(actuals['2026-01-06']?.gasoline, 0.2);
// Unreadable report -> reported as a problem, nothing recorded.
actuals = {}; ytd = {};
r = await recordFromDoe({ actuals, ytd, today: '2026-11-10', fetchImpl: mkFetch({ 'Oil Monitor 03 November': 'no totals here' }), pdfText });
assert.equal(r.added.length, 0); assert.ok(r.problems.length);
console.log('All tests passed');
