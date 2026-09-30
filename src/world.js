import * as THREE from '../lib/three/three.module.js';

// Ambientación de "concurso televisado en una ciudad virtual": skyline, pantallas gigantes, grúas y
// edificios que se deshacen en vóxeles en el borde de la arena. Todo procedural y sin marcas reales.
// Los objetivos son naranja/amarillo/rosa: el fondo evita esos tonos para no quitarles contraste.
// Nada de decorado dentro de la zona de tiro (hasta ~121 m, ±70°); cerca solo hay cosas detrás o a los lados.

const SKY_ZENITH = 0x2f6fd0;
const SKY_HORIZON = 0xd3e2ee;
const SUN_DIR = new THREE.Vector3(30, 60, 20).normalize();
const SEED = 0x51a7e; // el decorado es siempre el mismo (referencia estable entre partidas)

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(renderer, w, h, draw, repeat = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ---- Texturas ----

function gridTexture(renderer) {
  return canvasTexture(renderer, 256, 256, (g, size) => {
    g.fillStyle = '#3a3f47';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#434852';
    g.fillRect(0, 0, size / 2, size / 2);
    g.fillRect(size / 2, size / 2, size / 2, size / 2);
    // Grano de hormigón, muy suave para no ensuciar la referencia de la cuadrícula
    const rand = mulberry32(SEED + 1);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.04)';
      g.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
    }
    g.strokeStyle = '#5a606b';
    g.lineWidth = 2;
    g.strokeRect(1, 1, size - 2, size - 2);
  });
}

// Una planta de oficinas: forjado arriba, dos ventanales. Blanco/gris para teñirlo con el color de vértice.
const OFFICE_TILE = { w: 6, h: 4, top: [0.5, 0.95] };
function officeTexture(renderer) {
  return canvasTexture(renderer, 128, 128, (g) => {
    g.fillStyle = '#ececec';
    g.fillRect(0, 0, 128, 128);
    const glass = g.createLinearGradient(0, 22, 0, 118);
    glass.addColorStop(0, '#8fa6ba');
    glass.addColorStop(1, '#4a5d70');
    g.fillStyle = glass;
    g.fillRect(4, 22, 56, 96);
    g.fillRect(68, 22, 56, 96);
    g.fillStyle = 'rgba(255,255,255,0.18)'; // reflejo
    g.fillRect(4, 22, 56, 10);
    g.fillRect(68, 22, 56, 10);
  });
}

// Muro cortina: todo cristal, con perfiles finos.
const GLASS_TILE = { w: 6, h: 4, top: [0.5, 0.98] };
function glassTexture(renderer) {
  return canvasTexture(renderer, 128, 128, (g) => {
    const glass = g.createLinearGradient(0, 0, 0, 128);
    glass.addColorStop(0, '#a9c3d8');
    glass.addColorStop(1, '#58758f');
    g.fillStyle = glass;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#dde4ea';
    g.fillRect(0, 0, 128, 5);
    for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 2, 128);
  });
}

// Chapa ondulada de contenedor, con los largueros arriba y abajo.
const CONTAINER_TILE = { w: 0.5, h: 2.6, top: [0.25, 0.5] };
function containerTexture(renderer) {
  return canvasTexture(renderer, 32, 64, (g) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, 32, 64);
    g.fillStyle = '#bdbdbd';
    g.fillRect(16, 0, 16, 64);
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, 32, 4);
    g.fillRect(0, 60, 32, 4);
  });
}

