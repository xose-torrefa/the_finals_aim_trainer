# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Aim trainer en three.js centrado en el ADS de The Finals. Comentarios y mensajes de commit en español. La UI está en inglés (por defecto) y en español (ver **`i18n.js`**).

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
  - La UI construye el DOM con el helper `h()` de `dom.js`, sin `innerHTML`.
- **Import de three:** `import * as THREE from '/lib/three/three.module.js'`, con ruta absoluta.

## Arquitectura

**`main.js`: bucle y máquina de estados**
- Estados: `menu` → `ready` → `countdown` → `playing` ↔ `paused` → `results`.
  - `ready`: la partida está creada pero espera un clic en el overlay (hace falta un gesto para capturar el ratón).
  - `countdown`: dura `settings.countdown` s (0 = se salta). Se puede mirar y apuntar, pero ni moverse ni disparar, y ni el tiempo ni los objetivos avanzan. Se repite al volver de la pausa.
  - Al capturar el ratón (`pointerlockchange`) se pasa de `ready`/`paused` a la cuenta atrás; al perderlo, de `countdown`/`playing` a `paused`.
- `startSession(key, ranked)` crea `ctx = { scene, camera, player, settings, weapon, stats }` y lo pasa a `SCENARIOS[key].create(ctx)`. Si el ratón ya está capturado (reinicio en plena partida) va directo a la cuenta atrás; si no, a `ready`.
- `settings.restartKey` (un `KeyboardEvent.code`) reinicia la última partida desde `ready`, `countdown`, `playing`, `paused` y la página de resultados.
- Orden de `update(dt)` (se llama en `countdown` y `playing`):
  1. Progreso de ADS `adsT`, suavizado a `e`.
  2. FOV actual, interpolado linealmente en grados entre el de hipfire y el de ADS.
  3. Giro con el ratón: `hipDegPerCount × sensFactor(e)`.
  4. En `countdown`, aquí se actualiza la cuenta atrás y se sale.
  5. Movimiento WASD y `viewmodel.update` (también en la cuenta atrás, antes de salir).
  6. `scenario.update`.
  7. Disparo según cadencia (`shotTimer`) y `tracers.update`.
  8. Rayo central para `onTargetTime` y `analysis.frame()` (antes del disparo se llama a `analysis.sample()`).
  9. HUD.
- Render en dos pasadas (`renderer.autoClear = false`): el mundo y, si hay partida, `clearDepth()` + la escena del arma.

**UI: `menu.js` y `overlay.js`**
- `menu.js` es el menú a pantalla completa, con barra lateral y páginas: `scenarios` (tarjetas por grupo), `scenario` (ficha con estadísticas, gráfica e historial), `sandbox`, `settings` (pestañas por sección + valores efectivos) y `results`. Cada página se reconstruye al navegar; `refresh()` actualiza lo que depende de los ajustes sin perder el foco.
- `overlay.js` es la capa sobre la escena durante la partida: "Haz clic para empezar", la cuenta atrás y el menú de pausa. Desde la pausa, "Ajustes" abre el menú con una tarjeta de "Partida en pausa" en la barra lateral.

**Disparo**
- Hitscan sin dispersión: cada bala va al centro exacto de la mira, por decisión del usuario.
- `castRay()` lanza el rayo contra `world.colliders` + `scenario.colliders` + `scenario.hitMeshes`.
- Cada mesh golpeable lleva `userData = { target, part: 'head' | 'body' }`.
- Los fallos contra el mundo dejan una marca de `impacts.js`.
- `viewmodel.js` es el arma en primera persona: escena y cámara propias (FOV `viewmodelFov`), modelos hechos con primitivas según `weapon.key` y la mira. En ADS pone el eje de la mira (`y`, `z`) en el centro de la pantalla; los visores (`scoped`) ocultan el arma con el ADS completo. El retroceso es solo visual. También dibuja el fogonazo.
- `tracers.js`: las trazadoras salen de donde se ve la boca del cañón (`muzzleNdc` proyectado a la cámara del mundo) y van al punto de impacto. Son solo visuales.

