// Análisis de la puntería de una partida. No cambia la puntuación: sirve para
// saber qué se hace mal.
//  - Tracking: si la mira va por detrás o por delante del objetivo (en la
//    dirección en que se mueve) y cuánto se pierde tras un cambio de sentido.
//  - Flicks: si el movimiento principal se pasa del objetivo, se queda corto o
//    cae encima, y cuánto se tarda en corregir hasta el disparo.
// Todo se mide en grados sobre la vista del jugador.
import { DEG } from './settings.js';
import { t } from './i18n.js';

const MOVING = 4; // °/s: por debajo, el objetivo se considera quieto
const REVERSAL_WINDOW = 0.4; // s que se cuentan como "tras un cambio de sentido"
const REVERSAL_DOT = -0.3; // coseno entre direcciones consecutivas que cuenta como cambio de sentido
const IN_SYNC_MS = 10; // margen para contar la mira como sincronizada
const MIN_FLICK = 1.5; // °: los flicks más cortos no se analizan
const FLICK_MAX_TIME = 3; // s: solo se guarda este trozo del recorrido de la mira
const SPEED_WINDOW = 0.015; // s para suavizar la velocidad de la mira
const END_SPEED = 0.2; // fin del movimiento principal: velocidad < 20% del pico
const MIN_TRACK_TIME = 3; // s de tracking necesarios para dar resultados
const MIN_REVERSAL_TIME = 1;
const MIN_FLICKS = 5;
// Umbrales de los consejos (orientativos)
const TIP_LAG_MS = 30;
const TIP_REVERSAL_DROP = 15; // puntos de % en objetivo
const TIP_FLICK_BIAS = 15; // puntos de % entre pasarse y quedarse corto

const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Yaw y pitch (rad) de la dirección de `from` a `to`, con el mismo criterio que la cámara. */
function anglesTo(from, to, y = to.y) {
  const dx = to.x - from.x;
  const dy = y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dist: Math.hypot(dx, dy, dz) };
}

export class AimAnalysis {
  constructor(player) {
    this.player = player;
    // Tracking
    this.ref = null; // objetivo que se está siguiendo
    this.prev = null; // su dirección en el frame anterior
    this.refDir = null; // su dirección de movimiento en pantalla (unitaria)
    this.engaged = false;
    this.reversalUntil = -Infinity;
    this.steady = { time: 0, on: 0, lag: 0, speed: 0, behind: 0, ahead: 0 };
    this.reversal = { time: 0, on: 0 };
    // Flicks
    this.samples = []; // { t, yaw, pitch } de la mira
    this.segStart = 0;
    this.flicks = { n: 0, over: 0, under: 0, errPct: 0, correction: 0 };
  }

  /** Guarda la dirección de la mira. Se llama cada frame antes de disparar. */
  sample(now) {
    const s = this.samples;
    s.push({ t: now, yaw: this.player.yaw, pitch: this.player.pitch });
    let old = 0;
    while (old < s.length && s[old].t < now - FLICK_MAX_TIME) old++;
    if (old) s.splice(0, old);
  }

  /**
   * Tracking: se llama cada frame de juego.
   * @param aimed objetivo bajo la mira (o null)
   */
  frame(dt, now, targets, aimed) {
    if (dt <= 0) return;
    const p = this.player;

    // Referencia: el objetivo más cercano a la mira
    let best = null;
    for (const target of targets) {
      if (!target.alive) continue;
      const { center, half, radius } = target.aimInfo();
      const c = anglesTo(p.pos, center);
      const lo = anglesTo(p.pos, center, center.y - half).pitch;
      const hi = anglesTo(p.pos, center, center.y + half).pitch;
      // Error de la mira al objetivo; en vertical vale cualquier punto entre los pies y la cabeza
      const ex = (wrap(c.yaw - p.yaw) * Math.cos(c.pitch)) / DEG;
      const ey = (clamp(p.pitch, lo, hi) - p.pitch) / DEG;
      const err = Math.hypot(ex, ey);
      if (!best || err < best.err) best = { target, c, ex, ey, err, radius: Math.atan(radius / c.dist) / DEG };
    }
    if (!best) return;
    if (best.target !== this.ref) {
      this.ref = best.target;
      this.prev = null;
      this.refDir = null;
      this.engaged = false;
    }
    const { c, ex, ey, err } = best;
    const prev = this.prev;
    this.prev = c;
    if (!prev) return;

    // Enganche con histéresis: se entra cerca del objetivo y se sale al alejarse bastante
    const win = Math.max(2, 4 * best.radius);
    if (err < win) this.engaged = true;
    else if (err > 3 * win) this.engaged = false;

    const vx = (wrap(c.yaw - prev.yaw) * Math.cos(c.pitch)) / DEG / dt;
    const vy = (c.pitch - prev.pitch) / DEG / dt;
    const speed = Math.hypot(vx, vy);
    if (speed < MOVING) return;
    const ux = vx / speed;
    const uy = vy / speed;
    if (this.refDir && ux * this.refDir[0] + uy * this.refDir[1] < REVERSAL_DOT && this.engaged) {
      this.reversalUntil = now + REVERSAL_WINDOW;
    }
    this.refDir = [ux, uy];
    if (!this.engaged) return;

    const on = aimed === best.target ? dt : 0;
    if (now < this.reversalUntil) {
      this.reversal.time += dt;
      this.reversal.on += on;
    } else {
      // Error en la dirección del movimiento: > 0 = el objetivo va por delante de la mira
      const along = ex * ux + ey * uy;
      const st = this.steady;
      st.time += dt;
      st.on += on;
      st.lag += along * dt;
      st.speed += speed * dt;
      const lagMs = (1000 * along) / speed;
      if (lagMs > IN_SYNC_MS) st.behind += dt;
      else if (lagMs < -IN_SYNC_MS) st.ahead += dt;
    }
  }

