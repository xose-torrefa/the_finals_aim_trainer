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
- **Import de three:** `import * as THREE from '../lib/three/three.module.js'`. Todas las rutas son relativas (también en `index.html`), porque en GitHub Pages el sitio vive en `/<repo>/` y una ruta absoluta daría 404. No sirve un import map: la CSP bloquea el `<script type="importmap">` inline.

## GitHub Pages

- `.github/workflows/pages.yml` publica en cada push a `main`: `npm ci` + `npm run verify` y luego monta `_site` con lo mismo que sirve `server.mjs` (`index.html`, `styles.css`, `favicon-32.png`, `favicon-192.png`, `src/` y `node_modules/three/build/*.js` → `lib/three/`). **Si añades un archivo a `FILES` o a `MOUNTS`, añádelo también al paso "Montar el sitio".**
- Las acciones van fijadas por SHA de commit, con la versión en un comentario. Para actualizarlas, elige una versión con más de 14 días (como con npm) y sustituye el SHA.
- Pages no permite cabeceras propias: solo se aplica la CSP del `<meta>` de `index.html` (sin `frame-ancestors`). Cualquier cambio en la CSP hay que hacerlo en los dos sitios.

## Arquitectura

**`main.js`: bucle y máquina de estados**
- Estados: `menu` → `ready` → `countdown` → `playing` ↔ `paused` → `finished` → `results`.
  - `ready`: la partida está creada pero espera un clic en el overlay (hace falta un gesto para capturar el ratón).
  - `countdown`: dura `settings.countdown` s (0 = se salta). Se puede mirar y apuntar, pero ni moverse ni disparar, y ni el tiempo ni los objetivos avanzan. Se repite al volver de la pausa.
  - `finished`: resultado rápido (ajuste `quickResults`, activado por defecto). Al acabar, la puntuación sale sobre la escena (`overlay.showFinished`) sin soltar el ratón: la tecla de reinicio vuelve a jugar al momento, Espacio (o Enter) pasa al siguiente paso de la rutina o del test, destacado en la tarjeta (o a los resultados) y Esc, o perder el ratón, abre los resultados completos (`openResults`). Sin `quickResults` se va directo a `results`.
  - Al capturar el ratón (`pointerlockchange`) se pasa de `ready`/`paused` a la cuenta atrás; al perderlo, de `countdown`/`playing` a `paused`.
- `startSession(key, ranked)` crea `ctx = { scene, camera, player, settings, weapon, stats }` y lo pasa a `SCENARIOS[key].create(ctx)`. Antes pone al jugador en el origen mirando al frente; el escenario puede moverlo (p. ej. al tejado de `rooftop`) y después se sincroniza la cámara. Si el ratón ya está capturado (reinicio en plena partida) va directo a la cuenta atrás; si no, a `ready`.
- Rutinas: `startRoutine(def)` guarda `routine = { def, index, results }` y lanza cada paso con `startSession(key, true)`. El botón "Siguiente" de los resultados llama a `onRoutineNext`. La rutina se abandona al jugar otra cosa (`onPlay`) o al salir desde la pausa. Si se repite un paso, cuenta la última partida.
- `settings.restartKey` (un `KeyboardEvent.code`) reinicia la última partida desde `ready`, `countdown`, `playing`, `paused`, `finished` y la página de resultados.
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

