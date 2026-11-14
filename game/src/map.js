// map.js — one job: the original SABLE YARD map data.
// A 64 x 48 m dusk industrial yard. Two spike sites (A west yard, B east
// warehouse), a Mid lane, a Long connector and a Tunnels flank. Cover is
// crates, containers and low walls — every sightline has a corner to break it.
// All collision is axis-aligned boxes; all bot routing is a waypoint graph.
export const MAP = {
  name: 'SABLE YARD',
  halfX: 32, halfZ: 24,
  roundTime: 100, plantTime: 3.2, defuseTime: 4.0, fuseTime: 35,
  // obstacles: {x,z,hx,hz,h} — centre, half extents, height. h>=2.4 blocks sight.
  obstacles: [
    // perimeter (thick walls, also the visual bounds)
    { x: 0, z: -24.6, hx: 33, hz: 0.6, h: 5 }, { x: 0, z: 24.6, hx: 33, hz: 0.6, h: 5 },
    { x: -32.6, z: 0, hx: 0.6, hz: 25, h: 5 }, { x: 32.6, z: 0, hx: 0.6, hz: 25, h: 5 },
    // Site A (west yard): container ring + crates
    { x: -24, z: -8, hx: 4, hz: 1, h: 2.6 }, { x: -24, z: 8, hx: 4, hz: 1, h: 2.6 },
    { x: -28, z: 0, hx: 1, hz: 4, h: 2.6 }, { x: -19, z: -3, hx: 1.5, hz: 1.5, h: 1.2 },
    { x: -19, z: 4, hx: 1.2, hz: 1.2, h: 2.4 }, { x: -23, z: 3, hx: 1, hz: 1, h: 1.1 },
    // Site B (east warehouse): stacked crates + pillar
    { x: 24, z: -8, hx: 4, hz: 1, h: 2.6 }, { x: 24, z: 8, hx: 4, hz: 1, h: 2.6 },
    { x: 28, z: 0, hx: 1, hz: 4, h: 2.6 }, { x: 19, z: 2, hx: 1.5, hz: 1.5, h: 1.2 },
    { x: 20, z: -4, hx: 1.2, hz: 1.2, h: 2.4 }, { x: 23, z: -3, hx: 1, hz: 1, h: 1.1 },
    // Mid lane cover: low walls and crates, staggered so no full-length lane
    { x: -6, z: 0, hx: 1, hz: 4, h: 1.3 }, { x: 6, z: 0, hx: 1, hz: 4, h: 1.3 },
    { x: 0, z: -10, hx: 2, hz: 1, h: 1.2 }, { x: 0, z: 10, hx: 2, hz: 1, h: 1.2 },
    { x: -12, z: -12, hx: 2, hz: 1, h: 2.4 }, { x: 12, z: 12, hx: 2, hz: 1, h: 2.4 },
    { x: -12, z: 12, hx: 1.5, hz: 1.5, h: 1.1 }, { x: 12, z: -12, hx: 1.5, hz: 1.5, h: 1.1 },
    // Long connector (north) and Tunnels flank (south)
    { x: -16, z: -18, hx: 3, hz: 1, h: 1.3 }, { x: 16, z: -18, hx: 3, hz: 1, h: 1.3 },
    { x: 0, z: -18, hx: 1, hz: 2, h: 2.6 },
    { x: -16, z: 18, hx: 3, hz: 1, h: 1.3 }, { x: 16, z: 18, hx: 3, hz: 1, h: 1.3 },
    { x: 0, z: 18, hx: 1, hz: 2, h: 2.6 },
    // spawn cover (kept clear of the spawn points at x -4/0/4, z ±21/22)
    { x: -11, z: 20, hx: 1.5, hz: 1, h: 1.2 }, { x: 11, z: 20, hx: 1.5, hz: 1, h: 1.2 },
    { x: -11, z: -20, hx: 1.5, hz: 1, h: 1.2 }, { x: 11, z: -20, hx: 1.5, hz: 1, h: 1.2 },
  ],
  sites: {
    A: { x: -24, z: 0, r: 3.4, label: 'SITE A' },
    B: { x: 24, z: 0, r: 3.4, label: 'SITE B' },
  },
  spawns: {
    vanguard: [{ x: -4, z: 21 }, { x: 0, z: 22 }, { x: 4, z: 21 }],
    crimson: [{ x: -4, z: -21 }, { x: 0, z: -22 }, { x: 4, z: -21 }, { x: -8, z: -20 }],
  },
  // Waypoint graph: nodes with neighbour indices. Bots BFS over this.
  // Layout: spawns, mid, long, tunnels, site approaches, site holds.
  waypoints: [
    { x: 0, z: 21 }, { x: -6, z: 16 }, { x: 6, z: 16 },           // 0-2 vanguard spawn
    { x: 0, z: -21 }, { x: -6, z: -16 }, { x: 6, z: -16 },       // 3-5 crimson spawn
    { x: 0, z: 13 }, { x: 0, z: -13 }, { x: 0, z: 0 },           // 6-8 mid (kept off the mid crates at z ±10)
    { x: -10, z: 0 }, { x: 10, z: 0 },                           // 9-10 mid flanks
    { x: -16, z: -14 }, { x: -3, z: -18 }, { x: 16, z: -14 },    // 11-13 long (12 kept off the long pillar)
    { x: -16, z: 14 }, { x: 3, z: 18 }, { x: 16, z: 14 },        // 14-16 tunnels
    { x: -20, z: -6 }, { x: -20, z: 6 }, { x: -24, z: 0 },       // 17-19 site A
    { x: 20, z: -6 }, { x: 20, z: 6 }, { x: 24, z: 0 },          // 20-22 site B
    { x: -10, z: -8 }, { x: 10, z: -8 }, { x: -10, z: 8 }, { x: 10, z: 8 }, // 23-26 corners
  ],
  edges: [
    [0, 1], [0, 2], [1, 6], [2, 6], [1, 14], [2, 16], [6, 8], [8, 7], [7, 4], [7, 5],
    [3, 4], [3, 5], [4, 11], [5, 13], [11, 12], [12, 13], [11, 23], [13, 24],
    [14, 15], [15, 16], [14, 25], [16, 26], [6, 25], [6, 26], [7, 23], [7, 24],
    [9, 17], [9, 18], [17, 19], [18, 19], [10, 20], [10, 21], [20, 22], [21, 22],
    [23, 17], [24, 20], [25, 18], [26, 21], [8, 9], [8, 10], [9, 23], [10, 24],
    [1, 25], [2, 26], [4, 23], [5, 24],
  ],
};
// BFS route between waypoint indices. Returns array of node indices.
export function findRoute(from, to) {
  if (from === to) return [to];
  const prev = new Array(MAP.waypoints.length).fill(-1);
  const q = [from]; prev[from] = from;
  const adj = new Map();
  for (const [a, b] of MAP.edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  }
  while (q.length) {
    const n = q.shift();
    if (n === to) break;
    for (const m of adj.get(n) || []) if (prev[m] === -1) { prev[m] = n; q.push(m); }
  }
  if (prev[to] === -1) return [to];
  const path = []; let c = to;
  while (c !== from) { path.unshift(c); c = prev[c]; }
  return path;
}
export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < MAP.waypoints.length; i++) {
    const w = MAP.waypoints[i];
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
