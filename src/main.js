import * as THREE from '/lib/three/three.module.js';
import { DEG, loadSettings, saveSettings, hipVFovDeg, adsVFovDeg, hipDegPerCount, sensFactor, cm360FromDegPerCount } from './settings.js';
import { WEAPONS, SIGHTS, damageAt } from './weapons.js';
import { Input } from './input.js';
import { buildWorld } from './world.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { Sfx } from './audio.js';
import { Impacts } from './impacts.js';
import { SCENARIOS, createStats, scenarioSettings } from './scenarios.js';
import { addEntry } from './history.js';

const EYE_HEIGHT = 1.7;
const ARENA_RADIUS = 12;
const ADS_MOVE_MULT = 0.6;

const settings = loadSettings();
try {
  localStorage.removeItem('finals-aim.best.v1'); // récords antiguos, sin configuración fija
} catch { /* ignorar */ }

// ---- Render ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
document.getElementById('app').append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
const world = buildWorld(scene, renderer);
const impacts = new Impacts(scene);

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
  getWeapon: () => currentWeapon(sessionSettings()),
});
resize();

/** Ajustes efectivos: en modo Escenarios se imponen los fijos del escenario. */
function sessionSettings(key = settings.scenario, ranked = settings.mode === 'scenarios') {
  return scenarioSettings(settings, key, ranked);
}

function currentWeapon(s) {
  const base = WEAPONS[s.weapon];
  const sight = s.sight === 'weapon' ? base.sight : s.sight;
  return {
    ...base,
    sight,
    fovMult: SIGHTS[sight].fovMult,
    sniper: SIGHTS[sight].sniper === true,
    adsTime: s.adsTimeOverride > 0 ? s.adsTimeOverride / 1000 : base.adsTime,
  };
}

function onSettingChange(key) {
  saveSettings(settings);
  if (key === 'renderScale' || key.startsWith('fov')) resize();
  if (key === 'useRawUpdate') input.bindMoveEvent();
  if (key === 'adsMode') input.ads = false;
  if (session) {
    // Los ajustes personales (sens, FOV…) se aplican al momento; el modo no cambia a mitad de partida
    session.ctx.settings = sessionSettings(session.key, session.ranked);
    session.ctx.weapon = currentWeapon(session.ctx.settings);
  }
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
  const ranked = settings.mode === 'scenarios';
  const s = sessionSettings(settings.scenario, ranked);
  const ctx = { scene, camera, player, settings: s, weapon: currentWeapon(s), stats };
  session = {
    key: settings.scenario,
    def: SCENARIOS[settings.scenario],
    ranked,
    scenario: null,
    ctx,
    stats,
    timeLeft: s.duration,
  };
  session.scenario = session.def.create(ctx);
  adsT = 0;
  shotTimer = 0;
  requestLock();
}

function endScenario() {
  session?.scenario.dispose();
  session = null;
  impacts.clear();
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
  const title = `${def.name} — ${ctx.weapon.name}`;
  if (session.ranked) {
    const score = scenario.score(stats);
    const s = ctx.settings;
    const w = ctx.weapon;
    const hipV = hipVFovDeg(s, camera.aspect);
    const hipDpc = hipDegPerCount(s);
    const adsDpc = hipDpc * sensFactor(s, 1, adsVFovDeg(hipV, w.fovMult), hipV, w.sniper);
    const list = addEntry(key, def, {
      t: Date.now(),
      score,
      accuracy: stats.shots > 0 ? (100 * stats.hits) / stats.shots : null,
      cm360: cm360FromDegPerCount(hipDpc, s.dpi),
      adsCm360: cm360FromDegPerCount(adsDpc, s.dpi),
      fov: s.fov,
    });
    const previous = list.slice(0, -1).map((e) => e.score);
    const best = previous.length ? Math.max(...previous) : null;
    menu.showResults(title, scenario.summary(stats), {
      score: def.formatScore(score),
      best: best === null ? null : def.formatScore(best),
      isRecord: best !== null && score > best,
      count: list.length,
    });
  } else {
    menu.showResults(title, scenario.summary(stats), null);
  }
  input.unlock();
  hud.hide();
  menu.show();
  endScenario();
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
  const hit = hits[0];
  return { ...hit, target: hit.object.userData.target ?? null, part: hit.object.userData.part };
}

// Sin dispersión: cada bala va exactamente al centro de la mira.
function shoot(w) {
  const { stats, scenario } = session;
  stats.shots++;
  rayDir.set(0, 0, -1).applyQuaternion(camera.quaternion);

  sfx.shot();
  const hit = castRay(rayDir);
  if (!hit) return;
  if (!hit.target) {
    impacts.add(hit);
    return;
  }
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

  // ADS: progreso lineal en el tiempo del arma; el FOV usa una curva suave
  const rate = w.adsTime > 0 ? dt / w.adsTime : 1;
  adsT = input.ads ? Math.min(1, adsT + rate) : Math.max(0, adsT - rate);
  const e = smoothstep(adsT);
  const s = session.ctx.settings;
  const hipV = hipVFovDeg(s, camera.aspect);
  const curV = hipV + (adsVFovDeg(hipV, w.fovMult) - hipV) * e;
  if (camera.fov !== curV) {
    camera.fov = curV;
    camera.updateProjectionMatrix();
  }

  // Ratón
  const [dx, dy] = input.consumeMouse();
  const radPerCount = hipDegPerCount(s) * sensFactor(s, e, curV, hipV, w.sniper) * DEG;
  player.yaw -= dx * radPerCount;
  player.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, player.pitch - dy * radPerCount));

  // Movimiento
  if (s.allowMove) {
    const k = input.keys;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const str = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (fwd || str) {
      forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      const move = forward.multiplyScalar(fwd).addScaledVector(right, str).normalize();
      const speed = s.moveSpeed * (1 + (ADS_MOVE_MULT - 1) * e);
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
  impacts.update(dt);

  // Disparo
  shotTimer -= dt;
  const wantFire = w.auto ? input.fire : input.takeFirePress();
  if (wantFire) {
    for (let n = 0; shotTimer <= 0 && n < 10; n++) {
      shoot(w);
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
