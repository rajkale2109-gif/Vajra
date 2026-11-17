import { api, setSession } from './api.js';
import { lineChart, barChart, hbars, divBars, donut, spark, gauge, legend, initChartHover, PALETTE, PLATFORM_COLOR } from './charts.js';

const $ = (s) => document.querySelector(s);
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n == null ? 'N/A' : Math.round(n).toLocaleString('en-IN'));
const inr = (n) => (n == null ? 'N/A' : '₹' + Math.round(n).toLocaleString('en-IN'));
const inr2 = (n) => (n == null ? 'N/A' : '₹' + n.toFixed(2));
const pcf = (n) => (n == null ? 'N/A' : n.toFixed(2) + '%');
const pp = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2);
const sg = (v) => (v == null ? 'N/A' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%');
// A missing / zero baseline never renders as 0% or infinity: say "No baseline" next to the absolute value.
const dl = (v, g) =>
  v == null
    ? '<span class=n title="Previous-period value is zero or missing, so % change is undefined (not shown as 0 or infinity)">No baseline</span>'
    : `<span class="${!g || Math.abs(v) < 0.05 ? 'n' : v * g > 0 ? 'ok' : 'bad'}">${v > 0 ? '▲' : v < 0 ? '▼' : '■'} ${sg(v)}</span>`;

const ppd = (ctrChange) => {
  if (!ctrChange || ctrChange.percentagePoints == null) return 'N/A';
  const d = ctrChange.percentagePoints;
  const relStr = ctrChange.relativePct != null ? sg(ctrChange.relativePct) : 'N/A';
  return `<span class="${Math.abs(d) < 0.005 ? 'n' : d > 0 ? 'ok' : 'bad'}" title="Relative change ${relStr}">${d > 0 ? '▲' : d < 0 ? '▼' : '■'} ${pp(d)} pp</span>`;
};

const PRE = {
  t: ['2026-11-15', '2026-11-15', '2026-11-14', '2026-11-14'],
  7: ['2026-11-08', '2026-11-14', '2026-11-01', '2026-11-07'],
  30: ['2026-10-16', '2026-11-14', '2026-09-16', '2026-10-15'],
};

const days = (a, b) => {
  const d = Math.round((new Date(b) - new Date(a)) / 864e5) + 1;
  return isNaN(d) ? 1 : Math.max(1, d);
};
const fd = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fr = (a, b) => (a && b ? `${fd(a)} – ${fd(b)}` : '—');
const addD = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

const pl = (p) => `<span class="pl ${p}">${p === 'Meta' ? '∞' : 'G'} ${p}</span>`;
const stb = (s) =>
  ({
    Active: '<span class="bd ok">● Active</span>',
    Learning: '<span class="bd info">◐ Learning</span>',
    Paused: '<span class="bd warn" title="Not currently delivering">❚❚ Paused</span>',
    Ended: '<span class="bd n" title="Historical data retained">■ Ended</span>',
  }[s] || s);

const sevc = (k) => (k === 'High' ? 'bad' : k === 'Info' ? 'info' : 'warn');
const NO_ADSETS = 'No ad sets configured yet — metrics unavailable.';

const kpi = (t, v, tip, sub, d, spk) =>
  `<div class=card title="${e(tip)}"><div class=sub>${t} ⓘ</div><div class=kv>${v}</div><div>${d || ''} <span class=sub>${sub || ''}</span></div>${spk || ''}</div>`;

const sel = (set, v, opts, id) =>
  `<select data-set="${set}" ${id ? 'id=' + id : ''}>${opts
    .map((o) => {
      const [k, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${e(k)}" ${String(k) === String(v) ? 'selected' : ''}>${e(l)}</option>`;
    })
    .join('')}</select>`;

const s2 = (c, pv, f, ch) => {
  if (c.reliability.reasonCode === 'd') {
    return `<div class=s2 title="Partial data: values may be incomplete">⏱ Delayed · synced ${e(c.lastSync)}</div>`;
  }
  if (!pv) {
    return '<div class=s2>No baseline</div>';
  }
  return `<div class=s2>prev ${f(pv)} · ${ch}</div>`;
};

const flag = (c) => {
  const rel = c.reliability;
  const text = rel.reasonCode === 'l' ? '⚠ Insufficient data' : rel.flagText;
  return `<span class=w title="${e(rel.reasonText)}">${text}</span>`;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const SID = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
})();
setSession(SID);

const S = {
  pg: 'overview',
  cs: '2026-11-08',
  ce: '2026-11-14',
  ps: '2026-11-01',
  pe: '2026-11-07',
  auto: true,
  col: window.innerWidth < 1100,
  sel: [],
  load: false,
  overviewData: null,
  campaignsData: null,
  groupsData: null,
  alertsData: null,
  activityData: null,
  settingsData: null,
  settingsForm: null,
  openGroups: {},
  activityType: '',
  issAll: false,
  modal: null, // { type: 'drill' | 'group' | 'addGroup' | 'alert' ...}
  confirm: null, // { title, lines[], run }
  openedAt: Date.now(),
  surfaced: new Set(),
};

const T = {
  q: '',
  plat: '',
  obj: '',
  st: '',
  perf: '',
  tab: 'all',
  sort: 'spend',
  dir: -1,
  page: 0,
  size: 10,
  cm: false,
  hid: ['pSpend', 'pCtr', 'pCpc', 'dS', 'dCtr', 'dCpc'],
};

const dateParams = () => ({ current_start: S.cs, current_end: S.ce, previous_start: S.ps, previous_end: S.pe });

const COLS = [
  ['spend', 'Spend', (c) => c.current.spend, (c) => inr(c.current.spend), (c) => s2(c, c.previous.spend, inr, dl(c.changes.spend.relativePct, 0))],
  ['pSpend', 'Prev spend', (c) => c.previous.spend, (c) => inr(c.previous.spend)],
  ['dS', 'Spend Δ', (c) => c.changes.spend.relativePct, (c) => dl(c.changes.spend.relativePct, 0)],
  ['impr', 'Impressions', (c) => c.current.impressions, (c) => num(c.current.impressions), (c) => s2(c, c.previous.impressions, num, dl(c.changes.impressions.relativePct, 1))],
  ['clicks', 'Clicks', (c) => c.current.clicks, (c) => num(c.current.clicks), (c) => s2(c, c.previous.clicks, num, dl(c.changes.clicks.relativePct, 1))],
  ['ctr', 'CTR', (c) => c.current.ctr, (c) => pcf(c.current.ctr), (c) => (c.reliability.isReliable ? s2(c, c.previous.ctr, pcf, ppd(c.changes.ctr)) : `<div class=s2>${flag(c)}</div>`)],
  ['pCtr', 'Prev CTR', (c) => c.previous.ctr, (c) => pcf(c.previous.ctr)],
  ['dCtr', 'CTR Δ (rel.)', (c) => c.changes.ctr.relativePct, (c) => (c.reliability.isReliable ? dl(c.changes.ctr.relativePct, 1) : flag(c))],
  ['cpc', 'CPC', (c) => c.current.cpc, (c) => inr2(c.current.cpc), (c) => (c.reliability.isReliable ? s2(c, c.previous.cpc, inr2, dl(c.changes.cpc.relativePct, -1)) : `<div class=s2>${flag(c)}</div>`)],
  ['pCpc', 'Prev CPC', (c) => c.previous.cpc, (c) => inr2(c.previous.cpc)],
  ['dCpc', 'CPC Δ', (c) => c.changes.cpc.relativePct, (c) => (c.reliability.isReliable ? dl(c.changes.cpc.relativePct, -1) : flag(c))],
];

const toast = (m, w) => {
  const d = document.createElement('div');
  d.textContent = m;
  if (w) d.style.borderLeftColor = '#D99025';
  $('#toast').append(d);
  setTimeout(() => d.remove(), 4000);
};

const unavailable = (r) => r.reliability.reasonCode === 'f' || r.reliability.reasonCode === 'n';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadData(opts = {}) {
  S.load = true;
  render();

  try {
    if (S.pg === 'overview') S.overviewData = await api.getOverview(dateParams());

    if (S.pg === 'overview' || S.pg === 'campaigns') {
      S.campaignsData = await api.getCampaigns({ ...dateParams(), q: T.q, plat: T.plat, obj: T.obj, st: T.st, perf: T.perf, tab: T.tab, sort: T.sort, dir: T.dir, page: T.page, size: T.size });
    }
    if (S.pg === 'groups') S.groupsData = await api.getGroups(dateParams());
    if (S.pg === 'alerts') {
      if (opts.evaluate) await api.evaluateAlerts();
      S.alertsData = await api.getAlerts();
    }
    if (S.pg === 'activity') S.activityData = await api.getActivity(S.activityType);
    if (S.pg === 'settings') {
      S.settingsData = await api.getSettings();
      S.settingsForm = { ...S.settingsData.preferences };
    }
    await refreshGraphs();
  } catch (err) {
    toast(`Error loading data: ${err.message}`, 1);
  } finally {
    S.load = false;
    render();
  }
}

async function guarded(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (err) {
    toast(err.message, 1);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Graphs ("View graph") — every page has one. Charts are plain SVG/HTML (see charts.js).
// ---------------------------------------------------------------------------
const G = { open: {}, metric: 'spend', tblMetric: 'spend', ts: {} };

const GM = {
  spend: { label: 'Spend', fmt: inr, good: 0, zero: true },
  impressions: { label: 'Impressions', fmt: num, good: 1, zero: true },
  clicks: { label: 'Clicks', fmt: num, good: 1, zero: true },
  ctr: { label: 'CTR', fmt: pcf, good: 1, zero: false },
  cpc: { label: 'CPC', fmt: inr2, good: -1, zero: false },
};

const rel = (c, p) => (c == null || p == null || p === 0 ? null : ((c - p) / p) * 100);

// Sum daily points; CTR / CPC are recomputed from the sums (never averaged). All-missing => null, not 0.
function aggPts(pts) {
  const u = pts.filter((p) => p.spend != null);
  if (!u.length) return null;
  const s = (k) => u.reduce((a, p) => a + (p[k] || 0), 0);
  const spend = s('spend');
  const impressions = s('impressions');
  const clicks = s('clicks');
  return { spend, impressions, clicks, ctr: impressions > 0 ? (clicks / impressions) * 100 : null, cpc: clicks > 0 ? spend / clicks : null };
}

const graphBtn = (key, label = 'View graph') =>
  `<button class="btn gb ${G.open[key] ? 'p' : ''}" data-a=graph data-k="${e(key)}" aria-expanded="${!!G.open[key]}" title="Show or hide the graph for this section">📈 ${G.open[key] ? 'Hide graph' : label}</button>`;

const mseg = (active, action) =>
  `<div class=mseg role=group aria-label="Metric">${Object.entries(GM)
    .map(([k, v]) => `<button class="${active === k ? 'a' : ''}" data-a=${action} data-v=${k} aria-pressed="${active === k}">${v.label}</button>`)
    .join('')}</div>`;

const gpanel = (title, sub, body) => `<div class=gp><div class=row><h2>${e(title)}</h2><span class=sub>${sub || ''}</span></div>${body}</div>`;

const tsScope = (k) =>
  k === 'ov' ? {} : k === 'sel' ? { campaignIds: S.sel.join(',') } : k === 'drill' ? { campaignId: S.modal?.id } : k.startsWith('grp:') ? { groupId: k.slice(4) } : null;

async function loadTs(k, force) {
  const sc = tsScope(k);
  if (!sc) return;
  if (k === 'sel' && !S.sel.length) {
    delete G.ts.sel;
    return;
  }
  if (k === 'drill' && S.modal?.id == null) return;
  const params = { ...dateParams(), ...sc };
  const sig = JSON.stringify(params);
  if (!force && G.ts[k] && G.ts[k]._sig === sig) return;
  try {
    G.ts[k] = { ...(await api.getTimeseries(params)), _sig: sig };
  } catch (err) {
    G.ts[k] = { error: err.message, _sig: sig };
  }
}

async function refreshGraphs() {
  const jobs = [];
  if (S.pg === 'overview') jobs.push(loadTs('ov'));
  if ((S.pg === 'overview' || S.pg === 'campaigns') && G.open.tbl && S.sel.length) jobs.push(loadTs('sel'));
  if (S.pg === 'groups') for (const k of Object.keys(G.open)) if (k.startsWith('grp:') && G.open[k]) jobs.push(loadTs(k));
  if (S.modal?.type === 'drill' && G.open.drill) jobs.push(loadTs('drill'));
  await Promise.all(jobs);
}

let selTimer;
function schedSelGraph() {
  if (!G.open.tbl) return;
  clearTimeout(selTimer);
  selTimer = setTimeout(async () => {
    await loadTs('sel');
    render();
  }, 250);
}

const dayLabels = (ts) => ts.days.map((d) => (d.current ? fd(d.current) : d.previous ? `${fd(d.previous)} (prev)` : ''));

function trendBlock(ts, metric) {
  if (!ts) return '<div class=emp style="padding:24px">Loading chart…</div>';
  if (ts.error) return `<div class=emp style="padding:24px">Couldn't load the chart: ${e(ts.error)}</div>`;
  const cur = ts.total.current;
  const prv = ts.total.previous;
  const series = [
    { name: `Current (${fr(ts.dates.currentStart, ts.dates.currentEnd)})`, color: 'var(--pri)', values: cur.map((p) => p[metric]), states: cur.map((p) => p.state), labels: cur.map((p) => (p.date ? fd(p.date) : '')) },
    { name: `Previous (${fr(ts.dates.previousStart, ts.dates.previousEnd)})`, color: 'var(--neu)', dash: true, values: prv.map((p) => p[metric]), states: prv.map((p) => p.state), labels: prv.map((p) => (p.date ? fd(p.date) : '')) },
  ];
  const all = [...cur, ...prv];
  const notes = [];
  if (all.some((p) => p.state === 'provisional')) notes.push('Hollow dot = partial day (today, data through 09:00).');
  if (all.some((p) => p.state === 'delayed')) notes.push('Hollow dot = delayed sync (Google), may be incomplete.');
  if (cur.some((p) => p.state === 'missing' && p.date)) notes.push('Grey band = no data. It is a gap, not zero.');
  return `${legend(series.map((s) => ({ name: s.name, color: s.color, dash: s.dash })))}${lineChart({ series, xLabels: dayLabels(ts), fmt: GM[metric].fmt, zero: GM[metric].zero, area: true, title: `${GM[metric].label} per day, current vs previous period` })}${notes.length ? `<div class=gn>${notes.join(' ')}</div>` : ''}`;
}

