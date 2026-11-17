// Dependency-free SVG/HTML charts for Vajra. Every function returns an HTML string so it
// drops straight into the string-template renderer in app.js. Hover tooltips are driven by a
// single delegated listener (see initChartHover) reading a registry keyed by chart id.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PALETTE = ['#4568F5', '#16A5A5', '#D9902F', '#B05CE0', '#DC5252', '#5BA84A', '#E0709E', '#7A869A'];
export const PLATFORM_COLOR = { Meta: '#2F6FE0', Google: '#D9502F' };

/** Compact axis number: 1.2K, 3.4L (lakh), 1.1Cr — matches the en-IN formatting used in tables. */
export function short(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const f = (v, s) => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, '')) + s;
  if (a >= 1e7) return f(n / 1e7, 'Cr');
  if (a >= 1e5) return f(n / 1e5, 'L');
  if (a >= 1e3) return f(n / 1e3, 'K');
  return a >= 100 ? String(Math.round(n)) : a >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, '');
}

function niceScale(min, max, ticks = 4) {
  if (!(max > min)) {
    max = min + 1;
  }
  const raw = (max - min) / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

// ---- hover registry -------------------------------------------------------
const REG = new Map();
let seq = 0;
const reg = (cfg) => {
  if (REG.size > 400) REG.clear(); // charts are re-registered on every render, so old ids are safe to drop
  const id = 'c' + ++seq;
  REG.set(id, cfg);
  return id;
};

let tip;
function tipEl() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'ctip';
    tip.setAttribute('role', 'presentation');
    document.body.append(tip);
  }
  return tip;
}

