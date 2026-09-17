# Super Plumber Bros

A side-scrolling platformer in a single HTML file. No dependencies, no build step, no assets — every sprite is drawn from a pixel map defined in the source, and all sound is synthesized at runtime with the Web Audio API.

### ▶ [Play it here](https://ivanbarties-coder.github.io/mario-game/)

Or clone the repo and open `index.html` directly in any modern browser — there is nothing to install and nothing to build.

## Controls

| Action | Keys |
| --- | --- |
| Move | Arrow keys or `A` / `D` |
| Jump | `Z`, `K`, or `Space` (hold for height) |
| Run | `X`, `J`, or `Shift` |
| Duck | Down arrow or `S` (big form only) |
| Pause | `P` |
| Restart | `R` |
| New game (wipes save) | `N` |
| Mute | `M` |

On touch devices an on-screen D-pad and A/B buttons appear automatically.

## Features

- Momentum-based physics with variable-height jumping and per-axis AABB collision
- Small and big forms; taking a hit shrinks you before it kills you
- Goombas, and Koopas that collapse into shells you can kick into other enemies
- Question blocks, coins, mushrooms, and bricks that only break in the big form
- Pits, pipes, staircases, and a flagpole finish with score bonus by height
- Score, coin counter, lives, a 400-second timer, and a 1-up every 100 coins
- Four checkpoints that save your run to `localStorage`, so closing the tab resumes where you left off
- An original four-voice chiptune loop and synthesized sound effects, mutable with `M`

## Technical notes

The game runs on a fixed 60 Hz timestep accumulator, so physics stay consistent regardless of display refresh rate. Rendering targets a 400×240 internal canvas that is integer-scaled to the viewport with `image-rendering: pixelated`, which keeps pixels sharp at any window size.

Sprites are declared as arrays of equal-length strings, one character per pixel, mapped through a shared palette and baked into offscreen canvases at load. The level is a 212×15 character grid built procedurally from `rect`/`put`/`pipe` helpers, which makes it straightforward to edit by hand.

Progress persists to `localStorage` under a versioned key. A save is written when you cross a checkpoint, when you lose a life, and on a ten-second timer; it is cleared when the course is completed, when you run out of lives, or when you press `N`. Saves are read back defensively — wrong schema version, malformed JSON, and out-of-range values are all rejected or clamped, since the contents are trivially user-editable and a bad checkpoint index would otherwise spawn the player inside a wall.

`game.test.js` and `audio.test.js` run the real game headlessly in a stubbed DOM. Run them with `node game.test.js`.

## Legal

A non-commercial fan homage to the 1985 platformer that inspired it, written from scratch. All code, level design, and music are original work — no Nintendo code, files, or recordings were used, and the soundtrack is an original composition rather than a transcription. The character sprites are hand-drawn pixel art, but they are deliberate stylistic homages and visually resemble characters from the original.

Mario, Super Mario Bros., and the associated characters are trademarks of Nintendo. This project is unaffiliated with, unendorsed by, and not approved by Nintendo.

## License

MIT
