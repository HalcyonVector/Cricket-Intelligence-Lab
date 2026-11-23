/* Cricket Intelligence Lab — features layered on the core dashboard (index.html).
 *
 * Loaded after index.html's main script and before init(), so it can wrap existing views
 * (function declarations there are global and reassignable) and register new ones.
 *
 *   Time filter ("Since …")       per-year data from cohorts/x/<key>.js recomputes leaderboards
 *   Bowler profiles               form by year, splits, archetype, similar, matchups
 *   Bowl to…                      who should bowl to a given batter, by phase
 *   Venue / team / match pages    detail pages behind the Venues, Teams and Matches views
 *   Also played in + search       cross-competition index from players.js
 *   Home: last 30 days, milestones
 *   UI: metric explanations, distribution strips, sticky profile header, phone nav
 */

/* ===================== lazy data ===================== */
const _lazy = {};
function lazyScript(src, ready, cb) {
  if (ready()) { cb(); return; }
  let s = _lazy[src];
  if (!s) {
    s = _lazy[src] = { waiters: [] };
    const el = document.createElement('script'); el.src = src;
    const done = () => { const w = s.waiters; delete _lazy[src]; w.forEach(f => f()); };
    el.onload = done; el.onerror = done; document.head.appendChild(el);
  }
  s.waiters.push(cb);
}
const _X = {};
window.__extrasLoaded = (k, d) => {
  // index per-year rows by player id once, so profiles and filters are O(1) lookups
  const byB = {}, byW = {};
  d.yb.forEach(r => { const id = d.p[r[0]][0]; (byB[id] = byB[id] || []).push(r); });
  d.yw.forEach(r => { const id = d.p[r[0]][0]; (byW[id] = byW[id] || []).push(r); });
  d._byB = byB; d._byW = byW; d._missing = false; _X[k] = d;
};
function ensureExtras(key, cb) {
  lazyScript('cohorts/x/' + key + '.js', () => !!_X[key], () => {
    if (!_X[key]) _X[key] = { _missing: true }; // not built yet (pre-rebuild data): degrade quietly
    cb(_X[key]._missing ? null : _X[key]);
  });
}
const xNow = () => { const x = _X[dataKey()]; return x && !x._missing ? x : null; };
const pName = (x, i) => (x.p[i] || [])[1] || '?';
const pId = (x, i) => (x.p[i] || [])[0];
let PIX = null;
window.__playersLoaded = d => { PIX = d; };
function ensurePlayers(cb) { lazyScript('players.js', () => !!PIX, () => cb(PIX)); }
function cohortLabel(k) { return (IDX.cohorts.find(c => c.key === k) || {}).label || k; }
const pidLink = (pid, name, bowler) => `<a class="${bowler ? 'blink' : 'plink'}" data-pid="${esc(pid)}">${esc(name)}</a>`;
function wireLinks(root) {
  wirePlinks(root);
  root.querySelectorAll('a.blink[data-pid]').forEach(a => {
    if (!a.hasAttribute('href')) a.setAttribute('href', '#c=' + encodeURIComponent(state.cohort) + '&b=' + encodeURIComponent(a.dataset.pid));
    a.onclick = e => { e.preventDefault(); state.player = null; state.bowler = a.dataset.pid; render(); };
  });
  root.querySelectorAll('[data-go]').forEach(el => {
    el.onclick = e => { e.preventDefault(); const [k, v] = el.dataset.go.split('='); state.player = state.bowler = null;
      state.venue = state.team = state.match = null; if (k === 'venue') { state.view = 'venues'; state.venue = v; }
      else if (k === 'team') { state.view = 'teams'; state.team = v; } else if (k === 'match') { state.view = 'matches'; state.match = v; }
      else if (k === 'view') { state.view = v; }
      render(); };
  });
}
const goAttr = (k, v) => `data-go="${k}=${esc(v)}" href="#"`;

/* ===================== small chart helpers ===================== */
/* Year-by-year chart. defs: {key:{lab, unit, bar, lowerBetter}}; peak ignores tiny-sample years. */
function yearChartSVG(years, defs, metric, minBalls) {
  const M = defs[metric] || defs[Object.keys(defs)[0]];
  const W = CW(720), H = 210, pad = 36, n = years.length, val = y => (y[metric] == null ? null : +y[metric]);
  const vals = years.map(val).filter(v => v != null);
  const mx = Math.max(...vals, 1), gap = (W - 2 * pad) / Math.max(n, 1), bw = Math.min(34, gap * 0.66);
  const elig = years.filter(y => val(y) != null && (M.bar || (y.balls || 0) >= (minBalls || 60)));
  const pool = elig.length ? elig : years.filter(y => val(y) != null);
  const peak = pool.reduce((a, b) => (M.lowerBetter ? val(b) < val(a) : val(b) > val(a)) ? b : a, pool[0] || years[0]);
  const cy = v => H - pad - (v / mx) * (H - 2 * pad - 14), cx = i => pad + i * gap + gap / 2;
  const lab = (y, i) => n <= 24 ? `<text x="${cx(i).toFixed(1)}" y="${H - pad + 13}" text-anchor="middle" fill="#8B8E96" font-size="8.5">'${String(y.year).slice(2)}</text>` : '';
  let marks;
  if (M.bar) {
    marks = years.map((y, i) => { const v = val(y) || 0, x = cx(i) - bw / 2, h = (v / mx) * (H - 2 * pad - 14), pk = y === peak;
      return `<g><rect x="${x.toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${pk ? '#F7C873' : '#E59A2F'}" fill-opacity="${pk ? 1 : .8}"><title>${esc(y.tip || '')}</title></rect>${lab(y, i)}</g>`; }).join('');
  } else {
    const pts = years.map((y, i) => val(y) == null ? null : `${cx(i).toFixed(1)},${cy(val(y)).toFixed(1)}`).filter(Boolean).join(' ');
    marks = `<polyline points="${pts}" fill="none" stroke="#E59A2F" stroke-width="2" stroke-opacity=".8"/>` +
      years.map((y, i) => { if (val(y) == null) return lab(y, i); const pk = y === peak, small = (y.balls || 0) < (minBalls || 60);
        return `<g><circle cx="${cx(i).toFixed(1)}" cy="${cy(val(y)).toFixed(1)}" r="${pk ? 5 : 3.6}" fill="${pk ? '#F7C873' : small ? '#22252B' : '#E59A2F'}" stroke="#E59A2F" stroke-width="${small ? 1.2 : 0}"><title>${esc(y.tip || '')}${small ? ' (small sample)' : ''}</title></circle>${lab(y, i)}</g>`; }).join('');
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block" role="img" aria-label="${esc(M.lab)} per year">${axisTicksSVG(null, cy, null, [0, mx], [pad, pad, W - pad, H - pad], { ny: 3 })}<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#33363E"/>${marks}${peak ? `<text x="${pad}" y="18" fill="#B4B7BE" font-size="10">${M.lowerBetter ? 'Best' : 'Peak'} ${peak.year}: ${fmtN(val(peak))} ${M.unit}</text>` : ''}</svg>`;
}
function metricSeg(defs, metric) {
  return `<div class="seg" role="group" aria-label="Metric">${Object.entries(defs).map(([k, m]) => `<button data-m="${k}" class="${k === metric ? 'on' : ''}" aria-pressed="${k === metric}">${m.lab}</button>`).join('')}</div>`;
}
/* One row of a distribution: every rated player's value as a faint tick, this player highlighted. */
function distStrip(values, v, label, lowerBetter, fmt) {
  const vs = values.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (vs.length < 5 || v == null) return '';
  const lo = vs[Math.floor(vs.length * 0.01)], hi = vs[Math.ceil(vs.length * 0.99) - 1];
  const W = 520, H = 30, pad = 6, X = t => pad + (Math.min(hi, Math.max(lo, t)) - lo) / ((hi - lo) || 1) * (W - 2 * pad);
  const below = vs.filter(x => x < v).length, pct = Math.round(100 * (lowerBetter ? vs.length - below - 1 : below) / Math.max(1, vs.length - 1));
  const ticks = vs.map(t => `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="9" y2="23" stroke="#E59A2F" stroke-opacity=".16"/>`).join('');
  const med = vs[Math.floor(vs.length / 2)];
  return `<div class="dist"><div class="dist-h"><span>${label}</span><span class="num">${fmt ? fmt(v) : fmtN(v)} <span class="dim">· better than ${Math.max(0, Math.min(100, pct))}%</span></span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" role="img" aria-label="${esc(label)}: ${fmtN(v)}, better than ${pct}% of rated players">${ticks}
    <line x1="${X(med).toFixed(1)}" x2="${X(med).toFixed(1)}" y1="5" y2="27" stroke="#B4B7BE" stroke-dasharray="2 2" stroke-opacity=".6"><title>median ${fmtN(med)}</title></line>
    <rect x="${(X(v) - 2.5).toFixed(1)}" y="3" width="5" height="24" rx="2" fill="#F7C873"/></svg>
    <div class="dist-f"><span>${fmtN(lowerBetter ? hi : lo)}</span><span>${lowerBetter ? 'better →' : '← lower · higher →'}</span><span>${fmtN(lowerBetter ? lo : hi)}</span></div></div>`;
}

/* ===================== time filter ===================== */
function sinceOptions() {
  const m = meta(state.cohort), y1 = +String(m.coverage_to || '').slice(0, 4), y0 = +String(m.coverage_from || '').slice(0, 4);
  if (!y1) return [];
  const opts = [[0, 'All time'], [y1 - 1, `Last 2 seasons (${y1 - 1}+)`], [y1 - 3, `Last 4 seasons (${y1 - 3}+)`],
    [y1 - 5, `Since ${y1 - 5}`], [2015, 'Since 2015'], [2010, 'Since 2010']];
  const seen = new Set();
  return opts.filter(([y]) => (y === 0 || (y > y0 && y <= y1)) && !seen.has(y) && seen.add(y));
}
function _agg(rows, since) {
  const a = {};
  rows.forEach(r => { if (r[1] < since) return; for (let i = 2; i < r.length; i++) a[i] = (a[i] || 0) + r[i]; });
  return a;
}
/* Filters: time window (state.since) and, for international cohorts, full members only (state.fm).
 * Both rebuild the cohort's player/bowler tables in the browser from per-season rows, then
 * recompute percentiles and archetypes over the filtered, rate-qualified set. Advanced
 * metrics (era index, clutch, ...) and similarity stay all-time and are labelled as such. */
const fmAvailable = () => false; // full-members data is a whole bundle now (<key>__fm), not recomputed here
const filtersOn = () => !!(state.since || (state.fm && fmAvailable()));
const filterKey = () => `${state.since || 0}|${state.fm && fmAvailable() ? 1 : 0}`;
function _index(rows, x) { const by = {}; rows.forEach(r => { const id = x.p[r[0]][0]; (by[id] = by[id] || []).push(r); }); return by; }
/* The rows to use under the current filters: full-member subset when state.fm. */
function scopeRows(x) {
  if (!x) return null;
  if (state.fm && x.fm) {
    const f = x.fm;
    if (!f._byB) { f._byB = _index(f.yb, x); f._byW = _index(f.yw, x); f._bp = _index(f.bp, x); f._wp = _index(f.wp, x); }
    return { byB: f._byB, byW: f._byW, bp: f._bp, wp: f._wp, fm: true };
  }
  if (!x._bp) { x._bp = _index(x.bp || [], x); x._wp = _index(x.wp || [], x); }
  return { byB: x._byB, byW: x._byW, bp: x._bp, wp: x._wp, fm: false };
}
function _pctMap(entries, invert) {
  const xs = entries.filter(e => e[1] != null && isFinite(e[1])).sort((a, b) => a[1] - b[1]), n = xs.length, out = {};
  if (n < 3) { xs.forEach(e => out[e[0]] = 50); return out; }
  xs.forEach((e, i) => { const p = (i + 1) / n * 100; out[e[0]] = +(invert ? 100 - p + 100 / n : p).toFixed(1); });
  return out;
}
const PH = ['powerplay', 'middle', 'death'], RPO_F = { t20: 8, odi: 5.5, test: 3.3 };
function filteredCohort(c, x, since, fm) {
  const m = c.meta, S = scopeRows(x), players = {}, bowlers = {}, nm = id => (x.p.find(p => p[0] === id) || [])[1] || id;
  for (const id in S.byB) {
    const a = _agg(S.byB[id], since); if (!a[2]) continue;
    const base = c.players[id] || { name: nm(id), phases: {}, context: {} };
    const [balls, runs, outs, inns, f50, h100, fours, sixes, dots] = [a[2], a[3] || 0, a[4] || 0, a[5] || 0, a[6] || 0, a[7] || 0, a[8] || 0, a[9] || 0, a[10] || 0];
    players[id] = Object.assign({}, base, { balls, runs, outs, innings: inns, fifties: f50, hundreds: h100, sixes,
      avg: outs ? +(runs / outs).toFixed(1) : runs, sr: +(100 * runs / balls).toFixed(1),
      boundary_pct: +(100 * (fours + sixes) / balls).toFixed(1), dot_pct: +(100 * dots / balls).toFixed(1),
      highest: '-', strike_rot: null, era_index: null, consistency: null, conversion: null,
      qualified: balls >= m.rate_min_bat, pct: null, archetype: null, _filtered: true });
    if (fm) { // phase splits for the full-member scope (all seasons)
      const ph = {}; (S.bp[id] || []).forEach(r => { if (r[2] >= 12) ph[PH[r[1]]] = { balls: r[2], runs: r[3], outs: r[4],
        sr: +(100 * r[3] / r[2]).toFixed(1), avg: r[4] ? +(r[3] / r[4]).toFixed(1) : r[3] }; });
      players[id]._ph = ph;
    }
  }
  for (const id in S.byW) {
    const a = _agg(S.byW[id], since); if (!a[2]) continue;
    const base = c.bowlers[id] || { name: nm(id), phases: {} };
    const [balls, runs, w, dots, bnd] = [a[2], a[3] || 0, a[4] || 0, a[5] || 0, a[6] || 0];
    const b = bowlers[id] = Object.assign({}, base, { balls, runs, wickets: w, economy: +(6 * runs / balls).toFixed(2),
      bowl_avg: w ? +(runs / w).toFixed(1) : null, bowl_sr: w ? +(balls / w).toFixed(1) : null,
      dot_pct: +(100 * dots / balls).toFixed(1), bnd_pct: +(100 * bnd / balls).toFixed(1), era_index: null,
      qualified: balls >= m.rate_min_bowl, pct: null, archetype: null, _filtered: true });
    if (fm) { // phase economy for the full-member scope drives Bowl-to and the archetype
      const ph = {}; (S.wp[id] || []).forEach(r => { if (r[2] >= 18) ph[PH[r[1]]] = { balls: r[2], economy: +(6 * r[3] / r[2]).toFixed(2),
        wickets: r[4], dot_pct: +(100 * r[5] / r[2]).toFixed(1) }; });
      b.phases = ph;
      const tot = (S.wp[id] || []).reduce((s, r) => s + r[2], 0) || 1, share = {};
      (S.wp[id] || []).forEach(r => { share[PH[r[1]]] = +(100 * r[2] / tot).toFixed(1); });
      b.phase_share = share;
    }
  }
  // percentiles + archetypes over the filtered, rate-qualified pool (same rules as pipeline.py)
  const qb = Object.entries(players).filter(([, p]) => p.qualified), qw = Object.entries(bowlers).filter(([, b]) => b.qualified);
  const bm = [['avg', 0], ['sr', 0], ['boundary_pct', 0], ['dot_pct', 1]], wm = [['economy', 1], ['bowl_sr', 1], ['dot_pct', 0]];
  bm.forEach(([k, inv]) => { const pc = _pctMap(qb.map(([id, p]) => [id, p[k]]), inv); qb.forEach(([id, p]) => { (p.pct = p.pct || {})[k] = pc[id]; }); });
  wm.forEach(([k, inv]) => { const pc = _pctMap(qw.map(([id, b]) => [id, b[k]]), inv); qw.forEach(([id, b]) => { if (pc[id] != null) (b.pct = b.pct || {})[k] = pc[id]; }); });
  const rpo = RPO_F[m.format] || 6, arch = {};
  qb.forEach(([id, p]) => { const pc = p.pct, dsr = ((p._ph || p.phases || {}).death || {}).sr || 0;
    p.archetype = pc.sr >= 70 && pc.boundary_pct >= 65 ? 'Aggressor' : pc.avg >= 70 && pc.sr < 50 ? 'Anchor'
      : pc.sr >= 75 && dsr >= rpo * 18 ? 'Finisher' : pc.avg >= 60 && pc.sr >= 55 ? 'Accumulator' : 'Rotator';
    arch[p.archetype] = (arch[p.archetype] || 0) + 1; });
  qw.forEach(([id, b]) => { const pc = b.pct || {}, sh = b.phase_share || {}, lim = m.format !== 'test';
    b.archetype = lim && (sh.death || 0) >= 30 && (pc.economy || 0) >= 45 ? 'Death specialist'
      : lim && (sh.powerplay || 0) >= 45 && (pc.economy || 0) >= 45 ? 'Powerplay specialist'
      : (pc.bowl_sr || 0) >= 70 ? 'Strike bowler' : (pc.economy || 0) >= 70 ? 'Holder' : 'Workhorse'; });
  const top = (src, k, asc, qual) => Object.entries(src).filter(([, p]) => p[k] != null && (!qual || p.qualified))
    .sort((a, b) => asc ? a[1][k] - b[1][k] : b[1][k] - a[1][k]).slice(0, 500).map(([pid, p]) => ({ pid, name: p.name, value: p[k] }));
  const records = { most_runs: top(players, 'runs'), most_sixes: top(players, 'sixes'), most_hundreds: top(players, 'hundreds'),
    most_fifties: top(players, 'fifties'), most_innings: top(players, 'innings'), most_wickets: top(bowlers, 'wickets'),
    highest_avg: top(players, 'avg', 0, 1), highest_sr: top(players, 'sr', 0, 1),
    best_economy: top(bowlers, 'economy', 1, 1), best_bowl_sr: top(bowlers, 'bowl_sr', 1, 1), best_dot_pct_bowl: top(bowlers, 'dot_pct', 0, 1) };
  return Object.assign({}, c, { players, bowlers, records, partnerships: null, spells: null, outliers: null, bowl_outliers: null,
    meta: Object.assign({}, m, { n_batters: Object.keys(players).length, n_bowlers: Object.keys(bowlers).length,
      n_qual_bat: qb.length, n_qual_bowl: qw.length, archetypes: arch }) });
}
/* The filtered cohort for the current filters (memoised per filter combination). */
function getFiltered() {
  const key = dataKey(), x = _X[key], fk = filterKey();
  if (!x._flt || x._flt.k !== fk) x._flt = { k: fk, c: filteredCohort(COH[key], x, state.since || 0, state.fm && fmAvailable()) };
  return x._flt.c;
}
function filterBanner() {
  const m = meta(state.cohort), bits = [];
  if (state.fm && fmAvailable()) bits.push('matches between ICC full members only');
  if (state.since) bits.push(`${state.since}–${String(m.coverage_to || '').slice(0, 4)}`);
  return `<div class="cov sinceban"><b>Showing ${bits.join(', ')}.</b> Totals, rates, percentiles and archetypes are recomputed for this selection; advanced metrics, similar players and matchup lists on profiles stay unfiltered. <a href="#" class="clrsince">Clear filters</a></div>`;
}
function _wireClear(b) { b.querySelector('.clrsince').onclick = e => { e.preventDefault(); state.since = 0; state.fm = false; render(); }; }
/* Run a view against the filtered cohort (swapped in only for the synchronous render). */
function withSince(fn, app) {
  if (!state.since && !state.fm) return fn(app);
  const key = dataKey(), x = _X[key];
  if (!x) { app.appendChild($('<div class="loadbox"><div class="spinner"></div><div>Loading season-by-season data…</div></div>'));
    ensureExtras(key, () => render()); return; }
  if (x._missing) { app.appendChild($('<div class="cov">Filtering arrives with the next weekly data rebuild. Showing everything.</div>')); return fn(app); }
  if (!filtersOn()) return fn(app); // e.g. full-members toggle on a league cohort
  const orig = COH[key];
  COH[key] = getFiltered();
  try { fn(app); } finally { COH[key] = orig; }
  if (app.children.length) { const b = $(filterBanner()); app.insertBefore(b, app.children[1] || null); _wireClear(b); }
}
const FILTER_VIEWS = ['players', 'bowlers', 'records', 'bowlto', 'matchups', 'home'];
/* Background look, chosen from the swatches in the filters row and remembered on this device. */
const BG_OPTS = [['lab', 'Lab'], ['night', 'Floodlit night'], ['dusk', 'Stadium dusk']];
function setBg(v) {
  if (!BG_OPTS.some(o => o[0] === v)) v = 'lab';
  document.body.dataset.bg = v; try { localStorage.setItem('cil-bg', v); } catch (e) {}
  document.querySelectorAll('.themedrop').forEach(t => t.dataset.cur = v);
  if (window._themeDrop && window._themeDrop.setValue) window._themeDrop.setValue(v);
}
(function () { let v = 'lab'; try { v = localStorage.getItem('cil-bg') || 'lab'; } catch (e) {} document.body.dataset.bg = v; })();
function mountSinceControl() {
  const host = document.getElementById('scopeHost'); if (!host || document.getElementById('sinceHost')) return;
  // Filters live together: time window (themed dropdown, not a native <select>) + full-members switch
  const wrap = document.createElement('div'); wrap.id = 'sinceHost'; wrap.className = 'hfilters';
  wrap.innerHTML = `<span class="hf-time" title="Time window for leaderboards, records and profiles"><svg class="hf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span class="hf-drop"></span></span>
    <button type="button" id="fmbtn" class="fmsw" role="switch" aria-checked="false" title="Only count matches where both teams are ICC full members"><span class="trk"><span class="knob"></span></span>Full members</button>
    <span class="themedrop" title="Theme"></span>`;
  host.after(wrap);
  const slot = wrap.querySelector('.hf-drop'), fmb = wrap.querySelector('#fmbtn');
  const tslot = wrap.querySelector('.themedrop');
  window._themeDrop = dropdown(BG_OPTS.map(([v, l]) => ({ v, label: l })), document.body.dataset.bg || 'lab', v => setBg(v));
  window._themeDrop.querySelector('.drop-btn').setAttribute('aria-label', 'Theme');
  tslot.appendChild(window._themeDrop);
  setBg(document.body.dataset.bg);
  fmb.onclick = () => { state.fm = !state.fm; render(); };
  let drop = null, dropKey = '';
  window._syncSince = () => {
    const opts = sinceOptions(); if (state.since && !opts.some(o => o[0] === state.since)) state.since = 0;
    const key = JSON.stringify(opts);
    if (key !== dropKey) { // rebuild only when the competition's seasons change
      dropKey = key; slot.innerHTML = '';
      drop = dropdown(opts.map(([y, l]) => ({ v: String(y), label: l.replace(/ \(\d+\+\)$/, '') })), String(state.since || 0),
        v => { state.since = +v || 0; render(); });
      drop.querySelector('.drop-btn').setAttribute('aria-label', 'Time window');
      slot.appendChild(drop);
    } else if (drop) drop.setValue(String(state.since || 0));
    const intl = !!meta(state.cohort).intl;
    fmb.style.display = intl ? '' : 'none'; fmb.hidden = !intl;
    fmb.classList.toggle('on', !!state.fm && intl); fmb.setAttribute('aria-checked', String(!!state.fm && intl));
    const on = [];
    if (state.since) { const o = opts.find(x => x[0] === state.since); on.push(o ? o[1].replace(/ \(\d+\+\)$/, '') : 'Since ' + state.since); }
    if (state.fm && intl) on.push('Full members');
    const fbtn = document.querySelector('.hfilter-btn'); if (fbtn) fbtn.classList.toggle('has-f', on.length > 0);
    const ds = document.getElementById('dsline');
    if (ds) { let fl = ds.querySelector('.flon'); if (!fl) { fl = document.createElement('span'); fl.className = 'flon'; ds.appendChild(fl); }
      fl.textContent = on.length ? on.join(' · ') : ''; fl.style.display = on.length ? '' : 'none'; }
    const applies = FILTER_VIEWS.includes(state.view) || state.player || state.bowler;
    wrap.classList.toggle('idle', !applies);
    wrap.title = applies ? '' : 'Filters apply to Batters, Bowlers, Records, Matchups, Bowl to… and player profiles';
  };
}
/* Matchup rows for the current filters: the full-member set comes from the extras file. */
function getMatchups(c, cb) {
  if (state.fm && meta(c.meta.key).intl) {
    ensureExtras(c.meta.key, x => {
      if (x && x.fm) {
        if (!x.fm._mu) x.fm._mu = x.fm.mu.map(r => ({ batter: x.p[r[0]][0], batter_name: x.p[r[0]][1], bowler: x.p[r[1]][0], bowler_name: x.p[r[1]][1],
          balls: r[2], runs: r[3], outs: r[4], sr: r[2] ? Math.round(1000 * r[3] / r[2]) / 10 : null, avg: r[4] ? Math.round(10 * r[3] / r[4]) / 10 : null, dominance: r[5] }));
        cb({ rows: x.fm._mu, min: c.meta.format === 'test' ? 18 : 12, fm: true });
      } else ensureMatchups(c.meta.key, cb);
    });
  } else ensureMatchups(c.meta.key, cb);
}

/* ===================== profile helpers ===================== */
function alsoPlayedStrip(pid, asBowler) {
  const el = $('<div class="xstrip" aria-live="polite"></div>');
  ensurePlayers(ix => {
    const e = ix && ix.p[pid]; if (!e) return;
    const others = e[1].filter(r => ix.k[r[0]] !== state.cohort);
    if (!others.length) return;
    el.innerHTML = `<span class="dim">Also played in</span>` + others.slice(0, 14).map(r => {
      const k = ix.k[r[0]], bits = [r[1] ? r[1].toLocaleString() + ' runs' : '', r[2] ? r[2] + ' wkts' : ''].filter(Boolean).join(' · ');
      const asB = asBowler ? r[2] > 0 : !r[1] && r[2] > 0;
      return `<a class="xchip" href="#c=${encodeURIComponent(k)}&${asB ? 'b' : 'p'}=${encodeURIComponent(pid)}" data-k="${esc(k)}" data-b="${asB ? 1 : 0}">${esc(cohortLabel(k))}<span class="dim">${bits}</span></a>`;
    }).join('') + (others.length > 14 ? `<span class="dim">+${others.length - 14} more</span>` : '');
    el.querySelectorAll('.xchip').forEach(a => a.onclick = ev => { if (ev.ctrlKey || ev.metaKey || ev.button) return; ev.preventDefault();
      state.cohort = a.dataset.k; state.view = state.view || 'home'; state.player = a.dataset.b === '1' ? null : pid; state.bowler = a.dataset.b === '1' ? pid : null; render(); });
  });
  return el;
}
function stickyHeader(w) {
  const h = w.firstElementChild; if (h) h.classList.add('phead');
}
function _poolVals(src, k) { return Object.values(src).filter(p => p.qualified).map(p => p[k]); }

/* ===================== batter profile ===================== */
const _playerView = playerView;
playerView = function (pid) {
  let w;
  const run = () => { w = _playerView(pid); };
  let useF = (state.since || state.fm) && _X[dataKey()] && !_X[dataKey()]._missing && filtersOn();
  const outside = useF && !getFiltered().players[pid]; // no balls in this selection: show everything instead
  if (outside) useF = false;
  if (useF) withSince(() => run(), document.createElement('div')); else run();
  if ((state.since || state.fm) && !_X[dataKey()]) ensureExtras(dataKey(), () => render());
  const xf = _X[dataKey()], c = useF && xf && xf._flt ? xf._flt.c : cur(), p = c.players[pid]; if (!p || !w || !w.firstElementChild) return w;
  stickyHeader(w); teamCard(w, p); w.classList.add('prof-bat');
  if (useF) { const b = $(filterBanner()); w.insertBefore(b, w.children[1] || null); _wireClear(b); }
  if (outside) w.insertBefore($('<div class="cov">No balls faced in the current filter selection, so this profile shows all their matches.</div>'), w.children[1] || null);
  w.insertBefore(alsoPlayedStrip(pid, false), w.children[1] || null);
  { const note = $(`<div>${covNote(c, 'profile')}</div>`); w.insertBefore(note, w.children[2] || null);
    ensureExtras(c.meta.key, x => { if (startedBeforeCoverage(c, x, pid, false)) note.insertAdjacentHTML('beforeend', covNote(c, 'early')); }); }
  if (p.qualified) {
    const P = c.players, dp = $('<div class="grid bento" style="margin-top:13px"></div>');
    dp.appendChild($(`<div class="panel s12"><h2>Where they stand <span class="r">every rated batter in ${esc(c.meta.label)}, gold = ${esc(p.name)}, dashed = median</span></h2><div class="distgrid">
      ${distStrip(_poolVals(P, 'avg'), p.avg, 'Average')}${distStrip(_poolVals(P, 'sr'), p.sr, 'Strike rate')}
      ${distStrip(_poolVals(P, 'boundary_pct'), p.boundary_pct, 'Boundary %')}${distStrip(_poolVals(P, 'dot_pct'), p.dot_pct, 'Dot %', true)}</div></div>`));
    const after = [...w.children].find(el => el.textContent.indexOf('Percentile ranks') >= 0);
    if (after) after.after(dp); else w.appendChild(dp);
  }
  return w;
};
/* ---------- Rolling form: the last N innings at every point of a player's career ---------- */
const ROLL_N = 10, _INN = {}, _INN_CB = {};
window.__inningsLoaded = (key, sh, d) => { (_INN[key] = _INN[key] || {})[sh] = d; };
function ensureInnings(key, pid, cb) {
  const sh = /^[0-9a-f]/.test((pid || '0')[0].toLowerCase()) ? pid[0].toLowerCase() : '0', id = key + '/' + sh;
  if (_INN[key] && _INN[key][sh]) return cb(_INN[key][sh]);
  if (_INN_CB[id]) { _INN_CB[id].push(cb); return; }
  const q = _INN_CB[id] = [cb], s = document.createElement('script');
  s.src = 'cohorts/f/' + encodeURIComponent(key) + '/' + sh + '.js';
  const done = () => { const d = (_INN[key] || {})[sh] || null; delete _INN_CB[id]; q.forEach(f => f(d)); };
  s.onload = done; s.onerror = done; document.head.appendChild(s);
}
const ROLL_BAT = {
  avg: { lab: 'Average', f: w => { const o = w.reduce((a, r) => a + r[3], 0), r = w.reduce((a, x) => a + x[1], 0); return o ? r / o : r; }, d: 1 },
  sr: { lab: 'Strike rate', f: w => { const b = w.reduce((a, r) => a + r[2], 0); return b ? 100 * w.reduce((a, r) => a + r[1], 0) / b : null; }, d: 1 },
  rpi: { lab: 'Runs per innings', f: w => w.reduce((a, r) => a + r[1], 0) / w.length, d: 1 },
};
const ROLL_BOWL = {
  econ: { lab: 'Economy', f: w => { const b = w.reduce((a, r) => a + r[1], 0); return b ? 6 * w.reduce((a, r) => a + r[2], 0) / b : null; }, d: 2, low: true },
  wpi: { lab: 'Wickets per innings', f: w => w.reduce((a, r) => a + r[3], 0) / w.length, d: 2 },
  avg: { lab: 'Average', f: w => { const k = w.reduce((a, r) => a + r[3], 0); return k ? w.reduce((a, r) => a + r[2], 0) / k : null; }, d: 1, low: true },
};
function rollingSVG(rows, def, n) {
  const W = CW(720), H = 210, padL = 40, padR = 12, padT = 12, padB = 26;
  const pts = [];
  for (let i = n - 1; i < rows.length; i++) { const v = def.f(rows.slice(i - n + 1, i + 1)); if (v != null && isFinite(v)) pts.push([i + 1, v]); }
  if (pts.length < 2) return '<span class="note">Not enough innings yet.</span>';
  const all = def.f(rows), ys = pts.map(p => p[1]).concat(all != null ? [all] : []);
  const lo = Math.min(...ys), hi = Math.max(...ys), sp = (hi - lo) || 1, y0 = Math.max(0, lo - sp * 0.1), y1 = hi + sp * 0.1;
  const X = i => padL + (i - 1) / Math.max(1, rows.length - 1) * (W - padL - padR), Y = v => H - padB - (v - y0) / ((y1 - y0) || 1) * (H - padT - padB);
  let g = axisTicksSVG(null, Y, null, [y0, y1], [padL, padT, W - padR, H - padB]);
  let lastYr = null, lastX = -99;
  rows.forEach((r, i) => { if (r[0] !== lastYr) { const x = X(i + 1); g += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${padT}" y2="${H - padB}" stroke="#1D2026"/>`; if (x - lastX > 34) { g += `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#8A6A5C" font-size="9">${r[0]}</text>`; lastX = x; } lastYr = r[0]; } });
  if (all != null) g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(all).toFixed(1)}" y2="${Y(all).toFixed(1)}" stroke="#5a5d66" stroke-dasharray="4 4"><title>Whole career: ${all.toFixed(def.d)}</title></line>`;
  g += `<polyline points="${pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="#F2B24C" stroke-width="2"/>`;
  const best = pts.reduce((a, p) => (def.low ? p[1] < a[1] : p[1] > a[1]) ? p : a, pts[0]), lastP = pts[pts.length - 1];
  g += `<circle cx="${X(best[0]).toFixed(1)}" cy="${Y(best[1]).toFixed(1)}" r="4" fill="#F2B24C"><title>Best ${n}-innings run: ${best[1].toFixed(def.d)} (innings ${best[0] - n + 1} to ${best[0]})</title></circle>`;
  g += `<circle cx="${X(lastP[0]).toFixed(1)}" cy="${Y(lastP[1]).toFixed(1)}" r="4" fill="#16181D" stroke="#F2B24C" stroke-width="2"><title>Now: ${lastP[1].toFixed(def.d)}</title></circle>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(def.lab)} over the last ${n} innings, through the career">${g}</svg>`;
}
function rollingFormPanel(pid, bowler) {
  const panel = $(`<div class="panel" style="margin-top:13px"><h2>Rolling form <span class="r">loading…</span></h2></div>`);
  const key = dataKey(), label = cur().meta.label;
  ensureInnings(key, pid, d => {
    const rows = d && (bowler ? d.w : d.b)[pid];
    if (!rows || rows.length < ROLL_N) { panel.remove(); return; }
    const defs = bowler ? ROLL_BOWL : ROLL_BAT, n = ROLL_N;
    let metric = (bowler ? state.rollBowl : state.rollBat) || Object.keys(defs)[0];
    const last = rows.slice(-n), sum = (w, i) => w.reduce((a, r) => a + r[i], 0);
    const summary = bowler
      ? `Last ${n} innings: <b>${sum(last, 3)}</b> wickets at economy <b>${(defs.econ.f(last) || 0).toFixed(2)}</b> (career ${(defs.econ.f(rows) || 0).toFixed(2)} over ${rows.length} innings)`
      : `Last ${n} innings: <b>${sum(last, 1)}</b> runs, average <b>${defs.avg.f(last).toFixed(1)}</b>, strike rate <b>${(defs.sr.f(last) || 0).toFixed(1)}</b> (career ${defs.avg.f(rows).toFixed(1)} and ${(defs.sr.f(rows) || 0).toFixed(1)} over ${rows.length} innings)`;
    const draw = () => {
      panel.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px"><h2 style="margin:0">Rolling form <span class="r">${esc(label)} · each point = the ${n} innings up to then · dashed = career</span></h2>
        <div class="seg" role="group" aria-label="Rolling metric">${Object.entries(defs).map(([k, v]) => `<button data-m="${k}" class="${k === metric ? 'on' : ''}">${v.lab}</button>`).join('')}</div></div>
        <div class="note" style="margin-bottom:6px">${summary}</div>${rollingSVG(rows, defs[metric], n)}`;
      panel.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { metric = b.dataset.m; if (bowler) state.rollBowl = metric; else state.rollBat = metric; draw(); });
    };
    draw();
  });
  return panel;
}
/* Form chart follows the selected competition (per-year cohort data); all-format career is a toggle. */
const BAT_DEFS = { runs: { lab: 'Runs', unit: 'runs', bar: true }, avg: { lab: 'Average', unit: 'avg' }, sr: { lab: 'Strike rate', unit: 'SR' } };
mountCareer = function (app, pid) {
  const w = app.firstElementChild; if (!w) return;
  const panel = document.createElement('div'); panel.className = 'panel'; panel.style.marginTop = '13px';
  panel.innerHTML = '<h2>Form by year <span class="r">loading…</span></h2>';
  const anchor = w.querySelector('.xstrip'); const at = [...w.children].indexOf(anchor);
  w.insertBefore(panel, w.children[Math.max(1, at + 1)] || null);
  panel.after(rollingFormPanel(pid, false));
  let scope = state.formScope || 'comp', metric = state.careerMetric || 'runs';
  const draw = () => {
    const x = xNow();
    const fromComp = () => (x && (scopeRows(x).byB[pid]) || []).map(r => ({ year: r[1], balls: r[2], runs: r[3], inns: r[5],
      avg: r[4] ? +(r[3] / r[4]).toFixed(1) : r[3], sr: +(100 * r[3] / r[2]).toFixed(1) })).sort((a, b) => a.year - b.year);
    let years = scope === 'comp' ? fromComp() : ((window.CIL_CAREER || {})[pid] || []);
    if (scope === 'comp' && !years.length) { scope = 'all'; years = (window.CIL_CAREER || {})[pid] || []; }
    if (!years.length) { panel.remove(); return; }
    years.forEach(y => y.tip = `${y.year}: ${y.runs} runs in ${y.inns} inns · avg ${y.avg} · SR ${y.sr} · ${y.balls} balls`);
    panel.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px"><h2 style="margin:0">Form by year <span class="r">gold = peak</span></h2>
      <div class="row" style="gap:8px;flex-wrap:wrap">${x ? `<div class="seg" role="group" aria-label="Scope"><button data-s="comp" class="${scope === 'comp' ? 'on' : ''}">${esc(cur().meta.label)}</button><button data-s="all" class="${scope === 'all' ? 'on' : ''}">All competitions</button></div>` : ''}${metricSeg(BAT_DEFS, metric)}</div></div>` + yearChartSVG(years, BAT_DEFS, metric, 60);
    panel.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { metric = state.careerMetric = b.dataset.m; draw(); });
    panel.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { scope = state.formScope = b.dataset.s; draw(); });
  };
  let n = 0; const go = () => { if (++n === 2) draw(); };
  ensureCareers(pid, go); ensureExtras(dataKey(), go);
};

