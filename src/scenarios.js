import * as THREE from '/lib/three/three.module.js';
import { Target, SphereTarget, pickClass, CLASSES } from './target.js';
import { idealTTK, WEAPONS, SIGHTS } from './weapons.js';
import { DEG } from './settings.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pct = (a, b) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : '—');
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const secs = (x) => (Number.isFinite(x) ? `${x.toFixed(2)} s` : '—');
const ms = (x) => (Number.isFinite(x) ? `${Math.round(x * 1000)} ms` : '—');

export function createStats() {
  return {
    time: 0, shots: 0, hits: 0, headshots: 0, damage: 0, kills: 0, onTargetTime: 0,
    killTimes: [], // aparición -> kill
    ttks: [], // primer impacto -> kill
    idealTtks: [],
    reactions: [], // aparición -> primer impacto
  };
}

/** Punto en el suelo delante del origen del jugador (hacia -Z) con un ángulo dado. */
function spawnPoint(player, dist, yawDeg) {
  const a = yawDeg * DEG;
  return new THREE.Vector3(player.pos.x - Math.sin(a) * dist, 0, player.pos.z - Math.cos(a) * dist);
}

/** Punto a `dist` metros de los ojos del jugador en la dirección (yaw, pitch) en grados. */
function aimPoint(player, dist, yawDeg, pitchDeg) {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  return new THREE.Vector3(
    player.pos.x - Math.sin(y) * Math.cos(p) * dist,
    player.pos.y + Math.sin(p) * dist,
    player.pos.z - Math.cos(y) * Math.cos(p) * dist,
  );
}

class Scenario {
  constructor(ctx) {
    this.ctx = ctx;
    this.targets = [];
    this.pending = []; // respawns programados: { at, slot }
  }

  get hitMeshes() {
    return this.targets.flatMap((t) => t.hitMeshes);
  }

  update(dt) {
    const now = this.ctx.stats.time;
    for (const t of this.targets) t.update(dt, this.ctx.camera);
    const due = this.pending.filter((p) => p.at <= now);
    if (due.length) {
      this.pending = this.pending.filter((p) => p.at > now);
      for (const p of due) this.spawn(p.slot);
    }
  }

  newTarget(opts) {
    const s = this.ctx.settings;
    const t = new Target(this.ctx.scene, {
      classKey: pickClass(s.targetClass),
      speedScale: s.targetSpeed,
      jumps: s.targetJumps,
      ...opts,
    });
    t.spawnTime = this.ctx.stats.time;
    this.targets.push(t);
    return t;
  }

  newSphere(opts) {
    const t = new SphereTarget(this.ctx.scene, { ...opts, radius: opts.radius * this.ctx.settings.sphereScale });
    t.spawnTime = this.ctx.stats.time;
    this.targets.push(t);
    return t;
  }

  removeTarget(t) {
    t.dispose();
    this.targets = this.targets.filter((x) => x !== t);
  }

  onHit() {}
  spawn() {}

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.targets = [];
    this.pending = [];
  }
}

// Un objetivo inmortal en movimiento. Mide tiempo en objetivo.
// `makeTarget(scenario)` crea y coloca el objetivo.
class TrackingScenario extends Scenario {
  constructor(ctx, makeTarget) {
    super(ctx);
    this.makeTarget = makeTarget;
    this.spawn();
  }

  spawn() {
    this.makeTarget(this);
  }

  live(st) {
    return `En objetivo ${pct(st.onTargetTime, st.time)} · Precisión ${pct(st.hits, st.shots)}`;
  }

  score(st) {
    return st.time > 0 ? (100 * st.onTargetTime) / st.time : 0;
  }


  summary(st) {
    return [
      ['Tiempo en objetivo', pct(st.onTargetTime, st.time)],
      ['Precisión', pct(st.hits, st.shots)],
      ['Headshots', pct(st.headshots, st.hits)],
      ['Daño total', Math.round(st.damage)],
      ['DPS', (st.damage / Math.max(st.time, 1e-6)).toFixed(1)],
    ];
  }
}

