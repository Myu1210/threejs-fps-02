// render.js — one job: everything three.js draws, synced from sim state.
// Fixed pools for tracers / impacts / smoke: no new objects in the hot loop.
import * as THREE from 'three';
import { MAP } from './map.js';
import { WEAPONS } from './weapons.js';

const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();

function groundTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2e3138'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke();
  }
  // worn patches + hazard stripes near sites
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 50, 12 + Math.random() * 30);
  g.fillStyle = '#c9a227';
  for (let i = 0; i < 8; i++) g.fillRect(20 + i * 18, 470, 9, 26);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 6);
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function labelSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.fill();
  g.fillStyle = '#0b0e13'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.set(3.4, 3.4, 1);
  return s;
}
function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(220,225,230,0.85)');
  grad.addColorStop(1, 'rgba(220,225,230,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class Renderer {
  constructor(container, sim) {
    this.sim = sim;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.domElement.className = 'webgl';
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2432);
    this.scene.fog = new THREE.Fog(0x1a2432, 30, 95);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
    // lights: dusk sun + cool sky fill
    const sun = new THREE.DirectionalLight(0xffb36b, 2.2);
    sun.position.set(-18, 32, 12); this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x8fb4d8, 0x2a2018, 0.9));
    const fill = new THREE.DirectionalLight(0x6db7ff, 0.5);
    fill.position.set(20, 18, -14); this.scene.add(fill);

    this._buildWorld();
    this._buildFighters();
    this._buildViewmodel();
    this._buildPools();
    window.addEventListener('resize', () => this._resize());
  }
  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _buildWorld() {
    const g = new THREE.Group(); this.scene.add(g);
    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP.halfX * 2 + 2, MAP.halfZ * 2 + 2),
      new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.05 }));
    ground.rotation.x = -Math.PI / 2; g.add(ground);
    // dusk sky dome
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(110, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x2c3e55, side: THREE.BackSide, fog: false }));
    g.add(sky);
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(9, 32),
      new THREE.MeshBasicMaterial({ color: 0xff9a4d, fog: false }));
    sunDisc.position.set(-70, 26, -60); sunDisc.lookAt(0, 10, 0); g.add(sunDisc);
    // obstacles: dark steel boxes with a warm top trim
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const matBody = new THREE.MeshStandardMaterial({ color: 0x4a525e, roughness: 0.8, metalness: 0.35 });
    const matTall = new THREE.MeshStandardMaterial({ color: 0x37414e, roughness: 0.85, metalness: 0.3 });
    const matCrate = new THREE.MeshStandardMaterial({ color: 0x8a6b34, roughness: 0.9, metalness: 0.15 });
    for (const o of MAP.obstacles) {
      const isWall = o.h >= 5;
      const m = new THREE.Mesh(boxGeo, isWall ? matTall : o.h <= 1.3 ? matCrate : matBody);
      m.scale.set(o.hx * 2, o.h, o.hz * 2);
      m.position.set(o.x, o.h / 2, o.z);
      g.add(m);
      if (!isWall) {
        const trim = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6, metalness: 0.4 }));
        trim.scale.set(o.hx * 2 + 0.06, 0.08, o.hz * 2 + 0.06);
        trim.position.set(o.x, o.h + 0.02, o.z);
        g.add(trim);
      }
    }
    // site markers: glowing rings + floating A/B
    this.siteRings = {};
    for (const key of ['A', 'B']) {
      const s = MAP.sites[key];
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(s.r - 0.25, s.r, 40),
        new THREE.MeshBasicMaterial({ color: 0xffd23d, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.06, s.z);
      g.add(ring); this.siteRings[key] = ring;
      const label = labelSprite(key, '#ffd23d');
      label.position.set(s.x, 4.6, s.z); g.add(label);
      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(1.1, 24),
        new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.9 }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(s.x, 0.05, s.z); g.add(pad);
    }
    // spike prop (hidden until planted)
    this.spikeMesh = new THREE.Group();
    const spikeBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.8 }));
    spikeBody.position.y = 0.18; this.spikeMesh.add(spikeBody);
    this.spikeLight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    this.spikeLight.position.y = 0.45; this.spikeMesh.add(this.spikeLight);
    this.spikeMesh.visible = false;
    g.add(this.spikeMesh);
  }

  _makeFighterMesh(team) {
    const grp = new THREE.Group();
    const col = team === 'vanguard' ? 0x3f7fd0 : 0xd04a3a;
    const dark = team === 'vanguard' ? 0x1d2f45 : 0x451f1a;
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.75 });
    const darkMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.85 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.75, 10), bodyMat);
    torso.position.y = 0.95; grp.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 }));
    head.position.y = 1.52; grp.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.7 }));
    visor.position.set(0, 1.54, 0.18); grp.add(visor);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.26), darkMat);
    legs.position.y = 0.3; grp.add(legs);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.4, metalness: 0.7 }));
    gun.position.set(0.22, 1.15, 0.3); grp.add(gun);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5), bodyMat);
    arm.position.set(0.22, 1.2, 0.1); grp.add(arm);
    grp.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return grp;
  }
  _buildFighters() {
    this.fighterMeshes = new Map();
    for (const f of this.sim.fighters) {
      if (f.isBot === false && f === this.sim.player) continue; // player has a viewmodel
      const mesh = this._makeFighterMesh(f.team);
      this.scene.add(mesh);
      this.fighterMeshes.set(f.id, mesh);
    }
  }
  _buildViewmodel() {
    this.vm = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.35, metalness: 0.75 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
    this.vm.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.42); this.vm.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.09), dark);
    grip.position.set(0, -0.13, 0.16); grip.rotation.x = 0.3; this.vm.add(grip);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), accent);
    sight.position.set(0, 0.09, -0.1); this.vm.add(sight);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), dark);
    mag.position.set(0, -0.12, -0.05); this.vm.add(mag);
    this.vm.position.set(0.28, -0.26, -0.55);
    this.camera.add(this.vm);
    this.scene.add(this.camera);
    // muzzle flash: small plane + point light, shown for one frame burst
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0, depthWrite: false }));
    this.flash.position.set(0, 0.02, -0.6); this.vm.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffc36b, 0, 9, 1.6);
    this.flashLight.position.set(0, 0, -0.7); this.vm.add(this.flashLight);
    this.flashT = 0;
  }
  _buildPools() {
    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      line.visible = false; this.scene.add(line);
      this.tracers.push({ line, t: 0 });
    }
    this.tracerI = 0;
    this.impacts = [];
    const puffTex = puffTexture();
    for (let i = 0; i < 20; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xffcf7a, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; this.scene.add(s);
      this.impacts.push({ s, t: 0 });
    }
    this.impactI = 0;
    this.explosion = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0 }));
    this.explosion.visible = false; this.scene.add(this.explosion);
    this.explosionT = 0;
    this.explosionLight = new THREE.PointLight(0xff8a3d, 0, 22, 1.4);
    this.scene.add(this.explosionLight);
    this.smokeSprites = [];
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xbfc6cc, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; this.scene.add(s);
      this.smokeSprites.push({ s, t: 0, x: 0, z: 0 });
    }
    this.smokeI = 0;
  }

  _spawnTracer(ox, oy, oz, x, y, z, color) {
    const tr = this.tracers[this.tracerI]; this.tracerI = (this.tracerI + 1) % this.tracers.length;
    const pos = tr.line.geometry.attributes.position;
    pos.setXYZ(0, ox, oy, oz); pos.setXYZ(1, x, y, z); pos.needsUpdate = true;
    tr.line.material.color.setHex(color);
    tr.line.material.opacity = 0.9; tr.line.visible = true; tr.t = 0.07;
  }
  _spawnImpact(x, y, z) {
    const im = this.impacts[this.impactI]; this.impactI = (this.impactI + 1) % this.impacts.length;
    im.s.position.set(x, y, z); im.s.scale.set(0.5, 0.5, 1);
    im.s.material.opacity = 0.95; im.s.visible = true; im.t = 0.22;
  }

  drainEvents(dt) {
    const evs = this.sim.events;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'tracer') this._spawnTracer(e.ox, e.oy, e.oz, e.x, e.y, e.z, e.color);
      else if (e.type === 'impact') this._spawnImpact(e.x, e.y, e.z);
      else if (e.type === 'muzzle' && e.fighter === this.sim.player) { this.flashT = 0.06; }
      else if (e.type === 'explosion') {
        this.explosion.position.set(e.x, e.y, e.z);
        this.explosion.visible = true; this.explosionT = 0.5;
        this.explosionLight.position.set(e.x, e.y + 1, e.z);
      } else if (e.type === 'smoke') {
        for (let k = 0; k < 6; k++) {
          const sp = this.smokeSprites[this.smokeI]; this.smokeI = (this.smokeI + 1) % this.smokeSprites.length;
          sp.x = e.x + (Math.random() - 0.5) * 4; sp.z = e.z + (Math.random() - 0.5) * 4;
          sp.s.position.set(sp.x, 0.8 + Math.random() * 1.4, sp.z);
          sp.s.scale.set(4, 4, 1); sp.s.material.opacity = 0.55; sp.s.visible = true; sp.t = 12;
        }
      } else if (e.type === 'planted') {
        this.spikeMesh.position.set(e.x, 0, e.z); this.spikeMesh.visible = true;
      } else if (e.type === 'defused' || e.type === 'roundEnd') {
        this.spikeMesh.visible = false;
      }
    }
    evs.length = 0;
    // decay pools
    for (const tr of this.tracers) if (tr.t > 0) { tr.t -= dt; tr.line.material.opacity = Math.max(0, tr.t / 0.07) * 0.9; if (tr.t <= 0) tr.line.visible = false; }
    for (const im of this.impacts) if (im.t > 0) { im.t -= dt; im.s.material.opacity = Math.max(0, im.t / 0.22) * 0.95; if (im.t <= 0) im.s.visible = false; }
    if (this.explosionT > 0) {
      this.explosionT -= dt;
      const k = 1 - this.explosionT / 0.5;
      this.explosion.scale.setScalar(1 + k * 6);
      this.explosion.material.opacity = Math.max(0, 0.85 * (1 - k));
      this.explosionLight.intensity = 60 * (1 - k);
      if (this.explosionT <= 0) { this.explosion.visible = false; this.explosionLight.intensity = 0; }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.material.opacity = this.flashT > 0 ? 0.95 : 0;
      this.flashLight.intensity = this.flashT > 0 ? 14 : 0;
      this.flash.rotation.z = Math.random() * Math.PI;
    }
    for (const sp of this.smokeSprites) {
      if (sp.t > 0) { sp.t -= dt; sp.s.material.opacity = Math.min(0.55, sp.t * 0.1); if (sp.t <= 0) sp.s.visible = false; }
    }
  }

  sync(dt, now) {
    const sim = this.sim, p = sim.player;
    // camera = player eyes (crouch lowers it)
    const eyeH = p.crouched ? 1.05 : 1.62;
    this.camera.position.set(p.x, p.y + eyeH + Math.sin(now * 9) * (p.moving && p.grounded ? 0.025 : 0), p.z);
    this.camera.rotation.y = p.yaw + Math.PI;
    this.camera.rotation.x = p.pitch - p.recoilP * 0.02;
    // aim: tighten FOV, centre the viewmodel
    const w = WEAPONS[p.weapon];
    const targetFov = p.aiming ? (w.scoped ? 34 : 52) : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }
    this.vm.position.x += ((p.aiming ? 0 : 0.28) - this.vm.position.x) * Math.min(1, dt * 14);
    this.vm.position.y += ((p.aiming ? -0.19 : -0.26) - this.vm.position.y) * Math.min(1, dt * 14);
    this.vm.position.z = -0.55 + p.recoilP * 0.05;
    // fighters
    for (const f of sim.fighters) {
      const mesh = this.fighterMeshes.get(f.id);
      if (!mesh) continue;
      mesh.visible = f.alive || f.deaths > 0; // corpses stay until round reset
      mesh.position.set(f.x, f.y, f.z);
      if (!f.alive) { mesh.rotation.set(0, f.yaw + Math.PI, Math.PI / 2 - 0.15); mesh.position.y = 0.25; continue; }
      mesh.rotation.set(0, f.yaw + Math.PI, 0);
      mesh.position.y = f.y + (f.moving ? Math.abs(Math.sin(now * 11 + f.id)) * 0.05 : 0);
      mesh.scale.y = f.crouched ? 0.72 : 1;
    }
    // spike blink
    if (this.spikeMesh.visible) {
      const blink = Math.sin(now * 6) > 0;
      this.spikeLight.material.color.setHex(blink ? 0xff3b30 : 0x881111);
      this.siteRings[sim.spike.site].material.color.setHex(0xff3b30);
    } else {
      this.siteRings.A.material.color.setHex(0xffd23d);
      this.siteRings.B.material.color.setHex(0xffd23d);
    }
    this.drainEvents(dt);
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
