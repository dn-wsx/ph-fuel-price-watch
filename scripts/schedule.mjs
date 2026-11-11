import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { manilaToday } from './model.mjs';
import { readUrl } from './http.mjs';
import { PUBLIC_FORECAST_URL } from './update.mjs';

export function latestDueSlot(now = Date.now()) {
  const today = manilaToday(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday === 0) return null;
  const times = weekday === 1 ? ['06:17'] : ['06:17', '11:43', '15:17', '18:43'];
  return times.map((time) => Date.parse(`${today}T${time}:00+08:00`))
    .filter((time) => time <= now).map((time) => new Date(time).toISOString()).at(-1) ?? null;
}

export async function checkSchedule({ eventName = process.env.GITHUB_EVENT_NAME, now = Date.now(), fetchImpl = fetch } = {}) {
  if (eventName !== 'schedule') return { required: true, reason: 'Push or manual run: update immediately.' };
  const slot = latestDueSlot(now);
  if (!slot) return { required: false, reason: 'No update slot is due today.' };
  let published;
  try {
    published = (await readUrl(PUBLIC_FORECAST_URL, {
      format: 'json', fetchImpl, attempts: 1, timeoutMs: 15_000, cache: 'no-store',
    })).body;
  } catch (error) {
    return { required: true, slot, reason: 'Attempt an update because publication could not be verified.', warning: `Public forecast check failed: ${error.message}` };
  }
  const generatedAt = typeof published?.generatedAt === 'string' ? Date.parse(published.generatedAt) : NaN;
  const hasForecast = Object.values(published?.fuels ?? {}).some((fuel) => Number.isFinite(fuel?.value));
  if (!Number.isFinite(generatedAt) || generatedAt > now || !hasForecast) {
    return { required: true, slot, reason: 'Attempt an update because publication is invalid.', warning: 'Public forecast has an invalid timestamp or no usable fuel estimates.' };
  }
  const required = generatedAt < Date.parse(slot);
  return { required, slot, reason: required ? `Update overdue for ${slot}.` : `Public forecast already covers ${slot}.` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkSchedule();
  if (result.warning) console.warn(`Warning: ${result.warning}`);
  console.log(result.reason);
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `required=${result.required}\n`);
}
