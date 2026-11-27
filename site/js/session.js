// Lógica das sessões: montagem (pré-teste, unidade, mini-teste, checkpoints, prova final,
// teste rápido, revisão espaçada, caderno de erros), registro das respostas, repetição com
// variantes novas, portão de domínio e remediação. Sem nenhuma renderização aqui.
import { S, save, modState } from './store.js';
import { mastery, record, noteError, clearError, markSeen, isDue } from './mastery.js';
import { cardForConcept } from './content.js';
import { shuffle } from './ui.js';

export const GATE_MIN = 0.8;
export const CHECKPOINT_MIN = 0.8;
export const FINAL_MIN = 0.85;
const LEARN_ROLES = new Set(['lesson', 'repeat']);

// ---------- acesso ----------
export function getSession(key) {
  return S().sessions[key] || null;
}

function put(sess) {
  sess.updated = Date.now();
  S().sessions[sess.key] = sess;
  S().last = sess.key;
  save();
  return sess;
}

export function dropSession(key) {
  delete S().sessions[key];
  if (S().last === key) S().last = null;
  save();
}

// ---------- itens ----------
export function itemOf(m, step) {
  if (step.t === 'q') {
    const q = m.q.get(step.id);
    return q ? { ...q, kind: 'nbme' } : null;
  }
  if (step.t === 'screen') {
    const ref = m.screens.get(step.id);
    return ref ? ref.screen : null;
  }
  return null;
}

export function isGraded(step, item) {
  if (!item) return false;
  if (step.t === 'q') return true;
  return ['predict', 'mcq', 'match', 'order', 'cloze'].includes(item.type) || (item.type === 'sim' && item.mode !== 'explore');
}

// ---------- seleção de questões ----------
export function idsInSession(sess) {
  return new Set(sess.steps.filter((s) => s.t === 'q').map((s) => s.id));
}

export function pickQuestion(m, { concepts, level = 2, minLevel = 1, maxLevel = 4, exclude = new Set(), allowReuse = true }) {
  const seen = S().seen;
  const pool = (lo, hi) => m.questions.filter((q) => !exclude.has(q.id) && q.level >= lo && q.level <= hi && q.concepts.some((c) => concepts.includes(c)));
  let cands = pool(minLevel, maxLevel);
  if (!cands.length) cands = pool(1, 4);
  if (!cands.length) return null;
  const rnd = new Map(cands.map((q) => [q.id, Math.random()]));
  cands.sort((a, b) => {
    const sa = seen[a.id] ? 1 : 0;
    const sb = seen[b.id] ? 1 : 0;
    if (sa !== sb) return sa - sb;
    if (sa && sb && seen[a.id] !== seen[b.id]) return seen[a.id] - seen[b.id];
    const da = Math.abs(a.level - level);
    const db = Math.abs(b.level - level);
    if (da !== db) return da - db;
    return rnd.get(a.id) - rnd.get(b.id);
  });
  const best = cands[0];
  if (seen[best.id] && !allowReuse) return null;
  return { id: best.id, level: best.level, reused: !!seen[best.id] };
}

const byWeakest = (cids) =>
  cids.slice().sort((a, b) => {
    const ma = mastery(a);
    const mb = mastery(b);
    if (ma.misconception !== mb.misconception) return ma.misconception ? -1 : 1;
    return ma.score - mb.score;
  });

function unitIndex(m, uid) {
  return m.units.findIndex((u) => u.id === uid);
}

export function passedUnits(m) {
  const ms = modState(m.id);
  return m.units.filter((u) => ms.units[u.id] && ms.units[u.id].passed).map((u) => u.id);
}

export function conceptsOfUnits(m, uids) {
  return m.concepts.filter((c) => uids.includes(c.unit)).map((c) => c.id);
}