// Objetivos con la vida de su clase. Al morir reaparecen en otra posición.
class EliminationScenario extends Scenario {
  constructor(ctx, { count, arc, respawnDelay }) {
    super(ctx);
    this.count = count;
    this.arc = arc;
    this.respawnDelay = respawnDelay;
    for (let i = 0; i < count; i++) this.spawn(i);
  }

  spawn(slot) {
    const { player, settings } = this.ctx;
    const dist = settings.targetDistance * rand(0.7, 1.3);
    const sector = (2 * this.arc) / this.count;
    const yaw = -this.arc + sector * (slot + rand(0.15, 0.85));
    const t = this.newTarget({ lane: Math.max(2, dist * 0.15) });
    t.slot = slot;
    t.spawnDist = dist;
    t.place(spawnPoint(player, dist, yaw), player.pos);
  }

  onHit(target, part, res) {
    if (!res.killed) return;
    const st = this.ctx.stats;
    st.kills++;
    st.killTimes.push(st.time - target.spawnTime);
    st.ttks.push(st.time - target.firstHitTime);
    st.reactions.push(target.firstHitTime - target.spawnTime);
    st.idealTtks.push(idealTTK(this.ctx.weapon, CLASSES[target.classKey].hp, target.spawnDist));
    this.removeTarget(target);
    this.pending.push({ at: st.time + this.respawnDelay, slot: target.slot });
  }

  live(st) {
    return `Kills ${st.kills} · TTK ${secs(avg(st.ttks))} · Precisión ${pct(st.hits, st.shots)}`;
  }

  score(st) {
    return st.kills;
  }


  summary(st) {
    return [
      ['Kills', st.kills],
      ['Tiempo por kill (desde aparición)', secs(avg(st.killTimes))],
      ['Reacción (aparición → 1er impacto)', ms(avg(st.reactions))],
      ['TTK (1er impacto → kill)', secs(avg(st.ttks))],
      ['TTK ideal (todo al cuerpo)', secs(avg(st.idealTtks))],
      ['Precisión', pct(st.hits, st.shots)],
      ['Headshots', pct(st.headshots, st.hits)],
    ];
  }
}

// Objetivos estáticos de un solo impacto repartidos en un arco amplio.
class FlickScenario extends Scenario {
  constructor(ctx) {
    super(ctx);
    this.spawn();
  }

  spawn() {
    const { player, settings } = this.ctx;
    const dist = settings.targetDistance * rand(0.5, 1.8);
    const t = this.newTarget({ hp: 1, move: 'static' });
    t.place(spawnPoint(player, dist, rand(-60, 60)), player.pos);
  }

  onHit(target, part, res) {
    if (!res.killed) return;
    const st = this.ctx.stats;
    st.kills++;
    st.killTimes.push(st.time - target.spawnTime);
    this.removeTarget(target);
    this.pending.push({ at: st.time + 0.15, slot: 0 });
  }

  live(st) {
    return `Kills ${st.kills} · ${ms(avg(st.killTimes))} · Precisión ${pct(st.hits, st.shots)}`;
  }

  score(st) {
    return st.kills;
  }


  summary(st) {
    return [
      ['Kills', st.kills],
      ['Tiempo medio por objetivo', ms(avg(st.killTimes))],
      ['Precisión', pct(st.hits, st.shots)],
      ['Headshots', pct(st.headshots, st.hits)],
    ];
  }
}

// Base de los escenarios de esferas de un impacto: al romper una aparece otra.
class SphereFlickScenario extends Scenario {
  constructor(ctx) {
    super(ctx);
    this.lastKill = 0;
    this.lastKilled = null;
  }

  onHit(target, part, res) {
    if (!res.killed) return;
    const st = this.ctx.stats;
    st.kills++;
    st.killTimes.push(st.time - this.lastKill);
    this.lastKill = st.time;
    this.lastKilled = target;
    this.removeTarget(target);
    this.spawn();
  }

  live(st) {
    return `Kills ${st.kills} · ${ms(avg(st.killTimes))} · Precisión ${pct(st.hits, st.shots)}`;
  }

  score(st) {
    return st.kills;
  }


