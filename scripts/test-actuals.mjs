import assert from 'node:assert/strict';
import { mergeActual, sourceFor, confirmed } from './actuals.mjs';
import { recordFromDoe, recordFromNotices } from './doe.mjs';

const news = { kind: 'news', source: 'News announcements', provisional: true, items: [{ link: 'https://news.example/gas' }] };
const notice = { kind: 'notice', source: 'DOE company filings', sourceUrl: 'https://doe.gov.ph/notice.pdf', provisional: true };
const official = { kind: 'official', source: 'DOE Oil Monitor', sourceUrl: 'https://doe.gov.ph/monitor.pdf', provisional: false };
let entry = mergeActual({}, { gasoline: -4 }, news);
entry = mergeActual(entry, { diesel: -6, kerosene: -7 }, notice);
assert.equal(sourceFor(entry, 'gasoline').kind, 'news');
assert.equal(sourceFor(entry, 'kerosene').sourceUrl, notice.sourceUrl);
assert.equal(confirmed(entry, 'gasoline'), false);
entry = mergeActual(entry, { gasoline: -4.1 }, notice);
assert.equal(entry.gasoline, -4.1);
entry = mergeActual(entry, { gasoline: -4.05 }, { kind: 'manual', source: 'Manual override', provisional: false });
entry = mergeActual(entry, { gasoline: -5, diesel: -6.1, kerosene: -7.1 }, official);
assert.equal(entry.gasoline, -4.05);
assert.equal(entry.diesel, -6.1);
assert.equal(confirmed(entry, 'gasoline'), true);
assert.equal(confirmed(entry, 'diesel'), true);
assert.equal(entry.provisional, undefined);
assert.equal(sourceFor(entry, 'gasoline').kind, 'manual');
assert.equal(sourceFor({ gasoline: 1 }, 'gasoline').kind, 'manual');
assert.equal(confirmed({ gasoline: 1, provisional: true }, 'gasoline'), false);
assert.equal(confirmed({ gasoline: 1, diesel: 2, fuelSources: { gasoline: news, diesel: official } }, 'diesel'), true);

const actuals = {};
const ytd = {};
const benchmarks = {};
let downloads = 0, revision = false;
const fetchImpl = async (url) => {
  if (url.includes('oil-monitor')) return new Response('<a href="https://doe.gov.ph/Oil%20Monitor%2006%20January%202026.pdf">report</a>');
  downloads++;
  return new Response(`The 1st price movement resulted in a total net increase of P${revision ? '0.30' : '0.20'}/liter for gasoline, P0.40/liter for diesel and P0.10/liter for kerosene.`);
};
const options = { actuals, ytd, benchmarks, today: '2026-01-07', fetchImpl, pdfText: (buf) => buf.toString() };
await recordFromDoe(options);
const originalHash = benchmarks['2026-01-06'].sha256;
assert.match(originalHash, /^[a-f0-9]{64}$/);
await recordFromDoe(options);
assert.equal(downloads, 1);
revision = true;
await recordFromDoe({ ...options, today: '2026-01-08' });
assert.equal(downloads, 2);
assert.notEqual(benchmarks['2026-01-06'].sha256, originalHash);
assert.equal(actuals['2026-01-06'].gasoline, 0.3);
actuals['2026-01-06'] = mergeActual(actuals['2026-01-06'], { diesel: 0.45 }, { kind: 'manual', source: 'Manual override', provisional: false });
revision = false;
await recordFromDoe({ ...options, today: '2026-01-09' });
assert.equal(actuals['2026-01-06'].gasoline, 0.2);
assert.equal(actuals['2026-01-06'].diesel, 0.45);

const mixed = { '2026-01-06': mergeActual({}, { gasoline: 0.2 }, news) };
await recordFromNotices({
  actuals: mixed, notices: {}, today: '2026-01-07', pdfText: (buf) => buf.toString(),
  fetchImpl: async (url) => new Response(url.includes('price-adjustments') ? '<a href="https://doe.gov.ph/notice.pdf">notice</a>' : 'For the week January 6-12, 2026\nShell January 6 0.20 0.40 0.10\nSeaoil January 6 0.20 0.40 0.10\nCaltex January 6 0.20 0.40 0.10'),
});
assert.equal(sourceFor(mixed['2026-01-06'], 'kerosene').kind, 'notice');
assert.equal(sourceFor(mixed['2026-01-06'], 'gasoline').kind, 'notice');
console.log('Per-fuel actual provenance and report revision tests passed');
