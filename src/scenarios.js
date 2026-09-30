import * as THREE from '../lib/three/three.module.js';
import { Target, SphereTarget, pickClass, CLASSES } from './target.js';
import { idealTTK, weaponName } from './weapons.js';
import { DEG } from './settings.js';
import { t } from './i18n.js';

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
    movingTime: 0, // con WASD pulsado
    peeks: 0, // veces que el objetivo ha asomado
    punished: 0, // peeks en los que se le ha dado al menos una vez
    peekReactions: [], // empieza a asomar -> primer impacto en ese peek
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
    this.colliders = []; // geometría propia que bloquea las balas (coberturas)
    this.requireMove = false; // true: el tiempo en objetivo solo cuenta si el jugador se mueve
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
    return t('live.tracking', { onTarget: pct(st.onTargetTime, st.time), acc: pct(st.hits, st.shots) });
  }

  score(st) {
    return st.time > 0 ? (100 * st.onTargetTime) / st.time : 0;
  }


  summary(st) {
    return [
      ['sum.onTarget', pct(st.onTargetTime, st.time)],
      ['sum.accuracy', pct(st.hits, st.shots)],
      ['sum.headshots', pct(st.headshots, st.hits)],
      ['sum.damage', Math.round(st.damage)],
      ['sum.dps', (st.damage / Math.max(st.time, 1e-6)).toFixed(1)],
    ];
  }
}

// Tracking en el que hay que moverse: el tiempo en objetivo solo cuenta
// mientras se pulsa WASD (si el movimiento está permitido).
class MoveTrackScenario extends TrackingScenario {
  constructor(ctx, makeTarget) {
    super(ctx, makeTarget);
    this.requireMove = ctx.settings.allowMove;
  }

  live(st) {
    return t('live.movetrack', { onTarget: pct(st.onTargetTime, st.time), moving: pct(st.movingTime, st.time) });
  }

  summary(st) {
    return [
      ['sum.onTargetMoving', pct(st.onTargetTime, st.time)],
      ['sum.movingTime', pct(st.movingTime, st.time)],
      ...super.summary(st).slice(1),
    ];
  }
}

// Un enemigo que asoma por un lado de una cobertura, aguanta un momento (con
// algún ADAD) y vuelve a esconderse, a veces tras otra. Conserva la vida entre
// peeks. Se entrena a tener la mira preparada en los bordes.
const COVER = { halfW: 1.6, height: 2.6, depth: 0.6 };
const PEEK_ACCEL = 30;
const coverGeometry = new THREE.BoxGeometry(1, 1, 1);