  summary(st) {
    return [
      ['Kills', st.kills],
      ['Tiempo entre kills', ms(avg(st.killTimes))],
      ['Precisión', pct(st.hits, st.shots)],
    ];
  }
}

// Tres esferas a la vez en una cuadrícula plana delante del jugador.
class GridshotScenario extends SphereFlickScenario {
  constructor(ctx, { count = 3, cols = 5, rows = 4, dist = 12, spacing = 1.4 } = {}) {
    super(ctx);
    // Cuadrícula centrada 1 m por encima de los ojos para que la fila baja no toque el suelo
    const { pos } = ctx.player;
    this.cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.cells.push(new THREE.Vector3(pos.x + (c - (cols - 1) / 2) * spacing, pos.y + 1 + (r - (rows - 1) / 2) * spacing, pos.z - dist));
      }
    }
    for (let i = 0; i < count; i++) this.spawn();
  }

  spawn() {
    // Nunca en una casilla ocupada ni en la que se acaba de romper
    const used = new Set(this.targets.map((t) => t.cell));
    if (this.lastKilled) used.add(this.lastKilled.cell);
    const free = this.cells.map((_, i) => i).filter((i) => !used.has(i));
    const t = this.newSphere({ radius: 0.35 });
    t.cell = free[Math.floor(Math.random() * free.length)];
    t.place(this.cells[t.cell]);
  }
}

// Una esfera pequeña que reaparece a pocos grados de la anterior: microajustes.
class PrecisionScenario extends SphereFlickScenario {
  constructor(ctx) {
    super(ctx);
    this.yaw = 0;
    this.pitch = 3;
    this.spawn();
  }

  spawn() {
    // Salto de 2-8° en una dirección que no se salga del área (±25° yaw, -4..14° pitch)
    for (let tries = 0; tries < 50; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(2, 8);
      const yaw = this.yaw + Math.cos(a) * d;
      const pitch = this.pitch + Math.sin(a) * d;
      if (Math.abs(yaw) <= 25 && pitch >= -4 && pitch <= 14) {
        this.yaw = yaw;
        this.pitch = pitch;
        break;
      }
    }
    const t = this.newSphere({ radius: 0.13 });
    t.place(aimPoint(this.ctx.player, 15, this.yaw, this.pitch));
  }
}

const percent = (x) => `${x.toFixed(1)}%`;
const percentTick = (v) => `${v}%`;
const kills = (x) => `${Number.isInteger(x) ? x : x.toFixed(1)} kills`;
const killsTick = (v) => String(v);

// Configuración fija del modo Escenarios (con registro). Cada escenario la
// completa con su `fixed`. Si cambias la configuración efectiva de un escenario,
// sube su `version`: el historial se separa por versión.
export const RANKED_BASE = {
  sight: 'weapon',
  adsTimeOverride: 0,
  targetClass: 'medium',
  targetDistance: 20,
  targetSpeed: 1,
  targetJumps: true,
  sphereScale: 1,
  allowMove: false,
  moveSpeed: 5,
  duration: 60,
};

/** Ajustes efectivos de una partida: en modo Escenarios se imponen los fijos. */
export function scenarioSettings(settings, key, ranked) {
  return ranked ? { ...settings, ...RANKED_BASE, ...SCENARIOS[key].fixed } : settings;
}

/** Resumen legible de la configuración fija de un escenario. */
export function describeFixed(key) {
  const def = SCENARIOS[key];
  const s = { ...RANKED_BASE, ...def.fixed };
  const parts = [WEAPONS[s.weapon].name.split(' (')[0]];
  if (s.sight !== 'weapon') parts.push(`mira ${SIGHTS[s.sight].name.split(' (')[0]}`);
  if (!def.spheres) parts.push(CLASSES[s.targetClass].name, def.distanceLabel ?? `${s.targetDistance} m`);
  parts.push(`${s.duration} s`);
  return parts.join(' · ');
}

