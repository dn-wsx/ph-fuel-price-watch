const $ = (s) => document.querySelector(s);
const NAMES = { gasoline: 'Gasoline', diesel: 'Diesel', kerosene: 'Kerosene' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const php = (v, plain) => (v == null ? '—' : `${plain ? '' : v > 0 ? '+' : v < 0 ? '−' : ''}₱${Math.abs(v).toFixed(2)}`);
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
const fmtDate = (iso, opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-PH', { ...opts, timeZone: 'UTC' });
const LABEL = { increase: '▲ Price hike', decrease: '▼ Rollback', unchanged: '● No change' };

function render(d) {
  $('#sub').textContent = `Estimated change at the pump starting ${fmtDate(d.target)}. Confidence: ${d.confidence}.`;

  const notes = [];
  if (d.sample) notes.push('These are sample numbers. The first scheduled run replaces them with real estimates.');
  if (d.errors?.length) notes.push('Some data could not be refreshed, so older saved data may be in use.');
  if (d.industry) notes.push(`Blended with an industry estimate${d.industry.source ? ` from ${esc(d.industry.source)}` : ''}.`);
  const banner = $('#banner');
  banner.hidden = !notes.length;
  banner.innerHTML = notes.join(' ');

  $('#board').innerHTML = Object.entries(d.fuels).map(([k, f]) => `
    <div class="row ${f.direction}">
      <div class="name">${NAMES[k]}</div>
      <div class="val">${php(f.value)}</div>
      <div class="meta"><span class="tag">${LABEL[f.direction]}${f.withinError ? ' (within margin of error)' : ''}</span>
      <span>Likely range ${php(f.low)} to ${php(f.high)} per liter</span></div>
    </div>`).join('') || '<div class="row"><div class="name">No forecast yet</div></div>';

  const days = Math.min(...Object.values(d.fuels).map((f) => f.daysOfData ?? 0), 5);
  $('#boardNote').textContent = `Based on ${days} of 5 trading days this week. Updated ${new Date(d.generatedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })} PHT.`;

  const m = d.market, fx = m.fx.pct;
  const trend = (p) => (p == null ? 'not enough data' : p > 0 ? `up ${Math.abs(p)}%` : p < 0 ? `down ${Math.abs(p)}%` : 'flat');
  const f0 = Object.values(d.fuels)[0];
  $('#why').innerHTML = `
    <p>Pump prices follow last week's average product prices against the week before, converted to pesos. This week so far, gasoline futures are ${trend(m.gasoline.pct)} and diesel futures are ${trend(m.diesel.pct)}. The peso moved ${fx == null ? 'by an unknown amount' : fx > 0 ? `weaker (USD/PHP ${trend(fx)})` : fx < 0 ? `stronger (USD/PHP ${trend(fx)})` : 'not at all'} against the dollar, which ${fx > 0 ? 'pushes costs up' : fx < 0 ? 'eases costs' : 'does not change costs'}.</p>
    <p>${f0 && f0.calibrationWeeks >= 6 ? `The model is corrected using ${f0.calibrationWeeks} past DOE adjustments.` : 'The model is not corrected against past DOE adjustments yet, so the ranges are wide. Recording each Tuesday\'s actual adjustment tightens them over time.'}</p>`;
  $('#market').innerHTML = `<tr><th>Indicator</th><th class="num">Latest</th><th class="num">Week-on-week</th></tr>` +
    Object.values(m).map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.last ?? '—'} ${esc(x.unit)}</td><td class="num">${pct(x.pct)}</td></tr>`).join('');

  const rows = d.history ?? [];
  const fuelKeys = Object.keys(NAMES);
  const historyHead = `
    <thead>
      <tr class="group-head">
        <th rowspan="2" class="date-head">Tuesday</th>
        <th colspan="2">Gasoline</th>
        <th colspan="2">Diesel</th>
        <th colspan="2">Kerosene</th>
      </tr>
      <tr class="sub-head">
        ${fuelKeys.map(() => '<th class="estimate-head">Estimate</th><th class="actual-head">Actual</th>').join('')}
      </tr>
    </thead>`;
  const historyBody = rows.length
    ? `<tbody>${rows.map((r) => `
      <tr>
        <td class="history-date">${fmtDate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        ${fuelKeys.map((k) => {
          const item = r.fuels?.[k] ?? {};
          return `
            <td class="history-value estimate-cell">${item.forecast == null ? '<span class="missing">—</span>' : `<span class="value-pill estimate-pill">${php(item.forecast)}</span>`}</td>
            <td class="history-value actual-cell">${item.actual == null ? '<span class="missing">—</span>' : `<span class="value-pill actual-pill">${php(item.actual)}</span>`}</td>`;
        }).join('')}
      </tr>`).join('')}</tbody>`
    : '<tbody><tr><td colspan="7" class="empty-history">No saved forecast or DOE actual history yet.</td></tr></tbody>';
  $('#history').innerHTML = historyHead + historyBody;

}

fetch(`data/forecast.json?t=${Date.now()}`)
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(render)
  .catch(() => { $('#sub').textContent = 'The forecast could not be loaded. Refresh the page, or check that data/forecast.json exists.'; });
