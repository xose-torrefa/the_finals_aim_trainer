// Gráfica de progreso: una sola serie (puntuación por partida) en SVG, con
// cruceta y tooltip. Colores y trazos vienen de clases en styles.css (CSP).
import { h } from './dom.js';
import { t, locale } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = { l: 40, r: 14, t: 18, b: 24 };

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Ticks "redondos" (1, 2, 5 × 10^n) que cubren [min, max]. */
function niceTicks(min, max, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/**
 * @param entries partidas { t, score, accuracy, cm360, fov } en orden cronológico
 * @param format  formatea una puntuación para mostrarla
 * @param tickFormat formatea los valores del eje Y
 * @param size    tamaño del viewBox; conviene que se parezca al del contenedor
 *                para que el texto no se escale demasiado
 */
export function progressChart(entries, format, tickFormat = (v) => String(v), { width: W = 460, height: H = 170 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('chart.aria') });
  wrap.append(root);

  const scores = entries.map((e) => e.score);
  const ticks = niceTicks(Math.min(...scores), Math.max(...scores));
  const yMin = ticks[0];
  const yMax = ticks.at(-1);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const n = entries.length;
  const x = (i) => PAD.l + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v) => PAD.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  for (const tick of ticks) {
    root.append(svg('line', { class: 'grid', x1: PAD.l, x2: W - PAD.r, y1: y(tick), y2: y(tick) }));
    const label = svg('text', { class: 'tick', x: PAD.l - 6, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    label.textContent = tickFormat(tick);
    root.append(label);
  }
  for (const [i, anchor] of [[0, 'start'], [n - 1, 'end']]) {
    if (n === 1 && i > 0) break;
    const label = svg('text', { class: 'tick', x: x(i), y: H - 6, 'text-anchor': n === 1 ? 'middle' : anchor });
    label.textContent = `#${i + 1}`;
    root.append(label);
  }

  const pts = entries.map((e, i) => `${x(i).toFixed(1)},${y(e.score).toFixed(1)}`);
  if (n > 1) {
    const base = y(yMin).toFixed(1);
    root.append(svg('path', { class: 'area', d: `M${x(0).toFixed(1)},${base}L${pts.join('L')}L${x(n - 1).toFixed(1)},${base}Z` }));
    root.append(svg('path', { class: 'line', d: `M${pts.join('L')}` }));
  }
  if (n <= 60) {
    entries.forEach((e, i) => root.append(svg('circle', { class: 'dot', cx: x(i), cy: y(e.score), r: 4 })));
  }

  // Récord marcado y etiquetado (única etiqueta directa)
  const best = scores.indexOf(Math.max(...scores));
  root.append(svg('circle', { class: 'dot best', cx: x(best), cy: y(scores[best]), r: 5 }));
  const bestLabel = svg('text', {
    class: 'label',
    x: x(best),
    y: y(scores[best]) - 10,
    'text-anchor': best === 0 && n > 1 ? 'start' : best === n - 1 && n > 1 ? 'end' : 'middle',
  });
  bestLabel.textContent = t('chart.best', { score: format(scores[best]) });
  root.append(bestLabel);

  // Cruceta + tooltip: se engancha a la partida más cercana en X
  const cross = svg('line', { class: 'cross hidden', y1: PAD.t, y2: PAD.t + plotH });
  const hoverDot = svg('circle', { class: 'dot hover hidden', r: 5 });
  const hit = svg('rect', { class: 'hit', x: PAD.l - 8, y: 0, width: plotW + 16, height: H });
  root.append(cross, hoverDot, hit);
  const tip = document.createElement('div');
  tip.className = 'chart-tip hidden';
  wrap.append(tip);

  const show = (clientX) => {
    const rect = root.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((sx - PAD.l) / plotW) * (n - 1))));
    const e = entries[i];
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    hoverDot.setAttribute('cx', x(i));
    hoverDot.setAttribute('cy', y(e.score));
    cross.classList.remove('hidden');
    hoverDot.classList.remove('hidden');
    const date = new Date(e.t).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    tip.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: `#${i + 1} · ${format(e.score)}` }),
      Object.assign(document.createElement('span'), { textContent: date }),
      Object.assign(document.createElement('span'), {
        textContent: t('chart.tip', {
          acc: Number.isFinite(e.accuracy) ? `${e.accuracy.toFixed(1)}%` : '—',
          cm: e.cm360?.toFixed(1) ?? '—',
          fov: e.fov ?? '—',
        }),
      }),
    );
    tip.classList.remove('hidden');
    const px = (x(i) / W) * rect.width;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tip.offsetWidth, px - tip.offsetWidth / 2))}px`;
  };
  const hide = () => {
    cross.classList.add('hidden');
    hoverDot.classList.add('hidden');
    tip.classList.add('hidden');
  };
  hit.addEventListener('pointermove', (ev) => show(ev.clientX));
  hit.addEventListener('pointerleave', hide);
  return wrap;
}

const sensKey = (v) => Math.round(v * 10) / 10;

/**
 * Partidas agrupadas por sensibilidad (redondeada a 0,1 cm/360), de menor a mayor.
 * @param field 'cm360' | 'adsCm360'
 * @returns [{ value, n, avg, best, last }]
 */
export function sensGroups(entries, field) {
  const groups = new Map();
  for (const e of entries) {
    if (!Number.isFinite(e[field])) continue;
    const value = sensKey(e[field]);
    const g = groups.get(value) ?? { value, n: 0, sum: 0, best: -Infinity, last: 0 };
    g.n++;
    g.sum += e.score;
    g.best = Math.max(g.best, e.score);
    g.last = Math.max(g.last, e.t);
    groups.set(value, g);
  }
  return [...groups.values()]
    .map(({ sum, ...g }) => ({ ...g, avg: sum / g.n }))
    .sort((a, b) => a.value - b.value);
}

/** Decimales que necesitan las etiquetas de unos ticks. */
const tickDecimals = (ticks) => (ticks.length > 1 ? Math.max(0, Math.min(2, -Math.floor(Math.log10(ticks[1] - ticks[0]) + 1e-9))) : 0);

/**
 * Puntuación frente a sensibilidad: un punto por partida (más opaco cuanto más
 * reciente) y la media de cada sensibilidad. La cruceta se engancha a la
 * sensibilidad más cercana en X.
 * @param entries partidas en orden cronológico
 * @param field   'cm360' | 'adsCm360'
 */
export function sensChart(entries, field, format, tickFormat = (v) => String(v), { width: W = 460, height: H = 170 } = {}) {
  const P = { ...PAD, b: 34 };
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('sens.aria') });
  wrap.append(root);

  const runs = entries.filter((e) => Number.isFinite(e[field]));
  const groups = sensGroups(runs, field);
  const values = groups.map((g) => g.value);
  const pad = Math.max(0.1, (values.at(-1) - values[0]) * 0.06);
  const xTicks = niceTicks(values[0] - pad, values.at(-1) + pad, 5);
  const yTicks = niceTicks(Math.min(...runs.map((e) => e.score)), Math.max(...runs.map((e) => e.score)));
  const [xMin, xMax, yMin, yMax] = [xTicks[0], xTicks.at(-1), yTicks[0], yTicks.at(-1)];
  const plotW = W - P.l - P.r;
  const plotH = H - P.t - P.b;
  const x = (v) => P.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const y = (v) => P.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  for (const tick of yTicks) {
    root.append(svg('line', { class: 'grid', x1: P.l, x2: W - P.r, y1: y(tick), y2: y(tick) }));
    const label = svg('text', { class: 'tick', x: P.l - 6, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    label.textContent = tickFormat(tick);
    root.append(label);
  }
  const decimals = tickDecimals(xTicks);
  for (const tick of xTicks) {
    const label = svg('text', { class: 'tick', x: x(tick), y: H - 18, 'text-anchor': 'middle' });
    label.textContent = tick.toFixed(decimals);
    root.append(label);
  }
  const axis = svg('text', { class: 'tick', x: W - P.r, y: H - 2, 'text-anchor': 'end' });
  axis.textContent = t(`sens.${field}`);
  root.append(axis);

  // Más opaco cuanto más reciente: la práctica también sube la puntuación
  runs.forEach((e, i) => root.append(svg('circle', {
    class: 'dot run',
    cx: x(sensKey(e[field])),
    cy: y(e.score),
    r: 3.5,
    'fill-opacity': (0.2 + (0.8 * (i + 1)) / runs.length).toFixed(2),
  })));
  for (const g of groups) {
    root.append(svg('line', { class: 'mean', x1: x(g.value) - 10, x2: x(g.value) + 10, y1: y(g.avg), y2: y(g.avg) }));
  }

  const cross = svg('line', { class: 'cross hidden', y1: P.t, y2: P.t + plotH });
  const hit = svg('rect', { class: 'hit', x: P.l - 8, y: 0, width: plotW + 16, height: H });
  root.append(cross, hit);
  const tip = document.createElement('div');
  tip.className = 'chart-tip hidden';
  wrap.append(tip);

  hit.addEventListener('pointermove', (ev) => {
    const rect = root.getBoundingClientRect();
    const sx = ((ev.clientX - rect.left) / rect.width) * W;
    const g = groups.reduce((a, b) => (Math.abs(x(b.value) - sx) < Math.abs(x(a.value) - sx) ? b : a));
    cross.setAttribute('x1', x(g.value));
    cross.setAttribute('x2', x(g.value));
    cross.classList.remove('hidden');
    tip.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: `${g.value.toFixed(1)} ${t(`sens.${field}`)}` }),
      Object.assign(document.createElement('span'), {
        textContent: t('sens.tip', { n: g.n, avg: format(Math.round(g.avg * 10) / 10), best: format(g.best) }),
      }),
    );
    tip.classList.remove('hidden');
    const px = (x(g.value) / W) * rect.width;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tip.offsetWidth, px - tip.offsetWidth / 2))}px`;
  });
  hit.addEventListener('pointerleave', () => {
    cross.classList.add('hidden');
    tip.classList.add('hidden');
  });
  return wrap;
}