/* By venue: this competition by default (detail file), all competitions on demand (career shards).
   Older data has only the all-competitions list, which is then labelled as such. */
mountVenues = function (app, pid) {
  const w = app.firstElementChild; if (!w) return;
  const panel = document.createElement('div'); panel.className = 'panel'; panel.style.marginTop = '13px';
  panel.innerHTML = '<h2>By venue <span class="r">loading…</span></h2>'; w.appendChild(panel);
  ensureCareers(pid, () => {
    const c = cur(), comp = ((c.players || {})[pid] || {}).venues || [], all = (window.CIL_VENUES || {})[pid] || [];
    if (!comp.length && !all.length) { panel.remove(); return; }
    let scope = state.venueScope === 'all' || !comp.length ? 'all' : 'comp';
    const draw = () => {
      const vs = scope === 'comp' ? comp : all, mx = Math.max(...vs.map(v => v.runs || 0), 1);
      const label = scope === 'comp' ? esc(c.meta.label) : 'all competitions in the data';
      panel.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px"><h2 style="margin:0">By venue <span class="r">runs at each ground · ${label}</span></h2>
        ${comp.length && all.length ? `<div class="seg" role="group" aria-label="Venue scope"><button data-s="comp" class="${scope === 'comp' ? 'on' : ''}">${esc(c.meta.label)}</button><button data-s="all" class="${scope === 'all' ? 'on' : ''}">All competitions</button></div>` : ''}</div>` +
        vs.map(v => `<div class="minibar norank"><span title="${esc(v.venue)}${v.city ? ', ' + esc(v.city) : ''}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.venue)}</span><div class="bar"><span style="width:${(v.runs / mx * 100).toFixed(1)}%"></span></div><span class="num" title="${v.inns} inns · ${v.balls} balls · avg ${v.avg} · SR ${v.sr}">${v.runs}</span></div>`).join('');
      panel.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { scope = state.venueScope = b.dataset.s; draw(); });
    };
    draw();
  });
};

