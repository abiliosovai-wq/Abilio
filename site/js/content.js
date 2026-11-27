// Carrega o catálogo e os módulos (arquivos de dados) e monta índices.
import { termKey } from './markup.js';

export const C = {
  catalog: null,
  index: [],
  modules: {}, // id → módulo indexado
  labs: null,
  glossary: new Map(), // chave → entrada (todas as matérias)
};

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Falha ao carregar ${url} (${r.status})`);
  return r.json();
}

export async function loadAll() {
  const [catalog, index, labs] = await Promise.all([
    getJSON('content/catalog.json'),
    getJSON('content/index.json'),
    getJSON('content/labs.json'),
  ]);
  C.catalog = catalog;
  C.index = index.modules || [];
  C.labs = labs;
  await Promise.all(
    C.index.map(async (entry) => {
      const data = await getJSON('content/modules/' + entry.file);
      C.modules[data.id] = indexModule(data);
    })
  );
  return C;
}

export function indexModule(m) {
  m.q = new Map();
  for (const q of m.questions || []) m.q.set(q.id, q);
  m.c = new Map();
  for (const c of m.concepts || []) m.c.set(c.id, c);
  m.u = new Map();
  m.screens = new Map(); // id → {screen, unit}
  for (const u of m.units || []) {
    m.u.set(u.id, u);
    for (const s of u.screens || []) m.screens.set(s.id, { screen: s, unit: u.id });
  }
  // Regras numeradas pela ordem do caderno.
  m.r = new Map();
  (m.rules || []).forEach((r, i) => {
    r.n = i + 1;
    m.r.set(r.id, r);
  });
  m.pathways = m.pathways || {};
  for (const [k, pw] of Object.entries(m.pathways)) pw.key = `${m.id}-${k}`;
  m.pathItems = (m.path || []).map((p, i) => ({ ...p, key: p.id || p.unit || p.type + i }));
  for (const g of m.glossary || []) {
    g.module = m.id;
    for (const k of [g.id, g.en, g.pt, ...(g.aliases || [])]) if (k) C.glossary.set(termKey(k), g);
  }
  return m;
}

export function mod(id) {
  return C.modules[id];
}

export function unitOfConcept(m, cid) {
  const c = m.c.get(cid);
  return c ? c.unit : null;
}

export function conceptName(m, cid) {
  const c = m.c.get(cid);
  return c ? c.name : cid;
}

export function rule(m, rid) {
  return m.r.get(rid);
}

// Primeiro cartão da lição associado a um conceito (para remediação).
export function cardForConcept(m, cid) {
  for (const u of m.units) {
    for (const s of u.screens || []) {
      if (s.type === 'card' && (s.concepts || []).includes(cid)) return s.id;
    }
  }
  return null;
}

export function unitReady(m, uid) {
  const u = m.u.get(uid);
  return !!u && u.status === 'ready';
}
