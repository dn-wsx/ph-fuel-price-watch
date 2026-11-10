// Pure forecasting logic (no network, no file access) so it can be tested.
export const CONFIG = {
  litersPerGallon: 3.78541,
  vat: 1.12,                 // pump prices carry 12% VAT on the cost change
  minCalibrationWeeks: 6,    // need this many (raw, actual) pairs before fitting
  defaultErrorPhp: 0.6,      // assumed typical miss (PHP/L) until calibrated
  minHalfRangePhp: 0.3,      // never show a range tighter than +/- this
  industryWeight: 0.5,       // blend weight for a manual industry estimate
  flatThresholdPhp: 0.05,    // |value| below this is shown as "no change"
  // Free US futures used as proxies for Singapore (MOPS) prices, USD per gallon
  proxies: { gasoline: 'RB=F', diesel: 'HO=F', kerosene: 'HO=F' },
};

const DAY = 864e5;
export const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
export const manilaToday = (now = Date.now()) => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const inRange = (d, [a, b]) => d >= a && d <= b;
const r2 = (x) => Math.round(x * 100) / 100;

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

function fxOn(fx, date) {
  let best = null;
  for (const d of Object.keys(fx).sort()) { if (d <= date) best = fx[d]; else break; }
  return best;
}

// Week-on-week change in the average PHP/liter product cost, VAT included.
export function rawChange(prices, fx, win, cfg = CONFIG) {
  const pick = (range) => Object.entries(prices)
    .filter(([d]) => inRange(d, range))
    .map(([d, p]) => ({ p, fx: fxOn(fx, d) }))
    .filter((x) => x.fx);
  const cur = pick(win.cur), prev = pick(win.prev);
  if (!cur.length || prev.length < 3) return null;
  const php = (rows) => mean(rows.map((r) => (r.p / cfg.litersPerGallon) * r.fx));
  return { raw: (php(cur) - php(prev)) * cfg.vat, days: cur.length };
}

// Percent change of a series' weekly average, plus its latest value (for the dashboard).
export function avgChange(series, win) {
  const vals = (range) => Object.entries(series).filter(([d]) => inRange(d, range)).map(([, v]) => v);
  const c = vals(win.cur), p = vals(win.prev);
  const dates = Object.keys(series).sort();
  const lastDate = dates.at(-1) ?? null;
  return { pct: c.length && p.length ? r2((mean(c) / mean(p) - 1) * 100) : null, last: lastDate ? series[lastDate] : null, lastDate };
}

// Fit actual ~ scale * raw through the origin once there is enough history.
export function calibrate(pairs, cfg = CONFIG) {
  const n = pairs.length;
  if (n < cfg.minCalibrationWeeks) return { scale: 1, rmse: cfg.defaultErrorPhp, n, fitted: false };
  const sxy = pairs.reduce((s, [r, a]) => s + r * a, 0), sxx = pairs.reduce((s, [r]) => s + r * r, 0);
  const scale = sxx ? Math.min(1.5, Math.max(0.5, sxy / sxx)) : 1;
  const rmse = Math.sqrt(mean(pairs.map(([r, a]) => (a - scale * r) ** 2)));
  return { scale, rmse, n, fitted: true };
}

export function forecast(raw, cal, industry, cfg = CONFIG) {
  let value = raw * cal.scale;
  if (industry) value = (1 - cfg.industryWeight) * value + cfg.industryWeight * mean(industry);
  const half = Math.max(cfg.minHalfRangePhp, cal.rmse);
  const direction = value > cfg.flatThresholdPhp ? 'increase' : value < -cfg.flatThresholdPhp ? 'decrease' : 'unchanged';
  return {
    raw: r2(raw), value: r2(value), low: r2(value - half), high: r2(value + half),
    direction, withinError: Math.abs(value) < half, blended: Boolean(industry),
  };
}

export function confidence(days, calibratedWeeks) {
  if (days < 3) return 'low';
  return days >= 5 && calibratedWeeks >= 8 ? 'high' : 'medium';
}
