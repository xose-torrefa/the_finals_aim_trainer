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

export const RECENT = 10;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Compara una partida (por su fecha `t`) con las anteriores del mismo escenario.
 * @returns { best, avg, n }: récord previo, media de las últimas RECENT y cuántas son (null si no hay)
 */
export function compareToPrevious(entries, t) {
  const prev = entries.filter((e) => e.t < t);
  const recent = prev.slice(-RECENT).map((e) => e.score);
  return {
    best: prev.length ? Math.max(...prev.map((e) => e.score)) : null,
    avg: recent.length ? mean(recent) : null,
    n: recent.length,
  };
}

/** Tendencia: media de las últimas partidas frente a las anteriores, en % (null si hay pocas). */
export function trend(entries) {
  const n = Math.min(RECENT, Math.floor(entries.length / 2));
  if (n < 3) return null;
  const last = mean(entries.slice(-n).map((e) => e.score));
  const before = mean(entries.slice(-2 * n, -n).map((e) => e.score));
  return before > 0 ? { pct: (100 * (last - before)) / before, n } : null;
}

const dayKey = (time) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Constancia en todos los escenarios: partidas de hoy y días seguidos jugando (hasta hoy o ayer). */
export function activity(now = Date.now()) {
  const days = new Set();
  const todayKey = dayKey(now);
  let today = 0;
  for (const list of Object.values(loadAll())) {
    if (!Array.isArray(list)) continue;
    for (const e of list.filter(isEntry)) {
      const k = dayKey(e.t);
      days.add(k);
      if (k === todayKey) today++;
    }
  }
  const d = new Date(now);
  if (!days.has(todayKey)) d.setDate(d.getDate() - 1); // la racha sigue viva si hoy aún no has jugado
  let streak = 0;
  while (days.has(dayKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return { today, streak };
}
