# Mona Sweeper

A candy-pastel GitHub contribution-graph Minesweeper game starring Mona the Octocat.
Uncover clean commit tiles, flag hidden regression bugs, chord verified regions,
and ship a clean release.

## Origins

Mona Sweeper was created by Christina Warren ([@filmgirl](https://github.com/filmgirl))
and originally published at <https://github.com/filmgirl/mona-sweeper>. This repository
is a copy that preserves the full project history, maintained by
[@jdooley-clt](https://github.com/jdooley-clt) during her leave so the game stays
published. All credit for the game belongs to its creator.

## Play

Play online at **<https://jdooley-clt.github.io/mona-sweeper/>**, or find more games in
[GitHub Arcade](https://jdooley-clt.github.io/arcade/).

It can also be installed as an app: use **Install** in Chrome or Edge's address
bar, or **Share → Add to Home Screen** on iPhone and iPad. The app uses the same
pixel Mona icon as the favicon.

Or run the local preview server with Node.js 22 or newer. There is nothing to
install or build for the game itself:

```sh
npm start
```

Then visit <http://127.0.0.1:4181/>. Use `PORT=4182 npm start` for another port.
The server is loopback-only and serves only the published files.

## Controls

| Action | Control |
| --- | --- |
| Move grid cursor | ← / ↑ / ↓ / → or W / A / S / D |
| Reveal tile (or perform active mode action) | Click, tap, Space, or Enter |
| Flag / unflag suspected bug | Right-click, F, Flag tile button, or tap in **Mode: Flag** |
| Switch Reveal / Flag tap mode | **Mode: Reveal / Flag** button or X |
| Chord adjacent tiles | Double-click, middle-click, C, Chord button, or click/Space on a satisfied number |
| New board | R, N, New board button, or Mona status badge |
| Switch repository size | Starter 9×9, Active 12×12, or Monorepo 14×12 buttons |
| Pause / resume | P or Escape, or the Ⅱ button. Space also resumes |
| Mute all audio | M |
| Theme, music, effects, help | Separate buttons in the header |

Space and the arrow keys never scroll the page, even when a button has focus.
Navigation links keep their normal keyboard behavior instead of controlling the game.
The game pauses automatically when its window or tab loses focus.

## Rules

- **First-click safety**: your first revealed tile in any repository is guaranteed
  to open a bug-free 3×3 neighborhood, cascading into a clean contribution-graph opening.
- **Clean commits**: tiles with `0` adjacent bugs display contribution-graph greens
  and automatically flood-fill connected clean regions.
- **Clue numbers (`1`–`8`)**: show how many hidden bugs occupy the 8 surrounding tiles.
- **Bug flags**: mark suspected bugs with coral flags. Flagged tiles are protected
  from accidental reveals.
- **Chording**: when a revealed number tile already has matching adjacent flags,
  chording (`C`, double-click, middle-click, or clicking/pressing Space on that number)
  uncovers all remaining unflagged neighbors at once.
- **Three repository presets**:
  - **Starter Repo (`hello-world`)**: `9×9` grid with `10` bugs
  - **Active Repo (`octo-garden`)**: `12×12` grid with `22` bugs
  - **Monorepo (`actions-fleet`)**: `14×12` grid with `28` bugs
- Your best score, fastest clear time per repository size, theme, and audio
  preferences are stored in this browser's `localStorage` when available.

## Develop

```sh
npm ci                # Playwright only; the game has no runtime dependencies
npm test              # Node tests for engine, server, manifest, and icons
npm start
```

The favicon and app icons (`assets/favicon.svg`, `assets/*.png`) are generated
from one 16×16 pixel map in `scripts/icons.mjs`. Edit the map, then run
`npm run icons`; a test fails if the committed icons drift from the map.

`src/engine.js` is a DOM-free simulation, so all Minesweeper rules (first-click
safety, flood-fill cascade, flagging, chording, win/loss detection, and timer)
are unit tested in Node.

## Cabinet compatibility

The footer's GitHub Arcade link is shown only on the standalone site, not inside
an iframe, so it cannot navigate the cabinet's game frame back into the cabinet.

The Playwright suite runs the real [Commit Cabinet](https://github.com/jdooley-clt/arcade)
at a pinned commit with the staged game on the same origin, like GitHub Pages:

```sh
npm ci
npx playwright install chromium webkit
npm run cabinet:setup
npm run build
npm run test:cabinet
```

`npm run build` copies only the published files into `_site/`. The harness serves
the cabinet at `/arcade/` and `_site/` at `/mona-sweeper/`, testing desktop
Chromium, Pixel 7 mobile Chromium, and iPhone 13 mobile WebKit at 320px and 390px
widths.

## Source layout

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Interface, themes, and responsive contribution-graph layout |
| `manifest.webmanifest` | Web app manifest for installing the game |
| `src/engine.js` | Deterministic DOM-free Minesweeper simulation |
| `src/main.js` | Board rendering, keyboard/pointer/touch input, HUD, audio, and storage |
| `src/music.js` | Original synthesized Web Audio chiptune |
| `scripts/` | Preview server, site staging, icon generator, and cabinet harness |
| `tests/` | Node engine/icon tests and the Playwright cabinet suite |

## Credits

An unofficial fan game, not a GitHub product. Not affiliated with or endorsed
by GitHub.

- Pixel Octocat artwork (`assets/octocat.svg`, `assets/mona-sweeper-character.svg`,
  `assets/favicon.svg`, `assets/*.png`) is adapted from the Commit Cabinet's
  approved pixel Octocat. The Octocat design is copyright GitHub, Inc. and subject
  to [GitHub's artwork terms](https://octodex.github.com/faq/).
- GitHub mark: [Primer Octicons](https://github.com/primer/octicons), under its
  [MIT license](assets/Octicons-LICENSE.txt).
- Board illustrations, UI, and Web Audio effects/chiptune are original to this
  project and licensed under the [MIT License](LICENSE).

