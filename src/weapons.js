// Niveles de aumento de mira de The Finals (parche 7.0: Low 1×, Medium 1.25×,
// High 1.5×). El FOV de ADS es un % del FOV vertical de hipfire, según las
// mediciones de la comunidad (r/thefinals, "Ultimate Guide to FOV...").
export const SIGHTS = {
  low: { name: 'Low 1× (hierro, red dots, holográfico)', fovMult: 0.78 },
  medium: { name: 'Medium 1.25× (Reflector Sight)', fovMult: 0.68 },
  high: { name: 'High 1.5× (miras de aumento, arco)', fovMult: 0.58 },
  // Sin verificar: el francotirador tiene su propia sens y su FOV no está medido
  sniper: { name: 'Francotirador (FOV sin verificar)', fovMult: 0.4, sniper: true },
};

// Arquetipos de arma. Los números son APROXIMADOS (inspirados en The Finals) y
// están pensados para ir ajustándose durante el desarrollo.
//  sight:      mira por defecto (ver SIGHTS)
//  adsTime:    segundos para entrar en ADS completo
//  falloff:    [inicio m, fin m, multiplicador mínimo]
export const WEAPONS = {
  ar: {
    name: 'Rifle de asalto (tipo AKM/FCAR)',
    auto: true, rpm: 600, damage: 20, headMult: 1.5,
    sight: 'low', adsTime: 0.22,
    falloff: [30, 50, 0.67],
  },
  smg: {
    name: 'Subfusil (tipo M11/XP-54)',
    auto: true, rpm: 900, damage: 13, headMult: 1.5,
    sight: 'low', adsTime: 0.16,
    falloff: [18, 30, 0.6],
  },
  lmg: {
    name: 'Ametralladora ligera (tipo M60/Lewis)',
    auto: true, rpm: 550, damage: 23, headMult: 1.5,
    sight: 'low', adsTime: 0.35,
    falloff: [35, 55, 0.7],
  },
  dmr: {
    name: 'Tirador semiautomático (tipo LH1)',
    auto: false, rpm: 300, damage: 45, headMult: 1.75,
    sight: 'high', adsTime: 0.25,
    falloff: [45, 70, 0.8],
  },
  revolver: {
    name: 'Revólver (tipo R.357)',
    auto: false, rpm: 180, damage: 55, headMult: 1.5,
    sight: 'low', adsTime: 0.15,
    falloff: [25, 40, 0.6],
  },
  sniper: {
    name: 'Francotirador (tipo SR-84)',
    auto: false, rpm: 60, damage: 118, headMult: 1.5,
    sight: 'sniper', adsTime: 0.4,
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
