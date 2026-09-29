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

export function pickClass(setting) {
  if (setting !== 'random') return setting;
  const keys = Object.keys(CLASSES);
  return keys[Math.floor(Math.random() * keys.length)];
}

export class Target {
  /**
   * @param {object} opts
   *  classKey, hp (Infinity = inmortal), move: 'strafe' | 'static',
   *  speedScale, jumps, lane (semiancho del carril en m)
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
    this.lateral = 0;
    this.lateralVel = 0;
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
    this.lateral = 0;
    this.lateralVel = 0;
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
    this.changeTimer -= dt;
    if (this.changeTimer <= 0) {
      if (Math.random() < 0.75) this.dir *= -1;
      this.changeTimer = rand(0.25, 1.1);
      if (this.jumps) {
        if (this.y === 0 && Math.random() < 0.18) this.vy = JUMP_SPEED;
        if (this.cls.dash && Math.random() < 0.15) this.dashTimer = 0.18;
      }
    }
    if (this.lateral > this.lane && this.dir > 0) this.dir = -1;
    if (this.lateral < -this.lane && this.dir < 0) this.dir = 1;

    this.dashTimer = Math.max(0, this.dashTimer - dt);
    const targetVel = this.dir * this.cls.speed * this.speedScale * (this.dashTimer > 0 ? 2.6 : 1);
    const dv = targetVel - this.lateralVel;
    const maxDv = ACCEL * dt * (this.dashTimer > 0 ? 3 : 1);
    this.lateralVel += Math.max(-maxDv, Math.min(maxDv, dv));
    this.lateral += this.lateralVel * dt;

    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
    }

    this.group.position.copy(this.anchor).addScaledVector(this.axis, this.lateral);
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
