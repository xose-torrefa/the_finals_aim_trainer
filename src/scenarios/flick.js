import { Scenario, spawnPoint, rand, pct, avg, ms } from './base.js';
import { t } from '../i18n.js';

// Objetivos estáticos de un solo impacto repartidos en un arco amplio.
class FlickScenario extends Scenario {
  constructor(ctx) {
    super(ctx);
    this.spawn();
  }

  spawn() {
    const { player, settings } = this.ctx;
    const dist = settings.targetDistance * rand(0.5, 1.8);
    const t = this.newTarget({ hp: 1, move: 'static' });
    t.place(spawnPoint(player, dist, rand(-60, 60)), player.pos);
  }

  onHit(target, part, res) {
    if (!res.killed) return;
    const st = this.ctx.stats;
    st.kills++;
    st.killTimes.push(st.time - target.spawnTime);
    this.removeTarget(target);
    this.pending.push({ at: st.time + 0.15, slot: 0 });
  }

  live(st) {
    return t('live.flick', { kills: st.kills, time: ms(avg(st.killTimes)), acc: pct(st.hits, st.shots) });
  }

  score(st) {
    return st.kills;
  }


  summary(st) {
    return [
      ['sum.kills', st.kills],
      ['sum.targetTime', ms(avg(st.killTimes))],
      ['sum.accuracy', pct(st.hits, st.shots)],
      ['sum.headshots', pct(st.headshots, st.hits)],
    ];
  }
}

export default {
  key: 'flick',
  group: 'humanoids',
  version: 1,
  fixed: { weapon: 'revolver' },
  score: 'kills',
  create: (ctx) => new FlickScenario(ctx),
};
