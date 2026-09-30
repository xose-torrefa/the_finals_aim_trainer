import { h } from './dom.js';
import { SETTINGS_SCHEMA, CROSSHAIR_KEYS, keyLabel, hipVFovDeg, adsVFovDeg, mdvZeroPct, hFovFromV, hipDegPerCount, sensFactor, cm360FromDegPerCount } from './settings.js';
import { SIGHTS, resolveWeapon } from './weapons.js';
import { SCENARIOS, fixedParts } from './scenarios.js';
import { getHistory } from './history.js';
import { progressChart } from './chart.js';
import { Crosshair, crosshairProfile, adsCrosshairProfile } from './crosshair.js';
import { parseFinalsSave, settingsFromFinalsSave, SAVE_PATH } from './finals-save.js';

const FIELD_LABELS = new Map(SETTINGS_SCHEMA.flatMap((g) => g.fields).map((f) => [f.key, f.label]));
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const CROSSHAIR_TAB = 'Mira';
const tabOf = (g) => g.tab ?? g.section;

const NAV = [
  ['scenarios', 'Escenarios'],
  ['sandbox', 'Sandbox'],
  ['settings', 'Ajustes'],
];

const GROUPS = Map.groupBy(Object.entries(SCENARIOS), ([, sc]) => sc.group);

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x) => Math.round(x * 10) / 10;
const pctText = (x) => (Number.isFinite(x) ? `${x.toFixed(1)}%` : '—');
const numText = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const dateText = (t, year = false) => new Date(t).toLocaleString('es-ES', {
  day: '2-digit', month: '2-digit', year: year ? '2-digit' : undefined, hour: '2-digit', minute: '2-digit',
});

const tile = (label, value, cls = '') => h('div', { class: `tile ${cls}` }, h('span', {}, label), h('strong', {}, value));
const chips = (parts) => h('div', { class: 'chips' }, parts.map((p) => h('span', { class: 'chip' }, p)));
const card = (title, ...children) => h('section', { class: 'card' }, title && h('h2', {}, title), children);

export class Menu {
  /**
   * @param handlers { onPlay(key, ranked), onResume(), onRestart(), onQuit(), onChange(key) }
   */
  constructor(root, settings, handlers) {
    this.root = root;
    this.settings = settings;
    this.handlers = handlers;
    this.page = 'scenarios';
    this.detailKey = null;
    this.settingsTab = tabOf(SETTINGS_SCHEMA.find((g) => g.page === 'settings'));
    this.results = null;
    this.paused = null;
    this.fieldRows = [];
    this.buildShell();
    this.render();
  }

  // ---------- Estructura y navegación ----------

  buildShell() {
    this.navButtons = NAV.map(([page, label]) => {
      const b = h('button', { class: 'nav-item', onclick: () => this.navigate(page) }, label);
      b.dataset.page = page;
      return b;
    });
    this.pauseCard = h('div', { class: 'pause-card hidden' });
    this.keysHint = h('p', { class: 'keys' });
    this.content = h('main', { class: 'content' });
    this.root.replaceChildren(
      h('aside', { class: 'sidebar' },
        h('div', { class: 'brand' }, 'FINALS ', h('span', {}, 'AIM')),
        h('nav', {}, this.navButtons),
        this.pauseCard,
        this.keysHint),
      this.content,
    );
  }

  /** @param page 'scenarios' | 'scenario' | 'sandbox' | 'settings' | 'results' */
  navigate(page, key = null) {
    this.page = page;
    if (page === 'scenario') this.detailKey = key;
    this.render();
    this.content.scrollTop = 0;
  }

  render() {
    this.fieldRows = [];
    this.readout = null;
    this.weaponInfo = null;
    this.chPreview = null;
    const section = this.page === 'scenario' ? 'scenarios' : this.page;
    for (const b of this.navButtons) b.classList.toggle('active', b.dataset.page === section);
    const pages = {
      scenarios: () => this.renderScenarios(),
      scenario: () => this.renderScenario(this.detailKey),
      sandbox: () => this.renderSandbox(),
      settings: () => this.renderSettings(),
      results: () => this.renderResults(),
    };
    this.content.replaceChildren(h('div', { class: 'page' }, pages[this.page]()));
    this.refresh();
  }

