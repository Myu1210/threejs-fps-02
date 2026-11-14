// input.js — one job: keyboard + mouse state, pointer lock, and the
// per-frame input record the sim consumes (forward/strafe/look deltas).
export function makeInput() {
  return {
    forward: 0, strafe: 0, lookDX: 0, lookDY: 0,
    sprint: false, crouch: false, jump: false, reload: false,
    use: false, clicked: false, triggerHeld: false,
    keys: new Set(),
  };
}
export function bindInput(input, canvas, callbacks) {
  const el = canvas;
  el.addEventListener('click', () => {
    if (document.pointerLockElement !== el) el.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    callbacks.onLockChange(document.pointerLockElement === el);
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== el) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  });
  document.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== el) return;
    if (e.button === 0) { input.triggerHeld = true; input.clicked = true; }
    if (e.button === 2) callbacks.onAim(true);
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.triggerHeld = false;
    if (e.button === 2) callbacks.onAim(false);
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    if (e.code === 'KeyR') input.reload = true;
    if (e.code === 'KeyE') input.use = true;
    if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
    if (e.code === 'KeyB') callbacks.onBuy();
    if (e.code === 'Digit1') callbacks.onSlot(1);
    if (e.code === 'Digit2') callbacks.onSlot(2);
    if (e.code === 'KeyG') callbacks.onGrenade('frag');
    if (e.code === 'Digit5') callbacks.onGrenade('smoke');
  });
  document.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
    if (e.code === 'KeyR') input.reload = false;
    if (e.code === 'KeyE') input.use = false;
    if (e.code === 'Space') input.jump = false;
  });
  document.addEventListener('blur', () => {
    input.keys.clear();
    input.triggerHeld = false; input.use = false; input.reload = false; input.jump = false;
  });
}
// Recompute held-state axes from the key set. Call once per fixed step.
export function pollInput(input) {
  const k = input.keys;
  input.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  input.strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  input.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
  input.crouch = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
  // one-shot jump: the sim step consumes the edge, pollInput re-arms it
  input.jumpEdge = input.jump;
}
