// Retrieves DOE fuel-adjustment announcements and, when available, the DOE's
// company-by-company prior-notice table. Only a median of >=3 company values
// is eligible for automatic calibration; DOE headline maxima/minima are kept
// as reference data and are NEVER treated as a nationwide actual.
import fs from 'node:fs/promises';

const DATA = new URL('../data/', import.meta.url);
const DOE_PRESS_RELEASES = 'https://doe.gov.ph/news-and-events/press-releases';
const DOE_PRIOR_NOTICE_SEARCH = 'https://doe.gov.ph/search?search_api_fulltext=Summary%20of%20Prior%20Notice%20on%20Price%20Adjustments';
const USER_AGENT = 'Mozilla/5.0 (compatible; PHFuelPriceWatch/1.0; +https://github.com/)';
const FUELS = ['gasoline', 'diesel', 'kerosene'];
const COMPANY_NAMES = [
  'Petron', 'Shell Pilipinas', 'Shell', 'Seaoil', 'SeaOil', 'Caltex', 'Chevron',
  'Phoenix Petroleum', 'Phoenix', 'Unioil', 'Total Philippines', 'Total',
  'PTT Philippines', 'PTT', 'Flying V', 'Jetti', 'Cleanfuel', 'Petro Gazz', 'Gazz',
  'Eastern Petroleum', 'Filpride', 'City Oil', ' lpg',
];

