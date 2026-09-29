import * as THREE from '/lib/three/three.module.js';
import { Target, pickClass, CLASSES } from './target.js';
import { idealTTK } from './weapons.js';
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

// Un objetivo inmortal que hace strafe delante. Mide tiempo en objetivo.
class TrackingScenario extends Scenario {
  constructor(ctx) {
    super(ctx);
    this.spawn();
  }

  spawn() {
    const { player, settings } = this.ctx;
    const t = this.newTarget({ hp: Infinity, lane: Math.max(2, settings.targetDistance * 0.2) });
    t.place(spawnPoint(player, settings.targetDistance, 0), player.pos);
  }

  live(st) {
    return `En objetivo ${pct(st.onTargetTime, st.time)} · Precisión ${pct(st.hits, st.shots)}`;
  }

  score(st) {
    return st.time > 0 ? (100 * st.onTargetTime) / st.time : 0;
  }

  formatScore(x) {
    return `${x.toFixed(1)}%`;
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

  formatScore(x) {
    return `${x} kills`;
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

  formatScore(x) {
    return `${x} kills`;
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

export const SCENARIOS = {
  tracking: {
    name: 'Tracking',
    desc: 'Un objetivo inmortal hace strafe, salta y dashea. Mantén el ADS encima.',
    create: (ctx) => new TrackingScenario(ctx),
  },
  duel: {
    name: 'Duelo',
    desc: 'Un enemigo con la vida de su clase. Flick + ADS + tracking hasta matarlo.',
    create: (ctx) => new EliminationScenario(ctx, { count: 1, arc: 40, respawnDelay: 0.4 }),
  },
  switching: {
    name: 'Cambio de objetivo',
    desc: 'Tres enemigos a la vez, como un fight de equipo. Mata y cambia rápido.',
    create: (ctx) => new EliminationScenario(ctx, { count: 3, arc: 45, respawnDelay: 0.6 }),
  },
  flick: {
    name: 'Flick ADS',
    desc: 'Objetivos estáticos de un impacto en un arco de 120°. Entra en ADS y dispara.',
    create: (ctx) => new FlickScenario(ctx),
  },
};
