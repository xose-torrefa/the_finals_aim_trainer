import { WEAPONS, sightKey } from './weapons.js';
import { SHOT_SOUNDS, HIT_SOUNDS } from './audio.js';
import { LANGUAGES } from './i18n.js';

export const DEG = Math.PI / 180;
// v2: modo de sens de The Finals y sens de ADS en %. Los ajustes v1 se descartan.
const STORAGE_KEY = 'finals-aim.settings.v2';
const OLD_STORAGE_KEYS = ['finals-aim.settings.v1'];

// Grados por count a sens 1 en The Finals (sens 47 @ 400 DPI = 48,638 cm/360).
export const FINALS_YAW = 0.001;

// Ajustes de una mira; cada perfil los guarda con su prefijo ('crosshair',
// 'adsCrosshair'). La separación se mide desde el cruce central, sin el grosor.
const CROSSHAIR_HIP = {
  Color: '#00ff88',
  Opacity: 1,
  Lines: true,
  Length: 8,
  Thickness: 2,
  Gap: 4,
  TStyle: false,
  Dot: true,
  DotSize: 4,
  Outline: true,
  OutlineWidth: 1,
  OutlineOpacity: 0.6,
};
const CROSSHAIR_ADS = { ...CROSSHAIR_HIP, Length: 5, Gap: 2, DotSize: 2 };
export const CROSSHAIR_KEYS = Object.keys(CROSSHAIR_HIP);

const prefixed = (prefix, o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [prefix + k, v]));

export const DEFAULTS = {
  // Idioma de la UI (ver i18n.js)
  language: 'en',

  // Sensibilidad
  sensMode: 'finals',
  dpi: 800,
  cm360: 38.1, // lo mismo que sens 30 @ 800 DPI en The Finals
  gameSens: 30,
  gameYaw: FINALS_YAW,
  adsSensPct: 100,
  sniperSensPct: 100,
  focalScaling: true,
  useRawUpdate: true,

  // FOV / ADS
  fov: 100,
  fovType: 'v', // The Finals usa FOV vertical (verificado midiendo en el juego)
  adsMode: 'hold',
  adsTimeOverride: 0,

  // Armas: mira elegida para cada una (`sightAr`, `sightSmg`…). Decide el FOV
  // de ADS en ambos modos. Por defecto, la primera de `sights` (la del arma).
  ...Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [sightKey(k), Object.keys(w.sights)[0]])),

  // Sesión (Sandbox). `scenario` es el escenario elegido en Sandbox; en
  // Escenarios se juega el de la ficha abierta.
  scenario: 'tracking',
  weapon: 'ar',
  // Cadencia: 'weapon' = los rpm del arma; 'free' = cada clic dispara al momento
  // (para entrenar puntería sin simular el arma; mantener pulsado sigue a los rpm)
  fireRate: 'weapon',
  duration: 60,

  // Partida
  countdown: 3,
  restartKey: 'KeyR',

  // Objetivos
  targetClass: 'medium',
  targetDistance: 20,
  targetSpeed: 1,
  targetJumps: true,
  sphereScale: 1,

  // Jugador
  allowMove: true,
  moveSpeed: 5,

  // Mira. adsCrosshair: 'dot' (la de hipfire sin líneas), 'same' o 'custom'
  ...prefixed('crosshair', CROSSHAIR_HIP),
  adsCrosshair: 'dot',
  ...prefixed('adsCrosshair', CROSSHAIR_ADS),

  // Arma en pantalla y efectos
  viewmodel: true,
  viewmodelFov: 60,
  viewmodelSway: true,
  muzzleFlash: true,
  tracers: true,
  tracerColor: '#ffc860',

  // Vídeo
  showFps: true,
  renderScale: 1,

  // Audio: volumen general × el de cada categoría
  volume: 0.4,
  shotSound: 'punch',
  shotVolume: 1,
  hitSound: 'blip',
  hitVolume: 1,
  killVolume: 1,
  countdownVolume: 1,
};