// Conceitos já "liberados": unidades aprovadas + unidade em andamento já tentada.
export function unlockedConcepts(m) {
  const ms = modState(m.id);
  const uids = m.units.filter((u) => ms.units[u.id] && (ms.units[u.id].passed || ms.units[u.id].started)).map((u) => u.id);
  return conceptsOfUnits(m, uids).filter((cid) => mastery(cid).n > 0 || passedUnits(m).includes(m.c.get(cid).unit));
}

// ---------- construtores ----------
function base(m, key, kind, extra = {}) {
  return { key, kind, module: m.id, steps: [], idx: 0, res: {}, ord: {}, attempt: 1, created: Date.now(), done: false, meta: {}, ...extra };
}

export function buildPretest(m) {
  const sess = base(m, `${m.id}:pretest`, 'pretest');
  sess.steps.push({ t: 'intro', id: 'pretest' });
  for (const id of m.pretest || []) sess.steps.push({ t: 'q', id, role: 'pre' });
  sess.steps.push({ t: 'summary' });
  return put(sess);
}

export function buildUnit(m, uid) {
  const u = m.u.get(uid);
  const sess = base(m, `${m.id}:${uid}`, 'unit', { unit: uid });
  sess.steps.push({ t: 'intro', id: 'unit' });
  for (const s of u.screens) sess.steps.push({ t: 'screen', id: s.id, role: s.role === 'hook' ? 'hook' : 'lesson' });
  sess.steps.push({ t: 'mt', attempt: 1 });
  const ms = modState(m.id);
  ms.units[uid] = Object.assign(ms.units[uid] || {}, { started: Date.now() });
  return put(sess);
}

export function buildUnitReview(m, uid) {
  const u = m.u.get(uid);
  const sess = base(m, `${m.id}:${uid}:revisao`, 'unit-review', { unit: uid });
  sess.steps.push({ t: 'intro', id: 'unit-review' });
  for (const s of u.screens) sess.steps.push({ t: 'screen', id: s.id, role: 'lesson' });
  sess.steps.push({ t: 'summary' });
  return put(sess);
}

export function buildMiniTest(m, sess, attempt) {
  const u = m.u.get(sess.unit);
  const cfg = u.miniTest || {};
  const levels = cfg.levels || [1, 2, 2, 3, 3, 4, 4];
  const exclude = idsInSession(sess);
  const concepts = byWeakest(u.concepts);
  const items = [];
  levels.forEach((lv, i) => {
    const rot = concepts.slice(i % concepts.length).concat(concepts.slice(0, i % concepts.length));
    let pick = null;
    for (const c of rot) {
      const p = pickQuestion(m, { concepts: [c], level: lv, minLevel: lv, maxLevel: lv, exclude, allowReuse: false });
      if (p && p.level === lv) {
        pick = p;
        break;
      }
    }
    if (!pick) pick = pickQuestion(m, { concepts: u.concepts, level: lv, minLevel: Math.max(1, lv - 1), maxLevel: Math.min(4, lv + 1), exclude });
    if (pick) {
      exclude.add(pick.id);
      items.push({ t: 'q', id: pick.id, role: 'mt', attempt, lv: pick.level, reused: pick.reused });
    }
  });
  // 1–2 questões de unidades anteriores (intercalação)
  const prevUnits = m.units.slice(0, unitIndex(m, u.id)).map((x) => x.id).filter((id) => passedUnits(m).includes(id));
  const prevN = prevUnits.length ? cfg.previous ?? 1 : 0;
  const prevConcepts = byWeakest(conceptsOfUnits(m, prevUnits));
  for (let i = 0; i < prevN && i < prevConcepts.length; i++) {
    const p = pickQuestion(m, { concepts: [prevConcepts[i]], level: 2 + (i % 2), minLevel: 2, maxLevel: 3, exclude });
    if (p) {
      exclude.add(p.id);
      items.push({ t: 'q', id: p.id, role: 'mt', attempt, lv: p.level, prev: true, reused: p.reused });
    }
  }
  // Do nível 1 ao 4; as duas últimas são as mais difíceis da própria unidade.
  items.sort((a, b) => a.lv - b.lv || (a.prev ? -1 : 0) - (b.prev ? -1 : 0));
  return [{ t: 'intro', id: 'mt', attempt }, ...items, { t: 'gate', attempt }];
}

