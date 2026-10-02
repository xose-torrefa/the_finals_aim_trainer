import { TrackingScenario, spawnPoint } from './base.js';

// Un objetivo inmortal con trayectorias suaves: curvas y círculos que lo acercan
// y lo alejan, sin cambios bruscos de sentido, saltos ni dashes. Como el movimiento
// es predecible, va más rápido que la clase (× `targetSpeed` en Sandbox)
export default {
  key: 'tracking',
  group: 'humanoids',
  version: 3,
  fixed: { weapon: 'ar' },
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const { player, settings } = ctx;
    const d = settings.targetDistance;
    const t = sc.newTarget({ hp: Infinity, speedScale: 1.5 * settings.targetSpeed, lane: Math.max(2.5, d * 0.3), ai: { smooth: true, depth: Math.max(1.5, d * 0.2) } });
    t.place(spawnPoint(player, d, 0), player.pos);
  }),
};
