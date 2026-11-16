import { api } from './api.js';

const $ = (s) => document.querySelector(s);
const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => (n == null ? 'N/A' : Math.round(n).toLocaleString('en-IN'));
const inr = (n) => (n == null ? 'N/A' : '₹' + Math.round(n).toLocaleString('en-IN'));
const inr2 = (n) => (n == null ? 'N/A' : '₹' + n.toFixed(2));
const pcf = (n) => (n == null ? 'N/A' : n.toFixed(2) + '%');
const pp = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2);
const sg = (v) => (v == null ? 'N/A' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%');
const dl = (v, g) =>
  v == null
    ? '<span class=n title="Previous value is zero or missing, so % change is undefined (not shown as 0 or infinity)">N/A</span>'
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

const kpi = (t, v, tip, sub, d) =>
  `<div class=card title="${tip}"><div class=sub>${t} ⓘ</div><div class=kv>${v}</div><div>${d || ''} <span class=sub>${sub || ''}</span></div></div>`;

const sel = (set, v, opts, id) =>
  `<select data-set="${set}" ${id ? 'id=' + id : ''}>${opts
    .map((o) => {
      const [k, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${e(k)}" ${String(k) === String(v) ? 'selected' : ''}>${e(l)}</option>`;
    })
    .join('')}</select>`;

const s2 = (c, pv, f, ch) => {
  if (c.reliability.reasonCode === 'd') {
    return `<div class=s2 title="Partial data: values may be incomplete">⏱ Delayed · synced ${c.lastSync}</div>`;
  }
  if (!pv) {
    return '<div class=s2>No baseline</div>';
  }
  return `<div class=s2>prev ${f(pv)} · ${ch}</div>`;
};

const flag = (c) => {
  const rel = c.reliability;
  return `<span class=w title="${e(rel.reasonText)}">${rel.flagText}</span>`;
};

// Global state
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
  issAll: false,
  dd: null,
  toast: null,
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
  setTimeout(() => d.remove(), 3000);
};

// Data loading functions
async function loadData() {
  S.load = true;
  render();

  try {
    const dateParams = {
      current_start: S.cs,
      current_end: S.ce,
      previous_start: S.ps,
      previous_end: S.pe,
    };

    if (S.pg === 'overview') {
      S.overviewData = await api.getOverview(dateParams);
    }

    if (S.pg === 'overview' || S.pg === 'campaigns') {
      S.campaignsData = await api.getCampaigns({
        ...dateParams,
        q: T.q,
        plat: T.plat,
        obj: T.obj,
        st: T.st,
        perf: T.perf,
        tab: T.tab,
        sort: T.sort,
        dir: T.dir,
        page: T.page,
        size: T.size,
      });
    }
  } catch (err) {
    toast(`Error loading data: ${err.message}`, 1);
  } finally {
    S.load = false;
    render();
  }
}

// Components
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
${isProv ? '<div class=ban style="margin:8px 0 0">⚠ <b>Provisional data:</b> the current period includes today (data through 09:00). Totals are partial and comparisons may overstate declines. Alerts are not evaluated on provisional data.</div>' : ''}${dc !== dp ? `<div class=ban style="margin:8px 0 0">⚠ The periods differ in length (${dc} vs ${dp} days). Spend, impressions and clicks changes partly reflect that difference; CTR and CPC are unaffected.</div>` : ''}</div>`;
}

