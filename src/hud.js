import { DEG } from './settings.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(settings) {
    this.settings = settings;
    this.root = $('hud');
    this.crosshair = $('crosshair');
    this.hitmarker = $('hitmarker');
    this.vignette = $('vignette');
    this.timer = $('timer');
    this.liveEl = $('live');
    this.fpsEl = $('fps');
    this.hitTime = 0;
    this.frames = 0;
    this.fpsAccum = 0;
    this.lastLive = '';
    this.applySettings();
  }

  applySettings() {
    this.root.style.setProperty('--ch-color', this.settings.crosshairColor);
    this.fpsEl.classList.toggle('hidden', !this.settings.showFps);
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  hit(head, kill) {
    this.hitTime = kill ? 0.35 : 0.15;
    this.hitmarker.classList.toggle('head', head);
    this.hitmarker.classList.toggle('kill', kill);
  }

  /**
   * @param spreadDeg semiángulo de dispersión actual
   * @param vFovDeg   FOV vertical actual
   * @param e         progreso de ADS 0..1
   */
  update(dt, { spreadDeg, vFovDeg, e, timeLeft, live }) {
    // Hueco de la cruceta = proyección en pantalla del cono de dispersión
    const halfH = window.innerHeight / 2;
    const gap = (Math.tan(spreadDeg * DEG) / Math.tan((vFovDeg * DEG) / 2)) * halfH;
    this.crosshair.style.setProperty('--gap', `${(gap + 3).toFixed(1)}px`);
    this.crosshair.style.setProperty('--lines', (1 - e).toFixed(3));
    this.vignette.style.opacity = (e * 0.7).toFixed(3);

    this.hitTime = Math.max(0, this.hitTime - dt);
    this.hitmarker.style.opacity = Math.min(1, this.hitTime * 8).toFixed(3);

    this.timer.textContent = Math.max(0, timeLeft).toFixed(1);
    if (live !== this.lastLive) {
      this.liveEl.textContent = live;
      this.lastLive = live;
    }

    this.frames++;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.frames / this.fpsAccum)} FPS`;
      this.frames = 0;
      this.fpsAccum = 0;
    }
  }
}
