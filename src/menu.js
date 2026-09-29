import { SETTINGS_SCHEMA, hipVFovDeg, adsVFovDeg, mdvZeroPct, hFovFromV, hipDegPerCount, sensFactor, cm360FromDegPerCount } from './settings.js';
import { SIGHTS } from './weapons.js';
import { SCENARIOS } from './scenarios.js';
import { parseFinalsSave, settingsFromFinalsSave, SAVE_PATH } from './finals-save.js';

const FIELD_LABELS = new Map(SETTINGS_SCHEMA.flatMap((g) => g.fields).map((f) => [f.key, f.label]));

// Crea elementos sin innerHTML (compatible con la CSP y sin riesgo de inyección).
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el[k] = v;
  }
  for (const c of children.flat(Infinity)) {
    if (c !== null && c !== undefined && c !== false) el.append(c);
  }
  return el;
}

export class Menu {
  /**
   * @param handlers { onStart, onResume, onChange(key), getWeapon() }
   */
  constructor(root, settings, handlers) {
    this.root = root;
    this.settings = settings;
    this.handlers = handlers;
    this.fieldRows = [];
    this.build();
    this.setMode('main');
  }

  build() {
    const s = this.settings;

    const groups = Map.groupBy(Object.entries(SCENARIOS), ([, sc]) => sc.group);
    this.scenarioList = h('div', { class: 'scenarios' },
      [...groups].map(([group, entries]) => [
        h('h3', {}, group),
        entries.map(([key, sc]) => {
          const input = h('input', { type: 'radio', name: 'scenario', value: key, checked: s.scenario === key,
            onchange: () => this.set('scenario', key) });
          return h('label', { class: 'scenario' }, input,
            h('div', {}, h('strong', {}, sc.name), h('p', {}, sc.desc)));
        }),
      ]));

    this.startBtn = h('button', { class: 'primary', onclick: () => this.handlers.onStart() }, 'Empezar');
    this.resumeBtn = h('button', { class: 'primary', onclick: () => this.handlers.onResume() }, 'Continuar');
    this.restartBtn = h('button', { onclick: () => this.handlers.onStart() }, 'Reiniciar');
    this.message = h('p', { class: 'message' });
    this.results = h('div', { class: 'results hidden' });
    this.readout = h('dl', { class: 'readout' });

    const left = h('section', { class: 'panel left' },
      h('h1', {}, 'FINALS ', h('span', {}, 'AIM')),
      h('h2', {}, 'Escenario'),
      this.scenarioList,
      h('div', { class: 'actions' }, this.resumeBtn, this.startBtn, this.restartBtn),
      this.message,
      this.results,
      h('h2', {}, 'Valores efectivos'),
      this.readout,
      h('p', { class: 'keys' }, 'Clic izq: disparar · Clic der: ADS · WASD: moverse · Esc: pausa'),
    );

    const right = h('section', { class: 'panel right' },
      this.buildImport(),
      SETTINGS_SCHEMA.map((group) => h('fieldset', {},
        h('legend', {}, group.section),
        group.fields.map((f) => this.buildField(f)))));

    this.root.replaceChildren(h('div', { class: 'menu-grid' }, left, right));
    this.refresh();
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

    const box = h('fieldset', { class: 'wide import' },
      h('legend', {}, 'Importar de The Finals'),
      h('p', {}, 'Carga tu ', h('code', {}, 'EmbarkOptionSaveGame.sav'), ' (o arrástralo aquí) para copiar sens, FOV, sens de ADS, escalado focal y color de mira. ',
        'Se lee en tu navegador y no se sube a ningún sitio. Los DPI hay que ponerlos a mano.'),
      h('p', { class: 'path' }, h('code', {}, `${SAVE_PATH}\\EmbarkOptionSaveGame.sav`)),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => file.click() }, 'Cargar .sav…'), copyBtn),
      this.importStatus,
      file,
    );
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

  /** Vuelca los valores actuales de settings en los controles del formulario. */
  syncInputs() {
    for (const { f, input } of this.fieldRows) {
      if (f.type === 'checkbox') input.checked = this.settings[f.key];
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
    } else {
      input = h('input', { type: 'number', value: String(s[f.key]), min: f.min, max: f.max, step: f.step });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return void (input.value = String(s[f.key]));
        const clamped = Math.min(f.max, Math.max(f.min, v));
        input.value = String(clamped);
        this.set(f.key, clamped);
      });
    }
    const row = h('label', { class: 'field', title: f.hint ?? '' }, h('span', {}, f.label), input);
    this.fieldRows.push({ f, row, input });
    return row;
  }

  set(key, value) {
    this.settings[key] = value;
    this.handlers.onChange(key);
    this.refresh();
  }

  refresh() {
    const s = this.settings;
    for (const { f, row } of this.fieldRows) row.classList.toggle('hidden', f.showIf ? !f.showIf(s) : false);

    const aspect = window.innerWidth / window.innerHeight;
    const w = this.handlers.getWeapon();
    const hipV = hipVFovDeg(s, aspect);
    const adsV = adsVFovDeg(hipV, w.fovMult);
    const hipDpc = hipDegPerCount(s);
    const adsDpc = hipDpc * sensFactor(s, 1, adsV, hipV, w.sniper);
    const rows = [
      ['cm/360 hipfire', cm360FromDegPerCount(hipDpc, s.dpi).toFixed(1)],
      ['cm/360 ADS', cm360FromDegPerCount(adsDpc, s.dpi).toFixed(1)],
      ['FOV hip (H / V)', `${hFovFromV(hipV, aspect).toFixed(1)}° / ${hipV.toFixed(1)}°`],
      ['FOV ADS (H / V)', `${hFovFromV(adsV, aspect).toFixed(1)}° / ${adsV.toFixed(1)}°`],
      ['Mira', `${SIGHTS[w.sight].name.split(' (')[0]} · ${Math.round(w.fovMult * 100)}% FOV`],
      ['Tiempo ADS', `${Math.round(w.adsTime * 1000)} ms`],
      ['Sens ADS para 0% MDV', `${mdvZeroPct(hipV, adsV).toFixed(1)}%`],
    ];
    this.readout.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  /** 'main' | 'pause' | 'results' */
  setMode(mode) {
    this.mode = mode;
    this.resumeBtn.classList.toggle('hidden', mode !== 'pause');
    this.restartBtn.classList.toggle('hidden', mode === 'main');
    this.startBtn.classList.toggle('hidden', mode !== 'main');
    this.results.classList.toggle('hidden', mode !== 'results');
    this.setMessage(mode === 'pause' ? 'Pausa. Puedes cambiar ajustes y continuar.' : '');
  }

  setMessage(text) {
    this.message.textContent = text;
  }

  showResults(title, rows, bestText, isRecord) {
    this.results.replaceChildren(
      h('h2', {}, title),
      h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))])),
      h('p', { class: isRecord ? 'best record' : 'best' }, isRecord ? `¡Nuevo récord! ${bestText}` : `Récord: ${bestText}`),
    );
    this.setMode('results');
  }

  show() { this.root.classList.remove('hidden'); this.refresh(); }
  hide() { this.root.classList.add('hidden'); }
}