function triage(is) {
  if (!is) is = [];
  const n = { High: 0, Medium: 0, Info: 0 };
  is.forEach((i) => n[i.severity]++);
  const sh = S.issAll ? is : is.slice(0, 4);

  return `<div class=card><div class=row><h2>Needs your attention</h2>${['High', 'Medium', 'Info'].map((k) => (n[k] ? `<span class="bd ${sevc(k)}">${n[k]} ${k}</span>` : '')).join('')}<span class=sub>${is.length} open · most severe first</span><span class=sp></span>${is.length ? '<button class=btn data-a=attTab>Show these in table ↓</button>' : ''}</div><div style="margin-top:10px">${is.length ? sh.map((i) => `<div class="iss ${i.severity}" style="padding:7px 10px"><span class="bd ${sevc(i.severity)}">${i.severity}</span><div class=sp><b>${e(i.campaignName)}</b> ${pl(i.platform)} · ${i.metric}: <b>${i.changeDisplay}</b> <span class=sub>· detected ${i.detectedAt}</span><div class=sub>${e(i.whyText)}</div></div><button class="btn p" data-a=openCamp data-id=${i.campaignId}>View campaign</button><button class=btn data-a=revIssue data-id=${i.id}>Mark reviewed</button><button class=btn data-a=disIssue data-id=${i.id}>Dismiss</button></div>`).join('') : '<div class=emp>All caught up — no open issues.</div>'}${is.length > 4 ? `<button class=btn data-a=issAll>${S.issAll ? 'Show top 4 only' : `Show all ${is.length} issues`}</button>` : ''}</div></div>`;
}

