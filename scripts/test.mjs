import assert from 'node:assert/strict';
import { CONFIG, addDays, windows, rawChange, calibrate, forecast, confidence, barDate, frontContract, spansRoll, seriesFor, fuelChange, partialSd, toRange, pickEstimates } from './model.mjs';
import { listReports, parseYtd, recordFromDoe, parseNotice, recordFromNotices } from './doe.mjs';
import { settledBars, intradayClose, latestSettleDate } from './market.mjs';
import { parseRss, parseEstimate, estimatesFromNews } from './news.mjs';

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

const wk = (mon, vals) => Object.fromEntries(vals.map((v, i) => [addDays(mon, i), v])); // Mon-Fri prices from a Monday

// The unfinished week is projected at the latest price instead of averaging only the days seen so far.
const partial = rawChange({ ...days('2026-11-02', 5, 2.0), '2026-11-09': 2.0, '2026-11-10': 2.4 }, fx, w);
assert.equal(partial.days, 2);
assert.ok(Math.abs(partial.raw - ((2.0 + 4 * 2.4) / 5 - 2.0) / 3.78541 * 58 * 1.12) < 1e-9);
assert.ok(rawChange(up, fx, w).dailySd >= 0);
// Remaining days add uncertainty: nothing left -> none; more days left -> more.
assert.equal(partialSd(1, 5), 0);
assert.ok(partialSd(1, 2) > partialSd(1, 4) && partialSd(1, 4) > 0);
assert.ok(Math.abs(partialSd(1, 2) - Math.sqrt(14) / 5) < 1e-9); // 3 days left: sqrt(1+4+9)/5

// Futures contract rolls
assert.equal(frontContract('HO', '2026-11-09'), 'HOZ26'); assert.equal(frontContract('HO', '2026-10-30'), 'HOX26');
assert.equal(frontContract('RB', '2026-12-15'), 'RBF27'); assert.equal(frontContract('BZ', '2026-11-09'), 'BZF27'); assert.equal(frontContract('BZ', '2026-10-30'), 'BZZ26');
const cont = { ...wk('2026-10-26', [4.8, 4.8, 4.8, 4.8, 4.8]), ...wk('2026-11-02', [4.4, 4.4, 4.4, 4.4, 4.4]) }; // continuous series drops 8% at the roll
const dec = { ...wk('2026-10-26', [4.4, 4.4, 4.4, 4.4, 4.4]), ...wk('2026-11-02', [4.4, 4.4, 4.4, 4.4, 4.4]) };  // the Dec contract did not move
const wRoll = windows('2026-11-07'); // cur 11-02..06, prev 10-26..30
assert.equal(spansRoll('HO', cont, wRoll), true);
const liveWeek = { ...wk('2026-11-02', [4.4, 4.4, 4.4, 4.4, 4.4]), '2026-11-09': 4.4, '2026-11-10': 4.4 };
assert.equal(spansRoll('HO', liveWeek, windows('2026-11-10')), false); // both weeks after the roll
assert.equal(spansRoll('HO', { ...wk('2026-10-26', [4.8, 4.8, 4.8, 4.8, 4.8]), '2026-11-02': 4.4, '2026-11-03': 4.4 }, windows('2026-11-03')), true); // roll falls inside the two weeks (early-week run)
assert.equal(rawChange({ ...wk('2026-10-26', [2, 2, 2, 2, 2]), ...wk('2026-11-02', [1, 1, 1, 1, 1]) }, fx, wRoll).dailySd, 0); // the month-end jump is a roll, not volatility
const S = { 'HO=F': cont, HOZ26: dec };
assert.equal(seriesFor('HO=F', S, wRoll).prices, dec);
assert.equal(seriesFor('HO=F', { 'HO=F': cont }, wRoll).unresolved, true);
const fixed = fuelChange('diesel', S, fx, wRoll);
assert.ok(Math.abs(fixed.raw) < 1e-9 && fixed.rolled && !fixed.unresolved); // roll jump removed
const unfixed = fuelChange('diesel', { 'HO=F': cont }, fx, wRoll);
assert.ok(unfixed.unresolved && unfixed.raw < -3); // without the contract the false drop remains, and is flagged

