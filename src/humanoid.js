import * as THREE from '../lib/three/three.module.js';

// Humanoide procedural v3 (locomoción con IK de piernas): hecho con primitivas, sin ficheros de modelo. Cada pieza
// golpeable es una malla con su `part` ('head' | 'body'), así que el hitbox es el
// propio modelo, incluido el equipamiento corporal: brazos y piernas cuentan como cuerpo y el hueco entre las
// piernas es fallo. El arma y el visor son decorado (no paran las balas).
//
// Proporciones aproximadas (m). height: hasta lo alto de la cabeza; shoulder:
// del centro a la articulación del hombro; el resto son radios.
const BUILDS = {
  light: { height: 1.65, head: 0.125, neck: 0.05, chestW: 0.17, chestD: 0.115, waistW: 0.13, hip: 0.085, shoulder: 0.19, arm: 0.045, fore: 0.04, thigh: 0.068, shin: 0.052 },
  medium: { height: 1.9, head: 0.13, neck: 0.06, chestW: 0.21, chestD: 0.14, waistW: 0.165, hip: 0.1, shoulder: 0.235, arm: 0.06, fore: 0.052, thigh: 0.085, shin: 0.065 },
  heavy: { height: 2.4, head: 0.14, neck: 0.085, chestW: 0.29, chestD: 0.2, waistW: 0.245, hip: 0.13, shoulder: 0.315, arm: 0.085, fore: 0.075, thigh: 0.115, shin: 0.09 },
};

