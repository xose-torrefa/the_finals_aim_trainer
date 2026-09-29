import * as THREE from '/lib/three/three.module.js';
import { DEG, loadSettings, saveSettings, hipVFovDeg, zoomedVFovDeg, hipDegPerCount, sensFactor } from './settings.js';
import { WEAPONS, damageAt } from './weapons.js';
import { Input } from './input.js';
import { buildWorld } from './world.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { Sfx } from './audio.js';
import { SCENARIOS, createStats } from './scenarios.js';

const EYE_HEIGHT = 1.7;
const ARENA_RADIUS = 12;
const ADS_MOVE_MULT = 0.6;
const BEST_KEY = 'finals-aim.best.v1';

const settings = loadSettings();

// ---- Render ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
document.getElementById('app').append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
const world = buildWorld(scene, renderer);

function resize() {
  renderer.setPixelRatio(window.devicePixelRatio * settings.renderScale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = hipVFovDeg(settings, camera.aspect);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => {
  resize();
  menu.refresh();
});

// ---- Estado ----
const player = { pos: new THREE.Vector3(0, EYE_HEIGHT, 0), yaw: 0, pitch: 0 };
let state = 'menu'; // 'menu' | 'playing' | 'paused' | 'results'
let session = null;
let adsT = 0;
let shotTimer = 0;

const input = new Input(renderer.domElement, settings);
const hud = new Hud(settings);
const sfx = new Sfx(settings);
const menu = new Menu(document.getElementById('menu'), settings, {
  onStart: startSession,
  onResume: requestLock,
  onChange: onSettingChange,
  getWeapon: currentWeapon,
});
resize();

function currentWeapon() {
  const base = WEAPONS[settings.weapon];
  return {
    ...base,
    zoom: settings.adsZoomOverride > 0 ? settings.adsZoomOverride : base.zoom,
    adsTime: settings.adsTimeOverride > 0 ? settings.adsTimeOverride / 1000 : base.adsTime,
  };
}

function onSettingChange(key) {
  saveSettings(settings);
  if (key === 'renderScale' || key.startsWith('fov')) resize();
  if (key === 'useRawUpdate') input.bindMoveEvent();
  if (key === 'adsMode') input.ads = false;
  if (session) session.ctx.weapon = currentWeapon();
  hud.applySettings();
}

// ---- Sesión ----
function startSession() {
  sfx.unlock();
  endScenario();
  player.pos.set(0, EYE_HEIGHT, 0);
  player.yaw = 0;
  player.pitch = 0;
  syncCamera();

  const stats = createStats();
  const weapon = currentWeapon();
  const ctx = { scene, camera, player, settings, weapon, stats };
  session = {
    key: settings.scenario,
    def: SCENARIOS[settings.scenario],
    scenario: null,
    ctx,
    stats,
    timeLeft: settings.duration,
  };
  session.scenario = session.def.create(ctx);
  adsT = 0;
  shotTimer = 0;
  requestLock();
}

function endScenario() {
  session?.scenario.dispose();
  session = null;
}

async function requestLock() {
  sfx.unlock();
  menu.setMessage('');
  try {
    await input.lock();
  } catch {
    // Chrome bloquea volver a capturar el ratón ~1 s después de pulsar Esc
    menu.setMessage('El navegador no ha dejado capturar el ratón. Espera un segundo y vuelve a intentarlo.');
  }
}

input.onLockChange = (locked) => {
  if (locked && session) {
    state = 'playing';
    menu.hide();
    hud.show();
  } else if (!locked && state === 'playing') {
    state = 'paused';
    hud.hide();
    menu.setMode('pause');
    menu.show();
  }
};

function finishSession() {
  state = 'results';
  const { def, scenario, stats, ctx, key } = session;
  const score = scenario.score(stats);
  const bestKey = `${key}|${settings.weapon}|${settings.targetClass}|${settings.targetDistance}`;
  const bests = loadBests();
  const prev = bests[bestKey];
  const isRecord = prev === undefined || score > prev;
  if (isRecord) {
    bests[bestKey] = score;
    saveBests(bests);
  }
  const title = `${def.name} — ${ctx.weapon.name}`;
  menu.showResults(title, scenario.summary(stats), scenario.formatScore(isRecord ? score : prev), isRecord && prev !== undefined);
  input.unlock();
  hud.hide();
  menu.show();
  endScenario();
}

function loadBests() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveBests(b) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch { /* ignorar */ }
}

