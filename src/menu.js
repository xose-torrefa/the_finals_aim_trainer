import { h } from './dom.js';
import { SETTINGS_SCHEMA, CROSSHAIR_KEYS, fieldText, sanitizeSettings, keyLabel, hipVFovDeg, adsVFovDeg, mdvZeroPct, hFovFromV, hipDegPerCount, sensFactor, cm360FromDegPerCount } from './settings.js';
import { SIGHTS, resolveWeapon, weaponName, sightName } from './weapons.js';
import { SCENARIOS, fixedParts, scenarioName, scenarioDesc, groupName } from './scenarios.js';
import { getHistory, exportHistory, mergeHistory } from './history.js';
import { analysisView } from './analysis.js';
import { progressChart } from './chart.js';
import { Crosshair, crosshairProfile, adsCrosshairProfile } from './crosshair.js';
import { parseFinalsSave, settingsFromFinalsSave, SAVE_PATH } from './finals-save.js';
import { t, hasText, locale, LANGUAGES } from './i18n.js';

const FIELDS = new Map(SETTINGS_SCHEMA.flatMap((g) => g.fields).map((f) => [f.key, f]));
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const CROSSHAIR_TAB = 'crosshair';
const AUDIO_TAB = 'audio';
const IMPORT_TAB = 'import';
const BACKUP_TAB = 'backup';
const BACKUP_APP = 'finals-aim';
const BACKUP_MAX_BYTES = 20 * 1024 * 1024;
const SOUND_TESTS = ['shot', 'hit', 'head', 'kill', 'countdown'];
const tabOf = (g) => g.tab ?? g.section;

const NAV = ['scenarios', 'sandbox', 'settings'];

const GROUPS = Map.groupBy(Object.entries(SCENARIOS), ([, sc]) => sc.group);

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x) => Math.round(x * 10) / 10;
const pctText = (x) => (Number.isFinite(x) ? `${x.toFixed(1)}%` : '—');
const numText = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const dateText = (time, year = false) => new Date(time).toLocaleString(locale(), {
  day: '2-digit', month: '2-digit', year: year ? '2-digit' : undefined, hour: '2-digit', minute: '2-digit',
});

const tile = (label, value, cls = '') => h('div', { class: `tile ${cls}` }, h('span', {}, label), h('strong', {}, value));
const chips = (parts) => h('div', { class: 'chips' }, parts.map((p) => h('span', { class: 'chip' }, p)));
const card = (title, ...children) => h('section', { class: 'card' }, title && h('h2', {}, title), children);

/** Hace que se pueda soltar un archivo sobre una tarjeta. */
function dropZone(box, onFile) {
  box.classList.add('import');
  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    box.classList.add('dragging');
  });
  box.addEventListener('dragleave', () => box.classList.remove('dragging'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('dragging');
    onFile(e.dataTransfer.files[0]);
  });
  return box;
}

export class Menu {
  /**
   * @param handlers { onPlay(key, ranked), onResume(), onRestart(), onQuit(), onChange(key),
   *   onReplace() (tras sustituir todos los ajustes), onSound(kind) }
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
    this.navButtons = NAV.map((page) => {
      const b = h('button', { class: 'nav-item', onclick: () => this.navigate(page) }, t(`nav.${page}`));
      b.dataset.page = page;
      return b;
    });
    this.pauseCard = h('div', { class: 'pause-card hidden' });
    this.keysHint = h('p', { class: 'keys' });
    this.content = h('main', { class: 'content' });
    const language = h('select', {},
      LANGUAGES.map((l) => h('option', { value: l.code, selected: this.settings.language === l.code }, l.name)));
    language.addEventListener('change', () => this.set('language', language.value));
    this.root.replaceChildren(
      h('aside', { class: 'sidebar' },
        h('div', { class: 'brand' }, 'FINALS ', h('span', {}, 'AIM')),
        h('nav', {}, this.navButtons),
        this.pauseCard,
        this.keysHint,
        h('label', { class: 'language' }, h('span', {}, t('menu.language')), language)),
      this.content,
    );
  }

  /** Reconstruye el menú entero con los textos del idioma actual, sin cambiar de página. */
  rebuild() {
    const scroll = this.content.scrollTop;
    this.buildShell();
    this.setPaused(this.paused);
    this.render();
    this.content.scrollTop = scroll;
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
    this.keysHint.textContent = t('menu.keys', { key: keyLabel(s.restartKey) });
  }