// Calibration pulls toward 1 (little history can not move the scale far) and never leaves 0.7-1.3.
const pairs = [1, -0.5, 0.7, 1.4, -1, 0.3].map((r) => [r, 0.8 * r]);
const cal = calibrate(pairs);
assert.ok(cal.fitted && cal.scale > 0.8 && cal.scale < 1);
const many = Array.from({ length: 60 }, (_, i) => [Math.sin(i) * 3, 0.8 * Math.sin(i) * 3]);
assert.ok(Math.abs(calibrate(many).scale - 0.8) < 0.1);
assert.equal(calibrate([[1, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9]]).scale, 1.3);
// One freak week (Singapore moved 4x what New York did) must not steer the scale, but it must still widen the range.
const clean = [3, -2, 1.5, -1, 2.5, -3, 1, 2, -1.5, 0.5].map((r) => [r, r + (r > 0 ? 0.1 : -0.1)]);
const freak = calibrate([...clean, [-4, -17]]);
assert.ok(Math.abs(freak.scale - calibrate(clean).scale) < 0.1, `scale ${freak.scale}`);
assert.ok(freak.rmse > 3 * calibrate(clean).rmse);
assert.equal(calibrate(pairs.slice(0, 3)).scale, 1); // too little history -> unchanged

const f = forecast(1.0, { scale: 1, rmse: 0.6 }, null);
assert.deepEqual([f.direction, f.low, f.high], ['increase', 0.4, 1.6]);
assert.equal(forecast(1.0, { scale: 1, rmse: 0.6 }, [0, 0], CONFIG, { weight: 0.5 }).value, 0.5); // 50/50 blend
assert.equal(forecast(10, { scale: 1, rmse: 2 }, [0, 0], CONFIG, { weight: 0.9 }).value, 1); // published estimate dominates
// A published estimate removes most of the model's own error from the range; unfinished days still count.
const ranged = forecast(0, { scale: 1, rmse: 2 }, [0, 0], CONFIG, { weight: 0.9, sd: 0 });
assert.ok(ranged.high < 1.0);
assert.ok(forecast(0, { scale: 1, rmse: 2 }, [0, 0], CONFIG, { weight: 0.9, sd: 2 }).high > ranged.high);
assert.equal(confidence(5, 10), 'high'); assert.equal(confidence(2, 10), 'low');

// Published estimates: number or [low, high], manual entries win over news.
assert.deepEqual(toRange(-4.7), [-4.7, -4.7]); assert.deepEqual(toRange([-3, -2]), [-3, -2]); assert.equal(toRange(undefined), null); assert.equal(toRange('x'), null); assert.equal(toRange([1, 2, 3]), null);
const picked = pickEstimates({ diesel: -6.4, source: 'FB' }, { diesel: -1, gasoline: -13.25 });
assert.deepEqual(picked.diesel, { range: [-6.4, -6.4], kind: 'manual' }); assert.deepEqual(picked.gasoline, { range: [-13.25, -13.25], kind: 'news' }); assert.equal(picked.kerosene, undefined);


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

// ---- Yahoo bar dates: must read the exchange time zone, daylight saving included ----
const ts = (iso) => Date.parse(iso) / 1000;
assert.equal(barDate(ts('2026-10-26T04:00:00Z')), '2026-10-26'); // Mon 00:00 EDT (was mislabelled Sunday before the fix)
assert.equal(barDate(ts('2026-10-30T04:00:00Z')), '2026-10-30'); // Friday 00:00 EDT (was missing entirely)
assert.equal(barDate(ts('2026-11-02T05:00:00Z')), '2026-11-02'); // Mon 00:00 EST, after clocks change
assert.equal(barDate(ts('2026-10-25T22:00:00Z')), '2026-10-26'); // Sunday 18:00 EDT session open = Monday's trade date
assert.equal(barDate(ts('2026-10-31T04:00:00Z')), null);          // Saturday is not a trading day
assert.equal(barDate(ts('2026-11-01T05:00:00Z')), null);          // Sunday

