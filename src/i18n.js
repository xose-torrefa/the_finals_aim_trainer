// Traducciones de la UI. Cada idioma es un diccionario plano en `lang/` con
// claves estables; los textos admiten parámetros con la forma `{nombre}`.
// Nada debe llamar a `t()` al cargar un módulo: el idioma puede cambiar en
// caliente y la UI se reconstruye leyendo las claves de nuevo.
import en from './lang/en.js';
import es from './lang/es.js';

export const LANGUAGES = [
  { code: 'en', name: 'English', locale: 'en-GB', dict: en },
  { code: 'es', name: 'Español', locale: 'es-ES', dict: es },
];

let current = LANGUAGES[0];

export function setLanguage(code) {
  current = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
  document.documentElement.lang = current.code;
}

/** Locale para `toLocaleString` del idioma actual. */
export const locale = () => current.locale;

/** Si existe el texto (en inglés, el diccionario de referencia). */
export const hasText = (key) => Object.hasOwn(en, key);

/** Texto traducido; si falta, el inglés y, si tampoco está, la propia clave. */
export function t(key, params) {
  const text = current.dict[key] ?? en[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (m, p) => (Object.hasOwn(params, p) ? String(params[p]) : m)) : text;
}
