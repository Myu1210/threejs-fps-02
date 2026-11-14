// player.js — one job: the human player's movement + gun state.
// Acceleration / friction movement, crouch, jump, recoil + bloom, reload,
// weapon switching and grenade throws. All numbers live here and in weapons.js.
import { WEAPONS, spreadFor } from './weapons.js';
import { clamp } from './rng.js';

export function makePlayer() {
  return {
    id: 0, team: 'vanguard', name: 'YOU', isBot: false,
    x: 0, z: 22, y: 0, yaw: Math.PI, pitch: 0,
    vx: 0, vz: 0, vy: 0, grounded: true,
    hp: 100, armor: 0, alive: true,
    weapon: 'dune9', mag: 12, reserve: 48, reloading: 0, reloadTotal: 0,
    bloom: 0, recoilP: 0, fireCooldown: 0, triggerHeld: false,
    crouched: false, moving: false, sprinting: false, aiming: false,
    money: 800, kills: 0, deaths: 0, frags: 0, smokes: 0,
    primary: null, // bought primary weapon id, null = pistol only
    plantT: 0, defuseT: 0, lastDamageT: -99,
  };
}

export function playerWeaponDef(p) { return WEAPONS[p.weapon]; }

export function giveWeapon(p, id) {
  const w = WEAPONS[id];
  p.weapon = id; p.mag = w.mag; p.reserve = w.reserve;
  p.reloading = 0; p.bloom = 0; p.fireCooldown = 0;
  if (w.kind !== 'pistol') p.primary = id;
}

export function playerStep(p, input, dt, sim) {
  if (!p.alive) return;
  // --- look ---
  p.yaw -= input.lookDX * 0.0021;
  p.pitch = clamp(p.pitch - input.lookDY * 0.0021, -1.45, 1.45);
  input.lookDX = 0; input.lookDY = 0;

  // --- move: acceleration + friction, sprint only forward & un-aimed ---
  const sprint = input.sprint && !p.crouched && !p.aiming && input.forward > 0;
  p.sprinting = sprint;
  const base = p.crouched ? 2.2 : sprint ? 6.6 : 4.6;
  const w = playerWeaponDef(p);
  const speed = base * (p.aiming ? 0.55 : 1) * (w.kind === 'sniper' ? 0.92 : 1);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // forward = (sin, cos); right = (cos, -sin)
  const mx = sin * input.forward + cos * input.strafe;
  const mz = cos * input.forward - sin * input.strafe;
  const ml = Math.hypot(mx, mz) || 1;
  const accel = p.grounded ? 42 : 10;
  p.vx += (mx / ml) * accel * dt * (input.forward || input.strafe ? 1 : 0);
  p.vz += (mz / ml) * accel * dt * (input.forward || input.strafe ? 1 : 0);
  // friction
  const fr = p.grounded ? Math.pow(0.0001, dt) : Math.pow(0.4, dt);
  p.vx *= fr; p.vz *= fr;
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > speed) { p.vx *= speed / sp; p.vz *= speed / sp; }
  p.moving = sp > 0.6;
  sim.moveFighter(p, p.vx * dt, p.vz * dt);
  // jump / gravity
  if (input.jump && p.grounded) { p.vy = 5.4; p.grounded = false; }
  input.jump = false; // consume the edge
  if (!p.grounded) {
    p.vy -= 14.5 * dt; p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.grounded = true; }
  }
  p.crouched = input.crouch;

  // --- recoil recovery / bloom decay ---
  p.bloom = Math.max(0, p.bloom - dt * 1.9);
  p.recoilP *= Math.pow(0.001, dt);
  p.fireCooldown -= dt;

  // --- reload ---
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) {
      const need = w.mag - p.mag, take = Math.min(need, p.reserve);
      p.mag += take; p.reserve -= take;
      sim.onReloadDone?.();
    }
  } else if (input.reload && p.mag < w.mag && p.reserve > 0) {
    p.reloading = w.kind === 'shotgun' ? 2.4 : w.kind === 'sniper' ? 2.6 : 1.7;
    p.reloadTotal = p.reloading;
    sim.sfx.reload();
  }

  // --- fire ---
  p.triggerHeld = input.triggerHeld;
  const wantFire = p.triggerHeld && (w.auto || input.clicked);
  input.clicked = false;
  if (wantFire && p.fireCooldown <= 0 && p.reloading <= 0 && p.mag > 0) {
    sim.playerShoot(p);
  } else if (wantFire && p.mag === 0 && p.fireCooldown <= 0) {
    sim.sfx.dry();
    p.fireCooldown = 0.3;
    if (p.reserve > 0) { p.reloading = 1.7; p.reloadTotal = 1.7; sim.sfx.reload(); }
  }

  // --- plant / defuse (hold E near the spike / site) ---
  const spike = sim.spike;
  if (input.use) {
    if (spike.state === 'carried' && p.team === 'crimson') {
      // player is Vanguard in this build; planting is a bot job — see sim
    }
    if (spike.state === 'planted' &&
      Math.hypot(p.x - spike.x, p.z - spike.z) < 1.7) {
      p.defuseT += dt;
      if (p.defuseT >= 4.0) { sim.onDefuseComplete(p); p.defuseT = 0; }
    } else p.defuseT = 0;
  } else p.defuseT = 0;
}

// Spread state the sim feeds into spreadFor().
export function spreadState(p) {
  return {
    moving: p.moving, airborne: !p.grounded, crouched: p.crouched,
    aiming: p.aiming, bloom: p.bloom,
  };
}
export { spreadFor };
