import { WEAPONS, SIGHTS } from './weapons.js';
import { SHOT_SOUNDS, HIT_SOUNDS } from './audio.js';

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

  // Sesión (Sandbox). `scenario` es el escenario elegido en Sandbox; en
  // Escenarios se juega el de la ficha abierta.
  scenario: 'tracking',
  weapon: 'ar',
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

/** Campos del formulario de un perfil de mira. */
function crosshairFields(prefix, showIf = () => true) {
  const k = (name) => prefix + name;
  const when = (flag) => (s) => showIf(s) && (!flag || s[k(flag)]);
  return [
    { key: k('Color'), label: 'Color de la mira', type: 'color', showIf: when() },
    { key: k('Opacity'), label: 'Opacidad', type: 'number', min: 0.05, max: 1, step: 0.05, showIf: when() },
    { key: k('Lines'), label: 'Líneas', type: 'checkbox', showIf: when() },
    { key: k('Length'), label: 'Longitud (px)', type: 'number', min: 1, max: 50, step: 1, showIf: when('Lines') },
    { key: k('Thickness'), label: 'Grosor (px)', type: 'number', min: 1, max: 10, step: 1, showIf: when('Lines') },
    { key: k('Gap'), label: 'Separación (px)', type: 'number', min: 0, max: 50, step: 1, showIf: when('Lines'), hint: 'Hueco entre el cruce central y cada línea.' },
    { key: k('TStyle'), label: 'Estilo T', type: 'checkbox', showIf: when('Lines'), hint: 'Sin la línea de arriba.' },
    { key: k('Dot'), label: 'Punto central', type: 'checkbox', showIf: when() },
    { key: k('DotSize'), label: 'Tamaño del punto (px)', type: 'number', min: 1, max: 16, step: 1, showIf: when('Dot') },
    { key: k('Outline'), label: 'Contorno', type: 'checkbox', showIf: when() },
    { key: k('OutlineWidth'), label: 'Grosor del contorno (px)', type: 'number', min: 1, max: 4, step: 1, showIf: when('Outline') },
    { key: k('OutlineOpacity'), label: 'Opacidad del contorno', type: 'number', min: 0.05, max: 1, step: 0.05, showIf: when('Outline') },
  ];
}

