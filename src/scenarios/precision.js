import { SphereFlickScenario, aimPoint, rand } from './base.js';

// Una esfera pequeña que reaparece a pocos grados de la anterior: microajustes.
class PrecisionScenario extends SphereFlickScenario {
  constructor(ctx) {
    super(ctx);
    this.yaw = 0;
    this.pitch = 3;
    this.spawn();
  }

  spawn() {
    // Salto de 2-8° en una dirección que no se salga del área (±25° yaw, -4..14° pitch)
    for (let tries = 0; tries < 50; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(2, 8);
      const yaw = this.yaw + Math.cos(a) * d;
      const pitch = this.pitch + Math.sin(a) * d;
      if (Math.abs(yaw) <= 25 && pitch >= -4 && pitch <= 14) {
        this.yaw = yaw;
        this.pitch = pitch;
        break;
      }
    }
    const t = this.newSphere({ radius: 0.13 });
    t.place(aimPoint(this.ctx.player, 15, this.yaw, this.pitch));
  }
}

export default {
  key: 'precision',
  group: 'spheres',
  spheres: true,
  // v2: cadencia libre
  version: 2,
  fixed: { weapon: 'dmr', fireRate: 'free' },
  score: 'kills',
  create: (ctx) => new PrecisionScenario(ctx),
};