  /** Actualiza lo que depende de los ajustes sin reconstruir la página (conserva el foco). */
  refresh() {
    const s = this.settings;
    for (const { f, row } of this.fieldRows) row.classList.toggle('hidden', Boolean(f.showIf && !f.showIf(s)));
    if (this.readout) this.readout.replaceChildren(...this.readoutRows());
    if (this.weaponInfo) this.weaponInfo.replaceChildren(this.weaponRows());
    if (this.chPreview) this.updateCrosshairPreview();
    this.keysHint.textContent = `Clic izq: disparar · Clic der: ADS · WASD: moverse · ${keyLabel(s.restartKey)}: reiniciar · Esc: pausa`;
  }

  /** Muestra en la barra lateral la partida en pausa (al abrir los ajustes desde la pausa). */
  setPaused(info) {
    this.paused = info;
    this.pauseCard.classList.toggle('hidden', !info);
    if (!info) return;
    this.pauseCard.replaceChildren(
      h('span', { class: 'eyebrow' }, 'Partida en pausa'),
      h('strong', {}, info.name),
      h('button', { class: 'primary', onclick: () => this.handlers.onResume() }, 'Continuar'),
      h('button', { onclick: () => this.handlers.onQuit() }, 'Abandonar'),
      this.pauseMessage = h('p', { class: 'message' }),
    );
  }

  setMessage(text) {
    if (this.pauseMessage) this.pauseMessage.textContent = text;
  }

  // ---------- Escenarios ----------

  renderScenarios() {
    return [
      h('header', { class: 'page-head' },
        h('h1', {}, 'Escenarios'),
        h('p', { class: 'lead' }, 'Cada escenario tiene arma, objetivos y duración fijos para que las puntuaciones sean comparables. ',
          'Sens, FOV y ADS son siempre los tuyos. Cada partida se guarda en tu historial.')),
      [...GROUPS].map(([group, entries]) => h('section', { class: 'group' },
        h('h2', {}, group),
        h('div', { class: 'cards' }, entries.map(([key, def]) => this.scenarioCard(key, def))))),
    ];
  }

  scenarioCard(key, def) {
    const entries = getHistory(key, def);
    const best = entries.length ? def.formatScore(Math.max(...entries.map((e) => e.score))) : '—';
    const open = () => this.navigate('scenario', key);
    return h('article', {
      class: 'scenario-card',
      tabIndex: 0,
      onclick: open,
      onkeydown: (e) => { if (e.key === 'Enter') open(); },
    },
    h('h3', {}, def.name),
    h('p', { class: 'desc' }, def.desc),
    chips(fixedParts(key)),
    h('div', { class: 'card-foot' },
      h('div', { class: 'mini-stat' }, h('span', {}, 'Récord'), h('strong', {}, best)),
      h('div', { class: 'mini-stat' }, h('span', {}, 'Partidas'), h('strong', {}, String(entries.length))),
      h('button', {
        class: 'primary play',
        onclick: (e) => {
          e.stopPropagation();
          this.handlers.onPlay(key, true);
        },
      }, 'Jugar')));
  }

  renderScenario(key) {
    const def = SCENARIOS[key];
    const entries = getHistory(key, def);
    return [
      h('button', { class: 'back', onclick: () => this.navigate('scenarios') }, '← Escenarios'),
      h('header', { class: 'page-head detail-head' },
        h('div', {},
          h('span', { class: 'eyebrow' }, def.group),
          h('h1', {}, def.name),
          h('p', { class: 'lead' }, def.desc),
          chips(fixedParts(key))),
        h('button', { class: 'primary big', onclick: () => this.handlers.onPlay(key, true) }, 'Jugar')),
      entries.length ? this.statsBlock(def, entries) : card(null, h('p', { class: 'empty' }, 'Aún no has jugado este escenario. Tus partidas aparecerán aquí.')),
    ];
  }