// Esquema que usa el menú para generar los formularios. `page` indica en qué
// página va cada sección: 'settings' (lo personal, se aplica en ambos modos) o
// 'sandbox' (solo en Sandbox; en Escenarios lo fija cada escenario). Las
// secciones con el mismo `tab` se muestran juntas en la página de Ajustes.
export const SETTINGS_SCHEMA = [
  {
    section: 'Sensibilidad',
    page: 'settings',
    fields: [
      { key: 'sensMode', label: 'Modo', type: 'select', options: [['finals', 'Sens de The Finals'], ['cm360', 'cm/360'], ['game', 'Sens × yaw personalizado']] },
      { key: 'dpi', label: 'DPI', type: 'number', min: 100, max: 32000, step: 50 },
      { key: 'cm360', label: 'cm/360 hipfire', type: 'number', min: 1, max: 300, step: 0.1, showIf: (s) => s.sensMode === 'cm360' },
      { key: 'gameSens', label: 'Sens del juego', type: 'number', min: 0.001, max: 100, step: 0.001, showIf: (s) => s.sensMode !== 'cm360' },
      { key: 'gameYaw', label: 'Yaw (°/count a sens 1)', type: 'number', min: 0.00001, max: 10, step: 0.00001, showIf: (s) => s.sensMode === 'game', hint: 'Constante del juego a convertir (The Finals = 0.001).' },
      { key: 'adsSensPct', label: 'Sensibilidad ADS (%)', type: 'number', min: 1, max: 500, step: 1 },
      { key: 'sniperSensPct', label: 'Sensibilidad francotirador (%)', type: 'number', min: 1, max: 500, step: 1, hint: 'En The Finals la mira del francotirador tiene su propio multiplicador.' },
      { key: 'focalScaling', label: 'Mouse Focal Length Sensitivity Scaling', type: 'checkbox', hint: 'ON: la sens de ADS además se reduce según el FOV de la mira (0% monitor distance).' },
      { key: 'useRawUpdate', label: 'pointerrawupdate', type: 'checkbox', hint: 'Menor latencia en Chromium. Desactívalo si notas saltos.' },
    ],
  },
  {
    section: 'FOV y ADS',
    page: 'settings',
    fields: [
      { key: 'fov', label: 'FOV', type: 'number', min: 30, max: 150, step: 1 },
      { key: 'fovType', label: 'Tipo de FOV', type: 'select', options: [['v', 'Vertical (The Finals)'], ['h16:9', 'Horizontal 16:9'], ['hActual', 'Horizontal (aspecto real)']] },
      { key: 'adsMode', label: 'ADS', type: 'select', options: [['hold', 'Mantener'], ['toggle', 'Alternar']] },
    ],
  },
  {
    section: 'Partida',
    page: 'settings',
    fields: [
      { key: 'countdown', label: 'Cuenta atrás (s)', type: 'number', min: 0, max: 10, step: 0.5, hint: 'Al empezar, al reiniciar y al volver de la pausa. 0 = sin cuenta atrás.' },
      { key: 'restartKey', label: 'Reiniciar escenario', type: 'key', hint: 'Reinicia la partida en curso, también desde la pausa y los resultados.' },
    ],
  },
  {
    section: 'Mira en hipfire',
    tab: 'Mira',
    page: 'settings',
    fields: crosshairFields('crosshair'),
  },
  {
    section: 'Mira en ADS',
    tab: 'Mira',
    page: 'settings',
    fields: [
      { key: 'adsCrosshair', label: 'Al hacer ADS', type: 'select', options: [['dot', 'La de hipfire sin líneas'], ['same', 'La misma que en hipfire'], ['custom', 'Una distinta']], hint: 'Cambia gradualmente con el progreso del ADS.' },
      ...crosshairFields('adsCrosshair', (s) => s.adsCrosshair === 'custom'),
    ],
  },
  {
    section: 'Arma y efectos',
    page: 'settings',
    fields: [
      { key: 'viewmodel', label: 'Mostrar el arma', type: 'checkbox', hint: 'Con visores (High y francotirador) se oculta al completar el ADS.' },
      { key: 'viewmodelFov', label: 'FOV del arma', type: 'number', min: 40, max: 100, step: 1, showIf: (s) => s.viewmodel, hint: 'Solo cambia el tamaño del arma en pantalla, no el FOV de la vista.' },
      { key: 'viewmodelSway', label: 'Inercia y balanceo del arma', type: 'checkbox', showIf: (s) => s.viewmodel },
      { key: 'muzzleFlash', label: 'Fogonazo', type: 'checkbox' },
      { key: 'tracers', label: 'Trazadoras', type: 'checkbox', hint: 'Solo visuales: la bala ya ha impactado en el centro de la mira.' },
      { key: 'tracerColor', label: 'Color de las trazadoras', type: 'color', showIf: (s) => s.tracers },
    ],
  },
  {
    section: 'Vídeo',
    page: 'settings',
    fields: [
      { key: 'renderScale', label: 'Escala de render', type: 'number', min: 0.25, max: 2, step: 0.05 },
      { key: 'showFps', label: 'Mostrar FPS', type: 'checkbox' },
    ],
  },
  {
    section: 'Audio',
    page: 'settings',
    fields: [
      { key: 'volume', label: 'Volumen general', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'shotSound', label: 'Sonido de disparo', type: 'select', options: SHOT_SOUNDS },
      { key: 'shotVolume', label: 'Volumen de disparos', type: 'number', min: 0, max: 1, step: 0.05, hint: '0 = silenciados.' },
      { key: 'hitSound', label: 'Sonido de impacto', type: 'select', options: HIT_SOUNDS },
      { key: 'hitVolume', label: 'Volumen de impactos', type: 'number', min: 0, max: 1, step: 0.05, hint: 'Cuerpo y headshot. 0 = silenciados.' },
      { key: 'killVolume', label: 'Volumen de eliminaciones', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'countdownVolume', label: 'Volumen de la cuenta atrás', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    section: 'Arma',
    page: 'sandbox',
    fields: [
      { key: 'weapon', label: 'Arma', type: 'select', options: Object.entries(WEAPONS).map(([k, w]) => [k, w.name]) },
      { key: 'sight', label: 'Mira', type: 'select', options: [['weapon', 'La del arma'], ...Object.entries(SIGHTS).map(([k, m]) => [k, m.name])] },
      { key: 'adsTimeOverride', label: 'Tiempo ADS ms (0 = arma)', type: 'number', min: 0, max: 2000, step: 10 },
    ],
  },
  {
    section: 'Objetivos',
    page: 'sandbox',
    fields: [
      { key: 'targetClass', label: 'Clase', type: 'select', options: [['light', 'Light (150 HP)'], ['medium', 'Medium (250 HP)'], ['heavy', 'Heavy (350 HP)'], ['random', 'Aleatoria']] },
      { key: 'targetDistance', label: 'Distancia (m)', type: 'number', min: 3, max: 120, step: 1 },
      { key: 'targetSpeed', label: 'Velocidad ×', type: 'number', min: 0, max: 3, step: 0.05 },
      { key: 'targetJumps', label: 'Saltos / dashes', type: 'checkbox' },
      { key: 'sphereScale', label: 'Tamaño esferas ×', type: 'number', min: 0.25, max: 4, step: 0.05 },
    ],
  },
  {
    section: 'Jugador y sesión',
    page: 'sandbox',
    fields: [
      { key: 'allowMove', label: 'Moverse (WASD)', type: 'checkbox' },
      { key: 'moveSpeed', label: 'Velocidad (m/s)', type: 'number', min: 0, max: 15, step: 0.1 },
      { key: 'duration', label: 'Duración (s)', type: 'number', min: 10, max: 600, step: 5 },
    ],
  },
];

/** Nombre legible de un `KeyboardEvent.code` ('KeyR' → 'R'). */
export function keyLabel(code) {
  return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}

export function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    OLD_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof stored[k] === typeof DEFAULTS[k]) s[k] = stored[k];
    }
  } catch { /* storage no disponible o corrupto: defaults */ }
  // Un valor guardado que ya no es una opción del desplegable vuelve al default
  for (const f of SETTINGS_SCHEMA.flatMap((g) => g.fields)) {
    if (f.type === 'select' && !f.options.some(([v]) => v === s[f.key])) s[f.key] = DEFAULTS[f.key];
  }
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