function platformBlock(ts, metric) {
  if (!ts || ts.error || ts.byPlatform.length < 2) return '';
  const series = ts.byPlatform.map((p) => ({ name: p.label, color: PLATFORM_COLOR[p.key] || PALETTE[0], values: p.current.map((x) => x[metric]), states: p.current.map((x) => x.state), labels: p.current.map((x) => (x.date ? fd(x.date) : '')) }));
  const shares = ts.byPlatform.map((p) => ({ label: p.label, color: PLATFORM_COLOR[p.key] || PALETTE[0], value: aggPts(p.current)?.spend ?? 0 }));
  return `<div class=gc style="margin-top:14px"><div><div class=gl2>${GM[metric].label} by platform · current period</div>${legend(series)}${lineChart({ series, xLabels: dayLabels(ts), fmt: GM[metric].fmt, zero: GM[metric].zero, h: 200, title: `${GM[metric].label} per day by platform` })}</div><div><div class=gl2>Spend share by platform</div>${donut(shares, { center: inr(shares.reduce((a, s) => a + s.value, 0)), sub: 'total spend', fmt: inr })}</div></div>`;
}

function rankRows(pairs, metric) {
  const m = GM[metric];
  return pairs
    .map((p) => {
      const c = aggPts(p.current);
      const pv = aggPts(p.previous);
      return { label: p.label, platform: p.platform, c: c?.[metric] ?? null, pv: pv?.[metric] ?? null, ch: rel(c?.[metric], pv?.[metric]) };
    })
    .sort((a, b) => (b.c ?? -1) - (a.c ?? -1))
    .map((r) => ({
      label: r.label,
      labelHtml: `${r.platform ? pl(r.platform) + ' ' : ''}${e(r.label)}`,
      value: r.c,
      prev: r.pv,
      valueText: m.fmt(r.c),
      prevText: m.fmt(r.pv),
      color: r.platform ? PLATFORM_COLOR[r.platform] : undefined,
      delta: r.pv ? dl(r.ch, m.good) : '<span class=n>No baseline</span>',
    }));
}

function pairBars(ts, metric, title, pairs) {
  if (!ts || ts.error || !pairs?.length) return '';
  return `<div><div class=gl2>${title} · ${GM[metric].label}</div>${legend([{ name: 'Current', color: 'var(--pri)' }, { name: 'Previous (thin bar)', color: 'var(--neu)' }])}${hbars(rankRows(pairs, metric))}</div>`;
}

// ---- Overview ---------------------------------------------------------------
function ovGraph() {
  const ts = G.ts.ov;
  const m = G.metric;
  return gpanel(
    'Performance trends',
    'Daily, current vs previous period aligned by day. Hover for exact values.',
    `${mseg(m, 'gmetric')}<div class="gc one"><div>${trendBlock(ts, m)}</div></div>${platformBlock(ts, m)}<div class="gc one" style="margin-top:14px">${pairBars(ts, m, 'Top campaigns by spend', ts?.byCampaign)}</div>`
  );
}

// ---- Issues (triage) ---------------------------------------------------------
function issuesGraph(is) {
  if (!is?.length) return gpanel('Open issues', '', '<div class=emp>No open issues to chart.</div>');
  const cnt = (f) => is.reduce((a, i) => ((a[f(i)] = (a[f(i)] || 0) + 1), a), {});
  const sev = cnt((i) => i.severity);
  const plat = cnt((i) => i.platform);
  const met = Object.entries(cnt((i) => i.metric)).sort((a, b) => b[1] - a[1]);
  const byCamp = Object.entries(cnt((i) => i.campaignName)).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const sevCol = { High: 'var(--bad)', Medium: 'var(--warn)', Info: 'var(--info)' };
  return gpanel(
    'Open issues',
    'What is wrong, where, and how bad.',
    `<div class=gc><div><div class=gl2>By severity</div>${donut(['High', 'Medium', 'Info'].map((k) => ({ label: k, value: sev[k] || 0, color: sevCol[k] })), { center: String(is.length), sub: 'open' })}</div><div><div class=gl2>By platform</div>${donut(Object.entries(plat).map(([k, v]) => ({ label: k, value: v, color: PLATFORM_COLOR[k] || PALETTE[3] })), { center: String(is.length), sub: 'open' })}</div></div>
<div class=gc style="margin-top:14px"><div><div class=gl2>By metric</div>${hbars(met.map(([k, v]) => ({ label: k, value: v, valueText: String(v) })))}</div><div><div class=gl2>Campaigns with most issues</div>${hbars(byCamp.map(([k, v]) => ({ label: k, value: v, valueText: String(v), color: 'var(--bad)' })))}</div></div>`
  );
}

// ---- Campaign table ------------------------------------------------------------
function tblGraph() {
  const d = S.campaignsData;
  if (!d) return '';
  const metric = G.tblMetric;
  const m = GM[metric];
  const items = d.items;
  const chg = (r) => r.changes[metric]?.relativePct ?? null;
  const rows = items.map((r) => {
    const gone = unavailable(r);
    return {
      label: r.name,
      labelHtml: `${pl(r.platform)} ${e(r.name)}`,
      value: gone ? null : r.current[metric],
      prev: gone ? null : r.previous[metric],
      valueText: m.fmt(r.current[metric]),
      prevText: m.fmt(r.previous[metric]),
      color: PLATFORM_COLOR[r.platform],
      delta: gone ? '' : r.previous[metric] ? dl(chg(r), m.good) : '<span class=n>No baseline</span>',
    };
  });
  const changeRows = items
    .map((r) => {
      const gone = unavailable(r);
      const unrel = (metric === 'ctr' || metric === 'cpc') && !r.reliability.isReliable;
      const v = gone || unrel ? null : chg(r);
      return { label: r.name, value: v, good: m.good, valueText: sg(v), why: gone ? 'Metrics unavailable' : unrel ? r.reliability.flagText || 'Insufficient data' : 'No baseline' };
    })
    .sort((a, b) => (b.value ?? -1e9) - (a.value ?? -1e9));
  const selTs = G.ts.sel;
  const selPart = S.sel.length
    ? `<div style="margin-top:14px"><div class=gl2>Daily trend · ${S.sel.length} selected campaign${S.sel.length === 1 ? '' : 's'} combined</div>${trendBlock(selTs, metric)}</div>`
    : '<div class=gn style="margin-top:10px">Tip: tick campaigns in the table to see their combined daily trend here.</div>';
  return gpanel(
    'Campaign comparison',
    `The ${items.length} campaign${items.length === 1 ? '' : 's'} in this view (follows your filters and page).`,
    `${mseg(metric, 'tmetric')}<div class=gc><div><div class=gl2>${m.label} · current vs previous</div>${legend([{ name: 'Current', color: 'var(--pri)' }, { name: 'Previous (thin bar)', color: 'var(--neu)' }])}${hbars(rows, { empty: 'No campaigns match these filters.' })}</div><div><div class=gl2>${m.label} change vs previous period</div><div class=sub style="margin-bottom:6px">Green = good direction, red = bad. Unreliable CTR/CPC is left blank, never drawn as 0.</div>${divBars(changeRows)}</div></div>${selPart}`
  );
}

// ---- Campaign drilldown ----------------------------------------------------------
function drillGraph() {
  const mdl = S.modal;
  const ts = G.ts.drill;
  const metric = G.metric;
  const m = GM[metric];
  const ads = mdl.data?.adSets || [];
  const adRows = ads.map((a) => {
    const gone = a.reliability.reasonCode === 'f';
    const unrel = (metric === 'ctr' || metric === 'cpc') && !a.reliability.isReliable;
    const ch = a.changes[metric]?.relativePct ?? null;
    return { a, gone, unrel, ch };
  });
  const bars = hbars(
    adRows.map(({ a, gone }, i) => ({ label: a.name, value: gone ? null : a.current[metric], prev: gone ? null : a.previous[metric], valueText: m.fmt(a.current[metric]), prevText: m.fmt(a.previous[metric]), color: PALETTE[i % PALETTE.length], delta: gone ? '' : a.previous[metric] ? dl(adRows[i].ch, m.good) : '<span class=n>No baseline</span>' })),
    { empty: 'No ad sets to compare yet.' }
  );
  const deltas = divBars(adRows.map(({ a, gone, unrel, ch }) => ({ label: a.name, value: gone || unrel ? null : ch, good: m.good, valueText: sg(ch), why: gone ? 'Sync failed' : unrel ? 'Insufficient data' : 'No baseline' })));
  const lines =
    ts && !ts.error && ts.byAdSet.length
      ? (() => {
          const ser = ts.byAdSet.slice(0, 6).map((p, i) => ({ name: p.label, color: PALETTE[i], values: p.current.map((x) => x[metric]), states: p.current.map((x) => x.state), labels: p.current.map((x) => (x.date ? fd(x.date) : '')) }));
          return `<div style="margin-top:14px"><div class=gl2>${m.label} per day by ad set · current period</div>${legend(ser)}${lineChart({ series: ser, xLabels: dayLabels(ts), fmt: m.fmt, zero: m.zero, h: 200, title: `${m.label} per day by ad set` })}</div>`;
        })()
      : '';
  return `<div class="gp" style="margin-top:12px"><div class=row><h2>Campaign graph</h2><span class=sub>Daily trend and ad-set comparison</span></div>${mseg(metric, 'gmetric')}${trendBlock(ts, metric)}${lines}<div class=gc style="margin-top:14px"><div><div class=gl2>Ad sets · ${m.label}</div>${bars}</div><div><div class=gl2>Change vs previous</div>${deltas}</div></div></div>`;
}