**`world.js`: decorado**
- Suelo con cuadrícula de 2 m (referencia de distancia, no quitarla), cielo por shader y una ciudad procedural con semilla fija (skyline, pantallas, grúas, contenedores y vóxeles animados con `world.update(time)`). Inspirado en el estilo de concurso televisado, sin marcas ni recursos del juego.
- Nada de decorado dentro de la zona de tiro (hasta ~121 m y ±70°): cerca solo detrás o a los lados. El fondo evita naranja/amarillo/rosa para no quitar contraste a los objetivos.
- Los edificios se combinan en unas pocas mallas (`GeoBuilder`) que también son `colliders`.
- **Estilos de fondo** (ajuste `background`, Ajustes → Vídeo; `STYLES` / `WORLD_STYLES`): `city` (lo de arriba, por defecto), `simple` (anillo de bloques lisos, sin nubes ni animación), `minimal` (solo cielo y suelo) y `dark` (cielo y cuadrícula oscuros). Cada estilo es un `Group` que `world.setStyle()` cambia en caliente (libera el anterior y rellena `colliders` en el sitio). Las luces, la cuadrícula de 2 m, la niebla y el borde de la arena son comunes: los objetivos se ven igual en todos. Es visual, así que no cambia la `version` de los escenarios.

**UI: `menu.js` y `overlay.js`**
- `menu.js` es el menú a pantalla completa, con barra lateral y páginas: `scenarios` (tarjetas por grupo, con partidas de hoy y racha), `scenario` (ficha con estadísticas, tendencia, gráfica, puntuación por sensibilidad, evolución del análisis e historial), `routines`, `routine-edit` y `routine-summary`, `sandbox`, `settings` (pestañas por sección + valores efectivos) y `results`. Cada página se reconstruye al navegar; `refresh()` actualiza lo que depende de los ajustes sin perder el foco.
- `overlay.js` es la capa sobre la escena durante la partida: "Haz clic para empezar", la cuenta atrás y el menú de pausa. Desde la pausa, "Ajustes" abre el menú con una tarjeta de "Partida en pausa" en la barra lateral.

**Disparo**
- Hitscan sin dispersión: cada bala va al centro exacto de la mira, por decisión del usuario.
- Cadencia (`fireRate`): `trainer` (por defecto) = las automáticas disparan a `TRAINER_RPM` (1200, como en los aim trainers) con el daño por bala reducido en proporción, así que el DPS y el TTK siguen siendo los del arma (`resolveWeapon` cambia `rpm` y `damage`); las semiautomáticas no cambian. `weapon` = los rpm del arma; `free` (`weapon.freeFire`) = cada clic dispara al momento, para escenarios de puntería pura (Gridshot, Precisión) donde un jugador rápido iría por delante del arma. Mantener pulsada una automática sigue a sus rpm. En Escenarios va en `RANKED_BASE` (`trainer`: la puntuación de tracking es el tiempo en objetivo y no depende de la cadencia) o en el `fixed` (los escenarios que puntúan kills con automáticas fijan `weapon`); en Sandbox es un ajuste. Con la cadencia real, el clic de una semiautomática antes de tiempo se pierde (sin búfer, por no inventar el comportamiento del juego) y `analysis.click()` lo cuenta como "clic antes de tiempo".
- `castRay()` lanza el rayo contra `world.colliders` + `scenario.colliders` + `scenario.hitMeshes`.
- Cada mesh golpeable lleva `userData = { target, part: 'head' | 'body' }`.
- Los fallos contra el mundo dejan una marca de `impacts.js`.
- `viewmodel.js` es el arma en primera persona: escena y cámara propias (FOV `viewmodelFov`), modelos hechos con primitivas según `weapon.key`, la mira (`iron`, `reddot`, `scope`) y su nivel (largo del visor). En ADS pone el eje de la mira (`y`, `z`) en el centro de la pantalla; los visores (`scoped`) ocultan el arma con el ADS completo. El retroceso es solo visual. También dibuja el fogonazo.
- `tracers.js`: las trazadoras salen de donde se ve la boca del cañón (`muzzleNdc` proyectado a la cámara del mundo) y van al punto de impacto. Son solo visuales.

