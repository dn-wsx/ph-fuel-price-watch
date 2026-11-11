// Derives each week's ACTUAL pump-price adjustment from the DOE's weekly Oil Monitor PDFs.
// Every report states a running year-to-date total ("The 44th price movement this year resulted in a
// total net increase of P72.05/liter for gasoline, ..."). This week's total minus last week's total
// is this week's adjustment, regardless of how the rest of the report is worded.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addDays, manilaToday } from './model.mjs';

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

export function pdfToText(buf) {
  const file = path.join(os.tmpdir(), `oilmonitor-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, buf);
  try { return execFileSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 20e6 }); }
  finally { fs.rmSync(file, { force: true }); }
}

const get = async (fetchImpl, url) => {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 ph-fuel-price-watch' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`);
  return res;
};

// Mutates `actuals` and `ytd` (a cache of parsed totals). Never overwrites a complete existing entry.
export async function recordFromDoe({ actuals, ytd, today = manilaToday(), fetchImpl = fetch, pdfText = pdfToText, maxReports = 12 }) {
  const reports = listReports(await (await get(fetchImpl, LISTING)).text(), today).slice(0, maxReports);
  if (!reports.length) throw new Error('no Oil Monitor links found on the DOE page');

  const problems = [];
  for (const r of reports) {
    if (ytd[r.date]) continue;
    try {
      const parsed = parseYtd(await pdfText(Buffer.from(await (await get(fetchImpl, r.url)).arrayBuffer())));
      if (parsed) ytd[r.date] = parsed; else problems.push(`${r.date}: year-to-date line not found`);
    } catch (e) { problems.push(`${r.date}: ${e.message}`); }
  }

  const added = [];
  for (const r of reports) {
    const have = actuals[r.date];
    if (have && !have.provisional && FUELS.every((f) => typeof have[f] === 'number')) continue;
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
    if (have?.provisional) {
      if (FUELS.some((f) => typeof have[f] === 'number' && Math.abs(have[f] - diff[f]) > 0.05)) problems.push(`${r.date}: Prior Notice and Oil Monitor differ; using the Oil Monitor`);
      actuals[r.date] = { ...diff, source: 'DOE Oil Monitor (year-to-date difference)' };
    } else actuals[r.date] = { ...diff, source: 'DOE Oil Monitor (year-to-date difference)', ...have }; // existing manual values win
    added.push(r.date);
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
export async function recordFromNotices({ actuals, notices, today = manilaToday(), fetchImpl = fetch, pdfText = pdfToText, maxReports = 6 }) {
  const urls = pdfUrls(await (await get(fetchImpl, NOTICES)).text()).slice(0, maxReports);
  if (!urls.length) throw new Error('no Prior Notice links found on the DOE page');
  const added = [], problems = [];
  for (const url of urls) {
    if (!notices[url]) {
      try {
        const parsed = parseNotice(await pdfText(Buffer.from(await (await get(fetchImpl, url)).arrayBuffer())), today);
        if (parsed) notices[url] = parsed; else problems.push(`notice ${decodeURIComponent(url.split('?')[0].split('/').pop())}: no clear agreement among companies`);
      } catch (e) { problems.push(`notice: ${e.message}`); }
    }
    const p = notices[url];
    if (!p) continue;
    const have = actuals[p.date] ?? {};
    const fill = Object.fromEntries(FUELS.filter((f) => typeof p[f] === 'number' && typeof have[f] !== 'number').map((f) => [f, p[f]]));
    if (!Object.keys(fill).length) continue;
    actuals[p.date] = Object.keys(have).length ? { ...have, ...fill } : { ...fill, source: 'DOE Prior Notice (company filings)', provisional: true };
    added.push(p.date);
  }
  return { added, problems };
}