// ---- Groups ------------------------------------------------------------------------
function groupGraph(g) {
  const k = 'grp:' + g.id;
  const ts = G.ts[k];
  const m = G.metric;
  const changeRows = ts?.byCampaign?.length
    ? ts.byCampaign.map((p) => {
        const c = aggPts(p.current);
        const pv = aggPts(p.previous);
        const ch = (m === 'ctr' || m === 'cpc') && c && c.impressions < 1000 ? null : rel(c?.[m], pv?.[m]);
        return { label: p.label, value: ch, good: GM[m].good, valueText: sg(ch), why: 'No baseline / low volume' };
      })
    : [];
  return gpanel(
    `${g.name} — graph`,
    'Combined daily trend and each campaign’s contribution.',
    `${mseg(m, 'gmetric')}${trendBlock(ts, m)}<div class="gc one" style="margin-top:14px">${pairBars(ts, m, 'Campaigns in this group', ts?.byCampaign) || '<div class=emp>No campaigns in this group yet.</div>'}</div>${changeRows.length ? `<div class="gc one" style="margin-top:14px"><div class=gl2>${GM[m].label} change by campaign</div>${divBars(changeRows)}</div>` : ''}`
  );
}

// ---- Alerts ----------------------------------------------------------------------------
function alertsGraph(d) {
  const T_ = d.triggers;
  const R = d.rules;
  const statusOf = (t) => (t.status === 'open' || t.status === 'opened' ? 'Needs attention' : t.status === 'dismissed' ? 'Dismissed' : t.status === 'recovered' ? 'Recovered' : t.status);
  const stat = {};
  T_.forEach((t) => (stat[statusOf(t)] = (stat[statusOf(t)] || 0) + 1));
  const statCol = { 'Needs attention': 'var(--bad)', Dismissed: 'var(--neu)', Recovered: 'var(--ok)' };
  const fbc = { valid: 0, misleading: 0, not_actionable: 0, unreviewed: 0 };
  T_.forEach((t) => (fbc[t.feedback || 'unreviewed'] = (fbc[t.feedback || 'unreviewed'] || 0) + 1));
  const perRule = {};
  T_.forEach((t) => (perRule[t.ruleName] = (perRule[t.ruleName] || 0) + 1));
  const perDay = {};
  T_.forEach((t) => {
    const day = (t.triggeredAt || '').slice(0, 10);
    if (day) perDay[day] = (perDay[day] || 0) + 1;
  });
  const days_ = Object.keys(perDay).sort();
  const ruleMetric = {};
  R.forEach((r) => (ruleMetric[r.metricLabel] = (ruleMetric[r.metricLabel] || 0) + 1));
  if (!T_.length && !R.length) return gpanel('Alerts overview', '', '<div class=emp>No alerts or rules yet.</div>');
  return gpanel(
    'Alerts overview',
    `${T_.length} trigger${T_.length === 1 ? '' : 's'} across ${R.length} rule${R.length === 1 ? '' : 's'}.`,
    `<div class=gc><div><div class=gl2>Triggers by status</div>${donut(Object.entries(stat).map(([k, v]) => ({ label: k, value: v, color: statCol[k] || PALETTE[3] })), { center: String(T_.length), sub: 'triggers' })}</div><div><div class=gl2>Were alerts right? (planner reviews)</div>${donut([{ label: 'Valid', value: fbc.valid, color: 'var(--ok)' }, { label: 'Misleading', value: fbc.misleading, color: 'var(--bad)' }, { label: 'Not actionable', value: fbc.not_actionable, color: 'var(--warn)' }, { label: 'Not reviewed yet', value: fbc.unreviewed, color: 'var(--neu)' }], { center: String(T_.length - fbc.unreviewed), sub: 'reviewed' })}</div></div>
<div class=gc style="margin-top:14px"><div><div class=gl2>Triggers by rule</div>${hbars(Object.entries(perRule).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, valueText: String(v), color: 'var(--warn)' })), { empty: 'No triggers yet.' })}</div><div><div class=gl2>Rules by metric watched</div>${hbars(Object.entries(ruleMetric).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, valueText: String(v) })), { empty: 'No rules yet.' })}</div></div>
${days_.length ? `<div class="gc one" style="margin-top:14px"><div class=gl2>Triggers per day</div>${barChart({ labels: days_.map(fd), values: days_.map((x) => perDay[x]), fmt: (v) => `${v} trigger${v === 1 ? '' : 's'}`, color: 'var(--warn)', h: 170, title: 'Alert triggers per day' })}</div>` : ''}`
  );
}

