// Published estimates of the next Tuesday's pump price change, read from news headlines (Google News RSS).
// Outlets repeat the same industry estimate (Jetti, Unioil, Petron sources, DOE) every Thursday to Saturday.
// A headline is used only if it names a fuel and an amount; an estimate is used only if two headlines agree.
import { windows, r2, median } from './model.mjs';

export const NEWS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent('oil price rollback OR hike next week Philippines diesel gasoline when:10d')}&hl=en-PH&gl=PH&ceid=PH:en`;

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
    if (title && !Number.isNaN(published.getTime())) items.push({ title, source, published: published.toISOString(), link: pick('link') ? decode(pick('link')) : '' });
  }
  return items;
}

const manilaDate = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);

// {gasoline, diesel, kerosene} in PHP/L (rollback negative; a number or [low, high]), or null if the headline is not a usable forecast.
export function parseEstimate(title, publishedIso) {
  const dow = new Date(manilaDate(publishedIso) + 'T00:00:00Z').getUTCDay(); // 4=Thu .. 0=Sun carry forecasts; Mon to Wed headlines are about the adjustment already announced
  if (ACTUAL.test(title) || !(CUE.test(title) || [4, 5, 6, 0].includes(dow))) return null;
  const clean = title.split(/\bLink to\b|\|/)[0].replace(/\bup to\b/gi, ' ').replace(/\bover\b/gi, ' ');
  const out = {};
  const clauses = clean.split(/[,;]|\bwhile\b|\bbut\b|\band\b/i).map((text) => ({ text, down: DOWN.test(text), up: UP.test(text) })); // one amount per fuel; "gasoline and diesel fall P4" keeps only the fuel next to the amount
  const own = clauses.map((c) => (c.down === c.up ? 0 : c.down ? -1 : 1));
  // A clause with no direction word takes it from the clause before ("P13 for gas, P4 for diesel") or after ("Diesel P6.40 and gasoline P4.70 rollback").
  let last = 0, next = 0;
  const before = own.map((d) => (last = d || last)), after = own.map((_, i) => own[own.length - 1 - i]).map((d) => (next = d || next)).reverse();
  clauses.forEach((c, i) => {
    const dir = c.down && c.up ? 0 : own[i] || before[i] || after[i];
    const amount = c.text.match(AMOUNT);
    const fuels = Object.keys(FUEL_WORDS).filter((f) => FUEL_WORDS[f].test(c.text));
    if (!amount || !dir || !fuels.length) return;
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

export async function fetchNews(fetchImpl = fetch) {
  const res = await fetchImpl(NEWS_URL, { headers: { 'User-Agent': 'Mozilla/5.0 ph-fuel-price-watch' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRss(await res.text());
}
