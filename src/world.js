import * as THREE from '/lib/three/three.module.js';

function gridTexture(renderer) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#3a3f47';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#434852';
  g.fillRect(0, 0, size / 2, size / 2);
  g.fillRect(size / 2, size / 2, size / 2, size / 2);
  g.strokeStyle = '#5a606b';
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

/** Arena simple: suelo con cuadrícula (referencia de distancia/movimiento) y bloques de fondo. */
export function buildWorld(scene, renderer) {
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0x9fc4e8, 90, 260);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4436, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const colliders = [];

  const floorSize = 400;
  const tex = gridTexture(renderer);
  tex.repeat.set(floorSize / 4, floorSize / 4); // celdas de 2 m
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  colliders.push(floor);

  // Edificios al fondo y a los lados, fuera de las líneas de tiro habituales
  const blockMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.8 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.7 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const addBlock = (x, z, w, h, d, mat = blockMat) => {
    const m = new THREE.Mesh(box, mat);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    scene.add(m);
    colliders.push(m);
  };
  const heights = [28, 18, 40, 24, 32, 20, 36, 22, 30, 16, 26];
  heights.forEach((h, i) => addBlock((i - 5) * 22, -140, 16, h, 16, i % 3 === 0 ? accentMat : blockMat));
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      addBlock(side * 110, -120 + i * 45, 14, 14 + i * 5, 24);
    }
  }

  return { colliders };
}