**Modos Escenarios / Sandbox**
- El modo lo decide la página desde la que se lanza la partida (`ranked` en `startSession`). En Escenarios, `scenarioSettings()` (en `scenarios/index.js`) impone `RANKED_BASE` + el `fixed` de cada escenario sobre los ajustes del usuario. La sesión guarda esos ajustes efectivos en `ctx.settings`; `update()` y los escenarios deben leer siempre `ctx.settings`, nunca el `settings` global.
- Las secciones del esquema con `page: 'sandbox'` solo se muestran y se aplican en Sandbox; las de `page: 'settings'` son lo personal (sens, FOV, ADS, mirillas, color, cuenta atrás…) y valen en ambos modos.
- **Mirillas (Ajustes → Armas):** cada arma tiene su ajuste `sightKey(arma)` (`sightAr`, `sightSmg`…) con una de sus `sights`; por defecto, el red dot si el arma lo admite y si no, la primera (`defaultSight`). `weaponSight(s, arma)` / `resolveWeapon(s)` dan la mira y su nivel, y de ahí sale el FOV de ADS, también en Escenarios (la mira no va en `RANKED_BASE` ni en los `fixed`). `settings.scenario` es el escenario elegido en Sandbox.
- `history.js` guarda cada partida del modo Escenarios bajo `escenario@version`, con `{ t, score, accuracy, cm360, adsCm360, fov }` y las métricas del análisis. Un campo nuevo tiene que ir en `ENTRY_FIELDS`, o la copia de seguridad no lo importa. La ficha agrupa las partidas por sensibilidad (`sensGroups` / `sensChart` en `chart.js`, hipfire o ADS) si se ha jugado con más de una. También calcula la comparación con las partidas anteriores (`compareToPrevious`: récord y media de las últimas 10), la tendencia (`trend`) y la constancia (`activity`). **Si cambias la configuración efectiva de un escenario (`fixed`, `RANKED_BASE` o su lógica de dificultad), sube su `version`**; si no, se mezclan puntuaciones que no son comparables.

**`analysis.js`: análisis de la puntería**
- `AimAnalysis` se crea por sesión y no cambia la puntuación. Sale en la tarjeta de análisis de los resultados (Escenarios y Sandbox).
- En Escenarios, `analysisFields()` guarda unas pocas métricas con cada partida (`ANALYSIS_FIELDS` en `history.js`: retraso de tracking, % en objetivo tras un cambio de sentido, overshoot/undershoot, corrección, clics antes de tiempo y el desajuste de velocidad del trazado), solo las que tienen datos suficientes. La ficha del escenario muestra su evolución (`analysisTrendView`: media de las últimas 10 frente a las 10 anteriores).
- Tracking: toma el objetivo más cercano a la mira y mide el error en la dirección en que se mueve en pantalla (> 0 = mira por detrás), convertido a ms. Solo cuenta mientras el jugador está "enganchado" (histéresis sobre `4 × radio angular`). Los 0,4 s tras un cambio de sentido se miden aparte.
- Flicks: en el primer impacto a un objetivo con vida finita, analiza el recorrido de la mira desde el último impacto/kill o la aparición. El movimiento principal acaba cuando la velocidad cae al 20 % del pico; si ese punto está más allá del radio angular del objetivo es overshoot, y si no llega, undershoot.
- Los objetivos exponen `aimInfo()` → `{ center, half, radius }` (centro, semialtura y radio en m).