// ---- Published estimate is reported next to the model ----
const fp = forecast(-3.62, { scale: 1.3, rmse: 3.4 }, [-4.7, -4.7], CONFIG, { weight: 0.5 });
assert.deepEqual([fp.model, fp.published], [-4.71, -4.7]);
assert.ok(Math.abs(fp.value - -4.705) <= 0.01); // 50/50 blend of model and published

// ---- DOE Prior Notice (real text of the 20-26 Oct 2026 PDF; companies with no kerosene leave it blank) ----
const notice = `Gasoline Diesel Kerosene
Shell 9:33 AM
October 19
6:00 AM
October 20 -4.30 2.60 -1.00
City Oil 9:48 AM
October 19
6:00 AM
October 20 -4.30 2.60 -1.00
Petro Gazz 10:48 AM
October 19
6:00 AM
October 20 -4.30 2.60
Seaoil 10:53 AM
October 19
6:00 AM
October 20 -4.30 2.60 -1.00
Total 11:39 AM
October 19
6:00 AM
October 20 -4.30 2.60
Phoenix 12:48 PM
October 19
6:00 AM
October 20 -4.30 2.60
Filpride 6:27 PM
October 19 October 20 -4.30 2.60
Caltex 7:27 PM
October 19
6:01 AM
October 20 -4.30 2.60 -1.00
Flying V 9:09 AM
October 20
6:00 AM
October 20 -4.30 2.60 -1.00
Summary of Prior Notice on Price Adjustments
For the week October 20-26, 2026
Oil Company
Date & Time
Text Message
was received`;
const pn = parseNotice(notice, '2026-10-21');
assert.deepEqual([pn.date, pn.gasoline, pn.diesel, pn.kerosene, pn.rows], ['2026-10-20', -4.3, 2.6, -1, 9]);
assert.equal(parseNotice(notice.replace('October 20-26, 2026', 'October 21-27, 2026')), null); // week must start on a Tuesday
assert.equal(parseNotice('For the week October 27 - November 2, 2026\nShell October 26 6:00 AM October 27 1.10 2.20 3.30\nCity October 27 1.10 2.20 3.30\nSeaoil October 27 1.10 2.20 3.30')?.date, '2026-10-27'); // week spanning two months
// Companies split (no 60% agreement) -> nothing is claimed.
const split = ['A 1.00 2.00 0.50', 'B 1.00 2.00 0.50', 'C 3.00 4.00 0.50', 'D 3.00 4.00 0.50', 'E 5.00 6.00 0.50'].map((r) => 'October 20 ' + r.slice(2)).join('\n');
assert.equal(parseNotice('For the week October 20-26, 2026\n' + split).gasoline ?? null, null);

// recordFromNotices: provisional entry first, then the official Oil Monitor figure replaces it.
const listing = (urls) => urls.map((u) => `<a href="${u}">x</a>`).join('');
const nf = (pdfs) => async (url) => url.includes('price-adjustments') ? { ok: true, status: 200, text: async () => listing(Object.keys(pdfs)) } : { ok: true, status: 200, arrayBuffer: async () => Buffer.from(pdfs[url]) };
actuals = {}; let notices = {};
let nr = await recordFromNotices({ actuals, notices, today: '2026-10-21', fetchImpl: nf({ 'https://x.example/week.pdf': notice }), pdfText });
assert.deepEqual([nr.added, actuals['2026-10-20'].gasoline, actuals['2026-10-20'].provisional], [['2026-10-20'], -4.3, true]);
const om = { 'Oil Monitor 20 October': text(42, '68.85', '64.43', '62.76'), 'Oil Monitor 13 October': text(41, '73.15', '61.83', '63.76') };
ytd = {};
r = await recordFromDoe({ actuals, ytd, today: '2026-10-21', fetchImpl: mkFetch(om), pdfText });
assert.deepEqual([actuals['2026-10-20'].gasoline, actuals['2026-10-20'].diesel, actuals['2026-10-20'].kerosene, actuals['2026-10-20'].provisional], [-4.3, 2.6, -1, undefined]); // 68.85-73.15, 64.43-61.83, 62.76-63.76
assert.equal(r.problems.length, 0); // the two sources agree
// Manual entries are never touched by either source.
actuals = { '2026-10-20': { gasoline: -4.25, diesel: 2.6, kerosene: -1 } }; notices = {};
await recordFromNotices({ actuals, notices, today: '2026-10-21', fetchImpl: nf({ 'https://x.example/week.pdf': notice }), pdfText });
await recordFromDoe({ actuals, ytd: {}, today: '2026-10-21', fetchImpl: mkFetch(om), pdfText });
assert.equal(actuals['2026-10-20'].gasoline, -4.25);

