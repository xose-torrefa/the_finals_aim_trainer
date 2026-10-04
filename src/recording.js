// Trazado de una partida: la mira y el objetivo de referencia en cada fotograma.
// Solo se conserva el de la última partida (en memoria) y se puede exportar a
// JSON para analizarlo fuera. De él sale también la fluidez del tracking: si la
// mira lleva la velocidad del objetivo o avanza a trompicones (parones y tirones).
// Los ángulos van en grados.
import { DEG } from './settings.js';

const COLS = ['t', 'yaw', 'pitch', 'dx', 'dy', 'ads', 'on', 'target', 'tyaw', 'tpitch', 'ex', 'ey', 'radius', 'engaged'];
const WINDOW = 0.04; // s sobre los que se mide la velocidad (un fotograma suelto son 1-2 counts del ratón)
const MIN_SPEED = 8; // °/s del objetivo: por debajo no se compara la velocidad
const MAX_JUMP = 5; // ° en un fotograma: el objetivo ha reaparecido en otro sitio
const STOP_IN = 0.3; // parón: la mira baja del 30 % de la velocidad del objetivo…
const STOP_OUT = 0.6; // …y acaba cuando vuelve a pasar del 60 %
const BURST = 1.7; // tirón: la mira va a más del 170 %
const MIN_TIME = 3; // s de tracking necesarios para dar resultados

const wrap = (a) => a - 360 * Math.round(a / 360);
const round = (digits) => (v) => (typeof v === 'number' ? Number(v.toFixed(digits)) : v);

export class Recording {
  constructor() {
    this.frames = Object.fromEntries(COLS.map((c) => [c, []]));
    this.shots = { t: [], hit: [] };
    this.cuts = []; // fotogramas que no continúan al anterior (vuelta de una pausa)
    this.ids = new WeakMap();
    this.nextId = 0;
  }

  /** El siguiente fotograma no continúa al anterior: la mira se ha podido mover en la cuenta atrás. */
  cut() {
    this.cuts.push(this.frames.t.length);
  }

  /**
   * Se llama cada fotograma de juego.
   * @param dx,dy  counts del ratón de este fotograma
   * @param ads    progreso del ADS (0-1)
   * @param ref    objetivo de referencia del análisis (`AimAnalysis.last`) o null
   * @param on     true si la mira está sobre un objetivo
   */
  frame(now, player, dx, dy, ads, ref, engaged, on) {
    const f = this.frames;
    f.t.push(now);
    f.yaw.push(player.yaw / DEG);
    f.pitch.push(player.pitch / DEG);
    f.dx.push(dx);
    f.dy.push(dy);
    f.ads.push(ads);
    f.on.push(on ? 1 : 0);
    if (ref) {
      if (!this.ids.has(ref.target)) this.ids.set(ref.target, this.nextId++);
      f.target.push(this.ids.get(ref.target));
      f.tyaw.push(ref.c.yaw / DEG);
      f.tpitch.push(ref.c.pitch / DEG);
      f.ex.push(ref.ex);
      f.ey.push(ref.ey);
      f.radius.push(ref.radius);
      f.engaged.push(engaged ? 1 : 0);
    } else {
      f.target.push(-1);
      for (const c of ['tyaw', 'tpitch', 'ex', 'ey', 'radius']) f[c].push(null);
      f.engaged.push(0);
    }
  }

  /** @param hit 0 = fallo, 1 = cuerpo, 2 = cabeza */
  shot(now, hit) {
    this.shots.t.push(now);
    this.shots.hit.push(hit);
  }
}

/** Trazado listo para guardar en JSON (por columnas, con los números redondeados). */
export function exportRecording(rec, meta) {
  const digits = { t: 4, dx: 2, dy: 2, ads: 3, on: 0, target: 0, engaged: 0 };
  return {
    app: 'finals-aim',
    kind: 'trace',
    version: 1,
    ...meta,
    // yaw > 0 = izquierda, pitch > 0 = arriba; tyaw/tpitch = dirección del objetivo;
    // ex/ey = objetivo respecto a la mira (ex > 0 = mira a la derecha del objetivo)
    units: { t: 's', angles: 'deg', dx: 'counts' },
    cuts: rec.cuts,
    frames: Object.fromEntries(COLS.map((c) => [c, rec.frames[c].map(round(digits[c] ?? 4))])),
    shots: { t: rec.shots.t.map(round(4)), hit: rec.shots.hit },
  };
}

