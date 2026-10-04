// Trazado de una partida: la mira y el objetivo de referencia en cada fotograma.
// Solo se conserva el de la última partida (en memoria) y se puede exportar a
// JSON para analizarlo fuera. De él sale también la fluidez del tracking: si la
// mira lleva la velocidad del objetivo o va a trompicones, acelerando y frenando
// alrededor de ella.
// Los ángulos van en grados.
import { DEG } from './settings.js';

const COLS = ['t', 'yaw', 'pitch', 'dx', 'dy', 'ads', 'on', 'target', 'tyaw', 'tpitch', 'ex', 'ey', 'radius', 'engaged'];
const WINDOW = 0.04; // s sobre los que se mide la velocidad (un fotograma suelto son 1-2 counts del ratón)
const MIN_SPEED = 8; // °/s del objetivo: por debajo no se compara la velocidad
const MAX_JUMP = 5; // ° en un fotograma: el objetivo ha reaparecido en otro sitio
const SWING = 0.15; // vaivén: la mira pasa de ir un 15 % más lenta que el objetivo a un 15 % más rápida (o al revés)
const CENTER = 0.15; // cruce: la mira pasa de un lado del centro al otro (margen en radios del objetivo)
const MIN_TIME = 3; // s de tracking necesarios para dar resultados
// Desglose de dónde se pierde el objetivo
const TURN_HALF = 0.05; // s a cada lado para medir cuánto cambia la velocidad del objetivo
const TURN = 2.5; // 1/s: "cambiando" si su velocidad cambia a más de 2,5 veces su valor por segundo (la mitad en 0,2 s)
const MIN_ROW = 2; // s en una situación para mostrarla
const MIN_OFF = 1; // s fuera del objetivo para decir por dónde se pierde
const GROUPS = [['speed', ['slow', 'fast']], ['change', ['steady', 'turning']], ['dir', ['left', 'right', 'up', 'down']]];

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
 * Tiempo en objetivo según la situación (velocidad del objetivo, si está
 * cambiando de velocidad o de rumbo, hacia dónde va) y por dónde se pierde.
 * `loss` son los puntos de % en objetivo que se ganarían si esa situación fuera
 * como el resto de su grupo.
 * @param samples [{ i, dt, speed, offAhead, offSide }] fotogramas de tracking, en orden
 * @param vx,vy   velocidad del objetivo en cada fotograma (NaN si no hay)
 */
function breakdownOf(f, seg, vx, vy, samples) {
  const n = f.t.length;
  const speeds = samples.map((s) => s.speed).sort((a, b) => a - b);
  const median = speeds[Math.floor(speeds.length / 2)];
  const buckets = Object.fromEntries(GROUPS.flatMap(([, keys]) => keys).map((k) => [k, { time: 0, on: 0 }]));
  const off = { behind: 0, ahead: 0, side: 0 };
  let time = 0;
  let onTime = 0;
  let k1 = 0;
  let k2 = 0;
  for (const s of samples) {
    const { i, dt } = s;
    const on = f.on[i] ? dt : 0;
    const add = (key) => {
      buckets[key].time += dt;
      buckets[key].on += on;
    };
    time += dt;
    onTime += on;
    add(s.speed < median ? 'slow' : 'fast');
    while (f.t[k1] < f.t[i] - TURN_HALF) k1++;
    while (k2 + 1 < n && f.t[k2 + 1] <= f.t[i] + TURN_HALF) k2++;
    const span = f.t[k2] - f.t[k1];
    if (span >= TURN_HALF && seg[k1] === seg[k2] && Number.isFinite(vx[k1]) && Number.isFinite(vx[k2])) {
      add(Math.hypot(vx[k2] - vx[k1], vy[k2] - vy[k1]) / span > TURN * s.speed ? 'turning' : 'steady');
    }
    if (Math.abs(vx[i]) >= Math.abs(vy[i])) add(vx[i] > 0 ? 'right' : 'left');
    else add(vy[i] > 0 ? 'up' : 'down');
    if (!on) off[Math.abs(s.offSide) > Math.abs(s.offAhead) ? 'side' : s.offAhead > 0 ? 'ahead' : 'behind'] += dt;
  }

  const groups = [];
  for (const [id, keys] of GROUPS) {
    const shown = keys.filter((k) => buckets[k].time >= MIN_ROW);
    if (shown.length < 2) continue;
    const all = shown.reduce((a, k) => ({ time: a.time + buckets[k].time, on: a.on + buckets[k].on }), { time: 0, on: 0 });
    groups.push({
      id,
      rows: shown.map((key) => {
        const b = buckets[key];
        const restPct = (100 * (all.on - b.on)) / (all.time - b.time);
        const onPct = (100 * b.on) / b.time;
        return { key, sharePct: (100 * b.time) / all.time, onPct, restPct, loss: (b.time / all.time) * (restPct - onPct) };
      }),
    });
  }
  const offTime = off.behind + off.ahead + off.side;
  return {
    time,
    onPct: (100 * onTime) / time,
    groups,
    off: offTime >= MIN_OFF ? {
      behindPct: (100 * off.behind) / offTime,
      aheadPct: (100 * off.ahead) / offTime,
      sidePct: (100 * off.side) / offTime,
    } : null,
  };
}

