#!/usr/bin/env node
// Validação do conteúdo — roda antes de cada publicação (GitHub Actions) e bloqueia o deploy se houver erro.
// Uso: node scripts/validate.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'site', 'content');
const errors = [];
const warnings = [];
const verify = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const CARD_WORDS_WARN = 80;
const CARD_WORDS_MAX = 90;
const MAX_CARDS_IN_A_ROW = 2;
const MIN_VARIANTS = 3;
const BANNED = /\b(all of the above|none of the above|both [a-e] and [a-e])\b|\bEXCEPT\b/i;
const LETTER_REF = /\b(option|alternativa|letra|choice)\s+[A-E]\b/i;
const PT_HINT = /\b(que|não|uma|para|com|pela|pelo|está)\b|ção\b/i;
const SCREEN_TYPES = new Set(['card', 'predict', 'mcq', 'match', 'order', 'cloze', 'flip', 'sim']);

function readJSON(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    err(file.replace(ROOT + '/', ''), `JSON inválido: ${e.message}`);
    return null;
  }
}

const words = (s) => String(s || '')
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, k, l) => l || k)
  .replace(/[*_]/g, '')
  .split(/\s+/)
  .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function termsIn(text) {
  const out = [];
  String(text || '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, k) => out.push(k.toLowerCase().trim()));
  return out;
}

function allStrings(obj, acc = []) {
  if (typeof obj === 'string') acc.push(obj);
  else if (Array.isArray(obj)) obj.forEach((x) => allStrings(x, acc));
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((x) => allStrings(x, acc));
  return acc;
}

const catalog = readJSON(join(CONTENT, 'catalog.json'));
readJSON(join(CONTENT, 'labs.json'));
const subjects = new Set((catalog?.subjects || []).map((s) => s.id));

const moduleFiles = readdirSync(join(CONTENT, 'modules')).filter((f) => f.endsWith('.json'));
if (!moduleFiles.length) err('content/modules', 'nenhum módulo encontrado');

const stats = [];
const seenModuleIds = new Set();

for (const file of moduleFiles) {
  const where = `modules/${file}`;
  const m = readJSON(join(CONTENT, 'modules', file));
  if (!m) continue;
  if (m.schema !== 1) err(where, 'schema deve ser 1');
  for (const k of ['id', 'subject', 'title', 'units', 'concepts', 'rules', 'questions', 'path']) if (m[k] == null) err(where, `campo obrigatório ausente: ${k}`);
  if (seenModuleIds.has(m.id)) err(where, `id de módulo repetido: ${m.id}`);
  seenModuleIds.add(m.id);
  if (!subjects.has(m.subject)) err(where, `matéria "${m.subject}" não existe em catalog.json`);

  const uniq = (list, label) => {
    const s = new Set();
    for (const x of list) {
      if (!x.id) err(where, `${label} sem id`);
      else if (s.has(x.id)) err(where, `${label} com id repetido: ${x.id}`);
      s.add(x.id);
    }
    return s;
  };
  const unitIds = uniq(m.units || [], 'unidade');
  const conceptIds = uniq(m.concepts || [], 'conceito');
  const ruleIds = uniq(m.rules || [], 'regra');
  const qIds = uniq(m.questions || [], 'questão');
  const allScreens = (m.units || []).flatMap((u) => u.screens || []);
  const screenIds = uniq(allScreens, 'tela');
  for (const id of screenIds) if (qIds.has(id)) err(where, `id usado por tela e questão: ${id}`);
  const cardIds = new Set(allScreens.filter((s) => s.type === 'card').map((s) => s.id));
  const ready = new Set((m.units || []).filter((u) => u.status === 'ready').map((u) => u.id));
  const conceptUnit = new Map((m.concepts || []).map((c) => [c.id, c.unit]));
  const glossary = new Set();
  for (const g of m.glossary || []) {
    if (!g.en || !g.pt) err(where, `glossário: termo sem en/pt (${g.id})`);
    for (const k of [g.id, g.en, g.pt, ...(g.aliases || [])]) if (k) glossary.add(String(k).toLowerCase().trim());
  }
  const isReadyConcept = (cid) => ready.has(conceptUnit.get(cid));

  // termos do glossário usados em qualquer texto
  for (const s of allStrings({ u: m.units, q: m.questions, r: m.rules, c: m.concepts, p: m.pathways })) {
    for (const t of termsIn(s)) if (!glossary.has(t)) err(where, `termo do glossário não encontrado: [[${t}]]`);
  }

  // conceitos
  for (const c of m.concepts || []) {
    if (!unitIds.has(c.unit)) err(where, `conceito ${c.id}: unidade inexistente ${c.unit}`);
    if (!c.name) err(where, `conceito ${c.id}: sem nome`);
    if (!ruleIds.has(c.rule)) err(where, `conceito ${c.id}: regra inexistente ${c.rule}`);
    for (const r of c.rules || []) if (!ruleIds.has(r)) err(where, `conceito ${c.id}: regra inexistente ${r}`);
    if (ready.has(c.unit) && !(c.anki && c.anki.length)) err(where, `conceito ${c.id}: sem cartões para o Anki`);
  }
  for (const r of m.rules || []) {
    if (!unitIds.has(r.unit)) err(where, `regra ${r.id}: unidade inexistente ${r.unit}`);
    if (!r.text) err(where, `regra ${r.id}: sem texto`);
  }

  // questões NBME
  const perConcept = new Map();
  for (const q of m.questions || []) {
    const w = `${where} › ${q.id}`;
    if (!q.stem || !q.question) err(w, 'sem enunciado (stem) ou pergunta final');
    if (!Array.isArray(q.options) || q.options.length !== 5) err(w, `precisa de 5 alternativas (tem ${q.options?.length ?? 0})`);
    const correct = (q.options || []).filter((o) => o.correct);
    if (correct.length !== 1) err(w, `precisa de exatamente 1 alternativa correta (tem ${correct.length})`);
    const texts = new Set();
    (q.options || []).forEach((o, i) => {
      if (!o.text) err(w, `alternativa ${i + 1} sem texto`);
      if (texts.has(o.text)) err(w, `alternativa repetida: ${o.text}`);
      texts.add(o.text);
      if (!o.why) err(w, `alternativa "${o.text}" sem comentário (why)`);
      if (!o.correct && !o.wouldBe) err(w, `alternativa errada "${o.text}" sem "Seria a resposta se" (wouldBe)`);
      if (BANNED.test(o.text)) err(w, `alternativa proibida: ${o.text}`);
      if (LETTER_REF.test(o.why || '') || LETTER_REF.test(o.wouldBe || '')) warn(w, 'comentário cita letra de alternativa — as letras mudam ao embaralhar');
    });
    if (BANNED.test(q.question || '')) err(w, 'pergunta com EXCEPT/all of the above');
    if (!(q.level >= 1 && q.level <= 4)) err(w, `nível inválido: ${q.level}`);
    if (!q.concepts || !q.concepts.length) err(w, 'sem conceito');
    for (const c of q.concepts || []) if (!conceptIds.has(c)) err(w, `conceito inexistente: ${c}`);
    if (!ruleIds.has(q.rule)) err(w, `regra lógica inexistente: ${q.rule}`);
    if (!q.tested) err(w, `sem linha "How it's tested"`);
    else if (PT_HINT.test(q.tested)) warn(w, `"How it's tested" parece estar em português`);
    const primary = (q.concepts || [])[0];
    if (q.card) {
      if (!cardIds.has(q.card)) err(w, `cartão da lição inexistente: ${q.card}`);
    } else if (primary && isReadyConcept(primary)) err(w, 'sem link para o cartão da lição (card)');
    else warn(w, 'sem cartão da lição (unidade ainda em construção)');
    if (q.verify) verify.push(`${w}: ${q.verify}`);
    for (const c of q.concepts || []) {
      if (!perConcept.has(c)) perConcept.set(c, []);
      perConcept.get(c).push(q);
    }
  }

  // variantes por conceito (unidades prontas)
  for (const c of m.concepts || []) {
    if (!ready.has(c.unit)) continue;
    const list = perConcept.get(c.id) || [];
    if (list.length < MIN_VARIANTS) err(where, `conceito ${c.id}: ${list.length} variantes (mínimo ${MIN_VARIANTS})`);
    if (!list.some((q) => q.level >= 3)) err(where, `conceito ${c.id}: nenhuma questão de nível 3 ou 4`);
  }

  // unidades
  for (const u of m.units || []) {
    const w = `${where} › ${u.id}`;
    if (!u.title) err(w, 'sem título');
    for (const c of u.concepts || []) if (conceptUnit.get(c) !== u.id) err(w, `conceito ${c} não pertence a esta unidade`);
    if (u.status !== 'ready') {
      if (u.status !== 'draft') err(w, `status deve ser "ready" ou "draft"`);
      continue;
    }
    if (!(u.screens || []).length) err(w, 'unidade pronta sem telas');
    if (!(u.objectives || []).length) warn(w, 'sem objetivos');
    // regra: nunca mais de 2 cartões seguidos sem responder algo (a tela de introdução conta como cartão)
    let run = 1;
    let runStart = 'introdução';
    for (const s of u.screens || []) {
      const ws = `${w} › ${s.id}`;
      if (!SCREEN_TYPES.has(s.type)) err(ws, `tipo de tela desconhecido: ${s.type}`);
      const passive = s.type === 'card' || (s.type === 'sim' && (s.mode || 'explore') === 'explore');
      if (passive) {
        if (run === 0) runStart = s.id;
        run++;
        if (run > MAX_CARDS_IN_A_ROW) err(ws, `mais de ${MAX_CARDS_IN_A_ROW} cartões seguidos sem interação (desde ${runStart})`);
      } else run = 0;
      if (s.type !== 'card' && !(s.concepts || []).length) err(ws, 'sem conceito');
      for (const c of s.concepts || []) if (!conceptIds.has(c)) err(ws, `conceito inexistente: ${c}`);
      if (s.rule && !ruleIds.has(s.rule)) err(ws, `regra inexistente: ${s.rule}`);
      if (s.verify) verify.push(`${ws}: ${s.verify}`);
      const graded = ['predict', 'mcq', 'match', 'order', 'cloze'].includes(s.type) || (s.type === 'sim' && s.mode !== 'explore');
      if (graded && !s.tested) err(ws, `interação sem "How it's tested"`);
      if (graded && !(s.level >= 1 && s.level <= 4)) err(ws, 'interação sem nível (1–4)');
      switch (s.type) {
        case 'card': {
          const n = words(s.body);
          if (!s.body) err(ws, 'cartão sem texto');
          if (n > CARD_WORDS_MAX) err(ws, `cartão com ${n} palavras (máximo ~${CARD_WORDS_WARN})`);
          else if (n > CARD_WORDS_WARN) warn(ws, `cartão com ${n} palavras (alvo ≤ ${CARD_WORDS_WARN})`);
          if (s.pathway && !(m.pathways || {})[s.pathway]) err(ws, `via inexistente: ${s.pathway}`);
          break;
        }
        case 'predict':
        case 'mcq': {
          const ok = (s.options || []).filter((o) => o.correct).length;
          if ((s.options || []).length < 2) err(ws, 'precisa de alternativas');
          if (ok !== 1) err(ws, `precisa de exatamente 1 alternativa correta (tem ${ok})`);
          if (!s.reveal) err(ws, 'sem explicação (reveal)');
          if (s.type === 'mcq' && s.stem && PT_HINT.test(s.stem)) warn(ws, 'mini-vinheta parece estar em português (questões ficam em inglês)');
          break;
        }
        case 'match':
          if (!(s.rows || []).length || s.rows.length < 2) err(ws, 'associar precisa de ≥2 linhas');
          if (new Set((s.rows || []).map((r) => r.length)).size > 1) err(ws, 'linhas com número diferente de colunas');
          if (!s.explanation) err(ws, 'sem explicação');
          break;
        case 'order':
          if (!(s.items || []).length || s.items.length < 3) err(ws, 'ordenar precisa de ≥3 itens');
          if (!s.explanation) err(ws, 'sem explicação');
          break;
        case 'cloze':
          if (!/\{\{[^}]+\}\}/.test(s.text || '')) err(ws, 'lacuna sem {{resposta}}');
          if (!s.explanation) err(ws, 'sem explicação');
          break;
        case 'flip':
          if (!s.front) err(ws, 'cartão de virar sem frente');
          if (!s.back && !s.rule) err(ws, 'cartão de virar sem verso nem regra');
          break;
        case 'sim': {
          const pw = (m.pathways || {})[s.pathway];
          if (!pw) {
            err(ws, `via inexistente: ${s.pathway}`);
            break;
          }
          const blockable = new Set(pw.edges.filter((e) => e.blockable).map((e) => e.id));
          if (s.mode === 'predict') {
            if (!blockable.has(s.block)) err(ws, `etapa a bloquear inexistente: ${s.block}`);
            if ((s.options || []).filter((o) => o.correct).length !== 1) err(ws, 'precisa de exatamente 1 alternativa correta');
          }
          if (s.mode === 'challenge') {
            if (!blockable.has(s.answer)) err(ws, `resposta inexistente: ${s.answer}`);
            if (!s.explanation) err(ws, 'sem explicação');
          }
          break;
        }
      }
    }
    // mini-teste: há questões suficientes por nível?
    const levels = (u.miniTest && u.miniTest.levels) || [1, 2, 2, 3, 3, 4, 4];
    if (levels.length < 5 || levels.length > 8) err(w, `mini-teste deve ter 5 a 8 questões (tem ${levels.length})`);
    const pool = (m.questions || []).filter((q) => q.concepts.some((c) => (u.concepts || []).includes(c)) && !(m.pretest || []).includes(q.id));
    const need = {};
    levels.forEach((l) => (need[l] = (need[l] || 0) + 1));
    for (const [l, n] of Object.entries(need)) {
      const have = pool.filter((q) => q.level === Number(l)).length;
      if (have < n) err(w, `mini-teste pede ${n} questão(ões) de nível ${l}, há ${have}`);
      else if (have < n * 2) warn(w, `nível ${l}: ${have} questões — pouco para refazer o mini-teste com questões novas (ideal ≥ ${n * 2})`);
    }
    stats.push(`${m.id}/${u.id}: ${(u.screens || []).length} telas, ${pool.length} questões no banco da unidade`);
  }

  // vias do simulador
  for (const [k, pw] of Object.entries(m.pathways || {})) {
    const w = `${where} › via ${k}`;
    const nodes = new Set();
    for (const n of pw.nodes || []) {
      if (nodes.has(n.id)) err(w, `nó repetido ${n.id}`);
      nodes.add(n.id);
      if (!(n.col >= 0) || !(n.row >= 0)) err(w, `nó ${n.id} sem posição (col/row)`);
    }
    const occupied = new Set();
    for (const n of pw.nodes || []) {
      const key = `${n.col},${n.row}`;
      if (occupied.has(key)) err(w, `dois nós na mesma posição ${key}`);
      occupied.add(key);
    }
    for (const e of pw.edges || []) {
      if (!nodes.has(e.from) || !nodes.has(e.to)) err(w, `aresta ${e.id || e.from + '→' + e.to} liga nó inexistente`);
      if (e.blockable) {
        if (!e.id || !e.enzyme) err(w, 'etapa bloqueável precisa de id e enzyme');
        const b = (pw.blocks || {})[e.id];
        if (!b) err(w, `etapa ${e.id} sem efeitos configurados em blocks`);
        else {
          if (!b.clinical) warn(w, `etapa ${e.id} sem quadro clínico`);
          if (b.rule && !ruleIds.has(b.rule)) err(w, `etapa ${e.id}: regra inexistente ${b.rule}`);
          for (const id of [...(b.accumulates || []), ...(b.lacks || [])]) if (!nodes.has(id)) err(w, `etapa ${e.id}: nó inexistente ${id}`);
        }
      }
    }
  }

  // pré-teste e caminho
  const pre = m.pretest || [];
  if (pre.length < 8 || pre.length > 10) err(where, `pré-teste deve ter 8 a 10 questões (tem ${pre.length})`);
  for (const id of pre) if (!qIds.has(id)) err(where, `pré-teste: questão inexistente ${id}`);
  const preUnits = new Set(pre.map((id) => conceptUnit.get((m.questions.find((q) => q.id === id) || {}).concepts?.[0])));
  if (preUnits.size < Math.min(6, (m.units || []).length)) warn(where, `pré-teste cobre só ${preUnits.size} unidades`);
  for (const p of m.path || []) {
    if (p.type === 'unit' && !unitIds.has(p.unit)) err(where, `caminho: unidade inexistente ${p.unit}`);
    if (p.type === 'checkpoint') {
      for (const uid of p.units || []) if (!unitIds.has(uid)) err(where, `checkpoint ${p.id}: unidade inexistente ${uid}`);
      if (!(p.size >= 8 && p.size <= 10)) err(where, `checkpoint ${p.id}: deve ter 8 a 10 vinhetas`);
    }
    if (p.type === 'final' && !(p.size >= 25 && p.size <= 30)) err(where, 'prova final deve ter 25 a 30 vinhetas');
  }
  const nUnits = (m.units || []).length;
  if (nUnits < 6 || nUnits > 9) warn(where, `módulo com ${nUnits} unidades (alvo: 6 a 9)`);
  stats.push(`${m.id}: ${m.questions.length} questões, ${(m.concepts || []).length} conceitos, ${(m.rules || []).length} regras, ${ready.size}/${nUnits} unidades prontas`);
}

console.log('— Validação do conteúdo —');
stats.forEach((s) => console.log('  ' + s));
if (verify.length) {
  console.log(`\nItens marcados como "verificar" (${verify.length}):`);
  verify.forEach((v) => console.log('  • ' + v));
}
if (warnings.length) {
  console.log(`\nAvisos (${warnings.length}):`);
  warnings.forEach((v) => console.log('  ! ' + v));
}
if (errors.length) {
  console.log(`\nERROS (${errors.length}):`);
  errors.forEach((v) => console.log('  ✗ ' + v));
  process.exit(1);
}
console.log('\n✓ Conteúdo válido.');