// ---- Activity ----------------------------------------------------------------------------
function activityGraph(d) {
  const it = d.items;
  if (!it.length) return gpanel('Activity overview', '', '<div class=emp>No activity to chart.</div>');
  const cnt = (f) => it.reduce((a, i) => ((a[f(i)] = (a[f(i)] || 0) + 1), a), {});
  const byType = Object.entries(cnt((i) => i.type));
  const byUser = Object.entries(cnt((i) => i.userName)).sort((a, b) => b[1] - a[1]);
  const byDay = cnt((i) => (/^([A-Za-z]{3} \d{1,2})/.exec(i.timestampText) || [])[1] || '');
  delete byDay[''];
  const dayKeys = Object.keys(byDay).reverse(); // API is newest-first
  const tcol = { Campaign: PALETTE[0], Group: PALETTE[1], Alert: PALETTE[2], Selection: PALETTE[3], System: PALETTE[7] };
  return gpanel(
    'Activity overview',
    `${it.length} change${it.length === 1 ? '' : 's'}${S.activityType ? ` of type “${e(S.activityType)}”` : ''}.`,
    `<div class=gc><div><div class=gl2>By type</div>${donut(byType.map(([k, v]) => ({ label: k, value: v, color: tcol[k] || PALETTE[4] })), { center: String(it.length), sub: 'changes' })}</div><div><div class=gl2>By planner</div>${hbars(byUser.map(([k, v]) => ({ label: k, value: v, valueText: String(v) })))}</div></div>${dayKeys.length ? `<div class="gc one" style="margin-top:14px"><div class=gl2>Changes per day</div>${barChart({ labels: dayKeys, values: dayKeys.map((k) => byDay[k]), fmt: (v) => `${v} change${v === 1 ? '' : 's'}`, h: 170, title: 'Changes per day' })}</div>` : ''}`
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function period() {
  const cur = [S.cs, S.ce, S.ps, S.pe].join();
  const act = Object.keys(PRE).find((k) => PRE[k].join() === cur) || 'c';
  const dc = days(S.cs, S.ce);
  const dp = days(S.ps, S.pe);
  const bt = (k, l) => `<button class="btn ${act === k ? 'p' : ''}" data-a=pre data-v=${k} aria-pressed="${act === k}">${l}</button>`;
  const pd = (n) => `<b>${n} day${n > 1 ? 's' : ''}</b>`;
  const isProv = S.overviewData?.dataQuality?.isProvisional || S.ce >= '2026-11-15';

  return `<div class=card style="padding:10px 14px"><div class=row><b>Compare</b><span class=seg>${bt('t', 'Today vs yesterday')}${bt('7', 'Last 7 days vs previous 7')}${bt('30', 'Last 30 days vs previous 30')}${bt('c', 'Custom')}</span><span class=sp></span><label class=sub><input type=checkbox data-a=autoP ${S.auto ? 'checked' : ''}> Auto-set previous period</label></div>
<div class=row style="margin-top:8px"><span class=sub>Current</span><input type=date id=d1 data-set=S.cs value="${S.cs}" aria-label="Current period start">–<input type=date id=d2 data-set=S.ce value="${S.ce}" aria-label="Current period end">${pd(dc)}<span class=sub>vs previous</span><input type=date id=d3 data-set=S.ps value="${S.ps}" aria-label="Previous period start">–<input type=date id=d4 data-set=S.pe value="${S.pe}" aria-label="Previous period end">${pd(dp)}<span class=sp></span><span class=sub>Data calculated on server from real daily metrics rows.</span></div>
${isProv ? '<div class=ban style="margin:8px 0 0">⚠ <b>Provisional data:</b> the current period includes today (data through 09:00). Totals are partial and comparisons may overstate declines. Any alert evaluated on this data is marked <b>provisional</b> and is not treated as final.</div>' : ''}${dc !== dp ? `<div class=ban style="margin:8px 0 0">⚠ The periods differ in length (${dc} vs ${dp} days). Spend, impressions and clicks changes partly reflect that difference; CTR and CPC are unaffected.</div>` : ''}</div>`;
}

function triage(is) {
  if (!is) is = [];
  const n = { High: 0, Medium: 0, Info: 0 };
  is.forEach((i) => n[i.severity]++);
  const sh = S.issAll ? is : is.slice(0, 4);

  // issue_surfaced: Governance displayed this issue to the planner (once per issue per session)
  for (const i of sh) {
    if (!S.surfaced.has(i.id)) {
      S.surfaced.add(i.id);
      api.track('issue_surfaced', { issueId: i.id, campaignId: i.campaignId, severity: i.severity, platform: i.platform, source: 'triage' });
    }
  }

  return `<div class=card><div class=row><h2>Needs your attention</h2>${['High', 'Medium', 'Info'].map((k) => (n[k] ? `<span class="bd ${sevc(k)}">${n[k]} ${k}</span>` : '')).join('')}<span class=sub>${is.length} open · most severe first</span><span class=sp></span>${graphBtn('iss')}${is.length ? '<button class=btn data-a=attTab>Show these in table ↓</button>' : ''}</div>${G.open.iss ? `<div style="margin-top:10px">${issuesGraph(is)}</div>` : ''}<div style="margin-top:10px">${is.length ? sh.map((i) => `<div class="iss ${i.severity}" style="padding:7px 10px"><span class="bd ${sevc(i.severity)}">${i.severity}</span><div class=sp><b>${e(i.campaignName)}</b> ${pl(i.platform)} · ${e(i.metric)}: <b>${e(i.changeDisplay)}</b> <span class=sub>· detected ${e(i.detectedAt)}</span><div class=sub>${e(i.whyText)}</div></div><button class="btn p" data-a=openIssue data-id="${e(i.id)}" data-cid="${i.campaignId}">View campaign</button><button class=btn data-a=revIssue data-id="${e(i.id)}">Mark reviewed</button><button class=btn data-a=disIssue data-id="${e(i.id)}">Dismiss</button></div>`).join('') : '<div class=emp>All caught up — no open issues.</div>'}${is.length > 4 ? `<button class=btn data-a=issAll>${S.issAll ? 'Show top 4 only' : `Show all ${is.length} issues`}</button>` : ''}</div></div>`;
}

function nameCellNote(r) {
  const code = r.reliability.reasonCode;
  if (code === 'n') return `<div class="s2 w">${NO_ADSETS}</div>`;
  if (code === 'f') return '<div class="s2 w">✖ Sync failed — data unavailable (not shown as zero)</div>';
  return '';
}

function table() {
  if (!S.campaignsData) {
    return '<div class="card emp">Loading campaign performance data…</div>';
  }

  const { items, pagination, tabCounts } = S.campaignsData;
  const cols = COLS.filter((c) => !T.hid.includes(c[0]));
  const allSel = items.length && items.every((r) => S.sel.includes(r.campaignId));
  const someSel = items.some((r) => S.sel.includes(r.campaignId));

  const tabBtn = (k, l, count) => `<button class="${T.tab === k ? 'a' : ''}" data-a=tab data-v=${k}>${l} <span class=sub>${count}</span></button>`;

  return `<div class=card id=tbl><div class=tabs role=tablist>${tabBtn('all', 'All campaigns', tabCounts.all)}${tabBtn('att', 'Needs attention', tabCounts.att)}${tabBtn('imp', 'Improving', tabCounts.imp)}${tabBtn('dec', 'Declining', tabCounts.dec)}${tabBtn('Paused', 'Paused', tabCounts.Paused)}${tabBtn('Ended', 'Ended', tabCounts.Ended)}</div>
<div class=row style="margin-bottom:10px"><input id=sq data-set=T.q value="${e(T.q)}" placeholder="Search campaign name…" aria-label="Search campaigns" style="width:220px">${sel('T.plat', T.plat, [['', 'All platforms'], 'Meta', 'Google'])}${sel('T.obj', T.obj, [['', 'All objectives'], 'Awareness', 'Traffic', 'Engagement', 'Leads', 'Sales', 'App Promotion'])}${sel('T.st', T.st, [['', 'All statuses'], 'Active', 'Learning', 'Paused', 'Ended'])}${sel('T.perf', T.perf, [['', 'Any performance'], ['imp', 'Improving CTR'], ['dec', 'Declining CTR']])}<button class=btn data-a=clr>Clear filters</button><span class=sp></span>${graphBtn('tbl')}<button class=btn data-a=exportCsv title="Download the current view (or your selection) as CSV">⇩ Export CSV</button><div style="position:relative" data-dd><button class=btn data-a=cm>Columns ▾</button>${T.cm ? `<div class=dd style="width:200px">${COLS.map((c) => `<label style="display:flex;gap:8px;padding:4px"><input type=checkbox data-a=colv data-k=${c[0]} ${T.hid.includes(c[0]) ? '' : 'checked'}>${c[1]}</label>`).join('')}</div>` : ''}</div></div>
${G.open.tbl ? tblGraph() : ''}${items.length ? `<div class="tw cs"><table><caption class=sr>Campaign performance, current vs previous period</caption><thead><tr><th><input type=checkbox aria-label="Select all visible" data-a=selAll ${allSel ? 'checked' : ''} ${!allSel && someSel ? 'data-ind=1' : ''}></th><th scope=col aria-sort="${T.sort === 'name' ? (T.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-a=sort data-k=name>Campaign ${T.sort === 'name' ? (T.dir > 0 ? '▲' : '▼') : ''}</button></th><th>Platform</th><th>Objective</th><th>Status</th>${cols.map((c) => `<th scope=col class=r aria-sort="${T.sort === c[0] ? (T.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-a=sort data-k=${c[0]}>${c[1]} ${T.sort === c[0] ? (T.dir > 0 ? '▲' : '▼') : ''}</button></th>`).join('')}<th>Updated</th></tr></thead><tbody>${items.map((r) => `<tr class="${S.sel.includes(r.campaignId) ? 'sl' : ''}"><td><input type=checkbox aria-label="Select ${e(r.name)}" data-a=sel data-id=${r.campaignId} ${S.sel.includes(r.campaignId) ? 'checked' : ''}></td><td><button class=lnk data-a=openCamp data-id=${r.campaignId}>${e(r.name)}</button><div class=raw title="${e(r.raw)}">${e(r.raw)}</div>${nameCellNote(r)}${(r.issues || []).map((i) => `<span class="bd ${sevc(i.severity)}" title="${e(i.whyText)}">⚑ ${e(i.metric)} ${e(i.changeDisplay)}</span>`).join(' ')}</td><td>${pl(r.platform)}</td><td>${e(r.objective)}</td><td>${stb(r.status)}</td>${cols.map((c) => `<td class=r>${unavailable(r) ? '<span class=n title="Metrics unavailable">—</span>' : c[3](r) + (c[4] ? c[4](r) : '')}</td>`).join('')}<td class=sub>${r.reliability.reasonCode === 'd' ? '<span class=w>⏱ ' : '<span>'}${e(r.lastSync)}</span></td></tr>`).join('')}</tbody></table></div>
<div class=row style="margin-top:8px"><span class=sub>${pagination.total} campaigns · ${S.sel.length} selected</span><span class=sp></span>Rows ${sel('T.size', T.size, [10, 25, 50])}<button class=btn data-a=pg data-d=-1 ${pagination.page ? '' : 'disabled'}>‹ Prev</button><span>${pagination.page + 1} / ${pagination.totalPages}</span><button class=btn data-a=pg data-d=1 ${pagination.page + 1 >= pagination.totalPages ? 'disabled' : ''}>Next ›</button></div>` : `<div class=emp><b>No campaigns match these filters</b><p>No data to show for this view. Clear the filters or change the reporting period.</p><button class="btn p" data-a=clr>Clear filters</button></div>`}
${S.sel.length ? `<div class=bar role=region aria-label="Bulk actions for selected campaigns"><b>${S.sel.length} of ${pagination.total} campaign${pagination.total === 1 ? '' : 's'} selected</b><span class=sp></span><button class=btn data-a=bulkAddGroup>Add to group…</button><button class=btn data-a=bulkPause>Pause…</button><button class=btn data-a=bulkResume>Resume…</button><button class=btn data-a=exportCsv>Export selected</button><button class=btn data-a=clrSel>Clear selection</button></div>` : ''}</div>`;
}

function overview() {
  const d = S.overviewData;
  if (!d) return '<div class="card emp">Loading overview…</div>';

  const dq = d.dataQuality;
  const kpis = d.kpis;
  const stale = (dq.hasDelayedGoogle ? ' · ⏱ incl. delayed data' : '') + (dq.hasFailedSync ? ` · excl. ${dq.failedSyncCount} failed sync` : '') + (dq.isProvisional ? ' · provisional' : '');

  const ots = G.ts.ov && !G.ts.ov.error ? G.ts.ov : null;
  const sp = (m, col) => (ots ? spark(ots.total.current.map((p) => p[m]), col, ots.total.previous.map((p) => p[m])) : '');
  return `<div class=row><div><h1>Governance</h1><div class=sub>Your campaign performance, changes and priorities in one place.</div></div><span class=sp></span><span class=sub>Server-driven · Last synced: Nov 15, 08:40 · ${S.load ? '⟳ Refreshing…' : ''}</span><button class=btn data-a=refresh ${S.load ? 'disabled' : ''}>⟳ Refresh data</button></div>
${period()}${dq.hasDelayedGoogle ? `<div class=ban>⏱ <b>Google Ads connection delayed.</b> Meta data is current; ${dq.delayedGoogleCount} Google campaign(s) show last-synced values, so Google-attributed totals below may be incomplete.</div>` : ''}
<div class=kp>${kpi('Total campaigns', '148', 'Campaigns in the ACME Cooling India account.', `${kpis.totalCampaigns} in sample`)}${kpi('Active campaigns', '126', 'Campaigns currently delivering.', `${kpis.activeCampaigns} in sample`)}${kpi('Total spend', inr(kpis.spend), 'Sum of spend across sample campaigns for the selected period.', `prev ${inr(kpis.prevSpend)}${stale}`, dl(kpis.spendChange, 0), sp('spend', 'var(--pri)'))}${kpi('Impressions', num(kpis.impressions), 'Times ads were shown.', `prev ${num(kpis.prevImpressions)}${stale}`, dl(kpis.impressionsChange, 1), sp('impressions', '#16A5A5'))}${kpi('Clicks', num(kpis.clicks), 'Clicks on ads.', `prev ${num(kpis.prevClicks)}${stale}`, dl(kpis.clicksChange, 1), sp('clicks', '#D9902F'))}${kpi('Open issues', d.issues.length, 'Issues needing review (not dismissed or resolved). Alert rules are separate: see Alerts.', `${kpis.activeRulesCount} alert rules running`)}</div>
<div class=row style="justify-content:flex-end;margin:-6px 0 10px"><span class=sub>Dashed line in each card = previous period.</span>${graphBtn('ov', 'View performance graph')}</div>${G.open.ov ? ovGraph() : ''}
${triage(d.issues)}${table()}`;
}

function campaigns() {
  return `<h1>Campaigns</h1><div class=sub style="margin-bottom:12px">All campaigns across Meta and Google.</div>${period()}${table()}`;
}

// ---- Groups ---------------------------------------------------------------
function combinedRow(label, cur, prev, chg, note) {
  return `<tr><td>${label}</td><td class=r>${inr(cur.spend)}</td><td class=r>${num(cur.impressions)}</td><td class=r>${num(cur.clicks)}</td><td class=r>${pcf(cur.ctr)} ${chg ? ppd(chg.ctr) : ''}</td><td class=r>${inr2(cur.cpc)} ${chg ? dl(chg.cpc.relativePct, -1) : ''}</td><td class=sub>${note || ''}</td></tr>`;
}

function groups() {
  const d = S.groupsData;
  if (!d) return '<div class="card emp">Loading groups…</div>';
  return `<div class=row><div><h1>Groups</h1><div class=sub>Related campaigns judged together. % change uses like-for-like campaigns only (reliable in both periods).</div></div><span class=sp></span><button class="btn p" data-a=newGroup>+ New group</button></div>${period()}
${d.groups.length ? d.groups.map((g) => groupCard(g)).join('') : '<div class="card emp"><b>No groups yet</b><p>Create a group to see related campaigns\' combined performance.</p></div>'}`;
}

function groupCard(g) {
  const open = !!S.openGroups[g.id];
  const c = g.combined;
  const lfl = c?.likeForLike;
  return `<div class=card><div class=row><h2>${e(g.name)}</h2><span class=sub>${g.campaignCount} campaign${g.campaignCount === 1 ? '' : 's'} · updated ${e(g.updatedText)}</span><span class=sp></span>${graphBtn('grp:' + g.id)}<button class=btn data-a=toggleGroup data-id="${e(g.id)}" aria-expanded="${open}">${open ? 'Hide' : 'Open'}</button><button class=btn data-a=addToGroupModal data-id="${e(g.id)}">Add campaigns</button><button class="btn d" data-a=delGroup data-id="${e(g.id)}">Delete</button></div>
<div class=sub>${e(g.description)}</div>
${G.open['grp:' + g.id] ? `<div style="margin-top:10px">${groupGraph(g)}</div>` : ''}
${c ? `<div class=tw style="margin-top:8px;max-height:none"><table><thead><tr><th></th><th class=r>Spend</th><th class=r>Impressions</th><th class=r>Clicks</th><th class=r>CTR</th><th class=r>CPC</th><th></th></tr></thead><tbody>
${combinedRow('Combined (current)', c.current, c.previous, null, 'All campaigns with usable data')}
${combinedRow('Combined (previous)', c.previous, null, null, '')}
${combinedRow(`Like-for-like change <span class=sub>(${lfl.campaignsCount} of ${g.campaignCount})</span>`, lfl.current, lfl.previous, lfl.changes, lfl.excludedCampaigns.length ? `Excluded from % change: ${lfl.excludedCampaigns.length}` : 'All campaigns comparable')}
</tbody></table></div>${c.isProvisional ? '<div class=ban style="margin-top:8px">⚠ Provisional: current period includes today.</div>' : ''}${c.hasDelayedData ? '<div class=ban style="margin-top:8px">⏱ Includes delayed data — totals may be incomplete.</div>' : ''}` : '<div class=emp>No campaigns in this group yet.</div>'}
${open ? `<div class=tw style="margin-top:8px;max-height:none"><table><caption class=sr>Campaigns in ${e(g.name)}</caption><thead><tr><th>Campaign</th><th>Status</th><th class=r>Spend</th><th class=r>CTR</th><th>Data</th><th></th></tr></thead><tbody>${g.members
    .map(
      (m) =>
        `<tr><td><button class=lnk data-a=openCamp data-id=${m.campaignId}>${e(m.name)}</button> ${pl(m.platform)}</td><td>${stb(m.status)}</td><td class=r>${unavailableM(m) ? '—' : inr(m.current.spend)}</td><td class=r>${unavailableM(m) ? '—' : pcf(m.current.ctr)}</td><td class=sub>${m.note ? `<span class=w>${e(m.note)}</span>` : e(m.reliability.reasonText)}</td><td><button class=btn data-a=rmMember data-g="${e(g.id)}" data-id=${m.campaignId}>Remove</button></td></tr>`
    )
    .join('')}</tbody></table></div>` : ''}</div>`;
}
const unavailableM = (m) => m.reliability.reasonCode === 'f' || m.reliability.reasonCode === 'n';

// ---- Alerts ---------------------------------------------------------------
const CONDITION_LABEL = { drop: 'drops by', rise: 'rises by', below: 'falls below', above: 'goes above' };

function alerts() {
  const d = S.alertsData;
  if (!d) return '<div class="card emp">Loading alerts…</div>';
  const live = d.triggers.filter((t) => t.status === 'open' || t.status === 'opened');
  const past = d.triggers.filter((t) => !(t.status === 'open' || t.status === 'opened'));
  const trig = (t) => `<div class="iss ${t.provisional ? '' : 'High'}" style="padding:7px 10px"><div class=sp><b>${e(t.ruleName)}</b> · ${e(t.entityLabel)} ${t.provisional ? '<span class="bd warn" title="Evaluated on partial, delayed or learning-phase data">Provisional</span>' : ''}${t.feedback ? `<span class="bd n">Reviewed: ${e(t.feedback.replace('_', ' '))}</span>` : ''}<div class=sub>${e(t.message)} · ${e(t.triggeredAt.replace('T', ' ').slice(0, 16))} · ${e(t.period)}${t.excludedCount ? ` · ${t.excludedCount} campaign(s) excluded` : ''}</div></div>${
    t.status === 'open' || t.status === 'opened'
      ? `<button class="btn p" data-a=openTrigger data-id=${t.id}>Investigate</button><button class=btn data-a=disTrigger data-id=${t.id}>Dismiss</button>`
      : `<span class=sub>${e(t.status)}</span>`
  }${t.feedback ? '' : `<span class=sub style="white-space:nowrap">Was it right? <button class=btn data-a=fb data-id=${t.id} data-v=valid>Valid</button><button class=btn data-a=fb data-id=${t.id} data-v=misleading title="The data or rule made this alert misleading">Misleading</button><button class=btn data-a=fb data-id=${t.id} data-v=not_actionable>Not actionable</button></span>`}</div>`;

  return `<div class=row><div><h1>Alerts</h1><div class=sub>You set the thresholds. One issue raises one alert: repeat triggers are deduplicated with a cooldown.</div></div><span class=sp></span>${graphBtn('alerts')}<button class=btn data-a=evalAlerts>⟳ Run evaluation</button><button class="btn p" data-a=newAlert>+ New alert</button></div>
${G.open.alerts ? `<div style="margin-top:14px">${alertsGraph(d)}</div>` : ''}
<div class=card style="margin-top:14px"><h2>Triggered alerts</h2><div style="margin-top:10px">${live.length ? live.map(trig).join('') : '<div class=emp>No triggered alerts need attention.</div>'}</div>${past.length ? `<details style="margin-top:8px"><summary class=sub>${past.length} earlier (dismissed or recovered)</summary><div style="margin-top:8px">${past.map(trig).join('')}</div></details>` : ''}</div>
<div class=card><h2>Alert rules</h2>${
    d.rules.length
      ? `<div class=tw style="max-height:none;margin-top:8px"><table><thead><tr><th>Name</th><th>Watching</th><th>Rule</th><th>Compared with</th><th>Frequency</th><th>Status</th><th>Last triggered</th><th></th></tr></thead><tbody>${d.rules
          .map(
            (r) =>
              `<tr><td><b>${e(r.name)}</b></td><td>${e(r.entityLabel)}</td><td>${e(r.metricLabel)} ${CONDITION_LABEL[r.condition]} ${r.threshold.toLocaleString('en-IN')}${r.condition === 'drop' || r.condition === 'rise' ? '%' : ''}</td><td>${e(r.comparisonPeriod)}</td><td>${e(r.frequency)}</td><td>${r.status === 'Active' ? '<span class="bd ok">Active</span>' : '<span class="bd n">Paused</span>'}</td><td class=sub>${e(r.lastTriggeredAt)}</td><td><button class=btn data-a=ruleToggle data-id="${e(r.id)}" data-v="${r.status === 'Active' ? 'Paused' : 'Active'}">${r.status === 'Active' ? 'Pause' : 'Resume'}</button><button class="btn d" data-a=ruleDel data-id="${e(r.id)}">Delete</button></td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<div class=emp>No alert rules yet.</div>'
  }</div>`;
}

// ---- Activity -------------------------------------------------------------
function activity() {
  const d = S.activityData;
  if (!d) return '<div class="card emp">Loading activity…</div>';
  return `<div class=row><div><h1>Activity Log</h1><div class=sub>Every change a planner makes, in order.</div></div><span class=sp></span>${graphBtn('act')}${sel('S.activityType', S.activityType, [['', 'All types'], 'Campaign', 'Group', 'Alert', 'Selection', 'System'])}</div>
${G.open.act ? `<div style="margin-top:14px">${activityGraph(d)}</div>` : ''}<div class=card style="margin-top:14px">${d.items.length ? `<div class=tw style="max-height:none"><table><thead><tr><th>When</th><th>Who</th><th>Type</th><th>Action</th><th>Related</th></tr></thead><tbody>${d.items.map((a) => `<tr><td class=sub>${e(a.timestampText)}</td><td>${e(a.userName)}</td><td><span class="bd info">${e(a.type)}</span></td><td>${e(a.actionText)}</td><td class=sub>${e(a.relatedEntity)}</td></tr>`).join('')}</tbody></table></div>` : '<div class=emp>No activity yet.</div>'}</div>`;
}

// ---- Settings -------------------------------------------------------------
const connBadge = (st) => `<span class="bd ${st === 'connected' ? 'ok' : st === 'delayed' ? 'warn' : 'bad'}">${st === 'connected' ? '● Connected' : st === 'delayed' ? '⏱ Delayed' : '✕ Failed'}</span>`;

function settings() {
  const d = S.settingsData;
  if (!d) return '<div class="card emp">Loading settings…</div>';
  const p = S.settingsForm || d.preferences;
  const dirty = JSON.stringify(p) !== JSON.stringify(d.preferences);
  return `<h1>Settings</h1><div class=sub style="margin-bottom:14px">Profile, connections and preferences.</div>
<div class=card><h2>Profile &amp; account</h2><p>${d.user ? `${e(d.user.name)} · ${e(d.user.role)} · ${e(d.user.email)}<br>` : ''}Account: ${e(d.account.name)} · Currency ${e(d.account.currency)} · Timezone ${e(d.account.timezone)}</p></div>
<div class=card><h2>Connected platforms</h2>${d.connections.length ? `<table><tbody>${d.connections.map((c) => `<tr><td>${pl(c.platform)}</td><td>${connBadge(c.status)}</td><td>${c.lastSuccessfulSyncAt ? `Last sync ${e(c.lastSuccessfulSyncAt)}` : 'Never synced'}${c.message ? `<br><span class=sub>${e(c.message)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class=emp>No platforms connected.</div>'}</div>
<div class=card><h2>Preferences</h2>
<label style="display:flex;gap:8px;padding:4px"><input type=checkbox data-pref=dailySummaryEmail ${p.dailySummaryEmail ? 'checked' : ''}> Daily summary email</label>
<label style="display:flex;gap:8px;padding:4px"><input type=checkbox data-pref=notifyImmediateHigh ${p.notifyImmediateHigh ? 'checked' : ''}> Notify immediately for High severity</label>
<div class=fl style="max-width:320px;margin-top:8px"><label for=prp>Default reporting period</label><select id=prp data-pref=defaultReportingPeriod>${d.reportingPeriodOptions.map((o) => `<option ${p.defaultReportingPeriod === o ? 'selected' : ''}>${e(o)}</option>`).join('')}</select></div>
<div class=fl style="max-width:320px"><label for=pmi>Minimum impressions per period</label><input type=number min=0 step=100 id=pmi data-pref=minImpressionsThreshold value="${e(p.minImpressionsThreshold)}"><span class=sub>Below this, comparisons and alerts are flagged as unreliable.</span></div>
<div class=row><button class="btn p" data-a=saveSettings ${dirty ? '' : 'disabled'}>Save changes</button><button class=btn data-a=resetSettings ${dirty ? '' : 'disabled'}>Discard</button></div></div>`;
}

// ---- Modals ---------------------------------------------------------------
const mo = (title, body, wide) => `<div class=mo data-a=modalBg><div class="md ${wide ? 'l' : ''}" role=dialog aria-modal=true aria-label="${e(title)}" tabindex=-1><div class=row><h2>${e(title)}</h2><span class=sp></span><button class=btn data-a=closeModal aria-label="Close">✕</button></div>${body}</div></div>`;

function drillBody() {
  const m = S.modal;
  const d = m.data;
  if (!d) return '<div class=emp>Loading…</div>';
  const c = d.campaign;
  const ads = d.adSets;
  const picked = m.sel.length;
  const total = ads.length;
  const adCell = (a, col) => {
    const r = a.reliability.reasonCode;
    if (r === 'f') return '<span class=n title="Sync failed — data unavailable">—</span>';
    const cur = a.current;
    const ch = a.changes;
    const unrel = !a.reliability.isReliable;
    if (col === 'spend') return `${inr(cur.spend)}<div class=s2>${a.previous.spend ? `prev ${inr(a.previous.spend)} · ${dl(ch.spend.relativePct, 0)}` : 'No baseline'}</div>`;
    if (col === 'impr') return `${num(cur.impressions)}<div class=s2>${a.previous.impressions ? dl(ch.impressions.relativePct, 1) : 'No baseline'}</div>`;
    if (col === 'clicks') return `${num(cur.clicks)}<div class=s2>${a.previous.clicks ? dl(ch.clicks.relativePct, 1) : 'No baseline'}</div>`;
    if (col === 'ctr') return `${pcf(cur.ctr)}<div class=s2>${unrel ? `<span class=w title="${e(a.reliability.reasonText)}">${r === 'l' ? '⚠ Insufficient data' : e(a.reliability.flagText)}</span>` : ppd(ch.ctr)}</div>`;
    return `${inr2(cur.cpc)}<div class=s2>${unrel ? `<span class=w title="${e(a.reliability.reasonText)}">${r === 'l' ? '⚠ Insufficient data' : e(a.reliability.flagText)}</span>` : dl(ch.cpc.relativePct, -1)}</div>`;
  };

  const issues = c.issues || [];
  return `<div class=sub>${pl(c.platform)} · ${e(c.objective)} · ${stb(c.status)} · <span title="${e(c.reliability.reasonText)}">${c.reliability.isReliable ? '✓ Complete data' : e(c.reliability.flagText)}</span></div>
<div class=sub>${e(c.raw)}</div>
${!c.reliability.isReliable ? `<div class=ban style="margin-top:8px">${e(c.reliability.reasonText)}</div>` : ''}
<div class=row style="margin-top:10px">${graphBtn('drill', 'View graph')}</div>${G.open.drill ? drillGraph() : ''}
${issues.length ? `<div style="margin-top:10px">${issues.map((i) => `<div class="iss ${i.severity}" style="padding:7px 10px"><span class="bd ${sevc(i.severity)}">${i.severity}</span><div class=sp><b>${e(i.metric)}: ${e(i.changeDisplay)}</b> <span class=sub>· detected ${e(i.detectedAt)}</span><div class=sub>${e(i.whyText)}</div></div>${i.state === 'open' || i.state === 'reviewed' ? `<button class="btn p" data-a=resolveIssue data-id="${e(i.id)}">Mark resolved</button>` : ''}</div>`).join('')}</div>` : ''}
<h2 style="margin-top:14px">Ad sets <span class=sub>(drilldown stops here; deeper analysis stays in the ad platforms)</span></h2>
${total === 0 ? `<div class=emp><b>${NO_ADSETS}</b><p>It is excluded from comparisons and ad-set-level alerts.</p></div>` : `<div class=row style="margin:8px 0"><label><input type=checkbox data-a=ddAll aria-label="Select all ad sets in this campaign" ${picked === total ? 'checked' : ''} ${picked > 0 && picked < total ? 'data-ind=1' : ''}> <b>${e(c.name)}</b></label><span class=sub aria-live=polite>${picked} of ${total} ad sets selected</span></div>
<div class=tw style="max-height:none"><table><caption class=sr>Ad sets in ${e(c.name)}</caption><thead><tr><th></th><th>Ad set</th><th>Status</th><th class=r>Spend</th><th class=r>Impressions</th><th class=r>Clicks</th><th class=r>CTR</th><th class=r>CPC</th></tr></thead><tbody>${ads
    .map(
      (a) =>
        `<tr class="${m.sel.includes(a.id) ? 'sl' : ''}"><td><input type=checkbox data-a=ddSel data-id="${e(a.id)}" aria-label="Select ${e(a.name)}" ${m.sel.includes(a.id) ? 'checked' : ''}></td><td><b>${e(a.name)}</b><div class=s2>${e(a.audience)}</div></td><td>${stb(a.status)}</td><td class=r>${adCell(a, 'spend')}</td><td class=r>${adCell(a, 'impr')}</td><td class=r>${adCell(a, 'clicks')}</td><td class=r>${adCell(a, 'ctr')}</td><td class=r>${adCell(a, 'cpc')}</td></tr>`
    )
    .join('')}</tbody></table></div>
${picked ? `<div class=bar><b>${picked} of ${total} ad sets selected</b><span class=sub style="color:#C9D1E8">Actions apply to these ad sets only, not the whole campaign.</span><span class=sp></span><button class=btn data-a=ddPause>Pause…</button><button class=btn data-a=ddResume>Resume…</button><button class=btn data-a=ddClear>Clear</button></div>` : ''}`}`;
}

function groupFormBody() {
  const f = S.modal.form;
  return `<form data-a=none onsubmit="return false"><div class=fl><label for=gn>Group name</label><input id=gn data-f=name value="${e(f.name)}" maxlength=80 placeholder="e.g. Diwali Performance"></div>
<div class=fl><label for=gd>Description (optional)</label><input id=gd data-f=description value="${e(f.description)}" maxlength=200></div>
<div class=sub>${S.sel.length ? `${S.sel.length} selected campaign(s) will be added.` : 'Create the group first; add campaigns from the group card.'}</div>
${f.error ? `<div class=er role=alert>${e(f.error)}</div>` : ''}
<div class=row style="margin-top:12px"><span class=sp></span><button class=btn data-a=closeModal type=button>Cancel</button><button class="btn p" data-a=saveGroup type=button>Create group</button></div></form>`;
}

function addGroupBody() {
  const m = S.modal;
  const q = (m.q || '').toLowerCase();
  const list = (m.campaigns || []).filter((c) => !q || c.name.toLowerCase().includes(q));
  const inGroup = new Set(m.memberIds || []);
  return `<div class=fl><label for=agq>Search campaigns</label><input id=agq data-f=q value="${e(m.q || '')}" placeholder="Search…"></div>
${m.groupChoice ? `<div class=fl><label for=agg>Add to group</label><select id=agg data-f=groupId>${(S.groupsData?.groups || []).map((g) => `<option value="${e(g.id)}" ${m.groupId === g.id ? 'selected' : ''}>${e(g.name)}</option>`).join('')}</select></div>` : ''}
<div class=ck>${list.map((c) => `<label><input type=checkbox data-a=agPick data-id=${c.campaignId} ${m.pick.includes(c.campaignId) ? 'checked' : ''} ${inGroup.has(c.campaignId) ? 'disabled' : ''}> ${e(c.name)} ${pl(c.platform)} <span class=sub>${e(c.status)}${inGroup.has(c.campaignId) ? ' · already in group' : ''}</span></label>`).join('') || '<div class=sub>No campaigns match.</div>'}</div>
<div class=sub style="margin-top:6px" aria-live=polite>${m.pick.length} selected · a campaign can appear only once in a group</div>
<div class=row style="margin-top:12px"><span class=sp></span><button class=btn data-a=closeModal>Cancel</button><button class="btn p" data-a=saveAddGroup ${m.pick.length ? '' : 'disabled'}>Add to group</button></div>`;
}

function alertFormBody() {
  const m = S.modal;
  const f = m.form;
  const isChange = f.condition === 'drop' || f.condition === 'rise';
  const rec = m.rec;
  const recKeys = new Set((rec?.recommended || []).map((r) => r.key));
  const metrics = rec?.allMetrics || [];
  const pool =
    f.entityType === 'group'
      ? (S.groupsData?.groups || []).map((g) => ({ id: g.id, label: `${g.name} (${g.campaignCount})` }))
      : f.entityType === 'adsets'
        ? (m.adSets || []).map((a) => ({ id: a.id, label: `${a.campaignName} › ${a.name}` }))
        : (m.campaigns || []).map((c) => ({ id: String(c.campaignId), label: `${c.name} · ${c.objective}` }));
  const test = m.test;
  const row = (r) => `<li>${e(r.label)} — ${e(r.state === 'excluded' ? r.reason : r.message)}${r.provisional ? ' <span class="bd warn">provisional</span>' : ''}</li>`;
  return `<div class=fl><label for=an>Name</label><input id=an data-f=name value="${e(f.name)}" maxlength=80 placeholder="e.g. Lead CPC spike"></div>
<div class=fl><label for=aet>Watch</label><select id=aet data-f=entityType><option value=group ${f.entityType === 'group' ? 'selected' : ''}>A group</option><option value=campaigns ${f.entityType === 'campaigns' ? 'selected' : ''}>Campaigns</option><option value=adsets ${f.entityType === 'adsets' ? 'selected' : ''}>Ad sets</option></select></div>
<div class=ck>${pool.map((p) => `<label><input type=checkbox data-a=alEnt data-id="${e(p.id)}" ${f.entityIds.includes(p.id) ? 'checked' : ''}> ${e(p.label)}</label>`).join('') || '<div class=sub>Nothing to select yet.</div>'}</div>
${rec ? `<div class=sub style="margin:6px 0" aria-live=polite>${e(rec.note)}${rec.recommended.length ? ` <b>Recommended:</b> ${rec.recommended.map((r) => e(r.label)).join(', ')}` : ''}</div>` : ''}
<div class=fl><label for=am>Metric</label><select id=am data-f=metric>${metrics.map((x) => `<option value="${e(x.key)}" ${f.metric === x.key ? 'selected' : ''}>${e(x.label)}${recKeys.has(x.key) ? ' ★ recommended' : ''}${x.applicableObjectives ? ` (${x.applicableObjectives.join('/')} only)` : ''}</option>`).join('') || '<option value=ctr>CTR</option>'}</select></div>
<div class=row><div class=fl style="flex:1"><label for=ac>Condition</label><select id=ac data-f=condition>${Object.entries(CONDITION_LABEL).map(([k, v]) => `<option value=${k} ${f.condition === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class=fl style="flex:1"><label for=at>Threshold ${isChange ? '(%)' : '(value)'}</label><input id=at data-f=threshold type=number min=0 step=any value="${e(f.threshold)}"></div></div>
<div class=row><div class=fl style="flex:1"><label for=ap>Compared with</label><select id=ap data-f=comparisonPeriod>${['Previous day', 'Previous 7 days', 'Previous 30 days'].map((p) => `<option ${f.comparisonPeriod === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div><div class=fl style="flex:1"><label for=af>Notify</label><select id=af data-f=frequency>${['Immediate', 'Daily summary'].map((p) => `<option ${f.frequency === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>
<div class=fl><label for=ar>Recipient email</label><input id=ar data-f=recipient type=email value="${e(f.recipient)}"></div>
${f.error ? `<div class=er role=alert>${e(f.error)}</div>` : ''}
${test ? `<div class=card style="margin:10px 0 0;padding:10px"><b>Test against current data</b> <span class=sub>(dry run, nothing saved)</span><div>Would trigger now: <b>${test.wouldTrigger.length}</b> · within threshold: ${test.ok.length} · excluded: ${test.excluded.length}</div>${test.wouldTrigger.length ? `<ul>${test.wouldTrigger.map(row).join('')}</ul>` : ''}${test.excluded.length ? `<details><summary class=sub>Why ${test.excluded.length} excluded</summary><ul>${test.excluded.map(row).join('')}</ul></details>` : ''}</div>` : ''}
<div class=row style="margin-top:12px"><button class=btn data-a=testAlert>Test against current data</button><span class=sp></span><button class=btn data-a=closeModal>Cancel</button><button class="btn p" data-a=saveAlert>Create alert</button></div>`;
}

function modalHtml() {
  const m = S.modal;
  if (!m) return '';
  if (m.type === 'drill') return mo(m.data?.campaign?.name || 'Campaign', drillBody(), true);
  if (m.type === 'group') return mo('New group', groupFormBody());
  if (m.type === 'addGroup') return mo(m.title, addGroupBody());
  if (m.type === 'alert') return mo('New alert', alertFormBody(), true);
  return '';
}

function confirmHtml() {
  const c = S.confirm;
  if (!c) return '';
  return `<div class=mo style="z-index:30"><div class=md role=alertdialog aria-modal=true aria-label="${e(c.title)}" tabindex=-1><h2>${e(c.title)}</h2><div style="margin:10px 0">${c.lines.map((l) => `<div>${e(l)}</div>`).join('')}</div><div class=sub>Nothing happens until you confirm.</div>${c.error ? `<div class=er role=alert>${e(c.error)}</div>` : ''}<div class=row style="margin-top:12px"><span class=sp></span><button class=btn data-a=confirmNo>Cancel</button><button class="btn p" data-a=confirmYes ${c.busy ? 'disabled' : ''}>${e(c.label || 'Confirm')}</button></div></div></div>`;
}

let lastFocus = null;
function renderModals() {
  const host = $('#modal');
  const host2 = $('#modal2');
  const scrollTop = host.querySelector('.md')?.scrollTop ?? 0;
  const active = document.activeElement;
  const key = active && host.contains(active) ? active.dataset.f || active.id : null;
  const wasOpen = !!host.firstChild;
  host.innerHTML = modalHtml();
  host2.innerHTML = confirmHtml();
  const md = host.querySelector('.md');
  if (md) {
    md.scrollTop = scrollTop;
    if (!wasOpen) {
      lastFocus = document.activeElement;
      md.focus();
    } else if (key) {
      (host.querySelector(`[data-f="${key}"]`) || host.querySelector(`#${CSS.escape(key)}`))?.focus();
    }
  } else if (wasOpen && lastFocus) {
    lastFocus.focus?.();
    lastFocus = null;
  }
  const cm = host2.querySelector('.md');
  if (cm) cm.focus();
  syncIndeterminate();
}

function syncIndeterminate() {
  document.querySelectorAll('[data-ind]').forEach((el) => {
    el.indeterminate = true;
  });
}

const NAV = [
  ['overview', 'Overview', '▦'],
  ['campaigns', 'Campaigns', '☰'],
  ['groups', 'Groups', '❖'],
  ['alerts', 'Alerts', '⚑'],
  ['activity', 'Activity Log', '⟲'],
  ['settings', 'Settings', '⚙'],
];
const PAGE_NAME = Object.fromEntries(NAV.map((n) => [n[0], n[1]]));

function render() {
  const crumbs = ['Governance', PAGE_NAME[S.pg] || S.pg];
  let body = '';
  if (S.pg === 'overview') body = overview();
  else if (S.pg === 'campaigns') body = campaigns();
  else if (S.pg === 'groups') body = groups();
  else if (S.pg === 'alerts') body = alerts();
  else if (S.pg === 'activity') body = activity();
  else if (S.pg === 'settings') body = settings();

  // Preserve scroll and focus across full re-renders (state discipline)
  const sy = window.scrollY;
  const tw = document.querySelector('.tw');
  const twTop = tw ? tw.scrollTop : 0;
  const ae = document.activeElement;
  const focusSel = ae && ae.id && $('#app').contains(ae) ? '#' + CSS.escape(ae.id) : null;
  const selStart = ae && typeof ae.selectionStart === 'number' ? ae.selectionStart : null;

  $('#app').innerHTML = `<aside class="${S.col ? 'c' : ''}"><div class=brand>⚡<span class=lb> VAJRA<small>GOVERNANCE</small></span></div>${NAV.map((n) => `<button class="nv ${S.pg === n[0] ? 'a' : ''}" data-a=nav data-pg=${n[0]} title="${n[1]}" ${S.pg === n[0] ? 'aria-current=page' : ''}><span>${n[2]}</span><span class=lb>${n[1]}</span></button>`).join('')}<span class=sp></span><button class=nv data-a=col title="Collapse sidebar"><span>${S.col ? '»' : '«'}</span><span class=lb>Collapse</span></button></aside>
<div class=mn><header><button class=btn data-a=col aria-label="Toggle sidebar">☰</button><div class=cr>${crumbs.map((c, i) => (i === crumbs.length - 1 ? `<b aria-current=page>${e(c)}</b>` : `<button class=lnk data-a=nav data-pg=overview>${e(c)}</button> / `)).join('')}</div><select aria-label="Account"><option>ACME Cooling India</option></select><span class=sub>${fr(S.cs, S.ce)} vs ${fr(S.ps, S.pe)}</span><div style="position:relative"><button class=btn aria-label="Open issues: ${S.overviewData?.issues?.length || 0}" data-a=bell>🔔 <b class=bad>${S.overviewData?.issues?.length || 0}</b></button></div><div style="position:relative"><button class=btn>PN ▾</button></div></header><main id=main tabindex=-1 ${S.load ? 'style="opacity:.6" aria-busy=true' : ''}>${body}</main></div>`;

  window.scrollTo(0, sy);
  const tw2 = document.querySelector('.tw');
  if (tw2) tw2.scrollTop = twTop;
  if (focusSel) {
    const el = $(focusSel);
    if (el) {
      el.focus();
      if (selStart != null && el.setSelectionRange) {
        try {
          el.setSelectionRange(selStart, selStart);
        } catch {
          /* non-text input */
        }
      }
    }
  }
  syncIndeterminate();
}

function rerenderAll() {
  render();
  renderModals();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function ask(cfg) {
  S.confirm = { label: 'Confirm', error: '', busy: false, ...cfg };
  renderModals();
}

async function openDrill(id, source) {
  S.modal = { type: 'drill', id, data: null, sel: [] };
  G.open.drill = false;
  delete G.ts.drill;
  renderModals();
  api.track('campaign_opened', { campaignId: Number(id), source });
  try {
    S.modal.data = await api.getCampaign(id, dateParams());
  } catch (err) {
    toast(err.message, 1);
    S.modal = null;
  }
  renderModals();
}

async function refreshAfterMutation() {
  await loadData();
  if (S.modal?.type === 'drill') {
    try {
      const keep = S.modal.sel;
      S.modal.data = await api.getCampaign(S.modal.id, dateParams());
      S.modal.sel = keep.filter((id) => S.modal.data.adSets.some((a) => a.id === id));
    } catch {
      /* keep stale view */
    }
  }
  renderModals();
}

function bulkConfirm(action, campaignIds, adSetIds, labelCtx) {
  const verb = action === 'pause' ? 'Pause' : 'Resume';
  const total = S.campaignsData?.pagination.total ?? campaignIds.length;
  const lines = adSetIds.length
    ? [`${verb} ${adSetIds.length} of ${labelCtx.adSetTotal} ad sets in "${labelCtx.name}".`, 'Only the selected ad sets change — not the whole campaign.']
    : [`${verb} ${campaignIds.length} of ${total} campaign${total === 1 ? '' : 's'}.`, 'Only the selected campaigns change. Ended campaigns are skipped.'];
  ask({
    title: `${verb} — confirm scope`,
    lines,
    label: `${verb} ${adSetIds.length || campaignIds.length}`,
    run: async () => {
      const r = await api.bulkStatus({ action, campaignIds, adSetIds, confirm: true, totalCampaigns: total });
      const n = r.applied.length;
      toast(`${verb}d ${n} item${n === 1 ? '' : 's'}${r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped[0].reason})` : ''}.`, r.skipped.length && !n ? 1 : 0);
      S.sel = [];
      if (S.modal?.type === 'drill') S.modal.sel = [];
      await refreshAfterMutation();
    },
  });
  api.track('bulk_selected', { selectedCount: adSetIds.length || campaignIds.length, source: adSetIds.length ? 'drilldown' : 'campaign_table', payload: { action } });
}

const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function exportCsv() {
  const res = await guarded(() => api.getCampaigns({ ...dateParams(), q: T.q, plat: T.plat, obj: T.obj, st: T.st, perf: T.perf, tab: T.tab, sort: T.sort, dir: T.dir, page: 0, size: 200 }));
  if (!res) return;
  const rows = S.sel.length ? res.items.filter((r) => S.sel.includes(r.campaignId)) : res.items;
  const header = ['Campaign', 'Platform', 'Objective', 'Status', 'Data state', 'Spend', 'Prev spend', 'Impressions', 'Clicks', 'CTR %', 'CPC'];
  const lines = rows.map((r) => {
    const gone = unavailable(r); // unavailable data stays blank, never 0
    return [r.name, r.platform, r.objective, r.status, r.reliability.status, gone ? '' : r.current.spend, gone ? '' : r.previous.spend, gone ? '' : r.current.impressions, gone ? '' : r.current.clicks, gone ? '' : r.current.ctr?.toFixed(2), gone ? '' : r.current.cpc?.toFixed(2)].map(csvCell).join(',');
  });
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vajra-campaigns-${S.ce}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  api.track('export_clicked', { source: S.pg, selectedCount: S.sel.length, payload: { sinceOpenedSec: Math.round((Date.now() - S.openedAt) / 1000), rows: rows.length } });
  toast(`Exported ${rows.length} campaign${rows.length === 1 ? '' : 's'}.`);
}

const blankAlert = () => ({ name: '', entityType: 'group', entityIds: [], metric: 'ctr', condition: 'drop', threshold: '15', comparisonPeriod: 'Previous 7 days', recipient: 'planner@acme.example', frequency: 'Daily summary', error: '' });

async function refreshRecommendation() {
  const f = S.modal.form;
  if (!f.entityIds.length) {
    S.modal.rec = S.modal.rec ? { ...S.modal.rec, recommended: [], isMixed: true, note: 'Select what to watch to see recommended metrics.' } : null;
    return;
  }
  try {
    S.modal.rec = await api.getRecommendations(f.entityType, f.entityIds);
    // objective-aware default: pre-select the first recommendation unless the planner already chose a metric
    if (!S.modal.metricTouched && S.modal.rec.recommended.length) f.metric = S.modal.rec.recommended[0].key;
  } catch {
    /* recommendation is optional */
  }
}

const alertPayload = (f) => ({ name: f.name, entityType: f.entityType, entityIds: f.entityIds.map((x) => (f.entityType === 'campaigns' ? Number(x) : x)), metric: f.metric, condition: f.condition, threshold: Number(f.threshold), comparisonPeriod: f.comparisonPeriod, recipient: f.recipient, frequency: f.frequency });

const A = {
  none: () => {},
  graph: async (d) => {
    const k = d.k;
    G.open[k] = !G.open[k];
    rerenderAll();
    if (!G.open[k]) return;
    if (k === 'tbl') await loadTs('sel');
    else await loadTs(k);
    rerenderAll();
  },
  gmetric: (d) => {
    G.metric = d.v;
    rerenderAll();
  },
  tmetric: (d) => {
    G.tblMetric = d.v;
    render();
  },
  nav: (d) => {
    S.pg = d.pg;
    S.sel = S.pg === 'overview' || S.pg === 'campaigns' ? S.sel : [];
    if (d.pg === 'groups') api.track('group_opened', { source: 'nav' });
    loadData({ evaluate: d.pg === 'alerts' });
  },
  bell: () => {
    S.pg = 'overview';
    loadData();
  },
  pre: (d) => {
    if (d.v === 'c') return;
    [S.cs, S.ce, S.ps, S.pe] = PRE[d.v];
    S.auto = true;
    api.track('period_changed', { source: 'preset', payload: { preset: d.v } });
    loadData();
    toast(`Comparing ${fr(S.cs, S.ce)} with ${fr(S.ps, S.pe)}`);
  },
  autoP: () => {
    S.auto = !S.auto;
    if (S.auto && S.cs && S.ce && S.ce >= S.cs) {
      const L = days(S.cs, S.ce);
      S.pe = addD(S.cs, -1);
      S.ps = addD(S.pe, -(L - 1));
      loadData();
    }
  },
  tab: (d) => {
    T.tab = d.v;
    T.page = 0;
    loadData();
  },
  sort: (d) => {
    T.dir = T.sort === d.k ? -T.dir : -1;
    T.sort = d.k;
    if (d.k === 'name') T.dir = 1;
    loadData();
  },
  pg: (d) => {
    T.page += +d.d;
    loadData();
  },
  clr: () => {
    Object.assign(T, { q: '', plat: '', obj: '', st: '', perf: '', tab: 'all', page: 0 });
    loadData();
  },
  col: () => {
    S.col = !S.col;
    render();
  },
  cm: () => {
    T.cm = !T.cm;
    render();
  },
  colv: (d) => {
    T.hid = T.hid.includes(d.k) ? T.hid.filter((k) => k !== d.k) : [...T.hid, d.k];
    render();
  },
  sel: (d) => {
    const i = +d.id;
    S.sel = S.sel.includes(i) ? S.sel.filter((x) => x !== i) : [...S.sel, i];
    render();
    schedSelGraph();
  },
  selAll: () => {
    if (!S.campaignsData) return;
    const ids = S.campaignsData.items.map((r) => r.campaignId);
    if (ids.every((i) => S.sel.includes(i))) {
      S.sel = S.sel.filter((i) => !ids.includes(i));
    } else {
      S.sel = [...new Set([...S.sel, ...ids])];
    }
    render();
    schedSelGraph();
  },
  clrSel: () => {
    S.sel = [];
    render();
    schedSelGraph();
  },
  attTab: () => {
    T.tab = 'att';
    T.page = 0;
    loadData();
  },
  issAll: () => {
    S.issAll = !S.issAll;
    render();
  },
  refresh: async () => {
    G.ts = {};
    if (S.pg === 'overview') await guarded(() => api.evaluateAlerts());
    await loadData({ evaluate: S.pg === 'alerts' });
    toast('Data refreshed from backend.');
  },
  exportCsv,

  // ---- issues
  openCamp: (d) => openDrill(d.id, S.pg),
  openIssue: async (d) => {
    await guarded(() => api.openIssue(d.id, 'triage')); // issue_opened: the measured investigation moment
    openDrill(d.cid, 'issue');
  },
  revIssue: async (d) => {
    if (await guarded(() => api.reviewIssue(d.id), 'Issue marked reviewed.')) loadData();
  },
  disIssue: async (d) => {
    if (await guarded(() => api.dismissIssue(d.id, 'triage'), 'Issue dismissed.')) loadData();
  },
  resolveIssue: async (d) => {
    if (await guarded(() => api.resolveIssue(d.id, 'drilldown'), 'Issue resolved.')) refreshAfterMutation();
  },

  // ---- modal plumbing
  closeModal: () => {
    S.modal = null;
    S.confirm = null;
    renderModals();
  },
  modalBg: (d, ev) => {
    if (ev.target.classList.contains('mo')) A.closeModal();
  },
  confirmNo: () => {
    api.track('bulk_action_cancelled', { source: 'confirm' });
    S.confirm = null;
    renderModals();
  },
  confirmYes: async () => {
    const c = S.confirm;
    if (!c || c.busy) return;
    c.busy = true;
    c.error = '';
    renderModals();
    try {
      await c.run();
      S.confirm = null;
    } catch (err) {
      c.busy = false;
      c.error = err.message;
    }
    renderModals();
  },

  // ---- bulk (campaign table)
  bulkPause: () => bulkConfirm('pause', S.sel, [], {}),
  bulkResume: () => bulkConfirm('resume', S.sel, [], {}),
  bulkAddGroup: async () => {
    const [g, all] = await Promise.all([S.groupsData ? Promise.resolve(S.groupsData) : guarded(() => api.getGroups(dateParams())), guarded(() => api.getCampaigns({ ...dateParams(), size: 200 }))]);
    if (!g || !all) return;
    S.groupsData = g;
    if (!g.groups.length) return toast('Create a group first (Groups → New group).', 1);
    S.modal = { type: 'addGroup', title: `Add ${S.sel.length} campaign(s) to a group`, groupChoice: true, groupId: g.groups[0].id, campaigns: all.items.filter((c) => S.sel.includes(c.campaignId)), pick: [...S.sel], q: '', memberIds: g.groups[0].members.map((m) => m.campaignId) };
    renderModals();
  },

  // ---- drilldown ad-set selection
  ddSel: (d) => {
    const m = S.modal;
    m.sel = m.sel.includes(d.id) ? m.sel.filter((x) => x !== d.id) : [...m.sel, d.id];
    renderModals();
  },
  ddAll: () => {
    const m = S.modal;
    const ids = m.data.adSets.map((a) => a.id);
    m.sel = m.sel.length === ids.length ? [] : ids;
    renderModals();
  },
  ddClear: () => {
    S.modal.sel = [];
    renderModals();
  },
  ddPause: () => bulkConfirm('pause', [], S.modal.sel, { name: S.modal.data.campaign.name, adSetTotal: S.modal.data.adSets.length }),
  ddResume: () => bulkConfirm('resume', [], S.modal.sel, { name: S.modal.data.campaign.name, adSetTotal: S.modal.data.adSets.length }),

  // ---- groups
  toggleGroup: (d) => {
    S.openGroups[d.id] = !S.openGroups[d.id];
    if (S.openGroups[d.id]) api.track('group_opened', { groupId: d.id, source: 'groups_page' });
    render();
  },
  newGroup: () => {
    S.modal = { type: 'group', form: { name: '', description: '', error: '' } };
    renderModals();
  },
  saveGroup: async () => {
    const f = S.modal.form;
    f.error = '';
    try {
      const r = await api.createGroup({ name: f.name, description: f.description, campaignIds: S.sel });
      toast(`Group "${r.name}" created${r.added.length ? ` with ${r.added.length} campaign(s)` : ''}.`);
      S.modal = null;
      S.sel = [];
      await loadData();
      renderModals();
    } catch (err) {
      f.error = err.body?.details ? err.body.details.join('; ') : err.message;
      renderModals();
    }
  },
  addToGroupModal: async (d) => {
    const all = await guarded(() => api.getCampaigns({ ...dateParams(), size: 200 }));
    if (!all) return;
    const g = S.groupsData.groups.find((x) => x.id === d.id);
    S.modal = { type: 'addGroup', title: `Add campaigns to ${g.name}`, groupChoice: false, groupId: g.id, campaigns: all.items, pick: [], q: '', memberIds: g.members.map((m) => m.campaignId) };
    renderModals();
  },
  agPick: (d) => {
    const m = S.modal;
    const id = +d.id;
    m.pick = m.pick.includes(id) ? m.pick.filter((x) => x !== id) : [...m.pick, id];
    renderModals();
  },
  saveAddGroup: async () => {
    const m = S.modal;
    try {
      const r = await api.addToGroup(m.groupId, m.pick);
      const dup = r.skipped.filter((s) => s.reason === 'duplicate').length;
      toast(`Added ${r.added.length} campaign(s)${dup ? ` · ${dup} already in the group were not added again` : ''}.`);
      S.modal = null;
      S.sel = [];
      await loadData();
      renderModals();
    } catch (err) {
      // 409: every selected campaign was already a member — blocked so totals aren't double-counted
      toast(err.message, 1);
    }
  },
  rmMember: (d) => {
    const g = S.groupsData.groups.find((x) => x.id === d.g);
    const m = g.members.find((x) => String(x.campaignId) === d.id);
    ask({
      title: 'Remove from group?',
      lines: [`Remove "${m.name}" from "${g.name}".`, "The group's combined totals will change."],
      label: 'Remove',
      run: async () => {
        await api.removeFromGroup(d.g, d.id);
        toast('Removed from group.');
        await loadData();
      },
    });
  },
  delGroup: (d) => {
    const g = S.groupsData.groups.find((x) => x.id === d.id);
    ask({
      title: `Delete group "${g.name}"?`,
      lines: [`${g.campaignCount} campaign(s) stay in your account; only the group is removed.`],
      label: 'Delete group',
      run: async () => {
        await api.deleteGroup(d.id);
        toast('Group deleted.');
        await loadData();
      },
    });
  },

  // ---- alerts
  newAlert: async () => {
    const [groups, all, ads] = await Promise.all([S.groupsData ? Promise.resolve(S.groupsData) : guarded(() => api.getGroups(dateParams())), guarded(() => api.getCampaigns({ ...dateParams(), size: 200 })), guarded(() => api.getAdSets())]);
    if (!all) return;
    S.groupsData = groups;
    S.modal = { type: 'alert', form: blankAlert(), campaigns: all.items, adSets: ads?.items || [], rec: null, test: null, metricTouched: false };
    // load the metric catalogue for the select
    try {
      const first = S.groupsData?.groups?.[0];
      S.modal.rec = await api.getRecommendations('campaigns', [String(all.items[0].campaignId)]);
      S.modal.rec = { ...S.modal.rec, recommended: [], isMixed: true, note: first ? 'Select what to watch to see recommended metrics.' : 'Select campaigns to watch.' };
    } catch {
      /* catalogue falls back to CTR */
    }
    renderModals();
  },
  alEnt: async (d) => {
    const f = S.modal.form;
    f.entityIds = f.entityIds.includes(d.id) ? f.entityIds.filter((x) => x !== d.id) : [...f.entityIds, d.id];
    S.modal.test = null;
    await refreshRecommendation();
    renderModals();
  },
  testAlert: async () => {
    const f = S.modal.form;
    f.error = '';
    try {
      S.modal.test = await api.testAlert({ ...alertPayload(f), name: f.name || 'Test' });
    } catch (err) {
      S.modal.test = null;
      f.error = err.body?.details ? err.body.details.join('; ') : err.message;
    }
    renderModals();
  },
  saveAlert: async () => {
    const f = S.modal.form;
    f.error = '';
    try {
      const r = await api.createAlert(alertPayload(f));
      toast(`Alert created.${r.warnings.length ? ' ' + r.warnings[0] : ''}`, r.warnings.length);
      S.modal = null;
      await loadData({ evaluate: true });
      renderModals();
    } catch (err) {
      f.error = err.body?.details ? err.body.details.join('; ') : err.message;
      renderModals();
    }
  },
  evalAlerts: async () => {
    const r = await guarded(() => api.evaluateAlerts());
    if (r) toast(`Evaluated ${r.evaluatedRules} rule(s): ${r.fired.length} new, ${r.suppressedDuplicates} duplicate(s) suppressed, ${r.recovered} recovered.`);
    loadData();
  },
  ruleToggle: async (d) => {
    if (await guarded(() => api.setAlertStatus(d.id, d.v), `Alert ${d.v === 'Paused' ? 'paused' : 'resumed'}.`)) loadData();
  },
  ruleDel: (d) => {
    const r = S.alertsData.rules.find((x) => x.id === d.id);
    ask({
      title: `Delete alert "${r.name}"?`,
      lines: ['Its trigger history, including reviews used for alert-quality measurement, is deleted too.'],
      label: 'Delete alert',
      run: async () => {
        await api.deleteAlert(d.id);
        toast('Alert deleted.');
        await loadData();
      },
    });
  },
  openTrigger: async (d) => {
    await guarded(() => api.openTrigger(d.id));
    loadData();
    toast('Marked as investigated.');
  },
  disTrigger: async (d) => {
    if (await guarded(() => api.dismissTrigger(d.id), 'Alert dismissed.')) loadData();
  },
  fb: async (d) => {
    if (await guarded(() => api.reviewTrigger(d.id, d.v), 'Thanks — recorded for alert-quality tracking.')) loadData();
  },

  saveSettings: async () => {
    if (!S.settingsForm) return;
    const f = S.settingsForm;
    const n = Number(f.minImpressionsThreshold);
    if (!Number.isInteger(n) || n < 0) return toast('Minimum impressions must be a whole number, 0 or more.', 1);
    if (await guarded(() => api.saveSettings({ ...f, minImpressionsThreshold: n }), 'Settings saved.')) loadData();
  },
  resetSettings: () => {
    S.settingsForm = { ...S.settingsData.preferences };
    render();
  },
};

// Event listeners
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-a]');
  if (!t) return;
  const f = A[t.dataset.a];
  if (f) f(t.dataset, ev);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (S.confirm) A.confirmNo();
  else if (S.modal) A.closeModal();
});

let searchTimeout;
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.f !== undefined && S.modal) {
    const k = t.dataset.f;
    if (S.modal.form && k in S.modal.form) S.modal.form[k] = t.value;
    if (S.modal.type === 'addGroup' && k === 'q') {
      S.modal.q = t.value;
      renderModals();
    }
    return;
  }
  const k = t.dataset.set;
  if (!k) return;
  const val = t.value;
  if (k === 'T.q') {
    T.q = val;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      T.page = 0;
      loadData();
    }, 350);
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.dataset.f !== undefined && S.modal) {
    const k = t.dataset.f;
    if (S.modal.type === 'alert') {
      const f = S.modal.form;
      f[k] = t.value;
      S.modal.test = null;
      if (k === 'metric') S.modal.metricTouched = true;
      if (k === 'entityType') {
        f.entityIds = [];
        S.modal.metricTouched = false;
        await refreshRecommendation();
      }
      renderModals();
    } else if (S.modal.type === 'addGroup' && k === 'groupId') {
      S.modal.groupId = t.value;
      const g = S.groupsData.groups.find((x) => x.id === t.value);
      S.modal.memberIds = g.members.map((m) => m.campaignId);
      renderModals();
    }
    return;
  }
  if (t.dataset.pref && S.settingsForm) {
    S.settingsForm[t.dataset.pref] = t.type === 'checkbox' ? t.checked : t.value;
    render();
    return;
  }
  const k = t.dataset.set;
  if (!k) return;
  const val = t.value;
  if (k === 'T.plat' || k === 'T.obj' || k === 'T.st' || k === 'T.perf') {
    T[k.slice(2)] = val;
    T.page = 0;
    loadData();
  } else if (k === 'T.size') {
    T.size = +val;
    T.page = 0;
    loadData();
  } else if (k === 'S.activityType') {
    S.activityType = val;
    loadData();
  } else if (k === 'S.cs' || k === 'S.ce' || k === 'S.ps' || k === 'S.pe') {
    S[k.slice(2)] = val;
    if (k === 'S.cs' || k === 'S.ce') {
      if (S.auto && S.cs && S.ce && S.ce >= S.cs) {
        const L = days(S.cs, S.ce);
        S.pe = addD(S.cs, -1);
        S.ps = addD(S.pe, -(L - 1));
      }
    }
    api.track('period_changed', { source: 'custom' });
    loadData();
  }
});

initChartHover();

// Initial boot: governance_opened starts the session (the "B" clock), then the alert engine runs.
api.track('governance_opened', { source: 'overview' });
api.evaluateAlerts().catch(() => {});
loadData();