/** Campos del formulario de un perfil de mira. Los dos perfiles comparten textos (`field.ch*`). */
function crosshairFields(prefix, showIf = () => true) {
  const k = (name) => prefix + name;
  const when = (flag) => (s) => showIf(s) && (!flag || s[k(flag)]);
  const field = (name, props, flag) => ({ key: k(name), text: `ch${name}`, showIf: when(flag), ...props });
  return [
    field('Color', { type: 'color' }),
    field('Opacity', { type: 'number', min: 0.05, max: 1, step: 0.05 }),
    field('Lines', { type: 'checkbox' }),
    field('Length', { type: 'number', min: 1, max: 50, step: 1 }, 'Lines'),
    field('Thickness', { type: 'number', min: 1, max: 10, step: 1 }, 'Lines'),
    field('Gap', { type: 'number', min: 0, max: 50, step: 1 }, 'Lines'),
    field('TStyle', { type: 'checkbox' }, 'Lines'),
    field('Dot', { type: 'checkbox' }),
    field('DotSize', { type: 'number', min: 1, max: 16, step: 1 }, 'Dot'),
    field('Outline', { type: 'checkbox' }),
    field('OutlineWidth', { type: 'number', min: 1, max: 4, step: 1 }, 'Outline'),
    field('OutlineOpacity', { type: 'number', min: 0.05, max: 1, step: 0.05 }, 'Outline'),
  ];
}

/** Opciones `[valor, clave de texto]` de un desplegable con textos `<prefijo>.<valor>`. */
const opts = (prefix, values) => values.map((v) => [v, `${prefix}.${v}`]);

