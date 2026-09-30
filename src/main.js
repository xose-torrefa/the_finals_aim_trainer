import * as THREE from '../lib/three/three.module.js';
import { DEG, loadSettings, saveSettings, keyLabel, hipVFovDeg, adsVFovDeg, hipDegPerCount, sensFactor, cm360FromDegPerCount } from './settings.js';
import { resolveWeapon, damageAt } from './weapons.js';
import { Input } from './input.js';
import { buildWorld } from './world.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { Overlay } from './overlay.js';
import { Sfx } from './audio.js';
import { Impacts } from './impacts.js';
import { Viewmodel } from './viewmodel.js';
import { Tracers } from './tracers.js';
import { SCENARIOS, createStats, scenarioSettings, scenarioName, groupName } from './scenarios.js';
import { addEntry } from './history.js';
import { AimAnalysis } from './analysis.js';
import { routineName } from './routines.js';
import { t, setLanguage } from './i18n.js';

const EYE_HEIGHT = 1.7;
const ARENA_RADIUS = 12;
const ADS_MOVE_MULT = 0.6;
const TRACER_START = 1; // m desde la cámara, en la dirección en que se ve la boca del cañón

const settings = loadSettings();
setLanguage(settings.language);
try {
  localStorage.removeItem('finals-aim.best.v1'); // récords antiguos, sin configuración fija
} catch { /* ignorar */ }

// ---- Render ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.autoClear = false; // el arma se dibuja en una segunda pasada
document.getElementById('app').append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
const world = buildWorld(scene, renderer, { arenaRadius: ARENA_RADIUS });
const impacts = new Impacts(scene);
const tracers = new Tracers(scene);
const viewmodel = new Viewmodel(settings);

function resize() {
  renderer.setPixelRatio(window.devicePixelRatio * settings.renderScale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = hipVFovDeg(settings, camera.aspect);
  camera.updateProjectionMatrix();
  viewmodel.setAspect(camera.aspect);
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
// Rutina en curso: { def, index, results: [{ key, t, score }] }. Se abandona al jugar otra cosa o salir.
let routine = null;
let countdownLeft = 0;
let adsT = 0;
let shotTimer = 0;

const input = new Input(renderer.domElement, settings);
const hud = new Hud(settings);
const sfx = new Sfx(settings);
const menu = new Menu(document.getElementById('menu'), settings, {
  onPlay: (key, ranked) => {
    routine = null;
    startSession(key, ranked);
  },
  onPlayRoutine: startRoutine,
  onRoutineNext: nextRoutineStep,
  onResume: requestLock,
  onRestart: restartSession,
  onQuit: quitSession,
  onChange: onSettingChange,
  onReplace: onSettingsReplaced,
  onSound: (kind) => sfx.preview(kind),
});
const overlay = new Overlay(document.getElementById('overlay'), {
  onStart: requestLock,
  onResume: requestLock,
  onRestart: restartSession,
  onSettings: openSettingsFromPause,
  onQuit: quitSession,
});
resize();

// Al cambiar un ajuste de audio desde el menú suena el sonido afectado
const SOUND_PREVIEW = { volume: 'hit', shotSound: 'shot', shotVolume: 'shot', hitSound: 'hit', hitVolume: 'hit', killVolume: 'kill', countdownVolume: 'countdown' };

function onSettingChange(key) {
  saveSettings(settings);
  if (SOUND_PREVIEW[key]) sfx.preview(SOUND_PREVIEW[key]);
  if (key === 'renderScale' || key.startsWith('fov') || key === 'viewmodelFov') resize();
  if (key === 'muzzleFlash') viewmodel.clearFlash();
  if (key === 'tracers') tracers.clear();
  if (key === 'useRawUpdate') input.bindMoveEvent();
  if (key === 'adsMode') input.ads = false;
  if (key === 'language') {
    setLanguage(settings.language);
    menu.rebuild();
  }
  applyToSession();
  hud.applySettings();
}

/** Tras importar una copia de seguridad: aplica todos los ajustes de golpe, sin sonidos de prueba. */
function onSettingsReplaced() {
  saveSettings(settings);
  setLanguage(settings.language);
  resize();
  viewmodel.clearFlash();
  tracers.clear();
  input.bindMoveEvent();
  input.ads = false;
  applyToSession();
  hud.applySettings();
  menu.rebuild();
}

function applyToSession() {
  if (!session) return;
  // Los ajustes personales (sens, FOV…) se aplican al momento; el modo no cambia a mitad de partida
  session.ctx.settings = scenarioSettings(settings, session.key, session.ranked);
  session.ctx.weapon = resolveWeapon(session.ctx.settings);
  viewmodel.setWeapon(session.ctx.weapon.key, session.ctx.weapon.sight, session.ctx.weapon.level);
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
  session = { key, def: SCENARIOS[key], ranked, scenario: null, ctx, stats, timeLeft: s.duration, analysis: new AimAnalysis(player) };
  session.scenario = session.def.create(ctx);
  viewmodel.setWeapon(ctx.weapon.key, ctx.weapon.sight, ctx.weapon.level);
  viewmodel.reset();
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
    let mode = ranked ? groupName(session.def.group) : 'Sandbox';
    if (routine) mode = `${routineName(routine.def)} · ${routine.index + 1}/${routine.def.steps.length}`;
    overlay.showReady({ name: scenarioName(key), mode, restartKey: keyLabel(settings.restartKey) });
  }
}

/** Empieza una rutina: sus escenarios en modo Escenarios, uno tras otro. */
function startRoutine(def) {
  routine = { def, index: 0, results: [] };
  startSession(def.steps[0], true);
}

function nextRoutineStep() {
  if (!routine || routine.index + 1 >= routine.def.steps.length) return;
  routine.index++;
  startSession(routine.def.steps[routine.index], true);
}

function restartSession() {
  if (lastPlayed) startSession(lastPlayed.key, lastPlayed.ranked);
}

function endScenario() {
  session?.scenario.dispose();
  session = null;
  impacts.clear();
  tracers.clear();
  viewmodel.clearFlash();
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
  if (routine) {
    routine = null;
    menu.show('routines');
  } else if (from?.ranked) menu.show('scenario', from.key);
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
  menu.setPaused({ key: session.key });
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
    const msg = t('lock.failed');
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
    overlay.showPause({ name: scenarioName(session.key), restartKey: keyLabel(settings.restartKey) });
  }
};