/* ===================== bowler profile ===================== */
const BOWL_ARCH_COLOR = { 'Strike bowler': '#FF6B7E', 'Holder': '#33D17A', 'Powerplay specialist': '#6FA8FF', 'Death specialist': '#F7C873', 'Workhorse': '#9AA0A8' };
const BOWL_DEFS = { wkts: { lab: 'Wickets', unit: 'wkts', bar: true }, econ: { lab: 'Economy', unit: 'econ', lowerBetter: true }, sr: { lab: 'Strike rate', unit: 'balls/wkt', lowerBetter: true } };
const _bowlerProfile = bowlerProfile;
bowlerProfile = function (id) {
  let w;
  let useSince = (state.since || state.fm) && _X[dataKey()] && !_X[dataKey()]._missing && filtersOn();
  const outsideB = useSince && !getFiltered().bowlers[id];
  if (outsideB) useSince = false;
  if (useSince) withSince(() => { w = _bowlerProfile(id); }, document.createElement('div')); else w = _bowlerProfile(id);
  if ((state.since || state.fm) && !_X[dataKey()]) ensureExtras(dataKey(), () => render());
  const xf = _X[dataKey()], c = useSince && xf && xf._flt ? xf._flt.c : cur(), b = (c.bowlers || {})[id]; if (!b || !w || !w.firstElementChild) return w;
  stickyHeader(w); teamCard(w, b); w.classList.add('prof-bowl');
  const hdr = w.querySelector('.phead h1');
  if (hdr && b.archetype) hdr.after($(`<span class="arch" style="background:${BOWL_ARCH_COLOR[b.archetype] || '#888'}22;color:${BOWL_ARCH_COLOR[b.archetype] || '#aaa'}" title="${esc(GLOSSARY[b.archetype.toLowerCase()] || '')}">${esc(b.archetype)}</span>`));
  if (useSince) { const bn = $(filterBanner()); w.insertBefore(bn, w.children[1] || null); _wireClear(bn); }
  if (outsideB) w.insertBefore($('<div class="cov">No balls bowled in the current filter selection, so this profile shows all their matches.</div>'), w.children[1] || null);
  w.insertBefore(alsoPlayedStrip(id, true), w.children[1] || null);
  { const note = $(`<div>${covNote(c, 'profile')}</div>`); w.insertBefore(note, w.children[2] || null);
    ensureExtras(c.meta.key, x => { if (startedBeforeCoverage(c, x, id, true)) note.insertAdjacentHTML('beforeend', covNote(c, 'early')); }); }

  // form by year (this competition)
  const form = $('<div class="panel" style="margin-top:13px"><h2>Form by year <span class="r">loading…</span></h2></div>');
  w.insertBefore(form, w.children[2] || null);
  form.after(rollingFormPanel(id, true));
  let metric = state.bowlMetric || 'wkts';
  ensureExtras(dataKey(), x => {
    const rows = x && scopeRows(x).byW[id] || [];
    if (!rows.length) { form.remove(); return; }
    const years = rows.map(r => ({ year: r[1], balls: r[2], runs: r[3], wkts: r[4], econ: +(6 * r[3] / r[2]).toFixed(2), sr: r[4] ? +(r[2] / r[4]).toFixed(1) : null }))
      .sort((a, b) => a.year - b.year);
    years.forEach(y => y.tip = `${y.year}: ${y.wkts} wkts · econ ${y.econ} · SR ${y.sr == null ? '-' : y.sr} · ${y.balls} balls`);
    const draw = () => { form.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:8px"><h2 style="margin:0">Form by year <span class="r">${esc(c.meta.label)} · gold = best</span></h2>${metricSeg(BOWL_DEFS, metric)}</div>` + yearChartSVG(years, BOWL_DEFS, metric, 60);
      form.querySelectorAll('[data-m]').forEach(bt => bt.onclick = () => { metric = state.bowlMetric = bt.dataset.m; draw(); }); };
    draw();
  });

  const g = $('<div class="grid bento" style="margin-top:13px"></div>');
  const CL = { won: 'In wins', lost: 'In defeats', defending: 'Defending a total', first: 'Bowling first', knockout: 'Knockouts' };
  const ctx = b.context || {};
  g.appendChild($(`<div class="panel s4"><h2>Context splits</h2><div class="tscroll"><table><thead><tr><th>Split</th><th class="n">Econ</th><th class="n">Wkts</th><th class="n">SR</th><th class="n">Balls</th></tr></thead><tbody>${Object.keys(CL).filter(k => ctx[k]).map(k => { const v = ctx[k];
    return `<tr><td>${CL[k]}</td><td class="n">${v.econ}</td><td class="n">${v.wkts}</td><td class="n">${fmtN(v.sr)}</td><td class="n dim">${v.balls}</td></tr>`; }).join('') || '<tr><td class="note" colspan="5">n/a (needs 24+ balls per split)</td></tr>'}</tbody></table></div></div>`));
  const sh = b.phase_share || {};
  const shRows = ['powerplay', 'middle', 'death'].filter(k => sh[k]).map(k => `<div class="minibar norank"><span style="text-transform:capitalize">${k}</span><div class="bar"><span style="width:${sh[k]}%"></span></div><span class="num">${sh[k]}%</span></div>`).join('');
  g.appendChild($(`<div class="panel s4"><h2>When they bowl <span class="r">share of balls</span></h2>${shRows || '<span class="note">Phase data applies to limited-overs cohorts.</span>'}${b.archetype ? `<div class="note" style="margin-top:8px"><b style="color:var(--ink)">${esc(b.archetype)}:</b> ${esc(GLOSSARY[b.archetype.toLowerCase()] || '')}</div>` : ''}</div>`));
  const sims = (b.similar || []).map(s => `<div class="ledrow">${pidLink(s.pid, s.name, true)}<span class="num muted">${(s.score * 100).toFixed(0)}%</span></div>`).join('');
  g.appendChild($(`<div class="panel s4"><h2>Most similar</h2>${sims || '<span class="note">n/a (needs rate qualifier)</span>'}<div class="note" style="margin-top:6px">Cosine similarity on economy, strike rate, dot % and boundary %.</div></div>`));
  w.appendChild(g);

  if (b.qualified) {
    const B = c.bowlers;
    w.appendChild($(`<div class="grid bento" style="margin-top:13px"><div class="panel s12"><h2>Where they stand <span class="r">every rated bowler in ${esc(c.meta.label)}</span></h2><div class="distgrid">
      ${distStrip(_poolVals(B, 'economy'), b.economy, 'Economy', true)}${distStrip(_poolVals(B, 'bowl_sr'), b.bowl_sr, 'Strike rate (balls/wkt)', true)}
      ${distStrip(_poolVals(B, 'dot_pct'), b.dot_pct, 'Dot %')}${distStrip(_poolVals(B, 'bnd_pct'), b.bnd_pct, 'Boundary % conceded', true)}</div></div></div>`));
  }
  // matchups from the bowler's side (full pair list)
  const mu = $('<div class="grid bento" style="margin-top:13px"></div>'); w.appendChild(mu);
  getMatchups(c, st => {
    const rows = (st.rows || c.matchups_top || []).filter(m => m.bowler === id);
    if (!rows.length) return;
    const tbl = (arr, t) => `<div class="panel s6"><h2>${t}</h2><div class="tscroll"><table><thead><tr><th>Batter</th><th class="n">B</th><th class="n">R</th><th class="n">W</th><th class="n">SR</th><th class="n">Dom</th></tr></thead><tbody>${arr.map(m => `<tr><td>${pidLink(m.batter, m.batter_name)}</td><td class="n">${m.balls}</td><td class="n">${m.runs}</td><td class="n">${m.outs}</td><td class="n">${fmtN(m.sr)}</td><td class="n"><b>${m.dominance}</b></td></tr>`).join('')}</tbody></table></div></div>`;
    mu.appendChild($(tbl(rows.slice().sort((a, b) => a.dominance - b.dominance).slice(0, 6), 'Dominates')));
    mu.appendChild($(tbl(rows.slice().sort((a, b) => b.dominance - a.dominance).slice(0, 6), 'Struggles against')));
    wireLinks(mu);
  });
  wireLinks(w);
  return w;
};

/* ===================== leaderboards / records under the time filter ===================== */
['playersView', 'bowlersView', 'recordsView'].forEach(n => {
  const orig = window[n];
  window[n] = app => withSince(orig, app);
});