**Modos Escenarios / Sandbox**
- El modo lo decide la página desde la que se lanza la partida (`ranked` en `startSession`). En Escenarios, `scenarioSettings()` (en `scenarios.js`) impone `RANKED_BASE` + el `fixed` de cada escenario sobre los ajustes del usuario. La sesión guarda esos ajustes efectivos en `ctx.settings`; `update()` y los escenarios deben leer siempre `ctx.settings`, nunca el `settings` global.
- Las secciones del esquema con `page: 'sandbox'` solo se muestran y se aplican en Sandbox; las de `page: 'settings'` son lo personal (sens, FOV, ADS, color, cuenta atrás…) y valen en ambos modos. `settings.scenario` es el escenario elegido en Sandbox.
- `history.js` guarda cada partida del modo Escenarios bajo `escenario@version`. **Si cambias la configuración efectiva de un escenario (`fixed`, `RANKED_BASE` o su lógica de dificultad), sube su `version`**; si no, se mezclan puntuaciones que no son comparables.

**`analysis.js`: análisis de la puntería**
- `AimAnalysis` se crea por sesión y no cambia la puntuación. Sale en la tarjeta de análisis de los resultados (Escenarios y Sandbox) y no se guarda en el historial.
- Tracking: toma el objetivo más cercano a la mira y mide el error en la dirección en que se mueve en pantalla (> 0 = mira por detrás), convertido a ms. Solo cuenta mientras el jugador está "enganchado" (histéresis sobre `4 × radio angular`). Los 0,4 s tras un cambio de sentido se miden aparte.
- Flicks: en el primer impacto a un objetivo con vida finita, analiza el recorrido de la mira desde el último impacto/kill o la aparición. El movimiento principal acaba cuando la velocidad cae al 20 % del pico; si ese punto está más allá del radio angular del objetivo es overshoot, y si no llega, undershoot.
- Los objetivos exponen `aimInfo()` → `{ center, half, radius }` (centro, semialtura y radio en m).

**Copia de seguridad (Ajustes → Copia de seguridad)**
- Exporta un JSON `{ app: 'finals-aim', version, exported, settings, history }`. Al importar, `mergeHistory()` añade las partidas sin duplicar (misma `t` en el mismo `escenario@versión`) y solo con campos numéricos conocidos; los ajustes pasan por `sanitizeSettings()` y se aplican con `onReplace` (sin sonidos de prueba, reconstruyendo el menú).

**`settings.js`: ajustes**
- `DEFAULTS` y `SETTINGS_SCHEMA` generan automáticamente los formularios del menú (`page`, `tab` para juntar secciones en una pestaña, `showIf`, `min`/`max`; tipos `select`, `checkbox`, `color`, `number` y `key`). El esquema no lleva textos: `section`/`tab` son ids (`section.<id>`), la etiqueta es `field.<text ?? key>` y la pista, si existe en el diccionario, `field.<…>.hint`; las opciones son `[valor, clave de texto]`. Añadir un ajuste = poner su valor por defecto + su campo en el esquema + sus textos en todos los idiomas.
- La mira tiene dos perfiles con los mismos campos (`CROSSHAIR_KEYS`) y prefijos `crosshair*` / `adsCrosshair*`. `adsCrosshair` decide qué se ve en ADS: `dot` (hipfire sin líneas), `same` o `custom`. `crosshair.js` la dibuja con divs (capa de contorno + capa de relleno) y se usa tanto en el HUD como en la vista previa de Ajustes.
- `sanitizeSettings()` (lo usan `loadSettings()` y la copia de seguridad) solo acepta valores del mismo tipo que el default, y en los `select`, solo si siguen siendo una de las opciones.
- La clave de localStorage está versionada (`finals-aim.settings.v2`). Si cambia la semántica de un ajuste, sube la versión y añade la clave antigua a `OLD_STORAGE_KEYS`.

