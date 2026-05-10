// Minimal SVG chart helpers — no libraries.
//
// Everything returns an SVG string the caller can inline into .innerHTML.
// Values are always in their display units (converted by the caller via
// format.js) since the chart only cares about numbers + labels.

(function () {

const W = 520;
const H = 140;
const PAD = { top: 10, right: 10, bottom: 22, left: 32 };

function scale(values, size, pad, { min, max } = {}) {
  const inner = size - pad.start - pad.end;
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const range = hi - lo || 1;
  return {
    lo, hi,
    toPx: (v) => pad.start + ((v - lo) / range) * inner,
  };
}

function niceTicks(lo, hi, n = 4) {
  const range = hi - lo || 1;
  const rough = range / n;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  const start = Math.ceil(lo / step) * step;
  for (let v = start; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function escapeSvg(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/**
 * Multi-series line chart over shared x-axis (array of Date-parsable strings).
 * @param {{ times: string[], series: Array<{ name: string, values: number[], color?: string }>, yUnit?: string, xFormat?: (iso: string) => string }} opts
 */
function lineChart({ times, series, yUnit = "", xFormat }) {
  if (!times?.length || !series?.length) return emptyChart();
  const xs = { start: PAD.left, end: PAD.right };
  const ys = { start: PAD.top, end: PAD.bottom };
  const xScale = scale([0, times.length - 1], W, xs, { min: 0, max: times.length - 1 });
  const allVals = series.flatMap((s) => s.values.filter((v) => v != null && !Number.isNaN(v)));
  if (!allVals.length) return emptyChart();
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.1 || 1;
  const yScale = scale([lo - pad, hi + pad], H, ys, { min: lo - pad, max: hi + pad });
  // Invert y so larger values draw higher.
  const y = (v) => H - yScale.toPx(v) + ys.start - ys.end;

  const ticks = niceTicks(lo - pad, hi + pad, 4);
  const gridlines = ticks.map((t) => `
    <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t)}" y2="${y(t)}" class="chart-grid" />
    <text x="${PAD.left - 4}" y="${y(t) + 3}" class="chart-label chart-label-y">${t}</text>
  `).join("");

  const xLabels = xLabelTicks(times, xFormat).map(({ idx, label }) => `
    <text x="${xScale.toPx(idx)}" y="${H - 6}" class="chart-label chart-label-x">${escapeSvg(label)}</text>
  `).join("");

  const paths = series.map((s, i) => {
    const color = s.color || chartColor(i);
    const d = buildPath(s.values, (v, i) => ({ x: xScale.toPx(i), y: y(v) }));
    return `<path d="${d}" class="chart-line" stroke="${color}" fill="none" />`;
  }).join("");

  const legend = series.length > 1
    ? `<g class="chart-legend">${series.map((s, i) => `
        <g transform="translate(${PAD.left + i * 120}, ${PAD.top - 2})">
          <rect width="10" height="10" fill="${s.color || chartColor(i)}" />
          <text x="14" y="9" class="chart-label">${escapeSvg(s.name)}</text>
        </g>`).join("")}</g>`
    : "";

  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" class="chart">
      ${gridlines}
      ${paths}
      ${xLabels}
      ${legend}
      ${yUnit ? `<text x="${PAD.left - 4}" y="${PAD.top - 2}" class="chart-label chart-label-y">${yUnit}</text>` : ""}
    </svg>
  `;
}

/**
 * Single-series bar chart (used for daily precipitation).
 * @param {{ labels: string[], values: number[], unit?: string, color?: string }} opts
 */
function barChart({ labels, values, unit = "", color }) {
  if (!labels?.length) return emptyChart();
  const hi = Math.max(0.1, ...values.filter((v) => v != null));
  const yScale = scale([0, hi * 1.15], H, { start: PAD.top, end: PAD.bottom }, { min: 0, max: hi * 1.15 });
  const y = (v) => H - yScale.toPx(v) + PAD.top - PAD.bottom;
  const inner = W - PAD.left - PAD.right;
  const bw = Math.max(4, inner / values.length - 6);
  const step = inner / values.length;
  const barColor = color || "var(--accent)";

  const bars = values.map((v, i) => {
    const x = PAD.left + step * i + (step - bw) / 2;
    const h = Math.max(0, H - PAD.bottom - y(v ?? 0));
    return `
      <rect x="${x}" y="${y(v ?? 0)}" width="${bw}" height="${h}" fill="${barColor}" class="chart-bar" />
      <text x="${x + bw / 2}" y="${H - 6}" class="chart-label chart-label-x" text-anchor="middle">${escapeSvg(labels[i])}</text>
      ${v != null && v > 0 ? `<text x="${x + bw / 2}" y="${y(v) - 2}" class="chart-label chart-label-v" text-anchor="middle">${(Math.round(v * 10) / 10)}</text>` : ""}
    `;
  }).join("");

  const ticks = niceTicks(0, hi * 1.15, 3);
  const grid = ticks.map((t) => `
    <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t)}" y2="${y(t)}" class="chart-grid" />
    <text x="${PAD.left - 4}" y="${y(t) + 3}" class="chart-label chart-label-y">${t}</text>
  `).join("");

  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" class="chart">
      ${grid}
      ${bars}
      ${unit ? `<text x="${PAD.left - 4}" y="${PAD.top - 2}" class="chart-label chart-label-y">${unit}</text>` : ""}
    </svg>
  `;
}

function buildPath(values, project) {
  const parts = [];
  let started = false;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null || Number.isNaN(values[i])) { started = false; continue; }
    const { x, y } = project(values[i], i);
    parts.push(`${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
    started = true;
  }
  return parts.join(" ");
}

function xLabelTicks(times, xFormat) {
  const fmt = xFormat || ((iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric" }));
  const out = [];
  const step = Math.max(1, Math.floor(times.length / 6));
  for (let i = 0; i < times.length; i += step) {
    out.push({ idx: i, label: fmt(times[i]) });
  }
  return out;
}

function chartColor(i) {
  const palette = ["var(--accent)", "#c26a1f", "#3e7ca1", "#7a3f9e"];
  return palette[i % palette.length];
}

function emptyChart() {
  return `<svg viewBox="0 0 ${W} ${H}" class="chart"><text x="${W / 2}" y="${H / 2}" class="chart-label" text-anchor="middle">No data</text></svg>`;
}

/**
 * Diverging water-balance chart.
 * Precip bars extend upward (blue). ET bars extend downward (orange).
 * Historical days are fully opaque; projected days are semi-transparent.
 * A dashed vertical line separates actuals from the forecast.
 *
 * @param {{
 *   days: Array<{ date: string, et: number, precip: number, projected: boolean, precipProb?: number|null }>,
 *   unit?: string,
 *   histCount?: number
 * }} opts
 */
function waterBalanceChart({ days, unit = "mm", histCount = 5 }) {
  if (!days?.length) return emptyChart();

  const W2 = 680;
  const H2 = 200;
  const PAD2 = { top: 24, right: 16, bottom: 44, left: 36 };

  const innerW = W2 - PAD2.left - PAD2.right;
  const innerH = H2 - PAD2.top - PAD2.bottom;
  const zeroY = PAD2.top + innerH / 2;

  const n = days.length;
  const step = innerW / n;
  // Each day slot has two side-by-side bars: precip (left) and ET (right).
  const halfBw = Math.max(4, step * 0.28);

  const allPrecip = days.map((d) => d.precip ?? 0);
  const allET = days.map((d) => d.et ?? 0);
  const maxVal = Math.max(1, ...allPrecip, ...allET);
  const halfH = innerH / 2 * 0.88; // leave a small buffer at top/bottom

  const toAboveY = (v) => zeroY - (v / maxVal) * halfH;
  const toBelowY = (v) => zeroY + (v / maxVal) * halfH;

  // ---- grid lines ----
  const tickVals = niceTicks(0, maxVal, 3).filter((t) => t > 0);
  const grid = tickVals.flatMap((t) => {
    const yU = toAboveY(t);
    const yD = toBelowY(t);
    const lbl = t;
    return [
      `<line x1="${PAD2.left}" x2="${W2 - PAD2.right}" y1="${yU}" y2="${yU}" class="chart-grid"/>`,
      `<text x="${PAD2.left - 4}" y="${yU + 3}" class="chart-label chart-label-y">${lbl}</text>`,
      `<line x1="${PAD2.left}" x2="${W2 - PAD2.right}" y1="${yD}" y2="${yD}" class="chart-grid"/>`,
    ];
  }).join("");

  // ---- zero baseline ----
  const baseline = `<line x1="${PAD2.left}" x2="${W2 - PAD2.right}" y1="${zeroY}" y2="${zeroY}" stroke="var(--ink-soft)" stroke-width="1.5"/>`;

  // ---- bars ----
  const bars = days.map((d, i) => {
    const slotX = PAD2.left + step * i;
    const cx = slotX + step / 2;
    const opacity = d.projected ? 0.45 : 1;

    const pv = d.precip ?? 0;
    const ev = d.et ?? 0;
    const pBarTop = toAboveY(pv);
    const pBarH = zeroY - pBarTop;
    const eBarH = toBelowY(ev) - zeroY;

    // Precip bar left of center, ET bar right of center within the slot.
    const pX = cx - halfBw - 1;
    const eX = cx + 1;

    const precipBar = pv > 0
      ? `<rect x="${pX.toFixed(1)}" y="${pBarTop.toFixed(1)}" width="${halfBw.toFixed(1)}" height="${Math.max(1, pBarH).toFixed(1)}" fill="#3e7ca1" opacity="${opacity}" class="chart-bar"/>`
      : "";
    const etBar = ev > 0
      ? `<rect x="${eX.toFixed(1)}" y="${zeroY.toFixed(1)}" width="${halfBw.toFixed(1)}" height="${Math.max(1, eBarH).toFixed(1)}" fill="#c26a1f" opacity="${opacity}" class="chart-bar"/>`
      : "";

    // Day label
    const lbl = new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
    const xLabel = `<text x="${cx.toFixed(1)}" y="${H2 - PAD2.bottom + 13}" class="chart-label chart-label-x" text-anchor="middle">${escapeSvg(lbl)}</text>`;

    // Deficit / surplus badge below label for projected days
    let deficitLabel = "";
    if (d.projected) {
      const net = (d.precip ?? 0) - (d.et ?? 0); // positive = surplus
      const sign = net >= 0 ? "+" : "";
      const color = net >= 0.05 ? "var(--accent)" : net <= -0.05 ? "var(--warn)" : "var(--ink-soft)";
      const valStr = `${sign}${Math.round(net * 10) / 10}`;
      deficitLabel = `<text x="${cx.toFixed(1)}" y="${H2 - PAD2.bottom + 27}" class="chart-label chart-label-x" text-anchor="middle" fill="${color}">${escapeSvg(valStr)}</text>`;
    }

    return `${precipBar}${etBar}${xLabel}${deficitLabel}`;
  }).join("");

  // ---- divider between actuals and forecast ----
  let divider = "";
  if (histCount > 0 && histCount < n) {
    const dx = PAD2.left + step * histCount;
    divider = `<line x1="${dx.toFixed(1)}" x2="${dx.toFixed(1)}" y1="${PAD2.top}" y2="${H2 - PAD2.bottom}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>
    <text x="${(dx + 3).toFixed(1)}" y="${PAD2.top + 10}" class="chart-label" fill="var(--accent)" opacity="0.85">forecast →</text>`;
  }

  // ---- legend ----
  const legend = `
    <rect x="${PAD2.left}" y="${PAD2.top - 14}" width="8" height="8" fill="#3e7ca1"/>
    <text x="${PAD2.left + 11}" y="${PAD2.top - 7}" class="chart-label">Precip</text>
    <rect x="${PAD2.left + 60}" y="${PAD2.top - 14}" width="8" height="8" fill="#c26a1f"/>
    <text x="${PAD2.left + 71}" y="${PAD2.top - 7}" class="chart-label">ET</text>
    ${unit ? `<text x="${W2 - PAD2.right}" y="${PAD2.top - 7}" class="chart-label" text-anchor="end" fill="var(--ink-soft)">${escapeSvg(unit)}</text>` : ""}
  `;

  return `<svg viewBox="0 0 ${W2} ${H2}" role="img" class="chart">
    ${grid}${baseline}${divider}${bars}${legend}
  </svg>`;
}

window.lineChart = lineChart;
window.barChart = barChart;
window.waterBalanceChart = waterBalanceChart;

})();
