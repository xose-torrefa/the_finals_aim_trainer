// Gráfica de progreso: una sola serie (puntuación por partida) en SVG, con
// cruceta y tooltip. Colores y trazos vienen de clases en styles.css (CSP).
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