// ---- Geometría combinada (un solo draw call por material) ----

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  /**
   * Caja apoyada en y0, centrada en (x, z) y girada `ry` en torno a Y. Con `tile`, las caras laterales
   * repiten la textura cada tile.w × tile.h metros (alineada con el suelo) y la tapa usa el texel `tile.top`.
   */
  box(x, y0, z, w, h, d, color, { ry = 0, tile = null } = {}) {
    const c = new THREE.Color(color);
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    const hw = w / 2;
    const hd = d / 2;
    const y1 = y0 + h;
    const face = (corners, n, fw) => {
      const base = this.pos.length / 3;
      corners.forEach(([lx, ly, lz], i) => {
        this.pos.push(x + lx * cos + lz * sin, ly, z - lx * sin + lz * cos);
        this.nor.push(n[0] * cos + n[2] * sin, n[1], -n[0] * sin + n[2] * cos);
        this.col.push(c.r, c.g, c.b);
        if (!tile) this.uv.push(0, 0);
        else if (fw === 0) this.uv.push(tile.top[0], tile.top[1]);
        else this.uv.push(i === 1 || i === 2 ? fw / tile.w : 0, (i < 2 ? y0 : y1) / tile.h);
      });
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // Esquinas en orden antihorario vistas desde fuera: abajo-izq, abajo-der, arriba-der, arriba-izq
    face([[-hw, y0, hd], [hw, y0, hd], [hw, y1, hd], [-hw, y1, hd]], [0, 0, 1], w);
    face([[hw, y0, -hd], [-hw, y0, -hd], [-hw, y1, -hd], [hw, y1, -hd]], [0, 0, -1], w);
    face([[hw, y0, hd], [hw, y0, -hd], [hw, y1, -hd], [hw, y1, hd]], [1, 0, 0], d);
    face([[-hw, y0, -hd], [-hw, y0, hd], [-hw, y1, hd], [-hw, y1, -hd]], [-1, 0, 0], d);
    face([[-hw, y1, hd], [hw, y1, hd], [hw, y1, -hd], [-hw, y1, -hd]], [0, 1, 0], 0);
    if (y0 > 0) face([[-hw, y0, -hd], [hw, y0, -hd], [hw, y0, hd], [-hw, y0, hd]], [0, -1, 0], 0);
  }

  mesh(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return new THREE.Mesh(geo, material);
  }
}

/** Dirección horizontal desde el origen para un ángulo en grados (0 = de frente, -Z; positivo = derecha). */
function dirAt(deg) {
  const a = deg * (Math.PI / 180);
  return { x: Math.sin(a), z: -Math.cos(a), ry: -a }; // ry: la cara +Z mira al origen
}

// ---- Cielo ----

function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color(SKY_ZENITH) },
      horizon: { value: new THREE.Color(SKY_HORIZON) },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(horizon, zenith, pow(max(d.y, 0.0), 0.5));
        // Nubes: ruido proyectado en un plano alto, desvanecido hacia el horizonte
        vec2 p = d.xz / (d.y + 0.12) * 1.2;
        float n = noise(p) * 0.5 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 - 1.3) * 0.2;
        float cloud = smoothstep(0.55, 0.8, n) * smoothstep(0.03, 0.25, d.y);
        col = mix(col, vec3(1.0), cloud * 0.65);
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 3.0 + pow(s, 10.0) * 0.15);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

// ---- Skyline ----

const CONCRETE = [0xf4f1ea, 0xe6e0d4, 0xd2d4d8, 0xece4d2, 0xc4d0da, 0xb8d4cf, 0xf0f0f0];
const GLASS = [0xffffff, 0xe0ecf5, 0xc8e4e8, 0xb6c6dc, 0xd6d6e6];
const ROOF = 0x8e959e;

// Anillos de edificios: más bajos delante, torres altas al fondo (la niebla los separa en capas).
const RINGS = [
  { r0: 165, r1: 195, step: 8, h0: 16, h1: 50, fp: [16, 28] },
  { r0: 215, r1: 255, step: 6.5, h0: 35, h1: 95, fp: [16, 30] },
  { r0: 280, r1: 335, step: 5, h0: 60, h1: 165, fp: [18, 34] },
];