function table() {
  if (!S.campaignsData) {
    return '<div class="card emp">Loading campaign performance data…</div>';
  }

  const { items, pagination, tabCounts } = S.campaignsData;
  const cols = COLS.filter((c) => !T.hid.includes(c[0]));
  const allSel = items.length && items.every((r) => S.sel.includes(r.campaignId));

  const tabBtn = (k, l, count) => `<button class="${T.tab === k ? 'a' : ''}" data-a=tab data-v=${k}>${l} <span class=sub>${count}</span></button>`;

  return `<div class=card id=tbl><div class=tabs role=tablist>${tabBtn('all', 'All campaigns', tabCounts.all)}${tabBtn('att', 'Needs attention', tabCounts.att)}${tabBtn('imp', 'Improving', tabCounts.imp)}${tabBtn('dec', 'Declining', tabCounts.dec)}${tabBtn('Paused', 'Paused', tabCounts.Paused)}${tabBtn('Ended', 'Ended', tabCounts.Ended)}</div>
<div class=row style="margin-bottom:10px"><input id=sq data-set=T.q value="${e(T.q)}" placeholder="Search campaign name…" aria-label="Search campaigns" style="width:220px">${sel('T.plat', T.plat, [['', 'All platforms'], 'Meta', 'Google'])}${sel('T.obj', T.obj, [['', 'All objectives'], 'Awareness', 'Traffic', 'Engagement', 'Leads', 'Sales', 'App Promotion'])}${sel('T.st', T.st, [['', 'All statuses'], 'Active', 'Learning', 'Paused', 'Ended'])}${sel('T.perf', T.perf, [['', 'Any performance'], ['imp', 'Improving CTR'], ['dec', 'Declining CTR']])}<button class=btn data-a=clr>Clear filters</button><span class=sp></span><div style="position:relative" data-dd><button class=btn data-a=cm>Columns ▾</button>${T.cm ? `<div class=dd style="width:200px">${COLS.map((c) => `<label style="display:flex;gap:8px;padding:4px"><input type=checkbox data-a=colv data-k=${c[0]} ${T.hid.includes(c[0]) ? '' : 'checked'}>${c[1]}</label>`).join('')}</div>` : ''}</div></div>
${items.length ? `<div class="tw cs"><table><caption class=sr>Campaign performance, current vs previous period</caption><thead><tr><th><input type=checkbox aria-label="Select all visible" data-a=selAll ${allSel ? 'checked' : ''}></th><th scope=col aria-sort="${T.sort === 'name' ? (T.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-a=sort data-k=name>Campaign ${T.sort === 'name' ? (T.dir > 0 ? '▲' : '▼') : ''}</button></th><th>Platform</th><th>Objective</th><th>Status</th>${cols.map((c) => `<th scope=col class=r aria-sort="${T.sort === c[0] ? (T.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-a=sort data-k=${c[0]}>${c[1]} ${T.sort === c[0] ? (T.dir > 0 ? '▲' : '▼') : ''}</button></th>`).join('')}<th>Updated</th></tr></thead><tbody>${items.map((r) => `<tr class="${S.sel.includes(r.campaignId) ? 'sl' : ''}"><td><input type=checkbox aria-label="Select ${e(r.name)}" data-a=sel data-id=${r.campaignId} ${S.sel.includes(r.campaignId) ? 'checked' : ''}></td><td><button class=lnk data-a=openCamp data-id=${r.campaignId}>${e(r.name)}</button><div class=raw title="${e(r.raw)}">${e(r.raw)}</div>${(r.issues || []).map((i) => `<span class="bd ${sevc(i.severity)}" title="${e(i.whyText)}">⚑ ${i.metric} ${i.changeDisplay}</span>`).join(' ')}</td><td>${pl(r.platform)}</td><td>${r.objective}</td><td>${stb(r.status)}</td>${cols.map((c) => `<td class=r>${r.reliability.reasonCode === 'f' || r.reliability.reasonCode === 'n' ? '<span class=n title="Metrics unavailable">—</span>' : c[3](r) + (c[4] ? c[4](r) : '')}</td>`).join('')}<td class=sub>${r.reliability.reasonCode === 'd' ? '<span class=w>⏱ ' : '<span>'}${r.lastSync}</span></td></tr>`).join('')}</tbody></table></div>
<div class=row style="margin-top:8px"><span class=sub>${pagination.total} campaigns · ${S.sel.length} selected</span><span class=sp></span>Rows ${sel('T.size', T.size, [10, 25, 50])}<button class=btn data-a=pg data-d=-1 ${pagination.page ? '' : 'disabled'}>‹ Prev</button><span>${pagination.page + 1} / ${pagination.totalPages}</span><button class=btn data-a=pg data-d=1 ${pagination.page + 1 >= pagination.totalPages ? 'disabled' : ''}>Next ›</button></div>` : `<div class=emp><b>No campaigns match these filters</b><p>No data to show for this view. Clear the filters or change the reporting period.</p><button class="btn p" data-a=clr>Clear filters</button></div>`}
${S.sel.length ? `<div class=bar role=region aria-label="Bulk actions for selected campaigns"><b>${S.sel.length} campaign${S.sel.length > 1 ? 's' : ''} selected</b><span class=sp></span><button class=btn data-a=clrSel>Clear selection</button></div>` : ''}</div>`;
}

function overview() {
  const d = S.overviewData;
  if (!d) return '<div class="card emp">Loading overview…</div>';

  const dq = d.dataQuality;
  const kpis = d.kpis;
  const stale = (dq.hasDelayedGoogle ? ' · ⏱ incl. delayed data' : '') + (dq.hasFailedSync ? ' · excl. 1 failed sync' : '') + (dq.isProvisional ? ' · provisional' : '');

  return `<div class=row><div><h1>Governance</h1><div class=sub>Your campaign performance, changes and priorities in one place.</div></div><span class=sp></span><span class=sub>Server-driven · Last synced: Nov 15, 08:40 · ${S.load ? '⟳ Refreshing…' : ''}</span><button class=btn data-a=refresh ${S.load ? 'disabled' : ''}>⟳ Refresh data</button></div>
${period()}${dq.hasDelayedGoogle ? `<div class=ban>⏱ <b>Google Ads connection delayed.</b> Meta data is current; ${dq.delayedGoogleCount} Google campaign(s) show last-synced values, so Google-attributed totals below may be incomplete.</div>` : ''}
<div class=kp>${kpi('Total campaigns', '148', 'Campaigns in the ACME Cooling India account.', `${kpis.totalCampaigns} in sample`)}${kpi('Active campaigns', '126', 'Campaigns currently delivering.', `${kpis.activeCampaigns} in sample`)}${kpi('Total spend', inr(kpis.spend), 'Sum of spend across sample campaigns for the selected period.', `prev ${inr(kpis.prevSpend)}${stale}`, dl(kpis.spendChange, 0))}${kpi('Impressions', num(kpis.impressions), 'Times ads were shown.', `prev ${num(kpis.prevImpressions)}${stale}`, dl(kpis.impressionsChange, 1))}${kpi('Clicks', num(kpis.clicks), 'Clicks on ads.', `prev ${num(kpis.prevClicks)}${stale}`, dl(kpis.clicksChange, 1))}${kpi('Active alerts', d.issues.length, 'Open issues needing review (not dismissed).', `${kpis.activeRulesCount} rules running`)}</div>
${triage(d.issues)}${table()}`;
}

function campaigns() {
  return `<h1>Campaigns</h1><div class=sub style="margin-bottom:12px">All campaigns across Meta and Google.</div>${period()}${table()}`;
}

const NAV = [
  ['overview', 'Overview', '▦'],
  ['campaigns', 'Campaigns', '☰'],
  ['groups', 'Groups', '❖'],
  ['alerts', 'Alerts', '⚑'],
  ['activity', 'Activity Log', '⟲'],
  ['settings', 'Settings', '⚙'],
];

function render() {
  const crumbs = ['Governance', S.pg === 'overview' ? 'Overview' : S.pg === 'campaigns' ? 'Campaigns' : S.pg];
  let body = '';
  if (S.pg === 'overview') body = overview();
  else if (S.pg === 'campaigns') body = campaigns();
  else body = `<div class=card><h2>${S.pg.toUpperCase()}</h2><p>Screen will be wired in upcoming phase.</p></div>`;

  $('#app').innerHTML = `<aside class="${S.col ? 'c' : ''}"><div class=brand>⚡<span class=lb> VAJRA<small>GOVERNANCE</small></span></div>${NAV.map((n) => `<button class="nv ${S.pg === n[0] ? 'a' : ''}" data-a=nav data-pg=${n[0]} title="${n[1]}" ${S.pg === n[0] ? 'aria-current=page' : ''}><span>${n[2]}</span><span class=lb>${n[1]}</span></button>`).join('')}<span class=sp></span><button class=nv data-a=col title="Collapse sidebar"><span>${S.col ? '»' : '«'}</span><span class=lb>Collapse</span></button></aside>
<div class=mn><header><button class=btn data-a=col aria-label="Toggle sidebar">☰</button><div class=cr>${crumbs.map((c, i) => (i === crumbs.length - 1 ? `<b aria-current=page>${e(c)}</b>` : `<button class=lnk data-a=nav data-pg=${c.toLowerCase()}>${e(c)}</button> / `)).join('')}</div><select aria-label="Account"><option>ACME Cooling India</option></select><span class=sub>${fr(S.cs, S.ce)} vs ${fr(S.ps, S.pe)}</span><div style="position:relative"><button class=btn aria-label="Notifications">🔔 <b class=bad>${S.overviewData?.issues?.length || 0}</b></button></div><div style="position:relative"><button class=btn>PN ▾</button></div></header><main id=main tabindex=-1 ${S.load ? 'style="opacity:.6" aria-busy=true' : ''}>${body}</main></div>`;
}

// Action Dispatcher
const A = {
  nav: (d) => {
    S.pg = d.pg;
    loadData();
  },
  pre: (d) => {
    if (d.v === 'c') return;
    [S.cs, S.ce, S.ps, S.pe] = PRE[d.v];
    S.auto = true;
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
  },
  clrSel: () => {
    S.sel = [];
    render();
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
  refresh: () => {
    loadData();
    toast('Data refreshed from backend.');
  },
  openCamp: (d) => {
    toast(`Drill-down for campaign ${d.id} wired in Phase 3.`);
  },
  revIssue: (d) => {
    toast(`Issue ${d.id} reviewed (Phase 3 flow).`);
  },
  disIssue: (d) => {
    toast(`Issue ${d.id} dismissed (Phase 3 flow).`);
  },
};

// Event listener
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-a]');
  if (!t) return;
  const f = A[t.dataset.a];
  if (f) f(t.dataset, ev);
});

let searchTimeout;
document.addEventListener('input', (ev) => {
  const t = ev.target;
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

document.addEventListener('change', (ev) => {
  const t = ev.target;
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
  } else if (k === 'S.cs' || k === 'S.ce' || k === 'S.ps' || k === 'S.pe') {
    S[k.slice(2)] = val;
    if (k === 'S.cs' || k === 'S.ce') {
      if (S.auto && S.cs && S.ce && S.ce >= S.cs) {
        const L = days(S.cs, S.ce);
        S.pe = addD(S.cs, -1);
        S.ps = addD(S.pe, -(L - 1));
      }
    }
    loadData();
  }
});

// Initial boot
loadData();