function stepsOf(sess, pred) {
  return sess.steps.map((s, i) => ({ s, i, r: sess.res[i] })).filter((x) => pred(x.s));
}

export function evalGate(m, sess, attempt) {
  const list = stepsOf(sess, (s) => s.t === 'q' && s.role === 'mt' && s.attempt === attempt);
  const total = list.length;
  const correct = list.filter((x) => x.r && x.r.correct).length;
  const score = total ? correct / total : 0;
  const last2 = list.slice(-2);
  const last2ok = last2.length === 2 && last2.every((x) => x.r && x.r.correct && x.r.conf === 'certeza');
  const weak = new Map(); // conceito → cartão
  list.forEach((x, k) => {
    const q = m.q.get(x.s.id);
    const bad = !x.r || !x.r.correct || x.r.conf === 'chute' || (k >= total - 2 && x.r.conf !== 'certeza');
    if (bad && q) for (const c of q.concepts) if (!weak.has(c)) weak.set(c, q.card);
  });
  return { total, correct, score, last2ok, pass: score >= GATE_MIN && last2ok, weak };
}

export function remediationSteps(m, sess, weak, { variants = 2 } = {}) {
  const exclude = idsInSession(sess);
  const steps = [];
  const list = [...weak.entries()].slice(0, 5);
  for (const [cid, card] of list) {
    steps.push({ t: 'remed', cid });
    const cardId = card || cardForConcept(m, cid);
    if (cardId) steps.push({ t: 'cardref', id: cardId });
    for (let k = 0; k < variants; k++) {
      const p = pickQuestion(m, { concepts: [cid], level: k === 0 ? 2 : 3, minLevel: 1, maxLevel: 4, exclude });
      if (p) {
        exclude.add(p.id);
        steps.push({ t: 'q', id: p.id, role: 'remed', cid, reused: p.reused });
      }
    }
  }
  return steps;
}

function pickExamSet(m, groups, levels) {
  // groups: [{concepts, n}] — escolhe questões variadas, priorizando conceitos fracos e não vistas
  const exclude = new Set();
  const out = [];
  let li = 0;
  for (const g of groups) {
    const order = byWeakest(g.concepts);
    for (let i = 0; i < g.n && order.length; i++) {
      const c = order[i % order.length];
      const lv = levels[li++ % levels.length];
      const p = pickQuestion(m, { concepts: [c], level: lv, minLevel: Math.max(2, lv - 1), maxLevel: 4, exclude });
      if (p) {
        exclude.add(p.id);
        out.push({ t: 'q', id: p.id, role: 'exam', reused: p.reused });
      }
    }
  }
  return shuffle(out);
}

export function buildCheckpoint(m, item) {
  const sess = base(m, `${m.id}:${item.key}`, 'checkpoint', { pathKey: item.key });
  const all = conceptsOfUnits(m, item.units);
  const focus = conceptsOfUnits(m, item.focus || item.units);
  const rest = all.filter((c) => !focus.includes(c));
  const n = item.size || 10;
  const nFocus = rest.length ? Math.round(n * 0.6) : n;
  sess.steps.push({ t: 'intro', id: 'exam' });
  sess.steps.push(...pickExamSet(m, [{ concepts: focus, n: nFocus }, { concepts: rest, n: n - nFocus }], [3, 3, 4, 2, 3, 4]));
  sess.steps.push({ t: 'review' });
  return put(sess);
}

