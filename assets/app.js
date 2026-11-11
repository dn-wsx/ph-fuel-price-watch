const $ = (s) => document.querySelector(s);
const NAMES = { gasoline: 'Gasoline', diesel: 'Diesel', kerosene: 'Kerosene' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const php = (v, plain) => (v == null ? '—' : `${plain ? '' : v > 0 ? '+' : v < 0 ? '−' : ''}₱${Math.abs(v).toFixed(2)}`);
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
const fmtDate = (iso, opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-PH', { ...opts, timeZone: 'UTC' });
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? esc(u) : '');
const LABEL = { increase: '▲ Price hike', decrease: '▼ Rollback', unchanged: '● No change' };

function render(d) {
  $('#sub').textContent = `Estimated change at the pump starting ${fmtDate(d.target)}. Confidence: ${d.confidence}.`;

  const notes = [];
  const fuels = Object.entries(d.fuels);
  const missing = fuels.filter(([, f]) => f.published == null).map(([k]) => NAMES[k].toLowerCase());
  const apart = fuels.filter(([, f]) => f.published != null && Math.abs(f.published - f.model) >= 2.5).map(([k]) => NAMES[k].toLowerCase());
  if (d.sample) notes.push('These are sample numbers. The first scheduled run replaces them with real estimates.');
  if (d.errors?.length) notes.push('Some data could not be refreshed, so older saved data may be in use.');
  if (d.actualsNote) notes.push(esc(d.actualsNote));
  if (d.singaporeData === false) notes.push('Singapore prices (Opinet) could not be read, so the model is using US futures. They miss Asian moves, so treat this as rough.');
  if (d.rollWarning) notes.push('A futures contract roll falls inside this comparison and could not be corrected. Treat it as rough.');
  if (missing.length) notes.push(`No published estimate yet for ${missing.join(', ')}, so ${missing.length === fuels.length ? 'this is the model alone' : 'that fuel uses the model alone'}. It uses the real Singapore prices, a day behind, and usually lands within about ₱1 of the final adjustment.`);
  if (apart.length) notes.push(`The model and the published estimate differ by ₱2.50 or more for ${apart.join(', ')}. The published figure carries most of the weight.`);
  const banner = $('#banner');
  banner.hidden = !notes.length;
  banner.innerHTML = notes.map((n) => `<p>${n}</p>`).join('');

  const blend = (f) => f.published == null
    ? 'Model only (Singapore prices)'
    : `${Math.round(f.estimate.weight * 100)}% ${f.estimate.kind === 'manual' ? 'published estimate' : 'news estimate'} (${php(f.published)}) · ${100 - Math.round(f.estimate.weight * 100)}% model (${php(f.model)})`;
  $('#board').innerHTML = fuels.map(([k, f]) => `
    <div class="row ${f.direction}">
      <div class="name">${NAMES[k]}</div>
      <div class="val">${php(f.value)}</div>
      <div class="meta"><span class="tag">${LABEL[f.direction]}${f.withinError ? ' (within margin of error)' : ''}</span>
      <span>Likely range ${php(f.low)} to ${php(f.high)} per liter</span></div>
      <div class="meta src"><span>${blend(f)}</span></div>
    </div>`).join('') || '<div class="row"><div class="name">No forecast yet</div></div>';

  const days = Math.min(...Object.values(d.fuels).map((f) => f.daysOfData ?? 0), 5);
  $('#boardNote').textContent = `Based on ${days} of 5 trading days this week${d.singaporeThrough ? ` (Singapore through ${fmtDate(d.singaporeThrough, { month: 'short', day: 'numeric' })})` : ''}. Updated ${new Date(d.generatedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })} PHT.`;

  const m = d.market, fx = m.fx.pct;
  const trend = (p) => (p == null ? 'not enough data' : p > 0 ? `up ${Math.abs(p)}%` : p < 0 ? `down ${Math.abs(p)}%` : 'flat');
  const f0 = Object.values(d.fuels)[0];
  $('#why').innerHTML = `
    <p>Pump prices follow the average Singapore (MOPS) product price from Monday to Friday against the week before, converted to pesos, plus 12% VAT. The model reads the daily Singapore prices for gasoline (RON 95), diesel (0.05%S) and kerosene from Korea's Opinet, which publishes them the day after. Days that Singapore's market is closed do not count, and days still to come are held at the latest price. That is the same arithmetic as the "trading Day N" posts on Facebook, so the numbers should match them.</p>
    <p>Singapore prices through ${d.singaporeThrough ? fmtDate(d.singaporeThrough, { month: 'short', day: 'numeric' }) : 'an unknown date'}, against last week's average: gasoline ${trend(m.mogas?.pct)}, diesel ${trend(m.gasoil?.pct)} and kerosene ${trend(m.jet?.pct)}. The peso moved ${fx == null ? 'by an unknown amount' : fx > 0 ? `weaker (USD/PHP ${trend(fx)})` : fx < 0 ? `stronger (USD/PHP ${trend(fx)})` : 'not at all'} against the dollar, which ${fx > 0 ? 'pushes costs up' : fx < 0 ? 'eases costs' : 'does not change costs'}.</p>
    <p>${f0 && f0.calibrationWeeks >= 6 ? `The model is corrected using ${f0.calibrationWeeks} past DOE adjustments.` : 'The model is not corrected against past DOE adjustments yet, so the ranges are wide.'}${d.rollAdjusted ? ' A futures contract roll falls inside this comparison, so both weeks are read from the same contract.' : ''}</p>`;
  $('#market').innerHTML = `<tr><th>Indicator</th><th class="num">Latest</th><th class="num">Week so far vs last week</th></tr>` +
    Object.values(m).map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.last ?? '—'} ${esc(x.unit)}</td><td class="num">${pct(x.pct)}</td></tr>`).join('');

  const src = [];
  if (d.industry) src.push(`<li><strong>Published estimate (entered by hand):</strong> ${esc(d.industry.source ?? 'no source given')}${safeUrl(d.industry.url) ? ` · <a href="${safeUrl(d.industry.url)}" rel="noopener">link</a>` : ''}</li>`);
  if (d.news?.items?.length) src.push(`<li><strong>News headlines agreeing on an estimate:</strong><ul>${d.news.items.slice(0, 5).map((i) => `<li>${safeUrl(i.link) ? `<a href="${safeUrl(i.link)}" rel="noopener">${esc(i.title)}</a>` : esc(i.title)} <span class="muted">${esc(i.source)} · ${fmtDate(i.published.slice(0, 10), { month: 'short', day: 'numeric' })}</span></li>`).join('')}</ul></li>`);
  if (!d.industry && !d.news) src.push('<li>No published estimate for this Tuesday yet.</li>');
  if (d.newsNote) src.push(`<li>${esc(d.newsNote)}</li>`);
  $('#sources').innerHTML = `<ul>${src.join('')}</ul>`;

  const acc = Object.entries(d.accuracy ?? {}).filter(([, a]) => a.weeks);
  $('#accuracy').textContent = acc.length ? `The model alone, checked against ${acc[0][1].weeks} past weeks: average miss ${acc.map(([k, a]) => `${NAMES[k].toLowerCase()} ${php(a.mae, true)} (worst ${php(a.worst, true)})`).join(', ')} per liter.` : '';

  const rows = d.history ?? [];
  $('#history').innerHTML = rows.length
    ? `<tr><th>Tuesday</th>${Object.values(NAMES).map((n) => `<th class="num">${n}<br>forecast / actual</th>`).join('')}</tr>` +
      rows.map((r) => `<tr><td>${fmtDate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td>${Object.keys(NAMES).map((k) => `<td class="num">${php(r.fuels[k].forecast)}${r.backtest && r.fuels[k].forecast != null ? '*' : ''} / ${php(r.fuels[k].actual)}</td>`).join('')}</tr>`).join('')
    : '<tr><td>No actual adjustments yet. They are read from the DOE\'s weekly Oil Monitor automatically.</td></tr>';
  $('#histNote').hidden = !rows.some((r) => r.backtest);
}

fetch(`data/forecast.json?t=${Date.now()}`)
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(render)
  .catch(() => { $('#sub').textContent = 'The forecast could not be loaded. Refresh the page, or check that data/forecast.json exists.'; });
