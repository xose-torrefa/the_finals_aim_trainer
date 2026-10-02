import { t } from './i18n.js';

// Los nombres de armas y miras están en i18n (`weapon.<clave>`, `sight.<clave>`).
// Niveles de aumento de mira de The Finals (parche 7.0: Low 1×, Medium 1.25×,
// High 1.5×). El FOV de ADS es un % del FOV vertical de hipfire, según las
// mediciones de la comunidad (r/thefinals, "Ultimate Guide to FOV...").
// El nivel no lo da la mira sola sino la combinación arma + mira: el red dot es
// Low en todas las armas salvo en el revólver (Medium). Ver `sights` de cada arma.
export const LEVELS = {
  low: { fovMult: 0.78 },
  medium: { fovMult: 0.68 },
  high: { fovMult: 0.58 },
  // Sin verificar: el francotirador tiene su propia sens y su FOV no está medido
  sniper: { fovMult: 0.4, sniper: true },
};

/** Nombre de un arma o una mira en el idioma actual; `short` quita lo que va entre paréntesis. */
const named = (prefix) => (key, short = false) => {
  const name = t(`${prefix}.${key}`);
  return short ? name.split(' (')[0] : name;
};
export const weaponName = named('weapon');
export const sightName = named('sight');

// Arquetipos de arma. Los números son APROXIMADOS (inspirados en The Finals) y
// están pensados para ir ajustándose durante el desarrollo.
//  sights:     miras que admite → nivel de aumento (ver LEVELS). Por defecto
//              lleva el red dot si lo admite, y si no, la primera (`defaultSight`);
//              cada jugador elige la suya en Ajustes
//              → Armas (`sightKey(arma)`), y esa decide el FOV de ADS.
//  adsTime:    segundos para entrar en ADS completo
//  falloff:    [inicio m, fin m, multiplicador mínimo]
export const WEAPONS = {
  ar: {
    auto: true, rpm: 600, damage: 20, headMult: 1.5,
    sights: { iron: 'low', reddot: 'low' }, adsTime: 0.22,
    falloff: [30, 50, 0.67],
  },
  smg: {
    auto: true, rpm: 900, damage: 13, headMult: 1.5,
    // Visor: el del XP-54 (Medium, 68 %)
    sights: { iron: 'low', reddot: 'low', scope: 'medium' }, adsTime: 0.16,
    falloff: [18, 30, 0.6],
  },
  lmg: {
    auto: true, rpm: 550, damage: 23, headMult: 1.5,
    sights: { iron: 'low', reddot: 'low' }, adsTime: 0.35,
    falloff: [35, 55, 0.7],
  },
  dmr: {
    auto: false, rpm: 300, damage: 45, headMult: 1.75,
    // Visor: el del FAMAS / LH1 / Pike (High, 58 %)
    sights: { iron: 'low', reddot: 'low', scope: 'high' }, adsTime: 0.25,
    falloff: [45, 70, 0.8],
  },
  revolver: {
    auto: false, rpm: 180, damage: 55, headMult: 1.5,
    // El red dot del revólver es Medium (68 %), no Low como en el resto
    sights: { iron: 'low', reddot: 'medium' }, adsTime: 0.15,
    falloff: [25, 40, 0.6],
  },
  sniper: {
    auto: false, rpm: 60, damage: 118, headMult: 1.5,
    sights: { scope: 'sniper' }, adsTime: 0.4,
    falloff: [80, 120, 0.9],
  },
};

// Cadencia `trainer`: las automáticas disparan a esta cadencia, como en los aim
// trainers, que da un feedback continuo al hacer tracking. El daño por bala se
// reduce en la misma proporción, así que el DPS y el TTK siguen siendo los del arma.
export const TRAINER_RPM = 1200;

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

/** Clave del ajuste con la mira elegida para un arma ('ar' → 'sightAr'). */
export const sightKey = (weapon) => `sight${weapon[0].toUpperCase()}${weapon.slice(1)}`;

/** Mira por defecto de un arma: el red dot si lo admite, y si no, la primera. */
export function defaultSight(weapon) {
  const { sights } = WEAPONS[weapon];
  return Object.hasOwn(sights, 'reddot') ? 'reddot' : Object.keys(sights)[0];
}

/** Mira y nivel de aumento que lleva un arma según los ajustes. */
export function weaponSight(s, weapon) {
  const { sights } = WEAPONS[weapon];
  const sight = Object.hasOwn(sights, s[sightKey(weapon)]) ? s[sightKey(weapon)] : defaultSight(weapon);
  return { sight, level: sights[sight] };
}

/** Arma efectiva según los ajustes: mira elegida, tiempo de ADS forzado y cadencia. */
export function resolveWeapon(s) {
  const base = WEAPONS[s.weapon];
  const { sight, level } = weaponSight(s, s.weapon);
  const trainer = s.fireRate === 'trainer' && base.auto;
  return {
    ...base,
    rpm: trainer ? TRAINER_RPM : base.rpm,
    damage: trainer ? (base.damage * base.rpm) / TRAINER_RPM : base.damage,
    key: s.weapon,
    sight,
    level,
    fovMult: LEVELS[level].fovMult,
    sniper: LEVELS[level].sniper === true,
    adsTime: s.adsTimeOverride > 0 ? s.adsTimeOverride / 1000 : base.adsTime,
    // Cada clic dispara aunque no se haya cumplido la cadencia (`rpm` sigue valiendo
    // al mantener pulsada una automática y para el TTK teórico)
    freeFire: s.fireRate === 'free',
  };
}
