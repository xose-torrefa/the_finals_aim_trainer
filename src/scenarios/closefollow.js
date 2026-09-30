import { TrackingScenario, spawnPoint } from './base.js';

// A 7 m: cambios de sentido constantes, se acerca y se aleja, salta y hace dashes
export default {
  key: 'closetrack',
  group: 'humanoids',
  version: 1,
  fixed: { weapon: 'smg', targetClass: 'light' },
  distanceLabel: '7 m',
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const t = sc.newTarget({
      hp: Infinity,
      lane: 3.5,
      ai: { changeMin: 0.12, changeMax: 0.5, flipChance: 0.8, jumpChance: 0.3, dashChance: 0.2, depth: 2.5 },
    });
    t.place(spawnPoint(ctx.player, 7, 0), ctx.player.pos);
  }),
};
