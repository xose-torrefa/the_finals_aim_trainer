// Rutinas: listas de escenarios (modo Escenarios) que se juegan seguidos, con
// un resumen al final. Hay rutinas predefinidas (textos en i18n:
// `routine.<id>` y `routine.<id>.desc`) y rutinas propias guardadas aquí.
import { SCENARIOS } from './scenarios.js';
import { t } from './i18n.js';

const STORAGE_KEY = 'finals-aim.routines.v1';
export const MAX_STEPS = 20;
export const MAX_NAME = 40;

export const BUILTIN_ROUTINES = [
  { id: 'warmup', steps: ['tracking', 'flick', 'precision', 'switching', 'peek'] },
  { id: 'tracking', steps: ['basictrack', 'closetrack', 'tracking', 'aerial', 'range', 'airtrack', 'movetrack'] },
  { id: 'flicks', steps: ['flick', 'precision', 'gridshot', 'switching', 'peek'] },
].map((r) => ({ ...r, builtin: true }));

export const routineName = (r) => (r.builtin ? t(`routine.${r.id}`) : r.name);

/** Rutina propia válida (o null): nombre, id y pasos que existen. */
function sanitize(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^c[\w-]{1,40}$/.test(r.id)) return null;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_NAME) : '';
  const steps = Array.isArray(r.steps) ? r.steps.filter((k) => Object.hasOwn(SCENARIOS, k)).slice(0, MAX_STEPS) : [];
  return name && steps.length ? { id: r.id, name, steps } : null;
}

export function loadCustomRoutines() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(list) ? list.map(sanitize).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveCustomRoutines(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* ignorar */ }
}

export const allRoutines = () => [...BUILTIN_ROUTINES, ...loadCustomRoutines()];
export const findRoutine = (id) => allRoutines().find((r) => r.id === id) ?? null;

export const newRoutineId = () => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Crea o sustituye una rutina propia. Devuelve false si no es válida. */
export function saveRoutine(r) {
  const clean = sanitize(r);
  if (!clean) return false;
  const list = loadCustomRoutines();
  const i = list.findIndex((x) => x.id === clean.id);
  if (i >= 0) list[i] = clean;
  else list.push(clean);
  saveCustomRoutines(list);
  return true;
}

export function deleteRoutine(id) {
  saveCustomRoutines(loadCustomRoutines().filter((r) => r.id !== id));
}

/** Añade o sustituye (mismo id) las rutinas de una copia de seguridad. Devuelve cuántas. */
export function mergeRoutines(incoming) {
  if (!Array.isArray(incoming)) return 0;
  const list = loadCustomRoutines();
  let n = 0;
  for (const r of incoming.map(sanitize).filter(Boolean)) {
    const i = list.findIndex((x) => x.id === r.id);
    if (i >= 0) list[i] = r;
    else list.push(r);
    n++;
  }
  saveCustomRoutines(list);
  return n;
}
