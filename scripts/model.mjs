// Pure forecasting logic (no network, no file access) so it can be tested.
export const CONFIG = {
  litersPerGallon: 3.78541,
  litersPerBarrel: 158.987,
  vat: 1.12,                 // pump prices carry 12% VAT on the cost change
  minCalibrationWeeks: 6,    // need this many (raw, actual) pairs before fitting
  priorWeeks: 8,             // the fitted scale is pulled toward 1 as if 8 perfect weeks had been seen
  minScale: 0.7, maxScale: 1.3,
  defaultErrorPhp: 2.5,      // typical miss (PHP/L) until calibrated; back-tests on Jul-Nov 2026 gave about 1.3 (diesel), 1.8 (gasoline), 1.8 (kerosene) on normal weeks
  minHalfRangePhp: 0.5,      // never show a range tighter than +/- this
  industryWeight: 0.9,       // weight of a published estimate typed in by hand (it is built on the real Singapore prices)
  newsWeight: 0.7,           // weight of an estimate read from news headlines (rounded, sometimes "up to")
  industryErrorPhp: 0.7,     // typical miss of a published estimate once it is based on the full week
  flatThresholdPhp: 0.05,    // |value| below this is shown as "no change"
  // Free futures standing in for Singapore prices: [symbol, weight]. On roll-free weeks Jul-Nov 2026 a Brent/RBOB mix beat either alone.
  proxies: {
    gasoline: [['BZ=F', 0.5], ['RB=F', 0.5]],
    diesel: [['HO=F', 1]],
    kerosene: [['HO=F', 1]],
  },
};
export const FUELS = Object.keys(CONFIG.proxies);
const UNIT_LITERS = { BZ: CONFIG.litersPerBarrel, HO: CONFIG.litersPerGallon, RB: CONFIG.litersPerGallon };
export const rootOf = (symbol) => symbol.slice(0, 2);

const DAY = 864e5;
// Trade date of a Yahoo daily bar. Futures bars are stamped at local midnight (or the evening session open),
// so the date must be read in the exchange's own time zone, daylight saving included.
export function barDate(ts, tz = 'America/New_York') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
  const local = `${p.year}-${p.month}-${p.day}`;
  const date = +p.hour >= 17 ? new Date(Date.parse(local) + DAY).toISOString().slice(0, 10) : local; // evening stamp = next trade date
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return dow === 0 || dow === 6 ? null : date;
}
export const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
export const manilaToday = (now = Date.now()) => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const inRange = (d, [a, b]) => d >= a && d <= b;
export const r2 = (x) => Math.round(x * 100) / 100;

// Next Tuesday strictly after `today`, and the two Mon-Fri weeks that drive it.
export function windows(today) {
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();
  const target = addDays(today, ((2 - dow + 7) % 7) || 7);
  return {
    target,
    cur: [addDays(target, -8), addDays(target, -4)],
    prev: [addDays(target, -15), addDays(target, -11)],
  };
}

export const isWeekend = (d) => [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay());

function fxOn(fx, date) {
  let best = null;
  for (const d of Object.keys(fx).sort()) { if (d <= date) best = fx[d]; else break; }
  return best;
}

// Extra uncertainty (PHP/L) from the days of the week not seen yet. Daily moves are a random walk and the unseen days
// are projected at the latest price, so the average of the week is off by sqrt(sum(m^2))/5 daily moves.
export function partialSd(dailySd, observedDays) {
  const n = Math.max(0, 5 - observedDays);
  return (dailySd * Math.sqrt((n * (n + 1) * (2 * n + 1)) / 6)) / 5;
}

// Week-on-week change in the average PHP/liter product cost, VAT included. Days of the current week that have not
// happened yet are held at the latest price (the unbiased guess for a random walk), instead of being left out.
export function rawChange(prices, fx, win, cfg = CONFIG, liters = cfg.litersPerGallon) {
  const levels = Object.entries(prices).sort().map(([d, p]) => [d, fxOn(fx, d) ? (p / liters) * fxOn(fx, d) : null]).filter(([, v]) => v != null);
  const within = (range) => levels.filter(([d]) => inRange(d, range)).map(([, v]) => v);
  const cur = within(win.cur), prev = within(win.prev);
  if (!cur.length || prev.length < 3) return null;
  const projected = [...cur, ...Array(Math.max(0, 5 - cur.length)).fill(cur.at(-1))];
  const recent = levels.slice(-21), moves = []; // day-to-day moves, skipping the jump across a month-end (that is a contract roll)
  for (let i = 1; i < recent.length; i++) if (recent[i][0].slice(0, 7) === recent[i - 1][0].slice(0, 7)) moves.push(recent[i][1] - recent[i - 1][1]);
  const dailySd = moves.length > 1 ? Math.sqrt(mean(moves.map((x) => (x - mean(moves)) ** 2))) * cfg.vat : 0;
  return { raw: (mean(projected) - mean(prev)) * cfg.vat, days: cur.length, dailySd };
}

