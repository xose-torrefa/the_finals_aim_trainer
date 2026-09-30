// Trazadoras: una estela que viaja desde la boca del cañón hasta el impacto. Son
// solo visuales (el disparo es hitscan y ya ha impactado). Cada una es una
// cinta de 4 vértices orientada a la cámara, con un ancho constante en píxeles
// y un degradado de la cola (negro = invisible con mezcla aditiva) a la cabeza.
import * as THREE from '../lib/three/three.module.js';

const SPEED = 400; // m/s
const LENGTH = 7; // m
const WIDTH_PX = 2.5;
const RANGE = 300;

const toCam = new THREE.Vector3();
const side = new THREE.Vector3();
const head = new THREE.Vector3();
const tail = new THREE.Vector3();
const color = new THREE.Color();

export class Tracers {
  constructor(scene, size = 48) {
    this.pool = Array.from({ length: size }, () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12), 3));
      geometry.setIndex([0, 1, 2, 2, 1, 3]);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      }));
      mesh.frustumCulled = false; // los vértices se mueven cada frame
      mesh.visible = false;
      mesh.userData = { start: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, traveled: 0 };
      scene.add(mesh);
      return mesh;
    });
    this.next = 0;
  }

  /**
   * @param start punto de salida (en el mundo)
   * @param end   punto de impacto, o null si no ha dado a nada
   * @param dir   dirección del disparo, para los que no impactan
   */
  add(start, end, dir, hex) {
    const mesh = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    const d = mesh.userData;
    d.start.copy(start);
    if (end) d.dir.subVectors(end, start);
    else d.dir.copy(dir).multiplyScalar(RANGE);
    d.dist = d.dir.length();
    d.dir.normalize();
    d.traveled = 0;
    color.set(hex);
    const colors = mesh.geometry.attributes.color;
    colors.setXYZ(0, 0, 0, 0);
    colors.setXYZ(1, 0, 0, 0);
    colors.setXYZ(2, color.r, color.g, color.b);
    colors.setXYZ(3, color.r, color.g, color.b);
    colors.needsUpdate = true;
    mesh.visible = true;
  }

  update(dt, camera, viewportHeight) {
    // Metros por píxel a 1 m de la cámara
    const pxPerMeter = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeight;
    for (const mesh of this.pool) {
      if (!mesh.visible) continue;
      const d = mesh.userData;
      d.traveled += SPEED * dt;
      const tailDist = Math.max(0, d.traveled - LENGTH);
      if (tailDist >= d.dist) {
        mesh.visible = false;
        continue;
      }
      head.copy(d.start).addScaledVector(d.dir, Math.min(d.traveled, d.dist));
      tail.copy(d.start).addScaledVector(d.dir, tailDist);
      const pos = mesh.geometry.attributes.position;
      [tail, head].forEach((p, i) => {
        toCam.subVectors(camera.position, p);
        const half = (toCam.length() * pxPerMeter * WIDTH_PX) / 2;
        side.crossVectors(d.dir, toCam).normalize().multiplyScalar(half);
        pos.setXYZ(i * 2, p.x + side.x, p.y + side.y, p.z + side.z);
        pos.setXYZ(i * 2 + 1, p.x - side.x, p.y - side.y, p.z - side.z);
      });
      pos.needsUpdate = true;
    }
  }

  clear() {
    for (const mesh of this.pool) mesh.visible = false;
  }
}
