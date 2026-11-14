// sim.js — one job: the whole match simulation, fixed-step, apart from rendering.
// State lives here: fighters, spike, grenades, economy, rounds, timers.
// Render reads this state; input writes into `input`; the sim never touches DOM.
import { MAP } from './map.js';
import { WEAPONS, spreadFor } from './weapons.js';
import { makeRng, clamp, dist2D } from './rng.js';
import { collideMove, rayWalls, rayFighter, hasLOS } from './collision.js';
import { makeBot, botResetForRound, botStep, botHeardShot, BOT_NAMES } from './bots.js';
import { makePlayer, giveWeapon, playerStep, spreadState } from './player.js';

export const WIN_ROUNDS = 5;
const BUY_TIME = 20;
const HIT = { t: Infinity, head: false };

export class Sim {
  constructor(sfx) {
    this.sfx = sfx;
    this.rng = makeRng(20261115);
    this.time = 0;
    this.state = 'menu'; // menu | buy | live | roundEnd | matchEnd
    this.round = 0;
    this.score = { vanguard: 0, crimson: 0 };
    this.lossStreak = 0;
    this.roundT = BUY_TIME;
    this.phaseT = 0;
    this.player = makePlayer();
    this.bots = [];
    this.fighters = [this.player];
    this.spike = { state: 'none', site: 'A', x: 0, z: 0, fuseT: 0, carrier: null };
    this.grenades = [];
    this.smokes = [];
    this.events = [];   // drained by render each frame
    this.killfeed = []; // drained by HUD
    this.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, damage: 0 };
    this.roundWinner = null;
    this.roundReason = '';
    this.matchWinner = null;
    this.lastTickSecond = -1;
    this._buildBots();
  }

  _buildBots() {
    // 2 Vanguard allies + 4 Crimson opponents
    const names = BOT_NAMES.slice();
    for (let i = 0; i < 2; i++) {
      const b = makeBot(10 + i, 'vanguard', names[i], MAP.spawns.vanguard[i + 1], this.rng);
      this.bots.push(b);
    }
    for (let i = 0; i < 4; i++) {
      const b = makeBot(20 + i, 'crimson', names[2 + i], MAP.spawns.crimson[i], this.rng);
      this.bots.push(b);
    }
    this.fighters = [this.player, ...this.bots];
  }

  startMatch() {
    this.score = { vanguard: 0, crimson: 0 };
    this.lossStreak = 0;
    this.round = 0;
    this.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, damage: 0 };
    this.player.money = 800;
    this.player.primary = null;
    this.player.frags = 0; this.player.smokes = 0;
    giveWeapon(this.player, 'dune9');
    this.nextRound();
  }

  nextRound() {
    this.round++;
    const p = this.player;
    // Death costs your primary: you respawn with the pistol if you died.
    if (!p.alive) { giveWeapon(p, 'dune9'); p.primary = null; p.armor = 0; }
    p.hp = 100; p.alive = true;
    p.x = MAP.spawns.vanguard[0].x; p.z = MAP.spawns.vanguard[0].z;
    p.y = 0; p.yaw = Math.PI; p.pitch = 0; p.vx = 0; p.vz = 0; p.vy = 0;
    p.mag = WEAPONS[p.weapon].mag; p.reserve = WEAPONS[p.weapon].reserve;
    p.reloading = 0; p.bloom = 0; p.plantT = 0; p.defuseT = 0;
    // bots respawn; carrier is a random Crimson bot
    const carrier = this.bots[2 + Math.floor(this.rng.next() * 4)];
    this.bots.forEach((b, i) => {
      const spawn = MAP.spawns[b.team][b.team === 'vanguard' ? (i % 2) + 1 : i - 2];
      botResetForRound(b, spawn, this.rng, this.round, b === carrier);
    });
    this.spike = { state: 'carried', site: carrier.site, x: carrier.x, z: carrier.z, fuseT: MAP.fuseTime, carrier };
    this.grenades = []; this.smokes = [];
    this.state = 'buy';
    this.roundT = BUY_TIME;
    this.phaseT = 0;
    this.events.push({ type: 'round', round: this.round });
  }

  // ---- economy ----
  buy(id) {
    if (this.state !== 'buy') return false;
    const p = this.player;
    const price = { armor: 650, frag: 300, smoke: 300 }[id] ?? WEAPONS[id]?.price ?? 99999;
    if (p.money < price) return false;
    if (id === 'armor') { if (p.armor >= 100) return false; p.armor = 100; }
    else if (id === 'frag') { if (p.frags >= 2) return false; p.frags++; }
    else if (id === 'smoke') { if (p.smokes >= 2) return false; p.smokes++; }
    else { if (!WEAPONS[id]) return false; giveWeapon(p, id); }
    p.money -= price;
    this.sfx.buy();
    return true;
  }

  // ---- movement / combat helpers used by player.js and bots.js ----
  moveFighter(f, dx, dz) {
    const p = { x: f.x, z: f.z };
    collideMove(p, f.x + dx, f.z + dz);
    f.x = p.x; f.z = p.z;
  }

  _dirFrom(yaw, pitch) {
    return {
      x: Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: Math.cos(yaw) * Math.cos(pitch),
    };
  }

  _fireHitscan(shooter, yaw, pitch, spread, w, pellets) {
    const eyeY = shooter.y + (shooter.crouched ? 1.05 : 1.62);
    let hitAny = false;
    for (let i = 0; i < pellets; i++) {
      const a = this.rng.gauss() * spread, b = this.rng.gauss() * spread;
      const d = this._dirFrom(yaw + a, pitch + b);
      const wallT = rayWalls(shooter.x, eyeY, shooter.z, d.x, d.y, d.z, w.range);
      let bestT = wallT, bestF = null, bestHead = false;
      for (const f of this.fighters) {
        if (f === shooter || f.team === shooter.team || !f.alive) continue;
        rayFighter(shooter.x, eyeY, shooter.z, d.x, d.y, d.z, f, Math.min(bestT, w.range), HIT);
        if (HIT.t < bestT) { bestT = HIT.t; bestF = f; bestHead = HIT.head; }
      }
      const ex = shooter.x + d.x * bestT, ey = eyeY + d.y * bestT, ez = shooter.z + d.z * bestT;
      this.events.push({ type: 'tracer', ox: shooter.x, oy: eyeY - 0.15, oz: shooter.z, x: ex, y: ey, z: ez, color: w.tracer });
      if (bestF) {
        hitAny = true;
        const dmg = Math.round(w.damage * (bestHead ? w.headMult : 1));
        this.damageFighter(bestF, dmg, shooter, bestHead);
        this.events.push({ type: 'impact', x: ex, y: ey, z: ez, head: bestHead });
      } else if (bestT < w.range) {
        this.events.push({ type: 'impact', x: ex, y: ey, z: ez, head: false });
      }
    }
    return hitAny;
  }

  playerShoot(p) {
    const w = WEAPONS[p.weapon];
    p.mag--;
    p.fireCooldown = 60 / w.rpm;
    p.bloom = Math.min(1.6, p.bloom + w.bloom);
    p.recoilP = Math.min(1.4, p.recoilP + w.recoil);
    p.pitch += w.recoil * 0.011;
    p.yaw += this.rng.gauss() * w.recoil * 0.004;
    this.stats.shots += w.pellets || 1;
    this.sfx.shot(w.sound);
    const hit = this._fireHitscan(p, p.yaw, p.pitch, spreadFor(w, spreadState(p)), w, w.pellets || 1);
    if (hit) this.stats.hits++;
    // gunfire is audible: nearby bots investigate
    for (const b of this.bots) if (b !== p) botHeardShot(b, p.x, p.z, this.time);
    this.events.push({ type: 'muzzle', fighter: p });
  }

  botShoot(bot, target, err) {
    const w = WEAPONS[bot.weapon];
    bot.mag--;
    const eyeY = bot.y + 1.55;
    const dx = target.x - bot.x, dz = target.z - bot.z;
    const d = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz) + this.rng.gauss() * err;
    const pitch = Math.atan2((target.y + 1.1) - eyeY, d) + this.rng.gauss() * err;
    this.sfx.shot(w.sound, true);
    const hit = this._fireHitscan(bot, yaw, pitch, err * 0.4, w, w.pellets || 1);
    if (hit && target === this.player) this.events.push({ type: 'shotAtPlayer' });
    for (const b of this.bots) if (b !== bot) botHeardShot(b, bot.x, bot.z, this.time);
    this.events.push({ type: 'muzzle', fighter: bot });
  }

  damageFighter(f, dmg, attacker, head) {
    if (!f.alive) return;
    let left = dmg;
    if (f.armor > 0) {
      const absorbed = Math.min(f.armor, Math.round(dmg * 0.5));
      f.armor -= absorbed; left -= absorbed;
    }
    f.hp -= left;
    if (f === this.player) {
      this.events.push({ type: 'damage', amount: left });
      this.sfx.hurt();
      this.player.lastDamageT = this.time;
    } else if (attacker === this.player) {
      this.events.push({ type: 'hitmark', kill: false });
      this.sfx.hit();
      this.stats.damage += left;
      if (head) this.stats.headshots++;
    }
    if (f.hp <= 0) this._kill(f, attacker, head);
  }

  _kill(f, attacker, head) {
    f.hp = 0; f.alive = false; f.deaths++;
    if (attacker) attacker.kills++;
    const wname = attacker ? WEAPONS[attacker.weapon]?.name || '' : '';
    this.killfeed.push({ a: attacker ? attacker.name : '—', aTeam: attacker ? attacker.team : 'vanguard', b: f.name, bTeam: f.team, w: wname, head });
    if (attacker === this.player) {
      this.player.money += 300;
      this.stats.kills++;
      this.events.push({ type: 'hitmark', kill: true });
      this.sfx.kill();
    }
    if (f === this.player) { this.stats.deaths++; this.events.push({ type: 'died' }); }
    // spike carrier drops the spike to the nearest living Crimson bot
    if (f.hasSpike) {
      f.hasSpike = false;
      const next = this.bots.find(b => b.team === 'crimson' && b.alive);
      if (next) { next.hasSpike = true; this.spike.carrier = next; }
      else this.spike.state = 'dropped';
    }
    this.events.push({ type: 'kill', victim: f });
    this._checkRoundEnd();
  }

  // ---- spike ----
  onPlantComplete(bot) {
    if (this.spike.state !== 'carried') return;
    this.spike.state = 'planted';
    this.spike.x = bot.x; this.spike.z = bot.z;
    this.spike.fuseT = MAP.fuseTime;
    this.events.push({ type: 'planted', x: bot.x, z: bot.z });
    this.sfx.plant();
    this.killfeed.push({ a: 'SPIKE', aTeam: 'crimson', b: 'PLANTED AT SITE ' + bot.site, bTeam: 'crimson', w: '', head: false });
  }
  onDefuseComplete(f) {
    if (this.spike.state !== 'planted') return;
    this.spike.state = 'defused';
    this.events.push({ type: 'defused' });
    this.sfx.defuse();
    this._endRound('vanguard', 'SPIKE DEFUSED');
  }

  // ---- grenades ----
  throwGrenade(kind) {
    const p = this.player;
    if (kind === 'frag' && p.frags <= 0) return;
    if (kind === 'smoke' && p.smokes <= 0) return;
    if (kind === 'frag') p.frags--; else p.smokes--;
    const d = this._dirFrom(p.yaw, p.pitch);
    this.grenades.push({
      kind, x: p.x, y: p.y + 1.5, z: p.z,
      vx: d.x * 15, vy: d.y * 15 + 3.5, vz: d.z * 15, t: kind === 'frag' ? 1.6 : 0.9,
    });
    this.sfx.click();
  }
  _explode(g) {
    this.events.push({ type: 'explosion', x: g.x, y: g.y, z: g.z });
    this.sfx.explosion();
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - g.x, f.z - g.z, (f.y + 1) - g.y);
      if (d > 7.5) continue;
      let dmg = Math.round(105 * (1 - d / 7.5) + 15);
      if (!hasLOS(g.x, g.y, g.z, f.x, f.y + 1, f.z)) dmg = Math.round(dmg * 0.5);
      this.damageFighter(f, dmg, this.player, false);
    }
  }

  // ---- fixed step ----
  step(dt, input) {
    this.time += dt;
    if (this.state === 'menu' || this.state === 'matchEnd') return;
    if (this.state === 'buy') {
      this.roundT -= dt;
      if (this.roundT <= 0) { this.state = 'live'; this.roundT = MAP.roundTime; this.events.push({ type: 'live' }); }
      return;
    }
    if (this.state === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.score.vanguard >= WIN_ROUNDS || this.score.crimson >= WIN_ROUNDS || this.round >= 9) {
          this.state = 'matchEnd';
          this.matchWinner = this.score.vanguard > this.score.crimson ? 'vanguard' : 'crimson';
          this.events.push({ type: 'matchEnd', winner: this.matchWinner });
        } else this.nextRound();
      }
      return;
    }
    // live
    this.roundT -= dt;
    const sec = Math.ceil(this.roundT);
    if (sec !== this.lastTickSecond) { this.lastTickSecond = sec; if (sec <= 5 && sec > 0) this.sfx.beep(); }
    if (this.spike.state === 'planted') {
      this.spike.fuseT -= dt;
      if (this.spike.fuseT <= 0) { this._endRound('crimson', 'SPIKE DETONATED'); return; }
    }
    if (this.roundT <= 0) { this._endRound('vanguard', 'TIME EXPIRED — SITES HELD'); return; }

    // player + bots
    playerStep(this.player, input, dt, this);
    for (const b of this.bots) botStep(b, dt, this);

    // grenades
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.vy -= 12 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      if (g.y <= 0.1) { g.y = 0.1; g.vy *= -0.35; g.vx *= 0.6; g.vz *= 0.6; this.sfx.bounce(); }
      g.t -= dt;
      if (g.t <= 0) {
        if (g.kind === 'frag') this._explode(g);
        else { this.smokes.push({ x: g.x, z: g.z, r: 4.5, t: 12 }); this.events.push({ type: 'smoke', x: g.x, z: g.z }); }
        this.grenades.splice(i, 1);
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      this.smokes[i].t -= dt;
      if (this.smokes[i].t <= 0) this.smokes.splice(i, 1);
    }
    this._checkRoundEnd();
  }

  _checkRoundEnd() {
    if (this.state !== 'live') return;
    const vAlive = this.fighters.filter(f => f.team === 'vanguard' && f.alive).length;
    const cAlive = this.fighters.filter(f => f.team === 'crimson' && f.alive).length;
    if (cAlive === 0 && this.spike.state !== 'planted') this._endRound('vanguard', 'ENEMY TEAM ELIMINATED');
    else if (vAlive === 0 && this.spike.state !== 'planted') this._endRound('crimson', 'SQUAD ELIMINATED');
    else if (vAlive === 0 && this.spike.state === 'planted') this._endRound('crimson', 'SQUAD ELIMINATED — SPIKE STANDS');
  }

  _endRound(winner, reason) {
    if (this.state !== 'live') return;
    this.state = 'roundEnd';
    this.phaseT = 4.5;
    this.roundWinner = winner;
    this.roundReason = reason;
    this.score[winner]++;
    if (winner === 'vanguard') {
      this.player.money += 3250; this.lossStreak = 0; this.sfx.roundWin();
    } else {
      this.player.money += 1900 + Math.min(this.lossStreak, 3) * 500;
      this.lossStreak++; this.sfx.roundLose();
    }
    this.events.push({ type: 'roundEnd', winner, reason });
  }
}
