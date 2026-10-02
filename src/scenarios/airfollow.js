import * as THREE from '../../lib/three/three.module.js';
import { TrackingScenario } from './base.js';

// Una esfera flotante con trayectorias suaves en las tres dimensiones, sin
// cambios bruscos de dirección
export default {
  key: 'airtrack',
  group: 'spheres',
  spheres: true,
  version: 3,
  fixed: { weapon: 'ar' },
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const { player, settings } = ctx;
    const center = new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z - 12);
    const t = sc.newSphere({
      radius: 0.35,
      hp: Infinity,
      move: 'float',
      speed: 7 * settings.targetSpeed,
      bounds: { center, half: new THREE.Vector3(7, 2.6, 3.5) },
    });
    t.place(center);
  }),
};