export function initChartHover() {
  document.addEventListener('mousemove', (ev) => {
    const svg = ev.target.closest?.('svg[data-ch]');
    if (!svg) return hide();
    const cfg = REG.get(svg.dataset.ch);
    if (!cfg) return hide();
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * cfg.W;
    const n = cfg.n;
    let i = cfg.band ? Math.floor(((x - cfg.l) / (cfg.W - cfg.l - cfg.r)) * n) : Math.round(((x - cfg.l) / (cfg.W - cfg.l - cfg.r)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const xh = svg.querySelector('.xh');
    if (xh) {
      const px = cfg.band ? cfg.l + ((i + 0.5) / n) * (cfg.W - cfg.l - cfg.r) : cfg.l + (n === 1 ? 0.5 : i / (n - 1)) * (cfg.W - cfg.l - cfg.r);
      xh.setAttribute('x1', px);
      xh.setAttribute('x2', px);
      xh.style.opacity = 1;
    }
    const t = tipEl();
    t.innerHTML = cfg.tip(i);
    t.style.display = 'block';
    const tw = t.offsetWidth;
    const left = ev.clientX + 14 + tw > window.innerWidth ? ev.clientX - tw - 14 : ev.clientX + 14;
    t.style.left = Math.max(4, left) + 'px';
    t.style.top = Math.max(4, ev.clientY - 10) + 'px';
  });
  const hide = () => {
    if (tip) tip.style.display = 'none';
    document.querySelectorAll('svg[data-ch] .xh').forEach((l) => (l.style.opacity = 0));
  };
  document.addEventListener('mouseout', (ev) => {
    if (ev.target.closest?.('svg[data-ch]') && !ev.relatedTarget?.closest?.('svg[data-ch]')) hide();
  });
}

export function legend(items) {
  return `<div class=lg>${items
    .map((it) => `<span class=lgi><i class="sw ${it.dash ? 'dash' : ''}" style="${it.dash ? `border-top-color:${it.color}` : `background:${it.color}`}"></i>${esc(it.name)}</span>`)
    .join('')}</div>`;
}

/**
 * Line chart. series: [{ name, color, dash?, values: (number|null)[], states?: string[], labels?: string[] }]
 * xLabels: string[] (one per index). fmt: value formatter. zero: force the y axis to start at 0.
 * Null values break the line and are drawn as a hatched "no data" band (never as zero).
 */
export function lineChart({ series, xLabels, fmt, zero = true, h = 230, area = false, title = 'Trend chart' }) {
  const W = 760;
  const L = 52;
  const R = 14;
  const T = 12;
  const B = 26;
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values).filter((v) => v != null && Number.isFinite(v));
  if (!all.length) return '<div class=emp style="padding:24px">No data in this period to chart.</div>';
  let lo = zero ? 0 : Math.min(...all);
  let hi = Math.max(...all);
  if (!zero) {
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
    lo -= pad;
    hi += pad;
  }
  const ticks = niceScale(lo, hi, 4);
  lo = ticks[0];
  hi = ticks[ticks.length - 1];
  const px = (i) => L + (n === 1 ? 0.5 : i / (n - 1)) * (W - L - R);
  const py = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (h - T - B);

  const grid = ticks.map((t) => `<line x1=${L} x2=${W - R} y1=${py(t)} y2=${py(t)} class=gl /><text x=${L - 6} y=${py(t) + 3.5} text-anchor=end class=gt>${esc(short(t))}</text>`).join('');

  const step = Math.max(1, Math.ceil(n / 8));
  const xl = Array.from({ length: n }, (_, i) => i)
    .filter((i) => i % step === 0 || i === n - 1)
    .map((i) => `<text x=${px(i)} y=${h - 8} text-anchor=${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} class=gt>${esc(xLabels[i] ?? '')}</text>`)
    .join('');

  // hatched bands where the primary series has no data
  const prim = series[0];
  const bands = prim.values
    .map((v, i) => (v == null ? `<rect x=${px(i) - (W - L - R) / (2 * Math.max(1, n - 1))} y=${T} width=${(W - L - R) / Math.max(1, n - 1)} height=${h - T - B} class=nd><title>No data (shown as a gap, not zero)</title></rect>` : ''))
    .join('');

  const paths = series
    .map((s) => {
      let d = '';
      let open = false;
      s.values.forEach((v, i) => {
        if (v == null) {
          open = false;
          return;
        }
        d += `${open ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)} `;
        open = true;
      });
      let fill = '';
      if (area && !s.dash) {
        // fill each contiguous run down to the baseline
        let run = [];
        const flush = () => {
          if (run.length > 1) fill += `<path d="M${px(run[0]).toFixed(1)} ${py(lo)} ${run.map((i) => `L${px(i).toFixed(1)} ${py(s.values[i]).toFixed(1)}`).join(' ')} L${px(run[run.length - 1]).toFixed(1)} ${py(lo)} Z" style="fill:${s.color};opacity:.1" />`;
          run = [];
        };
        s.values.forEach((v, i) => (v == null ? flush() : run.push(i)));
        flush();
      }
      const dots =
        n <= 31
          ? s.values
              .map((v, i) => {
                if (v == null) return '';
                const st = s.states?.[i] || 'ok';
                const hollow = st !== 'ok';
                return `<circle cx=${px(i).toFixed(1)} cy=${py(v).toFixed(1)} r=${s.dash ? 2.4 : 3.2} style="stroke:${s.color};fill:${hollow ? 'var(--card)' : s.color};stroke-width:${hollow ? 1.6 : 0}" />`;
              })
              .join('')
          : '';
      return `${fill}<path d="${d}" fill=none style="stroke:${s.color};stroke-width:${s.dash ? 1.8 : 2.4};${s.dash ? 'stroke-dasharray:5 4;opacity:.85' : ''}" stroke-linejoin=round stroke-linecap=round />${dots}`;
    })
    .join('');

  const id = reg({
    W,
    l: L,
    r: R,
    n,
    tip: (i) => {
      const rows = series
        .map((s) => {
          const v = s.values[i];
          const st = s.states?.[i];
          const note = st && st !== 'ok' && v != null ? ` <em>${esc(st === 'provisional' ? 'partial day' : st)}</em>` : '';
          return `<div><i class=sw style="background:${s.color}"></i>${esc(s.name)}${s.labels?.[i] ? ` <span class=tm>${esc(s.labels[i])}</span>` : ''}<b>${v == null ? 'No data' : esc(fmt(v))}</b>${note}</div>`;
        })
        .join('');
      return `<div class=th>${esc(xLabels[i] ?? '')}</div>${rows}`;
    },
  });

  return `<svg viewBox="0 0 ${W} ${h}" class=ch data-ch=${id} role=img aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet"><title>${esc(title)}</title>${grid}${bands}${paths}${xl}<line class=xh x1=0 x2=0 y1=${T} y2=${h - B} style="opacity:0" /></svg>`;
}

/**
 * Horizontal ranking bars (HTML). rows: [{ label, sub?, value, prev?, color?, valueText, prevText?, delta? (html) }]
 * Draws current as a solid bar and previous as a thin ghost bar underneath, same scale.
 */
export function hbars(rows, { empty = 'Nothing to chart.' } = {}) {
  const vals = rows.flatMap((r) => [r.value, r.prev]).filter((v) => v != null && Number.isFinite(v));
  if (!rows.length || !vals.length) return `<div class=emp style="padding:20px">${esc(empty)}</div>`;
  const max = Math.max(...vals, 0) || 1;
  return `<div class=hb>${rows
    .map((r) => {
      const w = r.value == null ? 0 : Math.max(0.6, (r.value / max) * 100);
      const pw = r.prev == null ? 0 : Math.max(0.6, (r.prev / max) * 100);
      return `<div class=hr><div class=hl title="${esc(r.label)}">${r.labelHtml ?? esc(r.label)}${r.sub ? `<div class=s2>${esc(r.sub)}</div>` : ''}</div><div class=ht>${r.value == null ? '<span class="n s2">Metrics unavailable</span>' : `<div class=hf style="width:${w}%;background:${r.color || 'var(--pri)'}"></div>`}${r.prev != null ? `<div class=hp style="width:${pw}%" title="Previous: ${esc(r.prevText ?? '')}"></div>` : ''}</div><div class=hv>${r.value == null ? '—' : esc(r.valueText)}${r.delta ? `<div class=s2>${r.delta}</div>` : ''}</div></div>`;
    })
    .join('')}</div>`;
}

/** Diverging % change bars centred on zero. rows: [{ label, value (number|null), good (+1|-1|0), valueText }] */
export function divBars(rows, { empty = 'No comparable data.' } = {}) {
  const ok = rows.filter((r) => r.value != null && Number.isFinite(r.value));
  if (!ok.length) return `<div class=emp style="padding:20px">${esc(empty)}</div>`;
  const max = Math.max(...ok.map((r) => Math.abs(r.value)), 1);
  return `<div class=hb>${rows
    .map((r) => {
      if (r.value == null) return `<div class=hr><div class=hl title="${esc(r.label)}">${esc(r.label)}</div><div class=ht><span class="n s2" title="${esc(r.why || 'No baseline or unreliable data')}">${esc(r.why || 'No baseline')}</span></div><div class=hv>—</div></div>`;
      const pct = (Math.abs(r.value) / max) * 50;
      const good = r.good ? r.value * r.good > 0 : null;
      const col = Math.abs(r.value) < 0.05 || good == null ? 'var(--neu)' : good ? 'var(--ok)' : 'var(--bad)';
      return `<div class=hr><div class=hl title="${esc(r.label)}">${esc(r.label)}</div><div class="ht dv"><i class=zero></i><div class=hf style="background:${col};width:${pct}%;${r.value >= 0 ? 'left:50%' : `right:50%`}"></div></div><div class=hv style="color:${col}">${esc(r.valueText)}</div></div>`;
    })
    .join('')}</div>`;
}

/** Vertical bar chart (SVG) for a single series over categories, optional target line. */
export function barChart({ labels, values, fmt, color = 'var(--pri)', colors, h = 200, target, targetLabel, title = 'Bar chart', max: forcedMax }) {
  const W = 760;
  const L = 52;
  const R = 14;
  const T = 12;
  const B = 28;
  const n = labels.length;
  const vs = values.filter((v) => v != null);
  if (!n || !vs.length) return '<div class=emp style="padding:24px">Nothing to chart.</div>';
  const hi0 = Math.max(forcedMax ?? 0, ...vs, target ?? 0);
  const ticks = niceScale(0, hi0, 4);
  const hi = ticks[ticks.length - 1];
  const py = (v) => T + (1 - v / (hi || 1)) * (h - T - B);
  const bw = ((W - L - R) / n) * 0.62;
  const cx = (i) => L + ((i + 0.5) / n) * (W - L - R);
  const grid = ticks.map((t) => `<line x1=${L} x2=${W - R} y1=${py(t)} y2=${py(t)} class=gl /><text x=${L - 6} y=${py(t) + 3.5} text-anchor=end class=gt>${esc(short(t))}</text>`).join('');
  const bars = values
    .map((v, i) => (v == null ? '' : `<rect x=${cx(i) - bw / 2} y=${py(v)} width=${bw} height=${Math.max(1, py(0) - py(v))} rx=2 style="fill:${colors?.[i] || color}" />`))
    .join('');
  const step = Math.max(1, Math.ceil(n / 10));
  const xl = labels.map((lb, i) => (i % step === 0 ? `<text x=${cx(i)} y=${h - 9} text-anchor=middle class=gt>${esc(lb)}</text>` : '')).join('');
  const tl = target != null ? `<line x1=${L} x2=${W - R} y1=${py(target)} y2=${py(target)} class=tl /><text x=${W - R} y=${py(target) - 4} text-anchor=end class=gt style="fill:var(--warn)">${esc(targetLabel || 'target')}</text>` : '';
  const id = reg({ W, l: L, r: R, n, band: true, tip: (i) => `<div class=th>${esc(labels[i])}</div><div><b>${values[i] == null ? 'No data' : esc(fmt(values[i]))}</b></div>` });
  return `<svg viewBox="0 0 ${W} ${h}" class=ch data-ch=${id} role=img aria-label="${esc(title)}"><title>${esc(title)}</title>${grid}${bars}${tl}${xl}<line class=xh x1=0 x2=0 y1=${T} y2=${h - B} style="opacity:0" /></svg>`;
}

/** Donut + legend. segments: [{ label, value, color }] */
export function donut(segments, { center = '', sub = '', fmt = (v) => String(v) } = {}) {
  const segs = segments.filter((s) => s.value > 0);
  const total = segs.reduce((a, s) => a + s.value, 0);
  if (!total) return '<div class=emp style="padding:20px">No data.</div>';
  const R0 = 48;
  const C = 2 * Math.PI * R0;
  let off = 0;
  const arcs = segs
    .map((s) => {
      const len = (s.value / total) * C;
      const el = `<circle cx=60 cy=60 r=${R0} fill=none stroke-width=16 style="stroke:${s.color}" stroke-dasharray="${Math.max(0, len - (segs.length > 1 ? 1.5 : 0)).toFixed(2)} ${(C - len + (segs.length > 1 ? 1.5 : 0)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(s.label)}: ${esc(fmt(s.value))} (${((s.value / total) * 100).toFixed(0)}%)</title></circle>`;
      off += len;
      return el;
    })
    .join('');
  return `<div class=dn><svg viewBox="0 0 120 120" class=dsv role=img aria-label="${esc(center || 'Distribution')}">${arcs}<text x=60 y=${sub ? 58 : 64} text-anchor=middle class=dc>${esc(center)}</text>${sub ? `<text x=60 y=72 text-anchor=middle class=gt>${esc(sub)}</text>` : ''}</svg><div class=dl>${segs
    .map((s) => `<div><i class=sw style="background:${s.color}"></i>${esc(s.label)} <b>${esc(fmt(s.value))}</b> <span class=sub>${((s.value / total) * 100).toFixed(0)}%</span></div>`)
    .join('')}</div></div>`;
}

/** Tiny inline trend line for KPI cards. values may contain nulls (gaps). */
export function spark(values, color = 'var(--pri)', prev) {
  const W = 120;
  const H = 30;
  const all = [...values, ...(prev || [])].filter((v) => v != null);
  if (values.filter((v) => v != null).length < 2) return '';
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const n = values.length;
  const x = (i) => 2 + (i / (n - 1)) * (W - 4);
  const y = (v) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const path = (vs) => {
    let d = '';
    let open = false;
    vs.forEach((v, i) => {
      if (v == null) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      open = true;
    });
    return d;
  };
  return `<svg viewBox="0 0 ${W} ${H}" class=spk role=img aria-label="Daily trend">${prev ? `<path d="${path(prev)}" fill=none style="stroke:var(--neu);stroke-width:1.2;stroke-dasharray:3 3;opacity:.8" />` : ''}<path d="${path(values)}" fill=none style="stroke:${color};stroke-width:1.8" stroke-linejoin=round stroke-linecap=round /></svg>`;
}

/** Progress-style bar for a 0–100 rate with an optional threshold marker. */
export function gauge({ label, value, text, threshold, thresholdText, goodWhen = 'high', hint }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const bad = v != null && threshold != null && (goodWhen === 'high' ? v < threshold : v > threshold);
  const col = v == null ? 'var(--neu)' : bad ? 'var(--bad)' : 'var(--ok)';
  return `<div class=gg><div class=row style="gap:6px"><b>${esc(label)}</b><span class=sp></span><span style="color:${col};font-weight:650">${v == null ? 'Not enough data' : esc(text)}</span></div><div class=gt2>${v == null ? '' : `<div class=gf style="width:${v}%;background:${col}"></div>`}${threshold != null ? `<i class=gm style="left:${Math.min(100, threshold)}%" title="${esc(thresholdText || '')}"></i>` : ''}</div><div class=s2>${threshold != null ? esc(thresholdText || '') : ''}${hint ? ` ${esc(hint)}` : ''}</div></div>`;
}
