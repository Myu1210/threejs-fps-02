// weapons.js — one job: the weapon table and per-weapon fire behaviour.
// Balance rule: accuracy counts more than speed. Moving, jumping and spraying
// widen the cone; standing still, crouching and aiming tighten it. Headshots pay.
export const WEAPONS = {
  dune9: {
    id: 'dune9', name: 'DUNE-9', kind: 'pistol', price: 0, auto: false,
    damage: 34, headMult: 2.5, rpm: 380, mag: 12, reserve: 48,
    spreadDeg: 0.9, moveSpreadMult: 1.9, recoil: 0.32, bloom: 0.5, range: 42,
    tracer: 0xffd23d, sound: 'pistol',
  },
  vex9: {
    id: 'vex9', name: 'VEX-9 SMG', kind: 'smg', price: 1200, auto: true,
    damage: 26, headMult: 2.2, rpm: 750, mag: 32, reserve: 96,
    spreadDeg: 1.7, moveSpreadMult: 1.7, recoil: 0.22, bloom: 0.55, range: 38,
    tracer: 0x9fd8ff, sound: 'smg',
  },
  longbow: {
    id: 'longbow', name: 'LONGBOW-7', kind: 'rifle', price: 2700, auto: true,
    damage: 33, headMult: 2.5, rpm: 600, mag: 30, reserve: 90,
    spreadDeg: 0.65, moveSpreadMult: 1.9, recoil: 0.42, bloom: 0.5, range: 60,
    tracer: 0xffb36b, sound: 'rifle',
  },
  breacher: {
    id: 'breacher', name: 'BREACHER-12', kind: 'shotgun', price: 1500, auto: false,
    damage: 13, headMult: 2.0, rpm: 68, mag: 6, reserve: 24, pellets: 8,
    spreadDeg: 4.2, moveSpreadMult: 1.5, recoil: 1.5, bloom: 1.1, range: 22,
    tracer: 0xff8a5c, sound: 'shotgun',
  },
  needle: {
    id: 'needle', name: 'NEEDLE-50', kind: 'sniper', price: 4000, auto: false,
    damage: 95, headMult: 3.0, rpm: 48, mag: 5, reserve: 15, scoped: true,
    spreadDeg: 0.12, moveSpreadMult: 3.2, recoil: 2.2, bloom: 1.6, range: 90,
    tracer: 0xc9f2ff, sound: 'sniper',
  },
};
export const SHOP = [
  { id: 'vex9', label: 'VEX-9 SMG', desc: 'Fast, close quarters. 750 RPM.', price: 1200 },
  { id: 'breacher', label: 'BREACHER-12', desc: '8-pellet shotgun. Clears corners.', price: 1500 },
  { id: 'longbow', label: 'LONGBOW-7', desc: 'The workhorse rifle. Accurate, 600 RPM.', price: 2700 },
  { id: 'needle', label: 'NEEDLE-50', desc: 'One-shot body at range. Scope on right-click.', price: 4000 },
  { id: 'armor', label: 'KEVLAR VEST', desc: 'Halves damage taken until it breaks.', price: 650 },
  { id: 'frag', label: 'FRAG GRENADE', desc: '1.6s fuse. Big radius damage.', price: 300 },
  { id: 'smoke', label: 'SMOKE GRENADE', desc: 'Blocks sightlines for 12 seconds.', price: 300 },
];
// Spread in radians for one shot, given the shooter's state.
export function spreadFor(w, state) {
  // state: {moving, airborne, crouched, aiming, bloom}
  let s = (w.spreadDeg * Math.PI) / 180;
  if (state.moving) s *= w.moveSpreadMult;
  if (state.airborne) s *= 2.4;
  if (state.crouched) s *= 0.68;
  if (state.aiming) s *= 0.45;
  return s * (1 + state.bloom);
}
