import { EliminationScenario } from './base.js';

// Un enemigo con la vida de su clase: flick + ADS + tracking hasta matarlo
export default {
  key: 'duel',
  group: 'humanoids',
  version: 1,
  fixed: { weapon: 'ar', fireRate: 'weapon' },
  score: 'kills',
  create: (ctx) => new EliminationScenario(ctx, { count: 1, arc: 40, respawnDelay: 0.4 }),
};