export function buildFinal(m, item, timed) {
  const prev = getSession(`${m.id}:${item.key}`);
  const attempt = prev ? (prev.attempt || 1) + (prev.done ? 1 : 0) : 1;
  const sess = base(m, `${m.id}:${item.key}`, 'final', { pathKey: item.key, attempt });
  const n = item.size || 30;
  const units = m.units.map((u) => u.id);
  const per = Math.floor(n / units.length);
  let extra = n - per * units.length;
  const groups = units.map((uid) => ({ concepts: conceptsOfUnits(m, [uid]), n: per + (extra-- > 0 ? 1 : 0) }));
  const n2 = Math.round(n * 0.2);
  const n3 = Math.round(n * 0.4);
  const levels = shuffle([...Array(n2).fill(2), ...Array(n3).fill(3), ...Array(Math.max(0, n - n2 - n3)).fill(4)]);
  sess.steps.push({ t: 'intro', id: 'final' });
  sess.steps.push(...pickExamSet(m, groups, levels));
  sess.steps.push({ t: 'review' });
  if (timed) sess.timer = { start: null, limit: (sess.steps.length - 2) * (item.secondsPerQuestion || 90) };
  return put(sess);
}

export function buildQuick(m) {
  const cids = unlockedConcepts(m);
  if (!cids.length) return null;
  const sess = base(m, `${m.id}:quick`, 'quick');
  const order = byWeakest(cids);
  const exclude = new Set();
  for (let i = 0; i < 10; i++) {
    const c = order[i % order.length];
    const p = pickQuestion(m, { concepts: [c], level: 2 + (i % 3), minLevel: 1, maxLevel: 4, exclude });
    if (p) {
      exclude.add(p.id);
      sess.steps.push({ t: 'q', id: p.id, role: 'quick', reused: p.reused });
    }
  }
  sess.steps.push({ t: 'summary' });
  return put(sess);
}

export function dueConcepts(m) {
  return m.concepts.map((c) => c.id).filter((cid) => isDue(cid));
}

export function buildReview(m) {
  const due = byWeakest(dueConcepts(m)).slice(0, 10);
  if (!due.length) return null;
  const sess = base(m, `${m.id}:review`, 'review');
  const exclude = new Set();
  for (const c of due) {
    const p = pickQuestion(m, { concepts: [c], level: 3, minLevel: 2, maxLevel: 4, exclude });
    if (p) {
      exclude.add(p.id);
      sess.steps.push({ t: 'q', id: p.id, role: 'review', reused: p.reused });
    }
  }
  sess.steps.push({ t: 'summary' });
  return put(sess);
}

export function errorEntries(m) {
  return Object.entries(S().errors)
    .filter(([, e]) => e.module === m.id)
    .sort((a, b) => a[1].t - b[1].t);
}

export function buildErrors(m) {
  const entries = errorEntries(m).slice(0, 10);
  if (!entries.length) return null;
  const sess = base(m, `${m.id}:errors`, 'errors');
  const exclude = new Set(entries.map(([id]) => id));
  for (const [id, e] of entries) {
    let p = pickQuestion(m, { concepts: e.concepts || [], level: e.level || 2, exclude, allowReuse: false });
    if (!p && m.q.has(id)) p = { id, reused: true };
    if (!p) p = pickQuestion(m, { concepts: e.concepts || [], level: 2, exclude: new Set() });
    if (p) {
      exclude.add(p.id);
      sess.steps.push({ t: 'q', id: p.id, role: 'errors', origin: id, reused: p.reused });
    }
  }
  sess.steps.push({ t: 'summary' });
  return put(sess);
}

