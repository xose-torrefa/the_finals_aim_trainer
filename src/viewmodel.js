// Arma en primera persona (viewmodel) y fogonazo. Se dibuja en una escena y con
// una cámara propias, encima del mundo, para que no atraviese paredes ni
// objetivos y su tamaño no dependa del FOV de juego. Los modelos se construyen
// con primitivas (sin ficheros externos); el eje de la mira de cada uno queda
// en el centro de la pantalla con el ADS completo.
import * as THREE from '../lib/three/three.module.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 20).rotateX(Math.PI / 2); // eje en z
const TUBE = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).rotateX(Math.PI / 2);
const RING = new THREE.TorusGeometry(1, 0.12, 8, 32); // en el plano XY, mirando a z
const DISC = new THREE.CircleGeometry(1, 24);
const PLANE = new THREE.PlaneGeometry(1, 1);

const MAT = {
  metal: new THREE.MeshStandardMaterial({ color: 0x4a5059, metalness: 0.4, roughness: 0.45 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x34373e, metalness: 0.1, roughness: 0.7 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x8c7a58, metalness: 0.1, roughness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6e4a2c, metalness: 0, roughness: 0.65 }),
  glass: new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  tube: new THREE.MeshStandardMaterial({ color: 0x34373e, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide }),
};

