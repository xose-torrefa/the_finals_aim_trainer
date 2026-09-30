import { TrackingScenario, spawnPoint } from './base.js';

// Un objetivo inmortal que se mueve de lado, salta y hace dashes
export default {
  key: 'tracking',
  group: 'humanoids',
  version: 1,
  fixed: { weapon: 'ar' },
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const { player, settings } = ctx;
    const t = sc.newTarget({ hp: Infinity, lane: Math.max(2, settings.targetDistance * 0.2) });
    t.place(spawnPoint(player, settings.targetDistance, 0), player.pos);
  }),
};
