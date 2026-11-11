// Derives each week's ACTUAL pump-price adjustment from the DOE's weekly Oil Monitor PDFs.
// Every report states a running year-to-date total ("The 44th price movement this year resulted in a
// total net increase of P72.05/liter for gasoline, ..."). This week's total minus last week's total
// is this week's adjustment, regardless of how the rest of the report is worded.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { addDays, manilaToday, windows } from './model.mjs';
import { readUrl } from './http.mjs';
import { mergeActual, sourceFor } from './actuals.mjs';

export const NOTICES = 'https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/price-adjustments';
export const LISTING = 'https://doe.gov.ph/data-and-prices/liquid-fuels/oil-monitor';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const FUELS = ['gasoline', 'diesel', 'kerosene'];
const r2 = (x) => Math.round(x * 100) / 100;
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Finds every Oil Monitor PDF link in the listing page and the date in its file name. Newest first.
export const pdfUrls = (html) => [...new Set(html.replace(/\\\//g, '/').replace(/\\u0026|&amp;/g, '&').match(/https?:\/\/[^"'<>\\]+?\.pdf(?:\?[^"'<>\s\\]*)?/gi) ?? [])].map((u) => u.replace(/ /g, '%20'));

export function listReports(html, today = manilaToday()) {
  const urls = pdfUrls(html);
  const byDate = new Map();
  for (const raw of urls) {
    let name;
    try { name = decodeURIComponent(raw.split('?')[0].split('/').pop()); } catch { continue; }
    const m = name.match(new RegExp(`(\\d{1,2})\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?`, 'i'));
    if (!/oil\s*monitor/i.test(name) || !m) continue;
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    let date = iso(m[3] ? +m[3] : +today.slice(0, 4), month, +m[1]);
    if (!m[3] && date > addDays(today, 7)) date = iso(+today.slice(0, 4) - 1, month, +m[1]); // no year in name: it was last year
    if (new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, url: raw.replace(/ /g, '%20') });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Reads the year-to-date line out of a report's text. Returns null if it isn't found.
export function parseYtd(text) {
  const t = text.replace(/[•|]/g, ' ').replace(/\s+/g, ' ');
  const n = t.match(/(\d+)(?:st|nd|rd|th)\s+price\s+movement/i);
  const sep = String.raw`[\s,.:;]*(?:and[\s,.:;]*)?`;
  const amt = String.raw`(?:PHP|P|₱)\s?([\d,]+(?:\.\d+)?)\s*(?:\/|\bper\b)\s*(?:liter|litre)\s+for\s+`;
  const re = new RegExp(String.raw`total\s+net\s+(increase|decrease)\s+of${sep}${amt}gasoline${sep}${amt}diesel${sep}${amt}kerosene`, 'i');
  const m = t.match(re);
  if (!m) return null;
  const sign = m[1].toLowerCase() === 'decrease' ? -1 : 1;
  const v = (s) => sign * Number(s.replace(/,/g, ''));
  return { n: n ? +n[1] : null, gasoline: v(m[2]), diesel: v(m[3]), kerosene: v(m[4]) };
}

export function parseBenchmarks(text) {
  const t = text.split(/\n\s*Crude Oil Prices\s*(?:\n|$)/i)[0].replace(/\s+/g, ' ');
  const months = MONTHS.join('|');
  const period = t.match(new RegExp(`(${months})\\s+(\\d{1,2})\\s*[-–]\\s*(?:(${months})\\s+)?(\\d{1,2}),?\\s+(\\d{4}),?\\s+Trading Days`, 'i'));
  if (!period) return null;
  const current = [iso(+period[5], MONTHS.indexOf(period[1].toLowerCase()) + 1, +period[2]), iso(+period[5], MONTHS.indexOf((period[3] ?? period[1]).toLowerCase()) + 1, +period[4])];
  if (current[0] > current[1]) current[0] = iso(+period[5] - 1, MONTHS.indexOf(period[1].toLowerCase()) + 1, +period[2]);
  if (current.some((d) => !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d)) return null;
  const intro = t.slice(period.index + period[0].length);
  const changes = {};
  const products = String.raw`(?:gasoline|diesel|kerosene)`;
  const amounts = String.raw`US\$\s*\d+(?:\.\d+)?`;
  const re = new RegExp(`\\b(${products}(?:(?:\\s*,\\s*|\\s+and\\s+)${products})*)\\s+prices?\\s+(increased|decreased|declined|rose|fell)\\s+by\\s+(?:(?:approximately|around|about)\\s+)?(${amounts}(?:(?:\\s*,\\s*|\\s+and\\s+)${amounts})*)(?![\\d.\\-–])`, 'gi');
  for (const m of intro.matchAll(re)) {
    const fuels = m[1].toLowerCase().match(/gasoline|diesel|kerosene/g);
    const values = [...m[3].matchAll(/US\$\s*(\d+(?:\.\d+)?)/g)].map((a) => Number(a[1]));
    const tail = intro.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (/^\s*(?:to\b|[-–/])/i.test(tail)) continue;
    if (fuels.length !== values.length || (fuels.length > 1 && !/^[^.]*respectively/i.test(tail))) continue;
    const sign = /increased|rose/i.test(m[2]) ? 1 : -1;
    fuels.forEach((f, i) => { changes[f] = sign * values[i]; });
  }
  return { current, changes };
}

// USD/barrel checks deliberately exclude FX, VAT and pump-price pass-through.
export function benchmarkChecks(benchmarks, series, tolerance = 0.15) {
  return Object.entries(benchmarks).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12).map(([date, report]) => {
    const win = windows(addDays(date, -1));
    const base = { date, source: report.source, current: report.current ?? null, previous: win.prev, tolerance, fuels: {} };
    if (!report.current || !Object.keys(report.changes ?? {}).length) return { ...base, status: 'unavailable' };
    if (report.current.some((d, i) => d !== win.cur[i])) return { ...base, status: 'report-window-mismatch' };
    let incomplete = false;
    for (const [fuel, symbol] of Object.entries({ gasoline: 'MOPS92', diesel: 'MOPSD', kerosene: 'MOPSK' })) {
      if (!Number.isFinite(report.changes[fuel])) continue;
      const averages = [win.prev, win.cur].map(([from, to]) => Object.entries(series[symbol] ?? {}).filter(([d, p]) => d >= from && d <= to && Number.isFinite(p) && p > 0).map(([, p]) => p));
      if (averages.some((a) => a.length < 3)) { incomplete = true; continue; }
      const observed = r2(averages[1].reduce((a, b) => a + b, 0) / averages[1].length - averages[0].reduce((a, b) => a + b, 0) / averages[0].length);
      base.fuels[fuel] = { doe: report.changes[fuel], opinet: observed, difference: r2(observed - report.changes[fuel]) };
    }
    const mismatch = Object.values(base.fuels).some((f) => Math.abs(f.difference) > tolerance);
    return { ...base, status: mismatch ? 'mismatch' : incomplete ? 'insufficient-data' : 'matched' };
  });
}

export function pdfToText(buf) {
  const file = path.join(os.tmpdir(), `oilmonitor-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, buf);
  try { return execFileSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 20e6, timeout: 15_000, killSignal: 'SIGKILL' }); }
  finally { fs.rmSync(file, { force: true }); }
}

const get = (fetchImpl, url, format = 'text', signal) => readUrl(url, { fetchImpl, signal, format, timeoutMs: format === 'arrayBuffer' ? 45_000 : 25_000, headers: { 'User-Agent': 'Mozilla/5.0 ph-fuel-price-watch' } });

// Mutates `actuals` and `ytd` (a cache of parsed totals). Never overwrites a complete existing entry.
export async function recordFromDoe({ actuals, ytd, benchmarks = {}, today = manilaToday(), fetchImpl = fetch, pdfText = pdfToText, maxReports = 12, signal }) {
  const reports = listReports((await get(fetchImpl, LISTING, 'text', signal)).body, today).slice(0, maxReports);
  if (!reports.length) throw new Error('no Oil Monitor links found on the DOE page');

  const problems = [];
  for (const [index, r] of reports.entries()) {
    if (signal?.aborted) { problems.push('DOE time budget exhausted; keeping cached reports.'); break; }
    const cached = benchmarks[r.date];
    if (ytd[r.date] && cached && (index >= 2 || cached.checkedOn === today)) continue;
    try {
      const response = await get(fetchImpl, r.url, 'arrayBuffer', signal);
      const bytes = Buffer.from(response.body);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (cached?.sha256 === sha256 && ytd[r.date]) { cached.checkedOn = today; continue; }
      const text = await pdfText(bytes);
      const parsed = parseYtd(text);
      if (!parsed) { problems.push(`${r.date}: year-to-date line not found; keeping cached values`); continue; }
      ytd[r.date] = parsed;
      benchmarks[r.date] = { ...(parseBenchmarks(text) ?? { current: null, changes: {} }), source: r.url, sha256, checkedOn: today };
    } catch (e) { problems.push(`${r.date}: ${e.message}`); }
  }

  const added = [];
  for (const r of reports) {
    const have = actuals[r.date];
    if (have && FUELS.every((f) => Number.isFinite(have[f]) && sourceFor(have, f).kind === 'manual')) continue;
    const cur = ytd[r.date];
    if (!cur) continue;
    if (new Date(r.date + 'T00:00:00Z').getUTCDay() !== 2) { problems.push(`${r.date}: not a Tuesday, skipped`); continue; }
    let base;
    if (cur.n === 1) base = { gasoline: 0, diesel: 0, kerosene: 0 }; // first movement of a new year
    else {
      const prev = ytd[addDays(r.date, -7)];
      if (!prev) continue; // no report exactly a week earlier (yet)
      if (cur.n != null && prev.n != null && cur.n - prev.n !== 1) { problems.push(`${r.date}: movement numbers ${prev.n} to ${cur.n} do not line up, skipped`); continue; }
      base = prev;
    }
    const diff = Object.fromEntries(FUELS.map((f) => [f, r2(cur[f] - base[f])]));
    if (FUELS.some((f) => Math.abs(diff[f]) > 30)) { problems.push(`${r.date}: implausible change ${JSON.stringify(diff)}, skipped`); continue; }
    if (have?.provisional && FUELS.some((f) => typeof have[f] === 'number' && Math.abs(have[f] - diff[f]) > 0.05)) problems.push(`${r.date}: provisional announcement and Oil Monitor differ; using the Oil Monitor`);
    const entry = mergeActual(have, diff, { kind: 'official', source: 'DOE Oil Monitor (year-to-date difference)', sourceUrl: r.url, provisional: false });
    if (JSON.stringify(entry) !== JSON.stringify(have)) { actuals[r.date] = entry; added.push(r.date); }
  }
  return { added, latest: reports[0].date, problems };
}

// ---- Prior Notice on Price Adjustments: one row per oil company, posted before the Tuesday ----
const consensus = (vals) => {
  const counts = new Map();
  for (const v of vals) counts.set(r2(v), (counts.get(r2(v)) ?? 0) + 1);
  const [value, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return n >= 3 && n / vals.length >= 0.6 ? value : null; // need real agreement, otherwise stay silent
};

export function parseNotice(text, today = manilaToday()) {
  const t = text.replace(/\s+/g, ' ');
  const w = t.match(/for the week (?:of )?([a-z]+)\.? (\d{1,2})(?: ?[-–] ?(?:[a-z]+ )?\d{1,2})?,? ?(\d{4})?/i);
  const mi = w ? MONTHS.indexOf(w[1].toLowerCase()) : -1;
  if (mi < 0) return null;
  let date = iso(w[3] ? +w[3] : +today.slice(0, 4), mi + 1, +w[2]);
  if (!w[3] && date > addDays(today, 7)) date = iso(+today.slice(0, 4) - 1, mi + 1, +w[2]);
  if (new Date(date + 'T00:00:00Z').getUTCDay() !== 2) return null;
  // Each company row ends with: effectivity date, then up to three decimals (gasoline, diesel, kerosene; blanks are simply missing).
  const rowRe = new RegExp(`(?:${MONTHS.join('|')})\\s+\\d{1,2}\\s+((?:-?\\d+\\.\\d+\\s*){1,3})`, 'gi');
  const rows = [...t.matchAll(rowRe)].map((m) => m[1].trim().split(/\s+/).map(Number)).filter((r) => r.length >= 2);
  const out = {
    date, rows: rows.length,
    gasoline: consensus(rows.map((r) => r[0])),
    diesel: consensus(rows.map((r) => r[1])),
    kerosene: consensus(rows.filter((r) => r.length === 3).map((r) => r[2])),
  };
  return FUELS.some((f) => out[f] !== null) ? out : null;
}

// Fills in provisional actuals as soon as companies have filed. The Oil Monitor later replaces them with the official figure.
export async function recordFromNotices({ actuals, notices, today = manilaToday(), fetchImpl = fetch, pdfText = pdfToText, maxReports = 6, signal }) {
  const urls = pdfUrls((await get(fetchImpl, NOTICES, 'text', signal)).body).slice(0, maxReports);
  if (!urls.length) throw new Error('no Prior Notice links found on the DOE page');
  const added = [], problems = [];
  for (const url of urls) {
    if (signal?.aborted) { problems.push('DOE time budget exhausted; keeping cached notices.'); break; }
    if (!notices[url]) {
      try {
        const parsed = parseNotice(await pdfText(Buffer.from((await get(fetchImpl, url, 'arrayBuffer', signal)).body)), today);
        if (parsed) notices[url] = parsed; else problems.push(`notice ${decodeURIComponent(url.split('?')[0].split('/').pop())}: no clear agreement among companies`);
      } catch (e) { problems.push(`notice: ${e.message}`); }
    }
    const p = notices[url];
    if (!p) continue;
    const have = actuals[p.date] ?? {};
    const fill = Object.fromEntries(FUELS.filter((f) => typeof p[f] === 'number').map((f) => [f, p[f]]));
    if (!Object.keys(fill).length) continue;
    const entry = mergeActual(have, fill, { kind: 'notice', source: 'DOE Prior Notice (company filings)', sourceUrl: url, provisional: true });
    if (JSON.stringify(entry) !== JSON.stringify(have)) { actuals[p.date] = entry; added.push(p.date); }
  }
  return { added, problems };
}
