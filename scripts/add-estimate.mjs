// Usage: node scripts/add-estimate.mjs <YYYY-MM-DD|auto> gasoline=-4.70 diesel=-6.40 kerosene=-6.90 [source="FB page, trading Day 1"]
// Records a published estimate for the Tuesday it forecasts ("auto" = the next Tuesday, Manila time). Rollback is negative.
// A fuel can also be a range: diesel=-6.9:-6.4. The forecast blends it in at a high weight (see CONFIG.industryWeight).
import fs from 'node:fs/promises';
import { FUELS, windows, manilaToday, toRange } from './model.mjs';

const fail = (m) => { console.error(`Error: ${m}`); process.exit(1); };
let [date, ...pairs] = process.argv.slice(2);
if (date === 'auto') date = windows(manilaToday()).target;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !pairs.length) fail('usage: add-estimate.mjs <YYYY-MM-DD|auto> gasoline=-4.7 diesel=-6.4 kerosene=-6.9 source="..."');
if (new Date(date + 'T00:00:00Z').getUTCDay() !== 2) fail(`${date} is not a Tuesday. Use the Tuesday the estimate is for.`);

const entry = {};
for (const p of pairs) {
  const [k, ...rest] = p.split('='), v = rest.join('=');
  if (k === 'source') { entry.source = v.trim().slice(0, 120); continue; }
  const range = toRange(v.includes(':') ? v.split(':').map(Number) : Number(v));
  if (!FUELS.includes(k) || v === '' || !range || range.some((n) => Math.abs(n) > 30)) fail(`bad value "${p}" (expected e.g. diesel=-6.40 or diesel=-6.9:-6.4, within +/-30)`);
  entry[k] = range[0] === range[1] ? range[0] : range;
}
if (!FUELS.some((f) => f in entry)) fail('give at least one of gasoline, diesel, kerosene');
const file = new URL('../data/industry.json', import.meta.url);
const all = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
all[date] = { ...all[date], ...entry };
const { _help, ...entries } = all;
await fs.writeFile(file, JSON.stringify({ ...(_help && { _help }), ...Object.fromEntries(Object.entries(entries).sort()) }, null, 2) + '\n');
console.log('Saved', date, all[date]);
