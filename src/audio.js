// Sonidos de impacto sintetizados (sin ficheros externos).
export class Sfx {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
  }

  /** Debe llamarse desde un gesto del usuario (clic). */
  unlock() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  blip(freq, duration, type = 'square', gain = 1) {
    const vol = this.settings.volume * gain;
    if (!this.ctx || vol <= 0) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(vol * 0.25, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  hit(head) {
    this.blip(head ? 1500 : 950, 0.05, 'square', 0.6);
  }

  kill() {
    this.blip(700, 0.12, 'triangle', 1);
    this.blip(1400, 0.12, 'triangle', 0.6);
  }
}
