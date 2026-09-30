import * as THREE from '../../lib/three/three.module.js';
import { SphereFlickScenario } from './base.js';

// Tres esferas a la vez en una cuadrícula plana delante del jugador.
class GridshotScenario extends SphereFlickScenario {
  constructor(ctx, { count = 3, cols = 5, rows = 4, dist = 12, spacing = 1.4 } = {}) {
    super(ctx);
    // Cuadrícula centrada 1 m por encima de los ojos para que la fila baja no toque el suelo
    const { pos } = ctx.player;
    this.cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.cells.push(new THREE.Vector3(pos.x + (c - (cols - 1) / 2) * spacing, pos.y + 1 + (r - (rows - 1) / 2) * spacing, pos.z - dist));
      }
    }
    for (let i = 0; i < count; i++) this.spawn();
  }

  spawn() {
    // Nunca en una casilla ocupada ni en la que se acaba de romper
    const used = new Set(this.targets.map((t) => t.cell));
    if (this.lastKilled) used.add(this.lastKilled.cell);
    const free = this.cells.map((_, i) => i).filter((i) => !used.has(i));
    const t = this.newSphere({ radius: 0.35 });
    t.cell = free[Math.floor(Math.random() * free.length)];
    t.place(this.cells[t.cell]);
  }
}

export default {
  key: 'gridshot',
  group: 'spheres',
  spheres: true,
  // v2: cadencia libre (con la del DMR, un jugador rápido iba por delante del arma)
  version: 2,
  fixed: { weapon: 'dmr', fireRate: 'free' },
  score: 'kills',
  create: (ctx) => new GridshotScenario(ctx),
};
