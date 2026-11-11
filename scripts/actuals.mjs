import { FUELS } from './model.mjs';

const PRIORITY = { news: 1, notice: 2, official: 3, manual: 4 };

export function sourceFor(entry = {}, fuel) {
  if (entry.fuelSources?.[fuel]) return entry.fuelSources[fuel];
  const { source = 'Manual entry', sourceUrl, items, provisional = false } = entry;
  const kind = /Oil Monitor/.test(source) ? 'official' : provisional ? /Prior Notice/.test(source) ? 'notice' : 'news' : 'manual';
  return { kind, source, ...(sourceUrl && { sourceUrl }), ...(items && { items }), provisional };
}

export const confirmed = (entry, fuel) => Number.isFinite(entry?.[fuel]) && !sourceFor(entry, fuel).provisional;

export function mergeActual(existing = {}, values, provenance) {
  const entry = { ...existing, fuelSources: { ...existing.fuelSources } };
  for (const fuel of FUELS) {
    if (Number.isFinite(existing[fuel]) && !entry.fuelSources[fuel]) entry.fuelSources[fuel] = sourceFor(existing, fuel);
    if (!Number.isFinite(values[fuel])) continue;
    if (Number.isFinite(existing[fuel]) && PRIORITY[sourceFor(existing, fuel).kind] > PRIORITY[provenance.kind]) continue;
    entry[fuel] = values[fuel];
    entry.fuelSources[fuel] = { ...provenance };
  }
  const sources = FUELS.filter((f) => Number.isFinite(entry[f])).map((f) => entry.fuelSources[f]);
  const same = sources.every((s) => s.kind === sources[0]?.kind && s.sourceUrl === sources[0]?.sourceUrl);
  entry.source = same ? sources[0].source : 'Mixed sources (see each fuel)';
  delete entry.sourceUrl;
  delete entry.items;
  delete entry.provisional;
  if (same && sources[0].sourceUrl) entry.sourceUrl = sources[0].sourceUrl;
  if (same && sources[0].items) entry.items = sources[0].items;
  if (sources.some((s) => s.provisional)) entry.provisional = true;
  return entry;
}
