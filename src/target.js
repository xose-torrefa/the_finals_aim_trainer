import * as THREE from '../lib/three/three.module.js';
import { Humanoid } from './humanoid.js';

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
const BAR_WIDTH = 0.86;
const BAR_HEIGHT = 0.07;
const BAR_SEGMENT = 50; // HP entre marcas de la barra de vida

const rand = (a, b) => a + Math.random() * (b - a);
const smoothstep = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// Trayectorias suaves (`SmoothPath`), en coordenadas normalizadas
const TIGHTEST = 1 / 3; // radio del giro más cerrado
const LOOKAHEAD = 0.5; // a qué distancia mira si va hacia el borde
const SPIN_ACCEL = 2.5; // el giro tarda 1 / SPIN_ACCEL s en pasar de 0 al máximo

/**
 * Trayectoria suave dentro de un elipsoide de semiejes `half` (m), como los bots
 * de tracking de otros aim trainers: no se para, y su rumbo gira con una
 * velocidad angular que cambia poco a poco (rectas, curvas y círculos que lo
 * acercan y lo alejan), sin cambios de sentido bruscos. Cerca del borde gira
 * hacia el centro. Se calcula en coordenadas normalizadas (el elipsoide es la
 * esfera unidad), así que por los ejes cortos va más despacio.
 * `speed`: velocidad máxima (m/s) por el eje x. El giro más cerrado es un
 * círculo de un tercio del elipsoide, así que no se sale aunque vaya rápido.
 * Con `half.y = 0` se mueve en el plano del suelo.
 */
class SmoothPath {
  constructor(half, speed) {
    this.half = half.clone();
    this.flat = half.y === 0;
    this.speed = speed / half.x;
    this.turn = this.speed / TIGHTEST; // rad/s
    this.p = new THREE.Vector3();
    this.heading = new THREE.Vector3(Math.random() < 0.5 ? -1 : 1, 0, 0); // empieza de lado
    this.spin = new THREE.Vector3(); // velocidad angular actual (eje × rad/s)
    this.wander = new THREE.Vector3(); // la que busca ahora
    this.pace = rand(0.65, 1);
    this.paceWanted = this.pace;
    this.timer = 0;
    this.offset = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.want = new THREE.Vector3();
  }

  /** Avanza y devuelve el desplazamiento (m) desde el centro del elipsoide. */
  update(dt) {
    const { p, heading, spin, tmp, want } = this;
    this.timer -= dt;
    if (this.timer <= 0) {
      // Un tramo recto, una curva o un círculo, hacia cualquier lado
      this.timer = rand(1.2, 3);
      if (this.flat) this.wander.set(0, Math.random() < 0.5 ? -1 : 1, 0);
      else this.wander.randomDirection().addScaledVector(heading, -this.wander.dot(heading)).normalize();
      this.wander.multiplyScalar(Math.random() < 0.25 ? 0 : rand(0.35, 1) * this.turn);
      this.paceWanted = rand(0.65, 1);
    }
    this.pace += Math.max(-0.4 * dt, Math.min(0.4 * dt, this.paceWanted - this.pace));
    const step = this.speed * this.pace;

    // Si siguiendo recto se acerca al borde, gira hacia el centro
    tmp.copy(p).addScaledVector(heading, LOOKAHEAD);
    const edge = smoothstep(0.5, 0.9, tmp.length());
    want.copy(this.wander).multiplyScalar(1 - edge);
    if (edge > 0) {
      tmp.negate().normalize();
      const angle = heading.angleTo(tmp);
      tmp.crossVectors(heading, tmp);
      // De espaldas al centro, sigue girando hacia donde ya giraba
      if (tmp.lengthSq() < 1e-8) tmp.copy(spin.lengthSq() > 1e-8 ? spin : this.wander);
      if (tmp.lengthSq() < 1e-8) tmp.set(0, 1, 0);
      want.addScaledVector(tmp.normalize(), Math.min(this.turn, angle * 3) * edge);
    }

    // El giro cambia poco a poco: sin quiebros
    tmp.subVectors(want, spin);
    const maxSpin = SPIN_ACCEL * this.turn * dt;
    if (tmp.length() > maxSpin) tmp.setLength(maxSpin);
    spin.add(tmp);
    const w = spin.length();
    if (w > 1e-6) {
      heading.applyAxisAngle(tmp.copy(spin).divideScalar(w), w * dt);
      if (this.flat) heading.y = 0;
      heading.normalize();
    }

    p.addScaledVector(heading, step * dt);
    return this.offset.copy(p).multiply(this.half);
  }
}

