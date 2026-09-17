// Headless harness: boots the real game in a stubbed DOM and drives it.
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/index.html', 'utf8')
  .match(/<script>([\s\S]*)<\/script>/)[1];

// --- auto-stubbing 2D context: any method is a no-op, any property sticks ---
function ctx2d() {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'canvas') return { width: 400, height: 240 };
      if (k === 'measureText') return () => ({ width: 8 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const mkCanvas = () => ({ width: 0, height: 0, style: {}, getContext: ctx2d,
                          addEventListener() {} });

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

let rafCb = null;
const listeners = {};
const sandbox = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, isFinite, parseInt,
  Float32Array, Uint8ClampedArray, Promise, Error, RegExp, localStorage,
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  performance: { now: () => 0 },
  requestAnimationFrame: cb => { rafCb = cb; return 1; },
  setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1,
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  document: {
    // The real page has all of these; return a live stub for any id.
    getElementById: id => (id === 'game' ? sandbox.__canvas
                                         : { style: {}, addEventListener() {} }),
    createElement: () => mkCanvas(),
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  },
};
sandbox.__canvas = mkCanvas();
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// Expose the internals we want to assert on.
const EXPORTS = `
  globalThis.__api = {
    get state(){ return state; }, get lives(){ return lives; },
    get score(){ return score; }, set score(v){ score = v; },
    get coins(){ return coins; }, set coins(v){ coins = v; },
    get checkpoint(){ return checkpoint; }, set checkpoint(v){ checkpoint = v; },
    get player(){ return player; }, get camX(){ return camX; },
    grid: grid, TILE: TILE, CHECKPOINTS: CHECKPOINTS, START_LIVES: START_LIVES,
    solidAt: solidAt, update: update, saveGame: saveGame, readSave: readSave,
    clearSave: clearSave, newGame: newGame, continueGame: continueGame,
    loadLevel: loadLevel, SAVE_KEY: SAVE_KEY,
    tracks: { LEAD: LEAD, HARM: HARM, BASS: BASS, PERC: PERC }, MLEN: MLEN,
    noteHz: noteHz,
  };
`;
// Inject the export just INSIDE the game's closing IIFE, don't remove it.
const body = src.replace(/\}\)\(\);\s*$/, EXPORTS + '\n})();');
if (body === src) throw new Error('could not find the closing IIFE to inject into');
vm.runInContext(body, sandbox);

const A = sandbox.__api;
const fail = [];
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail.push(m); };

console.log('--- boot ---');
ok(A.state === 'play', 'game boots into play state');
ok(A.START_LIVES === 100, 'START_LIVES is 100');
ok(A.lives === 100, 'fresh game starts with 100 lives (got ' + A.lives + ')');

console.log('\n--- checkpoints are on solid ground ---');
for (let i = 0; i < A.CHECKPOINTS.length; i++) {
  const col = A.CHECKPOINTS[i];
  // Player spawns at y = 11*TILE and falls. Find the first solid tile below.
  let groundRow = -1;
  for (let y = 11; y < 15; y++) if (A.solidAt(col, y)) { groundRow = y; break; }
  ok(groundRow !== -1, 'CP' + i + ' (col ' + col + ') has ground beneath it'
     + (groundRow !== -1 ? ' at row ' + groundRow : ' -- PLAYER WOULD FALL INTO A PIT'));
  // And the spawn cell itself must be clear, or the player spawns inside a wall.
  let clear = true;
  for (let y = 11; y < 13; y++) if (A.solidAt(col, y)) clear = false;
  ok(clear, 'CP' + i + ' (col ' + col + ') spawn cell is not inside a solid tile');
}

console.log('\n--- save round-trip ---');
A.clearSave();
ok(A.readSave() === null, 'readSave() returns null with no save present');
A.score = 12345; A.coins = 37; A.checkpoint = 2;
A.saveGame();
const s = A.readSave();
ok(s !== null, 'saveGame() then readSave() returns a save');
ok(s.score === 12345, 'score round-trips (' + (s && s.score) + ')');
ok(s.coins === 37, 'coins round-trip (' + (s && s.coins) + ')');
ok(s.checkpoint === 2, 'checkpoint round-trips (' + (s && s.checkpoint) + ')');

console.log('\n--- resume from save ---');
A.continueGame();
ok(A.score === 12345, 'continueGame() restores score');
ok(A.checkpoint === 2, 'continueGame() restores checkpoint');
ok(A.player.x === A.CHECKPOINTS[2] * A.TILE,
   'player spawns at CP2 x=' + A.CHECKPOINTS[2] * A.TILE + ' (got ' + A.player.x + ')');
ok(A.camX > 0, 'camera is snapped forward, not showing the level start (camX=' + A.camX + ')');

console.log('\n--- tampered saves are rejected or clamped ---');
store.set(A.SAVE_KEY, 'not json at all');
ok(A.readSave() === null, 'malformed JSON rejected');
store.set(A.SAVE_KEY, JSON.stringify({ v: 99, score: 1, lives: 1 }));
ok(A.readSave() === null, 'wrong schema version rejected');
store.set(A.SAVE_KEY, JSON.stringify({ v: 1, score: -5, lives: -3, coins: 999, checkpoint: 77 }));
const t = A.readSave();
ok(t && t.lives >= 1, 'negative lives clamped up (' + (t && t.lives) + ')');
ok(t && t.score >= 0, 'negative score clamped to 0 (' + (t && t.score) + ')');
ok(t && t.checkpoint <= A.CHECKPOINTS.length - 1,
   'out-of-range checkpoint clamped (' + (t && t.checkpoint) + ')');

console.log('\n--- checkpoints trigger while playing ---');
A.newGame();
ok(A.checkpoint === 0, 'newGame() resets checkpoint to 0');
ok(A.readSave() === null, 'newGame() wipes the old save');
// Walk the player forward past CP1 and step the sim.
A.player.x = A.CHECKPOINTS[1] * A.TILE + 8;
A.update();
ok(A.checkpoint === 1, 'crossing CP1 advances the checkpoint (got ' + A.checkpoint + ')');
ok(A.readSave() !== null, 'crossing a checkpoint writes a save');
A.player.x = A.CHECKPOINTS[3] * A.TILE + 8;
A.update();
ok(A.checkpoint === 3, 'skipping ahead advances past intermediate checkpoints');

console.log('\n--- music tracks ---');
// Misaligned tracks desync the voices silently, so pin the lengths.
for (const n of Object.keys(A.tracks)) {
  ok(A.tracks[n].length === A.MLEN,
     n + ' is ' + A.tracks[n].length + ' steps, matching MLEN=' + A.MLEN);
}
for (const n of ['LEAD', 'HARM', 'BASS']) {
  const bad = A.tracks[n].filter(v => v && (!isFinite(v.f) || v.f <= 0));
  ok(bad.length === 0, n + ' has no unparseable notes (a typo yields f=0 = silence)');
}
ok(A.tracks.PERC.every(t => ['K', 'S', 'H', '-', '.'].includes(t)),
   'PERC uses only known drum tokens');
ok(Math.abs(A.noteHz('A4') - 440) < 0.01, 'noteHz is in tune (A4 = 440Hz)');

console.log('\n--- sim stability ---');
A.newGame();
let threw = null;
try { for (let i = 0; i < 1200; i++) A.update(); } catch (e) { threw = e; }
ok(!threw, '1200 frames (20s) run without throwing' + (threw ? ': ' + threw.message : ''));

console.log(fail.length ? '\nFAILED: ' + fail.length : '\nALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
