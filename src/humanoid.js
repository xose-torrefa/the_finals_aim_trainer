import * as THREE from '../lib/three/three.module.js';

// Humanoide procedural: hecho con primitivas, sin ficheros de modelo. Cada pieza
// golpeable es una malla con su `part` ('head' | 'body'), así que el hitbox es el
// propio modelo: brazos y piernas cuentan como cuerpo y el hueco entre las
// piernas es fallo. El arma y el visor son decorado (no paran las balas).
//
// Proporciones aproximadas (m). height: hasta lo alto de la cabeza; shoulder:
// del centro a la articulación del hombro; el resto son radios.
const BUILDS = {
  light: { height: 1.74, head: 0.125, neck: 0.05, chestW: 0.17, chestD: 0.115, waistW: 0.13, hip: 0.085, shoulder: 0.19, arm: 0.045, fore: 0.04, thigh: 0.068, shin: 0.052 },
  medium: { height: 1.84, head: 0.13, neck: 0.06, chestW: 0.21, chestD: 0.14, waistW: 0.165, hip: 0.1, shoulder: 0.235, arm: 0.06, fore: 0.052, thigh: 0.085, shin: 0.065 },
  heavy: { height: 1.98, head: 0.14, neck: 0.085, chestW: 0.29, chestD: 0.2, waistW: 0.245, hip: 0.13, shoulder: 0.315, arm: 0.085, fore: 0.075, thigh: 0.115, shin: 0.09 },
};

// Perfil del torso (radio relativo al pecho, altura relativa), de la cintura al cuello
const TORSO_PROFILE = [[0, 0], [1, 0], [1, 0.25], [0.93, 0.55], [1, 0.75], [0.97, 0.88], [0.75, 0.97], [0.35, 1], [0, 1]];

const Y = new THREE.Vector3(0, 1, 0);
const STRIDE = 1.1; // m por ciclo de paso (con altura 1,84)

const darkMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.45, metalness: 0.3 });

const geometryCache = new Map();
function cached(key, make) {
  if (!geometryCache.has(key)) geometryCache.set(key, make());
  return geometryCache.get(key);
}
const capsule = (r, len) => cached(`cap:${r}:${len.toFixed(4)}`, () => new THREE.CapsuleGeometry(r, len, 4, 12));
const sphere = (r) => cached(`sph:${r}`, () => new THREE.SphereGeometry(r, 16, 12));
const box = (x, y, z) => cached(`box:${x}:${y}:${z}`, () => new THREE.BoxGeometry(x, y, z));

/** Medidas derivadas de una clase (alturas de articulaciones, largos, posición del arma y manos). */
const layouts = new Map();
function layoutFor(key) {
  if (layouts.has(key)) return layouts.get(key);
  const b = BUILDS[key];
  const s = b.height / 1.84;
  const headY = b.height - b.head;
  const torsoTop = headY - b.head - 0.06 * s;
  const hipY = 0.505 * b.height;
  const shoulderY = torsoTop - Math.max(0.05 * s, b.arm * 0.8);
  const footR = b.shin * 0.75;
  const legLen = hipY - footR;
  // Arma al hombro, apuntando al frente (+z), un poco a la derecha (-x)
  const gun = new THREE.Vector3(-b.shoulder * 0.4, shoulderY - 0.1 * s, b.chestD * 0.9);
  const l = {
    b, s, headY, torsoTop, hipY, shoulderY, footR,
    thighLen: legLen * 0.5,
    shinLen: legLen * 0.5,
    upperArm: 0.18 * b.height,
    foreArm: 0.17 * b.height,
    gun,
    // Mano derecha en la empuñadura, izquierda en el guardamanos
    handR: gun.clone().add(new THREE.Vector3(0, -0.06, 0.14)),
    handL: gun.clone().add(new THREE.Vector3(0.02, -0.03, 0.3)),
  };
  layouts.set(key, l);
  return l;
}