// Esquema que usa el menú para generar los formularios. `page` indica en qué
// página va cada sección: 'settings' (lo personal, se aplica en ambos modos) o
// 'sandbox' (solo en Sandbox; en Escenarios lo fija cada escenario). Las
// secciones con el mismo `tab` se muestran juntas en la página de Ajustes.
// Los textos salen de i18n: `section.<id>` para secciones y pestañas,
// `field.<text ?? key>` (o `label`) y `<…>.hint` para los campos, y las opciones son
// pares `[valor, clave de texto]`.
export const SETTINGS_SCHEMA = [
  {
    section: 'sensitivity',
    page: 'settings',
    fields: [
      { key: 'sensMode', type: 'select', options: opts('sensMode', ['finals', 'cm360', 'game']) },
      { key: 'dpi', type: 'number', min: 100, max: 32000, step: 50 },
      { key: 'cm360', type: 'number', min: 1, max: 300, step: 0.1, showIf: (s) => s.sensMode === 'cm360' },
      { key: 'gameSens', type: 'number', min: 0.001, max: 100, step: 0.001, showIf: (s) => s.sensMode !== 'cm360' },
      { key: 'gameYaw', type: 'number', min: 0.00001, max: 10, step: 0.00001, showIf: (s) => s.sensMode === 'game' },
      { key: 'adsSensPct', type: 'number', min: 1, max: 500, step: 1 },
      { key: 'sniperSensPct', type: 'number', min: 1, max: 500, step: 1 },
      { key: 'focalScaling', type: 'checkbox' },
      { key: 'useRawUpdate', type: 'checkbox' },
    ],
  },
  {
    section: 'fovAds',
    page: 'settings',
    fields: [
      { key: 'fov', type: 'number', min: 30, max: 150, step: 1 },
      { key: 'fovType', type: 'select', options: opts('fovType', ['v', 'h16:9', 'hActual']) },
      { key: 'adsMode', type: 'select', options: opts('adsMode', ['hold', 'toggle']) },
    ],
  },
  {
    section: 'loadout',
    page: 'settings',
    // `label`: clave de texto completa en vez de `field.<key>`
    fields: Object.entries(WEAPONS).map(([k, w]) => ({
      key: sightKey(k), label: `weapon.${k}`, type: 'select', options: opts('sight', Object.keys(w.sights)),
    })),
  },
  {
    section: 'game',
    page: 'settings',
    fields: [
      { key: 'countdown', type: 'number', min: 0, max: 10, step: 0.5 },
      { key: 'restartKey', type: 'key' },
    ],
  },
  {
    section: 'crosshairHip',
    tab: 'crosshair',
    page: 'settings',
    fields: crosshairFields('crosshair'),
  },
  {
    section: 'crosshairAds',
    tab: 'crosshair',
    page: 'settings',
    fields: [
      { key: 'adsCrosshair', type: 'select', options: opts('adsCrosshair', ['dot', 'same', 'custom']) },
      ...crosshairFields('adsCrosshair', (s) => s.adsCrosshair === 'custom'),
    ],
  },
  {
    section: 'weaponFx',
    page: 'settings',
    fields: [
      { key: 'viewmodel', type: 'checkbox' },
      { key: 'viewmodelFov', type: 'number', min: 40, max: 100, step: 1, showIf: (s) => s.viewmodel },
      { key: 'viewmodelSway', type: 'checkbox', showIf: (s) => s.viewmodel },
      { key: 'muzzleFlash', type: 'checkbox' },
      { key: 'tracers', type: 'checkbox' },
      { key: 'tracerColor', type: 'color', showIf: (s) => s.tracers },
    ],
  },
  {
    section: 'video',
    page: 'settings',
    fields: [
      { key: 'renderScale', type: 'number', min: 0.25, max: 2, step: 0.05 },
      { key: 'showFps', type: 'checkbox' },
    ],
  },
  {
    section: 'audio',
    page: 'settings',
    fields: [
      { key: 'volume', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'shotSound', type: 'select', options: opts('sound', SHOT_SOUNDS) },
      { key: 'shotVolume', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'hitSound', type: 'select', options: opts('sound', HIT_SOUNDS) },
      { key: 'hitVolume', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'killVolume', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'countdownVolume', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    section: 'weapon',
    page: 'sandbox',
    fields: [
      { key: 'weapon', type: 'select', options: opts('weapon', Object.keys(WEAPONS)) },
      { key: 'fireRate', type: 'select', options: opts('fireRate', ['weapon', 'free']) },
      { key: 'adsTimeOverride', type: 'number', min: 0, max: 2000, step: 10 },
    ],
  },
  {
    section: 'targets',
    page: 'sandbox',
    fields: [
      { key: 'targetClass', type: 'select', options: opts('targetClass', ['light', 'medium', 'heavy', 'random']) },
      { key: 'targetDistance', type: 'number', min: 3, max: 120, step: 1 },
      { key: 'targetSpeed', type: 'number', min: 0, max: 3, step: 0.05 },
      { key: 'targetJumps', type: 'checkbox' },
      { key: 'sphereScale', type: 'number', min: 0.25, max: 4, step: 0.05 },
    ],
  },
  {
    section: 'player',
    page: 'sandbox',
    fields: [
      { key: 'allowMove', type: 'checkbox' },
      { key: 'moveSpeed', type: 'number', min: 0, max: 15, step: 0.1 },
      { key: 'duration', type: 'number', min: 10, max: 600, step: 5 },
    ],
  },
];

/** Clave de texto de un campo del esquema (su pista es la misma + '.hint'). */
export const fieldText = (f) => f.label ?? `field.${f.text ?? f.key}`;

/** Nombre legible de un `KeyboardEvent.code` ('KeyR' → 'R'). */
export function keyLabel(code) {
  return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}

/**
 * Ajustes completos a partir de unos guardados (localStorage o copia de
 * seguridad): solo se aceptan valores del mismo tipo que el default y, en los
 * desplegables, que sigan siendo una de las opciones.
 */
export function sanitizeSettings(stored) {
  const s = { ...DEFAULTS };
  if (stored && typeof stored === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof stored[k] === typeof DEFAULTS[k]) s[k] = stored[k];
    }
  }
  for (const f of SETTINGS_SCHEMA.flatMap((g) => g.fields)) {
    if (f.type === 'select' && !f.options.some(([v]) => v === s[f.key])) s[f.key] = DEFAULTS[f.key];
  }
  if (!LANGUAGES.some((l) => l.code === s.language)) s.language = DEFAULTS.language;
  return s;
}

export function loadSettings() {
  let stored = null;
  try {
    OLD_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch { /* storage no disponible o corrupto: defaults */ }
  return sanitizeSettings(stored);
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