const readJson = async (name, fallback) => {
  try { return JSON.parse(await fs.readFile(new URL(name, DATA), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const writeJson = (name, value) => fs.writeFile(new URL(name, DATA), `${JSON.stringify(value, null, 2)}\n`);
const clean = (html) => decodeEntities(String(html)
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ').trim());
function decodeEntities(s) {
  return s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function parseAnnouncementLinks(html, base = DOE_PRESS_RELEASES) {
  const found = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = clean(match[2]);
    if ((!/fuel/i.test(title) && !/prior notice/i.test(title)) || !/(adjust|rollback|increase|price movement|prior notice)/i.test(title)) continue;
    const url = new URL(match[1], base).href;
    if (new URL(url).hostname.endsWith('doe.gov.ph')) found.set(url, { url, title });
  }
  return [...found.values()].slice(0, 30);
}

export function dateFromText(text, title = '') {
  const source = `${title} ${text}`;
  const effectivity = source.match(/Date\s*&\s*Time\s+of\s+Effectivity\s+\d{1,2}:\d{2}\s*(?:AM|PM),?\s+([A-Za-z]+)\s+(\d{1,2})/i);
  if (effectivity) {
    const yearMatch = source.match(/(?:19|20)\d{2}/);
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const month = months[effectivity[1].slice(0, 3).toLowerCase()];
    if (month && yearMatch) return `${yearMatch[0]}-${month}-${String(effectivity[2]).padStart(2, '0')}`;
  }
  const range = source.match(/(?:for|effective(?:\s+on)?|take effect(?:\s+on)?)\s+(\d{1,2})\s*(?:-|to|–|—)\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i)
    || source.match(/([A-Za-z]+)\s+(\d{1,2})\s*(?:-|to|–|—)\s*(\d{1,2}),?\s+(20\d{2})/i);
  const one = source.match(/(?:take effect(?:s)?\s+on|effective(?:\s+on)?|effectivity\s*(?:date)?\s*[:=-]?)\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i)
    || source.match(/(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i)
    || source.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i);
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const m = range ? (/[A-Za-z]/.test(range[1]) ? [range[2], range[1], range[4]] : [range[1], range[3], range[4]])
    : one && (/[A-Za-z]/.test(one[1]) ? [one[2], one[1], one[3]] : [one[1], one[2], one[3]]);
  if (!m) return null;
  const month = months[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  const iso = `${m[2]}-${month}-${String(m[0]).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

function directionFromText(text) {
  if (/rollback|decrease|reduction|lower(?:ed)?/i.test(text)) return -1;
  if (/increase|hike|rise|higher/i.test(text)) return 1;
  return null;
}
function directionForFuel(text, fuel) {
  const aliases = fuel === 'gasoline' ? 'gasoline|petrol' : fuel;
  const tokenRe = new RegExp(`\\b(?:${aliases})\\b`, 'gi');
  const tokens = [...text.matchAll(tokenRe)];
  for (let i = 0; i < tokens.length; i++) {
    const at = tokens[i].index;
    const previousSentence = Math.max(text.lastIndexOf('.', at), text.lastIndexOf(';', at)) + 1;
    const nextFuel = tokens[i + 1]?.index ?? text.length;
    const nextSentence = [text.indexOf('.', at), text.indexOf(';', at)].filter((n) => n >= 0);
    const end = Math.min(nextFuel, ...(nextSentence.length ? nextSentence : [text.length]));
    const start = Math.max(previousSentence, at - 45);
    const direction = directionFromText(text.slice(start, end));
    if (direction != null) return direction;
  }
  return null;
}

function amountForFuel(text, fuel) {
  const aliases = fuel === 'gasoline' ? 'gasoline|petrol' : fuel;
  const re = new RegExp(`(?:PHP|P|₱)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:per|/)\\s*(?:liter|litre|lit)\\s*(?:for\\s+)?(?:${aliases})|(?:${aliases})[^.;]{0,100}?(?:PHP|P|₱)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:per|/)\\s*(?:liter|litre|lit)`, 'i');
  const m = text.match(re);
  const n = m && Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : null;
}

export function parseCompanyRows(html, fullText = clean(html), directionText = fullText) {
  const rows = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => clean(m[1]));
    const text = cells.join(' | ');
    if (!/oil company|petron|shell|seaoil|caltex|phoenix|unioil|total philippines|ptt|flying v|jetti|cleanfuel|petro gazz/i.test(text)) continue;
    const company = COMPANY_NAMES.find((name) => text.toLowerCase().includes(name.toLowerCase()));
    if (!company) continue;
    const values = {};
    for (const fuel of FUELS) {
      const direction = directionForFuel(text, fuel) ?? directionForFuel(directionText, fuel) ?? directionForFuel(fullText, fuel);
      const amount = amountForFuel(text, fuel);
      if (amount != null && direction != null) values[fuel] = Number((amount * direction).toFixed(2));
    }
    if (Object.keys(values).length) rows.push({ company: company.trim(), values });
  }
  // Some DOE CMS document previews expose extracted text instead of HTML tables.
  if (!rows.length) {
    const chunks = fullText.split(/(?=Oil Company\s+)/i).slice(1);
    for (const chunk of chunks) {
      const company = COMPANY_NAMES.find((name) => chunk.toLowerCase().includes(name.toLowerCase()));
      if (!company) continue;
      const values = {};
      for (const fuel of FUELS) {
        const direction = directionForFuel(chunk, fuel) ?? directionForFuel(directionText, fuel);
        const amount = amountForFuel(chunk, fuel);
        if (amount != null && direction != null) values[fuel] = Number((amount * direction).toFixed(2));
      }
      if (Object.keys(values).length) rows.push({ company: company.trim(), values });
    }
  }
  // Deduplicate repeated rows for the same company; latest row wins.
  return [...new Map(rows.map((r) => [r.company.toLowerCase(), r])).values()];
}

function parseHeadlineSummary(text) {
  const out = {};
  for (const fuel of FUELS) {
    const direction = directionForFuel(text, fuel);
    const n = amountForFuel(text, fuel);
    if (n != null && direction != null) out[fuel] = Number((n * direction).toFixed(2));
  }
  return out;
}

export function selectCompanyMedian(companies) {
  const selected = {};
  const counts = {};
  for (const fuel of FUELS) {
    const values = companies.map((c) => c.values[fuel]).filter(Number.isFinite).sort((a, b) => a - b);
    counts[fuel] = values.length;
    if (values.length < 3 || values.some((v) => Math.abs(v) > 50)) continue;
    const mid = Math.floor(values.length / 2);
    selected[fuel] = Number((values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2).toFixed(2));
  }
  return { selected, counts };
}

export function applySelectedActuals(actuals, metadata, date, selected, sourceUrl, retrievedAt, counts, previousRecord = null) {
  if (Object.keys(selected).length) actuals[date] ??= {};
  metadata.manualOverrides ??= {};
  metadata.manualOverrides[date] ??= {};
  for (const fuel of FUELS) {
    if (!Number.isFinite(selected[fuel])) continue;
    const oldMeta = previousRecord?.fieldSources?.[fuel];
    const isProtected = metadata.manualOverrides?.[date]?.[fuel] === true
      || (Number.isFinite(actuals[date][fuel])
        && oldMeta?.sourceType !== 'doe-auto'
        && !metadata.autoManaged?.[date]?.includes(fuel));
    if (isProtected) continue;
    actuals[date][fuel] = selected[fuel];
    metadata.records[date].fieldSources ??= {};
    metadata.records[date].fieldSources[fuel] = { sourceType: 'doe-auto', sourceUrl, retrievedAt, companyCount: counts[fuel], selection: 'median' };
    metadata.autoManaged ??= {};
    metadata.autoManaged[date] ??= [];
    if (!metadata.autoManaged[date].includes(fuel)) metadata.autoManaged[date].push(fuel);
  }
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function main() {
  const retrievedAt = new Date().toISOString();
  const actuals = await readJson('actuals.json', {});
  const metadata = await readJson('actuals-meta.json', { records: {} });
  metadata.records ??= {};
  let links;
  try {
    const [pressHtml, noticeSearchHtml] = await Promise.all([fetchText(DOE_PRESS_RELEASES), fetchText(DOE_PRIOR_NOTICE_SEARCH).catch(() => '')]);
    links = [...new Map([...parseAnnouncementLinks(pressHtml), ...parseAnnouncementLinks(noticeSearchHtml)]
      .map((item) => [item.url, item])).values()];
  } catch (error) {
    console.warn(`DOE check unavailable; existing actuals left unchanged: ${error.message}`);
    process.exit(0);
  }
  if (!links.length) {
    console.warn('No matching DOE fuel-adjustment announcements found; actuals left unchanged.');
    process.exit(0);
  }

  let processed = 0;
  const announcementContexts = new Map();
  const orderedLinks = [...links].sort((a, b) => Number(/prior notice/i.test(a.title)) - Number(/prior notice/i.test(b.title)));
  for (const item of orderedLinks) {
    let html;
    try { html = await fetchText(item.url); }
    catch (error) { console.warn(`Skipping ${item.url}: ${error.message}`); continue; }
    const text = clean(html);
    const effectiveDate = dateFromText(text, item.title);
    if (!effectiveDate) { console.warn(`Could not identify effective date: ${item.url}`); continue; }
    const isPriorNotice = /prior notice/i.test(item.title) || /summary of prior notice/i.test(text);
    if (!isPriorNotice) announcementContexts.set(effectiveDate, text);
    const directionContext = announcementContexts.get(effectiveDate) ?? text;
    const companies = parseCompanyRows(html, text, directionContext);
    const { selected, counts } = selectCompanyMedian(companies);
    const summary = parseHeadlineSummary(text);
    const previous = metadata.records[effectiveDate];
    const record = {
      effectiveDate, retrievedAt, sourceUrl: item.url, announcementTitle: item.title,
      selectionRule: 'Median of company-reported values per fuel; minimum 3 companies. DOE headline maxima/minima are reference-only.',
      companyCount: companies.length, companies, companyCounts: counts,
      selected, headlineSummary: summary, documentType: isPriorNotice ? 'company-prior-notice' : 'doe-announcement',
      status: Object.keys(selected).length ? 'company-data-selected' : 'review-required',
      fieldSources: { ...(previous?.fieldSources ?? {}) },
    };
    // Do not downgrade an existing record with company data to a less complete one.
    if (previous?.status === 'company-data-selected' && record.status !== 'company-data-selected') continue;
    metadata.records[effectiveDate] = record;
    processed++;

    applySelectedActuals(actuals, metadata, effectiveDate, selected, item.url, retrievedAt, counts, previous);
  }

  await writeJson('actuals.json', Object.fromEntries(Object.entries(actuals).sort(([a], [b]) => a.localeCompare(b))));
  await writeJson('actuals-meta.json', metadata);
  console.log(`DOE scan complete: ${processed} announcement(s) checked. Company medians are applied only where at least 3 company values were found; otherwise review is required.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error('DOE retrieval failed safely:', error.message); process.exitCode = 0; });
}
