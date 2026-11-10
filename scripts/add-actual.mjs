// Usage: node scripts/add-actual.mjs 2026-11-10 gasoline=1.20 diesel=-0.50 kerosene=-0.30
import fs from 'node:fs/promises';
const [date, ...pairs] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !pairs.length) { console.error('Usage: add-actual.mjs YYYY-MM-DD gasoline=1.2 diesel=-0.5 kerosene=-0.3'); process.exit(1); }
const actualsFile = new URL('../data/actuals.json', import.meta.url);
const metadataFile = new URL('../data/actuals-meta.json', import.meta.url);
const actuals = JSON.parse(await fs.readFile(actualsFile, 'utf8').catch(() => '{}'));
const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8').catch(() => '{"records":{}}'));
const updates = Object.fromEntries(pairs.map((pair) => {
  const [fuel, raw] = pair.split('=');
  const value = Number(raw);
  if (!['gasoline', 'diesel', 'kerosene'].includes(fuel) || raw === undefined || !Number.isFinite(value) || Math.abs(value) > 50) throw new Error(`Bad pair: ${pair}`);
  return [fuel, Number(value.toFixed(2))];
}));
actuals[date] = { ...actuals[date], ...updates };
metadata.records ??= {};
metadata.records[date] ??= { effectiveDate: date, status: 'manual-entry' };
metadata.manualOverrides ??= {};
metadata.manualOverrides[date] ??= {};
metadata.autoManaged ??= {};
metadata.autoManaged[date] ??= [];
metadata.records[date].fieldSources ??= {};
for (const fuel of Object.keys(updates)) {
  metadata.manualOverrides[date][fuel] = true;
  metadata.records[date].fieldSources[fuel] = { sourceType: 'manual', verifiedAt: new Date().toISOString() };
  metadata.autoManaged[date] = metadata.autoManaged[date].filter((item) => item !== fuel);
}
await fs.writeFile(actualsFile, `${JSON.stringify(Object.fromEntries(Object.entries(actuals).sort()), null, 2)}\n`);
await fs.writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
console.log('Saved manual actuals', date, updates);
