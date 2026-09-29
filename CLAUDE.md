# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Aim trainer en three.js centrado en el ADS de The Finals. UI, comentarios y mensajes de commit en español.

## Comandos

```sh
npm ci          # instala exactamente lo del lockfile (solo three). No usar `npm install` sin motivo
npm start       # server.mjs -> http://localhost:5173 (solo 127.0.0.1)
npm run verify  # npm audit signatures + npm ls --all
```

No hay build, bundler, linter ni suite de tests. El navegador carga los módulos ES directamente. `node --check src/<archivo>.js` sirve para validar la sintaxis.

## Restricciones de seguridad (supply chain y CSP)

- **Una sola dependencia, `three`, con versión exacta fijada.** No añadir dependencias ni bundler sin que lo pida el usuario. Para actualizar three: elegir una versión con más de 14 días (`.npmrc` tiene `min-release-age=14`, `ignore-scripts`, `allow-git=none`) y luego ejecutar `npm run verify`.
- **`server.mjs` solo sirve una lista blanca:** `FILES` (rutas exactas) y `MOUNTS` (`/src/` y `/lib/three/` → `node_modules/three/build`), con las extensiones de `MIME`. Un archivo nuevo fuera de `src/`, o con otra extensión, da 404 hasta que se añada ahí. El servidor también rechaza los Host distintos de localhost.
- **CSP estricta** (`script-src 'self'`, `style-src 'self'`, en la cabecera del servidor y en el `<meta>` de `index.html`):
  - No se pueden usar scripts ni `<style>` inline, `eval`, ni `setAttribute('style', …)`. `el.style.x = …` y `style.setProperty` sí funcionan.
  - El menú construye el DOM con el helper `h()` de `menu.js`, sin `innerHTML`.
- **Import de three:** `import * as THREE from '/lib/three/three.module.js'`, con ruta absoluta.

## Arquitectura

**`main.js`: bucle y máquina de estados**
- Estados: `menu` → `playing` ↔ `paused` → `results`. Se pasa a `playing` o `paused` según `pointerlockchange`.
- `startSession()` crea `ctx = { scene, camera, player, settings, weapon, stats }` y lo pasa a `SCENARIOS[key].create(ctx)`.
- Orden de `update(dt)`:
  1. Progreso de ADS `adsT`, suavizado a `e`.
  2. FOV actual, interpolado linealmente en grados entre el de hipfire y el de ADS.
  3. Giro con el ratón: `hipDegPerCount × sensFactor(e)`.
  4. Movimiento WASD.
  5. `scenario.update`.
  6. Disparo según cadencia (`shotTimer`).
  7. Rayo central para `onTargetTime`.
  8. HUD.

**Disparo**
- Hitscan sin dispersión: cada bala va al centro exacto de la mira, por decisión del usuario.
- `castRay()` lanza el rayo contra `world.colliders` + `scenario.hitMeshes`.
- Cada mesh golpeable lleva `userData = { target, part: 'head' | 'body' }`.
- Los fallos contra el mundo dejan una marca de `impacts.js`.

**`settings.js`: ajustes**
- `DEFAULTS` y `SETTINGS_SCHEMA` generan automáticamente el formulario del menú (`showIf`, `min`/`max`, `hint`). Añadir un ajuste = poner su valor por defecto + su campo en el esquema.
- `loadSettings()` solo acepta valores guardados del mismo tipo que el default.
- La clave de localStorage está versionada (`finals-aim.settings.v2`). Si cambia la semántica de un ajuste, sube la versión y añade la clave antigua a `OLD_STORAGE_KEYS`.

**`scenarios.js`: escenarios**
- Registro `SCENARIOS`: `{ group, name, desc, spheres?, create(ctx) }`. El menú los agrupa por `group`.
- Los escenarios con `spheres` guardan el récord por `sphereScale` en lugar de por clase y distancia.
- Una instancia de escenario implementa:
  - `targets` y `hitMeshes`.
  - `update(dt)`.
  - `onHit(target, part, { dealt, killed })`.
  - `live(stats)`, `score(stats)`, `formatScore(x)`, `summary(stats)`.
  - `dispose()`.