/**
 * Fluidez del tracking y series para la gráfica.
 * @returns {{ smooth, series }} `smooth` es null si no hay tracking suficiente;
 *   null si el trazado está vacío
 */
export function analyzeRecording(rec) {
  const f = rec.frames;
  const n = f.t.length;
  if (n < 3) return null;

  // Recorrido acumulado de la mira (a) y del objetivo (b) sobre la vista, con
  // la derecha y arriba en positivo. `seg` cambia cuando se rompe la continuidad
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  const seg = new Int32Array(n);
  const cuts = new Set(rec.cuts);
  for (let i = 1; i < n; i++) {
    ax[i] = ax[i - 1] - (f.yaw[i] - f.yaw[i - 1]) * Math.cos(f.pitch[i] * DEG);
    ay[i] = ay[i - 1] + f.pitch[i] - f.pitch[i - 1];
    bx[i] = bx[i - 1];
    by[i] = by[i - 1];
    seg[i] = seg[i - 1];
    const same = f.target[i] >= 0 && f.target[i] === f.target[i - 1] && !cuts.has(i);
    const mx = same ? -wrap(f.tyaw[i] - f.tyaw[i - 1]) * Math.cos(f.tpitch[i] * DEG) : 0;
    const my = same ? f.tpitch[i] - f.tpitch[i - 1] : 0;
    if (same && Math.hypot(mx, my) < MAX_JUMP) {
      bx[i] += mx;
      by[i] += my;
    } else {
      seg[i]++;
    }
  }

  const aim = new Float64Array(n).fill(NaN); // velocidad horizontal de la mira (°/s)
  const target = new Float64Array(n).fill(NaN); // y la del objetivo
  let time = 0;
  let speedSum = 0;
  let sq = 0;
  let stopTime = 0;
  let burstTime = 0;
  let stops = 0;
  let stopped = false;
  const half = WINDOW / 2;
  for (let i = 0, j1 = 0, j2 = 0; i < n; i++) {
    while (f.t[j1] < f.t[i] - half) j1++;
    while (j2 + 1 < n && f.t[j2 + 1] <= f.t[i] + half) j2++;
    const span = f.t[j2] - f.t[j1];
    if (f.target[i] < 0 || seg[j1] !== seg[j2] || span < half) {
      stopped = false;
      continue;
    }
    const vax = (ax[j2] - ax[j1]) / span;
    const vay = (ay[j2] - ay[j1]) / span;
    const vbx = (bx[j2] - bx[j1]) / span;
    const vby = (by[j2] - by[j1]) / span;
    aim[i] = vax;
    target[i] = vbx;
    const speed = Math.hypot(vbx, vby);
    if (!f.engaged[i] || speed < MIN_SPEED || i === 0) {
      stopped = false;
      continue;
    }
    // Velocidad de la mira en la dirección en que se mueve el objetivo, y su proporción
    const along = (vax * vbx + vay * vby) / speed;
    const ratio = along / speed;
    const dt = Math.min(f.t[i] - f.t[i - 1], 0.05);
    time += dt;
    speedSum += speed * dt;
    sq += (along - speed) ** 2 * dt;
    if (!stopped && ratio < STOP_IN) {
      stopped = true;
      stops++;
    } else if (stopped && ratio > STOP_OUT) {
      stopped = false;
    }
    if (stopped) stopTime += dt;
    if (ratio > BURST) burstTime += dt;
  }

  const smooth = time >= MIN_TIME ? {
    time,
    mismatchPct: (100 * Math.sqrt(sq / time)) / (speedSum / time),
    stoppedPct: (100 * stopTime) / time,
    burstPct: (100 * burstTime) / time,
    stopsPerSec: stops / time,
  } : null;
  return { smooth, series: { t: f.t, aim, target, err: f.ex, radius: f.radius } };
}
