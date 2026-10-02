import * as THREE from '../../lib/three/three.module.js';
import { TrackingScenario } from './base.js';

const DISTANCE = 15; // m hasta el plano por el que se mueve
const HALF_WIDTH = 10; // m a cada lado del centro (±34° a 15 m)
const SPEED = 6; // m/s en horizontal, constante
const HEIGHT = 0.5; // m del centro por encima de los ojos
const AMPLITUDE = 1; // m arriba y abajo
const WAVE_PERIOD = 1.4; // s por oscilación vertical
const RADIUS = 0.35;

// La esfera va de un extremo al otro de un cajón a velocidad constante,
// ondulando arriba y abajo, y al llegar a la pared da la vuelta en seco (como la
// luz por una fibra óptica). La onda sigue sin cortes en la vuelta. Un cruce dura
// 3,3 s y una oscilación 1,4 s, así que el dibujo cambia de una pasada a otra.
// El cajón es solo visual: no para las balas.
class WaveScenario extends TrackingScenario {
  constructor(ctx) {
    super(ctx, (sc) => {
      const { player } = ctx;
      sc.center = new THREE.Vector3(player.pos.x, player.pos.y + HEIGHT, player.pos.z - DISTANCE);
      sc.sphere = sc.newSphere({ radius: RADIUS, hp: Infinity });
      sc.x = 0;
      sc.dir = Math.random() < 0.5 ? -1 : 1;
      sc.phase = Math.random() < 0.5 ? 0 : Math.PI; // empieza subiendo o bajando
      sc.place();
    });
    this.box = this.makeBox();
    ctx.scene.add(this.box);
  }

  /** Cajón por dentro del cual rebota la esfera: aristas y un fondo tenue. */
  makeBox() {
    const r = this.sphere.aimInfo().radius; // ya con sphereScale
    const w = 2 * (HALF_WIDTH + r);
    const hgt = 2 * (AMPLITUDE + r);
    const d = 2 * r;
    const box = new THREE.BoxGeometry(w, hgt, d);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose(); // solo hacía falta para las aristas
    const back = new THREE.PlaneGeometry(w, hgt);
    this.geometries = [edges, back];
    this.materials = [
      new THREE.LineBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.7 }),
      new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.08, depthWrite: false }),
    ];
    const group = new THREE.Group();
    group.position.copy(this.center);
    group.add(new THREE.LineSegments(edges, this.materials[0]));
    const panel = new THREE.Mesh(back, this.materials[1]);
    panel.position.z = -r;
    group.add(panel);
    return group;
  }

  place() {
    const y = AMPLITUDE * Math.sin(this.phase);
    this.sphere.place(this.center.clone().add(new THREE.Vector3(this.x, y, 0)));
    // Que el rayo del disparo use la posición de este fotograma
    this.sphere.group.updateMatrixWorld();
  }

  update(dt) {
    const k = this.ctx.settings.targetSpeed;
    this.x += this.dir * SPEED * k * dt;
    // Rebote en la pared: lo que se pase vuelve hacia dentro
    if (Math.abs(this.x) > HALF_WIDTH) {
      this.x = THREE.MathUtils.clamp(Math.sign(this.x) * 2 * HALF_WIDTH - this.x, -HALF_WIDTH, HALF_WIDTH);
      this.dir = -this.dir;
    }
    this.phase += (2 * Math.PI * k * dt) / WAVE_PERIOD;
    this.place();
    super.update(dt);
  }

  dispose() {
    super.dispose();
    this.box.removeFromParent();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

export default {
  key: 'wavetrack',
  group: 'spheres',
  spheres: true,
  version: 1,
  fixed: { weapon: 'ar' },
  score: 'percent',
  create: (ctx) => new WaveScenario(ctx),
};
