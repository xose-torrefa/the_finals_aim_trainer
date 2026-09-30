import { Crosshair, crosshairProfile } from './crosshair.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(settings) {
    this.settings = settings;
    this.root = $('hud');
    this.hitmarker = $('hitmarker');
    this.hipCh = new Crosshair();
    this.adsCh = new Crosshair();
    this.root.insertBefore(this.hipCh.el, this.hitmarker);
    this.root.insertBefore(this.adsCh.el, this.hitmarker);
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
    const s = this.settings;
    this.hipCh.apply(crosshairProfile(s, 'crosshair'));
    this.adsCh.apply(crosshairProfile(s, 'adsCrosshair'));
    this.adsCh.el.classList.toggle('hidden', s.adsCrosshair !== 'custom');
    this.hipCh.setLines(1);
    this.hipCh.setOpacity(s.crosshairOpacity);
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
   * @param e         progreso de ADS 0..1
   */
  update(dt, { e, timeLeft, live }) {
    // 'dot': se desvanecen las líneas; 'custom': fundido entre las dos miras
    const s = this.settings;
    if (s.adsCrosshair === 'dot') this.hipCh.setLines(1 - e);
    else if (s.adsCrosshair === 'custom') {
      this.hipCh.setOpacity(s.crosshairOpacity * (1 - e));
      this.adsCh.setOpacity(s.adsCrosshairOpacity * e);
    }
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
