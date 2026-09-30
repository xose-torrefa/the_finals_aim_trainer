# The Finals Aim Trainer

A browser-based aim trainer built with three.js, focused on how aiming down sights (ADS) works in **THE FINALS**: the same sensitivity math, the same vertical FOV and the same zoom levels per sight, so the muscle memory you build here carries over to the game.

**▶ Play it now: <https://xose-torrefa.github.io/the_finals_aim_trainer/>**

No install, no account, no tracking. Everything runs in your browser and your data stays in `localStorage`.

> Unofficial fan project. Not affiliated with or endorsed by Embark Studios.

## Features

- **Game-accurate sensitivity and FOV.** Enter your in-game sens and DPI, or import them straight from your game config file.
- **13 scenarios** in three groups: humanoid targets, THE FINALS situations (jump pads, peeks, changing range…) and classic sphere drills.
- **Scenarios vs. Sandbox.** Scenarios have fixed settings so scores stay comparable over time; Sandbox lets you tweak everything.
- **Progress tracking.** Personal bests, average of your last 10 runs, trend, daily streak, a progress chart and full history for every scenario.
- **Aim analysis** after each run: whether you track behind or ahead of the target (in ms), how you handle direction changes, and flick overshoot/undershoot.
- **Routines.** Built-in playlists (Warm-up, Tracking, Flicks and precision) plus your own.
- **Customizable crosshair** with separate hipfire and ADS profiles, first-person weapon models, tracers and synthesized sounds.
- **Backup** your settings, history and routines to a JSON file and restore them anywhere.
- **English and Spanish** UI.

## Controls

| Action | Default |
| --- | --- |
| Shoot | Left click |
| ADS | Right click |
| Move | WASD |
| Restart | R (configurable) |
| Pause | Esc |

Each run starts paused: click to capture the mouse and a countdown begins (3 s by default, configurable in Settings → Game). Play in fullscreen (button or F11) so the view matches the game.

## Modes

- **Scenarios**: each scenario has a fixed configuration (weapon, targets, distance, speed, duration) so your scores are comparable. Every run is saved with the cm/360 and FOV you used, and the scenario page shows your record, averages, trend, chart and history.
- **Sandbox**: everything is configurable (weapon, target class and behaviour, distance, player movement, duration…). Runs are not saved.

Your personal settings (sensitivity, FOV, ADS, focal length scaling, crosshair, audio, countdown) apply in both modes.

## Scenarios

**Humanoids**

| Scenario | Description |
| --- | --- |
| Tracking | An immortal target strafes, jumps and dashes. Keep your ADS on it. |
| Close tracking | At 7 m, like a close-range fight: constant direction changes, moving in and out, jumps and dashes. |
| Duel | One enemy with its class's health (Light 150 / Medium 250 / Heavy 350). Measures reaction time, TTK and ideal TTK. |
| Target switching | Three enemies at once, like a team fight. Kill and switch fast. |
| ADS flick | Static one-hit targets across a 120° arc. |

**THE FINALS situations**

| Scenario | Description |
| --- | --- |
| Jump pads | The target launches itself off jump pads and air-strafes while it falls. |
| Changing range | It walks between 8 and 44 m without stopping its strafe. |
| Peeks | An enemy peeks out from behind three covers, jiggles and hides again. Pre-aim the edges. |
| Tracking on the move | Time on target only counts while you move with WASD. |

**Spheres**

| Scenario | Description |
| --- | --- |
| Gridshot | Three spheres at once on a grid. Speed and rhythm. |
| Precision | A small sphere that respawns a few degrees away. Micro-adjustments in ADS. |
| 3D tracking | A floating sphere with smooth paths in all three dimensions. |

## Sensitivity and FOV