function add(parent, geometry, mat, [sx, sy, sz], [x, y, z], rx = 0) {
  const m = new THREE.Mesh(geometry, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  parent.add(m);
  return m;
}
const box = (g, mat, w, h, d, x, y, z, rx) => add(g, BOX, mat, [w, h, d], [x, y, z], rx);
const cyl = (g, mat, r, len, x, y, z) => add(g, CYL, mat, [r, r, len], [x, y, z]);

// Proporciones de cada arma (metros). El origen es la parte trasera del cajón de
// mecanismos; el cañón apunta hacia -z. `kick` = fuerza del retroceso visual.
const RIFLES = {
  ar: { w: 0.05, h: 0.075, len: 0.3, stock: [0.07, 0.2], guard: [0.05, 0.055, 0.2], barrel: [0.01, 0.12], mag: [0.03, 0.15, 0.06, 0.3], kick: 0.6 },
  smg: { w: 0.045, h: 0.07, len: 0.22, stock: [0.035, 0.17], guard: null, barrel: [0.009, 0.09], mag: [0.026, 0.18, 0.035, 0.05], kick: 0.45 },
  lmg: { w: 0.07, h: 0.09, len: 0.36, stock: [0.085, 0.22], guard: [0.065, 0.06, 0.18], barrel: [0.014, 0.28], box: true, kick: 0.6 },
  dmr: { w: 0.048, h: 0.07, len: 0.3, stock: [0.075, 0.22], guard: [0.045, 0.05, 0.26], barrel: [0.009, 0.16], mag: [0.03, 0.08, 0.055, 0.1], kick: 0.9 },
  sniper: { w: 0.05, h: 0.065, len: 0.34, stock: [0.085, 0.26], guard: null, barrel: [0.011, 0.45], mag: [0.03, 0.06, 0.06, 0], bolt: true, kick: 1.1 },
};

/** Fusil genérico según sus proporciones. Devuelve la altura del raíl y la z del cañón. */
function buildRifle(g, p) {
  const top = p.h / 2;
  box(g, MAT.metal, p.w, p.h, p.len, 0, 0, -p.len / 2);
  box(g, MAT.polymer, p.w * 0.6, 0.008, p.len * 0.8, 0, top + 0.004, -p.len * 0.45); // raíl
  // Culata
  const [stockH, stockLen] = p.stock;
  box(g, MAT.polymer, p.w * 0.8, stockH, stockLen, 0, -p.h * 0.1 - (p.h - stockH) * 0.3, stockLen / 2);
  // Empuñadura (inclinada hacia atrás)
  box(g, MAT.polymer, p.w * 0.6, 0.1, 0.038, 0, -top - 0.042, -0.05, -0.35);
  // Cargador (inclinado hacia delante) o caja de munición
  if (p.mag) {
    const [mw, mh, md, tilt] = p.mag;
    box(g, MAT.accent, mw, mh, md, 0, -top - mh / 2 + 0.01, -p.len * 0.5, tilt);
  }
  if (p.box) box(g, MAT.accent, 0.075, 0.09, 0.1, -0.015, -top - 0.035, -p.len * 0.45);
  let front = -p.len;
  if (p.guard) {
    const [gw, gh, gl] = p.guard;
    box(g, MAT.polymer, gw, gh, gl, 0, -0.004, front - gl / 2);
    front -= gl;
  }
  const [r, bl] = p.barrel;
  cyl(g, MAT.metal, r, bl + 0.04, 0, 0.004, front - bl / 2 + 0.02);
  cyl(g, MAT.metal, r * 1.5, 0.03, 0, 0.004, front - bl); // bocacha
  if (p.bolt) {
    box(g, MAT.metal, 0.04, 0.008, 0.008, p.w / 2 + 0.02, 0.012, -0.07);
    add(g, BOX, MAT.metal, [0.016, 0.016, 0.016], [p.w / 2 + 0.04, 0.012, -0.07]);
  }
  return { top: top + 0.008, muzzle: new THREE.Vector3(0, 0.004, front - bl - 0.016) };
}

function buildRevolver(g) {
  box(g, MAT.metal, 0.03, 0.045, 0.09, 0, 0, -0.045); // armazón
  cyl(g, MAT.metal, 0.022, 0.045, 0, -0.002, -0.045); // tambor
  cyl(g, MAT.metal, 0.009, 0.13, 0, 0.012, -0.09 - 0.065); // cañón
  box(g, MAT.metal, 0.014, 0.014, 0.12, 0, -0.004, -0.09 - 0.06); // guía bajo el cañón
  box(g, MAT.wood, 0.03, 0.1, 0.04, 0, -0.065, 0.012, -0.35); // cachas
  box(g, MAT.metal, 0.008, 0.02, 0.014, 0, 0.026, 0.004); // martillo
  return { top: 0.0225, muzzle: new THREE.Vector3(0, 0.012, -0.225), kick: 1 };
}

/** Mira reflex: ventana rectangular con cristal sobre una base. Devuelve la altura de su centro. */
function reflex(g, top, z, w, hgt, base) {
  const b = 0.004;
  box(g, MAT.metal, base[0], base[1], base[2], 0, top + base[1] / 2, z);
  const y = top + base[1] + hgt / 2;
  box(g, MAT.metal, w, b, 0.012, 0, y + hgt / 2, z);
  box(g, MAT.metal, w, b, 0.012, 0, y - hgt / 2, z);
  box(g, MAT.metal, b, hgt, 0.012, -w / 2, y, z);
  box(g, MAT.metal, b, hgt, 0.012, w / 2, y, z);
  add(g, PLANE, MAT.glass, [w - b, hgt - b, 1], [0, y, z]);
  return y;
}

/**
 * Añade la mira encima del arma. Devuelve el eje de la mira (y, z de su
 * centro), la distancia del ojo en ADS y si es un visor (se oculta en ADS).
 */
function buildSight(g, kind, top, len) {
  const z = -len * 0.4;
  if (kind === 'pistol') {
    // Reflex de pistola sobre una base alta, para que el tambor quede bien por
    // debajo del punto de mira
    return { y: reflex(g, top, z, 0.042, 0.032, [0.026, 0.02, 0.034]), z, eye: 0.2 };
  }
  if (kind === 'low') {
    // Red dot: marco circular con cristal
    const r = 0.017;
    box(g, MAT.metal, 0.03, 0.012, 0.04, 0, top + 0.006, z);
    const y = top + 0.012 + r;
    add(g, RING, MAT.metal, [r, r, r * 2.5], [0, y, z]);
    add(g, DISC, MAT.glass, [r, r, 1], [0, y, z]);
    return { y, z, eye: 0.22 };
  }
  if (kind === 'medium') {
    // Reflector: ventana rectangular grande
    return { y: reflex(g, top, z, 0.05, 0.04, [0.036, 0.01, 0.05]), z, eye: 0.22 };
  }
  // Visor: tubo abierto con campanas en los extremos
  const sniper = kind === 'sniper';
  const r = sniper ? 0.018 : 0.016;
  const tl = sniper ? 0.2 : 0.13;
  const y = top + 0.012 + r;
  box(g, MAT.metal, 0.012, 0.014, 0.014, 0, top + 0.007, z + tl * 0.3);
  box(g, MAT.metal, 0.012, 0.014, 0.014, 0, top + 0.007, z - tl * 0.3);
  add(g, TUBE, MAT.tube, [r, r, tl], [0, y, z]);
  add(g, RING, MAT.metal, [r * 1.35, r * 1.35, r * 3], [0, y, z + tl / 2]);
  add(g, RING, MAT.metal, [r * 1.5, r * 1.5, r * 3], [0, y, z - tl / 2]);
  return { y, z: z + tl / 2, eye: 0.08, scoped: true };
}

function buildModel(weaponKey, sight) {
  const parts = new THREE.Group();
  let info;
  if (weaponKey === 'revolver') {
    const r = buildRevolver(parts);
    info = { ...r, ...buildSight(parts, sight === 'low' ? 'pistol' : sight, r.top, 0.09) };
  } else {
    const p = RIFLES[weaponKey] ?? RIFLES.ar;
    const r = buildRifle(parts, p);
    info = { ...r, kick: p.kick, ...buildSight(parts, sight, r.top, p.len) };
  }
  return { parts, ...info, pistol: weaponKey === 'revolver' };
}

function flashTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.translate(size / 2, size / 2);
  g.globalCompositeOperation = 'lighter';
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, size / 2);
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.2, 'rgba(255,215,120,0.9)');
  grad.addColorStop(0.5, 'rgba(255,140,40,0.35)');
  grad.addColorStop(1, 'rgba(255,90,20,0)');
  // Puntas de la estrella
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i / 6) * Math.PI * 2);
    g.scale(1, 0.22);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, size / 2, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, size * 0.28, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const HIP_POS = new THREE.Vector3(0.16, -0.17, -0.4);
