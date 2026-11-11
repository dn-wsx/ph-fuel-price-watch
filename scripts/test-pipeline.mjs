import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addDays, CONFIG, fuelChange, windows, forecast, calibrate } from './model.mjs';
import { parseOpinet } from './market.mjs';
import { ANNOUNCEMENTS_URL } from './news.mjs';
import { runUpdate, PUBLIC_FORECAST_URL } from './update.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/updater.json', import.meta.url), 'utf8'));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fuel-pipeline-'));
const dataDir = pathToFileURL(dir + path.sep);
const read = async (name) => JSON.parse(await fs.readFile(new URL(name, dataDir), 'utf8'));
const save = (name, value) => fs.writeFile(new URL(name, dataDir), JSON.stringify(value));
const prices = Object.fromEntries(['MOPS92', 'MOPSD', 'MOPSK'].map((key) => [key, {}]));
const keys = { gasoline: 'MOPS92', diesel: 'MOPSD', kerosene: 'MOPSK' };
for (const week of fixture.weeks) {
  for (let i = 0; i < week.days; i++) {
    for (const [fuel, key] of Object.entries(keys)) prices[key][addDays(week.monday, i)] = week[fuel] + (week.days === 2 ? i * 2 : 0);
  }
}
const opinetHtml = '<tbody id="tbody2">' + Object.keys(prices.MOPS92).map((date) =>
  `<tr><td>${date.slice(2, 4)}년${date.slice(5, 7)}월${date.slice(8)}일</td><td>120</td><td>${prices.MOPS92[date]}</td><td>${prices.MOPSK[date]}</td><td>${prices.MOPSD[date]}</td></tr>`).join('') + '</tbody>';
const marketLoaders = {
  opinet: async () => parseOpinet(opinetHtml),
  usdphp: async () => ({ '2026-10-01': fixture.fx }),
  yahoo: async (symbol) => Object.fromEntries(Object.keys(prices.MOPS92).map((d) => [d, symbol.startsWith('BZ') ? (d < '2026-11-09' ? 100 : 90) : (d < '2026-11-09' ? 4 : 3.8)])),
};
const xml = (title, host, date = 'Mon, 09 Nov 2026 05:00:00 GMT') =>
  `<item><title>${title}</title><source url="https://${host}">${host}</source><link>https://${host}/fuel</link><pubDate>${date}</pubDate></item>`;
