// collision.js — one job: geometry queries the sim and bots share.
// Circle-vs-AABB movement, ray-vs-AABB walls, segment line-of-sight, and
// ray-vs-fighter hit tests (head sphere + body box). No allocations in the
// hot path: results are written into caller-owned scratch objects.
import { MAP } from './map.js';

const RADIUS = 0.42;

export function collideMove(p, nx, nz) {
  // Try full move, then axis-separated slides. p = {x,z} mutated in place.
  if (!hitsObstacle(nx, p.z)) p.x = nx;
  if (!hitsObstacle(p.x, nz)) p.z = nz;
  p.x = Math.max(-MAP.halfX + RADIUS, Math.min(MAP.halfX - RADIUS, p.x));
  p.z = Math.max(-MAP.halfZ + RADIUS, Math.min(MAP.halfZ - RADIUS, p.z));
}
export function hitsObstacle(x, z) {
  for (let i = 0; i < MAP.obstacles.length; i++) {
    const o = MAP.obstacles[i];
    if (Math.abs(x - o.x) < o.hx + RADIUS && Math.abs(z - o.z) < o.hz + RADIUS) return true;
  }
  return false;
}
export function pointBlocked(x, z) { return hitsObstacle(x, z); }

// Ray vs one AABB (2D, with height range). Returns t or Infinity.
export function rayAABB(ox, oy, oz, dx, dy, dz, o, maxT) {
  let tmin = 0, tmax = maxT;
  // X slab
  if (Math.abs(dx) < 1e-9) { if (ox < o.x - o.hx || ox > o.x + o.hx) return Infinity; }
  else {
    let t1 = (o.x - o.hx - ox) / dx, t2 = (o.x + o.hx - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < o.z - o.hz || oz > o.z + o.hz) return Infinity; }
  else {
    let t1 = (o.z - o.hz - oz) / dz, t2 = (o.z + o.hz - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // height: ray must be below the obstacle top at entry
  const yAt = oy + dy * tmin;
  if (yAt > o.h) return Infinity;
  return tmin;
}
// Distance to the nearest wall along a ray (for bullet impact / LOS).
export function rayWalls(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  for (let i = 0; i < MAP.obstacles.length; i++) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, MAP.obstacles[i], best);
    if (t < best) best = t;
  }
  // ground
  if (dy < -1e-6) { const tg = -oy / dy; if (tg > 0 && tg < best) best = tg; }
  return best;
}
// 2D line of sight between two eye points; tall obstacles block, low ones don't.
export function hasLOS(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  const t = rayWalls(ax, ay, az, dx / len, dy / len, dz / len, len);
  return t >= len - 0.05;
}
// Ray vs a fighter: head sphere (r .26 at y+1.52) then body box. out = {t, head}.
export function rayFighter(ox, oy, oz, dx, dy, dz, f, maxT, out) {
  out.t = Infinity; out.head = false;
  // head sphere
  const hx = f.x, hy = f.y + 1.52, hz = f.z;
  const ocx = ox - hx, ocy = oy - hy, ocz = oz - hz;
  const b = ocx * dx + ocy * dy + ocz * dz;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - 0.26 * 0.26;
  const disc = b * b - c;
  if (disc > 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < maxT) { out.t = t; out.head = true; return out; }
  }
  // body box: 0.84 wide, y .. y+1.35
  const box = { x: f.x, z: f.z, hx: 0.42, hz: 0.42, h: 1.35 };
  const t = rayAABB(ox, oy - f.y, oz, dx, dy, dz, { x: box.x, z: box.z, hx: box.hx, hz: box.hz, h: box.h }, maxT);
  if (t < maxT && t > 0) { out.t = t; out.head = false; }
  return out;
}
