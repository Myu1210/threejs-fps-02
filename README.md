# SABLE YARD

A make.fun threejs-fps-02 entry: a round-based tactical FPS built with three.js. The game is plain static files in `game/`, playable offline in a desktop browser.

## Play

`node serve.ts`, then open http://localhost:8080 in a desktop browser.

## Build the submission

`mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` — copies `game/` and `screenshots/` to the output and writes `dossier.json`.
