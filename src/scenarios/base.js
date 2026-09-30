// Piezas comunes de los escenarios: estadísticas, utilidades y las clases base
// que comparten varios. Lo que solo usa un escenario va en su propio archivo.
import * as THREE from '../../lib/three/three.module.js';
import { Target, SphereTarget, pickClass, CLASSES } from '../target.js';
import { idealTTK } from '../weapons.js';
import { DEG } from '../settings.js';
import { t } from '../i18n.js';

export const rand = (a, b) => a + Math.random() * (b - a);
export const pct = (a, b) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : '—');
export const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const secs = (x) => (Number.isFinite(x) ? `${x.toFixed(2)} s` : '—');
export const ms = (x) => (Number.isFinite(x) ? `${Math.round(x * 1000)} ms` : '—');

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
export function spawnPoint(player, dist, yawDeg) {
  const a = yawDeg * DEG;
  return new THREE.Vector3(player.pos.x - Math.sin(a) * dist, 0, player.pos.z - Math.cos(a) * dist);
}

/** Punto a `dist` metros de los ojos del jugador en la dirección (yaw, pitch) en grados. */
export function aimPoint(player, dist, yawDeg, pitchDeg) {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  return new THREE.Vector3(
    player.pos.x - Math.sin(y) * Math.cos(p) * dist,
    player.pos.y + Math.sin(p) * dist,
    player.pos.z - Math.cos(y) * Math.cos(p) * dist,
  );
}

export class Scenario {
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
export class TrackingScenario extends Scenario {
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

// Objetivos con la vida de su clase. Al morir reaparecen en otra posición.
export class EliminationScenario extends Scenario {
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

// Base de los escenarios de esferas de un impacto: al romper una aparece otra.
export class SphereFlickScenario extends Scenario {
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
