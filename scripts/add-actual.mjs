// Usage: node scripts/add-actual.mjs 2026-11-10 gasoline=1.20 diesel=-0.50 kerosene=-0.30
import fs from 'node:fs/promises';
const [date, ...pairs] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !pairs.length) { console.error('Usage: add-actual.mjs YYYY-MM-DD gasoline=1.2 diesel=-0.5 kerosene=-0.3'); process.exit(1); }
const file = new URL('../data/actuals.json', import.meta.url);
const all = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
all[date] = { ...all[date], ...Object.fromEntries(pairs.map((p) => { const [k, v] = p.split('='); if (!['gasoline', 'diesel', 'kerosene'].includes(k) || isNaN(+v)) throw new Error(`Bad pair: ${p}`); return [k, +v]; })) };
await fs.writeFile(file, JSON.stringify(Object.fromEntries(Object.entries(all).sort()), null, 2) + '\n');
console.log('Saved', date, all[date]);