// Parámetros del movimiento. `dashChance: null` = solo dashea la clase Light.
// `depth`: semirrango (m) de movimiento hacia/desde el jugador.
// `depthSpeed`: velocidad en profundidad respecto a la de strafe.
// `sweep`: en profundidad va de un extremo al otro en vez de cambiar al azar.
// `padChance`/`padSpeed`: probabilidad en cada cambio de usar un jump pad y
// velocidad vertical (m/s) con la que sale.
// `pingpong`: recorre el carril de un extremo al otro a velocidad constante,
// sin cambios de sentido al azar, saltos, dashes ni jump pads.
// `smooth`: trayectoria suave (`SmoothPath`) en la elipse de semiejes `lane` y
// `depth` (> 0), a la velocidad de la clase; sin saltos, dashes ni jump pads.
const DEFAULT_AI = {
  changeMin: 0.25, changeMax: 1.1, flipChance: 0.75, jumpChance: 0.18, dashChance: null,
  depth: 0, depthSpeed: 0.6, sweep: false, padChance: 0, padSpeed: 14, pingpong: false, smooth: false,
};

export function pickClass(setting) {
  if (setting !== 'random') return setting;
  const keys = Object.keys(CLASSES);
  return keys[Math.floor(Math.random() * keys.length)];
}

export class Target {
  /**
   * @param {object} opts
   *  classKey, model: 'humanoid' | 'capsule', hp (Infinity = inmortal),
   *  move: 'strafe' | 'static', speedScale, jumps, lane (semiancho del carril
   *  en m), ai (ver DEFAULT_AI)
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

    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xff6b1a, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0 });

    this.group = new THREE.Group();
    // Modelo: 'capsule' (por defecto) o 'humanoid' (el hitbox es el propio modelo)
    let top;
    this.humanoid = null;
    if (opts.model === 'humanoid') {
      this.humanoid = new Humanoid(this.classKey, { body: this.bodyMat, head: this.headMat }, this);
      this.group.add(this.humanoid.root);
      this.hitMeshes = this.humanoid.hitMeshes;
      top = this.humanoid.top;
      this.halfWidth = this.humanoid.halfWidth;
    } else {
      const geo = geometriesFor(this.classKey);
      const body = new THREE.Mesh(geo.body, this.bodyMat);
      body.position.y = this.cls.bodyHeight / 2;
      body.userData = { target: this, part: 'body' };
      const head = new THREE.Mesh(geo.head, this.headMat);
      head.position.y = this.cls.bodyHeight + this.cls.headRadius * 0.9;
      head.userData = { target: this, part: 'head' };
      this.group.add(body, head);
      this.hitMeshes = [body, head];
      top = head.position.y + this.cls.headRadius;
      this.halfWidth = this.cls.radius;
    }

    this.bar = null;
    if (Number.isFinite(this.maxHp) && this.maxHp > 1) {
      // Marco oscuro, hueco vacío, rastro blanco del daño reciente, vida
      // (verde → amarillo → rojo) y marcas cada BAR_SEGMENT HP. Todo
      // transparente y sin depthTest, para que el orden lo decida renderOrder.
      const part = (color, opacity, w, h, order) => {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
        const mesh = new THREE.Mesh(barGeometry, mat);
        mesh.scale.set(w, h, 1);
        mesh.renderOrder = order;
        return mesh;
      };
      this.bar = new THREE.Group();
      this.bar.position.y = top + 0.25;
      const frame = part(0x000000, 0.75, BAR_WIDTH + 0.04, BAR_HEIGHT + 0.04, 10);
      const track = part(0x3a1214, 0.9, BAR_WIDTH, BAR_HEIGHT, 11);
      this.barTrail = part(0xffffff, 1, BAR_WIDTH, BAR_HEIGHT, 12);
      this.barFill = part(0x000000, 1, BAR_WIDTH, BAR_HEIGHT, 13);
      this.bar.add(frame, track, this.barTrail, this.barFill);
      const segments = this.maxHp / BAR_SEGMENT;
      if (Number.isInteger(segments) && segments > 1 && segments <= 20) {
        for (let i = 1; i < segments; i++) {
          const tick = part(0x000000, 0.6, 0.012, BAR_HEIGHT, 14);
          tick.position.x = BAR_WIDTH * (i / segments - 0.5);
          this.bar.add(tick);
        }
      }
      this.barShown = 1;   // fracción que marca el rastro blanco
      this.barHold = 0;    // tiempo (s) que el rastro espera antes de bajar
      this.barLast = 1;
      this.updateBar(0);
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
    this.depthDir = this.ai.sweep ? 1 : 0;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.changeTimer = rand(0.2, 0.9);
    this.path = this.ai.smooth
      ? new SmoothPath(new THREE.Vector3(this.lane, 0, this.ai.depth), this.cls.speed * this.speedScale)
      : null;
    this.dashTimer = 0;
    this.y = 0;
    this.vy = 0;
    this.flash = 0;

    this.prevPos = new THREE.Vector3();
    this.velocity = new THREE.Vector3();

    // Zona a la que se apunta (para el análisis): de los pies a lo alto de la cabeza
    this.aim = { center: new THREE.Vector3(), half: top / 2, radius: this.humanoid?.aimRadius ?? this.cls.radius };

    scene.add(this.group);
  }

  /** Centro, semialtura y radio (m) de la zona a la que se apunta. */
  aimInfo() {
    this.aim.center.copy(this.group.position).setY(this.group.position.y + this.aim.half);
    return this.aim;
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
    this.prevPos.copy(this.anchor);
  }

