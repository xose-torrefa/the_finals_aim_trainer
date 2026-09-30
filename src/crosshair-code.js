// Código de mira para compartirla: texto corto que se copia y se pega.
// Formato v1: `FA1;<modo ADS>;<perfil hipfire>[;<perfil ADS>]`, con el perfil
// de ADS solo si el modo es 'custom'. Cada perfil son los campos de CODE_FIELDS
// en ese orden, separados por ';'. El orden es fijo: si cambian los campos de
// la mira, se crea un formato nuevo (FA2) y se sigue leyendo el FA1.
import { DEFAULTS, SETTINGS_SCHEMA } from './settings.js';

const PREFIX = 'FA1';
const ADS_MODES = { D: 'dot', S: 'same', C: 'custom' };

// Opacidades en % entero para que el código quede más corto
const color = { enc: (v) => v.slice(1).toLowerCase(), dec: (x) => (/^[0-9a-f]{6}$/i.test(x) ? `#${x.toLowerCase()}` : null) };
const bool = { enc: (v) => (v ? '1' : '0'), dec: (x) => (x === '1' ? true : x === '0' ? false : null) };
const int = { enc: (v) => String(Math.round(v)), dec: (x) => (/^\d+$/.test(x) ? Number(x) : null) };
const pct = { enc: (v) => String(Math.round(v * 100)), dec: (x) => (/^\d+$/.test(x) ? Number(x) / 100 : null) };

const CODE_FIELDS = [
  ['Color', color],
  ['Opacity', pct],
  ['Lines', bool],
  ['Length', int],
  ['Thickness', int],
  ['Gap', int],
  ['TStyle', bool],
  ['Dot', bool],
  ['DotSize', int],
  ['Outline', bool],
  ['OutlineWidth', int],
  ['OutlineOpacity', pct],
];

const RANGES = new Map(SETTINGS_SCHEMA.flatMap((g) => g.fields).filter((f) => f.type === 'number').map((f) => [f.key, f]));

/** Código de la mira actual (los dos perfiles y qué se ve en ADS). */
export function encodeCrosshair(s) {
  const profile = (prefix) => CODE_FIELDS.map(([k, c]) => c.enc(s[prefix + k]));
  const mode = Object.keys(ADS_MODES).find((m) => ADS_MODES[m] === s.adsCrosshair);
  return [PREFIX, mode, ...profile('crosshair'), ...(s.adsCrosshair === 'custom' ? profile('adsCrosshair') : [])].join(';');
}

/**
 * Ajustes de mira a partir de un código, o null si no es válido. Los números
 * fuera de rango se ajustan al rango del esquema. Si el modo de ADS no es
 * 'custom', no se tocan los ajustes del perfil de ADS.
 */
export function decodeCrosshair(code) {
  const parts = String(code).trim().split(';');
  if (parts[0].toUpperCase() !== PREFIX) return null;
  const adsCrosshair = ADS_MODES[parts[1]?.toUpperCase()];
  if (!adsCrosshair) return null;
  const profiles = adsCrosshair === 'custom' ? ['crosshair', 'adsCrosshair'] : ['crosshair'];
  if (parts.length !== 2 + profiles.length * CODE_FIELDS.length) return null;

  const values = { adsCrosshair };
  let i = 2;
  for (const prefix of profiles) {
    for (const [k, c] of CODE_FIELDS) {
      const key = prefix + k;
      let v = c.dec(parts[i++].trim());
      if (v === null || typeof v !== typeof DEFAULTS[key]) return null;
      const f = RANGES.get(key);
      if (f) v = Math.min(f.max, Math.max(f.min, v));
      values[key] = v;
    }
  }
  return values;
}
