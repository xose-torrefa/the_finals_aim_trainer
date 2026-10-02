import { TrackingScenario, spawnPoint } from './base.js';

// A 7 m: un Light da vueltas, acercándose y alejándose, pero con
// trayectorias suaves (sin saltos, dashes ni cambios bruscos). Va más rápido que
// la clase, porque el movimiento es predecible
export default {
  key: 'closetrack',
  group: 'humanoids',
  version: 3,
  fixed: { weapon: 'smg', targetClass: 'light' },
  distanceLabel: '7 m',
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const t = sc.newTarget({ hp: Infinity, speedScale: 1.3 * ctx.settings.targetSpeed, lane: 4.5, ai: { smooth: true, depth: 2.5 } });
    t.place(spawnPoint(ctx.player, 7, 0), ctx.player.pos);
  }),
};
