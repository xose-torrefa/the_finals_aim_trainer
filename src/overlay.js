import { h } from './dom.js';

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
  }

  /** Partida preparada: espera un clic (gesto necesario para capturar el ratón). */
  showReady({ name, mode, restartKey }) {
    this.message.textContent = '';
    this.show('ready', h('div', { class: 'ov-card' },
      h('span', { class: 'eyebrow' }, mode),
      h('h1', {}, name),
      h('p', { class: 'ov-cta' }, 'Haz clic para empezar'),
      h('p', { class: 'keys' }, `Clic izq: disparar · Clic der: ADS · ${restartKey}: reiniciar · Esc: pausa`),
      this.message,
      h('button', {
        class: 'link',
        onclick: (e) => {
          e.stopPropagation();
          this.handlers.onQuit();
        },
      }, 'Volver al menú')));
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
      h('span', { class: 'eyebrow' }, 'Pausa'),
      h('h1', {}, name),
      h('div', { class: 'ov-actions' },
        btn('Continuar', () => this.handlers.onResume(), 'primary'),
        btn(`Reiniciar (${restartKey})`, () => this.handlers.onRestart()),
        btn('Ajustes', () => this.handlers.onSettings()),
        btn('Abandonar', () => this.handlers.onQuit())),
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