// ---- Yahoo bars: only settled sessions count; a live evening-session bar must not stand in for a trade date ----
const yres = (bars) => ({ meta: { exchangeTimezoneName: 'America/New_York' }, timestamp: bars.map((b) => Date.parse(b[0]) / 1000), indicators: { quote: [{ close: bars.map((b) => b[1]) }] } });
const evening = yres([['2026-11-09T05:00:00Z', 4.2148], ['2026-11-10T05:00:00Z', null], ['2026-11-11T02:53:00Z', 4.1672]]); // real Yahoo shape at 22:05 ET on Nov 10
assert.deepEqual(settledBars(evening, Date.parse('2026-11-11T03:05:00Z')), { '2026-11-09': 4.2148 });
const settled = yres([['2026-11-09T05:00:00Z', 4.2148], ['2026-11-10T05:00:00Z', 4.14]]);
assert.deepEqual(settledBars(settled, Date.parse('2026-11-10T20:30:00Z')), { '2026-11-09': 4.2148, '2026-11-10': 4.14 }); // 15:30 ET, after the 14:30 settlement
assert.deepEqual(settledBars(settled, Date.parse('2026-11-10T16:00:00Z')), { '2026-11-09': 4.2148 }); // 11:00 ET, still trading
assert.equal(latestSettleDate(Date.parse('2026-11-11T03:05:00Z')), '2026-11-10');
assert.equal(latestSettleDate(Date.parse('2026-11-10T16:00:00Z')), '2026-11-09');
assert.equal(latestSettleDate(Date.parse('2026-11-09T14:00:00Z')), '2026-11-06'); // Monday morning looks back to Friday
assert.equal(latestSettleDate(Date.parse('2026-11-14T10:00:00Z')), '2026-11-13'); // Saturday
// When the daily bar has no close yet, the 14:25 ET five-minute bar (closing at the 14:30 settlement) stands in.
const m5 = yres([['2026-11-10T19:20:00Z', 4.13], ['2026-11-10T19:25:00Z', 4.132], ['2026-11-10T19:30:00Z', 4.14], ['2026-11-11T00:00:00Z', 4.15], ['2026-11-09T19:25:00Z', 4.2175]]);
assert.equal(intradayClose(m5, '2026-11-10'), 4.132);
assert.equal(intradayClose(m5, '2026-11-12'), null);

