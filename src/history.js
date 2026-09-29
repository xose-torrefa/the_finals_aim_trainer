// Historial de partidas del modo Escenarios. Se separa por escenario y por la
// `version` de su configuración fija: si cambia la configuración, las
// puntuaciones antiguas dejan de ser comparables y empiezan un historial nuevo.
const STORAGE_KEY = 'finals-aim.history.v1';
const MAX_ENTRIES = 500;

const historyKey = (key, def) => `${key}@${def.version}`;

function loadAll() {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

const isEntry = (e) => e && typeof e === 'object' && Number.isFinite(e.t) && Number.isFinite(e.score);

/** Partidas de un escenario, de la más antigua a la más reciente. */
export function getHistory(key, def) {
  const list = loadAll()[historyKey(key, def)];
  return Array.isArray(list) ? list.filter(isEntry) : [];
}

/**
 * Guarda una partida.
 * @param entry { t, score, accuracy, cm360, adsCm360, fov }
 * @returns la lista actualizada
 */
export function addEntry(key, def, entry) {
  const all = loadAll();
  const k = historyKey(key, def);
  const list = [...(Array.isArray(all[k]) ? all[k].filter(isEntry) : []), entry].slice(-MAX_ENTRIES);
  all[k] = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* storage lleno o bloqueado: la partida no se guarda */ }
  return list;
}