// ---- Futures contract rolls. A continuous "front month" series jumps when it moves to the next contract
// (2-6% a month in a backwardated market). When a roll sits between the two weeks, both are read from one contract.
const MONTH_CODES = 'FGHJKMNQUVXZ';
const MONTHS_AHEAD = { HO: 1, RB: 1, BZ: 2 }; // front delivery month vs. the calendar month (Brent expires two months before delivery)
export function frontContract(root, date) {
  const idx = +date.slice(0, 4) * 12 + (+date.slice(5, 7) - 1) + MONTHS_AHEAD[root];
  return `${root}${MONTH_CODES[idx % 12]}${String(Math.floor(idx / 12) % 100).padStart(2, '0')}`;
}
const bars = (prices, win) => {
  const keys = Object.keys(prices).sort();
  return { first: keys.find((d) => d >= win.prev[0]), last: keys.filter((d) => d <= win.cur[1]).at(-1) };
};
export function spansRoll(root, prices, win) {
  const { first, last } = bars(prices, win);
  return Boolean(first && last) && frontContract(root, first) !== frontContract(root, last);
}
// The prices to compare for one proxy: the continuous series, or the one contract that is front in the current week.
export function seriesFor(symbol, S, win) {
  const root = rootOf(symbol), cont = S[symbol] ?? {};
  if (!spansRoll(root, cont, win)) return { prices: cont, rolled: false };
  const one = S[frontContract(root, bars(cont, win).last)];
  return one ? { prices: one, rolled: true } : { prices: cont, rolled: true, unresolved: true };
}

// One fuel's raw change from its weighted proxies. null when any proxy lacks data.
export function fuelChange(fuel, S, fx, win, cfg = CONFIG) {
  let raw = 0, dailySd = 0, days = 5, rolled = false, unresolved = false;
  for (const [symbol, weight] of cfg.proxies[fuel]) {
    const pick = seriesFor(symbol, S, win);
    const rc = rawChange(pick.prices, fx, win, cfg, UNIT_LITERS[rootOf(symbol)]);
    if (!rc) return null;
    raw += weight * rc.raw; dailySd += weight * rc.dailySd; days = Math.min(days, rc.days);
    rolled ||= pick.rolled; unresolved ||= Boolean(pick.unresolved);
  }
  return { raw, dailySd, days, rolled, unresolved };
}

// Percent change of a series' weekly average, plus its latest value (for the dashboard).
export function avgChange(series, win) {
  const vals = (range) => Object.entries(series).filter(([d]) => inRange(d, range)).map(([, v]) => v);
  const c = vals(win.cur), p = vals(win.prev);
  const dates = Object.keys(series).sort();
  const lastDate = dates.at(-1) ?? null;
  return { pct: c.length && p.length ? r2((mean(c) / mean(p) - 1) * 100) : null, last: lastDate ? series[lastDate] : null, lastDate };
}

export const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Fit actual ~ scale * raw through the origin. A few reweighting passes (Tukey bisquare) give a freak week no say in
// the scale, and the fit is pulled toward 1 so a handful of weeks cannot swing it. The error (rmse) still counts every week.
export function calibrate(pairs, cfg = CONFIG) {
  const n = pairs.length;
  if (n < cfg.minCalibrationWeeks) return { scale: 1, rmse: cfg.defaultErrorPhp, n, fitted: false };
  let scale = 1;
  for (let pass = 0; pass < 6; pass++) {
    const res = pairs.map(([r, a]) => a - scale * r);
    const spread = Math.max(0.5, 1.4826 * median(res.map((e) => Math.abs(e - median(res)))));
    const w = res.map((e) => (Math.abs(e) < 4.685 * spread ? (1 - (e / (4.685 * spread)) ** 2) ** 2 : 0));
    const sxy = pairs.reduce((s, [r, a], i) => s + w[i] * r * a, 0), sxx = pairs.reduce((s, [r], i) => s + w[i] * r * r, 0);
    const prior = cfg.priorWeeks * (sxx / w.reduce((a, b) => a + b, 0));
    scale = sxx ? Math.min(cfg.maxScale, Math.max(cfg.minScale, (sxy + prior) / (sxx + prior))) : 1;
  }
  const rmse = Math.sqrt(pairs.reduce((s, [r, a]) => s + (a - scale * r) ** 2, 0) / (n - 1));
  return { scale, rmse, n, fitted: true };
}

// A published estimate is a number or a [low, high] range of PHP/L (rollback negative).
export function toRange(v) {
  const a = Array.isArray(v) ? v : [v, v];
  return a.length === 2 && a.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [Math.min(...a), Math.max(...a)] : null;
}
// Per fuel, a hand-entered estimate wins over one read from the news.
export function pickEstimates(manual, news) {
  const out = {};
  for (const fuel of FUELS) {
    const m = toRange(manual?.[fuel]), n = toRange(news?.[fuel]);
    if (m) out[fuel] = { range: m, kind: 'manual' };
    else if (n) out[fuel] = { range: n, kind: 'news' };
  }
  return out;
}

export function forecast(raw, cal, industry, cfg = CONFIG, { weight = cfg.industryWeight, sd = 0 } = {}) {
  const model = raw * cal.scale;
  const value = industry ? (1 - weight) * model + weight * mean(industry) : model;
  const basis = industry ? Math.hypot((1 - weight) * cal.rmse, weight * cfg.industryErrorPhp) : cal.rmse;
  const half = Math.max(cfg.minHalfRangePhp, Math.hypot(basis, sd));
  const direction = value > cfg.flatThresholdPhp ? 'increase' : value < -cfg.flatThresholdPhp ? 'decrease' : 'unchanged';
  return {
    raw: r2(raw), model: r2(model), published: industry ? r2(mean(industry)) : null,
    value: r2(value), low: r2(value - half), high: r2(value + half),
    direction, withinError: Math.abs(value) < half, blended: Boolean(industry),
  };
}

export function confidence(days, calibratedWeeks) {
  if (days < 3) return 'low';
  return days >= 5 && calibratedWeeks >= 8 ? 'high' : 'medium';
}
