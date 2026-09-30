# Contributing

Issues and pull requests are welcome, especially new scenarios and measurements from the game (weapon stats, hitboxes, the sniper FOV).

A few rules apply to every change:

- **No new dependencies** and no bundler. The browser loads the ES modules in `src/` directly.
- **No inline scripts or styles.** The CSP blocks them. Build DOM with the `h()` helper from `src/dom.js`, not `innerHTML`.
- Code comments and commit messages are in Spanish. UI strings live in `src/lang/`.
- [`CLAUDE.md`](CLAUDE.md) describes the architecture in detail (in Spanish).

To run it locally: `npm ci`, then `npm start`, then open <http://localhost:5173>. There is no build step and no test suite, so check your change in the browser with the console open.

## Adding a scenario

Each scenario is one file in [`src/scenarios/`](src/scenarios/). Adding one means:

1. **Create `src/scenarios/<key>.js`.** The easiest way is to copy a similar scenario. See [Picking a starting point](#picking-a-starting-point).
2. **Register it in [`src/scenarios/index.js`](src/scenarios/index.js):** add the import, then add it to `LIST`. Its position in `LIST` is its position in the menu.
3. **Add its name and description** to [`src/lang/en.js`](src/lang/en.js):
   ```js
   'scenario.<key>': 'My scenario',
   'scenario.<key>.desc': 'One or two sentences: what the target does and what it trains.',
   ```
   If you can, add them to the other languages too. If you leave them out, the UI falls back to English.

That's it. The scenario shows up in the Scenarios page, in Sandbox and in the routine editor.

### The definition

A scenario file exports a plain object:

```js
import { TrackingScenario, spawnPoint } from './base.js';

// What the target does, in a line or two
export default {
  key: 'mykey',          // stable id, lowercase letters and digits
  group: 'humanoids',    // menu group: 'humanoids' | 'situations' | 'spheres'
  version: 1,
  fixed: { weapon: 'ar' },
  score: 'percent',      // 'percent' (time on target) | 'kills'
  create: (ctx) => new TrackingScenario(ctx, (sc) => {
    const { player, settings } = ctx;
    const t = sc.newTarget({ hp: Infinity, lane: 3, ai: { jumpChance: 0.3 } });
    t.place(spawnPoint(player, settings.targetDistance, 0), player.pos);
  }),
};
```

| Field | Meaning |
| --- | --- |
| `key` | **Never change it once released.** Run history and saved routines are stored under it. |
| `group` | Which section of the menu it appears in. |
| `spheres` | Optional. `true` if the targets are spheres: the card then hides target class and distance. |
| `version` | Starts at 1. See [Versions](#versions). |
| `fixed` | Settings forced in Scenarios mode, on top of `RANKED_BASE` in `index.js` (medium targets at 20 m, 60 s, weapon fire rate…). Keys and values must be valid settings (see `DEFAULTS` in `src/settings.js`). |
| `distanceLabel` | Optional. Distance shown on the card when it isn't `targetDistance` (e.g. `'7 m'`, `'8–44 m'`). |
| `score` | How the score is shown and charted. |
| `create(ctx)` | Returns the scenario instance for one run. |

`index.js` checks every definition when the page loads. A wrong group, an unknown setting, a duplicate key and similar mistakes throw an error in the console that names the scenario. Missing texts only log a warning.

In `create`, always read `ctx.settings`, never the global settings. In Scenarios mode it holds the effective settings with `fixed` applied. In Sandbox it holds whatever the player chose, so a scenario should also behave sensibly with other distances, speeds and target classes.

### Picking a starting point

The base classes in [`src/scenarios/base.js`](src/scenarios/base.js) cover most ideas:

- **`TrackingScenario(ctx, makeTarget)`**: one target that can't die. The score is time on target. `makeTarget(sc)` creates and places the target. Examples: `follow.js` (key `tracking`), `aerial.js`, `range.js`.
- **`EliminationScenario(ctx, { count, arc, respawnDelay })`**: `count` targets with their class's health, spread across ±`arc` degrees, which respawn after dying. Measures kills, reaction time and TTK. Examples: `duel.js`, `switching.js`.
- **`SphereFlickScenario`**: one-hit spheres. Extend it and implement `spawn()`. Examples: `gridshot.js`, `precision.js`.
- **`Scenario`**: the bare base, for anything else. Examples: `peek.js`, `flick.js`.

If your scenario needs its own class, put it in the scenario's file, the way `peek.js` does. Move code into `base.js` only when several scenarios share it.

Target behaviour is configured with options. For humanoids, these go to `sc.newTarget(opts)`: `hp`, `move`, `lane`, and `ai` (jumps, dashes, direction changes, depth, jump pads…; see `DEFAULT_AI` in [`src/target.js`](src/target.js)). For spheres they go to `sc.newSphere(opts)`. If you add a new option to `target.js`, its default must keep the current behaviour, so existing scenarios don't change.

A scenario with its own class implements `update(dt)`, `onHit(target, part, { dealt, killed })`, `live(stats)`, `score(stats)`, `summary(stats)` and `dispose()`. `summary` returns `[textKey, value]` pairs, and new text keys go in `src/lang/`.

### Versions

History is stored per `key@version`, so runs are only compared with runs of the same version. **Bump `version`** whenever you change what a scenario asks of the player: its `fixed` settings, its target behaviour, its timing or its scoring. Otherwise new scores get mixed with old ones that aren't comparable. Leave a short comment explaining the bump:

```js
// v2: free fire rate
version: 2,
```

Visual-only changes (colours, effects) don't need a bump.

### File names

Name the file after the key, but **avoid words that ad blockers filter in URLs**, such as `track`, `tracking`, `ads`, `banner`, `popup`, `analytics`, `pixel` or `fullscreen`. If a single module is blocked, the whole app fails to load. That's why the tracking scenarios use `follow` in their file names (the key `tracking` lives in `follow.js`) while keeping their original keys.

### Before opening the pull request

- Play the scenario from the Scenarios page and from Sandbox, and check that the console shows no errors or warnings.
- Check the results page: score, summary and the aim analysis card.
- Restart it (R) and quit it from the pause menu, and check that nothing stays behind in the scene.
- Say in the PR what the scenario trains and why its settings (weapon, distance, speed) make sense for THE FINALS.

By submitting a pull request, you agree that your contribution is licensed under the same terms as the project (see [`LICENSE`](LICENSE)).
