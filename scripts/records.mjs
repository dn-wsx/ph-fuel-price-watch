import { FUELS, calibrate, forecast, r2 } from './model.mjs';
import { confirmed } from './actuals.mjs';

const STAGES = ['early', '1', '2', '3', '4', '5', 'final'];
const cutoff = (target) => Date.parse(`${target}T00:00:00+08:00`);

export function appendRecord(log, forecastData, stage) {
  const entry = log[forecastData.target] ??= {};
  const records = entry.records ??= [];
  if (!records.some((r) => r.generatedAt === forecastData.generatedAt)) records.push(structuredClone({ ...forecastData, stage }));
}

// Observing an exact saved payload on Pages proves it was public by this time, not its original deployment time.
export function observePublication(log, publicData, observedAt) {
  const record = log[publicData.target]?.records?.find((r) => r.generatedAt === publicData.generatedAt);
  if (!record || record.model !== publicData.model || record.basis !== publicData.basis || JSON.stringify(record.fuels) !== JSON.stringify(publicData.fuels) || Date.parse(observedAt) < Date.parse(record.generatedAt)) return false;
  record.publishedObservedAt ??= observedAt;
  return true;
}

export function publishedTrack(log, actuals) {
  const samples = {}, pending = [];
  let weeks = 0;
  for (const [target, entry] of Object.entries(log).sort()) {
    const records = (entry.records ?? []).filter((r) => Number.isFinite(Date.parse(r.publishedObservedAt)) && Date.parse(r.publishedObservedAt) < cutoff(target) && Date.parse(r.generatedAt) < cutoff(target))
      .sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
    if (!entry.records?.length) continue;
    if (!FUELS.some((f) => confirmed(actuals[target], f))) { pending.push(target); continue; }
    if (!records.length) continue;
    const stages = Object.fromEntries(records.map((r) => [r.stage, r]));
    stages.final = records.at(-1);
    let scored = false;
    for (const [stage, record] of Object.entries(stages)) {
      for (const fuel of FUELS) {
        const f = record.fuels[fuel];
        if (!Number.isFinite(f?.value) || !confirmed(actuals[target], fuel)) continue;
        const actual = actuals[target][fuel];
        ((samples[stage] ??= {})[fuel] ??= []).push({ error: f.value - actual, correct: Math.sign(f.value) === Math.sign(actual), interval: Number.isFinite(f.low) && Number.isFinite(f.high), covered: f.low <= actual && actual <= f.high });
        scored = true;
      }
    }
    if (scored) weeks++;
  }
  const stages = STAGES.filter((s) => samples[s]).map((key) => {
    const metrics = Object.fromEntries(FUELS.map((fuel) => {
      const rows = samples[key][fuel] ?? [], n = rows.length;
      return [fuel, {
        n, mae: n ? r2(rows.reduce((s, r) => s + Math.abs(r.error), 0) / n) : null,
        bias: n ? r2(rows.reduce((s, r) => s + r.error, 0) / n) : null,
        directionCorrect: rows.filter((r) => r.correct).length,
        covered: rows.filter((r) => r.interval && r.covered).length, intervalN: rows.filter((r) => r.interval).length,
      }];
    }));
    return { key, metrics };
  });
  return { weeks, pending, stages };
}

// Chronological evaluation: each adjustment is predicted using only earlier confirmed adjustments.
export function walkForward(pairs) {
  const ordered = [...pairs].sort(([a], [b]) => a.localeCompare(b));
  const predictions = ordered.map(([date, raw, actual], i) => ({ date, value: forecast(raw, calibrate(ordered.slice(0, i).map(([, r, a]) => [r, a]))).value, actual, raw: r2(raw) }));
  const n = predictions.length;
  const mae = (key) => n ? r2(predictions.reduce((s, p) => s + Math.abs(p[key] - p.actual), 0) / n) : null;
  return { n, mae: mae('value'), baselineMae: mae('raw'), predictions };
}
