// Progresso salvo no aparelho (localStorage) + exportar/importar.
import { toast } from './ui.js';

const KEY = 'step1-progress-v1';
const VERSION = 1;

let state = null;

function fresh() {
  return {
    v: VERSION,
    created: Date.now(),
    updated: Date.now(),
    settings: { theme: 'auto', font: 1, examTimer: true },
    modules: {}, // por módulo: pretest, units, path (checkpoints/final)
    concepts: {}, // por conceito: tentativas e agenda de revisão
    seen: {}, // questões já vistas: id → timestamp
    errors: {}, // caderno de erros: itemId → registro
    sessions: {}, // sessões em andamento (para retomar exatamente)
    last: null, // chave da última sessão aberta
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch (e) {
    state = null;
  }
  if (!state || state.v !== VERSION) state = fresh();
  state.settings = Object.assign(fresh().settings, state.settings || {});
  for (const k of ['modules', 'concepts', 'seen', 'errors', 'sessions']) state[k] = state[k] || {};
  return state;
}

let warned = false;
// Grava na hora (localStorage é síncrono e o estado é pequeno): fechar o app logo após um toque não perde nada.
export function save() {
  state.updated = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    if (!warned) {
      warned = true;
      toast('Não consegui salvar o progresso neste aparelho. Exporte o progresso em Configurações.', { timeout: 8000 });
    }
  }
}

export function S() {
  return state || load();
}

export function modState(id) {
  const s = S();
  s.modules[id] = s.modules[id] || { pretest: null, units: {}, path: {} };
  const m = s.modules[id];
  m.units = m.units || {};
  m.path = m.path || {};
  return m;
}

export function exportProgress() {
  return JSON.stringify({ app: 'step1-interativo', exported: new Date().toISOString(), progress: S() }, null, 1);
}

export function importProgress(text) {
  const data = JSON.parse(text);
  const p = data && data.progress ? data.progress : data;
  if (!p || p.v !== VERSION || typeof p.concepts !== 'object') throw new Error('Arquivo não reconhecido');
  const base = fresh();
  state = Object.assign(base, p);
  state.settings = Object.assign(fresh().settings, p.settings || {});
  for (const k of ['modules', 'concepts', 'seen', 'errors', 'sessions']) state[k] = state[k] || {};
  save(true);
}

export function resetProgress() {
  const settings = S().settings;
  state = fresh();
  state.settings = settings;
  save(true);
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch (e) {
    /* ignora */
  }
}