// ---------- respostas ----------
export function answer(m, sess, result) {
  const idx = sess.idx;
  const step = sess.steps[idx];
  const item = itemOf(m, step);
  sess.res[idx] = { ...result, t: Date.now() };
  if (!item) return put(sess);
  if (step.t === 'q') markSeen(step.id);
  const role = step.role || 'lesson';
  const level = item.level || 1;
  const itemId = step.id;
  const concepts = item.concepts || [];
  const isHook = item.role === 'hook' || role === 'hook';
  const ctx = isHook ? 'hook' : item.type === 'flip' ? 'flip' : role;
  if (item.type !== 'card' && !(item.type === 'sim' && item.mode === 'explore')) {
    record(concepts, { item: itemId, correct: result.correct, conf: result.conf || null, level, ctx });
  }
  const graded = isGraded(step, item);
  const bad = !result.correct || result.conf === 'chute';
  // Caderno de erros
  if (graded && !isHook && role !== 'pre') {
    if (bad) noteError(itemId, { module: m.id, concepts, conf: result.conf || null, correct: !!result.correct, level, kind: step.t });
  }
  if (role === 'errors' && result.correct && result.conf === 'certeza') {
    clearError(step.origin);
    clearError(itemId);
  }
  // Repetição: conceito errado volta algumas telas depois, com questão NOVA
  if (graded && bad && concepts.length && (LEARN_ROLES.has(role) || isHook)) {
    const p = pickQuestion(m, { concepts: [concepts[0]], level: Math.min(level, 2), minLevel: 1, maxLevel: 3, exclude: idsInSession(sess), allowReuse: false });
    if (p) {
      const limit = sess.steps.findIndex((s, i) => i > idx && (s.t === 'mt' || s.t === 'summary'));
      const at = Math.min(idx + 4, limit === -1 ? sess.steps.length : limit);
      sess.steps.splice(at, 0, { t: 'q', id: p.id, role: 'repeat' });
    }
  }
  if (role === 'remed' && bad && step.cid) {
    const count = sess.steps.filter((s) => s.role === 'remed' && s.cid === step.cid).length;
    if (count < 4) {
      const p = pickQuestion(m, { concepts: [step.cid], level: 2, exclude: idsInSession(sess), allowReuse: false });
      if (p) sess.steps.splice(idx + 1, 0, { t: 'q', id: p.id, role: 'remed', cid: step.cid });
    }
  }
  // Flip esquecido volta uma vez, mais adiante
  if (item.type === 'flip' && !result.correct && !step.again) {
    const limit = sess.steps.findIndex((s, i) => i > idx && (s.t === 'mt' || s.t === 'summary'));
    const at = Math.min(idx + 4, limit === -1 ? sess.steps.length : limit);
    sess.steps.splice(at, 0, { t: 'screen', id: step.id, role: 'lesson', again: true });
  }
  return put(sess);
}

// Avança e expande marcadores. Retorna a sessão.
export function advance(m, sess) {
  sess.idx = Math.min(sess.idx + 1, sess.steps.length - 1);
  const step = sess.steps[sess.idx];
  if (step && step.t === 'mt') {
    const steps = buildMiniTest(m, sess, step.attempt);
    sess.steps.splice(sess.idx, 1, ...steps);
    sess.attempt = step.attempt;
  }
  return put(sess);
}

export function goTo(sess, idx) {
  sess.idx = idx;
  return put(sess);
}

// Portão: chamado quando o usuário toca "Continuar" na tela do portão.
export function resolveGate(m, sess, gate) {
  const ms = modState(m.id);
  const u = ms.units[sess.unit] || (ms.units[sess.unit] = {});
  u.attempts = (u.attempts || 0) + 1;
  u.last = { score: gate.score, last2ok: gate.last2ok, at: Date.now() };
  if (gate.pass) {
    u.passed = true;
    u.passedAt = Date.now();
    u.score = gate.score;
    sess.done = true;
    put(sess);
    return 'passed';
  }
  const attempt = (sess.attempt || 1) + 1;
  const steps = [...remediationSteps(m, sess, gate.weak), { t: 'mt', attempt }];
  sess.steps.splice(sess.idx + 1, sess.steps.length, ...steps);
  put(sess);
  return 'remediate';
}

