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

const HISTORY_KEY = /^[\w-]+@\d+$/;
const ENTRY_FIELDS = ['t', 'score', 'accuracy', 'cm360', 'adsCm360', 'fov'];

/** Todo el historial, para la copia de seguridad. */
export function exportHistory() {
  return loadAll();
}

/**
 * Añade al historial las partidas de una copia de seguridad. Las que ya
 * están (misma fecha en el mismo escenario@versión) no se duplican.
 * @returns { added, skipped }
 */
export function mergeHistory(incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('history');
  const all = loadAll();
  let added = 0;
  let skipped = 0;
  for (const [k, list] of Object.entries(incoming)) {
    if (!HISTORY_KEY.test(k) || !Array.isArray(list)) continue;
    const current = Array.isArray(all[k]) ? all[k].filter(isEntry) : [];
    const seen = new Set(current.map((e) => e.t));
    for (const raw of list.filter(isEntry)) {
      if (seen.has(raw.t)) {
        skipped++;
        continue;
      }
      // Solo los campos conocidos y numéricos (accuracy puede ser null)
      const e = {};
      for (const f of ENTRY_FIELDS) if (Number.isFinite(raw[f])) e[f] = raw[f];
      if (raw.accuracy === null) e.accuracy = null;
      current.push(e);
      seen.add(e.t);
      added++;
    }
    all[k] = current.sort((a, b) => a.t - b.t).slice(-MAX_ENTRIES);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return { added, skipped };
}