/** Codo de un brazo de dos segmentos (IK analítica) con el codo hacia `pole`. */
function elbowFor(shoulder, hand, a, b, pole) {
  const d = Math.min(shoulder.distanceTo(hand), (a + b) * 0.999);
  const u = new THREE.Vector3().subVectors(hand, shoulder).normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const perp = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
  return shoulder.clone().addScaledVector(u, along).addScaledVector(perp, h);
}

/** Crea una malla de cápsula entre dos puntos. */
function limb(r, from, to, mat) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(capsule(r, Math.max(0.001, dir.length())), mat);
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
  return mesh;
}

function torsoGeometry(key, l) {
  return cached(`torso:${key}`, () => {
    const { b } = l;
    const h = l.torsoTop - l.hipY + 0.02;
    const waist = b.waistW / b.chestW;
    const pts = TORSO_PROFILE.map(([r, y], i) => {
      const k = i > 0 && y < 0.3 ? waist : 1;
      return new THREE.Vector2(r * k * b.chestW, y * h - 0.02);
    });
    const g = new THREE.LatheGeometry(pts, 18);
    g.scale(1, 1, b.chestD / b.chestW);
    return g;
  });
}

function buildGun(s) {
  const gun = new THREE.Group();
  const parts = [
    [box(0.055, 0.1, 0.42), 0, 0, 0.24],   // cajón
    [box(0.045, 0.085, 0.2), 0, -0.01, -0.06], // culata
    [box(0.04, 0.14, 0.07), 0, -0.11, 0.3], // cargador
    [box(0.035, 0.1, 0.05), 0, -0.08, 0.1], // empuñadura
    [box(0.025, 0.025, 0.3), 0, 0.015, 0.6], // cañón
  ];
  for (const [geo, x, y, z] of parts) {
    const m = new THREE.Mesh(geo, darkMat);
    m.position.set(x, y, z);
    gun.add(m);
  }
  gun.scale.setScalar(Math.max(1, s));
  return gun;
}

export class Humanoid {
  /**
   * @param {string} classKey light | medium | heavy
   * @param {{ body: THREE.Material, head: THREE.Material }} mats
   * @param {object} target para `userData.target` de las piezas golpeables
   */
  constructor(classKey, mats, target) {
    const l = layoutFor(classKey);
    const { b } = l;
    this.l = l;
    this.hitMeshes = [];
    const hit = (mesh, part = 'body') => {
      mesh.userData = { target, part };
      this.hitMeshes.push(mesh);
      return mesh;
    };

    this.root = new THREE.Group(); // cadera: sube y baja al andar
    this.root.position.y = l.hipY;

    // Pelvis
    const pelvis = hit(new THREE.Mesh(sphere(1), mats.body));
    pelvis.scale.set(b.hip + b.thigh * 0.9, 0.12 * l.s, b.chestD * 0.85);
    pelvis.position.y = 0.03;
    this.root.add(pelvis);

    // Columna: torso, cabeza, brazos y arma (se inclina al moverse)
    this.spine = new THREE.Group();
    this.spine.position.y = 0.02;
    this.root.add(this.spine);
    const up = (y) => y - l.hipY - 0.02; // altura absoluta → local de la columna
    this.spine.add(hit(new THREE.Mesh(torsoGeometry(classKey, l), mats.body)));
    this.spine.add(hit(limb(b.neck, new THREE.Vector3(0, up(l.torsoTop) - 0.03, 0), new THREE.Vector3(0, up(l.headY) - b.head * 0.5, 0), mats.body)));
    const head = hit(new THREE.Mesh(sphere(b.head), mats.head), 'head');
    head.position.y = up(l.headY);
    const visor = new THREE.Mesh(box(b.head * 1.5, b.head * 0.42, b.head * 0.5), darkMat);
    visor.position.set(0, b.head * 0.12, b.head * 0.8);
    head.add(visor);
    this.spine.add(head);

    const gun = buildGun(l.s);
    gun.position.copy(l.gun).setY(up(l.gun.y));
    this.spine.add(gun);

    for (const side of [1, -1]) { // +x = izquierda del modelo (mira hacia +z)
      const shoulder = new THREE.Vector3(side * b.shoulder, up(l.shoulderY), 0);
      const handAbs = side > 0 ? l.handL : l.handR;
      const hand = new THREE.Vector3(handAbs.x, up(handAbs.y), handAbs.z);
      const elbow = elbowFor(shoulder, hand, l.upperArm, l.foreArm, new THREE.Vector3(side * 0.7, -1, -0.2));
      const delt = hit(new THREE.Mesh(sphere(b.arm * 1.4), mats.body));
      delt.position.copy(shoulder);
      this.spine.add(delt);
      this.spine.add(hit(limb(b.arm, shoulder, elbow, mats.body)));
      this.spine.add(hit(limb(b.fore, elbow, hand, mats.body)));
      const palm = hit(new THREE.Mesh(sphere(b.fore * 1.15), mats.body));
      palm.position.copy(hand);
      this.spine.add(palm);
    }

    // Piernas: cadera → rodilla → pie
    this.legs = [1, -1].map((side) => {
      const hip = new THREE.Group();
      hip.position.x = side * b.hip;
      const thigh = hit(new THREE.Mesh(capsule(b.thigh, l.thighLen), mats.body));
      thigh.position.y = -l.thighLen / 2;
      const knee = new THREE.Group();
      knee.position.y = -l.thighLen;
      const shin = hit(new THREE.Mesh(capsule(b.shin, l.shinLen), mats.body));
      shin.position.y = -l.shinLen / 2;
      const foot = hit(new THREE.Mesh(capsule(l.footR, 0.14 * l.s), mats.body));
      foot.rotation.x = Math.PI / 2;
      foot.position.set(0, -l.shinLen, 0.05 * l.s);
      knee.add(shin, foot);
      hip.add(thigh, knee);
      this.root.add(hip);
      return { side, hip, knee };
    });

    // Medidas en la pose de reposo
    this.top = b.height;
    this.aimRadius = b.chestW;
    const bounds = new THREE.Box3().setFromObject(this.root);
    this.halfWidth = Math.max(-bounds.min.x, bounds.max.x);

    this.phase = 0;
    this.moving = 0; // 0..1: cuánto se anda
    this.air = 0; // 0..1: pose de salto
    this.fx = 0; // dirección del movimiento en ejes locales (suavizada)
    this.fz = 0;
    this.pose(0);
  }