  update(dt, camera) {
    if (this.move === 'strafe') this.updateStrafe(dt);
    if (this.humanoid) this.animate(dt, camera);
    // El rayo del disparo va después: que use la pose de este fotograma
    this.group.updateMatrixWorld(true);

    this.flash = Math.max(0, this.flash - dt * 8);
    this.bodyMat.emissiveIntensity = this.flash * 0.8;
    this.headMat.emissiveIntensity = this.flash * 0.8;

    if (this.bar) {
      // La barra es hija del grupo, que gira hacia el jugador: hay que
      // deshacer ese giro para que quede de cara a la cámara
      this.bar.quaternion.copy(this.group.quaternion).invert().multiply(camera.quaternion);
      this.updateBar(dt);
    }
  }

  updateBar(dt) {
    const f = Math.max(0, this.hp / this.maxHp);
    if (f < this.barLast) this.barHold = 0.35;
    this.barLast = f;
    this.barHold -= dt;
    if (this.barHold <= 0) this.barShown = Math.max(f, this.barShown - 1.5 * dt);
    if (this.barShown < f) this.barShown = f;
    const span = (mesh, from, to) => {
      mesh.visible = to > from;
      mesh.scale.x = BAR_WIDTH * Math.max(to - from, 1e-4);
      mesh.position.x = BAR_WIDTH * ((from + to) / 2 - 0.5);
    };
    span(this.barFill, 0, f);
    span(this.barTrail, f, this.barShown);
    this.barFill.material.color.setHSL(0.33 * f, 0.9, 0.5);
  }

  /** Mira al jugador y anima el humanoide con su velocidad real (también si lo mueve el escenario). */
  animate(dt, camera) {
    const p = this.group.position;
    this.group.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
    if (dt <= 0) return;
    this.velocity.subVectors(p, this.prevPos).setY(0);
    // Un salto de más de 1 m en un fotograma es una recolocación, no movimiento
    if (this.velocity.length() > 1) this.velocity.set(0, 0, 0);
    else this.velocity.divideScalar(dt);
    this.prevPos.copy(p);
    const yaw = this.group.rotation.y;
    const vx = this.velocity.x * Math.cos(yaw) - this.velocity.z * Math.sin(yaw);
    const vz = this.velocity.x * Math.sin(yaw) + this.velocity.z * Math.cos(yaw);
    this.humanoid.animate(dt, vx, vz, this.y > 0.02);
  }

  updateStrafe(dt) {
    if (this.path) {
      const off = this.path.update(dt);
      this.lateral = off.x;
      this.depth = off.z;
      this.group.position.copy(this.anchor)
        .addScaledVector(this.axis, this.lateral)
        .addScaledVector(this.depthAxis, this.depth);
      return;
    }
    const ai = this.ai;
    this.changeTimer -= dt;
    if (this.changeTimer <= 0 && !ai.pingpong) {
      if (Math.random() < ai.flipChance) this.dir *= -1;
      this.changeTimer = rand(ai.changeMin, ai.changeMax);
      if (ai.depth > 0 && !ai.sweep) this.depthDir = Math.floor(Math.random() * 3) - 1;
      if (this.y === 0 && ai.padChance > 0 && Math.random() < ai.padChance) this.vy = ai.padSpeed;
      if (this.jumps) {
        if (this.y === 0 && this.vy === 0 && Math.random() < ai.jumpChance) this.vy = JUMP_SPEED;
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
    this.depthVel = approach(this.depthVel, this.depthDir * speed * ai.depthSpeed);
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

/**
 * Esfera flotante. Misma interfaz que Target (hitMeshes, update, applyDamage, dispose).
 * move: 'static' | 'float' (`SmoothPath` a `speed` m/s en el elipsoide `bounds`, desde su centro).
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
    this.bounds = bounds; // { center: Vector3, half: Vector3 }
    this.path = move === 'float' ? new SmoothPath(bounds.half, speed) : null;
    this.flash = 0;

    this.mat = new THREE.MeshStandardMaterial({ color: 0xff2e63, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0 });
    this.group = new THREE.Mesh(sphereGeometry, this.mat);
    this.group.scale.setScalar(radius);
    this.group.userData = { target: this, part: 'body' };
    this.hitMeshes = [this.group];

    this.aim = { center: this.group.position, half: 0, radius };
    scene.add(this.group);
  }

  /** Misma interfaz que Target.aimInfo(). */
  aimInfo() {
    return this.aim;
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
    this.group.position.copy(this.bounds.center).add(this.path.update(dt));
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