  statsBlock(def, entries) {
    const fmt = def.formatScore;
    const scores = entries.map((e) => e.score);
    const recent = entries.slice(-10);
    const bestIdx = scores.indexOf(Math.max(...scores));
    const accs = recent.map((e) => e.accuracy).filter(Number.isFinite);
    const num = (text) => h('td', { class: 'num' }, text);
    const rows = entries.map((e, i) => ({ e, i })).slice(-25).reverse();
    return [
      h('div', { class: 'tiles' },
        tile('Partidas', String(entries.length)),
        tile('Récord', fmt(scores[bestIdx]), 'accent'),
        tile(`Media últ. ${recent.length}`, fmt(round1(avg(recent.map((e) => e.score))))),
        tile('Última', fmt(scores.at(-1))),
        tile(`Precisión últ. ${recent.length}`, accs.length ? pctText(avg(accs)) : '—')),
      card('Progreso', progressChart(entries, fmt, def.formatTick, { width: 860, height: 240 })),
      card('Historial',
        h('table', { class: 'history' },
          h('thead', {}, h('tr', {},
            h('th', {}, '#'), h('th', {}, 'Fecha'), h('th', { class: 'num' }, 'Puntuación'), h('th', { class: 'num' }, 'Precisión'),
            h('th', { class: 'num' }, 'cm/360'), h('th', { class: 'num' }, 'cm/360 ADS'), h('th', { class: 'num' }, 'FOV'))),
          h('tbody', {}, rows.map(({ e, i }) => h('tr', { class: i === bestIdx ? 'best' : '' },
          h('td', { class: 'muted' }, String(i + 1)),
          h('td', {}, dateText(e.t, true)),
          num(fmt(e.score)),
          num(pctText(e.accuracy)),
          num(numText(e.cm360)),
          num(numText(e.adsCm360)),
          num(e.fov ?? '—'))))),
        entries.length > rows.length && h('p', { class: 'muted small' }, `Mostrando las últimas ${rows.length} de ${entries.length} partidas.`)),
    ];
  }

  // ---------- Sandbox ----------

  renderSandbox() {
    const s = this.settings;
    const list = [...GROUPS].map(([group, entries]) => [
      h('h3', {}, group),
      h('div', { class: 'pick-grid' }, entries.map(([key, def]) => h('label', { class: 'pick', title: def.desc },
        h('input', { type: 'radio', name: 'sandbox-scenario', value: key, checked: s.scenario === key, onchange: () => this.set('scenario', key) }),
        h('strong', {}, def.name)))),
    ]);
    this.weaponInfo = h('div');
    return [
      h('header', { class: 'page-head' },
        h('h1', {}, 'Sandbox'),
        h('p', { class: 'lead' }, 'Cualquier escenario con arma, objetivos y duración a tu gusto. Las partidas no se guardan en el historial.')),
      h('div', { class: 'split' },
        h('div', { class: 'stack' },
          card('Escenario', list),
          this.schemaCards('sandbox')),
        h('aside', { class: 'stack sticky' },
          card('Arma efectiva', this.weaponInfo),
          h('button', { class: 'primary big', onclick: () => this.handlers.onPlay(s.scenario, false) }, 'Jugar en Sandbox'))),
    ];
  }

  weaponRows() {
    const w = resolveWeapon(this.settings);
    return this.dl([
      ['Arma', w.name.split(' (')[0]],
      ['Mira', `${SIGHTS[w.sight].name.split(' (')[0]} · ${Math.round(w.fovMult * 100)}% FOV`],
      ['Tiempo ADS', `${Math.round(w.adsTime * 1000)} ms`],
      ['Cadencia', `${w.rpm} RPM${w.auto ? ' · auto' : ''}`],
    ]);
  }

  // ---------- Ajustes ----------

