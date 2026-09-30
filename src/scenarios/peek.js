import * as THREE from '../../lib/three/three.module.js';
import { Scenario, spawnPoint, rand, pct, avg, ms } from './base.js';
import { t } from '../i18n.js';

// Un enemigo que asoma por un lado de una cobertura, aguanta un momento (con
// algún ADAD) y vuelve a esconderse, a veces tras otra. Conserva la vida entre
// peeks. Se entrena a tener la mira preparada en los bordes.
const COVER = { halfW: 1.6, height: 2.6, depth: 0.6 };
const PEEK_ACCEL = 30;
const coverGeometry = new THREE.BoxGeometry(1, 1, 1);

class PeekScenario extends Scenario {
  constructor(ctx, { dist = 16, yaws = [-32, 0, 32] } = {}) {
    super(ctx);
    const { scene, player } = ctx;
    this.material = new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.9 });
    this.covers = yaws.map((yaw) => {
      const center = spawnPoint(player, dist, yaw);
      const toPlayer = new THREE.Vector3().subVectors(player.pos, center).setY(0).normalize();
      const mesh = new THREE.Mesh(coverGeometry, this.material);
      mesh.scale.set(2 * COVER.halfW, COVER.height, COVER.depth);
      mesh.position.copy(center).setY(COVER.height / 2);
      mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z); // cara ancha hacia el jugador
      mesh.updateMatrixWorld();
      scene.add(mesh);
      this.colliders.push(mesh);
      return { center, dist };
    });
    this.spawn();
  }

  spawn() {
    const t = this.newTarget({ move: 'static' });
    t.peek = { phase: 'hidden', timer: this.ctx.stats.time === 0 ? 1 : 0.4, exposed: false, hit: false, exposedAt: 0 };
    this.hide(t);
  }

  /** Esconde el objetivo tras una cobertura y un lado al azar. */
  hide(t) {
    const p = t.peek;
    p.cover = this.covers[Math.floor(Math.random() * this.covers.length)];
    p.side = Math.random() < 0.5 ? -1 : 1;
    p.depth = -(COVER.depth / 2 + 0.8);
    // Borde de la cobertura visto desde el jugador, a la profundidad del objetivo
    p.edge = (COVER.halfW * (p.cover.dist - p.depth)) / (p.cover.dist - COVER.depth / 2);
    p.hiddenLat = p.side * (COVER.halfW - t.halfWidth - 0.25);
    p.lat = p.goal = p.hiddenLat;
    p.vel = 0;
    t.place(p.cover.center, this.ctx.player.pos);
    this.position(t);
  }

  position(t) {
    const p = t.peek;
    t.group.position.copy(t.anchor).addScaledVector(t.axis, p.lat).addScaledVector(t.depthAxis, p.depth);
    t.group.updateMatrixWorld(true); // el rayo del disparo usa la posición de este fotograma
  }

  /** Un punto asomado: el cuerpo entero fuera del borde, más un poco. */
  outLat(t, min, max) {
    return t.peek.side * (t.peek.edge + t.halfWidth + rand(min, max));
  }

  update(dt) {
    super.update(dt);
    const st = this.ctx.stats;
    for (const t of this.targets) {
      const p = t.peek;
      p.timer -= dt;
      const reached = Math.abs(p.goal - p.lat) < 0.05 && Math.abs(p.vel) < 0.5;
      if (p.phase === 'hidden' && p.timer <= 0) {
        p.phase = 'out';
        p.goal = this.outLat(t, 0.3, 1.4);
      } else if (p.phase === 'out' && reached) {
        p.phase = 'hold';
        p.timer = rand(0.4, 1.1);
        p.jiggle = rand(0.2, 0.45);
      } else if (p.phase === 'hold') {
        p.jiggle -= dt;
        if (p.jiggle <= 0) {
          p.goal = this.outLat(t, 0.2, 1.5);
          p.jiggle = rand(0.2, 0.45);
        }
        if (p.timer <= 0) {
          p.phase = 'in';
          p.goal = p.hiddenLat;
        }
      } else if (p.phase === 'in' && reached) {
        p.phase = 'hidden';
        p.timer = rand(0.4, 1.2);
        if (Math.random() < 0.6) this.hide(t);
      }

      // Hacia su meta con aceleración limitada, frenando a tiempo
      const speed = t.cls.speed * this.ctx.settings.targetSpeed;
      const gap = p.goal - p.lat;
      const want = Math.sign(gap) * Math.min(speed, Math.sqrt(2 * PEEK_ACCEL * Math.abs(gap)));
      const maxDv = PEEK_ACCEL * dt;
      p.vel += Math.max(-maxDv, Math.min(maxDv, want - p.vel));
      p.lat += p.vel * dt;
      this.position(t);

      // Asomado = alguna parte del cuerpo fuera del borde
      const exposed = Math.abs(p.lat) + t.halfWidth > p.edge;
      if (exposed && !p.exposed) {
        st.peeks++;
        p.exposedAt = st.time;
        p.hit = false;
      }
      p.exposed = exposed;
      if (t.bar) t.bar.visible = exposed; // la barra no tiene depthTest: se vería a través de la pared
    }
  }

  onHit(target, part, res) {
    const st = this.ctx.stats;
    const p = target.peek;
    if (!p.hit) {
      p.hit = true;
      st.punished++;
      st.peekReactions.push(st.time - p.exposedAt);
    }
    if (!res.killed) return;
    st.kills++;
    this.removeTarget(target);
    this.pending.push({ at: st.time + 0.8, slot: 0 });
  }

  live(st) {
    return t('live.peek', { kills: st.kills, punished: pct(st.punished, st.peeks), acc: pct(st.hits, st.shots) });
  }

  score(st) {
    return st.kills;
  }

  summary(st) {
    return [
      ['sum.kills', st.kills],
      ['sum.peeks', st.peeks],
      ['sum.punished', pct(st.punished, st.peeks)],
      ['sum.peekReaction', ms(avg(st.peekReactions))],
      ['sum.accuracy', pct(st.hits, st.shots)],
      ['sum.headshots', pct(st.headshots, st.hits)],
    ];
  }

  dispose() {
    super.dispose();
    for (const mesh of this.colliders) mesh.removeFromParent();
    this.colliders = [];
    this.material.dispose();
  }
}

export default {
  key: 'peek',
  group: 'situations',
  version: 1,
  fixed: { weapon: 'ar' },
  distanceLabel: '16 m',
  score: 'kills',
  create: (ctx) => new PeekScenario(ctx),
};