export function evalExam(m, sess) {
  const list = stepsOf(sess, (s) => s.t === 'q' && s.role === 'exam');
  const total = list.length;
  const correct = list.filter((x) => x.r && x.r.correct).length;
  const weakCount = new Map();
  const byConcept = {};
  for (const x of list) {
    const q = m.q.get(x.s.id);
    if (!q) continue;
    const ok = !!(x.r && x.r.correct);
    for (const c of q.concepts) {
      byConcept[c] = byConcept[c] || { ok: 0, n: 0 };
      byConcept[c].n++;
      if (ok) byConcept[c].ok++;
    }
    if (!ok || (x.r && x.r.conf === 'chute')) for (const c of q.concepts) weakCount.set(c, [(weakCount.get(c) || [0])[0] + 1, q.card]);
  }
  const weak = new Map([...weakCount.entries()].sort((a, b) => b[1][0] - a[1][0]).map(([c, v]) => [c, v[1]]));
  return { total, correct, score: total ? correct / total : 0, weak, byConcept };
}

// Fim da prova (checkpoint/final): grava resultado e acrescenta remediação se preciso.
export function resolveExam(m, sess, exam) {
  const ms = modState(m.id);
  const min = sess.kind === 'final' ? FINAL_MIN : CHECKPOINT_MIN;
  const rec = ms.path[sess.pathKey] || (ms.path[sess.pathKey] = { attempts: 0 });
  if (sess.meta.resolved) return rec;
  sess.meta.resolved = true;
  rec.attempts++;
  rec.last = exam.score;
  rec.best = Math.max(rec.best || 0, exam.score);
  rec.at = Date.now();
  const passed = exam.score >= min;
  if (sess.kind === 'final') {
    rec.byConcept = exam.byConcept;
    if (passed) rec.passed = true;
  }
  const steps = [];
  if (!passed) steps.push(...remediationSteps(m, sess, exam.weak));
  steps.push({ t: 'exam-done', passed });
  sess.steps.splice(sess.idx + 1, sess.steps.length, ...steps);
  put(sess);
  return rec;
}

export function finishExam(m, sess, passed) {
  const ms = modState(m.id);
  const rec = ms.path[sess.pathKey] || (ms.path[sess.pathKey] = { attempts: 1 });
  if (sess.kind === 'checkpoint') rec.done = true; // checkpoint libera após a remediação
  if (sess.kind === 'final' && passed) rec.passed = true;
  sess.done = true;
  put(sess);
}

export function finishPretest(m, sess) {
  const ms = modState(m.id);
  const byConcept = {};
  const answers = {};
  sess.steps.forEach((s, i) => {
    if (s.t !== 'q') return;
    const r = sess.res[i];
    const q = m.q.get(s.id);
    answers[s.id] = r ? { correct: !!r.correct, conf: r.conf } : null;
    if (q) for (const c of q.concepts) byConcept[c] = !!(r && r.correct);
  });
  ms.pretest = { done: true, at: Date.now(), answers, byConcept };
  sess.done = true;
  put(sess);
}

export function finishSimple(sess) {
  sess.done = true;
  put(sess);
}

// ---------- estado do caminho ----------
export function pathStatus(m) {
  const ms = modState(m.id);
  let prevDone = true;
  return m.pathItems.map((p) => {
    let status;
    let ready = true;
    let done = false;
    if (p.type === 'pretest') {
      done = !!(ms.pretest && ms.pretest.done);
      ready = (m.pretest || []).length > 0;
    } else if (p.type === 'unit') {
      const u = m.u.get(p.unit);
      ready = !!u && u.status === 'ready';
      done = !!(ms.units[p.unit] && ms.units[p.unit].passed);
    } else if (p.type === 'checkpoint') {
      ready = p.units.every((uid) => m.u.get(uid) && m.u.get(uid).status === 'ready');
      done = !!(ms.path[p.key] && ms.path[p.key].done);
    } else if (p.type === 'final') {
      ready = m.units.every((u) => u.status === 'ready');
      done = !!(ms.path[p.key] && ms.path[p.key].passed);
    }
    if (done) status = 'done';
    else if (!ready) status = 'draft';
    else if (prevDone) status = 'open';
    else status = 'locked';
    prevDone = prevDone && done;
    return { item: p, status, ready, done };
  });
}