  renderSettings() {
    this.readout = h('div', { class: 'readout-wrap' });
    const IMPORT = 'Importar de The Finals';
    const tabs = [...new Set(SETTINGS_SCHEMA.filter((g) => g.page === 'settings').map(tabOf)), IMPORT];
    const active = tabs.includes(this.settingsTab) ? this.settingsTab : tabs[0];
    const body = active === IMPORT
      ? this.buildImport()
      : this.schemaCards('settings', active);
    return [
      h('header', { class: 'page-head' },
        h('h1', {}, 'Ajustes'),
        h('p', { class: 'lead' }, 'Tu configuración personal. Se aplica en Escenarios y en Sandbox, y al momento si hay una partida en pausa.')),
      h('div', { class: 'split' },
        h('div', { class: 'stack' },
          h('div', { class: 'subtabs', role: 'tablist' }, tabs.map((t) => h('button', {
            class: t === active ? 'active' : '',
            role: 'tab',
            onclick: () => {
              this.settingsTab = t;
              this.render();
            },
          }, t))),
          body),
        h('aside', { class: 'stack sticky' },
          active === CROSSHAIR_TAB && this.buildCrosshairPreview(),
          card('Valores efectivos', this.readout))),
    ];
  }

  buildCrosshairPreview() {
    this.chPreview = { hip: new Crosshair(), ads: new Crosshair() };
    const box = (label, ch) => h('div', { class: 'ch-preview' }, h('span', {}, label), ch.el);
    return card('Vista previa',
      h('div', { class: 'ch-previews' }, box('Hipfire', this.chPreview.hip), box('ADS', this.chPreview.ads)),
      h('div', { class: 'actions' }, h('button', { onclick: () => this.copyCrosshairToAds() }, 'Copiar la de hipfire a ADS')));
  }

  updateCrosshairPreview() {
    const s = this.settings;
    const { hip, ads } = this.chPreview;
    const adsProfile = adsCrosshairProfile(s);
    hip.apply(crosshairProfile(s, 'crosshair'));
    hip.setOpacity(s.crosshairOpacity);
    ads.apply(adsProfile);
    ads.setOpacity(adsProfile.opacity);
  }

  /** Pone en ADS una mira propia igual a la de hipfire, como punto de partida. */
  copyCrosshairToAds() {
    const s = this.settings;
    s.adsCrosshair = 'custom';
    for (const k of CROSSHAIR_KEYS) s[`adsCrosshair${k}`] = s[`crosshair${k}`];
    ['adsCrosshair', ...CROSSHAIR_KEYS.map((k) => `adsCrosshair${k}`)].forEach((k) => this.handlers.onChange(k));
    this.syncInputs();
    this.refresh();
  }

