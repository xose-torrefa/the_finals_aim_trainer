import { EliminationScenario } from './base.js';

// Tres enemigos a la vez, como en una pelea de equipo
export default {
  key: 'switching',
  group: 'humanoids',
  version: 1,
  fixed: { weapon: 'ar', fireRate: 'weapon' },
  score: 'kills',
  create: (ctx) => new EliminationScenario(ctx, { count: 3, arc: 45, respawnDelay: 0.6 }),
};
