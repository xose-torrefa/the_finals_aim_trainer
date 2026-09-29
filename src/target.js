import * as THREE from '/lib/three/three.module.js';

// Tamaños aproximados de hitbox por clase. HP reales de The Finals.
export const CLASSES = {
  light: { name: 'Light', hp: 150, radius: 0.24, bodyHeight: 1.38, headRadius: 0.14, speed: 5.6, dash: true },
  medium: { name: 'Medium', hp: 250, radius: 0.31, bodyHeight: 1.48, headRadius: 0.15, speed: 5.0, dash: false },
  heavy: { name: 'Heavy', hp: 350, radius: 0.42, bodyHeight: 1.55, headRadius: 0.165, speed: 4.4, dash: false },
};

const GRAVITY = 18;
const JUMP_SPEED = 5.5;
const ACCEL = 30;
const UP = new THREE.Vector3(0, 1, 0);

const geometryCache = new Map();
function geometriesFor(key) {
  if (!geometryCache.has(key)) {
    const c = CLASSES[key];
    geometryCache.set(key, {
      body: new THREE.CapsuleGeometry(c.radius, c.bodyHeight - 2 * c.radius, 6, 16),
      head: new THREE.SphereGeometry(c.headRadius, 16, 12),
    });
  }
  return geometryCache.get(key);
}
const barGeometry = new THREE.PlaneGeometry(1, 1);

const rand = (a, b) => a + Math.random() * (b - a);

// Parámetros del movimiento. `dashChance: null` = solo dashea la clase Light.
// `depth`: semirrango (m) de movimiento hacia/desde el jugador.
const DEFAULT_AI = { changeMin: 0.25, changeMax: 1.1, flipChance: 0.75, jumpChance: 0.18, dashChance: null, depth: 0 };

export function pickClass(setting) {
  if (setting !== 'random') return setting;
  const keys = Object.keys(CLASSES);
  return keys[Math.floor(Math.random() * keys.length)];
}

export class Target {
  /**
   * @param {object} opts
   *  classKey, hp (Infinity = inmortal), move: 'strafe' | 'static',
   *  speedScale, jumps, lane (semiancho del carril en m), ai (ver DEFAULT_AI)
   */
  constructor(scene, opts) {
    this.scene = scene;
    this.classKey = opts.classKey;
    this.cls = CLASSES[opts.classKey];
    this.maxHp = opts.hp ?? this.cls.hp;
    this.hp = this.maxHp;
    this.move = opts.move ?? 'strafe';
    this.speedScale = opts.speedScale ?? 1;
    this.jumps = opts.jumps ?? true;
    this.lane = opts.lane ?? 3;
    this.ai = { ...DEFAULT_AI, ...opts.ai };
    if (this.ai.dashChance === null) this.ai.dashChance = this.cls.dash ? 0.15 : 0;
    this.alive = true;
    this.spawnTime = 0;
    this.firstHitTime = null;

    const geo = geometriesFor(this.classKey);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xff6b1a, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0 });

    this.group = new THREE.Group();
    const body = new THREE.Mesh(geo.body, this.bodyMat);
    body.position.y = this.cls.bodyHeight / 2;
    body.userData = { target: this, part: 'body' };
    const head = new THREE.Mesh(geo.head, this.headMat);
    head.position.y = this.cls.bodyHeight + this.cls.headRadius * 0.9;
    head.userData = { target: this, part: 'head' };
    this.group.add(body, head);
    this.hitMeshes = [body, head];

    this.bar = null;
    if (Number.isFinite(this.maxHp) && this.maxHp > 1) {
      this.bar = new THREE.Group();
      this.bar.position.y = head.position.y + this.cls.headRadius + 0.25;
      const bg = new THREE.Mesh(barGeometry, new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6, depthTest: false }));
      bg.scale.set(0.9, 0.08, 1);
      this.barFill = new THREE.Mesh(barGeometry, new THREE.MeshBasicMaterial({ color: 0xf2f2f2, depthTest: false }));
      this.barFill.scale.set(0.86, 0.05, 1);
      this.barFill.renderOrder = 1;
      this.bar.add(bg, this.barFill);
      this.group.add(this.bar);
    }

    // Estado de movimiento
    this.anchor = new THREE.Vector3();
    this.axis = new THREE.Vector3(1, 0, 0);
    this.depthAxis = new THREE.Vector3(0, 0, 1);
    this.lateral = 0;
    this.lateralVel = 0;
    this.depth = 0;
    this.depthVel = 0;
    this.depthDir = 0;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.changeTimer = rand(0.2, 0.9);
    this.dashTimer = 0;
    this.y = 0;
    this.vy = 0;
    this.flash = 0;

    scene.add(this.group);
  }

  /** Coloca el objetivo; el carril de strafe es perpendicular a la línea con el jugador. */
  place(position, playerPos) {
    this.anchor.copy(position).setY(0);
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.anchor).setY(0).normalize();
    this.axis.crossVectors(toPlayer, UP).normalize();
    this.depthAxis.copy(toPlayer);
    this.lateral = 0;
    this.lateralVel = 0;
    this.depth = 0;
    this.depthVel = 0;
    this.group.position.copy(this.anchor);
  }

  update(dt, camera) {
    if (this.move === 'strafe') this.updateStrafe(dt);

    this.flash = Math.max(0, this.flash - dt * 8);
    this.bodyMat.emissiveIntensity = this.flash * 0.8;
    this.headMat.emissiveIntensity = this.flash * 0.8;

    if (this.bar) {
      this.bar.quaternion.copy(camera.quaternion);
      const f = Math.max(0, this.hp / this.maxHp);
      this.barFill.scale.x = 0.86 * f;
      this.barFill.position.x = -0.43 * (1 - f);
    }
  }

  updateStrafe(dt) {
    const ai = this.ai;
    this.changeTimer -= dt;
    if (this.changeTimer <= 0) {
      if (Math.random() < ai.flipChance) this.dir *= -1;
      this.changeTimer = rand(ai.changeMin, ai.changeMax);
      if (ai.depth > 0) this.depthDir = Math.floor(Math.random() * 3) - 1;
      if (this.jumps) {
        if (this.y === 0 && Math.random() < ai.jumpChance) this.vy = JUMP_SPEED;
        if (Math.random() < ai.dashChance) this.dashTimer = 0.18;
      }
    }
    // Da la vuelta si al frenar acabaría fuera del carril
    const stop = (v) => (v * Math.abs(v)) / (2 * ACCEL);
    const lat = this.lateral + stop(this.lateralVel);
    if (lat > this.lane && this.dir > 0) this.dir = -1;
    if (lat < -this.lane && this.dir < 0) this.dir = 1;
    const dep = this.depth + stop(this.depthVel);
    if (dep > ai.depth && this.depthDir > 0) this.depthDir = -1;
    if (dep < -ai.depth && this.depthDir < 0) this.depthDir = 1;

    this.dashTimer = Math.max(0, this.dashTimer - dt);
    const speed = this.cls.speed * this.speedScale * (this.dashTimer > 0 ? 2.6 : 1);
    const maxDv = ACCEL * dt * (this.dashTimer > 0 ? 3 : 1);
    const approach = (vel, target) => vel + Math.max(-maxDv, Math.min(maxDv, target - vel));
    this.lateralVel = approach(this.lateralVel, this.dir * speed);
    this.lateral += this.lateralVel * dt;
    this.depthVel = approach(this.depthVel, this.depthDir * speed * 0.6);
    this.depth += this.depthVel * dt;

    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
    }

    this.group.position.copy(this.anchor)
      .addScaledVector(this.axis, this.lateral)
      .addScaledVector(this.depthAxis, this.depth);
    this.group.position.y = this.y;
  }

  /** Aplica daño. Devuelve { dealt, killed }. */
  applyDamage(amount, now) {
    this.flash = 1;
    if (this.firstHitTime === null) this.firstHitTime = now;
    if (!Number.isFinite(this.hp)) return { dealt: amount, killed: false };
    const dealt = Math.min(amount, this.hp);
    this.hp -= dealt;
    if (this.hp <= 0) this.alive = false;
    return { dealt, killed: !this.alive };
  }

  dispose() {
    this.scene.remove(this.group);
    this.bodyMat.dispose();
    this.headMat.dispose();
    if (this.bar) this.bar.children.forEach((m) => m.material.dispose());
  }
}