  /**
   * Anima según la velocidad en ejes locales (vx: hacia su izquierda, vz: hacia
   * delante, m/s) y si está en el aire.
   */
  animate(dt, vx, vz, airborne) {
    const speed = Math.hypot(vx, vz);
    const ease = (rate) => 1 - Math.exp(-rate * dt);
    this.moving += (Math.min(1, speed / 2.5) - this.moving) * ease(10);
    this.air += ((airborne ? 1 : 0) - this.air) * ease(12);
    if (speed > 0.3) {
      this.fx += (vx / speed - this.fx) * ease(12);
      this.fz += (vz / speed - this.fz) * ease(12);
    }
    this.phase = (this.phase + (speed * dt * 2 * Math.PI) / (STRIDE * this.l.s)) % (2 * Math.PI);
    this.pose(this.moving);
  }

  pose(k) {
    const { fx, fz, air } = this;
    const mix = (a, b) => a + (b - a) * air;
    let lift = 0;
    for (const { side, hip, knee } of this.legs) {
      const s = Math.sin(this.phase + (side > 0 ? 0 : Math.PI));
      const up = Math.max(0, s);
      lift = Math.max(lift, up);
      // Paso lateral: la pierna del lado hacia el que va sale más que la otra
      const out = side * fx > 0 ? 0.38 : 0.2;
      hip.rotation.x = mix(-0.06 - 0.55 * s * fz * k, side > 0 ? -0.75 : -0.3);
      hip.rotation.z = mix(out * up * fx * k, side * 0.08);
      knee.rotation.x = mix(0.12 + 0.9 * up * k, side > 0 ? 1.35 : 0.75);
    }
    this.root.position.y = this.l.hipY - 0.03 * this.l.s * k * (1 - lift) * (1 - air);
    // Se inclina hacia donde va
    this.spine.rotation.z = -0.1 * fx * k;
    this.spine.rotation.x = 0.08 * fz * k;
  }
}