const HIP_POS_PISTOL = new THREE.Vector3(0.13, -0.13, -0.36);
const FLASH_TIME = 0.05;
const clamp = (x, a) => Math.max(-a, Math.min(a, x));

export class Viewmodel {
  constructor(settings) {
    this.settings = settings;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.viewmodelFov, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a5446, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);

    this.model = new THREE.Group();
    this.scene.add(this.model);
    this.muzzle = new THREE.Object3D();
    this.model.add(this.muzzle);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
    }));
    this.flash.visible = false;
    this.muzzle.add(this.flash);
    this.light = new THREE.PointLight(0xffb060, 0, 1.5, 2);
    this.muzzle.add(this.light);

    this.key = null;
    this.current = null;
    this.kick = 0;
    this.flashTime = 0;
    this.sway = new THREE.Vector2();
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.tmp = new THREE.Vector3();
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.fov = this.settings.viewmodelFov;
    this.camera.updateProjectionMatrix();
  }

  /** Construye el modelo del arma (solo si cambia el arma o la mira). */
  setWeapon(weaponKey, sight) {
    const key = `${weaponKey}:${sight}`;
    if (key === this.key) return;
    this.key = key;
    if (this.current) this.model.remove(this.current.parts);
    this.current = buildModel(weaponKey, sight);
    this.model.add(this.current.parts);
    this.muzzle.position.copy(this.current.muzzle);
    this.reset();
  }

  reset() {
    this.kick = 0;
    this.flashTime = 0;
    this.sway.set(0, 0);
    this.bobAmp = 0;
    this.flash.visible = false;
    this.light.intensity = 0;
  }

  fire() {
    this.kick = Math.min(1.4, this.kick + this.current.kick);
    if (!this.settings.muzzleFlash) return;
    this.flashTime = FLASH_TIME;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flashScale = 0.07 + Math.random() * 0.04;
  }

  /**
   * @param e      progreso de ADS 0..1 (suavizado)
   * @param turn   giro de la vista este frame en radianes { yaw, pitch }
   * @param moving si el jugador se está desplazando
   */
  update(dt, { e, turn, moving }) {
    const c = this.current;
    const s = this.settings;
    const hip = c.pistol ? HIP_POS_PISTOL : HIP_POS;
    const pos = this.model.position;
    // En ADS el eje de la mira queda en el centro, a `eye` metros del ojo
    pos.set(0, -c.y, -c.eye - c.z).sub(hip).multiplyScalar(e).add(hip);
    const rot = this.model.rotation;
    rot.set(0, 0.03 * (1 - e), 0);

    // Retroceso visual: el disparo sigue yendo al centro de la mira
    this.kick *= Math.exp(-dt * 14);
    const k = this.kick * (1 - 0.5 * e);
    pos.z += k * 0.035;
    pos.y += k * 0.004;
    rot.x += k * 0.07;

    // Inercia al girar y balanceo al andar
    const free = 1 - 0.8 * e;
    if (s.viewmodelSway && dt > 0) {
      const tx = clamp(-turn.yaw / dt * 0.012, 0.06);
      const ty = clamp(-turn.pitch / dt * 0.012, 0.06);
      const a = Math.min(1, dt * 10);
      this.sway.x += (tx - this.sway.x) * a;
      this.sway.y += (ty - this.sway.y) * a;
      rot.y += this.sway.x * free;
      rot.x += this.sway.y * free;
      this.bobAmp += ((moving ? 1 : 0) - this.bobAmp) * Math.min(1, dt * 8);
      this.bobPhase += dt * 9 * this.bobAmp;
      pos.x += Math.cos(this.bobPhase) * 0.005 * this.bobAmp * free;
      pos.y += Math.abs(Math.sin(this.bobPhase)) * 0.006 * this.bobAmp * free;
    }

    // Los visores taparían casi toda la vista: con el ADS completo se oculta el arma
    c.parts.visible = s.viewmodel && !(c.scoped && e > 0.9);

    this.flashTime = Math.max(0, this.flashTime - dt);
    const f = this.flashTime / FLASH_TIME;
    this.flash.visible = f > 0;
    this.flash.scale.setScalar(this.flashScale * (0.6 + 0.4 * f) * (1 - 0.5 * e));
    this.flash.position.z = -0.02;
    this.light.intensity = s.viewmodel ? f * 0.8 : 0;
    this.model.updateMatrixWorld();
  }

  /** Posición de la boca del cañón en coordenadas normalizadas de pantalla. */
  muzzleNdc(out) {
    return this.muzzle.getWorldPosition(out).project(this.camera);
  }

  clearFlash() {
    this.flashTime = 0;
    this.flash.visible = false;
    this.light.intensity = 0;
  }
}
