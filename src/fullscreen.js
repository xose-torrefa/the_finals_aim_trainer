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

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

/** Llama a `fn` al entrar o salir de pantalla completa (con F11 solo llega un resize). */
export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  window.addEventListener('resize', fn);
}