/** Cuantil `q` (0-1) de los valores finitos de `xs`, en valor absoluto. */
function absQuantile(xs, q) {
  const v = Array.from(xs).filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : 0;
}

const TRACE_WINDOWS = [2, 5, 15, 0]; // s que se ven a la vez (0 = toda la partida)
const TRACE_POINTS = 1500; // puntos por línea, como mucho

/**
 * Trazado de la partida en el tiempo: arriba, la velocidad horizontal de la
 * mira frente a la del objetivo; abajo, la mira respecto al objetivo, con la
 * banda en la que está encima. La ventana se elige y se desplaza con los controles.
 * @param s { t, aim, target, err, radius } de `analyzeRecording`
 */
export function traceChart(s, { width: W = 860, height: H = 330 } = {}) {
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('tr.aria') });
  const n = s.t.length;
  const total = s.t[n - 1];
  const plotW = W - PAD.l - PAD.r;
  const top = { y0: 24, h: 130 };
  const bottom = { y0: 190, h: 110 };

  // Escalas fijas para toda la partida: al desplazarse no cambia el eje
  const vMax = Math.max(10, absQuantile([...s.aim, ...s.target], 0.99));
  const eMax = Math.max(1, absQuantile(s.err, 0.95));
  const vTicks = niceTicks(-vMax, vMax);
  const eTicks = niceTicks(-eMax, eMax);
  const scale = (panel, ticks) => {
    const lo = ticks[0];
    const hi = ticks.at(-1);
    const y = (v) => panel.y0 + panel.h - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * panel.h;
    for (const tick of ticks) {
      root.append(svg('line', { class: tick === 0 ? 'grid zero' : 'grid', x1: PAD.l, x2: W - PAD.r, y1: y(tick), y2: y(tick) }));
      const label = svg('text', { class: 'tick', x: PAD.l - 6, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' });
      label.textContent = String(tick);
      root.append(label);
    }
    return y;
  };
  const text = (cls, x, y, anchor, content) => {
    const el = svg('text', { class: cls, x, y, 'text-anchor': anchor });
    el.textContent = content;
    root.append(el);
    return el;
  };
  const yV = scale(top, vTicks);
  const yE = scale(bottom, eTicks);
  text('tick', PAD.l, top.y0 - 10, 'start', t('tr.speed'));
  text('tick', PAD.l, bottom.y0 - 10, 'start', t('tr.error'));
  text('legend aim', W - PAD.r, top.y0 - 10, 'end', t('tr.aim'));
  text('legend ref', W - PAD.r - 70, top.y0 - 10, 'end', t('tr.target'));
  const from = text('tick', PAD.l, H - 6, 'start', '');
  const to = text('tick', W - PAD.r, H - 6, 'end', '');

  const band = svg('path', { class: 'band' });
  const refLine = svg('path', { class: 'line ref' });
  const aimLine = svg('path', { class: 'line thin' });
  const errLine = svg('path', { class: 'line thin' });
  root.append(band, refLine, aimLine, errLine);

  let span = 5;
  let start = 0;
  const draw = () => {
    const len = span > 0 ? Math.min(span, total) : total;
    const t0 = Math.max(0, Math.min(start, total - len));
    const x = (time) => PAD.l + ((time - t0) / len) * plotW;
    let i0 = 0;
    while (i0 < n - 1 && s.t[i0] < t0) i0++;
    let i1 = i0;
    while (i1 < n - 1 && s.t[i1 + 1] <= t0 + len) i1++;
    const step = Math.max(1, Math.ceil((i1 - i0 + 1) / TRACE_POINTS));
    // Tramos seguidos con dato; los huecos (sin objetivo, cambio de objetivo) cortan la línea
    const runs = (vals) => {
      const out = [];
      let run = null;
      for (let i = i0; i <= i1; i += step) {
        if (Number.isFinite(vals[i])) {
          if (!run) out.push(run = []);
          run.push(i);
        } else {
          run = null;
        }
      }
      return out;
    };
    const pts = (run, y, value) => run.map((i) => `${x(s.t[i]).toFixed(1)},${y(value(i)).toFixed(1)}`).join('L');
    const line = (vals, y) => runs(vals).map((run) => `M${pts(run, y, (i) => vals[i])}`).join('');
    refLine.setAttribute('d', line(s.target, yV));
    aimLine.setAttribute('d', line(s.aim, yV));
    errLine.setAttribute('d', line(s.err, yE));
    band.setAttribute('d', runs(s.radius)
      .map((run) => `M${pts(run, yE, (i) => s.radius[i])}L${pts([...run].reverse(), yE, (i) => -s.radius[i])}Z`)
      .join(''));
    from.textContent = `${t0.toFixed(1)} s`;
    to.textContent = `${(t0 + len).toFixed(1)} s`;
  };

  const slider = h('input', { type: 'range', min: 0, step: 0.05, value: 0, ariaLabel: t('tr.scroll') });
  const setRange = () => {
    const max = span > 0 ? Math.max(0, total - span) : 0;
    slider.max = max;
    slider.disabled = max === 0;
    start = Math.min(start, max);
    slider.value = start;
  };
  slider.addEventListener('input', () => {
    start = Number(slider.value);
    draw();
  });
  const select = h('select', {
    ariaLabel: t('tr.window'),
    onchange: () => {
      span = Number(select.value);
      setRange();
      draw();
    },
  }, TRACE_WINDOWS.map((w) => h('option', { value: w, selected: w === span }, w ? t('tr.windowValue', { n: w }) : t('tr.windowAll'))));
  setRange();
  draw();
  return h('div', { class: 'chart trace' }, root, h('div', { class: 'trace-controls' }, select, slider));
}