**`recording.js`: trazado de la partida**
- `Recording` se crea por sesión y guarda por columnas, en cada fotograma de juego, la mira (`yaw`, `pitch`, counts `dx`/`dy`, ADS), el objetivo de referencia del análisis (`AimAnalysis.last`: dirección, error `ex`/`ey`, radio angular, `engaged`) y los disparos. Ángulos en grados. Solo se conserva el de la última partida, en memoria (`results.recording`); no va al historial ni a la copia de seguridad.
- `analyzeRecording()` saca la fluidez del tracking (tarjeta "Trazado de la partida" de los resultados): compara la velocidad de la mira con la del objetivo, medidas sobre `WINDOW` (40 ms), mientras se sigue a un objetivo en movimiento. Desajuste = RMS de la diferencia en % de la velocidad del objetivo (se guarda en el historial como `mismatchPct` y sale en la evolución del análisis); rango = cuartiles de velocidad de la mira / velocidad del objetivo; vaivén = la mira pasa de ir un 15 % más lenta a un 15 % más rápida y vuelve; cruce = pasa de detrás a delante del centro del objetivo (o al revés). Con dos trazados reales de `airtrack` (87 %) salió un desajuste de ~40 % y un rango de ~77–125 %, casi sin parones: el fallo típico es un vaivén de velocidad, no un para-y-arranca. `cut()` marca la vuelta de una pausa para no medir a través de ella.
- El mismo `analyzeRecording()` da el desglose (`breakdown`, tarjeta "Dónde pierdes el objetivo", solo en escenarios con `score: 'percent'`): % en objetivo por situación (objetivo lento/rápido respecto a la mediana de la partida; estable o cambiando de velocidad/rumbo, `TURN`; hacia dónde va) y por dónde se pierde (detrás, delante, de lado). `loss` = puntos que se ganarían si esa situación fuera como el resto de su grupo; `menu.js` destaca las dos peores (≥ `WHERE_MIN_LOSS`) y propone un escenario (`WHERE_DRILLS`). El desglose se guarda en el historial en segundos (`BREAKDOWN_FIELDS`: `wT`, `wOn`, `w<Situación>T/On`, `wOff<Lado>`) y la ficha del escenario muestra la suma de las últimas 10 partidas que lo tengan (`breakdownOfEntries`), con el umbral dividido por √n (mínimo 1). Son diferencias observadas, no causas; en dos partidas reales seguidas las de 1-2 puntos cambiaban de signo (por eso el umbral es 2,5), y lo estable era por dónde se pierde (67-75 % por detrás).
- `traceChart` (`chart.js`) dibuja la velocidad horizontal de mira y objetivo y la mira respecto al objetivo, con ventana desplazable. "Exportar trazado" descarga el JSON de `exportRecording()` (`kind: 'trace'`, `version: 1`); si cambian las columnas, sube esa versión.

**`senstest.js`: test de sensibilidad** (Ajustes → Sensibilidad)
- Dos tests independientes sobre un escenario de `score: 'percent'`: `ads` cambia solo `adsSensPct`; `hip` cambia la sens de hipfire (`gameSens` o `cm360` según `sensMode`) y divide `adsSensPct`/`sniperSensPct` por lo mismo, para que el cm/360 de ADS no cambie. `factor` multiplica la velocidad de giro (`TEST_FACTORS` 0,8–1,2; `ORDER` son 6 partidas de `TEST_DURATION` = 30 s, con la actual al principio y al final: 10 partidas de 60 s se hacían pesadas). El jugador no ve qué sensibilidad toca en cada partida.
- En `main.js` el test es una rutina con `test`: `startRoutineStep()` lanza cada paso con `startSession(key, true, opts)`, donde `opts = { overrides, noAds, unsaved }`. Los `overrides` se imponen sobre `ctx.settings` (también en `applyToSession`), `noAds` anula el ADS (test de hipfire) y `unsaved` evita `addEntry`: ningún test se guarda en el historial, porque sus partidas duran menos que las del escenario.
- `analyzeSensTest()` ajusta una parábola (puntuación frente a ln del factor) a todas las partidas válidas (en el de ADS, las jugadas en ADS ≥ 80 % del tiempo) y solo recomienda cambiar si la ganancia prevista supera el ruido (desviación de los residuos) y 1 punto (`MIN_GAIN`). La página `sens-summary` muestra el veredicto y la tabla, y "Aplicar" guarda `sensSettings()` (redondeado al paso del esquema).

**`routines.js`: rutinas**
- Las predefinidas (`BUILTIN_ROUTINES`) tienen sus textos en i18n (`routine.<id>`, `routine.<id>.desc`). Las propias se guardan en `finals-aim.routines.v1` como `{ id: 'c…', name, steps }`, validadas con `sanitize()` (solo escenarios existentes, como mucho `MAX_STEPS`). Si se quita o se renombra un escenario, sus pasos desaparecen de las rutinas.

