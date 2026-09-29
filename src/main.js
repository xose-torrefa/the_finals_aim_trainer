import * as THREE from '/lib/three/three.module.js';
import { DEG, loadSettings, saveSettings, keyLabel, hipVFovDeg, adsVFovDeg, hipDegPerCount, sensFactor, cm360FromDegPerCount } from './settings.js';
import { resolveWeapon, damageAt } from './weapons.js';
import { Input } from './input.js';
import { buildWorld } from './world.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { Overlay } from './overlay.js';
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
// 'menu' | 'ready' (esperando el clic) | 'countdown' | 'playing' | 'paused' | 'results'
let state = 'menu';
let session = null;
let lastPlayed = null; // { key, ranked } de la última partida, para reiniciar desde los resultados
let countdownLeft = 0;
let adsT = 0;
let shotTimer = 0;

const input = new Input(renderer.domElement, settings);
const hud = new Hud(settings);
const sfx = new Sfx(settings);
const menu = new Menu(document.getElementById('menu'), settings, {
  onPlay: startSession,
  onResume: requestLock,
  onRestart: restartSession,
  onQuit: quitSession,
  onChange: onSettingChange,
});
const overlay = new Overlay(document.getElementById('overlay'), {
  onStart: requestLock,
  onResume: requestLock,
  onRestart: restartSession,
  onSettings: openSettingsFromPause,
  onQuit: quitSession,
});
resize();

function onSettingChange(key) {
  saveSettings(settings);
  if (key === 'renderScale' || key.startsWith('fov')) resize();
  if (key === 'useRawUpdate') input.bindMoveEvent();
  if (key === 'adsMode') input.ads = false;
  if (session) {
    // Los ajustes personales (sens, FOV…) se aplican al momento; el modo no cambia a mitad de partida
    session.ctx.settings = scenarioSettings(settings, session.key, session.ranked);
    session.ctx.weapon = resolveWeapon(session.ctx.settings);
  }
  hud.applySettings();
}

// ---- Sesión ----

/**
 * Prepara una partida. Si el ratón ya está capturado (reinicio en plena
 * partida) arranca la cuenta atrás; si no, espera al clic del jugador.
 * @param ranked true = modo Escenarios (configuración fija y registro)
 */
function startSession(key, ranked) {
  sfx.unlock();
  endScenario();
  player.pos.set(0, EYE_HEIGHT, 0);
  player.yaw = 0;
  player.pitch = 0;
  syncCamera();

  const stats = createStats();
  const s = scenarioSettings(settings, key, ranked);
  const ctx = { scene, camera, player, settings: s, weapon: resolveWeapon(s), stats };
  session = { key, def: SCENARIOS[key], ranked, scenario: null, ctx, stats, timeLeft: s.duration };
  session.scenario = session.def.create(ctx);
  lastPlayed = { key, ranked };
  adsT = 0;
  shotTimer = 0;
  input.ads = false;

  menu.hide();
  menu.setPaused(null);
  if (input.locked) {
    beginCountdown();
  } else {
    state = 'ready';
    hud.hide();
    overlay.showReady({ name: session.def.name, mode: ranked ? session.def.group : 'Sandbox', restartKey: keyLabel(settings.restartKey) });
  }
}

function restartSession() {
  if (lastPlayed) startSession(lastPlayed.key, lastPlayed.ranked);
}

function endScenario() {
  session?.scenario.dispose();
  session = null;
  impacts.clear();
  camera.fov = hipVFovDeg(settings, camera.aspect); // por si se ha salido en ADS
  camera.updateProjectionMatrix();
}

/** Abandona la partida y vuelve a la página desde la que se lanzó. */
function quitSession() {
  const from = session;
  state = 'menu';
  endScenario();
  input.unlock();
  overlay.hide();
  hud.hide();
  menu.setPaused(null);
  if (from?.ranked) menu.show('scenario', from.key);
  else menu.show(from ? 'sandbox' : undefined);
}

function beginCountdown() {
  countdownLeft = settings.countdown;
  input.takeFirePress();
  menu.hide();
  menu.setPaused(null);
  hud.show();
  if (countdownLeft > 0) {
    state = 'countdown';
    overlay.showCountdown();
    overlay.setCount(Math.ceil(countdownLeft));
    sfx.tick(false);
  } else {
    state = 'playing';
    overlay.hide();
  }
}

function openSettingsFromPause() {
  overlay.hide();
  menu.setPaused({ name: session.def.name });
  menu.show('settings');
}

async function requestLock() {
  sfx.unlock();
  overlay.setMessage('');
  menu.setMessage('');
  try {
    await input.lock();
  } catch {
    // Chrome bloquea volver a capturar el ratón ~1 s después de pulsar Esc
    const msg = 'El navegador no ha dejado capturar el ratón. Espera un segundo y vuelve a intentarlo.';
    overlay.setMessage(msg);
    menu.setMessage(msg);
  }
}

input.onLockChange = (locked) => {
  if (locked && session && (state === 'ready' || state === 'paused')) {
    beginCountdown();
  } else if (!locked && (state === 'playing' || state === 'countdown')) {
    state = 'paused';
    hud.hide();
    overlay.showPause({ name: session.def.name, restartKey: keyLabel(settings.restartKey) });
  }
};

document.addEventListener('keydown', (e) => {
  if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Escape' && state === 'ready') {
    quitSession();
  } else if (e.code === settings.restartKey) {
    const inGame = ['ready', 'countdown', 'playing', 'paused'].includes(state);
    if (inGame || (state === 'results' && menu.page === 'results')) {
      e.preventDefault();
      restartSession();
    }
  }
});

function finishSession() {
  state = 'results';
  const { def, scenario, stats, ctx, key, ranked } = session;
  const score = scenario.score(stats);
  if (ranked) {
    const s = ctx.settings;
    const w = ctx.weapon;
    const hipV = hipVFovDeg(s, camera.aspect);
    const hipDpc = hipDegPerCount(s);
    const adsDpc = hipDpc * sensFactor(s, 1, adsVFovDeg(hipV, w.fovMult), hipV, w.sniper);
    addEntry(key, def, {
      t: Date.now(),
      score,
      accuracy: stats.shots > 0 ? (100 * stats.hits) / stats.shots : null,
      cm360: cm360FromDegPerCount(hipDpc, s.dpi),
      adsCm360: cm360FromDegPerCount(adsDpc, s.dpi),
      fov: s.fov,
    });
  }
  const rows = scenario.summary(stats);
  const weaponName = ctx.weapon.name;
  input.unlock();
  hud.hide();
  overlay.hide();
  endScenario();
  menu.showResults({ key, ranked, weaponName, score, rows });
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

  // Cuenta atrás: se puede mirar y apuntar, pero ni moverse ni disparar, y el tiempo no corre
  if (state === 'countdown') {
    syncCamera();
    const prev = Math.ceil(countdownLeft);
    countdownLeft -= dt;
    const n = Math.ceil(countdownLeft);
    if (n !== prev) sfx.tick(n <= 0);
    if (n <= 0) {
      state = 'playing';
      overlay.hide();
      input.takeFirePress();
    } else {
      overlay.setCount(n);
    }
    hud.update(dt, { e, timeLeft: session.timeLeft, live: scenario.live(stats) });
    return;
  }

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
  if (state === 'playing' || state === 'countdown') update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
syncCamera();
requestAnimationFrame(frame);
