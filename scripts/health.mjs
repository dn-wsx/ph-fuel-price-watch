// Fails the workflow run when something that needs a person is broken, so GitHub emails the owner about the failed run.
// Normal states are not faults: early on Tuesday the new week's first Singapore day is not posted yet and the page says so.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function healthProblems(forecast) {
  if (!forecast) return ['forecast.json could not be read.'];
  const out = [];
  if (!Object.keys(forecast.fuels ?? {}).length) out.push('No forecast was produced.');
  const opinet = (forecast.errors ?? []).find((e) => e.startsWith('Opinet'));
  if (opinet) out.push(`Opinet could not be read (${opinet}).`);
  if (forecast.singaporeThrough && (Date.parse(forecast.asOf) - Date.parse(forecast.singaporeThrough)) / 864e5 > 5) out.push(`Singapore prices stop at ${forecast.singaporeThrough}.`);
  if (forecast.actualsNote) out.push(`The DOE reports could not be read: ${forecast.actualsNote}`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let forecast = null;
  try { forecast = JSON.parse(fs.readFileSync(new URL('../data/forecast.json', import.meta.url), 'utf8')); } catch { /* reported below */ }
  const problems = healthProblems(forecast);
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length) process.exit(1);
  console.log('Healthy: Singapore prices through', forecast.singaporeThrough);
}