**`scenarios.js`: escenarios**
- Registro `SCENARIOS`: `{ group, spheres?, version, fixed, distanceLabel?, formatScore, formatTick, create(ctx) }`. El menú los agrupa por `group` (un id: `humanoids`, `situations`, `spheres`). Nombre y descripción van en los diccionarios (`scenarioName(key)`, `scenarioDesc(key)`, `groupName(group)`).
- Una instancia de escenario implementa:
  - `targets` y `hitMeshes`.
  - `colliders` (geometría propia que para las balas, p. ej. las coberturas de Peeks) y `requireMove` (el tiempo en objetivo solo cuenta con WASD pulsado). Los pone la clase base vacíos/`false`.
  - `update(dt)`.
  - `onHit(target, part, { dealt, killed })`.
  - `live(stats)` (texto ya traducido), `score(stats)`, `summary(stats)` (pares `[clave de texto, valor]`, se traducen al mostrarlos).
  - `dispose()`.
- Clases base:
  - `TrackingScenario` recibe un `makeTarget(scenario)`.
  - `EliminationScenario` gestiona respawns con `pending`.
  - `SphereFlickScenario` es la base de Gridshot y Precisión.
  - `MoveTrackScenario` (tracking con `requireMove`) y `PeekScenario` (coberturas con un objetivo `move: 'static'` que el escenario mueve: escondido → asoma → ADAD → vuelve; la barra de vida se oculta mientras está tapado, porque no tiene depthTest).

**`target.js`: objetivos**
- `Target` (humanoide) y `SphereTarget` comparten interfaz: `hitMeshes`, `update(dt, camera)`, `applyDamage(amount, now)`, `dispose()`, `spawnTime`, `firstHitTime`.
- El movimiento del humanoide se configura con `opts.ai` (ver `DEFAULT_AI`: jump pads con `padChance`/`padSpeed`, idas y venidas en profundidad con `sweep`/`depthSpeed`). Las opciones nuevas deben venir apagadas por defecto para no cambiar los escenarios existentes. El cambio de sentido tiene en cuenta la distancia de frenada para no salirse de `lane` ni de `ai.depth`.

**`audio.js`: sonido**
- Todos los sonidos se sintetizan con Web Audio (`tone()` y `noise()`), sin ficheros. Hay variantes de disparo (`SHOT_SOUNDS`) y de impacto (`HIT_SOUNDS`), y cada categoría tiene su volumen (`shotVolume`, `hitVolume`, `killVolume`, `countdownVolume`), que se multiplica por `volume`.
- Si añades un sonido, iguala su nivel con los demás: renderízalo con un `OfflineAudioContext` y compara el pico y el RMS.

**`i18n.js`: idiomas**
- `LANGUAGES` (`en` por defecto, `es`), un diccionario plano por idioma en `src/lang/` con las mismas claves. `t(key, params)` sustituye `{nombre}`; si falta una clave sale el inglés. `en.js` es la referencia (`hasText`).
- El idioma es el ajuste `language` (selector en la barra lateral del menú). Al cambiarlo, `main.js` llama a `setLanguage` y `menu.rebuild()`.
- **No llamar a `t()` al cargar un módulo** (constantes, esquema): los datos guardan claves y se traducen al renderizar. Los nombres de armas y miras se leen con `weaponName(key, short)` y `sightName(key, short)`.
- Al añadir o cambiar un texto, ponlo en todos los diccionarios. Los términos del juego (Light/Medium/Heavy, ADS, hipfire, TTK, kills…) no se traducen.

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

- **Para simular el pointer lock:** redefinir `document.pointerLockElement` con `Object.defineProperty` y sustituir `HTMLCanvasElement.prototype.requestPointerLock` y `document.exitPointerLock` por funciones que cambien ese valor y lancen `pointerlockchange`. Así funcionan el clic en el overlay de `ready`, "Continuar" y la salida con Esc. Los botones del ratón se simulan con `mousedown`/`mouseup` sobre `document` (`button` 0 = disparo, 2 = ADS). El movimiento, con `pointerrawupdate` o `mousemove` y `movementX`/`movementY`.
- **Para probar la lógica:** `await import('/src/…')` desde la página devuelve las mismas instancias de módulo que usa el juego. Sirve para crear escenarios con un `ctx` falso y, parcheando el prototipo, para leer el estado interno (p. ej. `Target.prototype.update`).
- **Trampa:** cualquier interacción con el menú guarda los ajustes que hay en memoria. Para probar con otros ajustes, escribe en localStorage y recarga la página **antes** de hacer clic en nada.
