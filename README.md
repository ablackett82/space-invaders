# Space Invaders

A browser reimplementation of the 1978 arcade game (the Midway version),
built to run fullscreen on an iPad as a home-screen app. Plain HTML/JS, no
build step.

The game logic is traced routine by routine from Christopher Cantrell's
commented disassembly ([computerarcheology.com](https://computerarcheology.com/Arcade/SpaceInvaders/Code.html))
and checked frame by frame against the original program running in an 8080
emulator. The rack moving one alien per frame (and speeding up as it thins
out), the three kinds of alien shot and their firing tables, the shot reload
rate rising with the score, the saucer's scores and the famous 23rd-shot 300,
the shields eroding pixel by pixel, the attract mode with the alien fixing the
upside-down Y and shooting the extra C, two-player turns and the hidden
message all come from the original code. Even the timing does: the engine's
main thread runs on the original's measured CPU time, so screens wipe at the
cabinet's speed. The sounds are synthesized stand-ins for the cabinet's
analogue circuits, driven by the program's own sound bits. No ROM images are
included.

## Play

Open the site, then on iPad: Share → **Add to Home Screen**. The attract mode
is the title screen; tap to start.

- Touch: left half moves the cannon (a left/right pad, or a floating slider,
  under the cog), right half fires; the pause button beside the cog opens
  Resume / Restart game / Quit to title
- Keyboard: arrows / A D to move, Space / Z / up to fire; Space / Enter / 1
  starts a one-player game, 2 a two-player game; P pause, M mute, F fullscreen,
  Esc back to the title
- Gamepad: d-pad or left stick, any face button fires, Start starts

Holding fire keeps firing (it taps the button for you); turn that off under
the cog for the arcade feel.

Cheats, in the settings (the cog) or from the keyboard. Only Normal games
without cheats set the high score:

- Difficulty (C key): Normal is the arcade exactly; Easy runs at 75% speed and
  the aliens fire half as often; Super easy runs at 60%, fires half as often,
  and the aliens' shots can't hurt the cannon
- Unlimited lives (L key)
- Rapid fire (R key): the cannon's shot flies twice as fast
- Invaders never land (G key): the rack stops coming down just above the cannon
- Skip this wave (N key)

## How it was checked

`tools/buildrom.mjs` rebuilds the 8K program from the listing's byte column
and checks all four chips against MAME's checksums. The engine in `src/game`
keeps the original's memory layout, so `npm test` can play it and the
original side by side (`tools/emu`) and compare video RAM and work RAM every
frame: the attract mode, and one- and two-player games under scripted and
random input.

`data/tables.json` holds the program's data tables (sprites, font, messages
and so on) and 256 bits of the program itself, which the saucer's direction
is read from.

## Develop

```
curl -o reference/Code.md https://raw.githubusercontent.com/topherCantrell/computerarcheology/master/content/Arcade/SpaceInvaders/Code.md
npm run rom     # rebuild the program (reference/, gitignored) and data/tables.json
npm run dev     # http://localhost:8080/
npm test
```

`node tools/icons.mjs` redraws the home-screen icons;
`node tools/shot.mjs out.png frames [--ref] [--play]` renders a frame to PNG;
`node tools/emu/diff.mjs [frames] [attract|play|seed|2p:seed]` runs a long
comparison against the original, and `trace.mjs`, `half.mjs`, `counts.mjs`,
`profile.mjs` and `isrcost.mjs` in the same folder help chase a difference.