  readoutRows() {
    const s = this.settings;
    const aspect = window.innerWidth / window.innerHeight;
    const hipV = hipVFovDeg(s, aspect);
    const hipDpc = hipDegPerCount(s);
    const sights = Object.values(SIGHTS).map((m) => {
      const adsV = adsVFovDeg(hipV, m.fovMult);
      const dpc = hipDpc * sensFactor(s, 1, adsV, hipV, m.sniper === true);
      return h('tr', {},
        h('td', {}, m.name.split(' (')[0]),
        h('td', { class: 'num' }, `${adsV.toFixed(1)}°`),
        h('td', { class: 'num' }, cm360FromDegPerCount(dpc, s.dpi).toFixed(1)),
        h('td', { class: 'num' }, `${mdvZeroPct(hipV, adsV).toFixed(1)}%`));
    });
    return [
      this.dl([
        ['cm/360 hipfire', cm360FromDegPerCount(hipDpc, s.dpi).toFixed(1)],
        ['FOV hipfire (H / V)', `${hFovFromV(hipV, aspect).toFixed(1)}° / ${hipV.toFixed(1)}°`],
      ]),
      h('h3', {}, 'ADS por nivel de mira'),
      h('table', { class: 'history compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Mira'), h('th', { class: 'num' }, 'FOV V'), h('th', { class: 'num' }, 'cm/360'), h('th', { class: 'num', title: 'Sens de ADS que daría 0% monitor distance' }, '0% MDV'))),
        h('tbody', {}, sights)),
    ];
  }

  buildImport() {
    const file = h('input', { type: 'file', accept: '.sav', class: 'hidden' });
    file.addEventListener('change', () => {
      this.importSave(file.files[0]);
      file.value = '';
    });
    this.importStatus = h('p', { class: 'import-status' });
    const copyBtn = h('button', {
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(SAVE_PATH);
          this.setImportStatus('Ruta copiada. Pégala en la barra de direcciones del diálogo de archivo.');
        } catch {
          this.setImportStatus(`Copia la ruta a mano: ${SAVE_PATH}`);
        }
      },
    }, 'Copiar ruta');

    const box = card('Importar de The Finals',
      h('p', { class: 'muted' }, 'Carga tu ', h('code', {}, 'EmbarkOptionSaveGame.sav'), ' (o arrástralo aquí) para copiar sens, FOV, sens de ADS, escalado focal y color de mira. ',
        'Se lee en tu navegador y no se sube a ningún sitio. Los DPI hay que ponerlos a mano.'),
      h('p', {}, h('code', {}, `${SAVE_PATH}\\EmbarkOptionSaveGame.sav`)),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => file.click() }, 'Cargar .sav…'), copyBtn),
      this.importStatus,
      file,
    );
    box.classList.add('import');
    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      box.classList.add('dragging');
    });
    box.addEventListener('dragleave', () => box.classList.remove('dragging'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('dragging');
      this.importSave(e.dataTransfer.files[0]);
    });
    return box;
  }

  async importSave(file) {
    if (!file) return;
    try {
      const { values, skipped } = settingsFromFinalsSave(parseFinalsSave(await file.arrayBuffer()));
      const keys = Object.keys(values);
      if (!keys.length) throw new Error('El archivo no contiene ajustes de ratón ni de FOV.');
      Object.assign(this.settings, values);
      keys.forEach((k) => this.handlers.onChange(k));
      this.syncInputs();
      this.refresh();
      const shown = keys.filter((k) => FIELD_LABELS.has(k) && k !== 'sensMode' && k !== 'fovType');
      const fmt = (v) => (v === true ? 'ON' : v === false ? 'OFF' : String(v));
      let text = `Importado: ${shown.map((k) => `${FIELD_LABELS.get(k)} ${fmt(values[k])}`).join(' · ')}.`;
      if (skipped.length) text += ` Ignorado por valor no válido: ${skipped.join(', ')}.`;
      this.setImportStatus(text);
    } catch (err) {
      this.setImportStatus(`No se ha podido importar: ${err.message}`, true);
    }
  }

  setImportStatus(text, error = false) {
    this.importStatus.textContent = text;
    this.importStatus.classList.toggle('error', error);
  }

  // ---------- Formularios ----------

  /** Tarjetas de formulario de una página; con `only`, solo las de esa pestaña. */
  schemaCards(page, only = null) {
    return SETTINGS_SCHEMA.filter((g) => g.page === page && (!only || tabOf(g) === only))
      .map((g) => card(g.section, h('div', { class: 'fields' }, g.fields.map((f) => this.buildField(f)))));
  }

  /** Vuelca los valores actuales de settings en los controles del formulario. */
  syncInputs() {
    for (const { f, input } of this.fieldRows) {
      if (f.type === 'checkbox') input.checked = this.settings[f.key];
      else if (f.type === 'key') input.textContent = keyLabel(this.settings[f.key]);
      else input.value = String(this.settings[f.key]);
    }
  }

  buildField(f) {
    const s = this.settings;
    let input;
    if (f.type === 'select') {
      input = h('select', {}, f.options.map(([v, label]) => h('option', { value: v, selected: s[f.key] === v }, label)));
      input.addEventListener('change', () => this.set(f.key, input.value));
    } else if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', checked: s[f.key] });
      input.addEventListener('change', () => this.set(f.key, input.checked));
    } else if (f.type === 'color') {
      input = h('input', { type: 'color', value: s[f.key] });
      input.addEventListener('input', () => this.set(f.key, input.value));
    } else if (f.type === 'key') {
      input = h('button', { class: 'keybind', type: 'button' }, keyLabel(s[f.key]));
      input.addEventListener('click', () => this.captureKey(f, input));
    } else {
      input = h('input', { type: 'number', value: String(s[f.key]), min: f.min, max: f.max, step: f.step });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (input.value === '' || !Number.isFinite(v)) return void (input.value = String(s[f.key]));
        const clamped = Math.min(f.max, Math.max(f.min, v));
        input.value = String(clamped);
        this.set(f.key, clamped);
      });
    }
    const row = h(f.type === 'key' ? 'div' : 'label', { class: 'field' },
      h('div', { class: 'field-label' }, h('span', {}, f.label), f.hint && h('small', {}, f.hint)),
      input);
    this.fieldRows.push({ f, row, input });
    return row;
  }

  /** Espera a la siguiente tecla y la asigna. Esc cancela; WASD está reservado para moverse. */
  captureKey(f, button) {
    if (this.capturing) return;
    button.textContent = 'Pulsa una tecla…';
    button.classList.add('capturing');
    const done = () => {
      window.removeEventListener('keydown', onKey, true);
      button.removeEventListener('blur', done);
      button.classList.remove('capturing');
      button.textContent = keyLabel(this.settings[f.key]);
      this.capturing = false;
    };
    const onKey = (e) => {
      // En fase de captura sobre window: ningún otro listener ve esta tecla
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return done();
      if (MOVE_KEYS.has(e.code)) {
        button.textContent = 'WASD es para moverse';
        return;
      }
      this.set(f.key, e.code);
      done();
    };
    this.capturing = true;
    window.addEventListener('keydown', onKey, true);
    button.addEventListener('blur', done);
  }

  set(key, value) {
    this.settings[key] = value;
    this.handlers.onChange(key);
    this.refresh();
  }

  dl(rows) {
    return h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))]));
  }

  // ---------- Resultados ----------

  /**
   * @param r { key, ranked, weaponName, score (número), rows: [[etiqueta, valor]] }
   */
  showResults(r) {
    this.results = r;
    this.setPaused(null);
    this.show('results');
  }

  renderResults() {
    const r = this.results;
    const def = SCENARIOS[r.key];
    const fmt = def.formatScore;
    const entries = r.ranked ? getHistory(r.key, def) : [];
    const previous = entries.slice(0, -1).map((e) => e.score);
    const best = previous.length ? Math.max(...previous) : null;

    let badge;
    if (!r.ranked) badge = h('span', { class: 'badge' }, 'Sandbox · no se guarda');
    else if (best === null) badge = h('span', { class: 'badge' }, 'Primera partida registrada');
    else if (r.score > best) badge = h('span', { class: 'badge record' }, `¡Nuevo récord! Antes ${fmt(best)}`);
    else badge = h('span', { class: 'badge' }, `Récord ${fmt(best)} · a ${fmt(round1(best - r.score))}`);

    const again = keyLabel(this.settings.restartKey);
    return [
      h('header', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, r.ranked ? `Resultados · ${def.group}` : 'Resultados · Sandbox'),
        h('h1', {}, def.name),
        h('p', { class: 'lead' }, r.weaponName)),
      h('div', { class: 'result-hero' },
        h('div', { class: 'score' }, h('span', { class: 'score-label' }, 'Puntuación'), h('strong', {}, fmt(r.score)), badge),
        h('div', { class: 'actions' },
          h('button', { class: 'primary big', onclick: () => this.handlers.onRestart() }, `Repetir (${again})`),
          r.ranked
            ? h('button', { onclick: () => this.navigate('scenario', r.key) }, 'Ver estadísticas')
            : h('button', { onclick: () => this.navigate('sandbox') }, 'Configurar Sandbox'),
          h('button', { onclick: () => this.navigate('scenarios') }, 'Escenarios'))),
      h('div', { class: 'tiles' }, r.rows.map(([k, v]) => tile(k, String(v)))),
      r.ranked && entries.length > 1 && card('Progreso', progressChart(entries, fmt, def.formatTick, { width: 860, height: 220 })),
    ];
  }

  /** Muestra el menú en una página (por defecto, la última abierta). */
  show(page = this.page, key = this.detailKey) {
    this.root.classList.remove('hidden');
    this.navigate(page, key);
  }

  hide() { this.root.classList.add('hidden'); }
}