function buildSkyline(rand, office, glass, plain) {
  const towers = [];
  const pick = (list) => list[Math.floor(rand() * list.length)];
  RINGS.forEach((ring, ri) => {
    for (let a = rand() * ring.step; a < 360; a += ring.step * (0.7 + rand() * 0.6)) {
      if (rand() < 0.12) continue; // huecos para que se vea la capa de detrás
      const r = ring.r0 + rand() * (ring.r1 - ring.r0);
      const { x, z, ry: face } = dirAt(a);
      const ry = face + (rand() - 0.5) * 0.3;
      const w = ring.fp[0] + rand() * (ring.fp[1] - ring.fp[0]);
      const d = ring.fp[0] + rand() * (ring.fp[1] - ring.fp[0]);
      let h = ring.h0 + Math.pow(rand(), 1.6) * (ring.h1 - ring.h0);
      const isGlass = rand() < 0.5;
      const b = isGlass ? glass : office;
      const tile = isGlass ? GLASS_TILE : OFFICE_TILE;
      const color = isGlass ? pick(GLASS) : pick(CONCRETE);
      const px = x * r;
      const pz = z * r;
      h = Math.round(h / 4) * 4; // plantas enteras
      b.box(px, 0, pz, w, h, d, color, { ry, tile });
      let top = h;
      let tw = w;
      let td = d;
      // Retranqueos en las torres altas
      for (let s = 0; s < 2 && h > 50 && rand() < 0.55; s++) {
        tw *= 0.6 + rand() * 0.2;
        td *= 0.6 + rand() * 0.2;
        const sh = Math.round((h * (0.15 + rand() * 0.25)) / 4) * 4;
        b.box(px, top, pz, tw, sh, td, color, { ry, tile });
        top += sh;
      }
      // Azotea: máquinas y alguna antena
      for (let k = 0; k < 2; k++) {
        plain.box(px + (rand() - 0.5) * tw * 0.5, top, pz + (rand() - 0.5) * td * 0.5, 3 + rand() * 4, 2 + rand() * 2, 3 + rand() * 4, ROOF, { ry });
      }
      if (rand() < 0.3) plain.box(px, top, pz, 1.5, 12 + rand() * 18, 1.5, 0xcfd4da, { ry });
      towers.push({ x: px, z: pz, ry, w: tw, d: td, top, color, ring: ri });
    }
  });
  return towers;
}

// ---- Vóxeles: edificios que se deshacen en el borde de la arena virtual ----

