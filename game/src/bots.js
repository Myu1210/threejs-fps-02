// bots.js — one job: bot brains.
// States: push (follow route to a site), hold (defend an angle), plant,
// defuse, guard (protect a planted spike), hunt (chase a seen/heard enemy),
// rotate. Bots see (FOV + LOS + range, worse through smoke), hear gunshots,
// take cover when hurt, and burst-fire with aim error that grows with range
// and target movement — so a still, aiming player wins the duel.
import { MAP, findRoute, nearestWaypoint } from './map.js';
import { hasLOS } from './collision.js';
import { clamp, dist2D } from './rng.js';

export const BOT_NAMES = ['Rook', 'Vex', 'Mara', 'Ilya', 'Sable', 'Kestrel', 'Dune'];

const HOLD_SPOTS = {
  A: [17, 18, 9, 23], B: [20, 21, 10, 24],
};
const PUSH_ROUTES = {
  // waypoint chains (by node) each attacker lane can take
  A: [[11, 23, 17, 19], [14, 25, 18, 19], [8, 9, 17, 19]],
  B: [[13, 24, 20, 22], [16, 26, 21, 22], [8, 10, 20, 22]],
};

export function makeBot(id, team, name, spawn, rng) {
  return {
    id, team, name, isBot: true,
    x: spawn.x, z: spawn.z, y: 0, yaw: team === 'crimson' ? 0 : Math.PI,
    hp: 100, armor: 0, alive: true,
    weapon: 'dune9', mag: 12, reserve: 48, reloading: 0,
    speed: 0, crouched: false, moving: false,
    state: 'push', targetWp: 0, route: [], routeI: 0, waitT: 0,
    site: rng.pick(['A', 'B']),
    enemy: null, lastSeenX: 0, lastSeenZ: 0, lastSeenT: -99, heardT: -99,
    reactT: 0, burstLeft: 0, burstPause: 0, aimErr: 0, primed: false,
    fireCooldown: 0, plantT: 0, defuseT: 0, hasSpike: false,
    kills: 0, deaths: 0, strafeDir: 1, strafeT: 0, holdYaw: 0,
  };
}

export function botResetForRound(bot, spawn, rng, round, isCarrier) {
  bot.x = spawn.x; bot.z = spawn.z; bot.y = 0;
  bot.hp = 100; bot.alive = true; bot.reloading = 0;
  bot.weapon = round >= 2 ? rng.pick(['longbow', 'vex9', 'longbow', 'breacher']) : 'dune9';
  const w = bot.weapon;
  bot.mag = w === 'longbow' ? 30 : w === 'vex9' ? 32 : w === 'breacher' ? 6 : 12;
  bot.reserve = 90;
  bot.state = 'push'; bot.route = []; bot.routeI = 0; bot.waitT = 0;
  bot.enemy = null; bot.lastSeenT = -99; bot.heardT = -99;
  bot.hasSpike = isCarrier;
  bot.site = rng.pick(['A', 'B']);
  bot.plantT = 0; bot.defuseT = 0;
  bot.yaw = bot.team === 'crimson' ? 0 : Math.PI;
  // attackers commit to a lane; defenders pick a site to hold
  if (bot.team === 'crimson') {
    const lanes = PUSH_ROUTES[bot.site];
    bot.route = lanes[Math.floor(rng.next() * lanes.length)].slice();
    bot.routeI = 0;
  } else {
    const spots = HOLD_SPOTS[bot.site];
    bot.targetWp = spots[Math.floor(rng.next() * spots.length)];
    bot.route = findRoute(nearestWaypoint(bot.x, bot.z), bot.targetWp);
    bot.routeI = 0;
    bot.state = 'push';
  }
}

