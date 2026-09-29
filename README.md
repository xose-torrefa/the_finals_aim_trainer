# Finals Aim

Aim trainer en three.js centrado en el ADS de The Finals.

```sh
npm ci      # instala exactamente lo del lockfile (solo three)
npm start   # http://localhost:5173
```

Controles: clic izq. disparar · clic der. ADS · WASD moverse · Esc pausa.

## Escenarios

- **Tracking**: objetivo inmortal que hace strafe, salta y (Light) dashea. Métrica: % de tiempo con la mira encima.
- **Duelo**: un enemigo con la vida de su clase (Light 150 / Medium 250 / Heavy 350). Mide reacción, TTK y TTK ideal.
- **Cambio de objetivo**: tres enemigos a la vez.
- **Flick ADS**: objetivos estáticos de un impacto en un arco de 120°.

## Sensibilidad y FOV

- Sens de The Finals directamente (yaw 0.001: sens 47 @ 400 DPI = 48,64 cm/360), `cm/360` o `sens × yaw` personalizado para convertir desde otros juegos.
- FOV vertical, como The Finals (verificado: misma distancia de ratón de borde a borde de pantalla que en el juego). También horizontal 16:9 u horizontal real para otros juegos.
- ADS: el FOV lo define el nivel de mira, como en The Finals: Low 1× = 78%, Medium 1.25× = 68%, High 1.5× = 58% del FOV de hipfire (niveles del parche 7.0, porcentajes medidos por la comunidad). El FOV del francotirador está sin verificar.
- Sens de ADS y de francotirador en %, como en el juego (78% por defecto), y "Mouse Focal Length Sensitivity Scaling" ON/OFF (ON = además escala por zoom, 0% monitor distance). El menú muestra qué % daría 0% monitor distance con la mira elegida.
- Los valores de las armas (`src/weapons.js`) y hitboxes (`src/target.js`) son aproximados, para ir ajustándolos.

## Importar la configuración del juego

El menú puede cargar `%LOCALAPPDATA%\Discovery\Saved\SaveGames\EmbarkOptionSaveGame.sav` (botón o arrastrar y soltar). Importa sens, FOV, sens de ADS (`MouseZoomSensitivity`), sens de francotirador (`MouseScopedZoomSensitivity`), escalado focal y color de mira. El archivo se lee en el navegador (`src/finals-save.js`), no se modifica ni se envía a ningún sitio. Los DPI hay que ponerlos a mano.

## Seguridad (supply chain)

- Una sola dependencia, `three`, que no tiene dependencias propias. Sin bundler.
- Versión exacta fijada y lockfile con hash de integridad. Usa `npm ci`, no `npm install`.
- `.npmrc`: `ignore-scripts`, `save-exact`, `allow-git=none`, `min-release-age=14`, registry explícito.
- `npm run verify` comprueba las firmas del registro y el árbol de dependencias.
- `server.mjs` no tiene dependencias, solo escucha en `127.0.0.1`, sirve una lista blanca de rutas (solo `node_modules/three/build`), rechaza path traversal y Hosts ajenos, y envía una CSP estricta (`script-src 'self'`, sin inline ni eval).
- Para actualizar three: revisar el changelog, elegir una versión con más de 14 días, `npm install three@X`, luego `npm run verify`.