  /** Muestra en la barra lateral la partida en pausa (al abrir los ajustes desde la pausa). */
  setPaused(info) {
    this.paused = info;
    this.pauseCard.classList.toggle('hidden', !info);
    if (!info) return;
    this.pauseCard.replaceChildren(
      h('span', { class: 'eyebrow' }, t('pause.card')),
      h('strong', {}, scenarioName(info.key)),
      h('button', { class: 'primary', onclick: () => this.handlers.onResume() }, t('common.resume')),
      h('button', { onclick: () => this.handlers.onQuit() }, t('common.quit')),
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
        h('h1', {}, t('nav.scenarios')),
        h('p', { class: 'lead' }, t('scenarios.lead'))),
      [...GROUPS].map(([group, entries]) => h('section', { class: 'group' },
        h('h2', {}, groupName(group)),
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
    h('h3', {}, scenarioName(key)),
    h('p', { class: 'desc' }, scenarioDesc(key)),
    chips(fixedParts(key)),
    h('div', { class: 'card-foot' },
      h('div', { class: 'mini-stat' }, h('span', {}, t('stat.best')), h('strong', {}, best)),
      h('div', { class: 'mini-stat' }, h('span', {}, t('stat.runs')), h('strong', {}, String(entries.length))),
      h('button', {
        class: 'primary play',
        onclick: (e) => {
          e.stopPropagation();
          this.handlers.onPlay(key, true);
        },
      }, t('common.play'))));
  }

  renderScenario(key) {
    const def = SCENARIOS[key];
    const entries = getHistory(key, def);
    return [
      h('button', { class: 'back', onclick: () => this.navigate('scenarios') }, t('scenarios.back')),
      h('header', { class: 'page-head detail-head' },
        h('div', {},
          h('span', { class: 'eyebrow' }, groupName(def.group)),
          h('h1', {}, scenarioName(key)),
          h('p', { class: 'lead' }, scenarioDesc(key)),
          chips(fixedParts(key))),
        h('button', { class: 'primary big', onclick: () => this.handlers.onPlay(key, true) }, t('common.play'))),
      entries.length ? this.statsBlock(def, entries) : card(null, h('p', { class: 'empty' }, t('scenarios.empty'))),
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
        tile(t('stat.runs'), String(entries.length)),
        tile(t('stat.best'), fmt(scores[bestIdx]), 'accent'),
        tile(t('stat.avgLast', { n: recent.length }), fmt(round1(avg(recent.map((e) => e.score))))),
        tile(t('stat.last'), fmt(scores.at(-1))),
        tile(t('stat.accLast', { n: recent.length }), accs.length ? pctText(avg(accs)) : '—')),
      card(t('card.progress'), progressChart(entries, fmt, def.formatTick, { width: 860, height: 240 })),
      card(t('card.history'),
        h('table', { class: 'history' },
          h('thead', {}, h('tr', {},
            h('th', {}, '#'), h('th', {}, t('col.date')), h('th', { class: 'num' }, t('col.score')), h('th', { class: 'num' }, t('col.accuracy')),
            h('th', { class: 'num' }, 'cm/360'), h('th', { class: 'num' }, 'cm/360 ADS'), h('th', { class: 'num' }, 'FOV'))),
          h('tbody', {}, rows.map(({ e, i }) => h('tr', { class: i === bestIdx ? 'best' : '' },
          h('td', { class: 'muted' }, String(i + 1)),
          h('td', {}, dateText(e.t, true)),
          num(fmt(e.score)),
          num(pctText(e.accuracy)),
          num(numText(e.cm360)),
          num(numText(e.adsCm360)),
          num(e.fov ?? '—'))))),
        entries.length > rows.length && h('p', { class: 'muted small' }, t('history.showing', { shown: rows.length, total: entries.length }))),
    ];
  }

  // ---------- Sandbox ----------

