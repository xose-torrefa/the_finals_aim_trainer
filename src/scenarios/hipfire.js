import * as THREE from '../../lib/three/three.module.js';
import { EliminationScenario, spawnPoint, rand } from './base.js';
import { DEG } from '../settings.js';

// Un Light a quemarropa que da vueltas alrededor del jugador, acercándose y
// alejándose, con algún salto y pocos dashes: los del juego, 2 cargas que se
// recargan de una en una cada 5 s. Al matarlo aparece otro delante. Se entrena
// el hipfire a muy corta distancia, donde el objetivo cruza la pantalla rápido.
const RADIUS = { min: 2.5, max: 6 }; // distancia al jugador (m)
const SPAWN = { min: 3.5, max: 5, arc: 35 }; // delante de la mira, ±arc grados
const DASH = { charges: 2, cooldown: 5, time: 0.18, mult: 2.6, chance: 0.3, gap: 0.8 };
// Los mismos valores que el strafe de target.js
const ACCEL = 30;
const GRAVITY = 18;
const JUMP_SPEED = 5.5;
const JUMP_CHANCE = 0.15;

const offset = new THREE.Vector3();
const radial = new THREE.Vector3();
const tangent = new THREE.Vector3();
const wanted = new THREE.Vector3();

class HipfireScenario extends EliminationScenario {
  constructor(ctx) {
    super(ctx, { count: 1, arc: 0, respawnDelay: 0.4 });
  }

  spawn(slot) {
    const { player, settings } = this.ctx;
    const dist = rand(SPAWN.min, SPAWN.max);
    // El escenario lo mueve: 'static' para que no use el strafe de Target
    const t = this.newTarget({ move: 'static' });
    t.slot = slot;
    t.spawnDist = dist;
    t.place(spawnPoint(player, dist, player.yaw / DEG + rand(-SPAWN.arc, SPAWN.arc)), player.pos);
    t.orbit = {
      vel: new THREE.Vector3(),
      dir: Math.random() < 0.5 ? -1 : 1, // sentido de giro alrededor del jugador
      goal: dist, // distancia a la que quiere estar
      timer: rand(0.3, 0.8),
      vy: 0,
      dash: 0, // tiempo que le queda al dash en curso
      dashDir: new THREE.Vector3(),
      charges: t.cls.dash && settings.targetJumps ? DASH.charges : 0,
      recharge: 0,
      sinceDash: DASH.gap,
    };
  }

  update(dt) {
    for (const t of this.targets) this.move(t, dt);
    super.update(dt); // anima el humanoide con la posición nueva y gestiona el respawn
  }

  move(t, dt) {
    const o = t.orbit;
    const { player, settings } = this.ctx;
    const pos = t.group.position;
    offset.subVectors(pos, player.pos).setY(0);
    const r = Math.max(offset.length(), 1e-3);
    radial.copy(offset).divideScalar(r); // hacia fuera
    tangent.set(radial.z, 0, -radial.x).multiplyScalar(o.dir);
    const grounded = t.y === 0 && o.vy === 0;

    // Recarga de los dashes, de una carga en una
    if (o.charges < DASH.charges && t.cls.dash && settings.targetJumps) {
      o.recharge -= dt;
      if (o.recharge <= 0) {
        o.charges++;
        o.recharge = DASH.cooldown;
      }
    }
    o.sinceDash += dt;

    o.timer -= dt;
    if (o.timer <= 0) {
      o.timer = rand(0.45, 1.5);
      if (Math.random() < 0.55) {
        o.dir *= -1;
        tangent.negate();
      }
      if (Math.random() < 0.5) o.goal = rand(RADIUS.min, RADIUS.max);
      if (settings.targetJumps && grounded && Math.random() < JUMP_CHANCE) o.vy = JUMP_SPEED;
      if (o.charges > 0 && o.sinceDash >= DASH.gap && Math.random() < DASH.chance) {
        // Hacia el lado al que va, acercándose o alejándose según su distancia
        // objetivo. El dash es recto: se abre hacia dentro lo que lo alejaría
        // del jugador recorrer la cuerda (el dash y la frenada, ~2 × su largo).
        const chord = (2 * t.cls.speed * settings.targetSpeed * DASH.mult * DASH.time) / (2 * r);
        const inOut = Math.sign(o.goal - r) * rand(0, 0.6) - chord;
        o.dashDir.copy(tangent).addScaledVector(radial, inOut).normalize();
        if (o.charges === DASH.charges) o.recharge = DASH.cooldown;
        o.charges--;
        o.dash = DASH.time;
        o.sinceDash = 0;
      }
    }

    // Velocidad deseada: girar alrededor del jugador corrigiendo la distancia
    const speed = t.cls.speed * settings.targetSpeed;
    o.dash = Math.max(0, o.dash - dt);
    if (o.dash > 0) {
      wanted.copy(o.dashDir).multiplyScalar(speed * DASH.mult);
    } else {
      const vr = Math.max(-0.6, Math.min(0.6, (o.goal - r) * 0.8)) * speed;
      wanted.copy(tangent).multiplyScalar(Math.sqrt(speed * speed - vr * vr)).addScaledVector(radial, vr);
    }
    // Ni se le echa encima ni se va lejos
    const out = wanted.dot(radial);
    if ((r < RADIUS.min && out < 0) || (r > RADIUS.max && out > 0)) wanted.addScaledVector(radial, -out);

    const maxDv = ACCEL * dt * (o.dash > 0 ? 3 : 1);
    const dv = wanted.sub(o.vel);
    if (dv.length() > maxDv) dv.setLength(maxDv);
    o.vel.add(dv);

    pos.addScaledVector(o.vel, dt);
    // Límite duro: nunca más cerca que esto, aunque venga lanzado de un dash
    offset.subVectors(pos, player.pos).setY(0);
    const hard = RADIUS.min * 0.8;
    if (offset.length() < hard) {
      offset.setLength(hard);
      pos.copy(player.pos).add(offset);
      const inward = o.vel.dot(offset) / hard;
      if (inward < 0) o.vel.addScaledVector(offset, -inward / hard);
    }

    if (t.y > 0 || o.vy > 0) {
      o.vy -= GRAVITY * dt;
      t.y = Math.max(0, t.y + o.vy * dt);
      if (t.y === 0) o.vy = 0;
    }
    pos.y = t.y;
  }
}

export default {
  key: 'hipfire',
  group: 'situations',
  version: 1,
  fixed: { weapon: 'smg', targetClass: 'light', targetModel: 'humanoid' },
  distanceLabel: '2.5–6 m',
  score: 'kills',
  create: (ctx) => new HipfireScenario(ctx),
};