- **Sensitivity** can be entered as THE FINALS sens (yaw 0.001 °/count: sens 47 at 400 DPI = 48.64 cm/360), as cm/360, or as sens × a custom yaw to convert from other games.
- **FOV** is vertical, like in THE FINALS (verified by measuring the mouse distance from one edge of the screen to the other, in game and in the trainer). Horizontal 16:9 and true horizontal are also available for other games.
- **ADS FOV** depends on the sight's zoom level, as in the game: Low 1× = 78 %, Medium 1.25× = 68 %, High 1.5× = 58 % of your hipfire FOV (patch 7.0 levels, percentages measured by the community). The sniper scope FOV is not verified yet.
- **ADS and scoped sensitivity** are percentages, like in the game (78 % by default), with *Mouse Focal Length Sensitivity Scaling* ON/OFF (ON also scales by zoom, i.e. 0 % monitor distance). Settings shows the FOV and ADS cm/360 for each sight level, and which percentage would give 0 % monitor distance.
- Weapon stats (`src/weapons.js`) and hitbox sizes (`src/target.js`) are approximations. Corrections are welcome.

## Import your game settings

Settings → Import from THE FINALS can load your game's config file (button or drag and drop):

```
%LOCALAPPDATA%\Discovery\Saved\SaveGames\EmbarkOptionSaveGame.sav
```

It imports sensitivity, FOV, ADS sensitivity (`MouseZoomSensitivity`), scoped sensitivity (`MouseScopedZoomSensitivity`), focal length scaling and crosshair color. You still have to enter your DPI by hand. The file is parsed in the browser (`src/finals-save.js`): it is never modified or uploaded anywhere.

## Your data

Settings, history and routines are stored in your browser's `localStorage`, per site. If you switch between the hosted version and a local copy, use Settings → Backup to export them from one and import them into the other. Imports are merged: runs you already have are not duplicated.

## Running locally

Requires Node.js 20 or newer (npm 11+ recommended, so the `.npmrc` options are understood).

```sh
git clone https://github.com/xose-torrefa/the_finals_aim_trainer.git
cd the_finals_aim_trainer
npm ci       # installs exactly what the lockfile says (only three)
npm start    # http://localhost:5173
```

There is no build step: the browser loads the ES modules directly from `src/`.

### Hosting your own copy

The workflow in `.github/workflows/pages.yml` deploys to GitHub Pages on every push to `main`. In your fork, go to Settings → Pages → Source and choose **GitHub Actions**.

## Security

The project keeps its supply chain as small as possible:

- **A single dependency**, `three`, which has no dependencies of its own. No bundler.
- Exact version pinned and a lockfile with integrity hashes. Use `npm ci`, not `npm install`.
- `.npmrc` sets `ignore-scripts`, `save-exact`, `allow-git=none`, `min-release-age=14` and an explicit registry.
- `npm run verify` checks registry signatures and the dependency tree.
- `server.mjs` has no dependencies, only listens on `127.0.0.1`, serves an allowlist of paths, rejects path traversal and foreign `Host` headers, and sends a strict CSP (`script-src 'self'`, no inline scripts or `eval`).
- The Pages workflow runs `npm ci` + `npm run verify`, pins actions by commit SHA and uses minimal per-job permissions. GitHub Pages cannot send custom headers, so there only the CSP in the `<meta>` tag applies.

To update three: read the changelog, pick a version older than 14 days, run `npm install three@X`, then `npm run verify`.

## Contributing

Issues and pull requests are welcome, especially measurements from the game (weapon stats, hitboxes, the sniper FOV). Please keep the constraints above in mind: no new dependencies, and no inline scripts or styles (the CSP blocks them). [`CLAUDE.md`](CLAUDE.md) describes the architecture in detail (in Spanish). Code comments and commit messages are in Spanish; UI strings live in `src/lang/` and must be added to every language.

By submitting a pull request, you agree that your contribution is licensed under the same terms as the project (see below).

## License

Copyright © 2026 xose-torrefa.

This project is licensed under [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-nc-sa/4.0/) (CC BY-NC-SA 4.0). See [`LICENSE`](LICENSE) for the full text. In short:

- **You can** use it, fork it, modify it and share it.
- **You must** give credit, link to the license and indicate if you made changes.
- **You can't** use it for commercial purposes.
- **Share alike:** if you publish a modified version, it must use the same license.

For commercial use, get in touch. [three.js](https://threejs.org/) is included under its own MIT license. THE FINALS is a trademark of Embark Studios; this license only covers this project's own code.