/* ===================== Bowl to… ===================== */
function bowlToView(app) {
  const c = cur(), m = c.meta, isTest = m.format === 'test';
  app.appendChild($(`<div><h1>Who should bowl to…</h1><p class="sub">Pick a batter. You get the bowlers with the best record against them, and the best options for a phase of the innings in ${esc(m.label)}.</p></div>`));
  const names = Object.values(c.players).filter(p => p.balls >= 30).map(p => p.name).sort();
  const byName = {}; Object.entries(c.players).forEach(([id, p]) => { byName[p.name] = id; });
  const box = $(`<div class="panel"><div class="toolbar">
    <div class="field"><span class="flab">Batter</span><div class="ac"><input id="btq" placeholder="Batter…" autocomplete="off" style="width:240px"/><div class="aclist" style="display:none"></div></div></div>
    ${isTest ? '' : `<div class="field"><span class="flab">Phase</span><div class="seg" id="btph"><button data-p="" class="on">Any</button><button data-p="powerplay">Powerplay</button><button data-p="middle">Middle</button><button data-p="death">Death</button></div></div>`}
  </div><div id="btres" style="margin-top:12px"><span class="note">Start typing a batter's name.</span></div></div>`);
  app.appendChild(box);
  let pid = state.btPid && c.players[state.btPid] ? state.btPid : null, phase = '';
  const res = box.querySelector('#btres');
  function draw() {
    if (!pid) return;
    const p = c.players[pid];
    res.innerHTML = '<div class="loadbox"><div class="spinner"></div><div>Loading every matchup…</div></div>';
    getMatchups(c, st => {
      const all = (st.rows || c.matchups_top || []).filter(x => x.batter === pid);
      const B = c.bowlers || {}, ph = phase, bp = ph && ((p._ph && p._ph[ph]) || (p.phases && p.phases[ph]));
      const proven = all.slice().sort((a, b) => a.dominance - b.dominance || b.balls - a.balls).slice(0, 10);
      const hist = {}; all.forEach(x => { hist[x.bowler] = x; });
      const minB = isTest ? 300 : 60;
      const cand = Object.entries(B).filter(([, b]) => ph ? (b.phases && b.phases[ph] && b.phases[ph].balls >= minB) : b.qualified)
        .map(([id, b]) => { const s = ph ? b.phases[ph] : b; const h = hist[id];
          // lower is better: economy in the phase, nudged by their head-to-head with this batter
          const score = s.economy * (h && h.balls >= 12 ? (0.6 + 0.8 * h.dominance) : 1);
          return { id, name: b.name, econ: s.economy, dot: s.dot_pct, wkts: s.wickets, balls: s.balls, h, score }; })
        .sort((a, b) => a.score - b.score).slice(0, 12);
      const head = bp ? `<div class="note" style="margin-bottom:10px">${esc(p.name)} in the ${ph}: SR <b style="color:var(--ink)">${bp.sr}</b>, avg ${bp.avg}, ${bp.balls} balls. Overall SR ${p.sr}.</div>` :
        `<div class="note" style="margin-bottom:10px">${esc(p.name)}: SR <b style="color:var(--ink)">${p.sr}</b>, avg ${p.avg}, dot ${p.dot_pct}%, ${p.balls.toLocaleString()} balls.</div>`;
      res.innerHTML = head + `<div class="grid bento">
        <div class="panel s6"><h2>Proven against ${esc(p.name)} <span class="r">lowest dominance first</span></h2>${proven.length ? `<div class="tscroll"><table><thead><tr><th>Bowler</th><th class="n">Balls</th><th class="n">Runs</th><th class="n">Outs</th><th class="n">SR</th><th class="n">Dom</th></tr></thead><tbody>${proven.map(x => `<tr><td>${pidLink(x.bowler, x.bowler_name, true)}</td><td class="n">${x.balls}</td><td class="n">${x.runs}</td><td class="n">${x.outs}</td><td class="n">${fmtN(x.sr)}</td><td class="n"><b style="color:${x.dominance <= .45 ? 'var(--pos)' : x.dominance >= .55 ? 'var(--neg)' : 'var(--ink)'}">${x.dominance}</b></td></tr>`).join('')}</tbody></table></div>` : `<span class="note">No bowler has bowled ${st.min || 12}+ balls to ${esc(p.name)} in this competition.</span>`}</div>
        <div class="panel s6"><h2>Best options ${ph ? 'in the ' + ph : 'overall'} <span class="r">economy, adjusted by head-to-head</span></h2><div class="tscroll"><table><thead><tr><th>Bowler</th><th class="n">Econ</th><th class="n">Dot%</th><th class="n">Wkts</th><th class="n">vs him</th></tr></thead><tbody>${cand.map(x => `<tr><td>${pidLink(x.id, x.name, true)}</td><td class="n"><b>${x.econ}</b></td><td class="n">${fmtN(x.dot)}</td><td class="n">${x.wkts}</td><td class="n">${x.h ? `<span title="${x.h.balls} balls, ${x.h.runs} runs, ${x.h.outs} outs">${x.h.runs}/${x.h.outs} (${x.h.balls}b)</span>` : '<span class="dim">-</span>'}</td></tr>`).join('')}</tbody></table></div>
        <div class="note" style="margin-top:6px">${ph ? `Bowlers with ${minB}+ balls in the ${ph}.` : `Rated bowlers (${m.rate_min_bowl}+ balls).`} A good head-to-head (12+ balls) moves a bowler up; a poor one moves them down.</div></div></div>`;
      wireLinks(res);
    });
  }
  autocomplete(box.querySelector('#btq'), names, v => { pid = byName[v] || null; state.btPid = pid; draw(); });
  box.querySelectorAll('#btph button').forEach(b => b.onclick = () => { phase = b.dataset.p; box.querySelectorAll('#btph button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  if (pid) { box.querySelector('#btq').value = c.players[pid].name; draw(); }
}

/* ===================== matches ===================== */
function resultText(mt) { return mt.winner ? `${mt.winner} won` : (mt.result ? mt.result.replace(/^\w/, ch => ch.toUpperCase()) : 'No result'); }
function matchesView(app) {
  const c = cur();
  app.appendChild($(`<div><h1>Matches</h1><p class="sub">The latest ${esc(c.meta.label)} matches in the data. Open one for the scorecard summary, run progression and runs per over.</p></div>`));
  const box = $('<div class="loadbox"><div class="spinner"></div><div>Loading matches…</div></div>'); app.appendChild(box);
  ensureExtras(c.meta.key, x => {
    box.className = ''; box.innerHTML = '';
    if (!x || !x.recent || !x.recent.length) { box.innerHTML = '<div class="cov">Match pages arrive with the next weekly data rebuild.</div>'; return; }
    const q = $(`<div class="panel"><div class="toolbar"><div class="field"><span class="flab">Filter</span><div class="swrap2"><input id="mq" placeholder="team or venue…"/></div></div></div><div id="ml"></div></div>`);
    box.appendChild(q);
    const list = q.querySelector('#ml');
    const draw = f => { list.innerHTML = x.recent.filter(mt => !f || (mt.teams.join(' ') + ' ' + (mt.venue || '')).toLowerCase().includes(f)).map(mt =>
      `<a class="mrow" ${goAttr('match', mt.id)}><span class="dim num">${esc(mt.date)}</span><span><b>${esc(mt.teams[0])}</b> <span class="dim">vs</span> <b>${esc(mt.teams[1])}</b>${mt.stage ? ` <span class="badge">${esc(mt.stage)}</span>` : ''}<div class="dim" style="font-size:11.5px">${esc(mt.venue || '')}</div></span><span class="mres">${esc(resultText(mt))}<div class="dim num" style="font-size:11.5px">${mt.inns.map(i => `${i.runs}/${i.wkts}`).join(' · ')}</div></span></a>`).join('') || '<span class="note">No matches match.</span>'; wireLinks(list); };
    draw(''); q.querySelector('#mq').oninput = e => draw(e.target.value.toLowerCase().trim());
  });
}

/* ---------- Team colours: each side's own colour, tuned to read on the dark background ---------- */
const TEAM_COL = {
  'India': '#3B82F6', 'Australia': '#FACC15', 'England': '#E5484D', 'New Zealand': '#B4B7BE', 'Pakistan': '#22C55E',
  'South Africa': '#10B981', 'Sri Lanka': '#818CF8', 'West Indies': '#C0365A', 'Bangladesh': '#EF4444', 'Afghanistan': '#60A5FA',
  'Zimbabwe': '#F97316', 'Ireland': '#4ADE80', 'Netherlands': '#FB923C', 'Scotland': '#93C5FD', 'Nepal': '#F43F5E',
  'United Arab Emirates': '#A3A3A3', 'Oman': '#F87171', 'Namibia': '#38BDF8', 'United States of America': '#60A5FA',
  'Canada': '#EF4444', 'Uganda': '#FACC15', 'Papua New Guinea': '#FB7185', 'Hong Kong': '#F43F5E', 'Kenya': '#4ADE80',
  // IPL
  'Chennai Super Kings': '#FACC15', 'Mumbai Indians': '#3B82F6', 'Royal Challengers Bengaluru': '#E5484D', 'Royal Challengers Bangalore': '#E5484D',
  'Kolkata Knight Riders': '#8B5CF6', 'Sunrisers Hyderabad': '#F97316', 'Delhi Capitals': '#60A5FA', 'Delhi Daredevils': '#60A5FA',
  'Punjab Kings': '#F43F5E', 'Kings XI Punjab': '#F43F5E', 'Rajasthan Royals': '#EC4899', 'Gujarat Titans': '#94A3B8',
  'Lucknow Super Giants': '#22D3EE', 'Deccan Chargers': '#CBD5E1', 'Rising Pune Supergiant': '#A78BFA', 'Rising Pune Supergiants': '#A78BFA',
  'Gujarat Lions': '#F97316', 'Pune Warriors': '#60A5FA', 'Kochi Tuskers Kerala': '#F97316',
  // BBL / WBBL
  'Perth Scorchers': '#F97316', 'Sydney Sixers': '#EC4899', 'Sydney Thunder': '#A3E635', 'Melbourne Stars': '#22C55E',
  'Melbourne Renegades': '#EF4444', 'Brisbane Heat': '#22D3EE', 'Adelaide Strikers': '#3B82F6', 'Hobart Hurricanes': '#8B5CF6',
  // PSL
  'Lahore Qalandars': '#4ADE80', 'Karachi Kings': '#60A5FA', 'Islamabad United': '#F43F5E', 'Peshawar Zalmi': '#FACC15',
  'Quetta Gladiators': '#A78BFA', 'Multan Sultans': '#22D3EE',
  // CPL
  'Trinbago Knight Riders': '#8B5CF6', 'Guyana Amazon Warriors': '#22C55E', 'Jamaica Tallawahs': '#FACC15', 'Barbados Royals': '#EC4899',
  'Saint Lucia Kings': '#60A5FA', 'St Kitts and Nevis Patriots': '#F43F5E',
  // SA20
  'Durban\'s Super Giants': '#22D3EE', 'Joburg Super Kings': '#FACC15', 'MI Cape Town': '#3B82F6', 'Paarl Royals': '#EC4899',
  'Pretoria Capitals': '#60A5FA', 'Sunrisers Eastern Cape': '#F97316',
  // ILT20
  'Abu Dhabi Knight Riders': '#8B5CF6', 'Desert Vipers': '#EF4444', 'Dubai Capitals': '#60A5FA', 'Gulf Giants': '#F97316',
  'MI Emirates': '#3B82F6', 'Sharjah Warriors': '#22C55E', 'Sharjah Warriorz': '#22C55E',
  // Major League Cricket
  'Los Angeles Knight Riders': '#8B5CF6', 'MI New York': '#3B82F6', 'San Francisco Unicorns': '#F97316', 'Seattle Orcas': '#22D3EE',
  'Texas Super Kings': '#FACC15', 'Washington Freedom': '#EF4444',
  // The Hundred (men's and women's sides share names)
  'Birmingham Phoenix': '#F97316', 'London Spirit': '#60A5FA', 'Manchester Originals': '#C084FC', 'Northern Superchargers': '#FACC15',
  'Oval Invincibles': '#22D3EE', 'Southern Brave': '#22C55E', 'Trent Rockets': '#EF4444', 'Welsh Fire': '#F43F5E',
  // WPL (Delhi Capitals, Mumbai Indians and RCB are shared with the IPL above)
  'Gujarat Giants': '#F97316', 'UP Warriorz': '#A78BFA',
  // Vitality Blast / County Championship
  'Birmingham Bears': '#60A5FA', 'Derbyshire': '#93C5FD', 'Durham': '#38BDF8', 'Essex': '#EF4444', 'Glamorgan': '#FACC15',
  'Gloucestershire': '#F87171', 'Hampshire': '#60A5FA', 'Kent': '#22D3EE', 'Lancashire': '#F43F5E', 'Leicestershire': '#4ADE80',
  'Middlesex': '#F472B6', 'Northamptonshire': '#A78BFA', 'Nottinghamshire': '#86EFAC', 'Somerset': '#FB7185', 'Surrey': '#A3A3A3',
  'Sussex': '#3B82F6', 'Warwickshire': '#60A5FA', 'Worcestershire': '#22C55E', 'Yorkshire': '#FACC15',
  // Super Smash / Plunket Shield
  'Auckland': '#60A5FA', 'Canterbury': '#EF4444', 'Central Districts': '#22C55E', 'Northern Districts': '#FACC15', 'Otago': '#F97316', 'Wellington': '#A78BFA',
  // BPL
  'Chattogram Challengers': '#F97316', 'Chattogram Royals': '#F97316', 'Comilla Victorians': '#EF4444', 'Dhaka Capitals': '#60A5FA',
  'Dhaka Dominators': '#60A5FA', 'Durdanto Dhaka': '#60A5FA', 'Fortune Barishal': '#C084FC', 'Khulna Tigers': '#FACC15',
  'Rangpur Riders': '#22C55E', 'Sylhet Strikers': '#22D3EE', 'Durbar Rajshahi': '#F43F5E', 'Rajshahi Warriors': '#F43F5E',
  // LPL
  'Colombo Strikers': '#3B82F6', 'Dambulla Aura': '#FACC15', 'Dambulla Sixers': '#FACC15', 'Galle Gladiators': '#22C55E', 'Galle Marvels': '#22C55E',
  'Galle Titans': '#22C55E', 'Jaffna Kings': '#C084FC', 'Kandy Falcons': '#EF4444', 'B-Love Kandy': '#EF4444',
};
function teamColor(name) {
  if (!name) return null;
  const n = String(name).replace(/ (Women|Men|A|U19|Under-19s?)$/i, '').trim();
  return TEAM_COL[n] || null;
}
const _hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const _colDist = (a, b) => { const x = _hexRgb(a), y = _hexRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
/* Colours for the two sides of a match: their own when they differ enough, the usual pair otherwise. */
function matchColors(t1, t2) {
  let a = teamColor(t1) || '#F2B24C', b = teamColor(t2) || '#6FA8FF';
  if (_colDist(a, b) < 90) b = _colDist(a, '#6FA8FF') > 90 ? '#6FA8FF' : '#F2B24C';
  return [a, b];
}
/* Player-card header: the profile's top block takes the player's team colour. */
function teamCard(w, rec) {
  const ph = w && w.querySelector('.phead'); if (!ph || ph.classList.contains('pcard')) return;
  const col = teamColor(rec && rec.team);
  ph.classList.add('pcard'); ph.style.setProperty('--tc', col || '#F2B24C');
  if (rec && rec.team) {
    const sub = ph.querySelector('.dim'); if (sub) sub.insertAdjacentHTML('afterbegin', `<span class="tchip"><i></i>${esc(rec.team)}</span>`);
  }
}

const INN_COL_DEFAULT = ['#F2B24C', '#6FA8FF', '#FF6B7E', '#33D17A'];
let INN_COL = INN_COL_DEFAULT.slice();
function wormSVG(inns) {
  const W = CW(720), H = 240, pad = 38, maxO = Math.max(...inns.map(i => i.overs.length), 1);
  const cum = inns.map(i => { let s = 0; return i.overs.map(o => (s += o[0])); });
  const mx = Math.max(...cum.map(cs => cs[cs.length - 1] || 0), 1);
  const X = o => pad + o / maxO * (W - 2 * pad), Y = v => H - pad - v / mx * (H - 2 * pad);
  const lines = inns.map((inn, k) => { const cs = cum[k]; const pts = [`${X(0)},${Y(0)}`].concat(cs.map((v, o) => `${X(o + 1).toFixed(1)},${Y(v).toFixed(1)}`)).join(' ');
    const wk = inn.overs.map((o, j) => o[1] ? `<circle cx="${X(j + 1).toFixed(1)}" cy="${Y(cs[j]).toFixed(1)}" r="${2.5 + o[1]}" fill="${INN_COL[k % 4]}" fill-opacity=".9" stroke="#121317"><title>Over ${j + 1}: ${o[1]} wicket${o[1] > 1 ? 's' : ''}, ${cs[j]} runs</title></circle>` : '').join('');
    return `<polyline points="${pts}" fill="none" stroke="${INN_COL[k % 4]}" stroke-width="2.2"/>${wk}`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Run progression by over">${axisTicksSVG(X, Y, [0, maxO], [0, mx], [pad, pad, W - pad, H - pad])}<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#33363E"/>${lines}<text x="${W / 2}" y="${H - 4}" text-anchor="middle" fill="#8B8E96" font-size="10">Overs →</text></svg>`;
}
function manhattanSVG(inns) {
  const W = CW(720), H = 200, pad = 38, maxO = Math.max(...inns.map(i => i.overs.length), 1), n = inns.length;
  const mx = Math.max(...inns.flatMap(i => i.overs.map(o => o[0])), 1), gw = (W - 2 * pad) / maxO, bw = Math.max(1, gw * 0.8 / n);
  const Y = v => H - pad - v / mx * (H - 2 * pad);
  const bars = inns.map((inn, k) => inn.overs.map((o, j) => { const x = pad + j * gw + gw * 0.1 + k * bw, y = Y(o[0]);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad - y).toFixed(1)}" fill="${INN_COL[k % 4]}" fill-opacity="${o[1] ? 1 : .6}"><title>${esc(inn.team || '')} over ${j + 1}: ${o[0]} runs${o[1] ? ', ' + o[1] + ' wkt' : ''}</title></rect>`; }).join('')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Runs per over">${axisTicksSVG(o => pad + o * gw, Y, maxO <= 50 ? [0, maxO] : null, [0, mx], [pad, pad, W - pad, H - pad], { nx: 5 })}<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#33363E"/>${bars}</svg>`;
}
function matchDetail(app, x, id) {
  const mt = x.recent.find(r => r.id === id);
  if (!mt) { app.appendChild($('<div class="cov">This match is no longer in the recent list.</div>')); return; }
  { const [ca, cb] = matchColors(mt.teams[0], mt.teams[1]), byTeam = { [mt.teams[0]]: ca, [mt.teams[1]]: cb };
    INN_COL = mt.inns.map((inn, k) => byTeam[inn.team] || INN_COL_DEFAULT[k % 4]);
    while (INN_COL.length < 4) INN_COL.push(INN_COL_DEFAULT[INN_COL.length]); }
  const back = $('<div class="row" style="margin-top:20px;gap:10px;align-items:center"><button class="pill" id="mback">← matches</button></div>'); app.appendChild(back);
  back.querySelector('#mback').onclick = () => { state.match = null; render(); };
  app.appendChild($(`<div style="margin-top:10px"><h1 style="margin:0">${esc(mt.teams[0])} <span class="dim">vs</span> ${esc(mt.teams[1])}</h1><p class="sub">${esc(mt.date)} · <a ${goAttr('venue', (mt.venue || '').split(',')[0].trim())}>${esc(mt.venue || '')}</a>${mt.stage ? ' · ' + esc(mt.stage) : ''} · toss: ${esc(mt.toss[0] || '-')} chose to ${esc(mt.toss[1] || '-')}</p></div>`));
  const g = $('<div class="grid bento"></div>');
  g.appendChild($(`<div class="panel s12" style="background:linear-gradient(120deg,rgba(229,154,47,.13),transparent)"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><h2 style="margin:0;font-size:17px">${esc(resultText(mt))}</h2><div class="row" style="gap:16px;flex-wrap:wrap">${mt.inns.map((i, k) => `<span class="num"><span class="sw" style="background:${INN_COL[k % 4]};display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px"></span>${esc(i.team || '')} <b>${i.runs}/${i.wkts}</b> <span class="dim">(${i.overs.length} ov)</span></span>`).join('')}</div></div></div>`));
  if (mt.elo) { const [ra, rb] = mt.elo, pa = eloWinPct(ra, rb), fav = pa >= 50 ? 0 : 1, won = mt.winner ? mt.winner === mt.teams[fav] : null;
    g.appendChild($(`<div class="panel s12"><h2>Before the match <span class="r">Elo ratings</span></h2><div class="row" style="gap:18px;flex-wrap:wrap;align-items:center"><span><b>${esc(mt.teams[0])}</b> ${ra}</span><span><b>${esc(mt.teams[1])}</b> ${rb}</span><span class="dim">${esc(mt.teams[fav])} favoured, ${Math.round(Math.max(pa, 100 - pa))}% from ratings alone${won == null ? '' : won ? ' · the favourite won' : ' · an upset'}</span></div></div>`)); }
  const wpSlot = $('<div class="panel s12" style="display:none"></div>'); g.appendChild(wpSlot);
  const projSlot = $('<div class="panel s12" style="display:none"></div>'); g.appendChild(projSlot);
  ensureWinProb(wp => {
    const c = cur(), model = wpModel(wp, c.meta.format, c.meta.gender);
    if (!model || c.meta.format === 'test' || mt.inns.length < 2) return;
    const i1 = mt.inns[0], i2 = mt.inns[1], target = i1.runs + 1, series = [winProbFirst(model, 1, 0, 0, 0)];
    let r = 0, w = 0, b = 0;
    i1.overs.forEach(o => { r += o[0]; w += o[1]; b = Math.min(b + 6, model.T); series.push(winProbFirst(model, 1, r, b, w)); });
    const split = series.length - 1; r = 0; w = 0; b = 0;
    i2.overs.forEach(o => { r += o[0]; w += o[1]; b = Math.min(b + 6, model.T); series.push(winProbFirst(model, 2, r, b, w, target)); });
    const swing = series.slice(1).map((v, k) => ({ k, d: Math.abs(v - series[k]) })).sort((x, z) => z.d - x.d)[0];
    const at = swing ? (swing.k < split ? `${esc(i1.team)} over ${swing.k + 1}` : `${esc(i2.team)} over ${swing.k - split + 1}`) : '';
    wpSlot.innerHTML = `<h2>Win probability <span class="r">biggest swing: ${at}</span></h2>${winProbSVG(series, i1.team || 'Batting first', i2.team || 'Chasing', split)}
      <div class="note" style="margin-top:6px">From runs, balls and wickets after each over, using a model trained on every ${c.meta.format.toUpperCase()} in the data. It doesn't know the teams, the pitch or rain rules.</div>`;
    wpSlot.style.display = '';
    if (model.proj) {
      const fac = projFactor(model, c.meta), halfK = Math.floor(model.T / 12);
      let pr = 0, pw = 0, pb = 0; const ps = [projectTotal(model, 0, 0, 0, fac)];
      i1.overs.forEach(o => { pr += o[0]; pw += o[1]; pb = Math.min(pb + 6, model.T); ps.push(projectTotal(model, pr, pb, pw, fac)); });
      // the chase: where it would finish at this pace (above the target line = on course)
      pr = pw = pb = 0; const cs = [projectTotal(model, 0, 0, 0, fac)];
      i2.overs.forEach(o => { pr += o[0]; pw += o[1]; pb = Math.min(pb + 6, model.T); cs.push(projectTotal(model, pr, pb, pw, fac)); });
      const half = ps[Math.min(ps.length - 1, halfK)], ch = cs[Math.min(cs.length - 1, halfK)];
      const facNote = Math.abs(fac - 1) >= 0.02 ? ` Scaled by ${fac.toFixed(2)} because ${esc(c.meta.label)} has scored ${fac > 1 ? 'more' : 'less'} than the average ${c.meta.format.toUpperCase()} over the last three seasons.` : '';
      const rec = model.proj_mae_recent && model.proj_mae_recent[1];
      projSlot.innerHTML = `<h2>Projected totals <span class="r">at the halfway mark: ${esc(i1.team || 'Batting first')} ${Math.round(half)} (made ${i1.runs}) · ${esc(i2.team || 'Chasing')} on pace for ${Math.round(ch)} (target ${target})</span></h2>
        <div class="grid bento"><div class="s6">${projSVG(ps, i1.runs, `final ${i1.runs}`, `${i1.team || 'Batting first'} projected total`)}</div>
        <div class="s6">${projSVG(cs, target, `target ${target}`, `${i2.team || 'Chasing'} pace (above the line = on course)`, INN_COL[1])}</div></div>
        <div class="note" style="margin-top:6px">After each over: runs so far plus the average runs still to come from the same overs and wickets, across every completed first innings in ${c.meta.format.toUpperCase()}s in the data.${facNote} On recent matches it is typically about ${rec || model.proj_mae_mid || '?'} runs out at the halfway mark. For the chase it shows where the innings would end at that rate if it ran the full distance, not whether they win.</div>`;
      projSlot.style.display = '';
    }
  });
  g.appendChild($(`<div class="panel s12"><h2>Run progression <span class="r">dots = wickets</span></h2>${wormSVG(mt.inns)}</div>`));
  g.appendChild($(`<div class="panel s12"><h2>Runs per over <span class="r">solid = wicket in the over</span></h2>${manhattanSVG(mt.inns)}</div>`));
  mt.inns.forEach((inn, k) => {
    g.appendChild($(`<div class="panel s6"><h2><span style="color:${INN_COL[k % 4]}">●</span> ${esc(inn.team || 'Innings ' + (k + 1))} batting <span class="r">${inn.runs}/${inn.wkts}</span></h2><div class="tscroll"><table><thead><tr><th>Batter</th><th class="n">R</th><th class="n">B</th><th class="n">SR</th></tr></thead><tbody>${inn.bat.map(b => `<tr><td>${pidLink(pId(x, b[0]), pName(x, b[0]))}${b[3] ? '' : ' <span class="dim">not out</span>'}</td><td class="n"><b>${b[1]}</b></td><td class="n dim">${b[2]}</td><td class="n">${b[2] ? (100 * b[1] / b[2]).toFixed(1) : '-'}</td></tr>`).join('')}</tbody></table></div></div>`));
    g.appendChild($(`<div class="panel s6"><h2>Bowling <span class="r">to ${esc(inn.team || '')}</span></h2><div class="tscroll"><table><thead><tr><th>Bowler</th><th class="n">O</th><th class="n">R</th><th class="n">W</th><th class="n">Econ</th></tr></thead><tbody>${inn.bowl.map(b => `<tr><td>${pidLink(pId(x, b[0]), pName(x, b[0]), true)}</td><td class="n">${Math.floor(b[1] / 6)}${b[1] % 6 ? '.' + b[1] % 6 : ''}</td><td class="n">${b[2]}</td><td class="n"><b>${b[3]}</b></td><td class="n">${b[1] ? (6 * b[2] / b[1]).toFixed(2) : '-'}</td></tr>`).join('')}</tbody></table></div></div>`));
  });
  g.appendChild($('<div class="panel s12"><span class="note">Top 11 batters and top 8 bowlers per innings, from Cricsheet ball-by-ball.</span></div>'));
  app.appendChild(g); wireLinks(app);
}

/* ===================== win probability (models trained in packages/analytics/cil_analytics/winprob.py) ===================== */
function ensureWinProb(cb) { lazyScript('winprob.js', () => !!window.CIL_WINPROB, () => cb(window.CIL_WINPROB || null)); }
/* Must mirror features() in winprob.py exactly. */
function winFeatures(inn, runs, balls, wkts, T, target) {
  const frac = Math.min(balls, T) / T, wl = Math.min(wkts, 10) / 10;
  if (inn === 1) { const s = runs / (T * 1.25); return [1, s, frac, wl, s * (1 - frac), wl * (1 - frac), frac * frac]; }
  const need = Math.max(target - runs, 0), left = Math.max(T - balls, 1), rrr = Math.min(need * 6 / left, 36) / 10;
  return [1, rrr, wl, left / T, Math.log1p(need) / 5, (1 - wl) * left / T, rrr * wl];
}
/* P(the side batting first wins) at a given state; null when no model fits. */
function winProbFirst(model, inn, runs, balls, wkts, target) {
  if (!model) return null;
  const T = model.T;
  if (inn === 2) {
    if (runs >= target) return 0;
    if (wkts >= 10 || balls >= T) return 1;
  }
  const z = winFeatures(inn, runs, balls, wkts, T, target).reduce((a, x, i) => a + x * model['inn' + inn][i], 0);
  const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  return inn === 1 ? p : 1 - p;
}
/* Projected first-innings total from the lookup table in winprob.js. Mirrors project() in winprob.py. */
function projectTotal(model, runs, balls, wkts, fac) {
  const tab = model && model.proj; if (!tab) return null;
  const T = model.T, overs = Math.floor(T / 6);
  if (balls >= T || wkts >= 10) return runs;
  const k = Math.min(Math.floor(balls / 6), overs - 1), w = Math.min(wkts, 9), f = (balls % 6) / 6;
  const nxt = k + 1 < overs ? tab[k + 1][w] : 0;
  return runs + (tab[k][w] + (nxt - tab[k][w]) * f) * (fac || 1);
}
/* How much this competition outscores the format average lately (1 = average). */
function projFactor(model, meta) {
  const F = (model && model.proj_fac) || {}, base = String(meta.key || '').replace(/__fm$/, '');
  return (meta.intl ? F.intl : F[base]) || 1;
}
function projSVG(series, final, refLab, title, col) {
  col = col || INN_COL[0];
  const W = CW(720), H = 190, pad = 38, n = series.length, all = series.concat([final]);
  const lo = Math.min(...all), hi = Math.max(...all), sp = (hi - lo) || 1, y0 = lo - sp * 0.1, y1 = hi + sp * 0.1;
  const X = i => pad + i / Math.max(n - 1, 1) * (W - 2 * pad), Y = v => H - pad - (v - y0) / (y1 - y0) * (H - 2 * pad);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Projected total through the first innings">${axisTicksSVG(null, Y, null, [y0, y1], [pad, pad, W - pad, H - pad])}
    <line x1="${pad}" x2="${W - pad}" y1="${Y(final).toFixed(1)}" y2="${Y(final).toFixed(1)}" stroke="#5a5d66" stroke-dasharray="4 4"/><text x="${W - pad}" y="${(Y(final) - 5).toFixed(1)}" text-anchor="end" fill="#8B8E96" font-size="9.5">${esc(refLab)}</text>
    <polyline points="${series.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2.2"/>
    ${series.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.2" fill="${col}"><title>${i ? 'After over ' + i : 'Before the first ball'}: projected ${Math.round(v)}</title></circle>`).join('')}
    <text x="${pad + 4}" y="${pad - 8}" fill="${col}" font-size="10.5">${esc(title)}</text></svg>`;
}
const wpModel = (wp, fmt, gender) => wp && wp.models && wp.models[`${fmt === 'odi' ? 'odi' : 't20'}_${gender === 'female' ? 'female' : 'male'}`];
function winProbSVG(series, teamA, teamB, split) {
  const W = CW(720), H = 210, pad = 38, n = series.length;
  const X = i => pad + i / Math.max(n - 1, 1) * (W - 2 * pad), Y = v => H - pad - v * (H - 2 * pad);
  const pts = series.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const area = `M${X(0)},${Y(.5)} L${pts.join(' L')} L${X(n - 1)},${Y(.5)} Z`;
  const ticks = [0, .25, .5, .75, 1].map(v => `<text x="${pad - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" fill="#8B8E96" font-size="9">${Math.round(v * 100)}%</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Win probability through the match">${ticks}
    <line x1="${pad}" y1="${Y(.5)}" x2="${W - pad}" y2="${Y(.5)}" stroke="#33363E" stroke-dasharray="4 4"/>
    ${split ? `<line x1="${X(split)}" y1="${pad}" x2="${X(split)}" y2="${H - pad}" stroke="#33363E"/><text x="${X(split) + 4}" y="${pad + 10}" fill="#8B8E96" font-size="9.5">innings break</text>` : ''}
    <path d="${area}" fill="${INN_COL[0]}" fill-opacity=".12"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${INN_COL[0]}" stroke-width="2.2"/>
    <text x="${pad + 4}" y="${pad - 8}" fill="${INN_COL[0]}" font-size="10.5">${esc(teamA)} winning ↑</text>
    <text x="${pad + 4}" y="${H - pad + 24}" fill="${INN_COL[1]}" font-size="10.5">${esc(teamB)} winning ↓</text></svg>`;
}
/* Live cards: one-line estimate for T20/ODI scores like "155/6 (18.2)". */
function parseScore(sc) {
  const m = /(\d+)(?:\/(\d+))?\s*\((\d+)(?:\.(\d))?\)/.exec(sc || ''); if (!m) return null;
  return { runs: +m[1], wkts: m[2] == null ? 10 : +m[2], balls: +m[3] * 6 + (+m[4] || 0) };
}
function liveWinLine(m, wp) {
  const f = String(m.format || '').toLowerCase(), fmt = f.includes('odi') ? 'odi' : f.includes('t20') ? 't20' : null;
  if (!fmt || !(m.teams || []).length) return '';
  const model = wpModel(wp, fmt, /women/i.test((m.title || '') + ' ' + (m.series || '')) ? 'female' : 'male');
  const a = m.teams[0], b = m.teams[1], sa = parseScore(a && a.score), sb = parseScore(b && b.score);
  let pA = null;
  if (sa && !sb) pA = winProbFirst(model, 1, sa.runs, sa.balls, sa.wkts);
  else if (sa && sb) pA = winProbFirst(model, 2, sb.runs, sb.balls, sb.wkts, sa.runs + 1);
  if (pA == null || /won|tied|abandon|no result/i.test(m.status || '')) return '';
  const fav = pA >= .5 ? a.name : b.name, pct = Math.round(100 * Math.max(pA, 1 - pA));
  const ser = ((m.series || '') + ' ' + (m.title || '')).toLowerCase();
  const lg = (window.CIL_INDEX ? CIL_INDEX.cohorts : []).find(x => !x.intl && x.label && ser.includes(x.label.toLowerCase()));
  const fac = lg ? projFactor(model, lg) : 1;
  let projHTML = '';
  if (sa && !sb && sa.balls >= 30) {
    const proj = projectTotal(model, sa.runs, sa.balls, sa.wkts, fac);
    if (proj != null) projHTML = `<div class="wpline" title="Runs so far plus the average still to come from this many overs and wickets, across every completed first innings in the data${lg ? ', scaled for ' + esc(lg.label) : ''}."><span>Projected</span><b>${esc(a.name)} about ${Math.round(proj)}</b></div>`;
  } else if (sa && sb && sb.balls >= 30) {
    const proj = projectTotal(model, sb.runs, sb.balls, sb.wkts, fac), tgt = sa.runs + 1;
    if (proj != null) projHTML = `<div class="wpline" title="Where the chase would end at this rate if it ran the full distance (runs so far plus the average still to come). Not the same as the win chance."><span>On this pace</span><b>${esc(b.name)} about ${Math.round(proj)} (need ${tgt})</b></div>`;
  }
  return projHTML + `<div class="wpline" title="Estimated from runs, balls and wickets with a model trained on every ${fmt.toUpperCase()} in Cricsheet. It doesn't know the teams or conditions."><span>Win chance</span><div class="wpbar"><span style="width:${(100 * pA).toFixed(0)}%"></span></div><b>${esc(fav)} ${pct}%</b></div>`;
}
const _matchCardHTML = matchCardHTML;
matchCardHTML = function (m, clickable) {
  const html = _matchCardHTML(m, clickable), line = window.CIL_WINPROB ? liveWinLine(m, window.CIL_WINPROB) : '';
  return line ? html.replace(/<\/div>\s*$/, line + '</div>') : html;
};
ensureWinProb(() => {}); // tiny file: load early so live cards can use it

/* ===================== venue & team pages ===================== */
function rowsClickable(panel, attr) {
  // dataTable redraws rows on sort/page, so delegate from the panel and read the first cell
  panel.addEventListener('click', e => { const tr = e.target.closest('tbody tr'); if (!tr || e.target.closest('a')) return;
    const td = tr.querySelector('td'); if (!td) return; state[attr] = td.textContent.trim(); render(); });
  panel.classList.add('rowlinks');
}
const _venuesView = venuesView;
venuesView = function (app) { _venuesView(app); const p = app.querySelector('.panel'); if (p) rowsClickable(p, 'venue');
  const s = app.querySelector('.sub'); if (s) s.insertAdjacentHTML('beforeend', ' Click a ground for its page.'); };
const _teamsView = teamsView;
teamsView = function (app) { _teamsView(app);
  const hook = () => { const p = app.querySelector('.panel'); if (p && !p.classList.contains('rowlinks')) rowsClickable(p, 'team'); };
  hook(); setTimeout(hook, 1500); const s = app.querySelector('.sub'); if (s) s.insertAdjacentHTML('beforeend', ' Click a team for its page and head-to-heads.'); };

function venueDetail(app, x, name) {
  const c = cur(), v = (c.venues || []).find(r => r.venue === name) || { venue: name }, d = x && x.venues && x.venues[name];
  const back = $('<div class="row" style="margin-top:20px"><button class="pill" id="vback">← venues</button></div>'); app.appendChild(back);
  back.querySelector('#vback').onclick = () => { state.venue = null; render(); };
  app.appendChild($(`<div style="margin-top:10px"><h1 style="margin:0">${esc(name)}</h1><p class="sub">${esc(v.city || '')}${v.city ? ' · ' : ''}${esc(c.meta.label)}</p></div>`));
  const k = (l, val) => `<div class="s3"><div class="panel kpi"><div class="l">${l}</div><div class="n">${val == null ? '-' : fmtN(val)}</div></div></div>`;
  const g = $('<div class="grid bento"></div>');
  g.innerHTML = k('Matches', v.matches) + k('Avg 1st innings', v.avg_first) + k('Avg 2nd innings', v.avg_second) + k('Chase win %', v.chase_win_pct);
  app.appendChild(g);
  if (!d) { app.appendChild($('<div class="cov" style="margin-top:13px">Ground trends, toss effect and top performers arrive with the next weekly data rebuild.</div>')); return; }
  const g2 = $('<div class="grid bento" style="margin-top:13px"></div>');
  const tr = d.trend.map(t => ({ year: t[0], avg: t[1], balls: 999, tip: `${t[0]}: first-innings average ${t[1]} over ${t[2]} match${t[2] > 1 ? 'es' : ''}` }));
  if (tr.length >= 2) g2.appendChild($(`<div class="panel s8"><h2>First-innings average by year</h2>${yearChartSVG(tr, { avg: { lab: 'Avg', unit: 'runs' } }, 'avg', 0)}</div>`));
  const tz = d.toss || {}, tl = (k2, l) => tz[k2] ? `<div class="ledrow"><span>${l}</span><b class="num">${Math.round(100 * tz[k2][1] / tz[k2][0])}% <span class="dim">won (${tz[k2][0]})</span></b></div>` : '';
  g2.appendChild($(`<div class="panel ${tr.length >= 2 ? 's4' : 's12'}"><h2>Toss effect</h2>${tl('bat', 'Won toss, batted') + tl('field', 'Won toss, fielded') || '<span class="note">No toss data.</span>'}${v.bat_first_win_pct != null ? `<div class="ledrow"><span>Batting first wins</span><b class="num">${v.bat_first_win_pct}%</b></div>` : ''}</div>`));
  g2.appendChild($(`<div class="panel s6"><h2>Top batters here</h2>${d.bat.map(b => `<div class="ledrow">${pidLink(pId(x, b[0]), pName(x, b[0]))}<span class="num">${b[1].toLocaleString()} <span class="dim">(${b[2]}b · SR ${(100 * b[1] / b[2]).toFixed(1)})</span></span></div>`).join('')}</div>`));
  g2.appendChild($(`<div class="panel s6"><h2>Top bowlers here</h2>${d.bowl.map(b => `<div class="ledrow">${pidLink(pId(x, b[0]), pName(x, b[0]), true)}<span class="num">${b[1]} wkts <span class="dim">(econ ${(6 * b[2] / b[3]).toFixed(2)})</span></span></div>`).join('')}</div>`));
  const rec = (x.recent || []).filter(mt => (mt.venue || '').split(',')[0].trim() === name);
  if (rec.length) g2.appendChild($(`<div class="panel s12"><h2>Recent matches here</h2>${rec.map(mt => `<a class="mrow" ${goAttr('match', mt.id)}><span class="dim num">${esc(mt.date)}</span><span>${esc(mt.teams[0])} <span class="dim">vs</span> ${esc(mt.teams[1])}</span><span class="mres">${esc(resultText(mt))}</span></a>`).join('')}</div>`));
  app.appendChild(g2); wireLinks(app);
}
/* ---------- Team ratings (Elo, built per competition in extras.py) ---------- */
const ELO_COLS = ['#F2B24C', '#6FA8FF', '#33D17A', '#FF6B7E', '#C792EA', '#8B8E96'];
const eloWinPct = (ra, rb) => 100 / (1 + Math.pow(10, (rb - ra) / 400));
function eloPanel(x, c) {
  const E = x && x.elo; if (!E || !E.teams) return null;
  const latestYr = Math.max(...Object.values(E.teams).map(t => (t.hist[t.hist.length - 1] || [0])[0]));
  // rank teams still playing (a match in the last three seasons) with a few games behind them
  const active = Object.entries(E.teams).filter(([, t]) => t.n >= 10 && (t.hist[t.hist.length - 1] || [0])[0] >= latestYr - 2).sort((a, b) => b[1].r - a[1].r);
  if (!active.length) return null;
  const top = active.slice(0, 6);
  const yrs = [...new Set(top.flatMap(([, t]) => t.hist.map(h => h[0])))].sort((a, b) => a - b);
  const used = [];
  const series = top.map(([name, t], i) => { let col = teamColor(name);
    if (!col || used.some(u => _colDist(u, col) < 70)) col = ELO_COLS.find(c => !used.some(u => _colDist(u, c) < 70)) || ELO_COLS[i];
    used.push(col); return { name, color: col, pts: t.hist.map(h => [h[0], h[1], true, 99]) }; });
  const acc = E.acc && E.acc[1] ? Math.round(100 * E.acc[0] / E.acc[1]) : null;
  const yearAgo = t => { const h = t.hist.filter(v => v[0] <= latestYr - 1); return h.length ? h[h.length - 1][1] : null; };
  const rows = active.map(([name, t], i) => { const y = yearAgo(t), d = y == null ? null : t.r - y;
    return `<tr class="cl" data-team="${esc(name)}"><td class="n dim">${i + 1}</td><td>${esc(name)}</td><td class="n"><b>${t.r}</b></td><td class="n ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'dim'}">${d == null ? '-' : (d > 0 ? '+' : '') + d}</td><td class="n dim">${t.n}</td></tr>`; }).join('');
  const el = $(`<div class="grid bento" style="margin-bottom:13px"><div class="s7"><div class="panel"><h2>Team ratings <span class="r">Elo, end of each season · top ${top.length} now</span></h2>${yrs.length > 1 ? trendLineSVG(series, { fmt: v => String(Math.round(v)), label: 'Elo rating', ref: 1500 }) : ''}
    <div class="note" style="margin-top:6px">Every team starts at 1500 and gains or loses points after each match, more for beating a stronger side. ${acc != null ? `The higher-rated side won <b>${acc}%</b> of ${E.acc[1].toLocaleString()} decided matches between established teams in ${esc(c.meta.label)}${acc < 56 ? ', so ratings barely predict results here' : ''}.` : ''}</div></div></div>
    <div class="s5"><div class="panel"><h2>Current ratings <span class="r">change = since a year ago</span></h2><div class="tscroll" style="max-height:330px"><table><thead><tr><th class="n">#</th><th>Team</th><th class="n">Rating</th><th class="n">Change</th><th class="n">Matches</th></tr></thead><tbody>${rows}</tbody></table></div></div></div></div>`);
  el.querySelectorAll('tr[data-team]').forEach(tr => tr.onclick = () => { state.team = tr.dataset.team; render(); });
  return el;
}
const _teamsViewElo = teamsView;
teamsView = function (app) {
  _teamsViewElo(app);
  const slot = $('<div></div>'), h = app.querySelector('.sub'); if (h) h.parentElement.after(slot); else app.prepend(slot);
  ensureExtras(dataKey(), x => { const p = eloPanel(x, cur()); if (p) slot.appendChild(p); });
};
function teamDetail(app, x, name) {
  const c = cur(), t = (c.teams || []).find(r => r.team === name) || { team: name }, d = x && x.teams && x.teams[name];
  const back = $('<div class="row" style="margin-top:20px"><button class="pill" id="tback">← teams</button></div>'); app.appendChild(back);
  back.querySelector('#tback').onclick = () => { state.team = null; render(); };
  app.appendChild($(`<div style="margin-top:10px"><h1 style="margin:0">${esc(name)}</h1><p class="sub">${esc(c.meta.label)}</p></div>`));
  if (c.meta.intl) app.appendChild($(`<div style="margin-bottom:10px">${covNote(c, 'afg')}</div>`));
  const lost = d ? d.years.reduce((s, y) => s + y[3], 0) : null;
  const k = (l, val) => `<div class="s3"><div class="panel kpi"><div class="l">${l}</div><div class="n">${val == null ? '-' : fmtN(val)}</div></div></div>`;
  const g = $('<div class="grid bento"></div>'); g.innerHTML = k('Matches', t.matches) + k('Won', t.wins) + k('Lost', lost) + k('Win %', t.winpct); app.appendChild(g);
  const et = x && x.elo && x.elo.teams && x.elo.teams[name];
  if (et && et.hist.length >= 2) {
    const peak = et.hist.reduce((a, h) => h[1] > a[1] ? h : a, et.hist[0]);
    const rank = Object.values(x.elo.teams).filter(o => o.r > et.r && o.n >= 10).length + 1;
    app.appendChild($(`<div class="panel" style="margin-top:13px"><h2>Elo rating <span class="r">now ${et.r} (#${rank} in ${esc(c.meta.label)}) · peak ${peak[1]} in ${peak[0]} · dashed = 1500 start</span></h2>${trendLineSVG([{ name, color: teamColor(name) || '#F2B24C', pts: et.hist.map(h => [h[0], h[1], true, 99]) }], { fmt: v => String(Math.round(v)), label: 'Elo rating', ref: 1500 })}</div>`));
  }
  if (!d) { app.appendChild($('<div class="cov" style="margin-top:13px">Results by year, head-to-heads and top players arrive with the next weekly data rebuild.</div>')); return; }
  const g2 = $('<div class="grid bento" style="margin-top:13px"></div>');
  const yrs = d.years.map(y => ({ year: y[0], pct: y[1] ? Math.round(100 * y[2] / y[1]) : 0, balls: y[1] >= 3 ? 999 : 0, tip: `${y[0]}: won ${y[2]} of ${y[1]} (lost ${y[3]})` }));
  if (yrs.length >= 2) g2.appendChild($(`<div class="panel s12"><h2>Win % by year <span class="r">hollow = under 3 matches</span></h2>${yearChartSVG(yrs, { pct: { lab: 'Win %', unit: '%' } }, 'pct', 1)}</div>`));
  // head to head + opponent picker
  const h2h = d.h2h;
  const sel = state.team2 && h2h.find(h => h[0] === state.team2) ? state.team2 : (h2h[0] || [])[0];
  const pane = $(`<div class="panel s7"><h2>Head to head</h2><div class="tscroll"><table><thead><tr><th>Opponent</th><th class="n">P</th><th class="n">W</th><th class="n">L</th><th class="n">Win %</th></tr></thead><tbody>${h2h.map(h => `<tr class="cl${h[0] === sel ? ' on' : ''}" data-opp="${esc(h[0])}"><td>${esc(h[0])}</td><td class="n">${h[1]}</td><td class="n">${h[2]}</td><td class="n">${h[3]}</td><td class="n"><b>${h[1] ? Math.round(100 * h[2] / h[1]) : 0}%</b></td></tr>`).join('')}</tbody></table></div></div>`);
  g2.appendChild(pane);
  const vs = $('<div class="panel s5"></div>'); g2.appendChild(vs);
  const drawVs = opp => { const h = h2h.find(r => r[0] === opp); if (!h) { vs.innerHTML = ''; return; }
    const meet = (x.recent || []).filter(mt => mt.teams.includes(name) && mt.teams.includes(opp));
    vs.innerHTML = `<h2>${esc(name)} <span class="dim">vs</span> ${esc(opp)}</h2><div class="row" style="gap:18px;margin:6px 0 12px"><div><div class="dim" style="font-size:11px">PLAYED</div><b class="num" style="font-size:22px">${h[1]}</b></div><div><div class="dim" style="font-size:11px">${esc(name.toUpperCase())}</div><b class="num pos" style="font-size:22px">${h[2]}</b></div><div><div class="dim" style="font-size:11px">${esc(opp.toUpperCase())}</div><b class="num neg" style="font-size:22px">${h[3]}</b></div></div>
      <div class="bar" style="height:8px;margin-bottom:12px"><span style="width:${h[1] ? 100 * h[2] / h[1] : 0}%;background:var(--pos)"></span></div>
      ${meet.length ? '<div class="dim" style="font-size:11px;margin-bottom:4px">RECENT MEETINGS</div>' + meet.map(mt => `<a class="mrow" ${goAttr('match', mt.id)}><span class="dim num">${esc(mt.date)}</span><span class="mres">${esc(resultText(mt))}</span></a>`).join('') : '<span class="note">No meetings in the latest matches list.</span>'}
      <a class="pill" style="margin-top:10px;display:inline-block" ${goAttr('team', opp)}>${esc(opp)} page →</a>`; wireLinks(vs); };
  pane.querySelectorAll('tr[data-opp]').forEach(tr => tr.onclick = () => { state.team2 = tr.dataset.opp; pane.querySelectorAll('tr').forEach(r => r.classList.toggle('on', r === tr)); drawVs(tr.dataset.opp); });
  drawVs(sel);
  g2.appendChild($(`<div class="panel s6"><h2>Top run-scorers for ${esc(name)}</h2>${d.bat.map(b => `<div class="ledrow">${pidLink(pId(x, b[0]), pName(x, b[0]))}<span class="num">${b[1].toLocaleString()} <span class="dim">(SR ${(100 * b[1] / b[2]).toFixed(1)})</span></span></div>`).join('')}</div>`));
  g2.appendChild($(`<div class="panel s6"><h2>Top wicket-takers for ${esc(name)}</h2>${d.bowl.map(b => `<div class="ledrow">${pidLink(pId(x, b[0]), pName(x, b[0]), true)}<span class="num">${b[1]} <span class="dim">(econ ${(6 * b[2] / b[3]).toFixed(2)})</span></span></div>`).join('')}</div>`));
  app.appendChild(g2); wireLinks(app);
}
window.detailView = function (app) {
  const which = state.view === 'venues' && state.venue ? 'venue' : state.view === 'teams' && state.team ? 'team' : state.view === 'matches' && state.match ? 'match' : null;
  if (!which) return false;
  const key = dataKey(), draw = x => { if (which === 'venue') venueDetail(app, x, state.venue); else if (which === 'team') teamDetail(app, x, state.team); else if (x) matchDetail(app, x, state.match); else app.appendChild($('<div class="cov">Match pages arrive with the next weekly data rebuild.</div>')); };
  if (_X[key]) draw(xNow());
  else { const l = $('<div class="loadbox"><div class="spinner"></div><div>Loading…</div></div>'); app.appendChild(l); ensureExtras(key, x => { if (dataKey() !== key) return; l.remove(); draw(x); }); }
  return true;
};
/* ---------- Trends: how the whole competition has changed, season by season ---------- */
const TR_MIN = 5; // seasons with fewer matches are drawn hollow and left out of the "then vs now" summary
function trendLineSVG(series, opt) {
  const W = CW(520), H = 210, padL = 40, padR = 12, padT = 12, padB = 26;
  const xs = series.flatMap(s => s.pts.map(p => p[0])), ys = series.flatMap(s => s.pts.map(p => p[1])).concat(opt.ref != null ? [opt.ref] : []);
  if (!xs.length) return '<span class="note">Not enough data.</span>';
  const x0 = Math.min(...xs), x1 = Math.max(...xs), lo = Math.min(...ys), hi = Math.max(...ys), sp = (hi - lo) || 1;
  const y0 = opt.zero ? 0 : lo - sp * 0.08, y1 = hi + sp * 0.08;
  const X = x => padL + (x - x0) / ((x1 - x0) || 1) * (W - padL - padR), Y = y => H - padB - (y - y0) / ((y1 - y0) || 1) * (H - padT - padB);
  let g = axisTicksSVG(null, Y, null, [y0, y1], [padL, padT, W - padR, H - padB]);
  const step = Math.max(1, Math.ceil((x1 - x0) / 7));
  for (let x = x0; x <= x1; x += step) g += `<text x="${X(x).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#8A6A5C" font-size="9">${x}</text>`;
  if (opt.ref != null) g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(opt.ref).toFixed(1)}" y2="${Y(opt.ref).toFixed(1)}" stroke="#5a5d66" stroke-dasharray="4 4"/>`;
  for (const s of series) {
    g += `<polyline points="${s.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    g += s.pts.map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3" fill="${p[2] ? s.color : '#16181D'}" stroke="${s.color}" stroke-width="1.5"><title>${p[0]}: ${esc(s.name)} ${opt.fmt(p[1])}${p[2] ? '' : ` (only ${p[3]} matches)`}</title></circle>`).join('');
  }
  const leg = series.length > 1 ? `<div class="trleg">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opt.label)} by season">${g}</svg>${leg}`;
}
function trendsView(app) {
  const c = cur(), m = meta(state.cohort), test = m.format === 'test';
  app.appendChild($(`<div><h1>Trends</h1><p class="sub">How ${esc(c.meta.label)} has changed season by season. Every number covers the whole competition${state.fm && c.meta.fm ? ' (full-member matches only)' : ''}, so the time window doesn't apply here. Hollow points are seasons with fewer than ${TR_MIN} matches.</p></div>`));
  const box = $('<div class="loadbox"><div class="spinner"></div><div>Loading trends…</div></div>'); app.appendChild(box);
  ensureExtras(dataKey(), x => {
    box.className = ''; box.innerHTML = '';
    if (!x || !x.trend || !x.trend.length) { box.innerHTML = '<div class="cov">Trends arrive with the next weekly data rebuild.</div>'; return; }
    const C = x.trend_cols, rows = x.trend.map(r => Object.fromEntries(C.map((k, i) => [k, r[i]])));
    const ok = r => r.matches >= TR_MIN;
    const pt = (r, v) => v == null || !isFinite(v) ? null : [r.yr, v, ok(r), r.matches];
    const ser = (name, color, f) => ({ name, color, pts: rows.map(r => pt(r, f(r))).filter(Boolean) });
    const rr = (runs, balls) => balls ? runs * 6 / balls : null, pc = (a, b) => b ? 100 * a / b : null;
    const charts = [];
    charts.push([test ? 'Runs per over' : 'Run rate, overall and by phase', test ? [ser('Runs per over', '#F2B24C', r => rr(r.runs, r.balls))]
      : [ser('Overall', '#F2B24C', r => rr(r.runs, r.balls)), ser('Powerplay', '#6FA8FF', r => rr(r.pp_runs, r.pp_balls)), ser('Middle', '#33D17A', r => rr(r.mid_runs, r.mid_balls)), ser('Death', '#FF6B7E', r => rr(r.death_runs, r.death_balls))],
      { fmt: v => v.toFixed(2), label: 'Run rate' }]);
    charts.push(['Average first-innings total', [ser('First innings', '#F2B24C', r => r.inn1_n ? r.inn1_runs / r.inn1_n : null)], { fmt: v => v.toFixed(1), label: 'First-innings total' }]);
    charts.push(['Boundaries and dot balls (% of balls)', [ser('Boundary %', '#F2B24C', r => pc(r.fours + r.sixes, r.balls)), ser('Dot-ball %', '#6FA8FF', r => pc(r.dots, r.balls))], { fmt: v => v.toFixed(1) + '%', label: 'Boundary and dot-ball share' }]);
    charts.push([test ? 'Toss winner won (% of decided matches)' : 'Who won (% of decided matches)', test ? [ser('Toss winner', '#F2B24C', r => pc(r.toss_won, r.decided))]
      : [ser('Batting second', '#F2B24C', r => pc(r.bat2_won, r.decided)), ser('Toss winner', '#6FA8FF', r => pc(r.toss_won, r.decided))], { fmt: v => v.toFixed(0) + '%', ref: 50, label: 'Win share' }]);
    charts.push(['Runs per wicket', [ser('Runs per wicket', '#F2B24C', r => r.wkts ? r.runs / r.wkts : null)], { fmt: v => v.toFixed(1), label: 'Runs per wicket' }]);
    charts.push(['Matches per season', [ser('Matches', '#8B8E96', r => r.matches)], { fmt: v => String(Math.round(v)), zero: true, label: 'Matches' }]);
    // then vs now: the first three and the last three seasons with a full sample
    const full = rows.filter(ok), sum = (rs, k) => rs.reduce((a, r) => a + (r[k] || 0), 0);
    let hl = '';
    if (full.length >= 6) {
      const a = full.slice(0, 3), b = full.slice(-3), span = rs => `${rs[0].yr}–${rs[rs.length - 1].yr}`;
      const kp = (lab, f, fmt) => `<div class="s3"><div class="panel kpi" style="padding:12px"><div class="l">${lab}</div><div class="n" style="font-size:20px">${fmt(f(b))}</div><div class="dim" style="font-size:11.5px">${fmt(f(a))} in ${span(a)}</div></div></div>`;
      hl = `<p class="sub" style="margin:4px 0 8px">${span(b)} compared with ${span(a)}:</p><div class="grid bento">`
        + kp(test ? 'Runs per over' : 'Run rate', rs => rr(sum(rs, 'runs'), sum(rs, 'balls')), v => v.toFixed(2))
        + kp('First-innings total', rs => sum(rs, 'inn1_runs') / Math.max(1, sum(rs, 'inn1_n')), v => v.toFixed(1))
        + kp('Boundary %', rs => pc(sum(rs, 'fours') + sum(rs, 'sixes'), sum(rs, 'balls')), v => v.toFixed(1) + '%')
        + (test ? kp('Runs per wicket', rs => sum(rs, 'runs') / Math.max(1, sum(rs, 'wkts')), v => v.toFixed(1))
          : kp('Batting second won', rs => pc(sum(rs, 'bat2_won'), sum(rs, 'decided')), v => v.toFixed(0) + '%')) + '</div>';
    }
    box.appendChild($(`<div>${hl}<div class="grid bento" style="margin-top:13px">${charts.map(([t, sr, o]) => `<div class="s6"><div class="panel"><h3 style="margin:0 0 8px;font-size:14px">${t}</h3>${trendLineSVG(sr, o)}</div></div>`).join('')}</div></div>`));
    const th = ['Season', 'Matches', test ? 'Runs/over' : 'Run rate', '1st inns', 'Boundary %', 'Dot %', 'Runs/wkt', test ? 'Toss won' : 'Bat 2nd won'];
    const f1 = v => v == null ? '-' : v.toFixed(1);
    const tb = rows.slice().reverse().map(r => `<tr${ok(r) ? '' : ' class="dim"'}><td class="num">${r.yr}</td><td class="num">${r.matches}</td><td class="num">${(rr(r.runs, r.balls) || 0).toFixed(2)}</td><td class="num">${r.inn1_n ? f1(r.inn1_runs / r.inn1_n) : '-'}</td><td class="num">${f1(pc(r.fours + r.sixes, r.balls))}</td><td class="num">${f1(pc(r.dots, r.balls))}</td><td class="num">${r.wkts ? f1(r.runs / r.wkts) : '-'}</td><td class="num">${r.decided ? Math.round(pc(test ? r.toss_won : r.bat2_won, r.decided)) + '%' : '-'}</td></tr>`).join('');
    box.appendChild($(`<div class="panel" style="margin-top:13px"><h3 style="margin:0 0 8px;font-size:14px">Season by season</h3><div class="tscroll"><table><thead><tr>${th.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${tb}</tbody></table></div></div>`));
  });
}

/* ---------- Season review: one season of a competition on one page ---------- */
const TROPHY_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4M8 21h8M9 18h6"/></svg>';
function seasonView(app) {
  const c = cur(), key = dataKey();
  app.appendChild($(`<div><h1>Season review</h1><p class="sub">One season of ${esc(c.meta.label)}: who won, who led the runs and wickets, the standout performances and how the season compared. Seasons are calendar years.</p></div>`));
  const box = $('<div class="loadbox"><div class="spinner"></div><div>Loading seasons…</div></div>'); app.appendChild(box);
  ensureExtras(key, x => {
    box.className = ''; box.innerHTML = '';
    if (!x || !x.yb) { box.innerHTML = '<div class="cov">Season data arrives with the next weekly data rebuild.</div>'; return; }
    const years = [...new Set(x.yb.map(r => r[1]))].sort((a, b) => b - a);
    if (!years.length) { box.innerHTML = '<div class="cov">No seasons in this competition yet.</div>'; return; }
    if (!years.includes(state.season)) state.season = years[0];
    const draw = () => {
      const y = state.season, S = (x.seasons || {})[String(y)] || {}, nameOf = i => pName(x, i), idOf = i => pId(x, i);
      const teamOf = id => ((c.players || {})[id] || (c.bowlers || {})[id] || {}).team;
      // runs and wickets leaders from the per-season totals
      const bat = x.yb.filter(r => r[1] === y).sort((a, b) => b[3] - a[3]).slice(0, 5);
      const bowl = x.yw.filter(r => r[1] === y).sort((a, b) => b[4] - a[4] || a[3] - b[3]).slice(0, 5);
      const six = x.yb.filter(r => r[1] === y).sort((a, b) => b[9] - a[9])[0];
      // standings from team results
      const stand = Object.entries(x.teams || {}).map(([t, d]) => { const r = (d.years || []).find(v => v[0] === y); return r ? { t, p: r[1], w: r[2], l: r[3] } : null; })
        .filter(Boolean).sort((a, b) => b.w - a.w || (b.w / b.p) - (a.w / a.p));
      // the champion: the final's winner, or the team with most wins where there is no final
      const allF = S.finals || (S.final ? [S.final] : []), finals = allF.filter(f => f.winner), F = finals[finals.length - 1];
      const tied = !F && allF.find(f => !f.winner && /tie/i.test(f.result || ''));
      let hero = '';
      if (tied) {
        hero = `<div class="sr-hero" style="--tc:#F2B24C"><span class="sr-trophy">${TROPHY_IC}</span><div class="sr-k">${tied.event ? esc(tied.event) + ' ' + y : y + ' final'}</div>
          <div class="sr-champ">${esc(tied.teams[0])} and ${esc(tied.teams[1])} tied the final</div>
          <div class="sr-how">${esc(tied.date)} · ${(tied.inns || []).length > 2 ? 'the super over was tied as well, so the title went on a boundary count, which the data does not record' : 'decided by a tie-break the data does not record'}.</div>
          <div class="sr-scores">${(tied.inns || []).map(i => `<span class="sr-sc"><i style="background:${teamColor(i[0]) || '#8B8E96'}"></i>${esc(i[0])} <b>${i[1]}/${i[2]}</b></span>`).join('')}</div></div>`;
      } else if (F) {
        const [i1, i2] = F.inns, win = F.winner, loser = F.teams.find(t => t !== win) || '';
        let margin = '';
        if (i1 && i2) margin = i2[0] === win ? `by ${10 - i2[2]} wicket${10 - i2[2] === 1 ? '' : 's'}` : `by ${i1[1] - i2[1]} run${i1[1] - i2[1] === 1 ? '' : 's'}`;
        const sc = (F.inns || []).map(i => `<span class="sr-sc"><i style="background:${teamColor(i[0]) || '#8B8E96'}"></i>${esc(i[0])} <b>${i[1]}/${i[2]}</b> <span class="dim">(${oversOf(i[3])})</span></span>`).join('');
        const link = (x.recent || []).some(r => r.id === F.id) ? goAttr('match', F.id) : '';
        const others = finals.slice(0, -1).map(o => `${esc(o.event || 'Final')}: <b>${esc(o.winner)}</b> beat ${esc(o.teams.find(t => t !== o.winner) || '')}`).join(' · ');
        hero = `<a class="sr-hero" style="--tc:${teamColor(win) || '#F2B24C'}" ${link}><span class="sr-trophy">${TROPHY_IC}</span>
          <div class="sr-k">${F.event ? esc(F.event) + ' ' + y : y + ' champions'}</div><div class="sr-champ">${esc(win)}</div>
          <div class="sr-how">Beat ${esc(loser)} ${margin} in the final · ${esc(F.date)}${F.venue ? ' · ' + esc(String(F.venue).split(',')[0]) : ''}</div><div class="sr-scores">${sc}</div>
          ${others ? `<div class="sr-how" style="margin-top:10px">Also won in ${y}: ${others}</div>` : ''}</a>`;
      } else if (stand.length) {
        const FMS = new Set(['Afghanistan', 'Australia', 'Bangladesh', 'England', 'India', 'Ireland', 'New Zealand', 'Pakistan', 'South Africa', 'Sri Lanka', 'West Indies', 'Zimbabwe']);
        const pool = stand.filter(s => s.p >= 5 && (!c.meta.intl || FMS.has(String(s.t).replace(/ Women$/, ''))));
        const top = (pool.length ? pool : stand).slice().sort((a, b) => b.w / b.p - a.w / a.p || b.w - a.w)[0];
        hero = `<div class="sr-hero" style="--tc:${teamColor(top.t) || '#F2B24C'}"><span class="sr-trophy">${TROPHY_IC}</span>
          <div class="sr-k">${y} · best record</div><div class="sr-champ">${esc(top.t)}</div>
          <div class="sr-how">Won ${top.w} of ${plural(top.p, 'match', 'matches')}${c.meta.intl ? '. No World Cup, Champions Trophy or Asia Cup final this year, so this is the full member with the best win rate (5+ matches).' : '.'}</div></div>`;
      }
      const lead = (title, rows, val, sub, bowler) => `<div class="panel s6"><h2>${title}</h2>${rows.map((r, i) => { const id = idOf(r[0]), nm = nameOf(r[0]);
        return `<div class="sr-row"><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span>${faceHTML(id, nm, 'md', teamOf(id))}<span class="sr-who">${pidLink(id, nm, bowler)}<span class="dim">${sub(r)}</span></span><b class="num">${val(r)}</b></div>`; }).join('') || '<span class="note">No data.</span>'}</div>`;
      const tile = (k, big, who, sub, pid, tm) => `<div class="s3"><div class="panel sr-tile">${pid ? faceHTML(pid, who, 'lg', tm) : ''}<div class="hx-k">${k}</div><div class="hx-big kpi-like">${big}</div><div class="hx-who">${esc(who)}</div><div class="hx-sub">${sub}</div></div></div>`;
      const T = (x.trend || []), C = x.trend_cols || [], col = k => C.indexOf(k), tr = T.find(r => r[col('yr')] === y);
      const rrAll = T.length ? 6 * T.reduce((a, r) => a + r[col('runs')], 0) / T.reduce((a, r) => a + r[col('balls')], 0) : null;
      const rrY = tr && tr[col('balls')] ? 6 * tr[col('runs')] / tr[col('balls')] : null;
      const tiles = [
        S.bi ? tile('Best innings', `${S.bi[1]} <small>(${S.bi[2]})</small>`, nameOf(S.bi[0]), `${esc(S.bi[3] || '')} vs ${esc(S.bi[4] || '')}`, idOf(S.bi[0]), S.bi[3]) : '',
        S.bs ? tile('Best spell', `${S.bs[1]}/${S.bs[2]}`, nameOf(S.bs[0]), `${esc(S.bs[4] ? 'vs ' + S.bs[5] : '')} · ${oversOf(S.bs[3])}`, idOf(S.bs[0]), S.bs[4]) : '',
        six && six[9] ? tile('Most sixes', six[9], nameOf(six[0]), `${six[3].toLocaleString()} runs in ${six[5]} innings`, idOf(six[0]), teamOf(idOf(six[0]))) : '',
        rrY ? tile('Scoring rate', rrY.toFixed(2), 'runs an over', rrAll ? `${rrY >= rrAll ? '+' : ''}${(rrY - rrAll).toFixed(2)} on the all-time ${rrAll.toFixed(2)}` : '', null) : '',
      ].join('');
      const stTable = stand.length ? `<div class="panel" style="margin-top:13px"><h2>Results table <span class="r">every match in ${y}, not only the league stage</span></h2><div class="tscroll"><table><thead><tr><th>#</th><th>Team</th><th class="n">P</th><th class="n">W</th><th class="n">L</th><th class="n">Win %</th></tr></thead><tbody>${stand.map((s, i) => `<tr><td class="dim">${i + 1}</td><td><span class="sr-dot" style="background:${faceCol(s.t)}"></span><a ${goAttr('team', s.t)}>${esc(s.t)}</a></td><td class="n">${s.p}</td><td class="n"><b>${s.w}</b></td><td class="n">${s.l}</td><td class="n">${Math.round(100 * s.w / s.p)}%</td></tr>`).join('')}</tbody></table></div></div>` : '';
      body.innerHTML = `${hero}<div class="grid bento" style="margin-top:13px">${tiles}</div>
        <div class="grid bento" style="margin-top:13px">${lead('Most runs', bat, r => r[3].toLocaleString(), r => `${r[5]} inns · SR ${r[2] ? (100 * r[3] / r[2]).toFixed(1) : '-'}`)}
        ${lead('Most wickets', bowl, r => r[4], r => `${r[2] ? oversOf(r[2]) + ' · ' : ''}econ ${r[2] ? (6 * r[3] / r[2]).toFixed(2) : '-'}`, true)}</div>${stTable}`;
      wireLinks(body);
    };
    const pick = $(`<div class="seasonpick">${years.map(v => `<button type="button" data-y="${v}" class="${v === state.season ? 'on' : ''}">${v}</button>`).join('')}</div>`);
    const body = $('<div></div>');
    pick.querySelectorAll('button').forEach(b => b.onclick = () => { state.season = +b.dataset.y; pick.querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b)); draw(); });
    box.appendChild(pick); box.appendChild(body); draw();
  });
}