class PeekScenario extends Scenario {
  constructor(ctx, { dist = 16, yaws = [-32, 0, 32] } = {}) {
    super(ctx);
    const { scene, player } = ctx;
    this.material = new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.9 });
    this.covers = yaws.map((yaw) => {
      const center = spawnPoint(player, dist, yaw);
      const toPlayer = new THREE.Vector3().subVectors(player.pos, center).setY(0).normalize();
      const mesh = new THREE.Mesh(coverGeometry, this.material);
      mesh.scale.set(2 * COVER.halfW, COVER.height, COVER.depth);
      mesh.position.copy(center).setY(COVER.height / 2);
      mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z); // cara ancha hacia el jugador
      mesh.updateMatrixWorld();
      scene.add(mesh);
      this.colliders.push(mesh);
      return { center, dist };
    });
    this.spawn();
  }

  spawn() {
    const t = this.newTarget({ move: 'static' });
    t.peek = { phase: 'hidden', timer: this.ctx.stats.time === 0 ? 1 : 0.4, exposed: false, hit: false, exposedAt: 0 };
    this.hide(t);
  }

  /** Esconde el objetivo tras una cobertura y un lado al azar. */
  hide(t) {
    const p = t.peek;
    p.cover = this.covers[Math.floor(Math.random() * this.covers.length)];
    p.side = Math.random() < 0.5 ? -1 : 1;
    p.depth = -(COVER.depth / 2 + 0.8);
    // Borde de la cobertura visto desde el jugador, a la profundidad del objetivo
    p.edge = (COVER.halfW * (p.cover.dist - p.depth)) / (p.cover.dist - COVER.depth / 2);
    p.hiddenLat = p.side * (COVER.halfW - t.cls.radius - 0.25);
    p.lat = p.goal = p.hiddenLat;
    p.vel = 0;
    t.place(p.cover.center, this.ctx.player.pos);
    this.position(t);
  }

  position(t) {
    const p = t.peek;
    t.group.position.copy(t.anchor).addScaledVector(t.axis, p.lat).addScaledVector(t.depthAxis, p.depth);
  }

  /** Un punto asomado: el cuerpo entero fuera del borde, más un poco. */
  outLat(t, min, max) {
    return t.peek.side * (t.peek.edge + t.cls.radius + rand(min, max));
  }

  update(dt) {
    super.update(dt);
    const st = this.ctx.stats;
    for (const t of this.targets) {
      const p = t.peek;
      p.timer -= dt;
      const reached = Math.abs(p.goal - p.lat) < 0.05 && Math.abs(p.vel) < 0.5;
      if (p.phase === 'hidden' && p.timer <= 0) {
        p.phase = 'out';
        p.goal = this.outLat(t, 0.3, 1.4);
      } else if (p.phase === 'out' && reached) {
        p.phase = 'hold';
        p.timer = rand(0.4, 1.1);
        p.jiggle = rand(0.2, 0.45);
      } else if (p.phase === 'hold') {
        p.jiggle -= dt;
        if (p.jiggle <= 0) {
          p.goal = this.outLat(t, 0.2, 1.5);
          p.jiggle = rand(0.2, 0.45);
        }
        if (p.timer <= 0) {
          p.phase = 'in';
          p.goal = p.hiddenLat;
        }
      } else if (p.phase === 'in' && reached) {
        p.phase = 'hidden';
        p.timer = rand(0.4, 1.2);
        if (Math.random() < 0.6) this.hide(t);
      }

      // Hacia su meta con aceleración limitada, frenando a tiempo
      const speed = t.cls.speed * this.ctx.settings.targetSpeed;
      const gap = p.goal - p.lat;
      const want = Math.sign(gap) * Math.min(speed, Math.sqrt(2 * PEEK_ACCEL * Math.abs(gap)));
      const maxDv = PEEK_ACCEL * dt;
      p.vel += Math.max(-maxDv, Math.min(maxDv, want - p.vel));
      p.lat += p.vel * dt;
      this.position(t);

      // Asomado = alguna parte del cuerpo fuera del borde
      const exposed = Math.abs(p.lat) + t.cls.radius > p.edge;
      if (exposed && !p.exposed) {
        st.peeks++;
        p.exposedAt = st.time;
        p.hit = false;
      }
      p.exposed = exposed;
      if (t.bar) t.bar.visible = exposed; // la barra no tiene depthTest: se vería a través de la pared
    }
  }

  onHit(target, part, res) {
    const st = this.ctx.stats;
    const p = target.peek;
    if (!p.hit) {
      p.hit = true;
      st.punished++;
      st.peekReactions.push(st.time - p.exposedAt);
    }
    if (!res.killed) return;
    st.kills++;
    this.removeTarget(target);
    this.pending.push({ at: st.time + 0.8, slot: 0 });
  }

  live(st) {
    return t('live.peek', { kills: st.kills, punished: pct(st.punished, st.peeks), acc: pct(st.hits, st.shots) });
  }

  score(st) {
    return st.kills;
  }

  summary(st) {
    return [
      ['sum.kills', st.kills],
      ['sum.peeks', st.peeks],
      ['sum.punished', pct(st.punished, st.peeks)],
      ['sum.peekReaction', ms(avg(st.peekReactions))],
      ['sum.accuracy', pct(st.hits, st.shots)],
      ['sum.headshots', pct(st.headshots, st.hits)],
    ];
  }

  dispose() {
    super.dispose();
    for (const mesh of this.colliders) mesh.removeFromParent();
    this.colliders = [];
    this.material.dispose();
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
    return t('live.elimination', { kills: st.kills, ttk: secs(avg(st.ttks)), acc: pct(st.hits, st.shots) });
  }

  score(st) {
    return st.kills;
  }


  summary(st) {
    return [
      ['sum.kills', st.kills],
      ['sum.killTime', secs(avg(st.killTimes))],
      ['sum.reaction', ms(avg(st.reactions))],
      ['sum.ttk', secs(avg(st.ttks))],
      ['sum.idealTtk', secs(avg(st.idealTtks))],
      ['sum.accuracy', pct(st.hits, st.shots)],
      ['sum.headshots', pct(st.headshots, st.hits)],
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
    return t('live.flick', { kills: st.kills, time: ms(avg(st.killTimes)), acc: pct(st.hits, st.shots) });
  }

  score(st) {
    return st.kills;
  }


  summary(st) {
    return [
      ['sum.kills', st.kills],
      ['sum.targetTime', ms(avg(st.killTimes))],
      ['sum.accuracy', pct(st.hits, st.shots)],
      ['sum.headshots', pct(st.headshots, st.hits)],
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
    return t('live.flick', { kills: st.kills, time: ms(avg(st.killTimes)), acc: pct(st.hits, st.shots) });
  }

  score(st) {
    return st.kills;
  }


  summary(st) {
    return [
      ['sum.kills', st.kills],
      ['sum.betweenKills', ms(avg(st.killTimes))],
      ['sum.accuracy', pct(st.hits, st.shots)],
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
// La mira no está aquí: es de cada jugador (Ajustes → Armas), como la sens o el FOV.
export const RANKED_BASE = {
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

/** Configuración fija de un escenario en piezas legibles (arma, mira, clase…). */
export function fixedParts(key) {
  const def = SCENARIOS[key];
  const s = { ...RANKED_BASE, ...def.fixed };
  const parts = [weaponName(s.weapon, true)];
  if (!def.spheres) parts.push(CLASSES[s.targetClass].name, def.distanceLabel ?? `${s.targetDistance} m`);
  if (s.allowMove) parts.push(t('chip.move'));
  parts.push(`${s.duration} s`);
  return parts;
}

// Textos en i18n: `scenario.<clave>` (nombre), `scenario.<clave>.desc` y `group.<grupo>`.
export const scenarioName = (key) => t(`scenario.${key}`);
export const scenarioDesc = (key) => t(`scenario.${key}.desc`);
export const groupName = (group) => t(`group.${group}`);

export const SCENARIOS = {
  tracking: {
    group: 'humanoids',
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
    group: 'humanoids',
    version: 1,
    fixed: { weapon: 'smg', targetClass: 'light' },
    distanceLabel: '7 m',
    formatScore: percent,
    formatTick: percentTick,
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
    group: 'humanoids',
    version: 1,
    fixed: { weapon: 'ar' },
    formatScore: kills,
    formatTick: killsTick,
    create: (ctx) => new EliminationScenario(ctx, { count: 1, arc: 40, respawnDelay: 0.4 }),
  },
  switching: {
    group: 'humanoids',
    version: 1,
    fixed: { weapon: 'ar' },
    formatScore: kills,
    formatTick: killsTick,
    create: (ctx) => new EliminationScenario(ctx, { count: 3, arc: 45, respawnDelay: 0.6 }),
  },
  flick: {
    group: 'humanoids',
    version: 1,
    fixed: { weapon: 'revolver' },
    formatScore: kills,
    formatTick: killsTick,
    create: (ctx) => new FlickScenario(ctx),
  },
  aerial: {
    group: 'situations',
    version: 1,
    fixed: { weapon: 'ar' },
    formatScore: percent,
    formatTick: percentTick,
    create: (ctx) => new TrackingScenario(ctx, (sc) => {
      const { player, settings } = ctx;
      const t = sc.newTarget({
        hp: Infinity,
        lane: Math.max(2, settings.targetDistance * 0.25),
        ai: { changeMin: 0.3, changeMax: 1, padChance: 0.3, depth: 2 },
      });
      t.place(spawnPoint(player, settings.targetDistance, 0), player.pos);
    }),
  },
  range: {
    group: 'situations',
    version: 1,
    fixed: { weapon: 'ar' },
    distanceLabel: '8–44 m',
    formatScore: percent,
    formatTick: percentTick,
    create: (ctx) => new TrackingScenario(ctx, (sc) => {
      // Va y viene entre 8 y 44 m sin dejar de moverse de lado
      const t = sc.newTarget({ hp: Infinity, lane: 4, ai: { depth: 18, sweep: true, depthSpeed: 0.8 } });
      t.place(spawnPoint(ctx.player, 26, 0), ctx.player.pos);
    }),
  },
  peek: {
    group: 'situations',
    version: 1,
    fixed: { weapon: 'ar' },
    distanceLabel: '16 m',
    formatScore: kills,
    formatTick: killsTick,
    create: (ctx) => new PeekScenario(ctx),
  },
  movetrack: {
    group: 'situations',
    version: 1,
    fixed: { weapon: 'ar', allowMove: true },
    distanceLabel: '12 m',
    formatScore: percent,
    formatTick: percentTick,
    create: (ctx) => new MoveTrackScenario(ctx, (sc) => {
      const t = sc.newTarget({ hp: Infinity, lane: 3.5 });
      t.place(spawnPoint(ctx.player, 12, 0), ctx.player.pos);
    }),
  },
  gridshot: {
    group: 'spheres',
    spheres: true,
    version: 1,
    fixed: { weapon: 'dmr' },
    formatScore: kills,
    formatTick: killsTick,
    create: (ctx) => new GridshotScenario(ctx),
  },
  precision: {
    group: 'spheres',
    spheres: true,
    version: 1,
    fixed: { weapon: 'dmr' },
    formatScore: kills,
    formatTick: killsTick,
    create: (ctx) => new PrecisionScenario(ctx),
  },
  airtrack: {
    group: 'spheres',
    spheres: true,
    version: 1,
    fixed: { weapon: 'ar' },
    formatScore: percent,
    formatTick: percentTick,
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