const reports = { ...fixture.reports };
let publicPayload = {};
const fetchImpl = async (url) => {
  if (url === PUBLIC_FORECAST_URL) return new Response(JSON.stringify(publicPayload));
  let body;
  if (url.includes('oil-monitor')) body = Object.values(reports).map((r) => `<a href="https://doe.gov.ph/${encodeURIComponent(r.name)}.pdf">report</a>`).join('');
  else if (url.endsWith('.pdf')) body = Object.values(reports).find((r) => url.includes(encodeURIComponent(r.name)))?.text ?? fixture.notice;
  else if (url.includes('price-adjustments')) body = '<a href="https://doe.gov.ph/notice.pdf">notice</a>';
  else if (url === ANNOUNCEMENTS_URL) body = xml(fixture.announcement, 'gmanetwork.com') + xml(fixture.announcement, 'philstar.com');
  else if (url.startsWith('https://news.google.com/rss/')) body = xml('Gasoline may fall P4.50 next week', 'gmanetwork.com', 'Tue, 10 Nov 2026 04:00:00 GMT') + xml('Gasoline may fall P4.50 next week', 'philstar.com', 'Tue, 10 Nov 2026 04:00:00 GMT');
  else throw new Error(`Unexpected fixture request: ${url}`);
  return { ok: true, text: async () => body, arrayBuffer: async () => Buffer.from(body) };
};
const options = { dataDir, today: fixture.asOf, now: Date.parse(fixture.now), clock: () => Date.parse(fixture.now), marketLoaders, fetchImpl, pdfText: (buf) => buf.toString() };
try {
  const previous = { '2026-11-10': { gasoline: { value: -4 }, snapshots: { 5: { at: '2026-11-09T08:00:00Z', gasoline: -4 } } }, '2026-11-17': { snapshots: { 1: { at: '2026-11-10T08:00:00Z', gasoline: -4 } } } };
  await save('forecast-log.json', previous);
  await runUpdate(options);
  let output = await read('forecast.json');
  assert.equal(output.target, '2026-11-17');
  assert.equal(output.generatedAt, new Date(fixture.now).toISOString());
  assert.equal(output.basis, 'singapore');
  assert.deepEqual(Object.keys(output.fuels).sort(), ['diesel', 'gasoline', 'kerosene']);
  for (const fuel of Object.keys(keys)) {
    assert.equal(output.fuels[fuel].value, -3.43);
    assert.equal(output.fuels[fuel].daysOfData, 2);
    assert.ok(output.fuels[fuel].low < output.fuels[fuel].value && output.fuels[fuel].value < output.fuels[fuel].high);
  }
  assert.equal(output.fuels.gasoline.news, -4.5);
  assert.equal((await read('actuals.json'))['2026-11-10'].provisional, true);
  assert.equal(output.history.find((r) => r.date === '2026-11-10').provisional, true);
  assert.equal(output.history.find((r) => r.date === '2026-11-03').provisional, false);
  assert.equal(output.benchmark.checks[0].status, 'matched');
  assert.equal(output.benchmark.checks[0].fuels.gasoline.opinet, 10);
  assert.equal(output.market.mogas.through, '2026-11-10');
  assert.equal(output.market.fx.through, '2026-10-01');
  assert.deepEqual((await read('forecast-log.json'))['2026-11-10'], previous['2026-11-10']);
  assert.deepEqual((await read('forecast-log.json'))['2026-11-17'].snapshots['1'], previous['2026-11-17'].snapshots['1']);
  assert.equal((await read('forecast-log.json'))['2026-11-17'].snapshots['2'].gasoline, -3.43);
  assert.equal(output.liveTrack.weeks, 0);
  assert.equal(output.accuracy.gasoline.weeks, 1);
  assert.equal(output.publicationTiming.observations, 0);
  publicPayload = output;

  reports['2026-11-10'] = { name: 'Oil Monitor 10 November 2026', text: fixture.promotion };
  await runUpdate(options);
  const promoted = (await read('actuals.json'))['2026-11-10'];
  assert.equal(promoted.provisional, undefined);
  assert.equal(promoted.gasoline, -4.7);
  assert.match(promoted.source, /Oil Monitor/);
  assert.equal((await read('forecast.json')).liveTrack.weeks, 0); // legacy snapshots have no proof of publication
  assert.equal((await read('forecast-log.json'))['2026-11-17'].records[0].publishedObservedAt, new Date(fixture.now).toISOString());
  const savedActuals = await read('actuals.json');
  savedActuals['2026-11-10'] = { gasoline: -4.65, source: 'Manual correction' };
  await save('actuals.json', savedActuals);
  await runUpdate(options);
  assert.equal((await read('actuals.json'))['2026-11-10'].gasoline, -4.65);

  await runUpdate({ ...options, marketLoaders: { ...marketLoaders, opinet: async () => parseOpinet('<tbody id="tbody2"></tbody>') } });
  output = await read('forecast.json');
  assert.ok(output.errors.some((e) => e.startsWith('Opinet:')));
  assert.equal(output.basis, 'singapore');
  assert.equal(output.fuels.gasoline.value, -3.43);
  assert.equal(output.market.mogas.through, '2026-11-10'); // cached quote date stays visible after a failed refresh

  const cachedFx = (await read('market.json')).series.USDPHP;
  await runUpdate({ ...options, marketLoaders: { ...marketLoaders, usdphp: async () => ({}) } });
  assert.deepEqual((await read('market.json')).series.USDPHP, cachedFx);
  assert.ok((await read('forecast.json')).errors.some((e) => e.startsWith('USDPHP:')));

  const market = await read('market.json');
  for (const key of Object.keys(keys).map((fuel) => keys[fuel])) delete market.series[key];
  await save('market.json', market);
  await runUpdate({ ...options, marketLoaders: { ...marketLoaders, opinet: async () => { throw new Error('fixture outage'); } } });
  output = await read('forecast.json');
  assert.equal(output.basis, 'us-unreadable');
  assert.equal(output.confidence, 'low');
  assert.equal(output.fuels.diesel.source, 'us');
  const rc = fuelChange('diesel', market.series, market.series.USDPHP, windows(fixture.asOf), CONFIG, 'us');
  assert.equal(output.fuels.diesel.value, forecast(rc.raw, calibrate([])).value);
  assert.ok(output.fuels.diesel.high - output.fuels.diesel.low >= 5);

  const manyActuals = {};
  const longSeries = { USDPHP: { '2026-01-01': 58 }, MOPSD: {}, 'HO=F': {} };
  for (let week = 0; week < 11; week++) {
    const monday = addDays('2026-08-31', week * 7);
    for (let i = 0; i < (week === 10 ? 2 : 5); i++) {
      longSeries.MOPSD[addDays(monday, i)] = 100 + week * 10;
      longSeries['HO=F'][addDays(monday, i)] = 2 + week * 0.1;
    }
    if (week > 0 && addDays(monday, 8) <= fixture.asOf) manyActuals[addDays(monday, 8)] = { diesel: 0.1 / CONFIG.litersPerGallon * 58 * CONFIG.vat * 0.8 };
  }
  await save('actuals.json', manyActuals);
  await save('market.json', { series: longSeries });
  const fallbackLoaders = { ...marketLoaders, usdphp: async () => longSeries.USDPHP, yahoo: async (s) => s.startsWith('HO') ? longSeries['HO=F'] : {}, opinet: async () => ({ MOPSD: longSeries.MOPSD, MOPS92: {}, MOPSK: {} }) };
  await runUpdate({ ...options, marketLoaders: fallbackLoaders });
  const withSingapore = (await read('forecast.json')).fuels.diesel.scale;
  delete longSeries.MOPSD;
  await save('market.json', { series: longSeries });
  await runUpdate({ ...options, marketLoaders: { ...fallbackLoaders, opinet: async () => { throw new Error('fixture outage'); } } });
  const fallback = (await read('forecast.json')).fuels.diesel;
  assert.ok(fallback.calibrationWeeks >= 6);
  assert.ok(fallback.scale > 0.8 && fallback.scale < 1);
  assert.notEqual(fallback.scale, withSingapore);

  await fs.writeFile(new URL('actuals.json', dataDir), '{ broken');
  await assert.rejects(runUpdate(options), SyntaxError);
  console.log('Offline updater integration tests passed');
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
