// Se llama display.js y no fullscreen.js porque algunos bloqueadores de anuncios
// bloquean las URLs que contienen "fullscreen" y, sin este módulo, no carga ninguno.

// Pantalla completa. El FOV es vertical, así que el horizontal depende de la
// proporción del lienzo: la vista solo coincide con la del juego si el lienzo
// ocupa toda la pantalla (sin barras ni pestañas del navegador).

/** El navegador deja usar la Fullscreen API (no, p. ej., dentro de un iframe sin permiso). */
export const canFullscreen = () => Boolean(document.fullscreenEnabled);

/** Pantalla completa por la API o la del navegador (F11), que la API no detecta. */
export function isFullscreen() {
  if (document.fullscreenElement) return true;
  if (matchMedia('(display-mode: fullscreen)').matches) return true;
  return screen.width - window.innerWidth <= 1 && screen.height - window.innerHeight <= 1;
}

/**
 * Con la Fullscreen API, Chrome sale de la pantalla completa con Esc, y Esc es la pausa.
 * La Keyboard Lock (solo Chromium) le pasa un Esc corto a la página; para salir de la
 * pantalla completa hay que mantenerlo pulsado, igual que con F11 solo se suelta el ratón.
 */
export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      navigator.keyboard?.unlock();
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await navigator.keyboard?.lock(['Escape']);
    }
  } catch { /* el navegador lo ha rechazado: se queda como estaba */ }
}

/** Llama a `fn` al entrar o salir de pantalla completa (con F11 solo llega un resize). */
export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  window.addEventListener('resize', fn);
}
