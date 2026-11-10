// Usage: node scripts/add-actual.mjs <YYYY-MM-DD|auto> gasoline=1.20 diesel=-0.50 kerosene=-0.30
// "auto" = the most recent Tuesday (Manila time). Negative = rollback.
import fs from 'node:fs/promises';
import { addDays, manilaToday } from './model.mjs';

const fail = (m) => { console.error(`Error: ${m}`); process.exit(1); };
let [date, ...pairs] = process.argv.slice(2);
if (date === 'auto') {
  const t = manilaToday();
  date = addDays(t, -((new Date(t + 'T00:00:00Z').getUTCDay() + 5) % 7));
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !pairs.length) fail('usage: add-actual.mjs <YYYY-MM-DD|auto> gasoline=1.2 diesel=-0.5 kerosene=-0.3');
if (new Date(date + 'T00:00:00Z').getUTCDay() !== 2) fail(`${date} is not a Tuesday. Use the Tuesday the forecast was made for (edit data/actuals.json by hand for unusual cases).`);

const values = {};
for (const p of pairs) {
  const [k, v] = p.split('=');
  const n = Number(v);
  if (!['gasoline', 'diesel', 'kerosene'].includes(k) || v === '' || !Number.isFinite(n) || Math.abs(n) > 30) fail(`bad value "${p}" (expected e.g. diesel=-0.50, within +/-30)`);
  values[k] = n;
}
const file = new URL('../data/actuals.json', import.meta.url);
const all = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
all[date] = { ...all[date], ...values };
await fs.writeFile(file, JSON.stringify(Object.fromEntries(Object.entries(all).sort()), null, 2) + '\n');
console.log('Saved', date, all[date]);
