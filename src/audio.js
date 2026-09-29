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

  /** Disparo: ráfaga corta de ruido filtrado, más baja que el sonido de impacto. */
  shot() {
    const vol = this.settings.volume;
    if (!this.ctx || vol <= 0) return;
    if (!this.noise) {
      const len = Math.floor(this.ctx.sampleRate * 0.07);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    const amp = this.ctx.createGain();
    amp.gain.value = vol * 0.35;
    src.connect(filter).connect(amp).connect(this.ctx.destination);
    src.start();
  }

  hit(head) {
    this.blip(head ? 1500 : 950, 0.05, 'square', 0.6);
  }

  kill() {
    this.blip(700, 0.12, 'triangle', 1);
    this.blip(1400, 0.12, 'triangle', 0.6);
  }
}