**Copia de seguridad (Ajustes → Copia de seguridad)**
- Exporta un JSON `{ app: 'finals-aim', version, exported, settings, history, routines }`. Las rutinas se fusionan por `id`. Al importar, `mergeHistory()` añade las partidas sin duplicar (misma `t` en el mismo `escenario@versión`) y solo con campos numéricos conocidos; los ajustes pasan por `sanitizeSettings()` y se aplican con `onReplace` (sin sonidos de prueba, reconstruyendo el menú).

**`settings.js`: ajustes**
- `DEFAULTS` y `SETTINGS_SCHEMA` generan automáticamente los formularios del menú (`page`, `tab` para juntar secciones en una pestaña, `showIf`, `min`/`max`; tipos `select`, `checkbox`, `color`, `number` y `key`). El esquema no lleva textos: `section`/`tab` son ids (`section.<id>`, con descripción opcional `section.<id>.hint`), la etiqueta es `field.<text ?? key>` (o la clave completa `label`) y la pista, si existe en el diccionario, `<etiqueta>.hint`; las opciones son `[valor, clave de texto]`. Añadir un ajuste = poner su valor por defecto + su campo en el esquema + sus textos en todos los idiomas.
- La mira tiene dos perfiles con los mismos campos (`CROSSHAIR_KEYS`) y prefijos `crosshair*` / `adsCrosshair*`. `adsCrosshair` decide qué se ve en ADS: `dot` (hipfire sin líneas), `same` o `custom`. `crosshair.js` la dibuja con divs (capa de contorno + capa de relleno) y se usa tanto en el HUD como en la vista previa de Ajustes.
- **Código de mira** (`crosshair-code.js`, tarjeta en Ajustes → Mira): `FA1;<modo ADS D/S/C>;<12 campos de hipfire>[;<12 de ADS si es C>]`, en el orden fijo de `CODE_FIELDS` (opacidades en % entero). Al importar, los números se ajustan al rango del esquema y se puede deshacer. **Si cambian los campos de la mira, crea un formato nuevo (`FA2`) y sigue leyendo el `FA1`**: los códigos ya compartidos tienen que seguir funcionando.
- `sanitizeSettings()` (lo usan `loadSettings()` y la copia de seguridad) solo acepta valores del mismo tipo que el default, y en los `select`, solo si siguen siendo una de las opciones.
- La clave de localStorage está versionada (`finals-aim.settings.v2`). Si cambia la semántica de un ajuste, sube la versión y añade la clave antigua a `OLD_STORAGE_KEYS`.

