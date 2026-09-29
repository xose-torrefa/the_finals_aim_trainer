// Arquetipos de arma. Los números son APROXIMADOS (inspirados en The Finals) y
// están pensados para ir ajustándose durante el desarrollo.
//  zoom:       ratio de zoom en ADS (FOV hip / FOV ADS, en tangentes)
//  adsTime:    segundos para entrar en ADS completo
//  hipSpread / adsSpread: semiángulo del cono de dispersión en grados
//  falloff:    [inicio m, fin m, multiplicador mínimo]
export const WEAPONS = {
  ar: {
    name: 'Rifle de asalto (tipo AKM/FCAR)',
    auto: true, rpm: 600, damage: 20, headMult: 1.5,
    zoom: 1.35, adsTime: 0.22, hipSpread: 2.2, adsSpread: 0.15,
    falloff: [30, 50, 0.67],
  },
  smg: {
    name: 'Subfusil (tipo M11/XP-54)',
    auto: true, rpm: 900, damage: 13, headMult: 1.5,
    zoom: 1.2, adsTime: 0.16, hipSpread: 2.6, adsSpread: 0.35,
    falloff: [18, 30, 0.6],
  },
  lmg: {
    name: 'Ametralladora ligera (tipo M60/Lewis)',
    auto: true, rpm: 550, damage: 23, headMult: 1.5,
    zoom: 1.3, adsTime: 0.35, hipSpread: 3.5, adsSpread: 0.35,
    falloff: [35, 55, 0.7],
  },
  dmr: {
    name: 'Tirador semiautomático (tipo LH1)',
    auto: false, rpm: 300, damage: 45, headMult: 1.75,
    zoom: 2.0, adsTime: 0.25, hipSpread: 3, adsSpread: 0,
    falloff: [45, 70, 0.8],
  },
  revolver: {
    name: 'Revólver (tipo R.357)',
    auto: false, rpm: 180, damage: 55, headMult: 1.5,
    zoom: 1.25, adsTime: 0.15, hipSpread: 1.5, adsSpread: 0,
    falloff: [25, 40, 0.6],
  },
  sniper: {
    name: 'Francotirador (tipo SR-84)',
    auto: false, rpm: 60, damage: 118, headMult: 1.5,
    zoom: 4.0, adsTime: 0.4, hipSpread: 6, adsSpread: 0,
    falloff: [80, 120, 0.9],
  },
};

export function damageAt(w, dist) {
  const [start, end, min] = w.falloff;
  if (dist <= start) return w.damage;
  if (dist >= end) return w.damage * min;
  const t = (dist - start) / (end - start);
  return w.damage * (1 - t * (1 - min));
}

/** TTK teórico (s) acertando todo al cuerpo a una distancia dada. */
export function idealTTK(w, hp, dist) {
  const shots = Math.ceil(hp / damageAt(w, dist));
  return ((shots - 1) * 60) / w.rpm;
}
