import { TrackingScenario, spawnPoint } from './base.js';

export default {
  key: 'range',
  group: 'situations',
  version: 1,
  fixed: { weapon: 'ar' },
  distanceLabel: '8–44 m',
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    // Va y viene entre 8 y 44 m sin dejar de moverse de lado
    const t = sc.newTarget({ hp: Infinity, lane: 4, ai: { depth: 18, sweep: true, depthSpeed: 0.8 } });
    t.place(spawnPoint(ctx.player, 26, 0), ctx.player.pos);
  }),
};