- Clases base:
  - `TrackingScenario` recibe un `makeTarget(scenario)`.
  - `EliminationScenario` gestiona respawns con `pending`.
  - `SphereFlickScenario` es la base de Gridshot y Precisión.

**`target.js`: objetivos**
- `Target` (humanoide) y `SphereTarget` comparten interfaz: `hitMeshes`, `update(dt, camera)`, `applyDamage(amount, now)`, `dispose()`, `spawnTime`, `firstHitTime`.
- El movimiento del humanoide se configura con `opts.ai` (ver `DEFAULT_AI`). El cambio de sentido tiene en cuenta la distancia de frenada para no salirse de `lane` ni de `ai.depth`.

**`finals-save.js`: importar la configuración del juego**
- Lee `EmbarkOptionSaveGame.sav` en el navegador. Es un save GVAS de Unreal con pares de FString (`int32` de longitud con el `\0` incluido, negativa si es UTF-16) de la forma `GameplayOption.*` → valor en texto.
- `MAPPING` traduce claves del juego a ajustes del trainer, que se validan contra los rangos del esquema.
- El archivo solo se lee: nunca se modifica ni se envía a ningún sitio.

## Datos de The Finals ya verificados (no volver a suponer)

**Sensibilidad**
- **Yaw = 0.001 °/count** (`FINALS_YAW`). Sens 47 a 400 DPI = 48,638 cm/360. El 0.0066 es el yaw de Overwatch.
- **ADS:** sens de hipfire × `MouseZoomSensitivity`, en porcentaje. Con "Mouse Focal Length Sensitivity Scaling" en ON, además se multiplica por `tan(fovADS/2)/tan(fovHip/2)`.
- **Francotirador:** tiene su propio multiplicador (`MouseScopedZoomSensitivity`), pero su FOV (`fovMult: 0.4`) **no está verificado**.

**FOV**
- **El FOV del juego es vertical.** El usuario lo verificó midiendo la distancia de ratón de un borde de la pantalla al otro, en el juego y en el trainer.
- **FOV de ADS = FOV vertical de hipfire × nivel de la mira:** Low 1× = 0,78, Medium 1,25× = 0,68, High 1,5× = 0,58 (niveles del parche 7.0, porcentajes medidos por la comunidad). Depende de la mira, no del arma (`SIGHTS` en `weapons.js`).

**Objetivos y armas**
- **Vida por clase:** Light 150, Medium 250, Heavy 350.
- **Aproximado:** los tamaños de hitbox, velocidades y la cadencia, daño y tiempo de ADS de cada arma.

## Verificación sin suite de tests

Se prueba con Chrome headless controlado por el DevTools Protocol, con un script de Node sin dependencias (Node 22 trae `WebSocket` y `fetch` globales). Se lanza Chrome con `--headless=new --remote-debugging-port=… --enable-unsafe-swiftshader`.

- **Para simular el pointer lock:** redefinir `document.pointerLockElement` con `Object.defineProperty`, de modo que devuelva el canvas, y lanzar `pointerlockchange`. Los botones del ratón se simulan con `mousedown`/`mouseup` sobre `document` (`button` 0 = disparo, 2 = ADS). El movimiento, con `pointerrawupdate` o `mousemove` y `movementX`/`movementY`.
- **Para probar la lógica:** `await import('/src/…')` desde la página devuelve las mismas instancias de módulo que usa el juego. Sirve para crear escenarios con un `ctx` falso y, parcheando el prototipo, para leer el estado interno (p. ej. `Target.prototype.update`).
- **Trampa:** cualquier interacción con el menú guarda los ajustes que hay en memoria. Para probar con otros ajustes, escribe en localStorage y recarga la página **antes** de hacer clic en nada.