export const SCENARIOS = {
  tracking: {
    group: 'Humanoides',
    name: 'Tracking',
    desc: 'Un objetivo inmortal hace strafe, salta y dashea. Mantén el ADS encima.',
    version: 1,
    fixed: { weapon: 'ar' },
    formatScore: percent,
    formatTick: percentTick,
    create: (ctx) => new TrackingScenario(ctx, (sc) => {
      const { player, settings } = ctx;
      const t = sc.newTarget({ hp: Infinity, lane: Math.max(2, settings.targetDistance * 0.2) });
      t.place(spawnPoint(player, settings.targetDistance, 0), player.pos);
    }),
  },
  closetrack: {
    group: 'Humanoides',
    name: 'Tracking cercano',
    version: 1,
    fixed: { weapon: 'smg', targetClass: 'light' },
    distanceLabel: '7 m',
    formatScore: percent,
    formatTick: percentTick,
    desc: 'A 7 m, como un fight cuerpo a cuerpo: cambia de dirección sin parar, se acerca y se aleja, salta y dashea.',
    create: (ctx) => new TrackingScenario(ctx, (sc) => {
      const t = sc.newTarget({
        hp: Infinity,
        lane: 3.5,
        ai: { changeMin: 0.12, changeMax: 0.5, flipChance: 0.8, jumpChance: 0.3, dashChance: 0.2, depth: 2.5 },
      });
      t.place(spawnPoint(ctx.player, 7, 0), ctx.player.pos);
    }),
  },
  duel: {
    group: 'Humanoides',
    name: 'Duelo',
    version: 1,
    fixed: { weapon: 'ar' },
    formatScore: kills,
    formatTick: killsTick,
    desc: 'Un enemigo con la vida de su clase. Flick + ADS + tracking hasta matarlo.',
    create: (ctx) => new EliminationScenario(ctx, { count: 1, arc: 40, respawnDelay: 0.4 }),
  },
  switching: {
    group: 'Humanoides',
    name: 'Cambio de objetivo',
    version: 1,
    fixed: { weapon: 'ar' },
    formatScore: kills,
    formatTick: killsTick,
    desc: 'Tres enemigos a la vez, como un fight de equipo. Mata y cambia rápido.',
    create: (ctx) => new EliminationScenario(ctx, { count: 3, arc: 45, respawnDelay: 0.6 }),
  },
  flick: {
    group: 'Humanoides',
    name: 'Flick ADS',
    version: 1,
    fixed: { weapon: 'revolver' },
    formatScore: kills,
    formatTick: killsTick,
    desc: 'Objetivos estáticos de un impacto en un arco de 120°. Entra en ADS y dispara.',
    create: (ctx) => new FlickScenario(ctx),
  },
  gridshot: {
    group: 'Esferas',
    spheres: true,
    name: 'Gridshot',
    version: 1,
    fixed: { weapon: 'dmr', sight: 'low' },
    formatScore: kills,
    formatTick: killsTick,
    desc: 'Tres esferas a la vez en una cuadrícula. Al romper una aparece otra. Velocidad y ritmo.',
    create: (ctx) => new GridshotScenario(ctx),
  },
  precision: {
    group: 'Esferas',
    spheres: true,
    name: 'Precisión',
    version: 1,
    fixed: { weapon: 'dmr', sight: 'low' },
    formatScore: kills,
    formatTick: killsTick,
    desc: 'Una esfera pequeña que reaparece a pocos grados de la anterior. Microajustes en ADS.',
    create: (ctx) => new PrecisionScenario(ctx),
  },
  airtrack: {
    group: 'Esferas',
    spheres: true,
    name: 'Tracking 3D',
    version: 1,
    fixed: { weapon: 'ar' },
    formatScore: percent,
    formatTick: percentTick,
    desc: 'Una esfera flotante con trayectorias suaves en las tres dimensiones, también en vertical.',
    create: (ctx) => new TrackingScenario(ctx, (sc) => {
      const { player, settings } = ctx;
      const center = new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z - 12);
      const t = sc.newSphere({
        radius: 0.35,
        hp: Infinity,
        move: 'float',
        speed: 6 * settings.targetSpeed,
        bounds: { center, half: new THREE.Vector3(6, 2.2, 3) },
      });
      t.place(center);
    }),
  },
};
