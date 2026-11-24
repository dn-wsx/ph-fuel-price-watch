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
assert.deepEqual(news.parseAnnouncementText(
  'In separate advisories, Petron, Seaoil and Shell said they will roll back prices per liter of gasoline by P3.00, diesel by P2.60, and kerosene by P1.60. The adjustments will take effect at 6 a.m. on Tuesday, November 24, 2026.',
  '2026-11-24',
), { gasoline: -3, diesel: -2.6, kerosene: -1.6 });
assert.deepEqual(news.parseAnnouncementText(
  'PUMP prices dropped on Tuesday. The prices of diesel are down by P2.60 per liter, gasoline by P3 per liter, and kerosene by P1.60 per liter.',
  '2026-11-24',
), { gasoline: -3, diesel: -2.6, kerosene: -1.6 });
assert.deepEqual(news.parseAnnouncementText(
  'Motorists will see another round of fuel price rollbacks on Tuesday, November 24, with gasoline prices dropping by P3 per liter, diesel by P2.60, and kerosene by P1.60.',
  '2026-11-24',
), { gasoline: -3, diesel: -2.6, kerosene: -1.6 });
assert.equal(news.parseAnnouncementText(
  'Motorists may see rollbacks of gasoline by P3 to P4 per liter and diesel by P2.60 effective Tuesday, November 24, 2026.',
  '2026-11-24',
), null);
assert.equal(news.parseAnnouncementText(
  'The price of gasoline may drop P3 per liter and diesel may drop P2.60 per liter starting Tuesday, November 24, 2026.',
  '2026-11-24',
), null);
assert.equal(news.parseAnnouncementText(
  'Gasoline will drop P3 per liter and diesel will drop P2.60 per liter effective Tuesday, November 17, 2026.',
  '2026-11-24',
), null);
assert.equal(news.parseAnnouncementText(
  'Officials estimate that gasoline could be down P3 per liter and diesel could be down P2.60 per liter effective Tuesday.',
  '2026-11-24',
), null);
assert.deepEqual(news.parseAnnouncementText(
  'In separate advisories, Petron Corp., Seaoil Philippines Corp. and Shell Pilipinas Corp. said they will roll back prices per liter of gasoline by P3.00, diesel by P2.60, and kerosene by P1.60. The adjustments will take effect at 6 a.m. on Tuesday, November 24.',
  '2026-11-24',
), { gasoline: -3, diesel: -2.6, kerosene: -1.6 });
assert.deepEqual(news.parseAnnouncementText(
  'The Department of Energy announced the following changes on Sunday, November 22: Diesel - down P2.60 per liter; Gasoline - down P3 per liter; Kerosene - down P1.60 per liter. The new price adjustments will take effect Tuesday, November 24.',
  '2026-11-24',
), { gasoline: -3, diesel: -2.6, kerosene: -1.6 });
assert.deepEqual(news.parseAnnouncementText(
  'PUMP prices dropped on Tuesday for the third straight week. The prices of diesel are down by P2.60 per liter, gasoline by P3 per liter, and kerosene by P1.60 per liter.',
  '2026-11-24',
), { gasoline: -3, diesel: -2.6, kerosene: -1.6 });
assert.deepEqual(news.parseAnnouncementText(
  'Motorists will see another round of fuel price rollbacks on Tuesday, with gasoline prices dropping by P3 per liter, diesel by P2.60, and kerosene by P1.60.',
  '2026-11-24',
), { gasoline: -3, diesel: -2.6, kerosene: -1.6 });
assert.equal(news.supportedPublisher('https://www.gmanetwork.com/news/money/companies/1010465/story'), 'gmanetwork.com');
assert.equal(news.supportedPublisher('https://business.inquirer.net/622578/diesel-gasoline-prices-down-anew'), 'inquirer.net');
assert.equal(news.supportedPublisher('https://www.manilatimes.net/2026/11/24/news/national/fuel/story'), 'manilatimes.net');
assert.equal(news.supportedPublisher('https://www.philstar.com/headlines/2026/11/24/story'), 'philstar.com');
assert.equal(news.supportedPublisher('https://news.google.com/rss/articles/opaque'), null);
assert.equal(news.supportedPublisher('javascript:alert(1)'), null);
assert.equal(await news.resolveArticleUrl('https://news.google.com/rss/articles/opaque', async () => new Response(''), 'gmanetwork.com'), null);
assert.equal(await news.resolveArticleUrl('javascript:alert(1)', async () => new Response(''), 'gmanetwork.com'), null);
assert.equal(await news.resolveArticleUrl(
  'https://www.gmanetwork.com/news/money/story',
  async (url, init) => {
    assert.equal(init.redirect, 'manual');
    return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
  },
  'gmanetwork.com',
), 'https://www.gmanetwork.com/news/money/story');
assert.equal(await news.resolveArticleUrl(
  'https://www.gmanetwork.com/news/money/story',
  async () => new Response('', { status: 403 }),
  'gmanetwork.com',
), null);
const gmaFeed = `<rss><channel><item><title>Gasoline pump prices down P3.00 Tuesday</title><link>https://www.gmanetwork.com/news/money/story</link><pubDate>Mon, 23 Nov 2026 04:24:31 GMT</pubDate><description>Fuel update</description></item></channel></rss>`;
const philstarFeed = `<rss><channel><item><title>Gasoline diesel kerosene rollbacks</title><link>https://www.philstar.com/headlines/story</link><pubDate>Tue, 24 Nov 2026 01:00:00 GMT</pubDate><description>Fuel update</description></item></channel></rss>`;
const articleFeedResult = news.parsePublisherFeed(gmaFeed, 'gmanetwork.com');
assert.equal(articleFeedResult[0].sourceUrl, 'https://www.gmanetwork.com/news/money/story');
assert.equal(articleFeedResult[0].publisher, 'gmanetwork.com');
const discovered = await news.fetchAnnouncementArticles({
  today: '2026-11-24',
  fetchImpl: async (url, init) => {
    if (url === news.ARTICLE_FEEDS.find((x) => x.publisher === 'inquirer.net').url) return new Response(`<rss><channel><item><title>Fuel prices down anew</title><link>https://business.inquirer.net/622578/diesel-gasoline-prices-down-anew</link><pubDate>Tue, 24 Nov 2026 02:15:00 GMT</pubDate><description>Motorists will enjoy another round of fuel price rollbacks on Tuesday. Gasoline and diesel prices will decrease by P3 and P2.60 per liter, respectively. Kerosene prices will also be reduced by P1.60.</description></item></channel></rss>`);
    throw new Error(`Unexpected fixture request: ${url}`);
  },
});
assert.equal(discovered.items.length, 1);
assert.deepEqual(discovered.problems, []);
const articleItem = (publisher, values, date = '2026-11-24') => ({
  publisher,
  sourceUrl: `https://${publisher}/article`,
  link: `https://${publisher}/article`,
  title: 'Pump price adjustment',
  published: `${date}T04:00:00Z`,
  date,
  values,
});
const articleActuals = news.announcementsFromArticles([
  articleItem('gmanetwork.com', { gasoline: -3, diesel: -2.6, kerosene: -1.6 }),
  articleItem('philstar.com', { gasoline: -3, diesel: -2.6, kerosene: -1.6 }),
], '2026-11-24');
assert.equal(articleActuals['2026-11-24'].gasoline, -3);
assert.equal(articleActuals['2026-11-24'].diesel, -2.6);
assert.equal(articleActuals['2026-11-24'].kerosene, -1.6);
assert.equal(articleActuals['2026-11-24'].provisional, true);
assert.equal(articleActuals['2026-11-24'].items.length, 2);
assert.deepEqual(news.announcementsFromArticles([
  articleItem('gmanetwork.com', { gasoline: -3 }),
  articleItem('gmanetwork.com', { gasoline: -3 }),
], '2026-11-24'), {});
assert.deepEqual(news.announcementsFromArticles([
  articleItem('inquirer.net', { gasoline: -3, diesel: -2.6, kerosene: -1.6 }),
], '2026-11-24'), {});
const conflictProblems = [];
assert.equal(news.announcementsFromArticles([
  articleItem('gmanetwork.com', { gasoline: -3 }),
  articleItem('philstar.com', { gasoline: -4 }),
], '2026-11-24', conflictProblems)['2026-11-24'], undefined);
assert.match(conflictProblems[0], /2026-11-24 gasoline.*conflict/i);

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