// ---- Published estimates in the news (real headlines, Google News RSS) ----
const fc = (title, iso) => parseEstimate(title, iso);
assert.deepEqual(fc('OIL PRICE WATCH: Gasoline may plunge by P14/L next week - ABS-CBN', '2026-11-07T04:14:00Z'), { gasoline: -14 });
assert.deepEqual(fc('Pump price rollback: P13 for gas, P4 for diesel - Philstar.com', '2026-11-06T16:00:00Z'), { gasoline: -13, diesel: -4 });
assert.deepEqual(fc('Gasoline seen plunging P13.50 as oil markets ease - Daily Tribune', '2026-11-06T15:54:00Z'), { gasoline: -13.5 });
assert.deepEqual(fc('Gasoline prices may crash by up to ₱13 next week - Manila Bulletin', '2026-11-06T02:20:00Z'), { gasoline: -13 });
assert.deepEqual(fc('Up to P1/liter diesel rollback, over P2/liter hike in gasoline expected next week - GMA Network', '2026-10-31T07:00:00Z'), { diesel: -1, gasoline: 2 });
assert.deepEqual(fc('Diesel prices seen to go up by P2 to P3 per liter, gasoline rollback P0.50 to P1 per liter —source - GMA Network', '2026-10-24T07:00:00Z'), { diesel: [2, 3], gasoline: [-1, -0.5] });
assert.deepEqual(fc('Diesel prices are set to rise by P2.88/L, while gasoline prices are set to go down by P1.07/L. Link to the full story in the comments section. | via ANC 24/7 - Facebook', '2026-10-23T07:00:00Z'), { diesel: 2.88, gasoline: -1.07 });
assert.deepEqual(fc('Rollback seen next week: gasoline P4.70, diesel P6.40 and kerosene P6.90', '2026-11-12T08:00:00Z'), { gasoline: -4.7, diesel: -6.4, kerosene: -6.9 }); // each fuel keeps its own amount
assert.deepEqual(fc('Gasoline price may drop by P1.20 and diesel by P2.50 next week', '2026-11-12T08:00:00Z'), { gasoline: -1.2, diesel: -2.5 });
assert.deepEqual(fc('Diesel P6.40 and gasoline P4.70 rollback seen next week', '2026-11-12T08:00:00Z'), { diesel: -6.4, gasoline: -4.7 });
// Not forecasts: this week's announced change, no fuel named, no amount.
assert.equal(fc('Nearly P17/liter gasoline price cut set this week - Inquirer.net', '2026-11-09T05:14:00Z'), null);
assert.equal(fc('Gasoline prices set for P3.50-per-liter hike - Inquirer.net', '2026-11-02T04:29:00Z'), null);
assert.equal(fc('OIL PRICE WATCH: Gasoline falls almost P17, diesel down more than P4 - ABS-CBN', '2026-11-10T00:46:00Z'), null);
assert.equal(fc('Pump price rollbacks of up to P14 per liter seen next week - GMA Network', '2026-11-06T01:51:00Z'), null);
assert.equal(fc('Gasoline rebound erases rollback gains - Daily Tribune', '2026-10-31T07:00:00Z'), null);

const rss = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Gasoline may plunge by P14/L &amp; more - ABS-CBN]]></title><link>https://x.example/a</link><pubDate>Sat, 07 Nov 2026 04:14:00 GMT</pubDate><source url="https://abs-cbn.com">ABS-CBN</source></item><item><title>No date here</title></item></channel></rss>`;
assert.deepEqual(parseRss(rss), [{ title: 'Gasoline may plunge by P14/L & more', source: 'ABS-CBN', published: '2026-11-07T04:14:00.000Z', link: 'https://x.example/a' }]);

const item = (title, published) => ({ title, published, source: 'x', link: 'l' });
const news = estimatesFromNews([
  item('OIL PRICE WATCH: Gasoline may plunge by P14/L next week - ABS-CBN', '2026-11-07T04:14:00Z'),
  item('Pump price rollback: P13 for gas, P4 for diesel - Philstar.com', '2026-11-06T16:00:00Z'),
  item('Gasoline seen plunging P13.50 as oil markets ease - Daily Tribune', '2026-11-06T15:54:00Z'),
  item('Gasoline prices may crash by up to ₱13 next week - Manila Bulletin', '2026-11-06T02:20:00Z'),
  item('Gasoline seen plunging P2 next week - Somewhere', '2026-11-06T02:20:00Z'), // outlier, no corroboration
  item('Nearly P17/liter gasoline price cut set this week - Inquirer.net', '2026-11-09T05:14:00Z'),
]);
assert.deepEqual(Object.keys(news), ['2026-11-10']);
assert.equal(news['2026-11-10'].gasoline, -13.25); // median of the agreeing headlines
assert.equal(news['2026-11-10'].diesel, undefined); // a single headline is not enough
assert.ok(news['2026-11-10'].items.length >= 4);

console.log('All tests passed');