function canSee(bot, enemy, sim) {
  if (!enemy.alive) return false;
  const d = dist2D(bot.x, bot.z, enemy.x, enemy.z);
  if (d > 38) return false;
  // smoke blocks sight
  for (const s of sim.smokes) {
    if (s.t > 0 && segmentHitsSmoke(bot.x, bot.z, enemy.x, enemy.z, s)) return false;
  }
  const dx = enemy.x - bot.x, dz = enemy.z - bot.z;
  const ang = Math.atan2(dx, dz); // yaw convention: facing +z at yaw 0? see note in sim
  let diff = Math.abs(((ang - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  if (d > 6 && diff > 1.15) return false; // ~132 deg total FOV, close range is wider
  const eyeY = bot.y + 1.55, tgtY = enemy.y + 1.35;
  return hasLOS(bot.x, eyeY, bot.z, enemy.x, tgtY, enemy.z);
}
function segmentHitsSmoke(ax, az, bx, bz, s) {
  // does segment pass within smoke radius of the cloud centre?
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((s.x - ax) * dx + (s.z - az) * dz) / len2;
  t = clamp(t, 0, 1);
  const px = ax + dx * t, pz = az + dz * t;
  return (px - s.x) * (px - s.x) + (pz - s.z) * (pz - s.z) < s.r * s.r;
}

// Called by the sim when a shot rings out: bots within earshot investigate.
export function botHeardShot(bot, x, z, now) {
  if (!bot.alive) return;
  const d = dist2D(bot.x, bot.z, x, z);
  if (d < 20) {
    bot.heardT = now;
    bot.lastSeenX = x; bot.lastSeenZ = z;
    if (bot.state === 'hold' || bot.state === 'push') bot.state = 'hunt';
  }
}

// One fixed step of bot AI. sim exposes: fighters, spike state, now, rng,
// damageFighter, plant/defuse progress hooks, shootFighter.
export function botStep(bot, dt, sim) {
  if (!bot.alive) return;
  const now = sim.time;
  bot.fireCooldown -= dt;
  bot.burstPause -= dt;
  bot.waitT -= dt;

  // --- perception: nearest visible enemy ---
  let best = null, bestD = Infinity;
  for (const f of sim.fighters) {
    if (f.team === bot.team || !f.alive) continue;
    const d = dist2D(bot.x, bot.z, f.x, f.z);
    if (d < bestD && canSee(bot, f, sim)) { best = f; bestD = d; }
  }
  if (best) {
    if (bot.enemy !== best) { bot.primed = false; bot.burstLeft = 0; }
    bot.enemy = best; bot.lastSeenX = best.x; bot.lastSeenZ = best.z; bot.lastSeenT = now;
  } else if (bot.enemy && now - bot.lastSeenT > 2.5) { bot.enemy = null; bot.primed = false; }

  // --- objective state machine ---
  const spike = sim.spike;
  if (bot.team === 'crimson' && spike.state === 'planted') bot.state = bot.hasSpike ? 'guard' : 'guard';
  if (bot.team === 'vanguard' && spike.state === 'planted') {
    if (bot.state !== 'defuse' && bot.state !== 'hunt') bot.state = 'hunt';
    bot.lastSeenX = spike.x; bot.lastSeenZ = spike.z;
  }
  if (bot.team === 'crimson' && spike.state === 'carried' && bot.hasSpike) {
    const site = MAP.sites[bot.site];
    if (dist2D(bot.x, bot.z, site.x, site.z) < site.r && !bot.enemy) {
      bot.state = 'plant';
    }
  }
  if (bot.team === 'vanguard' && spike.state === 'carried') {
    // defenders drift toward their site / the carrier's likely lane
    if (bot.state === 'hold' && bot.waitT <= 0 && sim.rng.chance(0.002)) {
      bot.state = 'push';
      bot.route = findRoute(nearestWaypoint(bot.x, bot.z), bot.targetWp);
      bot.routeI = 0;
    }
  }

  // --- movement target ---
  let tx = bot.x, tz = bot.z, wantMove = false, wantCrouch = false;
  const target = bot.enemy;
  if (bot.state === 'plant') {
    // stand still on site, planting
    bot.plantT += dt;
    if (bot.plantT >= MAP.plantTime) { sim.onPlantComplete(bot); bot.plantT = 0; bot.state = 'guard'; }
    wantMove = false;
  } else if (bot.state === 'defuse') {
    bot.defuseT += dt;
    if (bot.defuseT >= MAP.defuseTime) { sim.onDefuseComplete(bot); bot.defuseT = 0; }
    wantMove = false;
  } else if (target) {
    // combat: strafe perpendicular, keep 8-18 m, crouch sometimes when far
    const d = dist2D(bot.x, bot.z, target.x, target.z);
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.7 + sim.rng.next() * 0.9; }
    const dx = target.x - bot.x, dz = target.z - bot.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len * bot.strafeDir, pz = dx / len * bot.strafeDir;
    const approach = d > 18 ? 0.8 : d < 7 ? -0.7 : 0;
    tx = bot.x + px * 3 + dx / len * approach * 3;
    tz = bot.z + pz * 3 + dz / len * approach * 3;
    wantMove = true;
    wantCrouch = d > 20 && sim.rng.chance(0.3);
    // aim at the enemy
    const wantYaw = Math.atan2(dx, dz);
    bot.yaw = turnToward(bot.yaw, wantYaw, dt * 6);
  } else if (bot.state === 'hunt' && now - bot.lastSeenT < 6) {
    tx = bot.lastSeenX; tz = bot.lastSeenZ; wantMove = true;
    if (dist2D(bot.x, bot.z, tx, tz) < 1.2) { bot.state = bot.team === 'vanguard' ? 'hold' : 'push'; bot.waitT = 1.5; }
  } else if (bot.routeI < bot.route.length) {
    const wp = MAP.waypoints[bot.route[bot.routeI]];
    tx = wp.x; tz = wp.z; wantMove = true;
    const d = dist2D(bot.x, bot.z, tx, tz);
    if (d < 1.0) bot.routeI++;
    bot.yaw = turnToward(bot.yaw, Math.atan2(tx - bot.x, tz - bot.z), dt * 4);
    if (bot.routeI >= bot.route.length) {
      if (bot.team === 'vanguard') { bot.state = 'hold'; bot.waitT = 4 + sim.rng.next() * 4; bot.holdYaw = bot.yaw + (sim.rng.next() - 0.5) * 1.2; }
      else if (bot.hasSpike && spike.state === 'carried') bot.state = 'plant';
      else { bot.state = 'hold'; bot.waitT = 2; }
    }
  } else if (bot.state === 'hold') {
    bot.yaw = turnToward(bot.yaw, bot.holdYaw || bot.yaw, dt * 1.5);
    // vanguard defuse check: standing on a planted spike
    if (bot.team === 'vanguard' && spike.state === 'planted' &&
      dist2D(bot.x, bot.z, spike.x, spike.z) < 1.6) bot.state = 'defuse';
    wantMove = false;
  } else if (bot.state === 'guard') {
    // orbit the planted spike at 6-10 m
    const a = now * 0.25 + bot.id;
    tx = spike.x + Math.cos(a) * 8; tz = spike.z + Math.sin(a) * 8;
    wantMove = dist2D(bot.x, bot.z, tx, tz) > 2;
    bot.yaw = turnToward(bot.yaw, Math.atan2(spike.x - bot.x, spike.z - bot.z) + Math.PI, dt * 2);
  }
  // vanguard defuse: walk onto the spike when planted and no enemy visible
  if (bot.team === 'vanguard' && spike.state === 'planted' && !target) {
    const d = dist2D(bot.x, bot.z, spike.x, spike.z);
    if (d > 1.6) { tx = spike.x; tz = spike.z; wantMove = true; }
    else bot.state = 'defuse';
  }

  // --- move with acceleration ---
  const speed = wantCrouch ? 2.1 : wantMove ? 4.3 : 0;
  bot.crouched = wantCrouch;
  bot.moving = wantMove && speed > 0;
  if (bot.moving) {
    const dx = tx - bot.x, dz = tz - bot.z;
    const len = Math.hypot(dx, dz) || 1;
    sim.moveFighter(bot, (dx / len) * speed * dt, (dz / len) * speed * dt);
  }

  // --- firing ---
  // First sighting of a target: one reaction delay, then bursts. The delay
  // is armed once per acquisition (primed), never re-armed while aiming.
  if (target && bot.fireCooldown <= 0 && bot.reloading <= 0 && !bot.primed) {
    const d = dist2D(bot.x, bot.z, target.x, target.z);
    bot.reactT = 0.25 + d * 0.012 + sim.rng.next() * 0.25;
    bot.primed = true;
  }
  if (target) bot.reactT -= dt;
  if (target && bot.reactT <= 0 && bot.reloading <= 0 && bot.fireCooldown <= 0) {
    if (bot.burstLeft <= 0) {
      if (bot.burstPause <= 0) { bot.burstLeft = 3 + Math.floor(sim.rng.next() * 4); bot.burstPause = 0.5 + sim.rng.next() * 0.5; }
    } else {
      const d = dist2D(bot.x, bot.z, target.x, target.z);
      // aim error: worse at range, worse vs a moving target, better when crouched
      let err = 0.012 + d * 0.0011 + (target.moving ? 0.014 : 0) - (bot.crouched ? 0.008 : 0);
      err = Math.max(0.006, err);
      sim.botShoot(bot, target, err);
      bot.burstLeft--;
      bot.fireCooldown = bot.weapon === 'breacher' ? 0.9 : bot.weapon === 'longbow' ? 0.1 : 0.13;
      if (bot.mag <= 0) { bot.reloading = 1.6; bot.mag = 0; }
    }
  }
  if (bot.reloading > 0) {
    bot.reloading -= dt;
    if (bot.reloading <= 0) {
      const w = bot.weapon;
      const cap = w === 'longbow' ? 30 : w === 'vex9' ? 32 : w === 'breacher' ? 6 : 12;
      const need = cap - bot.mag, take = Math.min(need, bot.reserve);
      bot.mag += take; bot.reserve -= take;
    }
  }
}

export function turnToward(yaw, target, maxStep) {
  let d = ((target - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  if (d > maxStep) d = maxStep; else if (d < -maxStep) d = -maxStep;
  return yaw + d;
}