/**
 * Fluidez del tracking, desglose de dónde se pierde el objetivo y series para
 * la gráfica.
 * @returns {{ smooth, breakdown, series }} `smooth` y `breakdown` son null si no
 *   hay tracking suficiente; null si el trazado está vacío
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
  const targetY = new Float64Array(n).fill(NaN); // su velocidad vertical, para el desglose
  const samples = [];
  let time = 0;
  let speedSum = 0;
  let sq = 0;
  const ratios = [];
  let swings = 0; // cambios entre "más lenta" y "más rápida" que el objetivo
  let pace = 0; // -1 = más lenta, 1 = más rápida
  let crossings = 0; // pasos de detrás a delante del centro del objetivo (o al revés)
  let side = 0; // -1 = por detrás, 1 = por delante
  const half = WINDOW / 2;
  for (let i = 0, j1 = 0, j2 = 0; i < n; i++) {
    while (f.t[j1] < f.t[i] - half) j1++;
    while (j2 + 1 < n && f.t[j2 + 1] <= f.t[i] + half) j2++;
    const span = f.t[j2] - f.t[j1];
    if (f.target[i] < 0 || seg[j1] !== seg[j2] || span < half) {
      pace = 0;
      side = 0;
      continue;
    }
    const vax = (ax[j2] - ax[j1]) / span;
    const vay = (ay[j2] - ay[j1]) / span;
    const vbx = (bx[j2] - bx[j1]) / span;
    const vby = (by[j2] - by[j1]) / span;
    aim[i] = vax;
    target[i] = vbx;
    targetY[i] = vby;
    const speed = Math.hypot(vbx, vby);
    if (!f.engaged[i] || speed < MIN_SPEED || i === 0) {
      pace = 0;
      side = 0;
      continue;
    }
    // Velocidad de la mira en la dirección en que se mueve el objetivo, y su proporción
    const along = (vax * vbx + vay * vby) / speed;
    const ratio = along / speed;
    const dt = Math.min(f.t[i] - f.t[i - 1], 0.05);
    time += dt;
    speedSum += speed * dt;
    sq += (along - speed) ** 2 * dt;
    ratios.push(ratio);
    const nowPace = ratio > 1 + SWING ? 1 : ratio < 1 - SWING ? -1 : 0;
    if (nowPace) {
      if (pace && nowPace !== pace) swings++;
      pace = nowPace;
    }
    // Mira respecto al centro del objetivo, en la dirección en que se mueve (> 0 = por delante)
    const ahead = (f.ex[i] * vbx + (f.pitch[i] - f.tpitch[i]) * vby) / speed;
    // Para saber por dónde se pierde: la mira respecto al punto más cercano del
    // eje vertical del objetivo (`ey` vale 0 entre los pies y la cabeza; en una
    // esfera el eje es su centro), por delante/detrás y de lado
    const oy = -f.ey[i];
    samples.push({ i, dt, speed, offAhead: (f.ex[i] * vbx + oy * vby) / speed, offSide: (oy * vbx - f.ex[i] * vby) / speed });
    const margin = CENTER * f.radius[i];
    const nowSide = ahead > margin ? 1 : ahead < -margin ? -1 : 0;
    if (nowSide) {
      if (side && nowSide !== side) crossings++;
      side = nowSide;
    }
  }

  ratios.sort((a, b) => a - b);
  const quartile = (q) => 100 * ratios[Math.floor(q * (ratios.length - 1))];
  const smooth = time >= MIN_TIME ? {
    time,
    mismatchPct: (100 * Math.sqrt(sq / time)) / (speedSum / time),
    // La mitad del tiempo la mira va entre estos dos % de la velocidad del objetivo
    slowPct: quartile(0.25),
    fastPct: quartile(0.75),
    swingsPerSec: swings / 2 / time, // un vaivén = acelerar y volver a frenar
    crossingsPerSec: crossings / time,
  } : null;
  const breakdown = time >= MIN_TIME ? breakdownOf(f, seg, target, targetY, samples) : null;
  return { smooth, breakdown, series: { t: f.t, aim, target, err: f.ex, radius: f.radius } };
}
