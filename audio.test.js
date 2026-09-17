// Headless check: does the audio engine actually schedule notes?
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/index.html', 'utf8')
  .match(/<script>([\s\S]*)<\/script>/)[1];
const block = src.slice(src.indexOf('let actx = null'),
                        src.indexOf('/* ---------- input ----------'));

let started = [];   // every oscillator/buffer that actually got start()ed
let now = 0;

function node(extra) {
  return Object.assign({
    connect() {}, disconnect() {},
    gain:      param(), frequency: param(), Q: param(),
  }, extra || {});
}
function param() {
  return { value: 0,
           setValueAtTime(v) { this.value = v; },        // record it, like the real AudioParam
           setTargetAtTime() {},
           exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
}

class FakeCtx {
  constructor() {
    this.state = 'suspended';          // browsers start here until a gesture
    this.sampleRate = 48000;
    this.destination = node();
    this.resumeCalls = 0;
  }
  get currentTime() { return now; }
  // Real browsers resume ASYNCHRONOUSLY - state stays 'suspended' for the
  // remainder of the current tick. Flipping it synchronously would hide the
  // exact race the retry path exists to handle.
  resume() {
    this.resumeCalls++;
    return Promise.resolve().then(() => { this.state = 'running'; });
  }
  createGain() { return node(); }
  createBiquadFilter() { return node({ type: '' }); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createOscillator() {
    const o = node({ type: 'square' });
    o.start = t => started.push({ kind: 'osc', type: o.type, hz: o.frequency.value, t });
    o.stop = () => {};
    return o;
  }
  createBufferSource() {
    const s = node({ buffer: null });
    s.start = t => started.push({ kind: 'noise', t });
    s.stop = () => {};
    return s;
  }
}

const timers = [];
const sandbox = {
  console, Math, Promise, Float32Array, setInterval: fn => (timers.push(fn), timers.length),
  clearInterval: () => {}, window: { AudioContext: FakeCtx },
  state: 'play', paused: false,
};
vm.createContext(sandbox);
vm.runInContext(block + '\n;this.musicStart=musicStart;this.musicStop=musicStop;'
  + 'this.SFX=SFX;this.setMuted=setMuted;this.getCtx=()=>actx;'
  + 'this.getOn=()=>musicOn;this.tickAll=()=>musicTick();', sandbox);

const fail = [];
const ok = (cond, msg) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) fail.push(msg); };

// 1. Page load: loadLevel calls musicStart while the context is still suspended.
sandbox.musicStart();
const ctx = sandbox.getCtx();
ok(ctx instanceof FakeCtx, 'AudioContext gets constructed');
ok(sandbox.getOn() === false, 'music does NOT start while context is suspended');
ok(started.length === 0, 'no notes scheduled into a suspended clock');

// 2. First keypress -> resume() resolves -> the retry path should kick in.
setTimeout(() => {
  ok(sandbox.getOn() === true, 'music starts once resume() resolves');

  // 3. Advance the clock and pump the scheduler like the real interval would.
  const before = started.length;
  for (let i = 0; i < 40; i++) { now += 0.2; timers.forEach(fn => fn()); }
  const notes = started.length - before;
  ok(notes > 0, 'scheduler emits notes as the clock advances (' + notes + ' in 8s)');

  const types = [...new Set(started.filter(s => s.kind === 'osc').map(s => s.type))];
  ok(types.includes('square') && types.includes('triangle'),
     'both square and triangle voices present [' + types.join(', ') + ']');
  ok(started.some(s => s.kind === 'noise'), 'percussion (noise) voices present');

  const hz = started.filter(s => s.kind === 'osc').map(s => s.hz);
  ok(hz.every(f => f > 0 && isFinite(f)), 'every scheduled note has a valid frequency');
  ok(Math.min(...hz) > 40 && Math.max(...hz) < 5000,
     'frequencies in a musical range (' + Math.min(...hz).toFixed(0) + '-' + Math.max(...hz).toFixed(0) + ' Hz)');

  // 4. SFX still fire independently.
  const n = started.length;
  sandbox.SFX.jump(); sandbox.SFX.coin(); sandbox.SFX.gameover();
  ok(started.length > n, 'SFX schedule sound (' + (started.length - n) + ' voices)');

  // 5. Stop actually stops.
  sandbox.musicStop();
  ok(sandbox.getOn() === false, 'musicStop() clears the playing flag');
  const m = started.length;
  now += 5; timers.forEach(fn => fn());
  ok(started.length === m, 'no notes scheduled after musicStop()');

  console.log(fail.length ? '\nFAILED: ' + fail.length : '\nALL CHECKS PASSED');
  process.exit(fail.length ? 1 : 0);
}, 10);