/* ---------- Rivalries: one batter against one bowler, across every competition ---------- */
const _RIV = {}, _RIV_CB = {};
let _RIVN = null, _RIVN_CB = null;
window.__rivalsLoaded = (sh, d) => { _RIV[sh] = d; };
window.__rivalNames = d => { _RIVN = d; };
function ensureRivalNames(cb) {
  if (_RIVN) return cb(_RIVN);
  if (_RIVN_CB) { _RIVN_CB.push(cb); return; }
  _RIVN_CB = [cb]; const s = document.createElement('script'); s.src = 'rivals/names.js';
  const done = () => { const q = _RIVN_CB; _RIVN_CB = null; q.forEach(f => f(_RIVN)); }; s.onload = done; s.onerror = done; document.head.appendChild(s);
}
function ensureRivals(pid, cb) {
  const sh = _shardOf(pid);
  if (_RIV[sh]) return cb(_RIV[sh]);
  if (_RIV_CB[sh]) { _RIV_CB[sh].push(cb); return; }
  _RIV_CB[sh] = [cb]; const s = document.createElement('script'); s.src = 'rivals/' + sh + '.js';
  const done = () => { const q = _RIV_CB[sh]; delete _RIV_CB[sh]; q.forEach(f => f(_RIV[sh] || null)); }; s.onload = done; s.onerror = done; document.head.appendChild(s);
}
function rivalryView(app) {
  app.appendChild($(`<div><h1>Rivalries</h1><p class="sub">One batter against one bowler across every competition they have met in: internationals and leagues together, season by season. Pairs with ${30}+ balls between them.</p></div>`));
  const box = $('<div class="loadbox"><div class="spinner"></div><div>Loading rivalries…</div></div>'); app.appendChild(box);
  ensureRivalNames(N => {
    box.className = ''; box.innerHTML = '';
    if (!N) { box.innerHTML = '<div class="cov">Rivalries arrive with the next weekly data rebuild.</div>'; return; }
    const nm = id => N.n[id] || id;
    const allNames = Object.entries(N.n).map(([id, n]) => [n, id]).sort((a, b) => a[0].localeCompare(b[0]));
    const byName = Object.fromEntries(allNames);
    if (!state.rivBat) { const c = cur(), top = Object.entries(c.players || {}).sort((a, b) => (b[1].runs || 0) - (a[1].runs || 0))[0]; state.rivBat = top ? top[0] : allNames[0][1]; }
    const pick = $(`<div class="panel riv-pick"><div class="field"><span class="flab">Batter</span><div class="swrap2 ac" style="position:relative"><input id="rvb" placeholder="batter name…" autocomplete="off" value="${esc(nm(state.rivBat))}"/><div class="aclist" style="display:none"></div></div></div>
      <span class="riv-vs">vs</span><div class="field"><span class="flab">Bowler</span><div class="swrap2 ac" style="position:relative"><input id="rvw" placeholder="bowler name…" autocomplete="off"/><div class="aclist" style="display:none"></div></div></div></div>`);
    const body = $('<div style="margin-top:13px"></div>'); box.appendChild(pick); box.appendChild(body);
    const names = allNames.map(a => a[0]);
    const draw = () => ensureRivals(state.rivBat, D => {
      const mine = (D && D[state.rivBat]) || {};
      const opp = Object.entries(mine).map(([bw, recs]) => ({ bw, balls: recs.reduce((a, r) => a + r[2], 0), runs: recs.reduce((a, r) => a + r[3], 0), outs: recs.reduce((a, r) => a + r[4], 0), recs }))
        .sort((a, b) => b.balls - a.balls);
      if (!opp.length) { body.innerHTML = `<div class="cov">${esc(nm(state.rivBat))} has no bowler they have faced for 30+ balls.</div>`; return; }
      if (!state.rivBowl || !mine[state.rivBowl]) state.rivBowl = opp[0].bw;
      pick.querySelector('#rvw').value = nm(state.rivBowl);
      const R = opp.find(o => o.bw === state.rivBowl), bid = state.rivBat, wid = state.rivBowl;
      const sr = R.balls ? 100 * R.runs / R.balls : 0, avg = R.outs ? R.runs / R.outs : null, bpd = R.outs ? R.balls / R.outs : null;
      // who is on top: runs per dismissal against a par of 30, scaled by strike rate against 100 (simple, format-mixed)
      // red-ball cricket (Tests, first-class) is judged on average; white-ball on average and strike rate
      const red = /Tests|Championship|Shield|Trophy/;
      const redShare = R.recs.reduce((a, r) => a + (red.test(N.c[r[0]]) ? r[2] : 0), 0) / R.balls;
      const parAvg = 30 + 10 * redShare, parSR = 130 - 75 * redShare;
      const batEdge = Math.max(0.08, Math.min(0.92, 0.5 + (0.28 + 0.12 * redShare) * Math.tanh(((avg == null ? R.runs : avg) - parAvg) / 22)
        + (0.22 - 0.12 * redShare) * Math.tanh((sr - parSR) / 35)));
      const byComp = {}; R.recs.forEach(r => { const k = N.c[r[0]]; const v = byComp[k] = byComp[k] || [0, 0, 0, Infinity, 0]; v[0] += r[2]; v[1] += r[3]; v[2] += r[4]; v[3] = Math.min(v[3], r[1]); v[4] = Math.max(v[4], r[1]); });
      const byYear = {}; R.recs.forEach(r => { const v = byYear[r[1]] = byYear[r[1]] || [0, 0, 0]; v[0] += r[2]; v[1] += r[3]; v[2] += r[4]; });
      const yrs = Object.keys(byYear).map(Number).sort((a, b) => a - b), maxR = Math.max(...yrs.map(y => byYear[y][1]), 1);
      const W = CW(720), H = 190, pad = 34, bw = Math.min(46, (W - 2 * pad) / Math.max(yrs.length, 1) * 0.66);
      const X = i => pad + (i + 0.5) * (W - 2 * pad) / yrs.length, Y = v => H - pad - v / maxR * (H - 2 * pad - 10);
      const bars = yrs.map((y, i) => { const v = byYear[y]; return `<g><rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Y(v[1]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad - Y(v[1])).toFixed(1)}" rx="3" fill="#E59A2F" fill-opacity=".85"><title>${y}: ${v[1]} runs off ${v[0]} balls, out ${v[2]} time${v[2] === 1 ? '' : 's'}</title></rect>
        ${Array.from({ length: v[2] }, (_, k) => `<circle cx="${X(i).toFixed(1)}" cy="${(Y(v[1]) - 9 - k * 11).toFixed(1)}" r="4.2" fill="#E5484D"/>`).join('')}
        <text x="${X(i).toFixed(1)}" y="${H - pad + 14}" text-anchor="middle" fill="#8B8E96" font-size="9.5">'${String(y).slice(2)}</text></g>`; }).join('');
      const chart = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Runs and dismissals by season">${axisTicksSVG(null, Y, null, [0, maxR], [pad, pad, W - pad, H - pad])}${bars}</svg>`;
      const k = (l, v, s2) => `<div class="s3"><div class="panel kpi"><div class="l">${l}</div><div class="n">${v}</div>${s2 ? `<div class="s">${s2}</div>` : ''}</div></div>`;
      body.innerHTML = `<div class="riv-hero"><div class="riv-side">${faceHTML(bid, nm(bid), 'xl')}<div class="riv-nm">${pidLink(bid, nm(bid))}</div><div class="dim">batter</div></div>
          <div class="riv-mid"><div class="riv-vs2">vs</div><div class="riv-bar"><span style="width:${(100 * batEdge).toFixed(0)}%"></span></div>
          <div class="riv-edge">${batEdge > 0.58 ? esc(nm(bid)) + ' has the upper hand' : batEdge < 0.42 ? esc(nm(wid)) + ' has the upper hand' : 'Evenly matched'}</div></div>
          <div class="riv-side">${faceHTML(wid, nm(wid), 'xl')}<div class="riv-nm">${pidLink(wid, nm(wid), true)}</div><div class="dim">bowler</div></div></div>
        <div class="grid bento" style="margin-top:13px">${k('Balls', R.balls.toLocaleString(), `${Object.keys(byComp).length} competition${Object.keys(byComp).length === 1 ? '' : 's'}`)}${k('Runs', R.runs.toLocaleString(), `strike rate ${sr.toFixed(1)}`)}
          ${k('Dismissals', R.outs, bpd ? `one every ${bpd.toFixed(0)} balls` : 'never dismissed')}${k('Average', avg == null ? '-' : avg.toFixed(1), 'runs per dismissal')}</div>
        <div class="grid bento" style="margin-top:13px"><div class="panel s7"><h2>Season by season <span class="r">bars = runs · red dots = dismissals</span></h2>${chart}</div>
          <div class="panel s5"><h2>By competition</h2><div class="tscroll"><table><thead><tr><th>Competition</th><th class="n">Balls</th><th class="n">Runs</th><th class="n">Out</th><th class="n">SR</th></tr></thead><tbody>
          ${Object.entries(byComp).sort((a, b) => b[1][0] - a[1][0]).map(([cn, v]) => `<tr><td>${esc(cn)} <span class="dim">${v[3] === v[4] ? v[3] : v[3] + '–' + v[4]}</span></td><td class="n">${v[0]}</td><td class="n"><b>${v[1]}</b></td><td class="n">${v[2]}</td><td class="n">${v[0] ? (100 * v[1] / v[0]).toFixed(1) : '-'}</td></tr>`).join('')}</tbody></table></div></div></div>
        <div class="panel" style="margin-top:13px"><h2>${esc(nm(bid))}'s biggest rivalries <span class="r">bowlers faced most, all competitions</span></h2><div class="riv-list">
          ${opp.slice(0, 12).map(o => `<button type="button" class="riv-chip${o.bw === wid ? ' on' : ''}" data-bw="${esc(o.bw)}">${faceHTML(o.bw, nm(o.bw), 'sm')}<span>${esc(nm(o.bw))}</span><span class="dim">${o.runs}/${o.outs} · ${o.balls}b</span></button>`).join('')}</div></div>`;
      body.querySelectorAll('.riv-chip').forEach(b => b.onclick = () => { state.rivBowl = b.dataset.bw; draw(); });
      wireLinks(body);
    });
    autocomplete(pick.querySelector('#rvb'), names, n => { if (n && byName[n]) { state.rivBat = byName[n]; state.rivBowl = null; draw(); } });
    autocomplete(pick.querySelector('#rvw'), names, n => { if (n && byName[n]) { state.rivBowl = byName[n]; draw(); } });
    draw();
  });
}
window.EXTRA_VIEWS = { bowlto: app => withSince(bowlToView, app), matches: matchesView, trends: trendsView, season: seasonView, rivalry: rivalryView };
/* Matchups view: under "full members only" swap in the full-member pair list. */
const _matchupsView = matchupsView;
matchupsView = function (app) {
  const c = cur();
  if (c.meta.intl) setTimeout(() => { const h = app.querySelector('.sub'); if (h && !app.querySelector('.covnote')) h.insertAdjacentHTML('afterend', covNote(c, 'afg')); }, 0);
  if (!(state.fm && meta(c.meta.key).intl)) return _matchupsView(app);
  const intro = $(`<div><h1>Matchup Intelligence</h1><p class="sub">Any batter vs any bowler, <b>matches between full members only</b>. <span id="mucount" class="dim">Loading…</span></p></div>`);
  app.appendChild(intro);
  getMatchups(c, st => { if (state.view !== 'matchups' || cur() !== c || !intro.parentNode) return;
    const all = st.rows || c.matchups_top; intro.querySelector('#mucount').textContent = `${all.length.toLocaleString()} pairs with ${st.min}+ balls.`;
    const b = $(filterBanner()); intro.after(b); _wireClear(b); _matchupsBody(intro.parentNode, c, all, st.min || 12); });
};

