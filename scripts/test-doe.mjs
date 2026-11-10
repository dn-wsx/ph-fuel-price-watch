import assert from 'node:assert/strict';
import { applySelectedActuals, dateFromText, parseAnnouncementLinks, parseCompanyRows, selectCompanyMedian } from './fetch-doe-actuals.mjs';

const listing = `<a href="/doe-announces-major-fuel-price-rollback">DOE Announces Major Fuel Price Rollback</a>
<a href="https://prod-cms.doe.gov.ph/documents/d/guest/pnpa-sample">Summary of Prior Notice on Price Adjustments</a>
<a href="/unrelated">Unrelated story</a>`;
assert.equal(dateFromText('The adjustment takes effect on 10 November 2026.'), '2026-11-10');
assert.equal(dateFromText('Summary of Prior Notice October 6-16, 2025', 'Summary of Prior Notice'), '2025-10-06');
assert.equal(dateFromText('Effective on 31 February 2026'), null);
const links = parseAnnouncementLinks(listing);
assert.equal(links.length, 2);
assert.ok(links.some((item) => item.url.includes('pnpa-sample')));

const announcement = 'For gasoline, maximum increase is PHP 1.50 per liter. For diesel, minimum rollback is PHP 0.80 per liter. For kerosene, maximum increase is PHP 0.30 per liter.';
const table = `<table>
<tr><td>Oil Company Petron</td><td>Price Adjustments P1.50/lit for gasoline P0.80/lit for diesel P0.30/lit for kerosene</td></tr>
<tr><td>Oil Company Shell Pilipinas Corporation</td><td>Price Adjustments P1.50/lit for gasoline P0.80/lit for diesel P0.30/lit for kerosene</td></tr>
<tr><td>Oil Company Seaoil</td><td>Price Adjustments P1.50/lit for gasoline P0.80/lit for diesel P0.30/lit for kerosene</td></tr>
</table>`;
const companies = parseCompanyRows(table, table, announcement);
assert.equal(companies.length, 3);
assert.deepEqual(companies[0].values, { gasoline: 1.5, diesel: -0.8, kerosene: 0.3 });
const result = selectCompanyMedian(companies);
assert.deepEqual(result.selected, { gasoline: 1.5, diesel: -0.8, kerosene: 0.3 });
assert.deepEqual(result.counts, { gasoline: 3, diesel: 3, kerosene: 3 });
assert.deepEqual(selectCompanyMedian(companies.slice(0, 2)).selected, {}); // fewer than 3 companies is not trusted
assert.equal(selectCompanyMedian([{ values: { gasoline: 99 } }, ...companies]).selected.gasoline, undefined); // implausible figures are rejected
const actuals = { '2026-11-10': { gasoline: -16.8, diesel: -4.1, kerosene: -3.7 } };
const metadata = {
  records: { '2026-11-10': { fieldSources: { diesel: { sourceType: 'doe-auto' }, kerosene: { sourceType: 'doe-auto' } } } },
  manualOverrides: { '2026-11-10': { gasoline: true } },
  autoManaged: { '2026-11-10': ['diesel', 'kerosene'] },
};
applySelectedActuals(actuals, metadata, '2026-11-10', { gasoline: 2, diesel: 3, kerosene: 4 }, 'https://doe.gov.ph/example', '2026-11-10T00:00:00.000Z', { gasoline: 4, diesel: 4, kerosene: 4 }, metadata.records['2026-11-10']);
assert.deepEqual(actuals['2026-11-10'], { gasoline: -16.8, diesel: 3, kerosene: 4 });
assert.equal(metadata.records['2026-11-10'].fieldSources.gasoline, undefined);
assert.equal(metadata.records['2026-11-10'].fieldSources.diesel.sourceType, 'doe-auto');
console.log('DOE parser and manual-protection tests passed');
