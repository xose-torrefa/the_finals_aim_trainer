import * as THREE from '../../lib/three/three.module.js';
import { TrackingScenario, spawnPoint } from './base.js';

// Desde el borde de un tejado: el objetivo pasa por la calle, pegado a la
// fachada, y se le sigue mirando hacia abajo. Casi en vertical, un paso de lado
// es un giro grande de yaw, y el ángulo cambia mucho según dónde esté.
const ROOF = 12; // altura del tejado (m), unas 3-4 plantas
const EDGE = 0.4; // del jugador al borde: está asomado
const STREET = 4.5; // de la fachada al centro de la calle
const SIZE = { w: 50, d: 16 }; // ancho de la fachada y fondo del edificio

class RooftopScenario extends TrackingScenario {
  constructor(ctx) {
    const { player } = ctx;
    player.pos.y += ROOF;
    super(ctx, (sc) => {
      const t = sc.newTarget({
        hp: Infinity,
        lane: 12,
        // Anda por la calle casi sin parar, con algún cambio de sentido y algún salto
        ai: { changeMin: 0.5, changeMax: 1.8, flipChance: 0.4, jumpChance: 0.15, depth: 1.5 },
      });
      t.place(spawnPoint(player, EDGE + STREET, 0), player.pos);
    });
    // Empieza mirando al objetivo
    const aim = this.targets[0].aimInfo().center;
    player.pitch = -Math.atan2(player.pos.y - aim.y, EDGE + STREET);

    // Edificio: la fachada da a la calle (-Z) y el jugador está encima, junto al borde
    const edgeZ = player.pos.z - EDGE;
    const wall = new THREE.MeshStandardMaterial({ color: 0xd2d4d8, roughness: 0.9 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x8e959e, roughness: 0.95 });
    this.materials = [wall, roof, new THREE.MeshBasicMaterial({ color: 0xd8dde3 })];
    // Orden de las caras de BoxGeometry: +x, -x, +y, -y, +z, -z
    const building = new THREE.Mesh(new THREE.BoxGeometry(SIZE.w, ROOF, SIZE.d), [wall, wall, roof, wall, wall, wall]);
    building.position.set(player.pos.x, ROOF / 2, edgeZ + SIZE.d / 2);
    // Línea en el borde del tejado, para ver dónde acaba
    const line = new THREE.Mesh(new THREE.PlaneGeometry(SIZE.w, 0.1), this.materials[2]);
    line.rotation.x = -Math.PI / 2;
    line.position.set(player.pos.x, ROOF + 0.005, edgeZ + 0.05);
    this.meshes = [building, line];
    for (const mesh of this.meshes) {
      mesh.updateMatrixWorld();
      ctx.scene.add(mesh);
    }
    this.colliders.push(building);
    this.minZ = player.pos.z;
  }

  // Con movimiento (Sandbox) se puede andar por el tejado, pero no pasar del borde
  clampPlayer(pos) {
    pos.z = Math.max(pos.z, this.minZ);
  }

  dispose() {
    super.dispose();
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.materials.forEach((m) => m.dispose());
    this.colliders = [];
  }
}

export default {
  key: 'rooftop',
  group: 'situations',
  version: 1,
  fixed: { weapon: 'ar' },
  distanceLabel: '13–19 m',
  score: 'percent',
  create: (ctx) => new RooftopScenario(ctx),
};
