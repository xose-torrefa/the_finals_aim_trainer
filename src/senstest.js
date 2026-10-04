// Test de sensibilidad guiado: el mismo escenario a varias sensibilidades
// alrededor de la actual, para ver con cuál se puntúa mejor. Hay dos tests
// independientes:
//  - 'ads': cambia solo el multiplicador de ADS; la de hipfire no se toca.
//  - 'hip': cambia la de hipfire y compensa los multiplicadores de ADS para que
//    el cm/360 de ADS no cambie. Se juega sin ADS.
// Las partidas son más cortas que las del escenario, así que no van al historial.
// `factor` multiplica la velocidad de giro: 1,2 = un 20 % más rápida (cm/360 / 1,2).
import { SETTINGS_SCHEMA } from './settings.js';

export const TEST_FACTORS = [0.8, 0.9, 1, 1.1, 1.2];
// Una partida por sensibilidad y la actual al principio y al final: da una idea
// del ruido entre partidas iguales y de si el jugador ha ido a más o a menos
const ORDER = [1, 0.8, 1.2, 0.9, 1.1, 1];
export const TEST_DURATION = 30; // s por partida: el test entero son unos 3 minutos y medio
const MIN_ADS = 0.8; // parte de la partida en ADS para que cuente en el test de ADS
export const MIN_RUNS = 5; // partidas válidas para ajustar la curva
const MIN_FACTORS = 4; // …de al menos estas sensibilidades distintas
const MIN_GAIN = 1; // puntos de % en objetivo: con tan pocas partidas el ruido estimado puede salir demasiado bajo
const SAME = 0.03; // un óptimo a menos del 3 % de la actual es "quédate como estás"
const STEP = 0.01; // resolución con la que se busca el óptimo

const FIELDS = new Map(SETTINGS_SCHEMA.flatMap((g) => g.fields).map((f) => [f.key, f]));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** @param kind 'ads' | 'hip' */
export function createSensTest(kind, key, s) {
  const sensKey = s.sensMode === 'cm360' ? 'cm360' : 'gameSens';
  return {
    kind,
    key,
    factors: ORDER,
    base: { sensKey, sens: s[sensKey], adsSensPct: s.adsSensPct, sniperSensPct: s.sniperSensPct },
  };
}

/** Ajustes de sensibilidad del test con la velocidad multiplicada por `factor` (sin redondear). */
export function sensValues(test, factor) {
  const b = test.base;
  if (test.kind === 'ads') return { adsSensPct: b.adsSensPct * factor };
  return {
    [b.sensKey]: b.sensKey === 'cm360' ? b.sens / factor : b.sens * factor,
    adsSensPct: b.adsSensPct / factor,
    sniperSensPct: b.sniperSensPct / factor,
  };
}

/** Lo mismo, ajustado al paso y al rango de cada ajuste, para guardarlo. */
export function sensSettings(test, factor) {
  return Object.fromEntries(Object.entries(sensValues(test, factor)).map(([k, v]) => {
    const f = FIELDS.get(k);
    const stepped = Math.round(v / f.step) * f.step;
    return [k, Number(Math.max(f.min, Math.min(f.max, stepped)).toFixed(5))];
  }));
}

/** En el test de ADS solo cuentan las partidas jugadas en ADS. */
export const validRun = (test, r) => test.kind !== 'ads' || r.adsShare >= MIN_ADS;

/** Resuelve un sistema lineal 3×3 por eliminación de Gauss (null si es singular). */
function solve3(m, v) {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = a[r][c] / a[c][c];
      for (let j = c; j < 4; j++) a[r][j] -= k * a[c][j];
    }
  }
  return a.map((row, i) => row[3] / row[i]);
}

/**
 * Resultado del test.
 * @param results [{ factor, score, mismatchPct, adsShare, cm }] por paso (con huecos si no se ha jugado)
 * @returns {{ rows, done, total, invalid, baseCm, fit }}
 *   rows: por sensibilidad, { factor, scores, avg, mismatch }
 *   baseCm: cm/360 de la sensibilidad actual (la que se prueba: ADS o hipfire)
 *   fit: null si faltan partidas, o { factor, gain, noise, clear, edge, same }: el
 *     óptimo de una parábola ajustada a todas las partidas (puntuación frente a
 *     log de la velocidad), cuánto se ganaría respecto a la actual y el ruido
 *     entre partidas (desviación de los residuos)
 */
export function analyzeSensTest(test, results) {
  const played = results.filter(Boolean);
  const runs = played.filter((r) => validRun(test, r));
  const rows = TEST_FACTORS.map((factor) => {
    const rs = runs.filter((r) => r.factor === factor);
    const mis = rs.map((r) => r.mismatchPct).filter(Number.isFinite);
    return { factor, scores: rs.map((r) => r.score), avg: rs.length ? mean(rs.map((r) => r.score)) : null, mismatch: mis.length ? mean(mis) : null };
  });
  const out = {
    rows,
    done: played.length,
    total: test.factors.length,
    invalid: played.length - runs.length,
    baseCm: runs.length ? runs[0].cm * runs[0].factor : null,
    fit: null,
  };
  if (runs.length < MIN_RUNS || rows.filter((r) => r.avg !== null).length < MIN_FACTORS) return out;

  // Mínimos cuadrados de y = a + b·x + c·x², con x = ln(factor)
  const xs = runs.map((r) => Math.log(r.factor));
  const ys = runs.map((r) => r.score);
  const sum = (fn) => xs.reduce((acc, x, i) => acc + fn(x, ys[i]), 0);
  const coef = solve3([
    [runs.length, sum((x) => x), sum((x) => x * x)],
    [sum((x) => x), sum((x) => x * x), sum((x) => x ** 3)],
    [sum((x) => x * x), sum((x) => x ** 3), sum((x) => x ** 4)],
  ], [sum((x, y) => y), sum((x, y) => x * y), sum((x, y) => x * x * y)]);
  if (!coef) return out;
  const curve = (factor) => {
    const x = Math.log(factor);
    return coef[0] + coef[1] * x + coef[2] * x * x;
  };
  const lo = TEST_FACTORS[0];
  const hi = TEST_FACTORS.at(-1);
  let best = 1;
  for (let f = lo; f <= hi + 1e-9; f += STEP) if (curve(f) > curve(best)) best = Math.round(f * 100) / 100;
  const noise = Math.sqrt(sum((x, y) => (y - (coef[0] + coef[1] * x + coef[2] * x * x)) ** 2) / (runs.length - 3));
  const gain = curve(best) - curve(1);
  const same = Math.abs(best - 1) < SAME;
  out.fit = { factor: best, gain, noise, same, clear: !same && gain >= Math.max(noise, MIN_GAIN), edge: best <= lo || best >= hi };
  return out;
}