  /**
   * Se llama en cada impacto.
   * @param first true si es el primer impacto a ese objetivo
   */
  onHit(target, first, killed, distance, now) {
    if (first && Number.isFinite(target.maxHp)) this.flick(target, distance, now);
    if (first || killed) this.segStart = now;
  }

  /** Analiza el recorrido de la mira desde que empezó el flick hasta el primer impacto. */
  flick(target, distance, now) {
    const start = Math.max(this.segStart, target.spawnTime, now - FLICK_MAX_TIME);
    const pts = this.samples.filter((s) => s.t >= start);
    if (pts.length < 3) return;
    const a = pts[0];
    const b = pts.at(-1);
    const cos = Math.cos(a.pitch);
    const xy = (s) => [(wrap(s.yaw - a.yaw) * cos) / DEG, (s.pitch - a.pitch) / DEG];
    const [bx, by] = xy(b);
    const dist = Math.hypot(bx, by);
    if (dist < MIN_FLICK) return;
    // Avance a lo largo de la línea que va del punto de partida al disparo
    const prog = pts.map((s) => {
      const [x, y] = xy(s);
      return (x * bx + y * by) / dist;
    });

    // Velocidad suavizada; el movimiento principal acaba al frenar tras el pico
    const vel = [0];
    for (let i = 1, j = 0; i < pts.length; i++) {
      while (j + 1 < i && pts[i].t - pts[j + 1].t >= SPEED_WINDOW) j++;
      const span = pts[i].t - pts[j].t;
      vel.push(span > 0 ? (prog[i] - prog[j]) / span : vel[i - 1]);
    }
    let peak = 0;
    for (let i = 1; i < vel.length; i++) if (vel[i] > vel[peak]) peak = i;
    if (vel[peak] <= 0) return;
    let end = pts.length - 1;
    for (let i = peak + 1; i < vel.length; i++) {
      if (vel[i] < END_SPEED * vel[peak]) {
        end = i;
        break;
      }
    }

    const tolerance = Math.atan(target.aimInfo().radius / distance) / DEG;
    const err = prog[end] - dist;
    const f = this.flicks;
    f.n++;
    if (err > tolerance) f.over++;
    else if (err < -tolerance) f.under++;
    f.errPct += (100 * err) / dist;
    f.correction += b.t - pts[end].t;
  }

  /** Resultado en números (null si no hay datos suficientes). */
  result() {
    const st = this.steady;
    const rv = this.reversal;
    const f = this.flicks;
    const tracking = st.time >= MIN_TRACK_TIME && st.speed > 0 ? {
      lagMs: (1000 * st.lag) / st.speed,
      behindPct: (100 * st.behind) / st.time,
      aheadPct: (100 * st.ahead) / st.time,
      steadyOnPct: (100 * st.on) / st.time,
      reversalOnPct: rv.time >= MIN_REVERSAL_TIME ? (100 * rv.on) / rv.time : null,
    } : null;
    const flicks = f.n >= MIN_FLICKS ? {
      n: f.n,
      overPct: (100 * f.over) / f.n,
      underPct: (100 * f.under) / f.n,
      directPct: (100 * (f.n - f.over - f.under)) / f.n,
      errPct: f.errPct / f.n,
      correctionMs: (1000 * f.correction) / f.n,
    } : null;
    return tracking || flicks ? { tracking, flicks } : null;
  }
}

const pct = (x) => `${x.toFixed(0)}%`;

/**
 * Textos del análisis en el idioma actual.
 * @returns { tiles: [[etiqueta, valor]], tips: [texto] }
 */
export function analysisView(a) {
  const tiles = [];
  const tips = [];
  const tr = a.tracking;
  if (tr) {
    const ms = Math.round(Math.abs(tr.lagMs));
    let lag = t('an.inSync');
    if (ms >= IN_SYNC_MS) lag = t(tr.lagMs > 0 ? 'an.behind' : 'an.ahead', { ms });
    tiles.push([t('an.lag'), lag], [t('an.share'), t('an.shareValue', { behind: pct(tr.behindPct), ahead: pct(tr.aheadPct) })]);
    if (tr.lagMs > TIP_LAG_MS) tips.push(t('an.tip.behind'));
    else if (tr.lagMs < -TIP_LAG_MS) tips.push(t('an.tip.ahead'));
    if (tr.reversalOnPct !== null) {
      tiles.push([t('an.reversal'), t('an.reversalValue', { after: pct(tr.reversalOnPct), rest: pct(tr.steadyOnPct) })]);
      if (tr.steadyOnPct - tr.reversalOnPct > TIP_REVERSAL_DROP) tips.push(t('an.tip.reversal'));
    }
  }
  const f = a.flicks;
  if (f) {
    const err = Math.round(Math.abs(f.errPct));
    tiles.push(
      [t('an.flicks'), String(f.n)],
      [t('an.over'), pct(f.overPct)],
      [t('an.under'), pct(f.underPct)],
      [t('an.direct'), pct(f.directPct)],
      [t('an.endpoint'), err === 0 ? t('an.endpointExact') : t(f.errPct > 0 ? 'an.endpointOver' : 'an.endpointUnder', { pct: err })],
      [t('an.correction'), `${Math.round(f.correctionMs)} ms`],
    );
    if (f.overPct - f.underPct > TIP_FLICK_BIAS) tips.push(t('an.tip.over'));
    else if (f.underPct - f.overPct > TIP_FLICK_BIAS) tips.push(t('an.tip.under'));
  }
  return { tiles, tips };
}