/* ===================== home: last 30 days + milestones ===================== */
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + 's')}`;
const oversOf = balls => balls == null ? '' : `${Math.floor(balls / 6)}${balls % 6 ? '.' + balls % 6 : ''} ov`;
const _homeView = homeView;

/* ---------- Overview, livelier: photos, a big headline number, an at-a-glance strip ---------- */
function photoOf(pid, name) {
  const m = (window.CIL_PLAYERMETA || {})[pid] || {};
  return playerImg(name, m.name, pid) || m.photo || '';
}
/* a steady colour for teams without one of their own, picked from the name */
const _FACE_PAL = ['#60A5FA', '#F472B6', '#34D399', '#FBBF24', '#A78BFA', '#F87171', '#22D3EE', '#FB923C', '#4ADE80', '#C084FC'];
const faceCol = team => !team ? null : teamColor(team) || _FACE_PAL[[...String(team)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % _FACE_PAL.length];
const faceHTML = (pid, name, cls, team) => `<span class="face ${cls || ''}"${faceCol(team) ? ` style="--fc:${faceCol(team)}"` : ''}>${(() => { const u = photoOf(pid, name);
  return u ? `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"/>` : ''; })()}<i>${esc(initials(name))}</i></span>`;
const GLANCE_IC = {
  matches: '<path d="M4 20V10l8-6 8 6v10"/><path d="M9 20v-6h6v6"/>',
  runs: '<path d="M4 18 18 4"/><path d="m15 4 3 0 0 3"/><path d="M5 13l6 6"/>',
  sixes: '<circle cx="12" cy="12" r="8"/><path d="M8.5 6.5c2.2 2 3.3 3.8 3.3 5.5s-1.1 3.5-3.3 5.5M15.5 6.5c-2.2 2-3.3 3.8-3.3 5.5s1.1 3.5 3.3 5.5"/>',
  wkts: '<path d="M7 21V5M12 21V5M17 21V5"/><path d="M6 4.5h12"/>',
};
function glanceStrip(c, x) {
  const T = (x && x.trend) || [], C = (x && x.trend_cols) || [];
  if (!T.length) return null;
  const col = k => C.indexOf(k), sum = k => T.reduce((a, r) => a + (r[col(k)] || 0), 0);
  const last = T[T.length - 1], yr = last[col('yr')];
  const rr = last[col('balls')] ? (6 * last[col('runs')] / last[col('balls')]).toFixed(2) : null;
  const tiles = [
    ['matches', 'Matches', sum('matches').toLocaleString(), `${c.meta.coverage_from ? String(c.meta.coverage_from).slice(0, 4) : ''}–${yr}`, '#F2B24C'],
    ['runs', 'Runs scored', sum('runs').toLocaleString(), rr ? `${rr} an over in ${yr}` : '', '#6FA8FF'],
    ['sixes', 'Sixes hit', sum('sixes').toLocaleString(), `${last[col('sixes')].toLocaleString()} in ${yr}`, '#33D17A'],
    ['wkts', 'Wickets', sum('wkts').toLocaleString(), `${last[col('wkts')].toLocaleString()} in ${yr}`, '#FF6B7E'],
  ];
  return $(`<div class="glance">${tiles.map(([k, l, v, sub, colr]) => `<a class="gl-t" style="--gc:${colr}" ${goAttr('view', 'trends')}>
    <span class="gl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLANCE_IC[k]}</svg></span>
    <span class="gl-l">${l}</span><span class="gl-v kpi-like">${v}</span><span class="gl-s">${esc(sub)}</span></a>`).join('')}</div>`);
}
/* ---------- Today's discovery: a wide pool of finds, a fixed pick per day and competition ---------- */
const _hash = s => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
const _up = (a, b) => b ? Math.round(100 * a / b - 100) : 0;
function discoveries(c) {
  const lab = compLabel(c.meta), P = c.players || {}, BW = c.bowlers || {}, lim = c.meta.format !== 'test';
  const top = (k, f, d, need) => (_board(c, k, f, d, need) || [])[0];
  const out = [], add = (x, kind, o) => { if (x) out.push({ pid: x.pid, name: x.name, kind, field: o.field, ...o }); };
  let x, p;
  /* batting */
  if ((x = top('bat', 'collapse_resist', 'desc', 'collapse_balls')) && x.value > 105) { p = P[x.pid] || {};
    add(x, 'bat', { field: 'collapse_resist', tag: 'Collapse-proof', head: `${x.name} barely flinches in a collapse`, num: `+${x.value - 100}%`, unit: 'strike rate at 3+ down, vs their own norm',
      body: `Once the innings is 3 or more wickets down, ${x.name} scores at <b>${p.collapse_sr}</b> per 100 balls and averages <b>${p.collapse_avg}</b>, ${x.value - 100}% quicker than their usual rate. Nobody in ${lab} holds up better.`, conf: _conf(p.collapse_balls || 0, 800, 300) }); }
  if ((x = top('bat', 'pressure_sr', 'desc')) && (p = P[x.pid] || {}) && x.value > (p.sr || 0) * 1.05)
    add(x, 'bat', { field: 'pressure_sr', tag: 'Under pressure', head: `${x.name} speeds up when the chase gets steep`, num: `${Math.round(x.value)}`, unit: 'strike rate chasing a steep asking rate',
      body: `When the required rate climbs well above par, ${x.name} strikes at <b>${x.value}</b>, ${_up(x.value, p.sr)}% faster than their overall ${p.sr}. The best pressure strike rate in ${lab}.`, conf: _conf(p.pressure_balls || 0, 1500, 500) });
  if ((x = top('bat', 'era_index', 'desc')) && x.value > 105) { p = P[x.pid] || {};
    add(x, 'bat', { field: 'era_index', tag: 'Era-adjusted', head: `${x.name} towers over their era`, num: `+${x.value - 100}%`, unit: 'above the typical batter of the time',
      body: `Measured against batters of the same seasons, ${x.name} is <b>${x.value - 100}%</b> more productive: ${p.runs.toLocaleString()} runs at an average of ${p.avg} and a strike rate of ${p.sr}.`, conf: _conf(p.balls || 0, 3000, 1000) }); }
  if ((x = top('bat', 'win_sr_ratio', 'desc')) && x.value > 103) { p = P[x.pid] || {};
    add(x, 'bat', { field: 'win_sr_ratio', tag: 'Match-winner', head: `${x.name} shows up on the days that are won`, num: `+${x.value - 100}%`, unit: 'strike rate in wins',
      body: `In matches their side wins, ${x.name} strikes <b>${x.value - 100}% faster</b> than their overall ${p.sr}. The biggest winning-day gear change in ${lab}.`, conf: _conf(p.balls || 0, 2000, 700) }); }
  if ((x = top('bat', 'clutch_index', 'desc')) && x.value > 105) { p = P[x.pid] || {};
    add(x, 'bat', { field: 'clutch_index', tag: 'Knockouts', head: `${x.name} lifts in knockout games`, num: `+${x.value - 100}%`, unit: 'strike rate in knockouts',
      body: `In finals, semi-finals and other knockouts, ${x.name} scores <b>${x.value - 100}% faster</b> than their overall strike rate of ${p.sr}. Nobody in ${lab} rises to the big occasion more.`, conf: 'Medium' }); }
  if ((x = top('bat', 'partner_dep', 'asc')) && (p = P[x.pid] || {}).top_partner)
    add(x, 'bat', { field: 'partner_dep', tag: 'Self-reliant', head: `${x.name} doesn't need a favourite partner`, num: `${p.n_partners}`, unit: 'different batting partners',
      body: `Runs are spread across <b>${p.n_partners}</b> partners; even the most frequent, ${esc(p.top_partner)}, shared only ${p.top_partner_share}% of them. The least partner-dependent batter in ${lab}.`, conf: 'High' });
  if (lim && (x = top('bat', 'accel_index', 'desc')) && x.value > 1.2) { p = P[x.pid] || {};
    add(x, 'bat', { field: 'accel_index', tag: 'Accelerator', head: `${x.name} has the biggest top gear`, num: `${x.value}x`, unit: 'death-overs vs powerplay strike rate',
      body: `${x.name} scores <b>${x.value} times</b> as fast at the death as in the powerplay. Nobody in ${lab} shifts gears harder.`, conf: _conf(p.balls || 0, 2000, 700) }); }
  if ((x = top('bat', 'strike_rot', 'desc'))) { p = P[x.pid] || {};
    add(x, 'bat', { field: 'strike_rot', tag: 'Strike rotator', head: `${x.name} never lets the scoreboard stall`, num: `${x.value}%`, unit: 'of balls turned into 1s, 2s or 3s',
      body: `${x.name} runs on <b>${x.value}%</b> of the balls they face, and leave only ${p.dot_pct}% as dot balls. The busiest batter between the boundaries in ${lab}.`, conf: _conf(p.balls || 0, 2000, 700) }); }
  if ((x = top('bat', 'conversion', 'desc')) && (p = P[x.pid] || {}).hundreds >= 3)
    add(x, 'bat', { field: 'conversion', tag: 'Converter', head: `${x.name} turns starts into hundreds`, num: `${x.value}%`, unit: 'of fifty-plus scores go on to 100',
      body: `Of ${p.fifties + p.hundreds} fifty-plus scores, <b>${p.hundreds}</b> became hundreds (highest ${p.highest}). The best conversion rate in ${lab}.`, conf: _conf(p.innings || 0, 60, 25) });
  if ((x = top('bat', 'boundary_pct', 'desc'))) { p = P[x.pid] || {};
    add(x, 'bat', { field: 'boundary_pct', tag: 'Boundary hitter', head: `${x.name} lives in the boundary rope`, num: `${x.value}%`, unit: 'of balls hit for four or six',
      body: `One ball in ${Math.round(100 / x.value)} faced by ${x.name} goes to the rope, ${p.sixes.toLocaleString()} of them for six. ${p.boundary_dep}% of their runs come in boundaries.`, conf: _conf(p.balls || 0, 2000, 700) }); }
  /* bowling */
  if ((x = top('bowl', 'bowl_sr', 'asc'))) { p = BW[x.pid] || {};
    add(x, 'bowl', { field: 'bowl_sr', tag: 'Strike bowler', head: `${x.name} strikes faster than anyone`, num: `${x.value}`, unit: 'balls per wicket',
      body: `A wicket every <b>${x.value} balls</b>: ${p.wickets} in all at an average of ${p.bowl_avg}. The sharpest strike rate among frontline bowlers in ${lab}.`, conf: _conf(p.balls || 0, 2500, 900) }); }
  if ((x = top('bowl', 'economy', 'asc'))) { p = BW[x.pid] || {};
    add(x, 'bowl', { field: 'economy', tag: 'Economist', head: `${x.name} is the hardest to score off`, num: `${x.value}`, unit: 'runs an over',
      body: `${x.name} concedes just <b>${x.value} an over</b>, with ${p.dot_pct}% dot balls and ${p.wickets} wickets. The tightest frontline bowler in ${lab}.`, conf: _conf(p.balls || 0, 2500, 900) }); }
  if ((x = top('bowl', 'dot_pct', 'desc'))) { p = BW[x.pid] || {};
    add(x, 'bowl', { field: 'dot_pct', tag: 'Dot machine', head: `${x.name} builds pressure one dot at a time`, num: `${x.value}%`, unit: 'of deliveries are dot balls',
      body: `<b>${x.value}%</b> of ${x.name}'s deliveries go unscored, at an economy of ${p.economy}. Nobody in ${lab} strangles an innings more.`, conf: _conf(p.balls || 0, 2500, 900) }); }
  if ((x = top('bowl', 'era_index', 'desc')) && x.value > 110) { p = BW[x.pid] || {};
    add(x, 'bowl', { field: 'era_index', tag: 'Era-adjusted', head: `${x.name} outbowls their era`, num: `+${x.value - 100}%`, unit: 'better than the typical bowler of the time',
      body: `Against bowlers of the same seasons, ${x.name} comes out <b>${x.value - 100}%</b> better: ${p.wickets} wickets at ${p.bowl_avg}, conceding ${p.economy} an over.`, conf: _conf(p.balls || 0, 2500, 900) }); }
  if (lim) {
    const ph = (k, min) => Object.entries(BW).filter(([id, b]) => b.qualified && !_isId(b.name) && b.phases && b.phases[k] && b.phases[k].balls >= min);
    const death = ph('death', 240).sort((a, b) => a[1].phases.death.economy - b[1].phases.death.economy)[0];
    if (death) { const [id, b] = death, d = b.phases.death;
      add({ pid: id, name: b.name }, 'bowl', { field: 'economy', tag: 'Death bowler', head: `${b.name} holds their nerve at the death`, num: `${d.economy}`, unit: 'runs an over at the death',
        body: `In the final overs, when batters swing at everything, ${b.name} concedes only <b>${d.economy} an over</b> with ${d.dot_pct}% dots and ${d.wickets} wickets. The best death economy in ${lab}.`, conf: _conf(d.balls, 900, 360) }); }
    const pp = ph('powerplay', 120).sort((a, b) => b[1].phases.powerplay.wickets - a[1].phases.powerplay.wickets)[0];
    if (pp) { const [id, b] = pp, d = b.phases.powerplay;
      add({ pid: id, name: b.name }, 'bowl', { field: 'bowl_sr', tag: 'New-ball threat', head: `${b.name} owns the powerplay`, num: `${d.wickets}`, unit: 'powerplay wickets',
        body: `<b>${d.wickets} wickets</b> inside the fielding restrictions, more than anyone in ${lab}, at ${d.economy} an over.`, conf: _conf(d.balls, 900, 360) }); }
  }
  return out;
}
/* today's picks: a fixed order per day and competition, one find per player.
   In internationals, finds about full-member players lead so the card isn't mostly associates. */