// ---- Juego ----
const raycaster = new THREE.Raycaster();
const rayDir = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const smoothstep = (t) => t * t * (3 - 2 * t);

function syncCamera() {
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
}

function castRay(dir) {
  raycaster.set(camera.position, dir);
  raycaster.far = 600;
  const hits = raycaster.intersectObjects([...world.colliders, ...session.scenario.hitMeshes], false);
  if (!hits.length) return null;
  const { object, distance } = hits[0];
  return { distance, target: object.userData.target ?? null, part: object.userData.part };
}

function shoot(w, e) {
  const { stats, scenario } = session;
  stats.shots++;

  // Punto aleatorio uniforme dentro del cono de dispersión
  const spread = (w.hipSpread + (w.adsSpread - w.hipSpread) * e) * DEG;
  const r = Math.sqrt(Math.random()) * Math.tan(spread);
  const a = Math.random() * Math.PI * 2;
  rayDir.set(r * Math.cos(a), r * Math.sin(a), -1).normalize().applyQuaternion(camera.quaternion);

  const hit = castRay(rayDir);
  if (!hit?.target) return;
  const head = hit.part === 'head';
  const res = hit.target.applyDamage(damageAt(w, hit.distance) * (head ? w.headMult : 1), stats.time);
  stats.hits++;
  if (head) stats.headshots++;
  stats.damage += res.dealt;
  scenario.onHit(hit.target, hit.part, res);
  hud.hit(head, res.killed);
  if (res.killed) sfx.kill();
  else sfx.hit(head);
}

function update(dt) {
  const w = session.ctx.weapon;
  const { stats, scenario } = session;

  // ADS: progreso lineal en el tiempo del arma; el zoom usa una curva suave
  const rate = w.adsTime > 0 ? dt / w.adsTime : 1;
  adsT = input.ads ? Math.min(1, adsT + rate) : Math.max(0, adsT - rate);
  const e = smoothstep(adsT);
  const hipV = hipVFovDeg(settings, camera.aspect);
  const curV = zoomedVFovDeg(hipV, 1 + (w.zoom - 1) * e);
  if (camera.fov !== curV) {
    camera.fov = curV;
    camera.updateProjectionMatrix();
  }

  // Ratón
  const [dx, dy] = input.consumeMouse();
  const radPerCount = hipDegPerCount(settings) * sensFactor(settings, e, curV, hipV) * DEG;
  player.yaw -= dx * radPerCount;
  player.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, player.pitch - dy * radPerCount));

  // Movimiento
  if (settings.allowMove) {
    const k = input.keys;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const str = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (fwd || str) {
      forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      const move = forward.multiplyScalar(fwd).addScaledVector(right, str).normalize();
      const speed = settings.moveSpeed * (1 + (ADS_MOVE_MULT - 1) * e);
      player.pos.addScaledVector(move, speed * dt);
      const flat = Math.hypot(player.pos.x, player.pos.z);
      if (flat > ARENA_RADIUS) {
        player.pos.x *= ARENA_RADIUS / flat;
        player.pos.z *= ARENA_RADIUS / flat;
      }
    }
  }
  syncCamera();

  stats.time += dt;
  scenario.update(dt);

  // Disparo
  shotTimer -= dt;
  const wantFire = w.auto ? input.fire : input.takeFirePress();
  if (wantFire) {
    for (let n = 0; shotTimer <= 0 && n < 10; n++) {
      shoot(w, e);
      shotTimer += 60 / w.rpm;
      if (!w.auto) break;
    }
  }
  if (shotTimer < 0) shotTimer = 0;

  // Tiempo con la mira sobre un objetivo (métrica de tracking)
  rayDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  if (castRay(rayDir)?.target) stats.onTargetTime += dt;

  session.timeLeft -= dt;
  hud.update(dt, {
    spreadDeg: w.hipSpread + (w.adsSpread - w.hipSpread) * e,
    vFovDeg: curV,
    e,
    timeLeft: session.timeLeft,
    live: scenario.live(stats),
  });
  if (session.timeLeft <= 0) finishSession();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (state === 'playing') update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
syncCamera();
requestAnimationFrame(frame);