  renderSandbox() {
    const s = this.settings;
    const list = [...GROUPS].map(([group, entries]) => [
      h('h3', {}, groupName(group)),
      h('div', { class: 'pick-grid' }, entries.map(([key]) => h('label', { class: 'pick', title: scenarioDesc(key) },
        h('input', { type: 'radio', name: 'sandbox-scenario', value: key, checked: s.scenario === key, onchange: () => this.set('scenario', key) }),
        h('strong', {}, scenarioName(key))))),
    ]);
    this.weaponInfo = h('div');
    return [
      h('header', { class: 'page-head' },
        h('h1', {}, t('nav.sandbox')),
        h('p', { class: 'lead' }, t('sandbox.lead'))),
      h('div', { class: 'split' },
        h('div', { class: 'stack' },
          card(t('sandbox.scenario'), list),
          this.schemaCards('sandbox')),
        h('aside', { class: 'stack sticky' },
          card(t('sandbox.weapon'), this.weaponInfo),
          h('button', { class: 'primary big', onclick: () => this.handlers.onPlay(s.scenario, false) }, t('sandbox.play')))),
    ];
  }

  weaponRows() {
    const w = resolveWeapon(this.settings);
    return this.dl([
      [t('info.weapon'), weaponName(w.key, true)],
      [t('info.sight'), `${sightName(w.sight, true)} · ${Math.round(w.fovMult * 100)}% FOV`],
      [t('info.adsTime'), `${Math.round(w.adsTime * 1000)} ms`],
      [t('info.fireRate'), `${w.rpm} RPM${w.auto ? ' · auto' : ''}`],
    ]);
  }

  // ---------- Ajustes ----------

  renderSettings() {
    this.readout = h('div', { class: 'readout-wrap' });
    const tabs = [...new Set(SETTINGS_SCHEMA.filter((g) => g.page === 'settings').map(tabOf)), IMPORT_TAB, BACKUP_TAB];
    const active = tabs.includes(this.settingsTab) ? this.settingsTab : tabs[0];
    const custom = { [IMPORT_TAB]: () => this.buildImport(), [BACKUP_TAB]: () => this.buildBackup() };
    const body = custom[active] ? custom[active]() : this.schemaCards('settings', active);
    return [
      h('header', { class: 'page-head' },
        h('h1', {}, t('nav.settings')),
        h('p', { class: 'lead' }, t('settings.lead'))),
      h('div', { class: 'split' },
        h('div', { class: 'stack' },
          h('div', { class: 'subtabs', role: 'tablist' }, tabs.map((tab) => h('button', {
            class: tab === active ? 'active' : '',
            role: 'tab',
            onclick: () => {
              this.settingsTab = tab;
              this.render();
            },
          }, t(`section.${tab}`)))),
          body),
        h('aside', { class: 'stack sticky' },
          active === CROSSHAIR_TAB && this.buildCrosshairPreview(),
          active === AUDIO_TAB && card(t('settings.testSounds'),
            h('div', { class: 'actions' }, SOUND_TESTS.map((kind) => h('button', { onclick: () => this.handlers.onSound(kind) }, t(`test.${kind}`))))),
          card(t('settings.effective'), this.readout))),
    ];
  }