document.addEventListener('keydown', (e) => {
  if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Escape' && state === 'ready') {
    quitSession();
  } else if (e.code === 'Escape' && input.locked) {
    // Con la Keyboard Lock (pantalla completa del botón) el navegador no suelta el ratón con Esc
    input.unlock();
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
  const { def, scenario, stats, ctx, key, ranked, analysis } = session;
  const score = scenario.score(stats);
  const t = Date.now();
  if (ranked) {
    const s = ctx.settings;
    const w = ctx.weapon;
    const hipV = hipVFovDeg(s, camera.aspect);
    const hipDpc = hipDegPerCount(s);
    const adsDpc = hipDpc * sensFactor(s, 1, adsVFovDeg(hipV, w.fovMult), hipV, w.sniper);
    addEntry(key, def, {
      t,
      score,
      accuracy: stats.shots > 0 ? (100 * stats.hits) / stats.shots : null,
      cm360: cm360FromDegPerCount(hipDpc, s.dpi),
      adsCm360: cm360FromDegPerCount(adsDpc, s.dpi),
      fov: s.fov,
    });
  }
  const rows = scenario.summary(stats);
  input.unlock();
  hud.hide();
  overlay.hide();
  endScenario();
  let progress = null;
  if (routine) {
    // Si se repite un paso, cuenta la última partida
    routine.results[routine.index] = { key, t, score };
    progress = { def: routine.def, index: routine.index, results: [...routine.results] };
  }
  menu.showResults({ key, ranked, t, weapon: ctx.weapon.key, score, rows, analysis: analysis.result(), routine: progress });
}

// ---- Juego ----
const raycaster = new THREE.Raycaster();
const rayDir = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const tracerFrom = new THREE.Vector3();
const smoothstep = (t) => t * t * (3 - 2 * t);

function syncCamera() {
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
}

function castRay(dir) {
  raycaster.set(camera.position, dir);
  raycaster.far = 600;
  const hits = raycaster.intersectObjects([...world.colliders, ...session.scenario.colliders, ...session.scenario.hitMeshes], false);
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
  viewmodel.fire();
  const hit = castRay(rayDir);
  if (session.ctx.settings.tracers) {
    // Sale de donde se ve la boca del cañón y va al punto de impacto
    viewmodel.muzzleNdc(tracerFrom).setZ(0.5).unproject(camera).sub(camera.position).normalize();
    tracerFrom.multiplyScalar(TRACER_START).add(camera.position);
    tracers.add(tracerFrom, hit?.point ?? null, rayDir, session.ctx.settings.tracerColor);
  }
  if (!hit) return;
  if (!hit.target) {
    impacts.add(hit);
    return;
  }
  const head = hit.part === 'head';
  const first = hit.target.firstHitTime === null;
  const res = hit.target.applyDamage(damageAt(w, hit.distance) * (head ? w.headMult : 1), stats.time);
  session.analysis.onHit(hit.target, first, res.killed, hit.distance, stats.time);
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
  const prevPitch = player.pitch;
  player.yaw -= dx * radPerCount;
  player.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, player.pitch - dy * radPerCount));
  const turn = { yaw: -dx * radPerCount, pitch: player.pitch - prevPitch };

  // Cuenta atrás: se puede mirar y apuntar, pero ni moverse ni disparar, y el tiempo no corre
  if (state === 'countdown') {
    syncCamera();
    viewmodel.update(dt, { e, turn, moving: false });
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
  let moving = false;
  if (s.allowMove) {
    const k = input.keys;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const str = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    moving = Boolean(fwd || str);
    if (moving) {
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
  viewmodel.update(dt, { e, turn, moving });
  if (moving) stats.movingTime += dt;

  stats.time += dt;
  scenario.update(dt);
  impacts.update(dt);
  session.analysis.sample(stats.time);

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
  tracers.update(dt, camera, window.innerHeight);

  // Tiempo con la mira sobre un objetivo (métrica de tracking) y análisis de la puntería
  rayDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const aimed = castRay(rayDir)?.target ?? null;
  if (aimed && (moving || !scenario.requireMove)) stats.onTargetTime += dt;
  session.analysis.frame(dt, stats.time, scenario.targets, aimed);

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
  world.update(now / 1000);
  renderer.clear();
  renderer.render(scene, camera);
  if (session) {
    renderer.clearDepth();
    renderer.render(viewmodel.scene, viewmodel.camera);
  }
  requestAnimationFrame(frame);
}
syncCamera();
requestAnimationFrame(frame);