const Y = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const TAU = Math.PI * 2;
// Frecuencia de ciclos completos, no pasos: dos apoyos por ciclo.
const GAITS = {
  light:  { cadence: 1.08, clearance: 1.00, crouch: 0.032 },
  medium: { cadence: 1.00, clearance: 0.92, crouch: 0.040 },
  heavy:  { cadence: 0.90, clearance: 0.78, crouch: 0.047 },
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Materiales compartidos: no se crean materiales por objetivo ni durante animate().
const darkMat = new THREE.MeshStandardMaterial({ color: 0x20252c, roughness: 0.7, metalness: 0.15 });
const jointMat = new THREE.MeshStandardMaterial({ color: 0x363d46, roughness: 0.9 });
const visorMat = new THREE.MeshStandardMaterial({ color: 0x101b24, roughness: 0.24, metalness: 0.55 });
// Los materiales body/head del llamador se conservan por referencia.


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

/** Perfil cerrado elíptico: y, radio X, radio Z, desplazamiento Z.
 * Se utiliza en anatomía y ropa; todo el volumen visible es golpeable.
 */
function profileGeometry(key, rings, segments = 16) {
  return cached(key, () => {
    const positions = [], indices = [];
    for (const [y, rx, rz, z = 0] of rings) {
      for (let j = 0; j <= segments; j++) {
        const a = j / segments * Math.PI * 2;
        positions.push(Math.sin(a) * rx, y, Math.cos(a) * rz + z);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const a = i * (segments + 1) + j, b = a + segments + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    // Soldar visualmente la costura sin añadir dependencias a BufferGeometryUtils.
    const n = g.getAttribute('normal');
    for (let i = 0; i < rings.length; i++) {
      const a = i * (segments + 1), b = a + segments;
      const v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
    }
    return g;
  });
}

function torsoGeometry(key, l) {
  const { b } = l, h = l.torsoTop - l.hipY - 0.02;
  return profileGeometry(`torso:v2:${key}`, [
    [-0.04, 0, 0],
    [-0.025, b.waistW * 0.88, b.chestD * 0.67],
    [h * 0.15, b.waistW, b.chestD * 0.73],
    [h * 0.35, b.waistW * 1.02, b.chestD * 0.83],
    [h * 0.61, b.chestW * 0.97, b.chestD],
    [h * 0.79, b.chestW, b.chestD * 0.98],
    [h * 0.91, b.chestW * 0.82, b.chestD * 0.79],
    [h, b.neck * 1.16, b.neck],
    [h, 0, 0],
  ], 20);
}

function headGeometry(key, r) {
  // Mentón, mandíbula, pómulos, sienes y cráneo. Altura total = 2r.
  return profileGeometry(`head:v2:${key}`, [
    [-r, 0, 0, r * 0.12],
    [-r * 0.9, r * 0.42, r * 0.51, r * 0.16],
    [-r * 0.58, r * 0.73, r * 0.73, r * 0.1],
    [-r * 0.18, r * 0.86, r * 0.88, r * 0.025],
    [r * 0.34, r * 0.89, r * 0.93],
    [r * 0.7, r * 0.73, r * 0.77, -r * 0.025],
    [r * 0.93, r * 0.36, r * 0.43],
    [r, 0, 0],
  ], 20);
}

function shapedLimb(key, radius, length, lower = false) {
  // El eje va de articulación proximal (y=0) a distal (y=-length).
  const r = radius, L = length;
  return profileGeometry(`limb:v2:${key}:${r}:${L}`, [
    [-L - r * 0.25, 0, 0],
    [-L, r * 0.65, r * 0.68],
    [-L * 0.8, r * (lower ? 0.7 : 0.81), r * 0.78],
    [-L * 0.48, r * (lower ? 1 : 0.98), r * 1.04],
    [-L * 0.2, r, r * 0.95],
    [0, r * 0.75, r * 0.8],
    [r * 0.3, 0, 0],
  ], 12);
}

function anatomicalLimb(key, r, from, to, mat, lower = false) {
  const direction = new THREE.Vector3().subVectors(from, to);
  const mesh = new THREE.Mesh(shapedLimb(key, r, direction.length(), lower), mat);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(Y, direction.normalize());
  return mesh;
}

// Caja biselada con normales de cara, reutilizada para placas y equipo.
function bevelBox(x, y, z, radius = Math.min(x, y, z) * 0.18) {
  return cached(`bevel:${x}:${y}:${z}:${radius}`, () => {
    const w = x / 2 - radius, h = y / 2 - radius;
    const shape = new THREE.Shape();
    shape.moveTo(-w, -h); shape.lineTo(w, -h); shape.lineTo(w, h);
    shape.lineTo(-w, h); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: z - radius * 2, bevelEnabled: true, bevelThickness: radius,
      bevelSize: radius, bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    g.translate(0, 0, -z / 2 + radius);
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
  const optic = new THREE.Mesh(bevelBox(0.048, 0.05, 0.075), darkMat);
  optic.position.set(0, 0.075, 0.2); gun.add(optic);
  const muzzle = new THREE.Mesh(cached('muzzle:v2', () => new THREE.CylinderGeometry(0.021, 0.021, 0.055, 10)), darkMat);
  muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.015, 0.765); gun.add(muzzle);
  gun.scale.setScalar(Math.max(1, s));
  return gun;
}

/** Agrupa piezas rígidas golpeables por articulación/material, conservando
 * la clasificación head/body. Geometría compartida entre instancias de clase.
 * No combina articulaciones animadas ni modifica materiales del llamador.
 */
function batchRigidHits(root, hits, classKey) {
  const hitSet = new Set(hits), parents = [];
  root.traverse(node => { if (node.children.length) parents.push(node); });
  parents.forEach((parent, parentIndex) => {
    const groups = [];
    const childIndices = new Map(parent.children.map((child, i) => [child, i]));
    for (const mesh of parent.children) {
      if (!hitSet.has(mesh) || mesh.children.length || Array.isArray(mesh.material)) continue;
      let group = groups.find(g => g.material === mesh.material && g.part === mesh.userData.part);
      if (!group) { group = {material: mesh.material, part: mesh.userData.part, meshes: []}; groups.push(group); }
      group.meshes.push(mesh);
    }
    groups.forEach(group => {
      if (group.meshes.length < 2) return;
      // Identidad de las piezas, independiente de los IDs de materiales.
      const members = group.meshes.map(m => childIndices.get(m)).join(',');
      const geometry = cached(`batch:v2:${classKey}:${parentIndex}:${members}`, () => {
        const positions = [], normals = [], uvs = [];
        for (const mesh of group.meshes) {
          mesh.updateMatrix();
          const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
          source.applyMatrix4(mesh.matrix);
          positions.push(...source.attributes.position.array);
          normals.push(...source.attributes.normal.array);
          if (source.attributes.uv) uvs.push(...source.attributes.uv.array);
          else for (let i = 0; i < source.attributes.position.count; i++) uvs.push(0, 0);
          source.dispose();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.computeBoundingSphere();
        return geo;
      });
      const merged = new THREE.Mesh(geometry, group.material);
      merged.userData = { ...group.meshes[0].userData };
      group.meshes.forEach(mesh => { parent.remove(mesh); hitSet.delete(mesh); });
      parent.add(merged); hitSet.add(merged);
    });
  });
  hits.length = 0;
  root.traverse(mesh => { if (hitSet.has(mesh)) hits.push(mesh); });
}

export class Humanoid {
  /**
   * @param {string} classKey light | medium | heavy
   * @param {{ body: THREE.Material, head: THREE.Material }} mats
   * @param {object} target para `userData.target` de las piezas golpeables
   */
  constructor(classKey, mats, target) {
    if (!Object.prototype.hasOwnProperty.call(BUILDS, classKey)) {
      throw new RangeError(`Unknown humanoid class: ${classKey}`);
    }
    const l = layoutFor(classKey);
    const { b } = l;
    this.l = l;
    this.gait = GAITS[classKey];
    this.hitMeshes = [];
    const hit = (mesh, part = 'body') => {
      mesh.userData = { target, part };
      this.hitMeshes.push(mesh);
      return mesh;
    };

    // Detalles corporales también reciben impactos. El arma sigue siendo decorativa.
    const plate = (parent, size, position, material = mats.body, part = 'body') => {
      const m = hit(new THREE.Mesh(bevelBox(...size), material), part);
      m.position.set(...position); parent.add(m); return m;
    };
    const ellipsoid = (parent, size, position, material = mats.body, part = 'body') => {
      const m = hit(new THREE.Mesh(sphere(1), material), part);
      m.scale.set(...size); m.position.set(...position); parent.add(m); return m;
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
    const head = hit(new THREE.Mesh(headGeometry(classKey, b.head), mats.head), 'head');
    head.position.y = up(l.headY);
    // Visera curvada: decorativa, igual que en la versión original.
    const visorGeo = cached(`visor:v2:${classKey}`, () => {
      const g = new THREE.SphereGeometry(b.head, 16, 6, Math.PI / 2 - 0.94, 1.88, 1.18, 0.42);
      g.scale(0.92, 0.92, 0.98); return g;
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    head.add(visor);
    // Auriculares y puente nasal pertenecen a la cabeza.
    for (const side of [-1, 1]) {
      ellipsoid(head, [b.head * 0.14, b.head * 0.27, b.head * 0.2],
        [side * b.head * 0.85, -b.head * 0.05, 0], mats.head, 'head');
    }
    plate(head, [b.head * 0.23, b.head * 0.32, b.head * 0.22],
      [0, -b.head * 0.17, b.head * 0.88], mats.head, 'head');
    this.spine.add(head);

    const h = l.torsoTop - l.hipY - 0.02;
    // Chaleco dividido en dos pectorales, abdomen y cinturón.
    for (const side of [-1, 1]) {
      const chest = plate(this.spine, [b.chestW * 0.86, h * 0.3, 0.035 * l.s],
        [side * b.chestW * 0.48, h * 0.66, b.chestD * 0.95]);
      chest.rotation.z = side * -0.055;
      const strap = plate(this.spine, [0.037 * l.s, h * 0.24, 0.022 * l.s],
        [side * b.chestW * 0.57, h * 0.86, b.chestD * 0.78], jointMat);
      strap.rotation.x = -0.35;
      // Placas escapulares: detalle legible también desde atrás.
      plate(this.spine, [b.chestW * 0.78, h * 0.33, 0.026 * l.s],
        [side * b.chestW * 0.46, h * 0.65, -b.chestD * 0.95]);
    }
    for (let i = 0; i < 2; i++) {
      plate(this.spine, [b.waistW * 1.38, h * 0.1, 0.025 * l.s],
        [0, h * (0.29 + i * 0.12), b.chestD * (0.8 + i * 0.06)]);
    }
    ellipsoid(this.root, [b.waistW * 1.03, 0.035 * l.s, b.chestD * 0.8],
      [0, 0.045 * l.s, 0], jointMat);
    plate(this.root, [0.065 * l.s, 0.05 * l.s, 0.024 * l.s],
      [0, 0.045 * l.s, b.chestD * 0.8]);

    const gun = buildGun(l.s);
    gun.position.copy(l.gun).setY(up(l.gun.y));
    this.spine.add(gun);

    for (const side of [1, -1]) { // +x = izquierda del modelo (mira hacia +z)
      const shoulder = new THREE.Vector3(side * b.shoulder, up(l.shoulderY), 0);
      const handAbs = side > 0 ? l.handL : l.handR;
      const hand = new THREE.Vector3(handAbs.x, up(handAbs.y), handAbs.z);
      const elbow = elbowFor(shoulder, hand, l.upperArm, l.foreArm, new THREE.Vector3(side * 0.7, -1, -0.2));
      const delt = hit(new THREE.Mesh(sphere(b.arm * 1.4), mats.body));
      delt.scale.set(0.94, 0.86, 0.92);
      delt.position.copy(shoulder);
      this.spine.add(delt);
      this.spine.add(hit(anatomicalLimb(`${classKey}:upperArm`, b.arm, shoulder, elbow, mats.body)));
      this.spine.add(hit(anatomicalLimb(`${classKey}:foreArm`, b.fore, elbow, hand, mats.body, true)));
      ellipsoid(this.spine, [b.fore * 0.85, b.fore * 0.85, b.fore * 0.85],
        [elbow.x, elbow.y, elbow.z], jointMat);
      // Guante aplanado, orientado según el antebrazo.
      const palm = hit(new THREE.Mesh(sphere(b.fore * 1.15), mats.body));
      palm.scale.set(0.82, 1.12, 0.8);
      palm.position.copy(hand);
      this.spine.add(palm);
    }

    // Piernas: cadera → rodilla → pie
    this.legs = [1, -1].map((side) => {
      const hip = new THREE.Group();
      hip.position.x = side * b.hip;
      const thigh = hit(new THREE.Mesh(shapedLimb(`${classKey}:thigh`, b.thigh, l.thighLen), mats.body));
      thigh.position.y = 0;
      const knee = new THREE.Group();
      knee.position.y = -l.thighLen;
      const shin = hit(new THREE.Mesh(shapedLimb(`${classKey}:shin`, b.shin, l.shinLen, true), mats.body));
      shin.position.y = 0;
      // Rodilla articulada y bota con talón/suela: no son cápsulas redondas.
      ellipsoid(knee, [b.shin * 1.04, b.shin * 1.04, b.shin * 1.04], [0, 0, 0], jointMat);
      plate(knee, [b.shin * 1.65, b.shin * 1.85, b.shin * 0.7],
        [0, -0.015 * l.s, b.shin * 0.84]);
      plate(knee, [b.shin * 1.22, l.shinLen * 0.43, b.shin * 0.44],
        [0, -l.shinLen * 0.46, b.shin * 0.88]);
      // Tobillo independiente: la suela conserva su orientación aunque flexione la rodilla.
      const ankle = new THREE.Group();
      ankle.position.y = -l.shinLen;
      const foot = hit(new THREE.Mesh(bevelBox(b.shin * 1.7, l.footR * 1.5, 0.245 * l.s), mats.body));
      foot.position.set(0, l.footR * 0.05, 0.047 * l.s);
      plate(ankle, [b.shin * 1.76, l.footR * 0.38, 0.25 * l.s],
        [0, -l.footR * 0.62, 0.047 * l.s], jointMat);
      ankle.add(foot);
      knee.add(shin, ankle);
      // Bolsillo lateral discreto; mayor volumen en la clase pesada.
      plate(hip, [b.thigh * 0.48, l.thighLen * 0.28, b.thigh * 1.32],
        [side * b.thigh * 0.89, -l.thighLen * 0.3, 0]);
      hip.add(thigh, knee);
      this.root.add(hip);
      return {
        side, hip, knee, ankle,
        // Scratch por pierna: animate() no genera vectores/cuaterniones cada frame.
        end: new THREE.Vector3(), direction: new THREE.Vector3(),
        bend: new THREE.Vector3(), kneePoint: new THREE.Vector3(),
        shinDirection: new THREE.Vector3(), shinWorld: new THREE.Quaternion(),
        footWorld: new THREE.Quaternion(), footEuler: new THREE.Euler(),
      };
    });

    batchRigidHits(this.root, this.hitMeshes, classKey);

    // Medidas en la pose de reposo
    this.top = b.height;
    this.aimRadius = b.chestW;
    const bounds = new THREE.Box3().setFromObject(this.root);
    this.halfWidth = Math.max(-bounds.min.x, bounds.max.x);

    this.phase = 0;
    this.clock = 0;
    this.speed = 0;
    this.cadence = 0;
    this.wasAirborne = false;
    this.landingTime = 1;
    this.landing = 0;
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
    if (!Number.isFinite(dt) || !Number.isFinite(vx) || !Number.isFinite(vz) || dt <= 0) return;
    // Tras volver de una pestaña inactiva no se salta medio ciclo de animación.
    dt = Math.min(dt, 0.05);
    const speed = Math.hypot(vx, vz);
    const ease = (rate) => 1 - Math.exp(-rate * dt);
    this.clock += dt;
    this.speed += (speed - this.speed) * ease(14);
    this.moving += (clamp(speed / 0.8, 0, 1) - this.moving) * ease(speed > 0.05 ? 12 : 16);
    this.air += ((airborne ? 1 : 0) - this.air) * ease(16);
    // Mezclar componentes, sin normalizar después: en una inversión el paso
    // se acorta antes de salir hacia el lado contrario, sin girar 180° de golpe.
    const dx = speed > 0.03 ? vx / speed : 0;
    const dz = speed > 0.03 ? vz / speed : 0;
    this.fx += (dx - this.fx) * ease(18);
    this.fz += (dz - this.fz) * ease(18);

    const run = clamp((this.speed - 1.4) / 4.6, 0, 1);
    this.cadence = (0.85 + 1.05 * run) * this.gait.cadence / this.l.s;
    this.phase = (this.phase + TAU * this.cadence * dt * this.moving * (1 - this.air)) % TAU;

    if (this.wasAirborne && !airborne) this.landingTime = 0;
    this.wasAirborne = !!airborne;
    this.landingTime += dt;
    const t = clamp(this.landingTime / 0.24, 0, 1);
    this.landing = airborne ? 0 : Math.sin(Math.PI * t) * (1 - t);
    this.pose(this.moving);
  }

  /** Coloca la rodilla por IK de dos huesos; el pie queda horizontal al apoyar.
   * Coordenadas relativas a la cadera, sin tocar la posición externa del target.
   */
  solveLeg(leg, x, y, z, pitch, yaw) {
    const { hip, knee, ankle, end, direction, bend, kneePoint,
      shinDirection, shinWorld, footWorld, footEuler } = leg;
    const a = this.l.thighLen, b = this.l.shinLen;
    end.set(x - hip.position.x, y - this.root.position.y, z);
    const distance = clamp(end.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
    direction.copy(end).normalize();
    end.copy(direction).multiplyScalar(distance);
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a * a - along * along));
    // La rodilla flexiona hacia delante, con una apertura discreta.
    bend.set(leg.side * 0.10, 0, 1);
    bend.addScaledVector(direction, -bend.dot(direction)).normalize();
    kneePoint.copy(direction).multiplyScalar(along).addScaledVector(bend, height);
    hip.quaternion.setFromUnitVectors(DOWN, direction.copy(kneePoint).normalize());
    shinDirection.subVectors(end, kneePoint).normalize();
    shinWorld.setFromUnitVectors(DOWN, shinDirection);
    knee.quaternion.copy(hip.quaternion).invert().multiply(shinWorld);
    footEuler.set(pitch, yaw, 0, 'YXZ');
    footWorld.setFromEuler(footEuler);
    ankle.quaternion.copy(shinWorld).invert().multiply(footWorld);
  }

  pose(k) {
    const { l, gait, air, fx, fz } = this;
    const run = clamp((this.speed - 1.4) / 4.6, 0, 1);
    const grounded = 1 - air;
    // Apoyo prolongado y oscilación pequeña: evita el rebote de "muñeco".
    const duty = 0.62 - 0.08 * run;
    const bob = (1 - Math.cos(this.phase * 2)) * 0.0035 * l.s * k * grounded;
    const crouch = (gait.crouch + run * 0.023 * k) * l.s;
    this.root.position.y = l.hipY - crouch - bob - 0.075 * l.s * this.landing;

    const amplitude = Math.min(0.32 * l.s,
      this.speed * duty / (2 * Math.max(0.1, this.cadence))) * k;
    const lateralAmplitude = Math.min(amplitude, (l.b.hip + 0.022 * l.s) * 0.72);
    const clearance = (0.043 + run * 0.037) * gait.clearance * l.s;
    for (const leg of this.legs) {
      const phase = (this.phase / TAU + (leg.side > 0 ? 0 : 0.5)) % 1;
      let travel, lift = 0, pitch = 0;
      if (phase < duty) {
        // Pie apoyado: avanza hacia atrás con velocidad constante respecto al cuerpo.
        travel = 1 - 2 * phase / duty;
      } else {
        const t = (phase - duty) / (1 - duty);
        // Hermite con velocidad de entrada/salida igual a la fase de apoyo.
        // Elimina los tirones en despegue y contacto.
        const tangent = -2 * (1 - duty) / duty;
        travel = -1 + (6 * t * t - 4 * t * t * t) + tangent * (2 * t * t * t - 3 * t * t + t);
        lift = Math.pow(Math.sin(Math.PI * t), 2) * clearance * k;
        pitch = -0.12 * Math.sin(TAU * t) * Math.pow(Math.sin(Math.PI * t), 2) * k * Math.abs(fz);
      }
      const stance = l.b.hip + 0.028 * l.s;
      const x = leg.side * stance + fx * travel * lateralAmplitude * grounded;
      const restingZ = leg.side * 0.028 * l.s;
      const z = restingZ + fz * travel * amplitude * grounded;
      // Una recogida corta en salto; sin seguir pedaleando en el aire.
      const jumpLift = (leg.side > 0 ? 0.105 : 0.065) * l.s * air;
      const y = l.footR * 0.81 + lift * grounded + jumpLift;
      leg.targetX = x; leg.targetY = y; leg.targetZ = z - 0.055 * l.s * air;
      leg.pitch = pitch * grounded + 0.12 * air;
      // Bajar ligeramente la pelvis si el apoyo exige más alcance; no despegar
      // artificialmente el pie del suelo al limitar la distancia en el solver.
      const reach = l.thighLen + l.shinLen - 0.002;
      const horizontal2 = (x - leg.hip.position.x) ** 2 + leg.targetZ ** 2;
      const maxHipHeight = y + Math.sqrt(Math.max(0.001, reach * reach - horizontal2));
      this.root.position.y = Math.min(this.root.position.y, maxHipHeight);
    }
    for (const leg of this.legs) {
      this.solveLeg(leg, leg.targetX, leg.targetY, leg.targetZ, leg.pitch, leg.side * 0.045);
    }
    // El arma y las manos comparten columna: no se separa el agarre.
    this.spine.rotation.x = 0.035 + 0.045 * fz * k * grounded + 0.055 * this.landing;
    this.spine.rotation.z = -0.028 * fx * k * grounded;
    this.spine.rotation.y = 0.012 * Math.sin(this.phase) * k * grounded;
  }
}