const FULL_MEMBERS = new Set(['India', 'Australia', 'England', 'South Africa', 'New Zealand', 'Pakistan', 'Sri Lanka', 'West Indies', 'Bangladesh', 'Zimbabwe', 'Afghanistan', 'Ireland']);
const _dayPicks = {};
function dayPicks(c) {
  const seed = new Date().toISOString().slice(0, 10) + '|' + dataKey();
  if (_dayPicks[seed]) return _dayPicks[seed];
  const all = discoveries(c), good = all.filter(t => t.conf !== 'Low'), pool = good.length >= 4 ? good : all, seen = new Set();
  const fm = t => c.meta.intl && !FULL_MEMBERS.has((((t.kind === 'bowl' ? c.bowlers : c.players) || {})[t.pid] || {}).team) ? 1 : 0;
  return (_dayPicks[seed] = pool.map(t => [fm(t), _hash(seed + t.tag + t.kind), t]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(r => r[2])
    .filter(t => !seen.has(t.pid) && seen.add(t.pid)));
}
discovery = c => dayPicks(c)[0] || null;
function heroDress(app, c) {
  const hero = app.querySelector('.dhero'); if (!hero || hero.dataset.dressed) return; hero.dataset.dressed = '1';
  const d = hero._disc; if (!d || !d.pid) return;  // the same discovery the hero's text shows
  const bowl = d.kind === 'bowl', p = ((bowl ? c.bowlers : c.players) || {})[d.pid] || {}, name = p.name || d.name || '';
  hero.classList.add('dhero-x'); hero.style.setProperty('--tc', teamColor(p.team) || 'var(--fmt)');
  const lbl = hero.querySelector('.dh-lbl');
  if (lbl) lbl.textContent += ' · ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  hero.insertAdjacentHTML('beforeend', `<div class="dh-side">${faceHTML(d.pid, name, 'xl', p.team)}
    <div class="dh-stat"><span class="dh-num kpi-like">${esc(d.num)}</span><span class="dh-unit">${esc(d.unit)}</span></div></div>`);
  // the player's career line in this competition
  const fig = (v, l) => v == null ? '' : `<span class="dh-f"><b>${typeof v === 'number' ? v.toLocaleString() : esc(v)}</b>${l}</span>`;
  const line = bowl ? [fig(p.wickets, 'wkts'), fig(p.economy, 'econ'), fig(p.bowl_avg, 'avg'), fig(p.bowl_sr, 'SR'), fig(p.dot_pct != null ? p.dot_pct + '%' : null, 'dots')]
    : [fig(p.innings, 'inns'), fig(p.runs, 'runs'), fig(p.avg, 'avg'), fig(p.sr, 'SR'), fig(p.fifties != null ? `${p.fifties}/${p.hundreds}` : null, '50s/100s')];
  const who = [p.team, p.archetype].filter(Boolean).map(esc).join(' · ');
  // where they rank in the competition, as percentiles
  const T = bowl ? [['economy', 'Economy'], ['bowl_sr', 'Strike rate'], ['dot_pct', 'Dot balls'], ['era_index', 'vs their era']]
    : [['avg', 'Average'], ['sr', 'Strike rate'], [d.field, d.tag], ['boundary_pct', 'Boundaries'], ['consistency', 'Consistency']];
  const seen = new Set(), bars = T.filter(([k]) => p.pct && p.pct[k] != null && !seen.has(k) && seen.add(k)).slice(0, 3);
  hero.insertAdjacentHTML('beforeend', `<div class="dh-detail">
    ${who ? `<div class="dh-who">${who}</div>` : ''}<div class="dh-line">${line.join('')}</div>
    ${bars.length ? `<div class="dh-bars">${bars.map(([k, l]) => `<div class="dh-bar"><span class="dh-bl">${esc(l)}</span><span class="dh-bt"><i style="width:${p.pct[k]}%"></i></span><span class="dh-bv">better than ${Math.round(p.pct[k])}%</span></div>`).join('')}</div>` : ''}</div>`);
  // more finds from today's list
  const more = dayPicks(c).slice(1, 4);
  if (more.length) {
    const el = $(`<div class="dh-more"><div class="dh-mlbl">More finds today</div><div class="dh-mgrid">${more.map(t => { const q = ((t.kind === 'bowl' ? c.bowlers : c.players) || {})[t.pid] || {};
      return `<a class="dh-mc" data-pid="${t.pid}">${faceHTML(t.pid, t.name, 'md', q.team)}<span class="dh-mt"><span class="dh-mtag">${esc(t.tag)}</span><span class="dh-mh">${esc(t.head)}</span></span><b class="dh-mn">${esc(t.num)}</b></a>`; }).join('')}</div></div>`);
    el.querySelectorAll('.dh-mc').forEach(a => a.onclick = e => { e.stopPropagation(); state.player = a.dataset.pid; render(); });
    hero.appendChild(el);
  }
}
homeView = function (app) {
  _homeView(app);
  heroDress(app, cur());
  const c = cur(), key = c.meta.key, slot = $('<div class="grid bento homex" style="margin-top:13px"></div>');
  const first = app.firstElementChild; if (first && first.nextSibling) app.insertBefore(slot, first.nextSibling); else app.appendChild(slot);
  slot.before($(`<div style="margin-top:10px">${covNote(c, 'site')}</div>`));
  ensureExtras(key, x => {
    if (!x || dataKey() !== key) { slot.remove(); return; }
    { const g = glanceStrip(c, x), hero = app.querySelector('.dhero'); if (g && hero && !app.querySelector('.glance')) { hero.after(g); wireLinks(g); } }
    // "Full members only" also applies here: keep performances where both sides are full members
    const fmOn = !!(state.fm && x.fm), FM = new Set(fmOn ? x.fm.teams : []);
    const keep = r => !fmOn || (FM.has(r[4]) && FM.has(r[6]));
    const wk = x.week;
    const inns = wk ? wk.innings.filter(keep) : [], spells = wk ? wk.spells.filter(keep) : [];
    if (inns.length || spells.length) {
      const bi = inns[0], bs = spells[0];
      const tile = (k, big, small, who, sub, mid, wkCol, pi, tm) => `<a class="hx-tile" ${goAttr('match', mid)}>${pi != null ? faceHTML(pId(x, pi), who, 'lg', tm) : ''}<div class="hx-k">${k}</div>
        <div class="hx-big" style="color:${wkCol ? 'var(--wk)' : 'var(--accent2)'}">${big}${small ? ` <small>${small}</small>` : ''}</div>
        <div class="hx-who">${esc(who)}</div><div class="hx-sub">${sub}</div></a>`;
      const rows = [...inns.slice(1, 5).map(r => ({ r, bat: 1 })), ...spells.slice(1, 5).map(r => ({ r, bat: 0 }))];
      slot.appendChild($(`<div class="panel s6 hx-recent"><h2>Last 30 days <span class="r">${esc(wk.from)} to ${esc(wk.to)} · ${plural(wk.matches, 'match', 'matches')}${fmOn ? ' · full members' : ''}</span></h2>
        <div class="hx-feat">
          ${bi ? tile('Top innings', bi[1], `(${bi[2]})`, pName(x, bi[0]), `vs ${esc(bi[4] || '')} · SR ${bi[2] ? (100 * bi[1] / bi[2]).toFixed(0) : '-'}`, bi[5], false, bi[0], bi[6]) : ''}
          ${bs ? tile('Best spell', `${bs[1]}/${bs[2]}`, '', pName(x, bs[0]), `vs ${esc(bs[4] || '')}${bs[7] != null ? ' · ' + oversOf(bs[7]) : ''}`, bs[5], true, bs[0], bs[6]) : ''}
        </div>
        ${rows.map(({ r, bat }) => `<a class="hx-row" ${goAttr('match', r[5])}><span>${faceHTML(pId(x, r[0]), pName(x, r[0]), 'sm', r[6])}<span class="hx-tag${bat ? '' : ' wk'}">${bat ? 'bat' : 'bowl'}</span>${esc(pName(x, r[0]))} <span class="dim">vs ${esc(r[4] || '')}</span></span>
          <b>${bat ? `${r[1]} <span class="dim">(${r[2]})</span>` : `${r[1]}/${r[2]}`}</b></a>`).join('')}</div>`));
    }
    if (fmOn) fmTrending(app, c, x);
    // milestone watch: active players (played in the last two seasons) close to a round number
    const lastY = +String(c.meta.coverage_to || '').slice(0, 4), RUN = 1000, WKS = c.meta.format === 'test' ? 100 : 50;
    const active = rows => rows && rows.some(r => r[1] >= lastY - 1);
    const near = [];
    // totals: all matches, or only matches between full members when that filter is on
    const S = scopeRows(x), tot = (rows, i) => (rows || []).reduce((a, r) => a + r[i], 0);
    for (const id in c.players) { const p = c.players[id], have = fmOn ? tot(S.byB[id], 3) : p.runs;
      if (have < RUN * 0.75 || !active(x._byB[id])) continue;
      const next = (Math.floor(have / RUN) + 1) * RUN, need = next - have; if (need <= RUN * 0.2) near.push({ id, name: p.name, have, need, next, unit: 'run', r: need / RUN }); }
    for (const id in (c.bowlers || {})) { const b = c.bowlers[id], have = fmOn ? tot(S.byW[id], 4) : b.wickets;
      if (have < WKS * 0.75 || !active(x._byW[id])) continue;
      const next = (Math.floor(have / WKS) + 1) * WKS, need = next - have; if (need <= WKS * 0.2) near.push({ id, name: b.name, have, need, next, unit: 'wicket', r: need / WKS, bowler: 1 }); }
    near.sort((a, b) => a.r - b.r);
    if (near.length) slot.appendChild($(`<div class="panel s6 hx-mile"><h2>Milestone watch <span class="r">active in ${lastY - 1} or ${lastY}${fmOn ? ' · vs full members' : ''}</span></h2>
      ${near.slice(0, 5).map(n => `<div class="hx-ms">${faceHTML(n.id, n.name, 'md', ((c.players || {})[n.id] || (c.bowlers || {})[n.id] || {}).team)}<div class="hx-msb"><div class="top">${pidLink(n.id, n.name, n.bowler)}<span class="dim"><b style="color:var(--ink)">${n.have.toLocaleString()}</b> / ${n.next.toLocaleString()} ${n.unit}s</span></div>
        <div class="hx-bar${n.bowler ? ' wk' : ''}"><span style="width:${(100 * n.have / n.next).toFixed(1)}%"></span></div>
        <div class="hx-go">${plural(n.need, n.unit)} to go</div></div></div>`).join('')}
      <div class="note" style="margin-top:8px">Counts are within ${esc(c.meta.label)}${fmOn ? ', matches between full members only' : ''}.</div></div>`));
    if (!slot.children.length) slot.remove(); else wireLinks(slot);
  });
};

/* "Full members only" on the Overview: rebuild Trending research from the full-member scope.
   Clutch index and collapse resistance come from fm.adv (computed in extras.py), strike
   bowlers from the filtered cohort. Trait cards below stay all-matches and say so. */
function fmTrending(app, c, x) {
  const trend = app.querySelector('.trend'); if (!trend || !x.fm || !x.fm.adv) return;
  const minB = c.meta.rate_min_bat || 60, minK = c.meta.format === 'test' ? 120 : 30;
  const nameOf = i => pName(x, i), idOf = i => pId(x, i);
  const ratio = (num, den) => Math.round(100 * num / den);
  const clutch = x.fm.adv.filter(r => r[1] >= minB && r[3] >= minK && r[2]).map(r => ({ id: idOf(r[0]), name: nameOf(r[0]), v: ratio(r[4] / r[3], r[2] / r[1]) }));
  const coll = x.fm.adv.filter(r => r[1] >= minB && r[5] >= minK && r[2]).map(r => ({ id: idOf(r[0]), name: nameOf(r[0]), v: ratio(r[6] / r[5], r[2] / r[1]) }));
  const f = filteredCohort(c, x, state.since || 0, true);
  const sb = Object.entries(f.bowlers).filter(([, b]) => b.balls >= 3 * (c.meta.rate_min_bowl || 60) && b.bowl_sr).map(([id, b]) => ({ id, name: b.name, v: b.bowl_sr, bowler: 1 }));
  const top = (arr, asc) => arr.sort((p, q) => asc ? p.v - q.v : q.v - p.v).slice(0, 5);
  const cols = trend.querySelectorAll('.trcol');
  [[top(clutch)], [top(coll)], [top(sb, true)]].forEach(([rows], k) => {
    const col = cols[k]; if (!col) return;
    col.querySelectorAll('.trrow').forEach(r => r.remove());
    col.insertAdjacentHTML('beforeend', rows.map((r, i) => `<div class="trrow"><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span>${pidLink(r.id, r.name, r.bowler)}<b class="num">${r.v}</b></div>`).join('') || '<span class="note">Not enough full-member data.</span>');
  });
  const head = trend.parentNode.querySelector('.sechead');
  if (head && !head.querySelector('.fmtag')) head.insertAdjacentHTML('beforeend', ' <span class="dim fmtag">· matches between full members</span>');
  const traits = [...app.querySelectorAll('.sechead')].find(h => /Explore by trait/.test(h.textContent));
  if (traits && !traits.querySelector('.fmtag')) traits.insertAdjacentHTML('beforeend', ' <span class="dim fmtag">· all matches</span>');
  wireLinks(trend);
}

/* ===================== global search across competitions ===================== */
const _setupSearch = setupSearch;
setupSearch = function () {
  _setupSearch();
  const inp = document.getElementById('search'), res = document.getElementById('searchAc'); if (!inp) return;
  inp.addEventListener('focus', () => ensurePlayers(() => {}), { once: true });
  const orig = inp.oninput;
  inp.oninput = () => {
    orig && orig();
    const q = inp.value.toLowerCase().trim(); if (q.length < 3) return;
    ensurePlayers(ix => {
      if (!ix || inp.value.toLowerCase().trim() !== q) return;
      const here = cur() && cur().players || {}, out = [];
      for (const pid in ix.p) { const e = ix.p[pid]; if (here[pid] || !e[0].toLowerCase().includes(q)) continue;
        const best = e[1].slice().sort((a, b) => (b[1] + b[2] * 25) - (a[1] + a[2] * 25))[0]; if (!best) continue;
        out.push([e[0], pid, ix.k[best[0]], best[1] + best[2] * 25, best[2] > 0 && !best[1]]); if (out.length > 40) break; }
      out.sort((a, b) => b[3] - a[3]);
      if (!out.length) return;
      res.querySelectorAll('.muted, .sr-x').forEach(m => m.remove()); // a repeated query must not append twice
      res.insertAdjacentHTML('beforeend', out.slice(0, 6).map(o => `<div class="sr sr-x" data-pid="${esc(o[1])}" data-k="${esc(o[2])}" data-b="${o[4] ? 1 : 0}"><span class="srt">OTHER</span>${esc(o[0])} <span class="dim">· ${esc(cohortLabel(o[2]))}</span></div>`).join(''));
      res.style.display = 'block';
      res.querySelectorAll('.sr-x').forEach(d => d.onclick = () => { res.style.display = 'none'; inp.value = '';
        state.cohort = d.dataset.k; state.player = d.dataset.b === '1' ? null : d.dataset.pid; state.bowler = d.dataset.b === '1' ? d.dataset.pid : null;
        state.venue = state.team = state.match = null; render(); });
    });
  };
};
const _buildPaletteIndex = buildPaletteIndex;
buildPaletteIndex = function () {
  const items = _buildPaletteIndex();
  items.push({ t: 'view', k: 'bowlto', label: 'Who should bowl to…', sub: 'Analyze' }, { t: 'view', k: 'matches', label: 'Matches', sub: 'Analyze' });
  return items;
};

/* ===================== records: category filter ===================== */
const REC_CAT = {
  batting: ['Most Runs', 'Most Hundreds', 'Most Fifties', 'Most Sixes', 'Most Innings', 'Highest Average', 'Highest Strike Rate',
    'Most Consistent', 'Best Conversion %', 'Best Chase Average', 'Best Death-overs SR', 'Top Partnerships'],
  bowling: ['Most Wickets', 'Best Economy', 'Best Bowling SR', 'Highest Dot % (bowl)', 'Best Era-Adjusted (bowl)', 'Best Bowling Spells', 'Bowling outliers'],
  advanced: ['Best Era-Adjusted Index', 'Best Strike Rotation %', 'Best Acceleration Index', 'Best Pressure SR (chase)', 'Best Clutch Index',
    'Best Collapse Resistance', 'Most Self-Reliant (partners)', 'Batting outliers'],
};
const _recordsView = recordsView;
recordsView = function (app) {
  _recordsView(app);
  const grid = [...app.querySelectorAll('.grid.bento')].find(g => g.querySelector('.panel h2')); if (!grid) return;
  const cards = [...grid.children].map(el => { const h = el.querySelector('h2'); const t = h ? [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : '';
    const cat = Object.keys(REC_CAT).find(k => REC_CAT[k].includes(t)) || 'advanced'; return { el, cat }; });
  const count = k => k === 'all' ? cards.length : cards.filter(c => c.cat === k).length;
  const chips = $(`<div class="recchips" role="group" aria-label="Record type">${[['batting', 'Batting'], ['bowling', 'Bowling'], ['advanced', 'Advanced'], ['all', 'All']]
    .filter(([k]) => count(k)).map(([k, l]) => `<button data-k="${k}">${l} <span class="dim">${count(k)}</span></button>`).join('')}</div>`);
  grid.before(chips);
  const apply = k => { state.recCat = k; chips.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.k === k); b.setAttribute('aria-pressed', b.dataset.k === k); });
    cards.forEach(c => { c.el.style.display = k === 'all' || c.cat === k ? '' : 'none'; }); };
  apply(count(state.recCat || 'batting') ? (state.recCat || 'batting') : 'all');
  chips.querySelectorAll('button').forEach(b => b.onclick = () => apply(b.dataset.k));
};

/* ===================== compare: mark the better value in each row ===================== */
const LOWER_BETTER = new Set(['dot %', 'economy', 'bowl sr']);
function decorateCompare(root) {
  root.querySelectorAll('table').forEach(t => {
    const th = t.querySelector('thead th'); if (!th || th.textContent.trim().toLowerCase().indexOf('metric') !== 0 || t.dataset.cmp === String(t.rows.length)) return;
    t.dataset.cmp = String(t.rows.length);
    t.querySelectorAll('tbody tr').forEach(tr => {
      const cells = [...tr.cells].slice(1), vals = cells.map(td => parseFloat(td.textContent.replace(/,/g, '')));
      cells.forEach(td => td.classList.remove('best'));
      if (cells.length < 2 || vals.some(v => !isFinite(v))) return;
      const low = LOWER_BETTER.has(tr.cells[0].textContent.trim().toLowerCase()), best = low ? Math.min(...vals) : Math.max(...vals);
      if (vals.filter(v => v === best).length === vals.length) return;
      cells.forEach((td, i) => { if (vals[i] === best) td.classList.add('best'); });
    });
  });
}

/* ===================== data coverage notes (what Cricsheet does and doesn't include) ===================== */
const CS_MISSING = 'https://cricsheet.org/missing/';
const CS_AFG = 'https://cricsheet.org/article/explanation-for-withholding-of-afghanistani-matches/';
const covLink = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const COV_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
/* One short line; `kind` picks which gaps matter where it's shown. */
function covNote(c, kind) {
  const m = c.meta, intl = !!m.intl, female = m.gender === 'female';
  const bits = [];
  if (kind === 'site') {
    bits.push(`Ball-by-ball data from ${covLink('https://cricsheet.org', 'Cricsheet')}: men's internationals from 2001, women's from 2003, leagues from their first covered season.`);
    bits.push(`Cricsheet withholds every match involving Afghanistan (${covLink(CS_AFG, 'a protest over Afghan women’s cricket')}) and is missing some games (${covLink(CS_MISSING, 'list')}), so totals can be lower than official career figures.`);
  } else if (kind === 'profile') {
    bits.push(intl ? `Totals cover ${esc(m.label)} in Cricsheet's data only: no matches against Afghanistan (${covLink(CS_AFG, 'withheld')}) and none Cricsheet is ${covLink(CS_MISSING, 'missing')}, so they can be below official figures.`
      : `Totals cover the ${esc(m.label)} seasons in Cricsheet's data; a few matches are ${covLink(CS_MISSING, 'missing')}.`);
  } else if (kind === 'early') {
    bits.push(`This career started before ball-by-ball coverage (${female ? '2003' : '2001'} for internationals), so earlier matches aren't included.`);
  } else if (kind === 'afg') {
    bits.push(`Matches against Afghanistan aren't included: Cricsheet ${covLink(CS_AFG, 'withholds them')} as a protest over Afghan women's cricket.`);
  }
  return `<div class="covnote">${COV_ICON}<span>${bits.join(' ')}</span></div>`;
}
/* Started before coverage = their first season in the data is the cohort's first (Tests/ODIs only;
   T20Is and leagues began inside the coverage window). */
