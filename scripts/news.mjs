// Published estimates of the next Tuesday's pump price change, read from news headlines (Google News RSS).
// Outlets repeat the same industry estimate (Jetti, Unioil, Petron sources, DOE) every Thursday to Saturday.
// A headline is used only if it names a fuel and an amount; an estimate is used only if two headlines agree.
import { windows, r2, median, addDays } from './model.mjs';
import { readUrl } from './http.mjs';

export const NEWS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent('oil price rollback OR hike next week Philippines diesel gasoline when:10d')}&hl=en-PH&gl=PH&ceid=PH:en`;
export const ANNOUNCEMENTS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent('Philippines fuel gasoline diesel kerosene prices effective Tuesday announced when:10d')}&hl=en-PH&gl=PH&ceid=PH:en`;

const FUEL_WORDS = { gasoline: /gasoline|\bgas\b|unleaded/i, diesel: /diesel/i, kerosene: /kerosene/i };
const AMOUNT = /(?<![A-Za-z])(?:₱|PHP\s?|P)\s?(\d+(?:\.\d+)?)(?:\s*(?:to|-|–)\s*(?:₱|PHP\s?|P)?\s?(\d+(?:\.\d+)?))?/i;
const DOWN = /roll\s?back|\bcut\b|drop|decreas|\bdown\b|plung|crash|\bfall|slash|lower|\bdip|reduc|\bease/i;
const UP = /hike|\brise\b|increas|\bup\b|climb|surge|jump|higher|rais/i;
const CUE = /next week|\bseen\b|\bmay\b|could|expected|looms?\b|projected|poised|eyed/i;
const ACTUAL = /effective|took effect|announce|\bDOE\b|Garin|this week|starting (?:tomorrow|tuesday)|set (?:on|for) tuesday/i;

const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

export function parseRss(xml) {
  const items = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1];
    const source = pick('source') ? decode(pick('source')) : '';
    let title = pick('title') ? decode(pick('title')) : '';
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const published = new Date(pick('pubDate') ?? NaN);
    const sourceUrl = body.match(/<source\s+[^>]*url="([^"]+)"/)?.[1];
    if (title && !Number.isNaN(published.getTime())) items.push({ title, source, ...(sourceUrl && { sourceUrl: decode(sourceUrl) }), published: published.toISOString(), link: pick('link') ? decode(pick('link')) : '' });
  }
  return items;
}

const manilaDate = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);

// {gasoline, diesel, kerosene} in PHP/L (rollback negative; a number or [low, high]), or null if the headline is not a usable forecast.
export function parseEstimate(title, publishedIso) {
  const dow = new Date(manilaDate(publishedIso) + 'T00:00:00Z').getUTCDay(); // 4=Thu .. 0=Sun carry forecasts; Mon to Wed headlines are about the adjustment already announced
  if (ACTUAL.test(title) || !(CUE.test(title) || [4, 5, 6, 0].includes(dow))) return null;
  return parseChanges(title);
}

function parseChanges(title, exact = false) {
  if (exact && [...title.matchAll(new RegExp(AMOUNT, 'gi'))].some((m) => m[2] != null)) return null;
  const clean = title.split(/\bLink to\b|\|/)[0].replace(/\bup to\b/gi, ' ').replace(/\bover\b/gi, ' ');
  const out = {};
  const clauses = clean.split(/[,;]|\bwhile\b|\bbut\b|\band\b/i).map((text) => ({ text, down: DOWN.test(text), up: UP.test(text) })); // one amount per fuel; "gasoline and diesel fall P4" keeps only the fuel next to the amount
  if (exact && clauses.some((c) => Object.values(FUEL_WORDS).some((re) => re.test(c.text)) && !AMOUNT.test(c.text))) return null;
  const own = clauses.map((c) => (c.down === c.up ? 0 : c.down ? -1 : 1));
  // A clause with no direction word takes it from the clause before ("P13 for gas, P4 for diesel") or after ("Diesel P6.40 and gasoline P4.70 rollback").
  let last = 0, next = 0;
  const before = own.map((d) => (last = d || last)), after = own.map((_, i) => own[own.length - 1 - i]).map((d) => (next = d || next)).reverse();
  clauses.forEach((c, i) => {
    const dir = c.down && c.up ? 0 : own[i] || before[i] || after[i];
    const amount = c.text.match(AMOUNT);
    const fuels = Object.keys(FUEL_WORDS).filter((f) => FUEL_WORDS[f].test(c.text));
    if (!amount || !dir || !fuels.length) return;
    if (exact && (fuels.length !== 1 || amount[2] != null || [...c.text.matchAll(new RegExp(AMOUNT, 'gi'))].length !== 1)) return;
    const lo = Number(amount[1]), hi = amount[2] != null ? Number(amount[2]) : lo;
    if (!(lo > 0 && hi >= lo && hi <= 30)) return;
    const value = lo === hi ? dir * lo : [dir * lo, dir * hi].sort((a, b) => a - b);
    for (const f of fuels) out[f] = value;
  });
  return Object.keys(out).length ? out : null;
}

