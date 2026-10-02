import { TrackingScenario, spawnPoint, pct } from './base.js';
import { t } from '../i18n.js';

// Tracking en el que hay que moverse: el tiempo en objetivo solo cuenta
// mientras se pulsa WASD (si el movimiento está permitido).
class MoveTrackScenario extends TrackingScenario {
  constructor(ctx, makeTarget) {
    super(ctx, makeTarget);
    this.requireMove = ctx.settings.allowMove;
  }

  live(st) {
    return t('live.movetrack', { onTarget: pct(st.onTargetTime, st.time), moving: pct(st.movingTime, st.time) });
  }

  summary(st) {
    return [
      ['sum.onTargetMoving', pct(st.onTargetTime, st.time)],
      ['sum.movingTime', pct(st.movingTime, st.time)],
      ...super.summary(st).slice(1),
    ];
  }
}

export default {
  key: 'movetrack',
  group: 'situations',
  version: 3,
  fixed: { weapon: 'ar', allowMove: true },
  distanceLabel: '12 m',
  score: 'percent',
  create: (ctx) => new MoveTrackScenario(ctx, (sc) => {
    const t = sc.newTarget({ hp: Infinity, speedScale: 1.4 * ctx.settings.targetSpeed, lane: 4.5, ai: { smooth: true, depth: 2.5 } });
    t.place(spawnPoint(ctx.player, 12, 0), ctx.player.pos);
  }),
};
