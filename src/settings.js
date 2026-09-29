import { WEAPONS } from './weapons.js';

export const DEG = Math.PI / 180;
const STORAGE_KEY = 'finals-aim.settings.v1';

export const DEFAULTS = {
  // Sensibilidad
  sensMode: 'cm360',
  dpi: 800,
  cm360: 35,
  gameSens: 1,
  gameYaw: 0.07,
  adsMultiplier: 1,
  adsScaling: 'focal',
  useRawUpdate: true,

  // FOV / ADS
  fov: 90,
  fovType: 'h16:9',
  adsMode: 'hold',
  adsZoomOverride: 0,
  adsTimeOverride: 0,

  // Sesión
  scenario: 'tracking',
  weapon: 'ar',
  duration: 60,

  // Objetivos
  targetClass: 'medium',
  targetDistance: 20,
  targetSpeed: 1,
  targetJumps: true,

  // Jugador
  allowMove: true,
  moveSpeed: 5,

  // Visual / audio
  crosshairColor: '#00ff88',
  showFps: true,
  renderScale: 1,
  volume: 0.4,
};

// Esquema que usa el menú para generar el formulario.
export const SETTINGS_SCHEMA = [
  {
    section: 'Sensibilidad',
    fields: [
      { key: 'sensMode', label: 'Modo', type: 'select', options: [['cm360', 'cm/360'], ['game', 'Sens juego × yaw']] },
      { key: 'dpi', label: 'DPI', type: 'number', min: 100, max: 32000, step: 50 },
      { key: 'cm360', label: 'cm/360 hipfire', type: 'number', min: 1, max: 300, step: 0.1, showIf: (s) => s.sensMode === 'cm360' },
      { key: 'gameSens', label: 'Sens del juego', type: 'number', min: 0.001, max: 100, step: 0.001, showIf: (s) => s.sensMode === 'game' },
      { key: 'gameYaw', label: 'Yaw (°/count a sens 1)', type: 'number', min: 0.00001, max: 10, step: 0.00001, showIf: (s) => s.sensMode === 'game', hint: 'Constante del juego. Pendiente de calibrar para The Finals.' },
      { key: 'adsMultiplier', label: 'Multiplicador ADS', type: 'number', min: 0.01, max: 5, step: 0.01 },
      { key: 'adsScaling', label: 'Escalado ADS', type: 'select', options: [['focal', 'Por zoom (0% MDV)'], ['none', 'Solo multiplicador']] },
      { key: 'useRawUpdate', label: 'pointerrawupdate', type: 'checkbox', hint: 'Menor latencia en Chromium. Desactivar si notas saltos.' },
    ],
  },
  {
    section: 'FOV / ADS',
    fields: [
      { key: 'fov', label: 'FOV', type: 'number', min: 30, max: 150, step: 1 },
      { key: 'fovType', label: 'Tipo de FOV', type: 'select', options: [['h16:9', 'Horizontal 16:9'], ['hActual', 'Horizontal (aspecto real)'], ['v', 'Vertical']] },
      { key: 'adsMode', label: 'ADS', type: 'select', options: [['hold', 'Mantener'], ['toggle', 'Alternar']] },
      { key: 'adsZoomOverride', label: 'Zoom ADS (0 = arma)', type: 'number', min: 0, max: 12, step: 0.05 },
      { key: 'adsTimeOverride', label: 'Tiempo ADS ms (0 = arma)', type: 'number', min: 0, max: 2000, step: 10 },
    ],
  },
  {
    section: 'Arma',
    fields: [
      { key: 'weapon', label: 'Arma', type: 'select', options: Object.entries(WEAPONS).map(([k, w]) => [k, w.name]) },
    ],
  },
  {
    section: 'Objetivos',
    fields: [
      { key: 'targetClass', label: 'Clase', type: 'select', options: [['light', 'Light (150 HP)'], ['medium', 'Medium (250 HP)'], ['heavy', 'Heavy (350 HP)'], ['random', 'Aleatoria']] },
      { key: 'targetDistance', label: 'Distancia (m)', type: 'number', min: 3, max: 120, step: 1 },
      { key: 'targetSpeed', label: 'Velocidad ×', type: 'number', min: 0, max: 3, step: 0.05 },
      { key: 'targetJumps', label: 'Saltos / dashes', type: 'checkbox' },
    ],
  },
  {
    section: 'Jugador',
    fields: [
      { key: 'allowMove', label: 'Moverse (WASD)', type: 'checkbox' },
      { key: 'moveSpeed', label: 'Velocidad (m/s)', type: 'number', min: 0, max: 15, step: 0.1 },
    ],
  },
  {
    section: 'Sesión y visual',
    fields: [
      { key: 'duration', label: 'Duración (s)', type: 'number', min: 10, max: 600, step: 5 },
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
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof stored[k] === typeof DEFAULTS[k]) s[k] = stored[k];
    }
  } catch { /* storage no disponible o corrupto: defaults */ }
  if (!WEAPONS[s.weapon]) s.weapon = DEFAULTS.weapon;
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

/** FOV vertical tras aplicar un zoom (ratio de focales). */
export function zoomedVFovDeg(vDeg, zoom) {
  return toDeg(2 * Math.atan(Math.tan(toRad(vDeg) / 2) / zoom));
}

export function hFovFromV(vDeg, aspect) {
  return toDeg(2 * Math.atan(Math.tan(toRad(vDeg) / 2) * aspect));
}

// ---- Sensibilidad ----

/** Grados de giro por count de ratón en hipfire. */
export function hipDegPerCount(s) {
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
export function sensFactor(s, e, curVDeg, hipVDeg) {
  const mult = 1 + (s.adsMultiplier - 1) * e;
  const focal = s.adsScaling === 'focal'
    ? Math.tan(toRad(curVDeg) / 2) / Math.tan(toRad(hipVDeg) / 2)
    : 1;
  return mult * focal;
}