**`scenarios/`: escenarios (un archivo por escenario)**
- Cada escenario es un archivo que exporta por defecto su definición: `{ key, group, spheres?, version, fixed, distanceLabel?, score, create(ctx) }`. `score` es `'percent'` o `'kills'`, e `index.js` le añade `formatScore`/`formatTick` (`SCORE_FORMATS`). La guía para contribuidores está en `CONTRIBUTING.md` (en inglés); si cambia cómo se añade un escenario, actualízala también.
- `index.js` importa todos los escenarios. `LIST` es el orden del menú, y el archivo también tiene `RANKED_BASE`, `scenarioSettings`, `fixedParts` y los nombres. Al cargar valida cada definición con `check()`: si una clave está repetida o si `group`, `version`, `score` o `create` no son válidos, lanza un error; `fixed` pasa por `sanitizeSettings()`, y si faltan los textos en `en.js`, avisa con un warning. El registro `SCENARIOS` (clave → definición) es la API que usan `main.js`, `menu.js` y `routines.js`. El menú los agrupa por `group` (`humanoids`, `situations`, `spheres`). Nombre y descripción van en los diccionarios (`scenarioName(key)`, `scenarioDesc(key)`, `groupName(group)`).
- **La `key` no se cambia nunca**: la usan el historial y las rutinas guardadas. El archivo se llama como la clave, salvo que la clave lleve palabras que bloquean los adblock (`track` → `follow`: `tracking` está en `follow.js`, `airtrack` en `airfollow.js`…).
- `base.js` tiene `createStats`, utilidades (`spawnPoint`, `aimPoint`, `rand`, `pct`…) y las clases que comparten varios escenarios. Una clase que solo usa un escenario va en su archivo (`PeekScenario` en `peek.js`, `GridshotScenario` en `gridshot.js`…).
- Una instancia de escenario implementa:
  - `targets` y `hitMeshes`.
  - `colliders` (geometría propia que para las balas, p. ej. las coberturas de Peeks) y `requireMove` (el tiempo en objetivo solo cuenta con WASD pulsado). Los pone la clase base vacíos/`false`.
  - `clampPlayer(pos)`: limita el movimiento del jugador además del borde de la arena (en la base no hace nada).
  - `update(dt)`.
  - `onHit(target, part, { dealt, killed })`.
  - `live(stats)` (texto ya traducido), `score(stats)`, `summary(stats)` (pares `[clave de texto, valor]`, se traducen al mostrarlos).
  - `dispose()`.
- Clases base (`base.js`):
  - `TrackingScenario` recibe un `makeTarget(scenario)`.
  - `EliminationScenario` gestiona respawns con `pending`.
  - `SphereFlickScenario` es la base de Gridshot y Precisión.
- Clases propias: `MoveTrackScenario` (`movefollow.js`, tracking con `requireMove`), `PeekScenario` (`peek.js`, coberturas con un objetivo `move: 'static'` que el escenario mueve: escondido → asoma → ADAD → vuelve; la barra de vida se oculta mientras está tapado, porque no tiene depthTest), `RooftopScenario` (`rooftop.js`, el jugador en el borde de un tejado de 12 m y el objetivo por la calle, pegado a la fachada; `clampPlayer` impide pasar del borde) y `HipfireScenario` (`hipfire.js`, un Light humanoide que orbita alrededor del jugador a 2,5–6 m, también con `move: 'static'`; dashes como en el juego: 2 cargas que se recargan de una en una cada 5 s).

**`target.js`: objetivos**
- `Target` (humanoide) y `SphereTarget` comparten interfaz: `hitMeshes`, `update(dt, camera)`, `applyDamage(amount, now)`, `dispose()`, `spawnTime`, `firstHitTime`.
- Modelo del `Target` (ajuste `targetModel`): `capsule` (`CLASSES`, por defecto y en `RANKED_BASE`: la usan los escenarios de siempre) o `humanoid` (`humanoid.js`), que un escenario nuevo puede pedir con `fixed: { targetModel: 'humanoid' }`; en Sandbox se elige. El humanoide es procedural (primitivas, sin ficheros), con proporciones por clase (`BUILDS`: Light delgado, Heavy más alto y ancho) y un rifle cogido con IK de dos huesos. **El hitbox es el propio modelo**: cada pieza es una malla con su `part` (cuello, brazos y piernas = `body`; el hueco entre las piernas es fallo); el arma y el visor son decorado. Mira siempre al jugador y se anima por código con su velocidad real (medida por la posición, así que también vale si lo mueve el escenario, como en Peeks). `halfWidth` es su semiancho real (lo usa Peeks para esconderlo) y `aimInfo().radius` el semiancho del torso. `update()` acaba con `updateMatrixWorld`, para que el rayo del disparo use la pose de este fotograma: si un escenario mueve el objetivo después, que la actualice también. Cambiar las proporciones cambia la dificultad: sube la `version` de los escenarios que usen humanoides.
- El movimiento del humanoide se configura con `opts.ai` (ver `DEFAULT_AI`: jump pads con `padChance`/`padSpeed`, idas y venidas en profundidad con `sweep`/`depthSpeed`, `pingpong` para ir de un extremo del carril al otro sin nada al azar, `smooth` para las trayectorias suaves de `SmoothPath`). `SmoothPath` es el movimiento de los escenarios de tracking (`tracking`, `closetrack`, `movetrack` y, en 3D, las esferas de `airtrack` y `widetrack` con `move: 'float'`; `widetrack` es `airtrack` en un espacio mucho más ancho (la esfera recorre unos ±40°, frente a unos ±18° en `airtrack`) y es el escenario por defecto del test de sensibilidad): avanza sin pararse y el rumbo gira con una velocidad angular que cambia poco a poco (rectas, curvas y círculos que lo acercan y lo alejan), dentro de una elipse/elipsoide normalizado; el giro más cerrado es un tercio del área, así que no se sale aunque suba la velocidad. Las opciones nuevas deben venir apagadas por defecto para no cambiar los escenarios existentes. El cambio de sentido tiene en cuenta la distancia de frenada para no salirse de `lane` ni de `ai.depth`.

