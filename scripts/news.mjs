// Published estimates and actual announcements, read from news headlines and bounded publisher feeds.
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

function stripArticleHtml(text = '') {
  return decode(text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
  ).trim();
}

export function parseAnnouncementText(text, target) {
  const clean = stripArticleHtml(text);
  if (!clean || !/^\d{4}-\d{2}-\d{2}$/.test(target ?? '')) return null;
  const clauses = clean.split(/(?<=[.!?])\s+|;\s*|\n+/).filter(Boolean);
  const relevant = clauses.filter((clause) =>
    /gasoline/i.test(clause) &&
    /diesel/i.test(clause) &&
    /kerosene/i.test(clause) &&
    /(?:P|PHP|₱)\s?\d+(?:\.\d+)?/i.test(clause)
  );
  if (relevant.length) {
    const filtered = relevant.find((clause) => !/may|could|estimate|estimated|forecast|projected|seen|expected|up to|at least|between|range/i.test(clause));
    if (!filtered) return null;
  }

  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const explicitDates = [...clean.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/gi)].map((match) => {
    const month = monthNames.findIndex((name) => name.startsWith(match[1].toLowerCase().replace('.', '').slice(0, 3))) + 1;
    const year = match[3] ? Number(match[3]) : Number(target.slice(0, 4));
    const date = `${year}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
    const context = clean.slice(Math.max(0, match.index - 40), Math.min(clean.length, match.index + 100));
    return { date, context };
  });
  const effectiveDates = explicitDates.filter(({ context }) => /\bTuesday\b|effective|starting|takes? effect|took effect|adjustments?/i.test(context));
  if (effectiveDates.length && effectiveDates.some(({ date }) => date !== target)) return null;
  if (!/\bTuesday\b/i.test(clean) && !effectiveDates.length) return null;
  if (!/(?:effective|starting|takes? effect|took effect|dropped|decreased|down by|down |rollbacks?|price cuts?|lowered|go down)/i.test(clean)) return null;

  const out = {};
  for (const [fuel, pattern] of Object.entries(FUEL_WORDS)) {
    const occurrences = [...clean.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
    if (!occurrences.length) continue;
    let found = null;
    for (const occurrence of occurrences) {
      const start = occurrence.index;
      const after = clean.slice(start, Math.min(clean.length, start + 100));
      const amount = after.match(/(?:₱|PHP|P)\s*(\d+(?:\.\d+)?)/i);
      if (amount) {
        const lo = Number(amount[1]);
        if (lo > 0 && lo <= 30) { found = lo; break; }
      }
    }
    if (found == null) continue;
    const start = occurrences[0].index;
    const directionWindow = clean.slice(Math.max(0, start - 100), Math.min(clean.length, start + 180));
    const down = DOWN.test(directionWindow);
    const up = UP.test(directionWindow);
    if (down === up) continue;
    out[fuel] = (down ? -1 : 1) * found;
  }
  return Object.keys(out).length === 3 ? out : null;
}

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

export function supportedPublisher(rawUrl) {
  let host;
  try { host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  return PUBLISHERS.find((publisher) => host === publisher || host.endsWith(`.${publisher}`)) ?? null;
}

export async function resolveArticleUrl(rawUrl, fetchImpl = fetch, expectedPublisher) {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return null;
  const initialPublisher = supportedPublisher(rawUrl);
  if (!initialPublisher || (expectedPublisher && initialPublisher !== expectedPublisher)) return null;
  let response;
  try {
    response = await readUrl(rawUrl, {
      fetchImpl, timeoutMs: 15_000, attempts: 1, maxBytes: 1_500_000, format: 'text',
      redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 ph-fuel-price-watch' },
    });
  } catch {
    return null;
  }
  const finalUrl = response.headers?.get('location') || rawUrl;
  return supportedPublisher(finalUrl) === initialPublisher ? finalUrl : null;
}

export const ARTICLE_FEEDS = [
  { publisher: 'inquirer.net', url: 'https://business.inquirer.net/feed', direct: false },
];

export function parsePublisherFeed(xml, publisher) {
  const items = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const pick = (tag) => body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1];
    const title = decode(pick('title') ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const rawUrl = decode(pick('link') ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const date = new Date(pick('pubDate') ?? '');
    const published = !Number.isNaN(date.getTime()) ? date.toISOString() : '';
    const description = decode(pick('description') ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const encoded = decode(pick('content:encoded') ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const sourceUrl = supportedPublisher(rawUrl) === publisher ? rawUrl : null;
    if (title && sourceUrl && published) items.push({
      title, description, encoded, source: publisher, sourceUrl, link: sourceUrl, published,
      publisher,
    });
  }
  return items;
}

export async function fetchAnnouncementArticles({ today, fetchImpl = fetch, signal } = {}) {
  const items = [];
  const problems = [];
  for (const feed of ARTICLE_FEEDS) {
    try {
      const response = await readUrl(feed.url, {
        fetchImpl, signal, timeoutMs: 25_000, attempts: 2, maxBytes: 512_000,
        headers: { 'User-Agent': 'Mozilla/5.0 ph-fuel-price-watch' },
      });
      for (const item of parsePublisherFeed(response.body, feed.publisher).slice(0, 20)) {
        const date = manilaDate(item.published);
        if (date > today || date < addDays(today, -10)) continue;
        const publishedWeekday = new Date(date + 'T00:00:00Z').getUTCDay();
        const target = publishedWeekday === 1 ? addDays(date, 1)
          : publishedWeekday === 2 ? date
          : publishedWeekday === 0 ? addDays(date, 2)
          : addDays(date, -((publishedWeekday - 2 + 7) % 7));
        if (target > today || target < addDays(today, -8)) continue;
        let text = `${item.title}\n${item.link}`;
        if (feed.direct) {
          const resolved = await resolveArticleUrl(item.link, fetchImpl, feed.publisher);
          if (!resolved) continue;
          try {
            const article = await readUrl(resolved, {
              fetchImpl, signal, timeoutMs: 25_000, attempts: 2, maxBytes: 1_500_000,
              headers: { 'User-Agent': 'Mozilla/5.0 ph-fuel-price-watch' },
            });
            text = article.body;
          } catch (error) {
            problems.push(`${feed.publisher}: article could not be read (${error.message}).`);
            continue;
          }
        } else {
          text = `${item.title}\n${item.description ?? ''}\n${item.encoded ?? ''}\n${item.link}`;
        }
        const values = parseAnnouncementText(text, target);
        if (values) items.push({ ...item, title: stripArticleHtml(text).slice(0, 400), target, values });
      }
    } catch (error) {
      problems.push(`${feed.publisher}: feed could not be read (${error.message}).`);
    }
  }
  return { items, problems };
}

export function announcementsFromArticles(items, today, problems = []) {
  const grouped = {};
  for (const item of items) {
    if (!item?.publisher || !supportedPublisher(item.sourceUrl) || supportedPublisher(item.sourceUrl) !== item.publisher) continue;
    const target = item.target ?? (Number.isFinite(Date.parse(item.published)) ? manilaDate(item.published) : null);
    if (!target) continue;
    if (target > today || target < addDays(today, -8)) continue;
    for (const fuel of Object.keys(FUEL_WORDS)) {
      if (!Number.isFinite(item.values?.[fuel])) continue;
      (grouped[target] ??= {});
      (grouped[target][fuel] ??= []).push({ ...item, value: item.values[fuel] });
    }
  }
  const out = {};
  for (const [date, fuels] of Object.entries(grouped)) {
    const values = {};
    for (const [fuel, candidates] of Object.entries(fuels)) {
      const byPublisher = new Map();
      for (const candidate of candidates) {
        if (!byPublisher.has(candidate.publisher)) byPublisher.set(candidate.publisher, candidate.value);
      }
      if (byPublisher.size < 2) continue;
      const distinct = [...new Set(byPublisher.values())];
      if (distinct.length === 1) values[fuel] = distinct[0];
      else problems.push(`${date} ${fuel}: conflicting article announcement amounts; not recorded from news.`);
    }
    if (Object.keys(values).length) {
      const evidence = [];
      for (const fuel of Object.keys(values)) {
        for (const candidate of grouped[date][fuel]) if (candidate.value === values[fuel] && !evidence.some((x) => x.link === candidate.link)) evidence.push(candidate);
      }
      out[date] = {
        ...values,
        provisional: true,
        source: 'Corroborated news articles',
        items: evidence.map(({ title, source, sourceUrl, published, link }) => ({ title, source, sourceUrl, published, link })),
      };
    }
  }
  return out;
}

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