const sphereGeometry = new THREE.SphereGeometry(1, 24, 16);
const scratch = new THREE.Vector3();

/**
 * Esfera flotante. Misma interfaz que Target (hitMeshes, update, applyDamage, dispose).
 * move: 'static' | 'float' (trayectoria 3D suave dentro de una caja `bounds`).
 */
export class SphereTarget {
  constructor(scene, { radius, hp = 1, move = 'static', speed = 0, bounds = null }) {
    this.scene = scene;
    this.maxHp = hp;
    this.hp = hp;
    this.alive = true;
    this.spawnTime = 0;
    this.firstHitTime = null;
    this.move = move;
    this.speed = speed;
    this.bounds = bounds; // { center: Vector3, half: Vector3 }
    this.flash = 0;

    this.mat = new THREE.MeshStandardMaterial({ color: 0xff2e63, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0 });
    this.group = new THREE.Mesh(sphereGeometry, this.mat);
    this.group.scale.setScalar(radius);
    this.group.userData = { target: this, part: 'body' };
    this.hitMeshes = [this.group];

    this.velocity = new THREE.Vector3();
    this.wanted = new THREE.Vector3();
    this.changeTimer = 0;
    scene.add(this.group);
  }

  place(position) {
    this.group.position.copy(position);
  }

  update(dt) {
    if (this.move === 'float') this.updateFloat(dt);
    this.flash = Math.max(0, this.flash - dt * 8);
    this.mat.emissiveIntensity = this.flash * 0.8;
  }

  updateFloat(dt) {
    this.changeTimer -= dt;
    if (this.changeTimer <= 0) {
      // Nueva dirección deseada; el movimiento vertical pesa algo menos
      this.wanted.set(rand(-1, 1), rand(-0.7, 0.7), rand(-0.4, 0.4)).normalize().multiplyScalar(this.speed);
      this.changeTimer = rand(0.35, 1.2);
    }
    const maxDv = this.speed * 3 * dt;
    const dv = scratch.subVectors(this.wanted, this.velocity);
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.velocity.add(dv);

    const p = this.group.position.addScaledVector(this.velocity, dt);
    const { center, half } = this.bounds;
    for (const axis of ['x', 'y', 'z']) {
      const min = center[axis] - half[axis];
      const max = center[axis] + half[axis];
      if ((p[axis] < min && this.velocity[axis] < 0) || (p[axis] > max && this.velocity[axis] > 0)) {
        this.velocity[axis] *= -1;
        this.wanted[axis] = -Math.abs(this.wanted[axis]) * Math.sign(p[axis] - center[axis]);
      }
    }
  }

  applyDamage(amount, now) {
    this.flash = 1;
    if (this.firstHitTime === null) this.firstHitTime = now;
    if (!Number.isFinite(this.hp)) return { dealt: amount, killed: false };
    const dealt = Math.min(amount, this.hp);
    this.hp -= dealt;
    if (this.hp <= 0) this.alive = false;
    return { dealt, killed: !this.alive };
  }

  dispose() {
    this.scene.remove(this.group);
    this.mat.dispose();
  }
}