**`audio.js`: sonido**
- Todos los sonidos se sintetizan con Web Audio (`tone()` y `noise()`), sin ficheros. Hay variantes de disparo (`SHOT_SOUNDS`) y de impacto (`HIT_SOUNDS`), y cada categoría tiene su volumen (`shotVolume`, `hitVolume`, `killVolume`, `countdownVolume`), que se multiplica por `volume`.
- Disparos e impactos no suenan más de una vez cada `MIN_GAP` (60 ms): a 1200 RPM suena una bala de cada dos, para que no se solapen ni se vuelvan un zumbido. Las cadencias reales (≤ 900 RPM) no se ven afectadas.
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
- **FOV de ADS = FOV vertical de hipfire × nivel de la mira:** Low 1× = 0,78, Medium 1,25× = 0,68, High 1,5× = 0,58 (niveles del parche 7.0, porcentajes medidos por la comunidad; `LEVELS` en `weapons.js`).
- **El nivel sale de la combinación arma + mira** (`sights` de cada arma en `WEAPONS`), datos del usuario: miras de hierro, red dots y ADS con zoom sin mira = 78 %, salvo el red dot del revólver = 68 %; visor del XP-54 = 68 %; visor del FAMAS / LH1 / Pike y arco = 58 %.

**Objetivos y armas**
- **Vida por clase:** Light 150, Medium 250, Heavy 350.
- **Aproximado:** los tamaños de hitbox, velocidades y la cadencia, daño y tiempo de ADS de cada arma.

## Verificación sin suite de tests

Se prueba con Chrome headless controlado por el DevTools Protocol, con un script de Node sin dependencias (Node 22 trae `WebSocket` y `fetch` globales). Se lanza Chrome con `--headless=new --remote-debugging-port=… --enable-unsafe-swiftshader`.

- **Para simular el pointer lock:** redefinir `document.pointerLockElement` con `Object.defineProperty` y sustituir `HTMLCanvasElement.prototype.requestPointerLock` y `document.exitPointerLock` por funciones que cambien ese valor y lancen `pointerlockchange`. Así funcionan el clic en el overlay de `ready`, "Continuar" y la salida con Esc. Los botones del ratón se simulan con `mousedown`/`mouseup` sobre `document` (`button` 0 = disparo, 2 = ADS). El movimiento, con `pointerrawupdate` o `mousemove` y `movementX`/`movementY`.
- **Para probar la lógica:** `await import('/src/…')` desde la página devuelve las mismas instancias de módulo que usa el juego. Sirve para crear escenarios con un `ctx` falso y, parcheando el prototipo, para leer el estado interno (p. ej. `Target.prototype.update`).
- **Trampa:** cualquier interacción con el menú guarda los ajustes que hay en memoria. Para probar con otros ajustes, escribe en localStorage y recarga la página **antes** de hacer clic en nada.
