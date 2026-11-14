// audio.js — one job: synthesised sound effects (WebAudio, no audio files).
// Every sound is built from oscillators / filtered noise at play time.
export class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.enabled = true;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.enabled = false; }
  }
  _noiseBuf(dur) {
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  _burst(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(dur);
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }
  _tone(freq, dur, gain, type = 'square', slideTo = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  }
  shot(kind, distant = false) {
    if (!this.ctx) return;
    const g = distant ? 0.16 : 0.5;
    if (kind === 'sniper') { this._burst(0.28, 900, g); this._tone(140, 0.22, g * 0.7, 'sine', 55); }
    else if (kind === 'shotgun') { this._burst(0.22, 700, g); this._tone(110, 0.18, g * 0.6, 'sine', 45); }
    else if (kind === 'smg') { this._burst(0.09, 1600, g * 0.8); this._tone(220, 0.06, g * 0.35, 'square', 120); }
    else if (kind === 'rifle') { this._burst(0.13, 1200, g); this._tone(180, 0.09, g * 0.5, 'square', 80); }
    else { this._burst(0.08, 2000, g * 0.7); this._tone(260, 0.05, g * 0.3, 'square', 140); }
  }
  dry() { this._tone(1400, 0.03, 0.12, 'square'); }
  reload() { this._tone(900, 0.04, 0.14, 'square'); setTimeout(() => this._tone(650, 0.04, 0.14, 'square'), 180); setTimeout(() => this._tone(1100, 0.05, 0.16, 'square'), 420); }
  hit() { this._tone(1900, 0.05, 0.2, 'sine'); }
  kill() { this._tone(880, 0.09, 0.22, 'sine'); setTimeout(() => this._tone(1320, 0.12, 0.22, 'sine'), 90); }
  hurt() { this._tone(160, 0.15, 0.3, 'sawtooth', 70); }
  beep(final = false) { this._tone(final ? 1500 : 1050, 0.09, 0.25, 'sine'); }
  plant() { for (let i = 0; i < 3; i++) setTimeout(() => this._tone(1050, 0.08, 0.22, 'sine'), i * 160); }
  defuse() { this._tone(1250, 0.08, 0.2, 'sine'); setTimeout(() => this._tone(1250, 0.08, 0.2, 'sine'), 200); }
  explosion() { this._burst(0.9, 320, 0.9); this._tone(70, 0.8, 0.7, 'sine', 28); }
  bounce() { this._tone(320, 0.05, 0.15, 'sine', 180); }
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 0.2, 'triangle'), i * 130)); }
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.18, 0.2, 'triangle'), i * 140)); }
  buy() { this._tone(740, 0.06, 0.18, 'sine'); setTimeout(() => this._tone(988, 0.08, 0.18, 'sine'), 70); }
  click() { this._tone(1200, 0.03, 0.12, 'square'); }
}