assert.equal(news.newsCrosscheckStatus('2026-11-24', { estimates: {} }, null).status, 'pending');
assert.equal(news.newsCrosscheckStatus('2026-11-24', { estimates: { '2026-11-24': { gasoline: -3, items: [] } } }, null).status, 'current');
assert.equal(news.newsCrosscheckStatus('2026-11-24', { estimates: { '2026-11-17': { gasoline: -1.5, items: [] } } }, null).status, 'stale');
assert.equal(news.newsCrosscheckStatus('2026-11-24', { estimates: {} }, 'News headlines could not be read').status, 'unavailable');
assert.equal(news.newsCrosscheckStatus('2026-11-24', null, null).status, 'unavailable');

assert.deepEqual(news.mergeNewsItems([
  { title: 'One', source: 'GMA Network', link: 'https://gma.example/a', published: '2026-11-12T04:00:00Z' },
  { title: 'Duplicate', source: 'GMA Network', link: 'https://gma.example/a', published: '2026-11-12T04:00:00Z' },
  { title: 'Two', source: 'Philstar.com', link: 'https://philstar.example/b', published: '2026-11-12T05:00:00Z' },
]), [
  { title: 'Two', source: 'Philstar.com', link: 'https://philstar.example/b', published: '2026-11-12T05:00:00Z' },
  { title: 'One', source: 'GMA Network', link: 'https://gma.example/a', published: '2026-11-12T04:00:00Z' },
]);

console.log('Announcement and benchmark tests passed');
