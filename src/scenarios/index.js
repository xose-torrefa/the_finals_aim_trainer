// Registro de escenarios. Cada escenario vive en su archivo de esta carpeta y
// exporta por defecto su definición (guía en CONTRIBUTING.md):
//   key            clave estable: el historial (`clave@version`) y las rutinas la
//                  guardan. No se cambia nunca.
//   group          grupo del menú (`GROUPS`)
//   spheres        true si los objetivos son esferas (sin clase ni distancia en la ficha)
//   version        súbela si cambia la configuración efectiva (`fixed`, `RANKED_BASE`
//                  o la lógica de dificultad): el historial se separa por versión
//   fixed          ajustes que impone en modo Escenarios, sobre `RANKED_BASE`
//   distanceLabel  texto de la distancia, si no es `targetDistance`
//   score          cómo se muestra la puntuación (`SCORE_FORMATS`)
//   create(ctx)    crea la instancia (clases en base.js)
// Textos en i18n: `scenario.<clave>`, `scenario.<clave>.desc` y `group.<grupo>`.
import { weaponName } from '../weapons.js';
import { CLASSES } from '../target.js';
import { sanitizeSettings } from '../settings.js';
import { t, hasText } from '../i18n.js';
import basictrack from './basicfollow.js';
import tracking from './follow.js';
import closetrack from './closefollow.js';
import duel from './duel.js';
import switching from './switching.js';
import flick from './flick.js';
import aerial from './aerial.js';
import range from './range.js';
import peek from './peek.js';
import movetrack from './movefollow.js';
import gridshot from './gridshot.js';
import precision from './precision.js';
import airtrack from './airfollow.js';

export { createStats } from './base.js';

// Orden del menú. El archivo se llama como la clave, salvo "track" → "follow":
// algunos adblock bloquean las URL con "track" y, si falla un solo import, no
// carga nada de la app.
const LIST = [
  basictrack, tracking, closetrack, duel, switching, flick,
  aerial, range, peek, movetrack,
  gridshot, precision, airtrack,
];

const GROUPS = ['humanoids', 'situations', 'spheres'];

const SCORE_FORMATS = {
  percent: { formatScore: (x) => `${x.toFixed(1)}%`, formatTick: (v) => `${v}%` },
  kills: { formatScore: (x) => `${Number.isInteger(x) ? x : x.toFixed(1)} kills`, formatTick: (v) => String(v) },
};

// Configuración fija del modo Escenarios (con registro). Cada escenario la
// completa con su `fixed`. Si cambias la configuración efectiva de un escenario,
// sube su `version`: el historial se separa por versión.
// La mira no está aquí: es de cada jugador (Ajustes → Armas), como la sens o el FOV.
export const RANKED_BASE = {
  adsTimeOverride: 0,
  fireRate: 'weapon',
  targetClass: 'medium',
  targetDistance: 20,
  targetSpeed: 1,
  targetJumps: true,
  sphereScale: 1,
  allowMove: false,
  moveSpeed: 5,
  duration: 60,
};

/** Comprueba una definición: un error aquí sale en la consola nada más cargar. */
function check(def, seen) {
  const fail = (msg) => {
    throw new Error(`Scenario "${def?.key}": ${msg}`);
  };
  if (typeof def?.key !== 'string' || !/^[a-z][a-z0-9]*$/.test(def.key)) fail('key must be lowercase letters and digits');
  if (seen.has(def.key)) fail('duplicate key');
  if (!GROUPS.includes(def.group)) fail(`group must be one of ${GROUPS.join(', ')}`);
  if (!Number.isInteger(def.version) || def.version < 1) fail('version must be an integer >= 1');
  if (!Object.hasOwn(SCORE_FORMATS, def.score)) fail(`score must be one of ${Object.keys(SCORE_FORMATS).join(', ')}`);
  if (typeof def.create !== 'function') fail('create(ctx) is missing');
  // Mismo filtro que los ajustes guardados: tipo del default y, en los select, una de sus opciones
  const valid = sanitizeSettings(def.fixed ?? fail('fixed is missing'));
  for (const [k, v] of Object.entries(def.fixed)) {
    if (valid[k] !== v) fail(`fixed.${k} is not a valid setting value`);
  }
  for (const key of [`scenario.${def.key}`, `scenario.${def.key}.desc`]) {
    if (!hasText(key)) console.warn(`Scenario "${def.key}": missing text "${key}" in src/lang/en.js`);
  }
}

export const SCENARIOS = {};
for (const def of LIST) {
  check(def, new Set(Object.keys(SCENARIOS)));
  SCENARIOS[def.key] = { ...def, ...SCORE_FORMATS[def.score] };
}

/** Ajustes efectivos de una partida: en modo Escenarios se imponen los fijos. */
export function scenarioSettings(settings, key, ranked) {
  return ranked ? { ...settings, ...RANKED_BASE, ...SCENARIOS[key].fixed } : settings;
}

/** Configuración fija de un escenario en piezas legibles (arma, mira, clase…). */
export function fixedParts(key) {
  const def = SCENARIOS[key];
  const s = { ...RANKED_BASE, ...def.fixed };
  const parts = [weaponName(s.weapon, true)];
  if (!def.spheres) parts.push(CLASSES[s.targetClass].name, def.distanceLabel ?? `${s.targetDistance} m`);
  if (s.fireRate === 'free') parts.push(t('chip.freeFire'));
  if (s.allowMove) parts.push(t('chip.move'));
  parts.push(`${s.duration} s`);
  return parts;
}

export const scenarioName = (key) => t(`scenario.${key}`);
export const scenarioDesc = (key) => t(`scenario.${key}.desc`);
export const groupName = (group) => t(`group.${group}`);