function startedBeforeCoverage(c, x, pid, bowler) {
  if (!x || !c.meta.intl || c.meta.format === 't20') return false;
  const rows = (bowler ? x._byW : x._byB)[pid]; if (!rows || !rows.length) return false;
  const first = Math.min(...rows.map(r => r[1])), start = +String(c.meta.coverage_from || '').slice(0, 4);
  return first <= start + 1;
}
const _coverageBanner = coverageBanner;
coverageBanner = function () { return `<div>${_coverageBanner()}${covNote(cur(), 'site')}</div>`; }; // callers keep only the first element

/* ===================== metric explanations ===================== */
const GLOSSARY = {
  'era index': "Runs compared with what an average batter would score on the same balls in the same seasons. 100 = par for their era; 120 = 20% better.",
  'era-adjusted index': "Runs compared with what an average batter would score on the same balls in the same seasons. 100 = par for their era; 120 = 20% better.",
  'era': "Era-adjusted index: 100 = par for the seasons they played in; higher is better.",
  'consistency': "How steady their innings scores are: 100 minus the spread of their scores relative to their average. Higher = fewer boom-or-bust innings.",
  'conversion': "Of their 50+ scores, the share turned into hundreds.",
  'conversion %': "Of their 50+ scores, the share turned into hundreds.",
  'clutch index': "Strike rate in knockout matches compared with their overall strike rate (×100). Above 100 = they score faster when it matters.",
  'acceleration index': "Death-overs strike rate divided by powerplay strike rate. Above 1 = they speed up late.",
  'pressure sr': "Strike rate while chasing when the required rate is at least 15% above the format's normal scoring rate.",
  'collapse resistance': "Strike rate once 3+ (T20) or 4+ (ODI/Test) wickets are down, compared with their overall strike rate (×100).",
  'partnership dependence': "How concentrated their runs are with particular partners (Herfindahl index). Lower = scores with anyone.",
  'win-sr ratio': "Strike rate in matches their team won, compared with overall (×100).",
  'strike rotation %': "Share of balls turned into 1s, 2s or 3s.",
  'rot%': "Strike rotation: share of balls turned into 1s, 2s or 3s.",
  'runs/scoring': "Average runs per scoring shot (ignores dot balls).",
  'boundary %': "Share of balls faced that went for four or six.",
  'bnd%': "Share of balls that went for four or six.",
  'dot %': "Share of balls with no run scored.",
  'dot%': "Share of balls with no run scored.",
  'dot % (inv)': "Share of balls with no run scored. Percentile is inverted: fewer dots ranks higher.",
  'dom': "Dominance (0 to 1): who wins the matchup. Above 0.55 = the batter is on top, below 0.45 = the bowler is, after pulling small samples toward 0.5.",
  'dominance': "Who wins the matchup, 0 to 1. Above 0.55 = the batter is on top, below 0.45 = the bowler is, after pulling small samples toward 0.5.",
  'percentile ranks': "Where the player ranks among rated players in this competition: 90 = better than 90% of them.",
  'percentile profile': "The same percentiles drawn as a shape: bigger = better all round.",
  'aggressor': "Archetype: top-30% strike rate and boundary rate.",
  'anchor': "Archetype: high average (top 30%) at a below-median strike rate.",
  'finisher': "Archetype: fast scorer who keeps it up at the death.",
  'accumulator': "Archetype: above-average both in average and strike rate.",
  'rotator': "Archetype: everyone else; keeps the score moving without standing out on one axis.",
  'strike bowler': "Takes wickets often: strike rate in the top 30% of rated bowlers.",
  'holder': "Keeps runs down: economy in the top 30% of rated bowlers.",
  'powerplay specialist': "Bowls 45%+ of their balls in the powerplay with a decent economy.",
  'death specialist': "Bowls 30%+ of their balls at the death with a decent economy.",
  'workhorse': "Bowls across the innings without a stand-out percentile.",
};
let _glPop = null;
function glPop(btn, text) {
  if (!_glPop) { _glPop = document.createElement('div'); _glPop.className = 'glpop'; _glPop.setAttribute('role', 'tooltip'); document.body.appendChild(_glPop); }
  _glPop.textContent = text; _glPop.style.display = 'block';
  const r = btn.getBoundingClientRect(), pw = Math.min(300, window.innerWidth - 20);
  _glPop.style.width = pw + 'px';
  _glPop.style.left = Math.max(10, Math.min(window.innerWidth - pw - 10, r.left + r.width / 2 - pw / 2)) + 'px';
  _glPop.style.top = (r.bottom + 8 + window.scrollY) + 'px';
}
function glHide() { if (_glPop) _glPop.style.display = 'none'; }
document.addEventListener('click', e => { if (!e.target.closest('.gl')) glHide(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') glHide(); });
function decorateGlossary(root) {
  root.querySelectorAll('.kpi .l, th, h2, .pctrow .k, .flab').forEach(el => {
    if (el.querySelector('.gl') || el.closest('.gl')) return;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim().toLowerCase();
    const def = GLOSSARY[own]; if (!def) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'gl'; b.textContent = '?';
    b.setAttribute('aria-label', 'What is ' + own + '?');
    b.onmouseenter = () => glPop(b, def); b.onmouseleave = glHide; b.onfocus = () => glPop(b, def); b.onblur = glHide;
    b.onclick = e => { e.stopPropagation(); e.preventDefault(); _glPop && _glPop.style.display === 'block' && _glPop.textContent === def ? glHide() : glPop(b, def); };
    const firstEl = [...el.childNodes].find(n => n.nodeType === 1 && n.classList && (n.classList.contains('r') || n.classList.contains('gl')));
    el.insertBefore(b, firstEl || null);
  });
}

/* ===================== wiring ===================== */
const _paint = paint;
paint = function (app) {
  if (!(state.view === 'matches' && state.match)) INN_COL = INN_COL_DEFAULT.slice();
  _paint(app);
  if (state.fm && meta(state.cohort).intl && state.view !== 'live' && state.view !== 'schedule') {
    const c = cur(), ok = c && c.meta && c.meta.fm;
    app.insertBefore($(`<div class="covnote fmnote">${COV_ICON}<span>${ok ? `<b>Full members only:</b> every number on this page counts only matches between the 12 ICC full members (${c.meta.matches.toLocaleString()} of ${(meta(state.cohort).matches || 0).toLocaleString()} matches).`
      : 'Full-members data for this competition arrives with the next weekly data rebuild, so this page shows all matches.'}</span></div>`), app.firstChild);
  }
  window._syncSince && window._syncSince();
  decorateGlossary(app); decorateCompare(app);
};
{
  // late-arriving panels (career, matchups, extras) get explanations too
  let t = 0;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { const a = document.getElementById('app'); if (a) { decorateGlossary(a); decorateCompare(a); } }, 120); })
    .observe(document.getElementById('app'), { childList: true, subtree: true });
}
const _init = init;
init = function () {
  _init();
  mountSinceControl(); window._syncSince && window._syncSince();
  // phones: search hides behind a button so the header stays two rows tall
  const cbar = document.querySelector('header .cbar'), hdr = document.querySelector('header');
  if (cbar && !cbar.querySelector('.hsearch-btn')) {
    const sb = document.createElement('button'); sb.type = 'button'; sb.className = 'hsearch-btn'; sb.setAttribute('aria-label', 'Search');
    sb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>';
    sb.onclick = () => { const on = hdr.classList.toggle('searching'); sb.setAttribute('aria-expanded', on);
      if (on) { const i = document.getElementById('search'); i && i.focus(); } setH(); };
    cbar.appendChild(sb);
    const fb = document.createElement('button'); fb.type = 'button'; fb.className = 'hfilter-btn'; fb.setAttribute('aria-label', 'Filters');
    fb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg><span class="fdot"></span>';
    fb.onclick = () => { const on = hdr.classList.toggle('filtering'); fb.setAttribute('aria-expanded', on);
      if (on) { hdr.classList.remove('searching'); sb.setAttribute('aria-expanded', false); } setH(); };
    const sbClick = sb.onclick;
    sb.onclick = () => { hdr.classList.remove('filtering'); fb.setAttribute('aria-expanded', false); sbClick(); };
    cbar.insertBefore(fb, sb);
    fb.insertAdjacentHTML('beforeend', '<span class="fl">Filters</span>');
    // phones: search lives in the bottom tab bar as a fifth tab
    const mb = document.getElementById('modebar');
    if (mb && !mb.querySelector('.srchtab')) {
      const st = document.createElement('button'); st.type = 'button'; st.className = 'modebtn srchtab'; st.setAttribute('aria-label', 'Search');
      st.innerHTML = '<span class="mb-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg></span><span class="mb-l">Search</span>';
      st.onclick = () => { sb.onclick(); if (hdr.classList.contains('searching')) window.scrollTo({ top: 0 }); };
      mb.appendChild(st);
    }
  }
  const setH = () => document.documentElement.style.setProperty('--hdr', (document.querySelector('header') || {}).offsetHeight + 'px');
  setH(); window.addEventListener('resize', setH);
};

/* Phones: the filter row (time window, full members) tucks away while scrolling down and comes
   back on the way up, so the sticky header doesn't take a fifth of the screen. */
(function () {
  let lastY = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY, hf = document.getElementById('sinceHost');
    if (!hf) return;
    const tuck = window.innerWidth < 640 && y > 160 && y > lastY + 4;
    if (tuck) hf.classList.add('tucked'); else if (y < lastY - 4 || y <= 160) hf.classList.remove('tucked');
    lastY = y;
  }, { passive: true });
})();
// tap a clamped coverage note to read all of it (phones); links inside still work
document.addEventListener('click', e => {
  const n = e.target.closest('.covnote'); if (!n || e.target.closest('a') || window.innerWidth >= 640) return;
  n.classList.toggle('open');
});

/* ---------- Motion: big numbers count up and charts draw themselves in when they come into view ----------
   Skipped entirely for people who ask their system for reduced motion. */
(function () {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  const NUM = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/;
  function countUp(el) {
    if (el.dataset.counted || el.children.length) return; el.dataset.counted = '1';
    const raw = el.textContent.trim(), m = NUM.exec(raw); if (!m) return;
    const target = parseFloat(m[2].replace(/,/g, '')); if (!isFinite(target) || Math.abs(target) < 2) return;
    const dec = (m[2].split('.')[1] || '').length, comma = m[2].includes(','), t0 = performance.now(), dur = 700;
    const fmt = v => { let s = v.toFixed(dec); if (comma) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); return m[1] + s + m[3]; };
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(target * e); if (k < 1) requestAnimationFrame(step); else el.textContent = raw; };
    requestAnimationFrame(step);
  }
  function drawIn(svg) {
    if (svg.dataset.drawn) return; svg.dataset.drawn = '1';
    svg.querySelectorAll('polyline').forEach(pl => {
      let len = 0; try { len = pl.getTotalLength(); } catch (e) { return; }
      if (!len || len < 40) return;
      pl.style.strokeDasharray = len; pl.style.strokeDashoffset = len;
      pl.getBoundingClientRect();
      pl.style.transition = 'stroke-dashoffset .9s cubic-bezier(.3,.7,.2,1)'; pl.style.strokeDashoffset = 0;
      setTimeout(() => { pl.style.strokeDasharray = ''; pl.style.strokeDashoffset = ''; pl.style.transition = ''; }, 1000);
    });
    const bars = [...svg.querySelectorAll('rect')].filter(r => +r.getAttribute('height') > 2 && +r.getAttribute('width') < 80);
    if (bars.length >= 3) bars.forEach((r, i) => { r.classList.add('bar-grow'); r.style.animationDelay = Math.min(i * 18, 360) + 'ms'; });
  }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    if (e.target.tagName.toLowerCase() === 'svg') drawIn(e.target); else countUp(e.target);
  }), { threshold: 0.25 });
  const scan = root => {
    root.querySelectorAll('.kpi .n, .hx-big, .kpi-like').forEach(el => { if (!el.dataset.counted) io.observe(el); });
    root.querySelectorAll('svg[role="img"]').forEach(svg => { if (!svg.dataset.drawn) io.observe(svg); });
  };
  const app = document.getElementById('app'); if (!app) return;
  let pend = 0;
  new MutationObserver(() => { if (pend) return; pend = requestAnimationFrame(() => { pend = 0; scan(app); }); })
    .observe(app, { childList: true, subtree: true });
  scan(app);
})();