  buildCrosshairPreview() {
    this.chPreview = { hip: new Crosshair(), ads: new Crosshair() };
    const box = (label, ch) => h('div', { class: 'ch-preview' }, h('span', {}, label), ch.el);
    return card(t('settings.preview'),
      h('div', { class: 'ch-previews' }, box('Hipfire', this.chPreview.hip), box('ADS', this.chPreview.ads)),
      h('div', { class: 'actions' }, h('button', { onclick: () => this.copyCrosshairToAds() }, t('settings.copyToAds'))));
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
    const sights = Object.entries(SIGHTS).map(([key, m]) => {
      const adsV = adsVFovDeg(hipV, m.fovMult);
      const dpc = hipDpc * sensFactor(s, 1, adsV, hipV, m.sniper === true);
      return h('tr', {},
        h('td', {}, sightName(key, true)),
        h('td', { class: 'num' }, `${adsV.toFixed(1)}°`),
        h('td', { class: 'num' }, cm360FromDegPerCount(dpc, s.dpi).toFixed(1)),
        h('td', { class: 'num' }, `${mdvZeroPct(hipV, adsV).toFixed(1)}%`));
    });
    return [
      this.dl([
        ['cm/360 hipfire', cm360FromDegPerCount(hipDpc, s.dpi).toFixed(1)],
        ['FOV hipfire (H / V)', `${hFovFromV(hipV, aspect).toFixed(1)}° / ${hipV.toFixed(1)}°`],
      ]),
      h('h3', {}, t('settings.adsBySight')),
      h('table', { class: 'history compact' },
        h('thead', {}, h('tr', {}, h('th', {}, t('info.sight')), h('th', { class: 'num' }, 'FOV V'), h('th', { class: 'num' }, 'cm/360'), h('th', { class: 'num', title: t('settings.mdvTitle') }, '0% MDV'))),
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
          this.setImportStatus(t('import.pathCopied'));
        } catch {
          this.setImportStatus(t('import.copyManually', { path: SAVE_PATH }));
        }
      },
    }, t('import.copyPath'));

    const [before, after] = t('import.desc').split('{file}');
    const box = card(t('section.import'),
      h('p', { class: 'muted' }, before, h('code', {}, 'EmbarkOptionSaveGame.sav'), after),
      h('p', {}, h('code', {}, `${SAVE_PATH}\\EmbarkOptionSaveGame.sav`)),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => file.click() }, t('import.load')), copyBtn),
      this.importStatus,
      file,
    );
    return dropZone(box, (f) => this.importSave(f));
  }

  async importSave(file) {
    if (!file) return;
    try {
      const { values, skipped } = settingsFromFinalsSave(parseFinalsSave(await file.arrayBuffer()));
      const keys = Object.keys(values);
      if (!keys.length) throw new Error(t('import.nothing'));
      Object.assign(this.settings, values);
      keys.forEach((k) => this.handlers.onChange(k));
      this.syncInputs();
      this.refresh();
      const shown = keys.filter((k) => FIELDS.has(k) && k !== 'sensMode' && k !== 'fovType');
      const fmt = (v) => (v === true ? 'ON' : v === false ? 'OFF' : String(v));
      let text = t('import.done', { list: shown.map((k) => `${t(fieldText(FIELDS.get(k)))} ${fmt(values[k])}`).join(' · ') });
      if (skipped.length) text += t('import.skipped', { list: skipped.join(', ') });
      this.setImportStatus(text);
    } catch (err) {
      this.setImportStatus(t('import.failed', { error: err.message }), true);
    }
  }

  setImportStatus(text, error = false) {
    this.importStatus.textContent = text;
    this.importStatus.classList.toggle('error', error);
  }

  // ---------- Copia de seguridad ----------

  buildBackup() {
    const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    file.addEventListener('change', () => {
      this.importBackup(file.files[0]);
      file.value = '';
    });
    this.withSettings = h('input', { type: 'checkbox', checked: true });
    this.backupStatus = h('p', { class: 'import-status' });
    const box = card(t('section.backup'),
      h('p', { class: 'muted' }, t('backup.desc')),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: () => this.exportBackup() }, t('backup.export')),
        h('button', { onclick: () => file.click() }, t('backup.import'))),
      h('label', { class: 'check' }, this.withSettings, h('span', {}, t('backup.withSettings'))),
      this.backupStatus,
      file,
    );
    return dropZone(box, (f) => this.importBackup(f));
  }

  setBackupStatus(text, error = false) {
    this.backupStatus.textContent = text;
    this.backupStatus.classList.toggle('error', error);
  }

  /** Descarga un JSON con los ajustes y todo el historial. */
  exportBackup() {
    const now = new Date();
    const data = { app: BACKUP_APP, version: 1, exported: now.toISOString(), settings: this.settings, history: exportHistory() };
    const name = `finals-aim-${now.toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    h('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.setBackupStatus(t('backup.exported', { file: name }));
  }

  async importBackup(file) {
    if (!file) return;
    try {
      if (file.size > BACKUP_MAX_BYTES) throw new Error(t('backup.tooBig'));
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error(t('backup.invalid'));
      }
      if (data?.app !== BACKUP_APP || typeof data.history !== 'object') throw new Error(t('backup.invalid'));
      const { added, skipped } = mergeHistory(data.history);
      const restore = this.withSettings.checked && data.settings && typeof data.settings === 'object';
      if (restore) {
        Object.assign(this.settings, sanitizeSettings(data.settings));
        this.handlers.onReplace(); // reconstruye el menú: el mensaje va después, ya en el idioma nuevo
      }
      this.setBackupStatus(t('backup.imported', { added, skipped }) + (restore ? t('backup.settingsRestored') : ''));
    } catch (err) {
      this.setBackupStatus(t('backup.failed', { error: err.message }), true);
    }
  }

  // ---------- Formularios ----------

  /** Tarjetas de formulario de una página; con `only`, solo las de esa pestaña. */
  schemaCards(page, only = null) {
    return SETTINGS_SCHEMA.filter((g) => g.page === page && (!only || tabOf(g) === only))
      .map((g) => card(t(`section.${g.section}`), h('div', { class: 'fields' }, g.fields.map((f) => this.buildField(f)))));
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
      input = h('select', {}, f.options.map(([v, text]) => h('option', { value: v, selected: s[f.key] === v }, t(text))));
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
    const text = fieldText(f);
    const row = h(f.type === 'key' ? 'div' : 'label', { class: 'field' },
      h('div', { class: 'field-label' }, h('span', {}, t(text)), hasText(`${text}.hint`) && h('small', {}, t(`${text}.hint`))),
      input);
    this.fieldRows.push({ f, row, input });
    return row;
  }

  /** Espera a la siguiente tecla y la asigna. Esc cancela; WASD está reservado para moverse. */
  captureKey(f, button) {
    if (this.capturing) return;
    button.textContent = t('settings.pressKey');
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
        button.textContent = t('settings.wasdReserved');
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
   * @param r { key, ranked, weapon (clave), score (número), rows: [[clave de texto, valor]] }
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
    if (!r.ranked) badge = h('span', { class: 'badge' }, t('results.sandbox'));
    else if (best === null) badge = h('span', { class: 'badge' }, t('results.first'));
    else if (r.score > best) badge = h('span', { class: 'badge record' }, t('results.record', { prev: fmt(best) }));
    else badge = h('span', { class: 'badge' }, t('results.behind', { best: fmt(best), diff: fmt(round1(best - r.score)) }));

    const again = keyLabel(this.settings.restartKey);
    return [
      h('header', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, t('results.eyebrow', { mode: r.ranked ? groupName(def.group) : 'Sandbox' })),
        h('h1', {}, scenarioName(r.key)),
        h('p', { class: 'lead' }, weaponName(r.weapon))),
      h('div', { class: 'result-hero' },
        h('div', { class: 'score' }, h('span', { class: 'score-label' }, t('col.score')), h('strong', {}, fmt(r.score)), badge),
        h('div', { class: 'actions' },
          h('button', { class: 'primary big', onclick: () => this.handlers.onRestart() }, t('results.retry', { key: again })),
          r.ranked
            ? h('button', { onclick: () => this.navigate('scenario', r.key) }, t('results.stats'))
            : h('button', { onclick: () => this.navigate('sandbox') }, t('results.setup')),
          h('button', { onclick: () => this.navigate('scenarios') }, t('nav.scenarios')))),
      h('div', { class: 'tiles' }, r.rows.map(([k, v]) => tile(t(k), String(v)))),
      r.analysis && this.analysisCard(r.analysis),
      r.ranked && entries.length > 1 && card(t('card.progress'), progressChart(entries, fmt, def.formatTick, { width: 860, height: 220 })),
    ];
  }

  analysisCard(a) {
    const { tiles, tips } = analysisView(a);
    return card(t('card.analysis'),
      h('div', { class: 'tiles' }, tiles.map(([k, v]) => tile(k, v))),
      tips.length > 0 && h('ul', { class: 'tips' }, tips.map((text) => h('li', {}, text))),
      h('p', { class: 'muted small' }, t('an.note')));
  }

  /** Muestra el menú en una página (por defecto, la última abierta). */
  show(page = this.page, key = this.detailKey) {
    this.root.classList.remove('hidden');
    this.navigate(page, key);
  }

  hide() { this.root.classList.add('hidden'); }
}