function buildVoxels(rand, towers) {
  const solid = [];
  const glow = [];
  const candidates = towers.filter((t) => t.ring > 0 && t.top > 60);
  for (const t of candidates) {
    if (rand() > 0.3) continue;
    const n = 30 + Math.floor(rand() * 25);
    const cos = Math.cos(t.ry);
    const sin = Math.sin(t.ry);
    for (let i = 0; i < n; i++) {
      const f = Math.pow(rand(), 1.4); // más densos pegados a la azotea
      const spread = 0.5 + f * 0.9;
      const lx = (rand() - 0.5) * t.w * spread;
      const lz = (rand() - 0.5) * t.d * spread;
      const v = {
        x: t.x + lx * cos + lz * sin,
        y: t.top - 2 + f * 45,
        z: t.z - lx * sin + lz * cos,
        size: (4 - f * 3) * (0.6 + rand() * 0.6),
        phase: rand() * Math.PI * 2,
        speed: 0.25 + rand() * 0.35,
        amp: 0.4 + f * 1.6,
        spin: (rand() - 0.5) * 0.3,
        color: t.color,
      };
      (rand() < 0.25 ? glow : solid).push(v);
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const make = (list, material) => {
    const mesh = new THREE.InstancedMesh(box, material, list.length);
    const c = new THREE.Color();
    list.forEach((v, i) => mesh.setColorAt(i, c.set(v.color)));
    return mesh;
  };
  const solidMesh = make(solid, new THREE.MeshStandardMaterial({ roughness: 0.8 }));
  const glowMesh = make(glow, new THREE.MeshBasicMaterial({ color: 0x8fe9ff }));

  const dummy = new THREE.Object3D();
  const place = (mesh, list, time) => {
    list.forEach((v, i) => {
      dummy.position.set(v.x, v.y + Math.sin(time * v.speed + v.phase) * v.amp, v.z);
      dummy.rotation.set(v.phase + time * v.spin, v.phase * 2 + time * v.spin, 0);
      dummy.scale.setScalar(v.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  const update = (time) => {
    place(solidMesh, solid, time);
    place(glowMesh, glow, time);
  };
  update(0);
  // Se mueven, así que no hay que recortarlos con la esfera de la geometría base
  solidMesh.frustumCulled = glowMesh.frustumCulled = false;
  return { meshes: [solidMesh, glowMesh], update };
}

// ---- Pantallas gigantes ----

const SCREEN_FONT = 'system-ui, "Segoe UI", sans-serif';

function stripes(g, w, h, color) {
  g.fillStyle = color;
  for (let x = -h; x < w; x += 56) {
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x + 24, h);
    g.lineTo(x + 24 + h, 0);
    g.lineTo(x + h, 0);
    g.fill();
  }
}

const SCREENS = [
  // En directo
  (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0a1830');
    bg.addColorStop(1, '#1747a0');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    stripes(g, w, h, 'rgba(255,255,255,0.06)');
    g.fillStyle = '#ff3b5c';
    g.beginPath();
    g.arc(70, 118, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `italic 900 120px ${SCREEN_FONT}`;
    g.textBaseline = 'middle';
    g.fillText('LIVE', 110, 122);
    g.fillStyle = '#7fe3ff';
    g.font = `700 40px ${SCREEN_FONT}`;
    g.fillText('ROUND 01', 114, 212);
  },
  // Marcador de equipos
  (g, w, h) => {
    g.fillStyle = '#0c1422';
    g.fillRect(0, 0, w, h);
    const teams = [['#35d0ff', 0.92, '18,400'], ['#b18cff', 0.66, '12,900'], ['#9dff5c', 0.48, '9,750'], ['#e8eef4', 0.3, '6,200']];
    g.font = `800 34px ${SCREEN_FONT}`;
    g.textBaseline = 'middle';
    teams.forEach(([color, frac, cash], i) => {
      const y = 36 + i * 62;
      g.fillStyle = color;
      g.fillRect(28, y, 36, 40);
      g.globalAlpha = 0.85;
      g.fillRect(80, y + 6, (w - 280) * frac, 28);
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.textAlign = 'right';
      g.fillText(`$${cash}`, w - 28, y + 21);
      g.textAlign = 'left';
    });
  },
  // Reloj
  (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#111c2e');
    bg.addColorStop(1, '#070b13');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    stripes(g, w, h, 'rgba(127,227,255,0.05)');
    g.fillStyle = '#ffffff';
    g.font = `900 150px ${SCREEN_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('02:47', w / 2, h / 2 - 16);
    g.fillStyle = '#233349';
    g.fillRect(56, h - 58, w - 112, 16);
    g.fillStyle = '#7fe3ff';
    g.fillRect(56, h - 58, (w - 112) * 0.62, 16);
  },
  // Emblema de puntería
  (g, w, h) => {
    g.fillStyle = '#0f1726';
    g.fillRect(0, 0, w, h);
    stripes(g, w, h, 'rgba(255,255,255,0.04)');
    const cx = w / 2;
    const cy = h / 2;
    g.strokeStyle = '#7fe3ff';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(cx, cy, 92, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffffff';
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.fillRect(cx + dx * 70 - (dy ? 7 : 30) + dx * 30, cy + dy * 70 - (dx ? 7 : 30) + dy * 30, dy ? 14 : 60, dx ? 14 : 60);
    }
    g.beginPath();
    g.arc(cx, cy, 12, 0, Math.PI * 2);
    g.fill();
  },
];

// Ángulo (grados), distancia, altura del borde inferior y dibujo. Fuera del cono de tiro o por encima.
const SCREEN_SPOTS = [
  [-38, 158, 30, 0],
  [40, 158, 30, 1],
  [165, 150, 26, 2],
  [-140, 150, 26, 3],
];

function buildScreens(renderer, plain) {
  const W = 48;
  const H = 27;
  const geo = new THREE.PlaneGeometry(W, H);
  return SCREEN_SPOTS.map(([deg, r, y0, i]) => {
    const { x, z, ry } = dirAt(deg);
    const tex = canvasTexture(renderer, 512, 288, SCREENS[i], false);
    const screen = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    screen.position.set(x * r, y0 + H / 2, z * r);
    screen.rotation.y = ry;
    // Marco y patas
    const bx = x * (r + 1);
    const bz = z * (r + 1);
    plain.box(bx, y0 - 1, bz, W + 2, H + 2, 1.5, 0x2a2f38, { ry });
    for (const side of [-1, 1]) {
      const off = side * W * 0.3;
      plain.box(bx + Math.cos(ry) * off, 0, bz - Math.sin(ry) * off, 2.2, y0 - 1, 2.2, 0x59616c, { ry });
    }
    return screen;
  });
}

// ---- Grúas y contenedores ----

function crane(b, deg, r, h, jib) {
  const { x: dx, z: dz } = dirAt(deg);
  const x = dx * r;
  const z = dz * r;
  const steel = 0xc3ccd8;
  b.box(x, 0, z, 3, h, 3, steel);
  b.box(x, h, z, 4.5, 3.5, 4.5, 0x3b4452, { ry: jib });
  b.box(x, h + 3.5, z, 1.6, 10, 1.6, steel, { ry: jib });
  const cos = Math.cos(jib);
  const sin = Math.sin(jib);
  b.box(x + cos * 30, h + 3.5, z - sin * 30, 58, 2.2, 2.2, steel, { ry: jib }); // pluma
  b.box(x - cos * 10, h + 3.5, z + sin * 10, 20, 2.2, 2.2, steel, { ry: jib }); // contrapluma
  b.box(x - cos * 17, h + 0.5, z + sin * 17, 5, 4, 3.2, 0x59616c, { ry: jib }); // contrapeso
}

const CONTAINER_COLORS = [0x2f5fa8, 0x1f7f86, 0xe4e6e8, 0x6f7b88, 0x2e5a48, 0x24345a];
// x, z, ry, pisos, largo (12,2 m) o corto (6,1 m). Detrás del jugador y a los lados (> 90° de la línea de tiro).
const CONTAINERS = [
  [-22, 36, 0.08, 3, true], [-8, 40, -0.05, 2, true], [6, 33, 0.3, 1, false], [18, 42, -0.1, 2, true],
  [31, 50, 0.6, 1, true], [-36, 52, -0.4, 2, false],
  [-55, 8, 1.5, 2, true], [-61, 22, 1.4, 1, true], [-48, 30, 1.1, 1, false],
  [55, 12, 1.6, 3, true], [63, 27, 1.7, 1, false], [50, 32, 1.2, 2, true],
];

function buildContainers(rand, b) {
  for (const [x, z, ry, levels, long] of CONTAINERS) {
    for (let l = 0; l < levels; l++) {
      const color = CONTAINER_COLORS[Math.floor(rand() * CONTAINER_COLORS.length)];
      b.box(x, l * 2.6, z, long ? 12.2 : 6.1, 2.6, 2.44, color, { ry: ry + (rand() - 0.5) * 0.08, tile: CONTAINER_TILE });
    }
  }
}

// ---- Mundo ----

/** Arena: suelo con cuadrícula (referencia de distancia/movimiento), cielo y ciudad alrededor. */
export function buildWorld(scene, renderer, { arenaRadius = 0 } = {}) {
  scene.background = new THREE.Color(SKY_HORIZON);
  scene.fog = new THREE.Fog(SKY_HORIZON, 125, 400);
  scene.add(buildSky());

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4436, 1.6));
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.2);
  sun.position.copy(SUN_DIR).multiplyScalar(80);
  scene.add(sun);

  const colliders = [];
  const add = (mesh, collide = true) => {
    scene.add(mesh);
    if (collide) colliders.push(mesh);
  };

  const floorSize = 1000;
  const tex = gridTexture(renderer);
  tex.repeat.set(floorSize / 4, floorSize / 4); // celdas de 2 m
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  add(floor);

  // Borde de la zona por la que se puede mover el jugador, pintado en el suelo
  if (arenaRadius > 0) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(arenaRadius - 0.12, arenaRadius, 128),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    add(ring, false);
  }

  const rand = mulberry32(SEED);
  const office = new GeoBuilder();
  const glass = new GeoBuilder();
  const plain = new GeoBuilder();
  const containers = new GeoBuilder();

  const towers = buildSkyline(rand, office, glass, plain);
  crane(plain, -62, 205, 95, 0.9);
  crane(plain, 118, 190, 80, -2.2);
  crane(plain, 24, 240, 120, 2.6);
  for (const screen of buildScreens(renderer, plain)) add(screen);
  buildContainers(rand, containers);

  add(office.mesh(new THREE.MeshStandardMaterial({ map: officeTexture(renderer), vertexColors: true, roughness: 0.85 })));
  add(glass.mesh(new THREE.MeshStandardMaterial({ map: glassTexture(renderer), vertexColors: true, roughness: 0.5 })));
  add(plain.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
  add(containers.mesh(new THREE.MeshStandardMaterial({ map: containerTexture(renderer), vertexColors: true, roughness: 0.7 })));

  const voxels = buildVoxels(rand, towers);
  for (const mesh of voxels.meshes) add(mesh, false);

  return {
    colliders,
    /** Anima el decorado (solo los vóxeles). `time` en segundos. */
    update(time) {
      voxels.update(time);
    },
  };
}
