import { TrackingScenario, spawnPoint } from './base.js';

// Se lanza una y otra vez desde jump pads y hace air strafe al caer
export default {
  key: 'aerial',
  group: 'situations',
  version: 1,
  fixed: { weapon: 'ar' },
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const { player, settings } = ctx;
    const t = sc.newTarget({
      hp: Infinity,
      lane: Math.max(2, settings.targetDistance * 0.25),
      ai: { changeMin: 0.3, changeMax: 1, padChance: 0.3, depth: 2 },
    });
    t.place(spawnPoint(player, settings.targetDistance, 0), player.pos);
  }),
};
