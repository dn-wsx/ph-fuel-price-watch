const $ = (s) => document.querySelector(s);
const NAMES = { gasoline: 'Gasoline', diesel: 'Diesel', kerosene: 'Kerosene' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const php = (v, plain) => (v == null ? '—' : `${plain ? '' : v > 0 ? '+' : v < 0 ? '−' : ''}₱${Math.abs(v).toFixed(2)}`);
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
const fmtDate = (iso, opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-PH', { ...opts, timeZone: 'UTC' });
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? esc(u) : '');
const LABEL = { increase: '▲ Price hike', decrease: '▼ Rollback', unchanged: '● No change' };

const GOOD_PHP = 1, OK_PHP = 2.5; // a miss within P1 is good, within P2.50 fair, beyond that poor
const grade = (miss) => (Math.abs(miss) <= GOOD_PHP ? 'good' : Math.abs(miss) <= OK_PHP ? 'ok' : 'bad');
const signed = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`); // pesos per liter, shown without the peso sign to keep the table narrow
const FUEL_KEYS = Object.keys(NAMES);
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// One block of three cells per fuel: what we forecast, what the DOE announced, and how far off we were.
function historyTable(rows) {
  const head = `<thead><tr><th rowspan="2" class="date">Tuesday</th>${FUEL_KEYS.map((k) => `<th colspan="3" class="grp">${NAMES[k]}</th>`).join('')}</tr>
    <tr>${FUEL_KEYS.map(() => '<th class="num grp">Forecast</th><th class="num">Actual</th><th class="num">Miss</th>').join('')}</tr></thead>`;
  const cells = (r, k) => {
    const { forecast: f, actual: a } = r.fuels[k], miss = f != null && a != null ? f - a : null;
    return `<td class="num grp fc">${signed(f)}${r.backtest && f != null ? '<sup>*</sup>' : ''}</td>
      <td class="num act ${a < 0 ? 'down' : a > 0 ? 'up' : ''}">${signed(a)}</td>
      <td class="num">${miss == null ? '<span class="muted">—</span>' : `<span class="miss ${grade(miss)}" title="Forecast was ₱${Math.abs(miss).toFixed(2)} ${miss > 0 ? 'higher' : 'lower'} than the actual">${signed(miss)}</span>`}</td>`;
  };
  const year = rows[0].date.slice(0, 4);
  const body = rows.map((r) => `<tr><td class="date" title="${fmtDate(r.date)}">${fmtDate(r.date, r.date.startsWith(year) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}</td>${FUEL_KEYS.map((k) => cells(r, k)).join('')}</tr>`).join('');
  const foot = FUEL_KEYS.map((k) => {
    const both = rows.map((r) => r.fuels[k]).filter((x) => x.forecast != null && x.actual != null);
    if (!both.length) return '<td colspan="3" class="grp"></td>';
    const mae = avg(both.map((x) => Math.abs(x.forecast - x.actual))), right = both.filter((x) => Math.sign(x.forecast) === Math.sign(x.actual)).length;
    return `<td colspan="2" class="num grp muted">direction ${right}/${both.length}</td><td class="num"><span class="miss ${grade(mae)}">${mae.toFixed(2)}</span></td>`;
  }).join('');
  return `${head}<tbody>${body}</tbody><tfoot><tr><th class="date">Average miss</th>${foot}</tr></tfoot>`;
}

const STAGE_LABEL = { early: 'Tuesday, before Singapore posts', 1: 'After day 1', 2: 'After day 2', 3: 'After day 3', 4: 'After day 4', 5: 'After day 5', final: 'Final (before Tuesday)' };

// What the page really said at each point of the week, against the DOE's figure. Empty until a saved week has an actual.
function liveTable(t) {
  const pending = t?.pending?.length ? `Tracking now: the ${fmtDate(t.pending[0], { month: 'long', day: 'numeric' })} adjustment.` : '';
  if (!t?.weeks) return `<p class="note">Every row above was rebuilt afterwards from finished data. From now on the page also saves what it says each day, and the real accuracy appears here once a saved week has been announced. ${esc(pending)}</p>`;
  const rows = t.stages.map((s) => `<tr><td class="date">${STAGE_LABEL[s.key] ?? s.key}</td>${FUEL_KEYS.map((k) => `<td class="num">${s.mae[k] == null ? '<span class="muted">—</span>' : `<span class="miss ${grade(s.mae[k])}">${s.mae[k].toFixed(2)}</span>`}</td>`).join('')}<td class="num muted">${s.n}</td></tr>`).join('');
  return `<div class="scroll"><table><thead><tr><th class="date">When</th>${FUEL_KEYS.map((k) => `<th class="num">${NAMES[k]}</th>`).join('')}<th class="num">Weeks</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Average miss in pesos per liter, from what the page actually showed, across ${t.weeks} announced week${t.weeks === 1 ? '' : 's'}. ${esc(pending)}</p>`;
}

function render(d) {
  $('#sub').textContent = `Estimated change at the pump starting ${fmtDate(d.target)}. Confidence: ${d.confidence}.`;

  const notes = [];
  const fuels = Object.entries(d.fuels);
  const staleHours = (Date.now() - Date.parse(d.generatedAt)) / 36e5, singaporeGap = d.singaporeThrough ? (Date.parse(d.asOf) - Date.parse(d.singaporeThrough)) / 864e5 : null;
  if (staleHours > 36) notes.push(`This page was last updated ${Math.round(staleHours)} hours ago, so the automatic update may have stopped. The numbers may be out of date.`);
  else if (singaporeGap != null && singaporeGap > 4) notes.push(`Singapore prices have not updated since ${fmtDate(d.singaporeThrough, { month: 'short', day: 'numeric' })}, so the estimate may be behind.`);
  if (d.sample) notes.push('These are sample numbers. The first scheduled run replaces them with real estimates.');
  if (d.errors?.length) notes.push('Some data could not be refreshed, so older saved data may be in use.');
  if (d.actualsNote) notes.push(esc(d.actualsNote));
  if (d.basis === 'us-waiting') notes.push(`Singapore prices for this week's first trading day are not posted yet (Opinet posts each Singapore trading day the day after). This early look uses US futures, which miss Asian moves, so treat it as rough.`);
  else if (d.basis === 'us-unreadable') notes.push('Singapore prices (Opinet) could not be read, so the model is using US futures. They miss Asian moves, so treat this as rough.');
  if (d.rollWarning) notes.push('A futures contract roll falls inside this comparison and could not be corrected. Treat it as rough.');
  const banner = $('#banner');
  banner.hidden = !notes.length;
  banner.innerHTML = notes.map((n) => `<p>${n}</p>`).join('');

  $('#board').innerHTML = fuels.map(([k, f]) => `
    <div class="row ${f.direction}">
      <div class="name">${NAMES[k]}</div>
      <div class="val">${php(f.value)}</div>
      <div class="meta"><span class="tag">${LABEL[f.direction]}${f.withinError ? ' (within margin of error)' : ''}</span>
      <span title="The final adjustment landed inside this range in about 3 of 4 past weeks">Typical range ${php(f.low)} to ${php(f.high)} per liter</span></div>
      ${f.news != null ? `<div class="meta src"><span>News estimate for comparison: ${php(f.news)}</span></div>` : ''}
    </div>`).join('') || '<div class="row"><div class="name">No forecast yet</div></div>';

  const days = Math.min(...Object.values(d.fuels).map((f) => f.daysOfData ?? 0), 5);
  $('#boardNote').textContent = `${d.basis && d.basis !== 'singapore' ? 'Early look from US futures, based on' : 'Based on'} ${days} of 5 trading days this week${d.singaporeThrough ? ` (Singapore through ${fmtDate(d.singaporeThrough, { month: 'short', day: 'numeric' })})` : ''}. Updated ${new Date(d.generatedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })} PHT.`;

  const m = d.market, fx = m.fx.pct;
  const trend = (p) => (p == null ? 'not enough data' : p > 0 ? `up ${Math.abs(p)}%` : p < 0 ? `down ${Math.abs(p)}%` : 'flat');
  const f0 = Object.values(d.fuels)[0];
  $('#why').innerHTML = `
    <p>Pump prices follow the average Singapore (MOPS) product price from Monday to Friday against the week before, converted to pesos, plus 12% VAT. The model reads the daily Singapore prices for gasoline (RON 92), diesel (0.001%S) and kerosene from Korea's Opinet, which publishes them the day after. Days that Singapore's market is closed do not count, and days still to come are held at the latest price. That is the same arithmetic as the daily "trading Day N" estimates that oil-price pages post.</p>
    <p>Singapore prices through ${d.singaporeThrough ? fmtDate(d.singaporeThrough, { month: 'short', day: 'numeric' }) : 'an unknown date'}, against last week's average: gasoline ${trend(m.mogas?.pct)}, diesel ${trend(m.gasoil?.pct)} and kerosene ${trend(m.jet?.pct)}. The peso moved ${fx == null ? 'by an unknown amount' : fx > 0 ? `weaker (USD/PHP ${trend(fx)})` : fx < 0 ? `stronger (USD/PHP ${trend(fx)})` : 'not at all'} against the dollar, which ${fx > 0 ? 'pushes costs up' : fx < 0 ? 'eases costs' : 'does not change costs'}.</p>
    <p>${f0 && f0.calibrationWeeks >= 6 ? `The model is corrected using ${f0.calibrationWeeks} past DOE adjustments.` : 'The model is not corrected against past DOE adjustments yet, so the ranges are wide.'}${d.rollAdjusted ? ' A futures contract roll falls inside this comparison, so both weeks are read from the same contract.' : ''}</p>`;
  $('#market').innerHTML = `<tr><th>Indicator</th><th class="num">Latest</th><th class="num">Week so far vs last week</th></tr>` +
    Object.values(m).map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.last ?? '—'} ${esc(x.unit)}</td><td class="num">${pct(x.pct)}</td></tr>`).join('');

  const src = [];
  if (d.news?.items?.length) src.push(`<li><strong>Headlines that agree on an estimate:</strong><ul>${d.news.items.slice(0, 5).map((i) => `<li>${safeUrl(i.link) ? `<a href="${safeUrl(i.link)}" rel="noopener">${esc(i.title)}</a>` : esc(i.title)} <span class="muted">${esc(i.source)} · ${fmtDate(i.published.slice(0, 10), { month: 'short', day: 'numeric' })}</span></li>`).join('')}</ul></li>`);
  if (!d.news) src.push('<li>No estimate in the news for this Tuesday yet. Outlets usually publish one from Thursday.</li>');
  if (d.newsNote) src.push(`<li>${esc(d.newsNote)}</li>`);
  $('#sources').innerHTML = `<ul>${src.join('')}</ul>`;

  const acc = Object.entries(d.accuracy ?? {}).filter(([, a]) => a.weeks);
  $('#accuracy').textContent = acc.length ? `The model alone, checked against ${acc[0][1].weeks} past weeks: average miss ${acc.map(([k, a]) => `${NAMES[k].toLowerCase()} ${php(a.mae, true)} (worst ${php(a.worst, true)})`).join(', ')} per liter.` : '';

  const rows = d.history ?? [];
  $('#history').innerHTML = rows.length ? historyTable(rows) : '<tbody><tr><td>No actual adjustments yet. They are read from the DOE\'s weekly Oil Monitor automatically.</td></tr></tbody>';
  $('#histNote').hidden = !rows.some((r) => r.backtest);
  $('#live').innerHTML = liveTable(d.liveTrack);
}

fetch(`data/forecast.json?t=${Date.now()}`)
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(render)
  .catch(() => { $('#sub').textContent = 'The forecast could not be loaded. Refresh the page, or check that data/forecast.json exists.'; });
