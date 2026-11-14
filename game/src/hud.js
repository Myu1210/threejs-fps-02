// hud.js — one job: every DOM HUD update + the 2D minimap + buy menu.
// Reads sim state, writes DOM. No game logic here.
import { MAP } from './map.js';
import { WEAPONS, SHOP } from './weapons.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(sim, onBuyItem) {
    this.sim = sim;
    this.onBuyItem = onBuyItem;
    this.mm = $('minimap').getContext('2d');
    this.lastHp = -1;
    this._buildShop();
  }
  _buildShop() {
    const shop = $('shop');
    shop.innerHTML = '';
    for (const item of SHOP) {
      const div = document.createElement('div');
      div.className = 'item';
      div.dataset.id = item.id;
      div.innerHTML = `<span>${item.label}<small>${item.desc}</small></span><span class="price">$${item.price}</span>`;
      div.addEventListener('click', () => this.onBuyItem(item.id));
      shop.appendChild(div);
    }
  }
  refreshShop() {
    const p = this.sim.player;
    $('buymoney').textContent = '$' + p.money;
    for (const div of document.querySelectorAll('#shop .item')) {
      const id = div.dataset.id;
      const price = SHOP.find(s => s.id === id).price;
      div.classList.toggle('cant', p.money < price);
      const owned = (id === 'armor' && p.armor >= 100) ||
        (id === p.weapon) || (id === 'frag' && p.frags >= 2) || (id === 'smoke' && p.smokes >= 2);
      div.classList.toggle('owned', owned);
    }
  }
  showBuy(open) {
    $('buy').classList.toggle('hidden', !open);
    if (open) this.refreshShop();
  }
  showHud(show) { $('hud').classList.toggle('hidden', !show); }

  banner(big, sub, ms = 2600) {
    $('bannerbig').textContent = big;
    $('bannersub').textContent = sub || '';
    $('banner').classList.remove('hidden');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => $('banner').classList.add('hidden'), ms);
  }
  hint(text, ms = 3000) {
    const h = $('hint');
    if (!text) { h.classList.add('hidden'); return; }
    h.textContent = text;
    h.classList.remove('hidden');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => h.classList.add('hidden'), ms);
  }
  hitmark(kill) {
    const hm = $('hitmark');
    hm.classList.toggle('kill', !!kill);
    hm.style.opacity = '1';
    clearTimeout(this._hm);
    this._hm = setTimeout(() => { hm.style.opacity = '0'; }, 130);
  }
  damageFlash(amount) {
    const d = $('dmg');
    d.style.opacity = Math.min(1, 0.35 + amount / 90);
    clearTimeout(this._df);
    this._df = setTimeout(() => { d.style.opacity = '0'; }, 220);
  }
  killfeedPush(k) {
    const kf = $('killfeed');
    const div = document.createElement('div');
    div.innerHTML = `<span class="${k.aTeam === 'vanguard' ? 'v' : 'c'}">${k.a}</span> <span class="w">${k.head ? '◉ ' : ''}${k.w || ''}</span> <span class="${k.bTeam === 'vanguard' ? 'v' : 'c'}">${k.b}</span>`;
    kf.prepend(div);
    while (kf.children.length > 5) kf.removeChild(kf.lastChild);
    setTimeout(() => div.remove(), 6000);
  }

  update() {
    const sim = this.sim, p = sim.player;
    // timer + score
    const t = Math.max(0, Math.ceil(sim.roundT));
    const timer = $('timer');
    timer.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    timer.classList.toggle('low', sim.state === 'live' && t <= 10);
    $('score').innerHTML = `<span class="v">VANGUARD ${sim.score.vanguard}</span> &nbsp;—&nbsp; <span class="c">${sim.score.crimson} CRIMSON</span>`;
    // objective line
    const sp = sim.spike;
    let obj = 'DEFEND BOTH SITES';
    if (sp.state === 'planted') obj = `<span class="hot">⚠ SPIKE PLANTED — ${Math.ceil(sp.fuseT)}s — DEFUSE IT (HOLD E)</span>`;
    else if (sp.state === 'carried') obj = `CRIMSON CARRIES THE SPIKE · LIKELY SITE ${sp.site}`;
    else if (sim.state === 'buy') obj = 'BUY PHASE — PRESS B TO SHOP';
    $('objective').innerHTML = obj;
    // team counts
    const v = sim.fighters.filter(f => f.team === 'vanguard' && f.alive).length;
    const c = sim.fighters.filter(f => f.team === 'crimson' && f.alive).length;
    $('teamcount').innerHTML = `<span class="v">⬢ VANGUARD ${v} ALIVE</span><br><span class="c">⬢ CRIMSON ${c} ALIVE</span><br>ROUND ${sim.round} / 9 · FIRST TO 5`;
    // health / armor / money
    const hp = $('health');
    hp.textContent = Math.max(0, Math.ceil(p.hp));
    hp.classList.toggle('low', p.hp <= 30);
    $('armor').textContent = p.armor > 0 ? '🛡 ARMOUR ' + Math.ceil(p.armor) : '';
    $('money').textContent = '$' + p.money;
    // ammo
    const w = WEAPONS[p.weapon];
    $('ammo').innerHTML = `${p.mag} <span class="res">/ ${p.reserve}</span>`;
    $('weaponname').textContent = w.name + (p.weapon === 'needle' && p.aiming ? ' · SCOPED' : '');
    $('firemode').textContent = (w.auto ? 'AUTO' : 'SEMI') + ' · [1] PRIMARY · [2] SIDEARM · [G] FRAG · [5] SMOKE';
    $('reload').classList.toggle('hidden', p.reloading <= 0);
    // plant/defuse bar
    const prog = p.defuseT > 0 ? p.defuseT / 4 : 0;
    $('plantbar').classList.toggle('hidden', prog <= 0);
    if (prog > 0) { $('plantlabel').textContent = 'DEFUSING SPIKE…'; $('plantfill').style.width = (prog * 100) + '%'; }
    // crosshair spread follows bloom + movement
    const spread = 4 + p.bloom * 9 + (p.moving ? 4 : 0) + (p.aiming ? -3 : 0);
    const ch = $('crosshair');
    ch.style.transform = `scale(${1 + Math.max(0, spread) / 26})`;
    ch.style.opacity = p.aiming ? '0.85' : '1';
    if (sim.state === 'buy') $('buytimer').textContent = Math.ceil(sim.roundT) + 's';
    this._drawMinimap();
  }

  _drawMinimap() {
    const ctx = this.mm, W = 168, H = 126;
    const sx = (x) => (x + MAP.halfX) / (MAP.halfX * 2) * W;
    const sz = (z) => (z + MAP.halfZ) / (MAP.halfZ * 2) * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, W, H);
    // obstacles
    ctx.fillStyle = '#3a4552';
    for (const o of MAP.obstacles) {
      ctx.fillRect(sx(o.x - o.hx), sz(o.z - o.hz), (o.hx * 2) / 64 * W, (o.hz * 2) / 48 * H);
    }
    // sites
    for (const key of ['A', 'B']) {
      const s = MAP.sites[key];
      ctx.fillStyle = this.sim.spike.state === 'planted' ? '#ff5d4d' : '#ffd23d';
      ctx.beginPath(); ctx.arc(sx(s.x), sz(s.z), 7, 0, 7); ctx.fill();
      ctx.fillStyle = '#0b0e13'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(key, sx(s.x), sz(s.z));
    }
    // spike
    if (this.sim.spike.state === 'planted') {
      ctx.strokeStyle = '#ff5d4d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(this.sim.spike.x), sz(this.sim.spike.z), 10, 0, 7); ctx.stroke();
    }
    // smoke
    for (const s of this.sim.smokes) {
      ctx.fillStyle = 'rgba(200,200,200,0.5)';
      ctx.beginPath(); ctx.arc(sx(s.x), sz(s.z), 8, 0, 7); ctx.fill();
    }
    // fighters
    for (const f of this.sim.fighters) {
      if (!f.alive) continue;
      ctx.fillStyle = f.team === 'vanguard' ? '#6db7ff' : '#ff7a6b';
      ctx.beginPath(); ctx.arc(sx(f.x), sz(f.z), f === this.sim.player ? 4 : 3, 0, 7); ctx.fill();
      if (f === this.sim.player) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx(f.x), sz(f.z), 5.5, 0, 7); ctx.stroke();
      }
    }
  }
}
