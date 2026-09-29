import * as THREE from '/lib/three/three.module.js';

const LIFE = 1.5;
const FADE = 0.5;
const geometry = new THREE.CircleGeometry(1, 12);
const normal = new THREE.Vector3();
const lookAt = new THREE.Vector3();

/** Marcas de impacto de los disparos que no dan a un objetivo. Pool fijo reutilizable. */
export class Impacts {
  constructor(scene, size = 64) {
    this.pool = Array.from({ length: size }, () => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0x111111,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }));
      mesh.visible = false;
      mesh.userData.life = 0;
      scene.add(mesh);
      return mesh;
    });
    this.next = 0;
  }

  /** @param hit intersección de three.js (point, face, object, distance) */
  add(hit) {
    const mesh = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    mesh.position.copy(hit.point);
    mesh.lookAt(lookAt.copy(hit.point).add(normal));
    // Tamaño angular constante (~0,3°) para que se vea a cualquier distancia
    mesh.scale.setScalar(Math.max(0.03, hit.distance * 0.0025));
    mesh.material.opacity = 0.9;
    mesh.userData.life = LIFE;
    mesh.visible = true;
  }

  update(dt) {
    for (const mesh of this.pool) {
      if (!mesh.visible) continue;
      mesh.userData.life -= dt;
      if (mesh.userData.life <= 0) mesh.visible = false;
      else mesh.material.opacity = 0.9 * Math.min(1, mesh.userData.life / FADE);
    }
  }

  clear() {
    for (const mesh of this.pool) mesh.visible = false;
  }
}