const mid = (v) => (Array.isArray(v) ? (v[0] + v[1]) / 2 : v);

// Largest group of values within `tol` of each other (ties: the group holding the newest value). Needs at least two.
function agreed(values, tol = 1.5) {
  let best = [];
  for (const v of values) { const g = values.filter((x) => Math.abs(x - v) <= tol); if (g.length > best.length) best = g; }
  return best.length >= 2 ? r2(median(best)) : null;
}

// Group headlines by the Tuesday they forecast, newest first. Returns { 'YYYY-MM-DD': { gasoline?, diesel?, kerosene?, items } }.
export function estimatesFromNews(items) {
  const byTarget = {};
  for (const it of [...items].sort((a, b) => (a.published < b.published ? 1 : -1))) {
    const est = parseEstimate(it.title, it.published);
    if (!est) continue;
    const target = windows(manilaDate(it.published)).target;
    (byTarget[target] ??= []).push({ ...it, est });
  }
  const out = {};
  for (const [target, rows] of Object.entries(byTarget)) {
    const entry = {};
    for (const fuel of Object.keys(FUEL_WORDS)) {
      const v = agreed(rows.filter((r) => r.est[fuel] != null).map((r) => mid(r.est[fuel])));
      if (v != null) entry[fuel] = v;
    }
    if (Object.keys(entry).length) out[target] = { ...entry, items: rows.slice(0, 8).map(({ title, source, published, link }) => ({ title, source, published, link })) };
  }
  return out;
}

const PUBLISHERS = ['gmanetwork.com', 'philstar.com', 'inquirer.net', 'abs-cbn.com', 'abs-cbnnews.com', 'mb.com.ph', 'pna.gov.ph', 'manilatimes.net', 'tribune.net.ph'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// Exact Monday/Tuesday announcements need two distinct publishers; conflicting values stay unrecorded.
export function announcementsFromNews(items, today, problems = []) {
  const grouped = {};
  for (const it of items) {
    let host;
    try { host = new URL(it.sourceUrl).hostname.toLowerCase(); } catch { continue; }
    const publisher = PUBLISHERS.find((p) => host === p || host.endsWith(`.${p}`));
    if (!publisher || !Number.isFinite(Date.parse(it.published))) continue;
    const date = manilaDate(it.published), dow = new Date(date).getUTCDay();
    if (![1, 2].includes(dow) || date > today) continue;
    const target = dow === 1 ? addDays(date, 1) : date;
    if (target > today || target < addDays(today, -8)) continue;
    const title = it.title;
    const explicit = title.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
    const context = explicit ? title.replace(explicit[0], '') : title;
    if (/\bmay\b|could|expected|forecast|seen|next week|projected|up to|\bover\b|at least|\bbetween\b/i.test(context)) continue;
    if (!/(?:effective|starting|from|on|this)\s+(?:\w+\s+)?Tuesday|starting tomorrow/i.test(title)) continue;
    if (explicit) {
      const month = MONTH_NAMES.findIndex((m) => m.startsWith(explicit[1].toLowerCase())) + 1;
      const stated = `${explicit[3] ?? target.slice(0, 4)}-${String(month).padStart(2, '0')}-${explicit[2].padStart(2, '0')}`;
      if (stated !== target) continue;
    }
    const values = parseChanges(title, true);
    if (values) (grouped[target] ??= []).push({ ...it, publisher, values });
  }
  const out = {};
  for (const [date, rows] of Object.entries(grouped)) {
    const values = {};
    for (const fuel of Object.keys(FUEL_WORDS)) {
      const candidates = rows.filter((r) => typeof r.values[fuel] === 'number');
      if (new Set(candidates.map((r) => r.publisher)).size < 2) continue;
      if (new Set(candidates.map((r) => r.values[fuel])).size === 1) values[fuel] = candidates[0].values[fuel];
      else problems.push(`${date} ${fuel}: conflicting announcement amounts; not recorded from news.`);
    }
    if (Object.keys(values).length) out[date] = {
      ...values, provisional: true, source: 'Corroborated news announcements',
      items: rows.filter((r) => Object.keys(values).some((f) => r.values[f] === values[f])).map(({ title, source, sourceUrl, published, link }) => ({ title, source, sourceUrl, published, link })),
    };
  }
  return out;
}

export async function fetchNews(fetchImpl = fetch, url = NEWS_URL, signal) {
  const response = await readUrl(url, { fetchImpl, signal, headers: { 'User-Agent': 'Mozilla/5.0 ph-fuel-price-watch' } });
  return parseRss(response.body);
}
