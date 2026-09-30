// Mira dibujada con divs: una capa de contorno (negra) detrás de la de relleno.
// El contorno es una capa aparte para que no tape las piezas cuando se tocan y
// para que su opacidad sea uniforme donde se solapan.
import { h } from './dom.js';
import { CROSSHAIR_KEYS } from './settings.js';

const PARTS = ['top', 'bottom', 'left', 'right', 'dot'];

/** Perfil de mira a partir de los ajustes con ese prefijo ('crosshair' | 'adsCrosshair'). */
export function crosshairProfile(s, prefix) {
  return Object.fromEntries(CROSSHAIR_KEYS.map((k) => [k[0].toLowerCase() + k.slice(1), s[prefix + k]]));
}

/** Perfil que se ve con el ADS completo. */
export function adsCrosshairProfile(s) {
  if (s.adsCrosshair === 'custom') return crosshairProfile(s, 'adsCrosshair');
  const hip = crosshairProfile(s, 'crosshair');
  return s.adsCrosshair === 'dot' ? { ...hip, lines: false } : hip;
}

/**
 * Rectángulos [x, y, ancho, alto] de cada pieza respecto al centro. Las líneas
 * se alinean a píxel entero; con grosor impar el centro queda en +0.5 px.
 */
function rects(p) {
  const t = p.thickness;
  const a = Math.floor(t / 2);
  const near = -a - p.gap - p.length;
  const far = t - a + p.gap;
  const d = p.dotSize;
  const da = Math.floor(d / 2);
  return {
    top: p.lines && !p.tStyle && [-a, near, t, p.length],
    bottom: p.lines && [-a, far, t, p.length],
    left: p.lines && [near, -a, p.length, t],
    right: p.lines && [far, -a, p.length, t],
    dot: p.dot && [-da, -da, d, d],
  };
}

export class Crosshair {
  constructor() {
    const layer = (cls) => {
      const parts = Object.fromEntries(PARTS.map((p) => [p, h('div', { class: `ch-part ch-${p}` })]));
      return { el: h('div', { class: `ch-layer ${cls}` }, Object.values(parts)), parts };
    };
    this.outline = layer('ch-outline');
    this.fill = layer('ch-fill');
    this.el = h('div', { class: 'crosshair' }, this.outline.el, this.fill.el);
  }

  apply(p) {
    this.el.style.setProperty('--ch-color', p.color);
    this.outline.el.classList.toggle('hidden', !p.outline);
    this.outline.el.style.opacity = String(p.outlineOpacity);
    const r = rects(p);
    for (const [layer, o] of [[this.fill, 0], [this.outline, p.outlineWidth]]) {
      for (const name of PARTS) {
        const el = layer.parts[name];
        const rect = r[name];
        el.classList.toggle('hidden', !rect);
        if (!rect) continue;
        const [x, y, w, hgt] = rect;
        el.style.left = `${x - o}px`;
        el.style.top = `${y - o}px`;
        el.style.width = `${w + 2 * o}px`;
        el.style.height = `${hgt + 2 * o}px`;
      }
    }
  }

  /** Opacidad de toda la mira. */
  setOpacity(x) { this.el.style.opacity = x.toFixed(3); }

  /** Opacidad solo de las líneas (el punto no cambia). */
  setLines(x) { this.el.style.setProperty('--lines', x.toFixed(3)); }
}
