import { WEAPONS, SIGHTS } from './weapons.js';

export const DEG = Math.PI / 180;
// v2: modo de sens de The Finals y sens de ADS en %. Los ajustes v1 se descartan.
const STORAGE_KEY = 'finals-aim.settings.v2';
const OLD_STORAGE_KEYS = ['finals-aim.settings.v1'];

// Grados por count a sens 1 en The Finals (sens 47 @ 400 DPI = 48,638 cm/360).
export const FINALS_YAW = 0.001;

export const DEFAULTS = {
  // Sensibilidad
  sensMode: 'finals',
  dpi: 400,
  cm360: 35,
  gameSens: 47,
  gameYaw: FINALS_YAW,
  adsSensPct: 78,
  sniperSensPct: 78,
  focalScaling: false,
  useRawUpdate: true,

  // FOV / ADS
  fov: 96,
  fovType: 'v', // The Finals usa FOV vertical (verificado midiendo en el juego)
  adsMode: 'hold',
  sight: 'weapon',
  adsTimeOverride: 0,

  // Sesión. mode: 'scenarios' (configuración fija, con registro) | 'sandbox'
  mode: 'scenarios',
  scenario: 'tracking',
  weapon: 'ar',
  duration: 60,

  // Objetivos
  targetClass: 'medium',
  targetDistance: 20,
  targetSpeed: 1,
  targetJumps: true,
  sphereScale: 1,

  // Jugador
  allowMove: true,
  moveSpeed: 5,

  // Visual / audio
  crosshairColor: '#00ff88',
  showFps: true,
  renderScale: 1,
  volume: 0.4,
};

// Esquema que usa el menú para generar el formulario. Los campos `sandbox`
// solo se muestran (y aplican) en modo Sandbox; en Escenarios son fijos.
export const SETTINGS_SCHEMA = [
  {
    section: 'Sensibilidad',
    fields: [
      { key: 'sensMode', label: 'Modo', type: 'select', options: [['finals', 'Sens de The Finals'], ['cm360', 'cm/360'], ['game', 'Sens × yaw personalizado']] },
      { key: 'dpi', label: 'DPI', type: 'number', min: 100, max: 32000, step: 50 },
      { key: 'cm360', label: 'cm/360 hipfire', type: 'number', min: 1, max: 300, step: 0.1, showIf: (s) => s.sensMode === 'cm360' },
      { key: 'gameSens', label: 'Sens del juego', type: 'number', min: 0.001, max: 100, step: 0.001, showIf: (s) => s.sensMode !== 'cm360' },
      { key: 'gameYaw', label: 'Yaw (°/count a sens 1)', type: 'number', min: 0.00001, max: 10, step: 0.00001, showIf: (s) => s.sensMode === 'game', hint: 'Constante del juego a convertir (The Finals = 0.001).' },
      { key: 'adsSensPct', label: 'Sensibilidad ADS (%)', type: 'number', min: 1, max: 500, step: 1 },
      { key: 'sniperSensPct', label: 'Sensibilidad francotirador (%)', type: 'number', min: 1, max: 500, step: 1, hint: 'En The Finals la mira del francotirador tiene su propio multiplicador.' },
      { key: 'focalScaling', label: 'Mouse Focal Length Sensitivity Scaling', type: 'checkbox', hint: 'ON: la sens de ADS además se reduce según el FOV de la mira (0% monitor distance).' },
      { key: 'useRawUpdate', label: 'pointerrawupdate', type: 'checkbox', hint: 'Menor latencia en Chromium. Desactivar si notas saltos.' },
    ],
  },
  {
    section: 'FOV / ADS',
    fields: [
      { key: 'fov', label: 'FOV', type: 'number', min: 30, max: 150, step: 1 },
      { key: 'fovType', label: 'Tipo de FOV', type: 'select', options: [['v', 'Vertical (The Finals)'], ['h16:9', 'Horizontal 16:9'], ['hActual', 'Horizontal (aspecto real)']] },
      { key: 'adsMode', label: 'ADS', type: 'select', options: [['hold', 'Mantener'], ['toggle', 'Alternar']] },
      { key: 'sight', sandbox: true, label: 'Mira', type: 'select', options: [['weapon', 'La del arma'], ...Object.entries(SIGHTS).map(([k, m]) => [k, m.name])] },
      { key: 'adsTimeOverride', sandbox: true, label: 'Tiempo ADS ms (0 = arma)', type: 'number', min: 0, max: 2000, step: 10 },
    ],
  },
  {
    section: 'Arma',
    fields: [
      { key: 'weapon', sandbox: true, label: 'Arma', type: 'select', options: Object.entries(WEAPONS).map(([k, w]) => [k, w.name]) },
    ],
  },
  {
    section: 'Objetivos',
    fields: [
      { key: 'targetClass', sandbox: true, label: 'Clase', type: 'select', options: [['light', 'Light (150 HP)'], ['medium', 'Medium (250 HP)'], ['heavy', 'Heavy (350 HP)'], ['random', 'Aleatoria']] },
      { key: 'targetDistance', sandbox: true, label: 'Distancia (m)', type: 'number', min: 3, max: 120, step: 1 },
      { key: 'targetSpeed', sandbox: true, label: 'Velocidad ×', type: 'number', min: 0, max: 3, step: 0.05 },
      { key: 'targetJumps', sandbox: true, label: 'Saltos / dashes', type: 'checkbox' },
      { key: 'sphereScale', sandbox: true, label: 'Tamaño esferas ×', type: 'number', min: 0.25, max: 4, step: 0.05 },
    ],
  },
  {
    section: 'Jugador',
    fields: [
      { key: 'allowMove', sandbox: true, label: 'Moverse (WASD)', type: 'checkbox' },
      { key: 'moveSpeed', sandbox: true, label: 'Velocidad (m/s)', type: 'number', min: 0, max: 15, step: 0.1 },
    ],
  },
  {
    section: 'Sesión y visual',
    fields: [
      { key: 'duration', sandbox: true, label: 'Duración (s)', type: 'number', min: 10, max: 600, step: 5 },
      { key: 'crosshairColor', label: 'Color mira', type: 'color' },
      { key: 'renderScale', label: 'Escala render', type: 'number', min: 0.25, max: 2, step: 0.05 },
      { key: 'showFps', label: 'Mostrar FPS', type: 'checkbox' },
      { key: 'volume', label: 'Volumen', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
];

export function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    OLD_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof stored[k] === typeof DEFAULTS[k]) s[k] = stored[k];
    }
  } catch { /* storage no disponible o corrupto: defaults */ }
  if (!WEAPONS[s.weapon]) s.weapon = DEFAULTS.weapon;
  if (s.sight !== 'weapon' && !SIGHTS[s.sight]) s.sight = DEFAULTS.sight;
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* ignorar */ }
}

