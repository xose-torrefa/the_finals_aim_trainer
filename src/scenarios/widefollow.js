import * as THREE from '../../lib/three/three.module.js';
import { TrackingScenario } from './base.js';

// Como Tracking 3D, pero en un espacio mucho más ancho que alto: la esfera
// recorre unos ±40° de lado a lado (medido), así que hay que mover mucho el ratón y casi
// nunca está en el centro de la pantalla. Es el escenario por defecto del test
// de sensibilidad
export default {
  key: 'widetrack',
  group: 'spheres',
  spheres: true,
  version: 1,
  fixed: { weapon: 'ar' },
  score: 'percent',
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const { player, settings } = ctx;
    const center = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z - 13);
    const t = sc.newSphere({
      radius: 0.35,
      hp: Infinity,
      move: 'float',
      speed: 12 * settings.targetSpeed,
      bounds: { center, half: new THREE.Vector3(20, 2, 3) },
    });
    t.place(center);
  }),
};
