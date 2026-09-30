import { TrackingScenario, spawnPoint } from './base.js';

// Para aprender: recorre el carril entero a velocidad constante y solo cambia
// de sentido en los extremos (unos 2 s hacia cada lado a 20 m)
export default {
  key: 'basictrack',
  group: 'humanoids',
  version: 1,
  fixed: { weapon: 'ar' },
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const { player, settings } = ctx;
    const t = sc.newTarget({ hp: Infinity, lane: Math.max(2.5, settings.targetDistance * 0.25), ai: { pingpong: true } });
    t.place(spawnPoint(player, settings.targetDistance, 0), player.pos);
  }),
};