// ---- FOV ----

const toRad = (d) => d * DEG;
const toDeg = (r) => r / DEG;

/** FOV vertical de hipfire en grados, según cómo esté expresado el ajuste. */
export function hipVFovDeg(s, aspect) {
  const half = toRad(s.fov) / 2;
  switch (s.fovType) {
    case 'v': return s.fov;
    case 'hActual': return toDeg(2 * Math.atan(Math.tan(half) / aspect));
    default: return toDeg(2 * Math.atan(Math.tan(half) / (16 / 9)));
  }
}

/** FOV vertical de ADS: en The Finals es un % fijo del FOV vertical de hipfire. */
export function adsVFovDeg(hipVDeg, fovMult) {
  return hipVDeg * fovMult;
}

/** Sens de ADS (%) que da 0% monitor distance respecto a hipfire. */
export function mdvZeroPct(hipVDeg, adsVDeg) {
  return (100 * Math.tan(toRad(adsVDeg) / 2)) / Math.tan(toRad(hipVDeg) / 2);
}

export function hFovFromV(vDeg, aspect) {
  return toDeg(2 * Math.atan(Math.tan(toRad(vDeg) / 2) * aspect));
}

// ---- Sensibilidad ----

/** Grados de giro por count de ratón en hipfire. */
export function hipDegPerCount(s) {
  if (s.sensMode === 'finals') return s.gameSens * FINALS_YAW;
  if (s.sensMode === 'game') return s.gameSens * s.gameYaw;
  return 360 / ((s.cm360 / 2.54) * s.dpi);
}

export function cm360FromDegPerCount(degPerCount, dpi) {
  return (360 / degPerCount / dpi) * 2.54;
}

/**
 * Multiplicador de sensibilidad respecto a hipfire.
 * @param e progreso de ADS (0 = hipfire, 1 = ADS completo)
 */
export function sensFactor(s, e, curVDeg, hipVDeg, sniper = false) {
  const pct = sniper ? s.sniperSensPct : s.adsSensPct;
  const mult = 1 + (pct / 100 - 1) * e;
  const focal = s.focalScaling
    ? Math.tan(toRad(curVDeg) / 2) / Math.tan(toRad(hipVDeg) / 2)
    : 1;
  return mult * focal;
}
