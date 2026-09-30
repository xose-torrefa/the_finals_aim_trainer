import { h } from './dom.js';
import { t } from './i18n.js';
import { canFullscreen, isFullscreen, toggleFullscreen, onFullscreenChange } from './fullscreen.js';

// Capa sobre la escena durante una partida: "clic para empezar", cuenta atrás
// y menú de pausa. El menú completo (menu.js) solo se abre fuera de la partida
// o al ir a Ajustes desde la pausa.
export class Overlay {
  /**
   * @param handlers { onStart(), onResume(), onRestart(), onSettings(), onQuit() }
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.count = null;
    this.message = h('p', { class: 'message' });
    this.fsTip = null;
    onFullscreenChange(() => this.fsTip?.classList.toggle('hidden', isFullscreen()));
  }

  /** Partida preparada: espera un clic (gesto necesario para capturar el ratón). */
  showReady({ name, mode, restartKey }) {
    this.message.textContent = '';
    this.fsTip = h('div', { class: `fs-tip${isFullscreen() ? ' hidden' : ''}` },
      h('p', { class: 'keys' }, t('overlay.fullscreen')),
      canFullscreen() && h('button', {
        onclick: (e) => {
          e.stopPropagation();
          toggleFullscreen();
        },
      }, t('fullscreen.enter')));
    this.show('ready', h('div', { class: 'ov-card' },
      h('span', { class: 'eyebrow' }, mode),
      h('h1', {}, name),
      h('p', { class: 'ov-cta' }, t('overlay.cta')),
      h('p', { class: 'keys' }, t('overlay.keys', { key: restartKey })),
      this.message,
      this.fsTip,
      h('button', {
        class: 'link',
        onclick: (e) => {
          e.stopPropagation();
          this.handlers.onQuit();
        },
      }, t('overlay.back'))));
    this.root.onclick = () => this.handlers.onStart();
  }

  showCountdown() {
    this.count = h('div', { class: 'count' });
    this.show('countdown', this.count);
  }

  /** Número de la cuenta atrás; reinicia la animación en cada cambio. */
  setCount(n) {
    if (this.count.textContent === String(n)) return;
    this.count.textContent = String(n);
    this.count.classList.remove('pop');
    void this.count.offsetWidth;
    this.count.classList.add('pop');
  }

  showPause({ name, restartKey }) {
    this.message.textContent = '';
    const btn = (label, fn, cls = '') => h('button', { class: cls, onclick: fn }, label);
    this.show('pause', h('div', { class: 'ov-card' },
      h('span', { class: 'eyebrow' }, t('overlay.paused')),
      h('h1', {}, name),
      h('div', { class: 'ov-actions' },
        btn(t('common.resume'), () => this.handlers.onResume(), 'primary'),
        btn(t('overlay.restart', { key: restartKey }), () => this.handlers.onRestart()),
        btn(t('nav.settings'), () => this.handlers.onSettings()),
        btn(t('common.quit'), () => this.handlers.onQuit())),
      this.message));
  }

  setMessage(text) {
    this.message.textContent = text;
  }

  show(kind, content) {
    this.root.onclick = null;
    this.root.className = `overlay ${kind}`;
    this.root.replaceChildren(content);
  }

  hide() {
    this.root.onclick = null;
    this.root.className = 'overlay hidden';
    this.root.replaceChildren();
    this.count = null;
  }
}
