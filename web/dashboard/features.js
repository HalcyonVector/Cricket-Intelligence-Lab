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
const xNow = () => { const x = _X[state.cohort]; return x && !x._missing ? x : null; };
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
      render(); };
  });
}
const goAttr = (k, v) => `data-go="${k}=${esc(v)}" href="#"`;

/* ===================== small chart helpers ===================== */
/* Year-by-year chart. defs: {key:{lab, unit, bar, lowerBetter}}; peak ignores tiny-sample years. */
function yearChartSVG(years, defs, metric, minBalls) {
  const M = defs[metric] || defs[Object.keys(defs)[0]];
  const W = 720, H = 210, pad = 36, n = years.length, val = y => (y[metric] == null ? null : +y[metric]);
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
const fmAvailable = () => { const x = _X[state.cohort], m = meta(state.cohort); return !!(m.intl && x && !x._missing && x.fm); };
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
  const key = state.cohort, x = _X[key], fk = filterKey();
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
  const key = state.cohort, x = _X[key];
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
function mountSinceControl() {
  const host = document.getElementById('scopeHost'); if (!host || document.getElementById('sinceHost')) return;
  // Filters live together: time window (themed dropdown, not a native <select>) + full-members switch
  const wrap = document.createElement('div'); wrap.id = 'sinceHost'; wrap.className = 'hfilters';
  wrap.innerHTML = `<span class="hf-time" title="Time window for leaderboards, records and profiles"><svg class="hf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span class="hf-drop"></span></span>
    <button type="button" id="fmbtn" class="fmsw" role="switch" aria-checked="false" title="Only count matches where both teams are ICC full members"><span class="trk"><span class="knob"></span></span>Full members</button>`;
  host.after(wrap);
  const slot = wrap.querySelector('.hf-drop'), fmb = wrap.querySelector('#fmbtn');
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
    fmb.style.display = intl ? '' : 'none';
    fmb.classList.toggle('on', !!state.fm && intl); fmb.setAttribute('aria-checked', String(!!state.fm && intl));
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
  let useF = (state.since || state.fm) && _X[state.cohort] && !_X[state.cohort]._missing && filtersOn();
  const outside = useF && !getFiltered().players[pid]; // no balls in this selection: show everything instead
  if (outside) useF = false;
  if (useF) withSince(() => run(), document.createElement('div')); else run();
  if ((state.since || state.fm) && !_X[state.cohort]) ensureExtras(state.cohort, () => render());
  const xf = _X[state.cohort], c = useF && xf && xf._flt ? xf._flt.c : cur(), p = c.players[pid]; if (!p || !w || !w.firstElementChild) return w;
  stickyHeader(w);
  if (useF) { const b = $(filterBanner()); w.insertBefore(b, w.children[1] || null); _wireClear(b); }
  if (outside) w.insertBefore($('<div class="cov">No balls faced in the current filter selection, so this profile shows all their matches.</div>'), w.children[1] || null);
  w.insertBefore(alsoPlayedStrip(pid, false), w.children[1] || null);
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
/* Form chart follows the selected competition (per-year cohort data); all-format career is a toggle. */
const BAT_DEFS = { runs: { lab: 'Runs', unit: 'runs', bar: true }, avg: { lab: 'Average', unit: 'avg' }, sr: { lab: 'Strike rate', unit: 'SR' } };
mountCareer = function (app, pid) {
  const w = app.firstElementChild; if (!w) return;
  const panel = document.createElement('div'); panel.className = 'panel'; panel.style.marginTop = '13px';
  panel.innerHTML = '<h2>Form by year <span class="r">loading…</span></h2>';
  const anchor = w.querySelector('.xstrip'); const at = [...w.children].indexOf(anchor);
  w.insertBefore(panel, w.children[Math.max(1, at + 1)] || null);
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
  ensureCareers(pid, go); ensureExtras(state.cohort, go);
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
  let useSince = (state.since || state.fm) && _X[state.cohort] && !_X[state.cohort]._missing && filtersOn();
  const outsideB = useSince && !getFiltered().bowlers[id];
  if (outsideB) useSince = false;
  if (useSince) withSince(() => { w = _bowlerProfile(id); }, document.createElement('div')); else w = _bowlerProfile(id);
  if ((state.since || state.fm) && !_X[state.cohort]) ensureExtras(state.cohort, () => render());
  const xf = _X[state.cohort], c = useSince && xf && xf._flt ? xf._flt.c : cur(), b = (c.bowlers || {})[id]; if (!b || !w || !w.firstElementChild) return w;
  stickyHeader(w);
  const hdr = w.querySelector('.phead h1');
  if (hdr && b.archetype) hdr.after($(`<span class="arch" style="background:${BOWL_ARCH_COLOR[b.archetype] || '#888'}22;color:${BOWL_ARCH_COLOR[b.archetype] || '#aaa'}" title="${esc(GLOSSARY[b.archetype.toLowerCase()] || '')}">${esc(b.archetype)}</span>`));
  if (useSince) { const bn = $(filterBanner()); w.insertBefore(bn, w.children[1] || null); _wireClear(bn); }
  if (outsideB) w.insertBefore($('<div class="cov">No balls bowled in the current filter selection, so this profile shows all their matches.</div>'), w.children[1] || null);
  w.insertBefore(alsoPlayedStrip(id, true), w.children[1] || null);

  // form by year (this competition)
  const form = $('<div class="panel" style="margin-top:13px"><h2>Form by year <span class="r">loading…</span></h2></div>');
  w.insertBefore(form, w.children[2] || null);
  let metric = state.bowlMetric || 'wkts';
  ensureExtras(state.cohort, x => {
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
const INN_COL = ['#F2B24C', '#6FA8FF', '#FF6B7E', '#33D17A'];
function wormSVG(inns) {
  const W = 720, H = 240, pad = 38, maxO = Math.max(...inns.map(i => i.overs.length), 1);
  const cum = inns.map(i => { let s = 0; return i.overs.map(o => (s += o[0])); });
  const mx = Math.max(...cum.map(cs => cs[cs.length - 1] || 0), 1);
  const X = o => pad + o / maxO * (W - 2 * pad), Y = v => H - pad - v / mx * (H - 2 * pad);
  const lines = inns.map((inn, k) => { const cs = cum[k]; const pts = [`${X(0)},${Y(0)}`].concat(cs.map((v, o) => `${X(o + 1).toFixed(1)},${Y(v).toFixed(1)}`)).join(' ');
    const wk = inn.overs.map((o, j) => o[1] ? `<circle cx="${X(j + 1).toFixed(1)}" cy="${Y(cs[j]).toFixed(1)}" r="${2.5 + o[1]}" fill="${INN_COL[k % 4]}" fill-opacity=".9" stroke="#121317"><title>Over ${j + 1}: ${o[1]} wicket${o[1] > 1 ? 's' : ''}, ${cs[j]} runs</title></circle>` : '').join('');
    return `<polyline points="${pts}" fill="none" stroke="${INN_COL[k % 4]}" stroke-width="2.2"/>${wk}`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Run progression by over">${axisTicksSVG(X, Y, [0, maxO], [0, mx], [pad, pad, W - pad, H - pad])}<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#33363E"/>${lines}<text x="${W / 2}" y="${H - 4}" text-anchor="middle" fill="#8B8E96" font-size="10">Overs →</text></svg>`;
}
function manhattanSVG(inns) {
  const W = 720, H = 200, pad = 38, maxO = Math.max(...inns.map(i => i.overs.length), 1), n = inns.length;
  const mx = Math.max(...inns.flatMap(i => i.overs.map(o => o[0])), 1), gw = (W - 2 * pad) / maxO, bw = Math.max(1, gw * 0.8 / n);
  const Y = v => H - pad - v / mx * (H - 2 * pad);
  const bars = inns.map((inn, k) => inn.overs.map((o, j) => { const x = pad + j * gw + gw * 0.1 + k * bw, y = Y(o[0]);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad - y).toFixed(1)}" fill="${INN_COL[k % 4]}" fill-opacity="${o[1] ? 1 : .6}"><title>${esc(inn.team || '')} over ${j + 1}: ${o[0]} runs${o[1] ? ', ' + o[1] + ' wkt' : ''}</title></rect>`; }).join('')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Runs per over">${axisTicksSVG(o => pad + o * gw, Y, maxO <= 50 ? [0, maxO] : null, [0, mx], [pad, pad, W - pad, H - pad], { nx: 5 })}<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#33363E"/>${bars}</svg>`;
}
function matchDetail(app, x, id) {
  const mt = x.recent.find(r => r.id === id);
  if (!mt) { app.appendChild($('<div class="cov">This match is no longer in the recent list.</div>')); return; }
  const back = $('<div class="row" style="margin-top:20px;gap:10px;align-items:center"><button class="pill" id="mback">← matches</button></div>'); app.appendChild(back);
  back.querySelector('#mback').onclick = () => { state.match = null; render(); };
  app.appendChild($(`<div style="margin-top:10px"><h1 style="margin:0">${esc(mt.teams[0])} <span class="dim">vs</span> ${esc(mt.teams[1])}</h1><p class="sub">${esc(mt.date)} · <a ${goAttr('venue', (mt.venue || '').split(',')[0].trim())}>${esc(mt.venue || '')}</a>${mt.stage ? ' · ' + esc(mt.stage) : ''} · toss: ${esc(mt.toss[0] || '-')} chose to ${esc(mt.toss[1] || '-')}</p></div>`));
  const g = $('<div class="grid bento"></div>');
  g.appendChild($(`<div class="panel s12" style="background:linear-gradient(120deg,rgba(229,154,47,.13),transparent)"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><h2 style="margin:0;font-size:17px">${esc(resultText(mt))}</h2><div class="row" style="gap:16px;flex-wrap:wrap">${mt.inns.map((i, k) => `<span class="num"><span class="sw" style="background:${INN_COL[k % 4]};display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px"></span>${esc(i.team || '')} <b>${i.runs}/${i.wkts}</b> <span class="dim">(${i.overs.length} ov)</span></span>`).join('')}</div></div></div>`));
  const wpSlot = $('<div class="panel s12" style="display:none"></div>'); g.appendChild(wpSlot);
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
const wpModel = (wp, fmt, gender) => wp && wp.models && wp.models[`${fmt === 'odi' ? 'odi' : 't20'}_${gender === 'female' ? 'female' : 'male'}`];
function winProbSVG(series, teamA, teamB, split) {
  const W = 720, H = 210, pad = 38, n = series.length;
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
  return `<div class="wpline" title="Estimated from runs, balls and wickets with a model trained on every ${fmt.toUpperCase()} in Cricsheet. It doesn't know the teams or conditions."><span>Win chance</span><div class="wpbar"><span style="width:${(100 * pA).toFixed(0)}%"></span></div><b>${esc(fav)} ${pct}%</b></div>`;
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
function teamDetail(app, x, name) {
  const c = cur(), t = (c.teams || []).find(r => r.team === name) || { team: name }, d = x && x.teams && x.teams[name];
  const back = $('<div class="row" style="margin-top:20px"><button class="pill" id="tback">← teams</button></div>'); app.appendChild(back);
  back.querySelector('#tback').onclick = () => { state.team = null; render(); };
  app.appendChild($(`<div style="margin-top:10px"><h1 style="margin:0">${esc(name)}</h1><p class="sub">${esc(c.meta.label)}</p></div>`));
  const lost = d ? d.years.reduce((s, y) => s + y[3], 0) : null;
  const k = (l, val) => `<div class="s3"><div class="panel kpi"><div class="l">${l}</div><div class="n">${val == null ? '-' : fmtN(val)}</div></div></div>`;
  const g = $('<div class="grid bento"></div>'); g.innerHTML = k('Matches', t.matches) + k('Won', t.wins) + k('Lost', lost) + k('Win %', t.winpct); app.appendChild(g);
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
  const key = state.cohort, draw = x => { if (which === 'venue') venueDetail(app, x, state.venue); else if (which === 'team') teamDetail(app, x, state.team); else if (x) matchDetail(app, x, state.match); else app.appendChild($('<div class="cov">Match pages arrive with the next weekly data rebuild.</div>')); };
  if (_X[key]) draw(xNow());
  else { const l = $('<div class="loadbox"><div class="spinner"></div><div>Loading…</div></div>'); app.appendChild(l); ensureExtras(key, x => { if (state.cohort !== key) return; l.remove(); draw(x); }); }
  return true;
};
window.EXTRA_VIEWS = { bowlto: app => withSince(bowlToView, app), matches: matchesView };
/* Matchups view: under "full members only" swap in the full-member pair list. */
const _matchupsView = matchupsView;
matchupsView = function (app) {
  const c = cur();
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
homeView = function (app) {
  _homeView(app);
  const c = cur(), key = c.meta.key, slot = $('<div class="grid bento homex" style="margin-top:13px"></div>');
  const first = app.firstElementChild; if (first && first.nextSibling) app.insertBefore(slot, first.nextSibling); else app.appendChild(slot);
  ensureExtras(key, x => {
    if (!x || state.cohort !== key) { slot.remove(); return; }
    // "Full members only" also applies here: keep performances where both sides are full members
    const fmOn = !!(state.fm && x.fm), FM = new Set(fmOn ? x.fm.teams : []);
    const keep = r => !fmOn || (FM.has(r[4]) && FM.has(r[6]));
    const wk = x.week;
    const inns = wk ? wk.innings.filter(keep) : [], spells = wk ? wk.spells.filter(keep) : [];
    if (inns.length || spells.length) {
      const bi = inns[0], bs = spells[0];
      const tile = (k, big, small, who, sub, mid, wkCol) => `<a class="hx-tile" ${goAttr('match', mid)}><div class="hx-k">${k}</div>
        <div class="hx-big" style="color:${wkCol ? 'var(--wk)' : 'var(--accent2)'}">${big}${small ? ` <small>${small}</small>` : ''}</div>
        <div class="hx-who">${esc(who)}</div><div class="hx-sub">${sub}</div></a>`;
      const rows = [...inns.slice(1, 5).map(r => ({ r, bat: 1 })), ...spells.slice(1, 5).map(r => ({ r, bat: 0 }))];
      slot.appendChild($(`<div class="panel s6"><h2>Last 30 days <span class="r">${esc(wk.from)} to ${esc(wk.to)} · ${plural(wk.matches, 'match', 'matches')}${fmOn ? ' · full members' : ''}</span></h2>
        <div class="hx-feat">
          ${bi ? tile('Top innings', bi[1], `(${bi[2]})`, pName(x, bi[0]), `vs ${esc(bi[4] || '')} · SR ${bi[2] ? (100 * bi[1] / bi[2]).toFixed(0) : '-'}`, bi[5]) : ''}
          ${bs ? tile('Best spell', `${bs[1]}/${bs[2]}`, '', pName(x, bs[0]), `vs ${esc(bs[4] || '')}${bs[7] != null ? ' · ' + oversOf(bs[7]) : ''}`, bs[5], true) : ''}
        </div>
        ${rows.map(({ r, bat }) => `<a class="hx-row" ${goAttr('match', r[5])}><span><span class="hx-tag${bat ? '' : ' wk'}">${bat ? 'bat' : 'bowl'}</span>${esc(pName(x, r[0]))} <span class="dim">vs ${esc(r[4] || '')}</span></span>
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
    if (near.length) slot.appendChild($(`<div class="panel s6"><h2>Milestone watch <span class="r">active in ${lastY - 1} or ${lastY}${fmOn ? ' · vs full members' : ''}</span></h2>
      ${near.slice(0, 5).map(n => `<div class="hx-ms"><div class="top">${pidLink(n.id, n.name, n.bowler)}<span class="dim"><b style="color:var(--ink)">${n.have.toLocaleString()}</b> / ${n.next.toLocaleString()} ${n.unit}s</span></div>
        <div class="hx-bar${n.bowler ? ' wk' : ''}"><span style="width:${(100 * n.have / n.next).toFixed(1)}%"></span></div>
        <div class="hx-go">${plural(n.need, n.unit)} to go</div></div>`).join('')}
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
  _paint(app);
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
  }
  const setH = () => document.documentElement.style.setProperty('--hdr', (document.querySelector('header') || {}).offsetHeight + 'px');
  setH(); window.addEventListener('resize', setH);
};
