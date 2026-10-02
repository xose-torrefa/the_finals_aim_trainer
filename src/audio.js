// Sonidos sintetizados con Web Audio (sin ficheros externos). Cada categoría
// tiene su volumen (`shotVolume`, `hitVolume`…), que se multiplica por el general.

// Variantes de cada categoría; sus nombres están en i18n como `sound.<clave>`.
export const SHOT_SOUNDS = ['punch', 'click', 'thump', 'laser', 'soft'];
export const HIT_SOUNDS = ['blip', 'tick', 'ding'];

// Pequeña variación de tono por disparo para que el fuego automático no canse
const jitter = () => 0.95 + Math.random() * 0.1;

// Separación mínima (s) entre dos disparos o dos impactos que suenan. Como en los
// aim trainers, a 1200 RPM no suena cada bala (sonaría a zumbido): suena una de
// cada dos, ~600 por minuto. No afecta a las cadencias reales (900 RPM o menos).
const MIN_GAP = 0.06;

export class Sfx {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.noiseBuf = null;
    this.lastPlayed = {};
  }

  /** Si ya toca que vuelva a sonar `kind` (ver MIN_GAP), y apunta que suena. */
  due(kind) {
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed[kind] ?? -Infinity) < MIN_GAP) return false;
    this.lastPlayed[kind] = now;
    return true;
  }

  /** Debe llamarse desde un gesto del usuario (clic). */
  unlock() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Volumen efectivo de una categoría, o 0 si no se puede sonar. */
  vol(kind) {
    if (!this.ctx) return 0;
    return this.settings.volume * this.settings[`${kind}Volume`];
  }

  /** Tono con barrido de frecuencia y caída exponencial. */
  tone({ type = 'sine', from, to = from, duration, gain }) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  /** Ráfaga de ruido blanco filtrado con caída exponencial. */
  noise({ filter = 'lowpass', freq, q = 1, duration, gain, rate = 1 }) {
    if (!this.noiseBuf) {
      const len = Math.floor(this.ctx.sampleRate * 0.3);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.value = freq;
    biquad.Q.value = q;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(biquad).connect(amp).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + duration);
  }

  shot() {
    const v = this.vol('shot');
    if (v <= 0 || !this.due('shot')) return;
    const r = jitter();
    switch (this.settings.shotSound) {
      case 'punch':
        this.noise({ filter: 'highpass', freq: 5000, duration: 0.015, gain: v * 0.06, rate: r });
        this.noise({ filter: 'bandpass', freq: 2200 * r, q: 0.8, duration: 0.09, gain: v * 0.12, rate: r });
        this.tone({ from: 160 * r, to: 45, duration: 0.1, gain: v * 0.15 });
        break;
      case 'click':
        this.noise({ filter: 'highpass', freq: 3000, duration: 0.02, gain: v * 0.2, rate: r });
        this.tone({ type: 'square', from: 2200 * r, to: 1700, duration: 0.012, gain: v * 0.04 });
        break;
      case 'thump':
        this.tone({ from: 120 * r, to: 40, duration: 0.13, gain: v * 0.18 });
        this.noise({ freq: 600, duration: 0.05, gain: v * 0.08, rate: r });
        break;
      case 'laser':
        this.tone({ type: 'sawtooth', from: 1400 * r, to: 180, duration: 0.08, gain: v * 0.12 });
        break;
      default: // 'soft'
        this.noise({ freq: 1800, duration: 0.07, gain: v * 0.35 });
    }
  }

  hit(head) {
    const v = this.vol('hit');
    if (v <= 0 || !this.due('hit')) return;
    switch (this.settings.hitSound) {
      case 'tick':
        this.tone({ from: head ? 2600 : 1800, duration: 0.03, gain: v * 0.3 });
        break;
      case 'ding': {
        const f = head ? 1700 : 1200;
        this.tone({ type: 'triangle', from: f, duration: 0.18, gain: v * 0.25 });
        this.tone({ from: f * 2.76, duration: 0.1, gain: v * 0.06 });
        break;
      }
      default: // 'blip'
        this.tone({ type: 'square', from: head ? 1500 : 950, duration: 0.05, gain: v * 0.15 });
    }
  }

  kill() {
    const v = this.vol('kill');
    if (v <= 0) return;
    this.tone({ type: 'triangle', from: 700, duration: 0.12, gain: v * 0.25 });
    this.tone({ type: 'triangle', from: 1400, duration: 0.12, gain: v * 0.15 });
  }

  /** Pitido de la cuenta atrás; `go` = el que marca el inicio. */
  tick(go) {
    const v = this.vol('countdown');
    if (v <= 0) return;
    this.tone({ from: go ? 1320 : 660, duration: go ? 0.18 : 0.08, gain: v * 0.2 });
  }

  /** Reproduce un sonido de muestra desde el menú. */
  preview(kind) {
    this.unlock();
    if (kind === 'shot') this.shot();
    else if (kind === 'hit') this.hit(false);
    else if (kind === 'head') this.hit(true);
    else if (kind === 'kill') this.kill();
    else if (kind === 'countdown') this.tick(true);
  }
}
