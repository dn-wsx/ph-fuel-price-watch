import assert from 'node:assert/strict';
import * as news from './news.mjs';
import * as doe from './doe.mjs';
import { healthProblems } from './health.mjs';

assert.equal(typeof news.announcementsFromNews, 'function', 'announced actuals need an independent, conservative parser');
const item = (title, sourceUrl = 'https://www.gmanetwork.com', published = '2026-11-09T05:00:00Z') =>
  ({ title, sourceUrl, source: new URL(sourceUrl).hostname, published, link: `${sourceUrl}/announcement` });
const announced = 'Gasoline down P4.70, diesel down P6.40, kerosene down P6.90 effective Tuesday';
const agree = [item(announced), item(announced, 'https://www.philstar.com')];
const actuals = news.announcementsFromNews(agree, '2026-11-10');
assert.equal(actuals['2026-11-10'].gasoline, -4.7);
assert.equal(actuals['2026-11-10'].provisional, true);
assert.equal(actuals['2026-11-10'].items.length, 2);
for (const title of [
  announced.replace('down P4.70', 'may fall P4.70'),
  announced.replace('down P4.70', 'down up to P4.70'),
  announced.replace('P4.70', 'P4.70-P5.00'),
  announced.replace('effective Tuesday', 'next week'),
  announced.replace('Tuesday', 'Tuesday, November 17'),
  announced.replace('Tuesday', 'Tuesday, November 31'),
  announced.replace('Tuesday', 'Tuesday, November 10, 2025'),
  announced.replace('Tuesday', 'Tuesday, November 10 2025'),
]) assert.equal(news.announcementsFromNews([item(title), item(title, 'https://www.philstar.com')], '2026-11-10')['2026-11-10'], undefined, title);
assert.deepEqual(news.announcementsFromNews([agree[0], agree[0]], '2026-11-10'), {});
assert.deepEqual(news.announcementsFromNews([item(announced, 'https://facebook.com'), agree[0]], '2026-11-10'), {});
assert.deepEqual(news.announcementsFromNews([item(announced, 'https://gmanetwork.com.evil.example'), agree[1]], '2026-11-10'), {});
assert.deepEqual(news.announcementsFromNews(agree, '2026-11-09'), {});
assert.deepEqual(news.announcementsFromNews(agree.map((x) => ({ ...x, published: '2026-11-13T04:00:00Z' })), '2026-11-13'), {});
const disagree = news.announcementsFromNews([agree[0], item(announced.replace('P4.70', 'P5.70'), 'https://www.philstar.com')], '2026-11-10');
assert.equal(disagree['2026-11-10'].gasoline, undefined);
assert.equal(disagree['2026-11-10'].diesel, -6.4);
const announcementProblems = [];
news.announcementsFromNews([agree[0], item(announced.replace('P4.70', 'P5.70'), 'https://www.philstar.com')], '2026-11-10', announcementProblems);
assert.match(announcementProblems[0], /gasoline.*conflict/i);
assert.equal(news.announcementsFromNews([
  item(announced.replace('Tuesday', 'Tuesday, May 12'), 'https://www.gmanetwork.com', '2026-05-11T05:00:00Z'),
  item(announced.replace('Tuesday', 'Tuesday, May 12'), 'https://www.philstar.com', '2026-05-11T05:00:00Z'),
], '2026-05-12')['2026-05-12'].gasoline, -4.7);
assert.deepEqual(news.announcementsFromNews([item('Gasoline and diesel down P4.70 effective Tuesday'), item('Gasoline and diesel down P4.70 effective Tuesday', 'https://www.philstar.com')], '2026-11-10'), {});
assert.equal(news.parseRss('<item><title>x</title><pubDate>Mon, 09 Nov 2026 05:00:00 GMT</pubDate><source url="https://www.philstar.com">Philstar</source></item>')[0].sourceUrl, 'https://www.philstar.com');

assert.equal(typeof doe.parseBenchmarks, 'function', 'DOE benchmarks must be parsed separately from peso actuals');
const report = `As of 03 November 2026
WORLD OIL PRICES
October 26 - 30, 2026, Trading Days
Week-on-week, Dubai crude oil prices increased by approximately US$3.40.
International gasoline prices increased by around US$2.80 per barrel, while diesel prices decreased by approximately US$4.00 per barrel.
Crude Oil Prices`;
assert.deepEqual(doe.parseBenchmarks(report), { current: ['2026-10-26', '2026-10-30'], changes: { gasoline: 2.8, diesel: -4 } });
assert.deepEqual(doe.parseBenchmarks(report.replace(/International[\s\S]*?Crude/, 'Gasoline, diesel and kerosene prices decreased by US$2.80, US$4.00 and US$5.00 per barrel, respectively. Crude')).changes, { gasoline: -2.8, diesel: -4, kerosene: -5 });
assert.deepEqual(doe.parseBenchmarks('Prices may increase by US$2.00 next week.'), null);
assert.equal(doe.parseBenchmarks(report.replace('US$2.80', 'US$2.80-3.00')).changes.gasoline, undefined);
assert.equal(doe.parseBenchmarks(report.replace('US$2.80', 'US$2.80 to US$3.00')).changes.gasoline, undefined);
assert.equal(doe.parseBenchmarks(report.replace('increased by around', 'may increase by around')).changes.gasoline, undefined);
assert.equal(doe.parseBenchmarks(report.replace('October 26 - 30', 'October 27 - November 2')).current[1], '2026-11-02');
const week = (mon, value) => Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`2026-10-${String(mon + i).padStart(2, '0')}`, value]));
const series = {
  MOPS92: { ...week(19, 100), ...week(26, 102.8) },
  MOPSD: { ...week(19, 150), ...week(26, 146) },
};
const cache = { '2026-11-03': { ...doe.parseBenchmarks(report), source: 'https://doe.gov.ph/report.pdf' } };
const checks = doe.benchmarkChecks(cache, series);
assert.equal(checks[0].status, 'matched');
assert.equal(checks[0].fuels.gasoline.difference, 0);
assert.equal(checks[0].fuels.kerosene, undefined);
assert.equal(doe.benchmarkChecks(cache, { ...series, MOPS92: { ...week(19, 100), ...week(26, 110) } })[0].status, 'mismatch');
assert.equal(doe.benchmarkChecks(cache, {})[0].status, 'insufficient-data');
assert.equal(doe.benchmarkChecks({ '2026-11-03': { ...cache['2026-11-03'], current: ['2026-10-27', '2026-11-02'] } }, series)[0].status, 'report-window-mismatch');
assert.equal(doe.benchmarkChecks({ '2026-11-03': { source: 'https://doe.gov.ph/report.pdf', changes: {} } }, series)[0].status, 'unavailable');
assert.deepEqual(healthProblems({ fuels: { gasoline: {} }, benchmark: { checks: [{ date: '2026-11-03', status: 'mismatch' }] } }), []);
assert.deepEqual(healthProblems({ fuels: { gasoline: {} }, benchmark: { checks: [{ date: '2026-11-03', status: 'matched' }, { date: '2026-10-27', status: 'report-window-mismatch' }] } }), []);

console.log('Announcement and benchmark tests passed');
