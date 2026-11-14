// main.js — one job: bootstrap + the fixed-step loop + UI wiring.
// Sim runs at a fixed 1/60 step, decoupled from rendering. The render reads
// sim state; the HUD reads sim state; nothing else owns game state.
//
// ?shot=N (1-3) is a screenshot mode for headless captures: it starts a
// live round immediately, poses the camera and places bots in view, with no
// pointer lock. It renders the real game, not a mock scene.
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { makeInput, bindInput, pollInput } from './input.js';
import { Sfx } from './audio.js';
import { giveWeapon } from './player.js';
import { MAP } from './map.js';

const params = new URLSearchParams(location.search);
const shotMode = parseInt(params.get('shot') || '0', 10);
const sfx = new Sfx();
const sim = new Sim(sfx);
const renderer = new Renderer(document.getElementById('app'), sim);
const input = makeInput();
const hud = new Hud(sim, (id) => { if (sim.buy(id)) hud.refreshShop(); });

let buyOpen = false;
let locked = false;

function setBuy(open) {
  if (sim.state !== 'buy' && open) return;
  buyOpen = open;
  hud.showBuy(open);
  if (open) hud.refreshShop();
  if (open && document.pointerLockElement) document.exitPointerLock();
}

bindInput(input, renderer.renderer.domElement, {
  onLockChange: (isLocked) => {
    locked = isLocked;
    if (!isLocked && sim.state === 'live' && !buyOpen && !shotMode) {
      hud.hint('CLICK TO AIM — POINTER UNLOCKED (PAUSED LOOK)');
    }
  },
  onAim: (aiming) => { sim.player.aiming = aiming; },
  onBuy: () => setBuy(!buyOpen),
  onSlot: (n) => {
    const p = sim.player;
    if (n === 1 && p.primary) giveWeapon(p, p.primary);
    if (n === 2) giveWeapon(p, 'dune9');
  },
  onGrenade: (kind) => { if (sim.state === 'live') sim.throwGrenade(kind); },
});

document.getElementById('playbtn').addEventListener('click', () => {
  sfx.ensure();
  document.getElementById('menu').classList.add('hidden');
  hud.showHud(true);
  sim.startMatch();
  setBuy(true);
  hud.banner('ROUND 1', 'BUY PHASE — PRESS B TO SHOP, THEN FIGHT', 3200);
  renderer.renderer.domElement.requestPointerLock();
});
document.getElementById('howbtn').addEventListener('click', () => {
  document.getElementById('howto').classList.toggle('hidden');
});
document.getElementById('againbtn').addEventListener('click', () => {
  document.getElementById('end').classList.add('hidden');
  sim.startMatch();
  setBuy(true);
  hud.showHud(true);
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && buyOpen) setBuy(false);
});

// ---- screenshot mode: real game, scripted camera, no pointer lock ----
if (shotMode) {
  sfx.enabled = false;
  document.getElementById('menu').classList.add('hidden');
  hud.showHud(true);
  sim.startMatch();
  sim.state = 'live';
  sim.roundT = 86;
  // pose: give the player a rifle and some money, put enemies in view
  giveWeapon(sim.player, 'longbow');
  sim.player.money = 3250;
  const poses = {
    1: { px: -14, pz: 6, yaw: 1.82, pitch: 0.01 },
    2: { px: -8, pz: 10, yaw: 2.1, pitch: 0.01 },
    3: { px: 10, pz: -6, yaw: Math.PI * 1.28, pitch: 0.03 },
  };
  const pose = poses[shotMode] || poses[1];
  sim.player.x = pose.px; sim.player.z = pose.pz;
  sim.player.yaw = pose.yaw; sim.player.pitch = pose.pitch;
  // stage bots mid-lane so the frame reads as a firefight
  const stage = [
    { x: -6, z: 2, yaw: 0.4 }, { x: 4, z: -2, yaw: -0.5 },
    { x: -2, z: -8, yaw: 2.6 }, { x: 8, z: 6, yaw: 2.2 },
  ];
  sim.bots.forEach((b, i) => {
    const s = stage[i % stage.length];
    b.x = s.x + (i % 2) * 2; b.z = s.z; b.yaw = s.yaw;
    b.state = 'hold'; b.route = [];
  });
  // a couple of visible tracers + the planted-spike look for shot 3
  if (shotMode === 3) {
    sim.spike.state = 'planted';
    sim.spike.x = MAP.sites.B.x; sim.spike.z = MAP.sites.B.z;
    sim.spike.fuseT = 22;
    renderer.spikeMesh.position.set(MAP.sites.B.x, 0, MAP.sites.B.z);
    renderer.spikeMesh.visible = true;
  }
  hud.banner(shotMode === 3 ? 'SPIKE PLANTED — SITE B' : 'ROUND 1 — SABLE YARD', '', 99999);
  setTimeout(() => document.getElementById('banner').classList.add('hidden'), 2500);
}

// ---- fixed-step loop ----
const STEP = 1 / 60;
let acc = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sim.state === 'live' || sim.state === 'buy' || sim.state === 'roundEnd') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      pollInput(input);
      if (sim.state === 'buy' && buyOpen) { /* frozen aim while shopping */ input.lookDX = 0; input.lookDY = 0; }
      sim.step(STEP, input);
      acc -= STEP; n++;
    }
    if (n === 5) acc = 0;
  }
  // drain sim events into HUD
  for (const k of sim.killfeed.splice(0)) hud.killfeedPush(k);
  let sawEnd = false;
  for (const e of sim.events) {
    if (e.type === 'hitmark') hud.hitmark(e.kill);
    else if (e.type === 'damage') hud.damageFlash(e.amount);
    else if (e.type === 'roundEnd') {
      hud.banner(e.winner === 'vanguard' ? 'ROUND WON' : 'ROUND LOST', e.reason, 3800);
      setBuy(false);
    }
    else if (e.type === 'round') hud.banner('ROUND ' + e.round, sim.round === 1 ? 'BUY PHASE — PRESS B TO SHOP' : '', 2400);
    else if (e.type === 'live') { setBuy(false); hud.hint('GO — ELIMINATE CRIMSON OR STOP THE SPIKE'); }
    else if (e.type === 'planted') hud.banner('SPIKE PLANTED', 'DEFUSE IT — HOLD E BESIDE THE SPIKE', 3200);
    else if (e.type === 'defused') hud.banner('SPIKE DEFUSED', 'ROUND WON', 3000);
    else if (e.type === 'matchEnd') sawEnd = true;
    else if (e.type === 'died') hud.banner('YOU ARE DOWN', 'YOUR SQUAD FIGHTS ON', 2600);
  }
  if (sawEnd) {
    const won = sim.matchWinner === 'vanguard';
    document.getElementById('endtitle').textContent = won ? 'VICTORY' : 'DEFEAT';
    document.getElementById('endsub').textContent =
      `VANGUARD ${sim.score.vanguard} — ${sim.score.crimson} CRIMSON · ${sim.round} ROUNDS`;
    const acc2 = sim.stats.shots ? Math.round(100 * sim.stats.hits / sim.stats.shots) : 0;
    document.getElementById('endstats').textContent =
      `Your line: ${sim.stats.kills} kills · ${sim.stats.deaths} deaths · ${acc2}% accuracy · ${sim.stats.headshots} headshots · ${sim.stats.damage} damage dealt`;
    document.getElementById('end').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  // auto-open the buy menu at each buy phase (desktop play)
  if (sim.state === 'buy' && !buyOpen && !shotMode) setBuy(true);
  renderer.sync(dt, now / 1000);
  hud.update();
  renderer.render();
}
requestAnimationFrame(frame);
