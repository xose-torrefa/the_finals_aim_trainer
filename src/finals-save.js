// Lector del fichero de opciones de The Finals:
//   %LOCALAPPDATA%\Discovery\Saved\SaveGames\EmbarkOptionSaveGame.sav
// Es un save GVAS de Unreal Engine; las opciones se guardan como pares de
// FString (int32 longitud con el \0 incluido + texto + \0), clave y valor en texto.
// Solo se lee en el navegador: nunca se modifica ni se envía a ningún sitio.
import { SETTINGS_SCHEMA } from './settings.js';

export const SAVE_PATH = '%LOCALAPPDATA%\\Discovery\\Saved\\SaveGames';
const MAX_SIZE = 1024 * 1024;
const MAX_STRING = 1024;
const PREFIX = 'GameplayOption.';

/** Lee un FString en `o`. Devuelve [texto, siguiente offset] o null si no hay uno válido. */
function readFString(view, bytes, o) {
  if (o + 4 > bytes.length) return null;
  const n = view.getInt32(o, true);
  if (n > 1 && n <= MAX_STRING) {
    const end = o + 4 + n;
    if (end > bytes.length || bytes[end - 1] !== 0) return null;
    let s = '';
    for (let i = o + 4; i < end - 1; i++) {
      const c = bytes[i];
      if (c < 0x20 || c > 0x7e) return null;
      s += String.fromCharCode(c);
    }
    return [s, end];
  }
  if (n < -1 && n >= -MAX_STRING) {
    // UTF-16LE (Unreal usa longitud negativa para cadenas no ASCII)
    const end = o + 4 - n * 2;
    if (end > bytes.length || bytes[end - 1] !== 0 || bytes[end - 2] !== 0) return null;
    let s = '';
    for (let i = o + 4; i < end - 2; i += 2) s += String.fromCharCode(view.getUint16(i, true));
    return [s, end];
  }
  return null;
}

/** Devuelve un Map con todas las opciones `GameplayOption.*` del save. */
export function parseFinalsSave(buffer) {
  if (buffer.byteLength > MAX_SIZE) throw new Error('El archivo es demasiado grande para ser el de opciones.');
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'GVAS') throw new Error('No es un save de Unreal Engine (falta la cabecera GVAS).');

  const options = new Map();
  for (let o = 4; o < bytes.length - 8;) {
    const key = readFString(view, bytes, o);
    if (key && key[0].startsWith(PREFIX)) {
      const value = readFString(view, bytes, key[1]);
      if (value) {
        options.set(key[0], value[0]);
        o = value[1];
        continue;
      }
    }
    o++;
  }
  if (!options.size) throw new Error('No se han encontrado opciones de The Finals en el archivo.');
  return options;
}

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
const pct = (v) => {
  const x = num(v);
  return x === undefined ? undefined : Math.round(x * 10000) / 100;
};
const bool = (v) => (v === 'true' ? true : v === 'false' ? false : undefined);

const MAPPING = [
  { key: 'Controls.MouseSensitivity', setting: 'gameSens', parse: num },
  { key: 'Camera.FOV', setting: 'fov', parse: num },
  { key: 'Controls.MouseZoomSensitivity', setting: 'adsSensPct', parse: pct },
  { key: 'Controls.MouseScopedZoomSensitivity', setting: 'sniperSensPct', parse: pct },
  { key: 'Controls.Mouse.FocalLengthSensitivityScaling', setting: 'focalScaling', parse: bool },
];

function crosshairColor(options) {
  const get = (k) => options.get(PREFIX + k);
  for (const base of ['Crosshair.StaticReticle', 'Crosshair.Center']) {
    if (get(`${base}.Enabled`) !== 'true') continue;
    const rgb = ['Red', 'Green', 'Blue'].map((c) => num(get(`${base}.Color.${c}`)));
    if (rgb.some((c) => c === undefined || c < 0 || c > 255)) continue;
    return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
  }
  return undefined;
}

const FIELDS = new Map(SETTINGS_SCHEMA.flatMap((g) => g.fields).map((f) => [f.key, f]));

/**
 * Traduce las opciones del juego a ajustes del trainer.
 * @returns {{ values: object, skipped: string[] }}
 */
export function settingsFromFinalsSave(options) {
  const values = {};
  const skipped = [];
  for (const m of MAPPING) {
    const raw = options.get(PREFIX + m.key);
    if (raw === undefined) continue;
    const v = m.parse(raw);
    const f = FIELDS.get(m.setting);
    const inRange = typeof v !== 'number' || (v >= f.min && v <= f.max);
    if (v === undefined || !inRange) {
      skipped.push(`${m.key} = ${raw}`);
      continue;
    }
    values[m.setting] = v;
  }
  // El FOV del juego es vertical y la sens usa el yaw de The Finals
  if ('gameSens' in values) values.sensMode = 'finals';
  if ('fov' in values) values.fovType = 'v';
  const color = crosshairColor(options);
  if (color) values.crosshairColor = color;
  return { values, skipped };
}
