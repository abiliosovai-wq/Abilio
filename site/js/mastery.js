// Domínio por conceito: acerto × confiança × dificuldade, com mais peso para tentativas recentes.
// Revisão espaçada entre dias (reaprendizagem sucessiva): intervalos crescentes após acertos com Certeza.
import { S, save } from './store.js';

export const LEVEL_W = { 1: 1, 2: 1.25, 3: 1.5, 4: 2 };
export const CONF_SCORE = { certeza: 1, duvida: 0.5, chute: 0 };
export const CONF_LABEL = { certeza: 'Certeza', duvida: 'Dúvida', chute: 'Chute' };
const INTERVALS = [1, 3, 7, 16, 35, 80]; // dias
const DAY = 86400000;
const RECENT = 6;
const DECAY = 0.8;

// Contextos que não entram no cálculo de domínio.
const NON_GRADED = new Set(['pre', 'hook', 'flip', 'explore']);

export function cstate(cid) {
  const s = S();
  s.concepts[cid] = s.concepts[cid] || { a: [], box: 0, next: 0 };
  return s.concepts[cid];
}

export function attemptScore(a) {
  if (!a.correct) return 0;
  return CONF_SCORE[a.conf] ?? 1; // itens sem pergunta de confiança (ordenar, associar, lacuna)
}

export function record(concepts, attempt) {
  const now = Date.now();
  for (const cid of concepts || []) {
    const c = cstate(cid);
    const a = { t: now, i: attempt.item, ok: !!attempt.correct, cf: attempt.conf || null, lv: attempt.level || 1, x: attempt.ctx };
    c.a.push(a);
    if (c.a.length > 40) c.a.splice(0, c.a.length - 40);
    if (NON_GRADED.has(attempt.ctx)) continue;
    // Agenda de revisão espaçada
    if (a.ok && (a.cf === 'certeza' || a.cf === null)) {
      if (!c.next || now >= c.next - DAY / 2 || c.box === 0) c.box = Math.min(c.box + 1, INTERVALS.length - 1);
      c.next = now + INTERVALS[c.box] * DAY;
    } else if (!a.ok || a.cf === 'chute') {
      c.box = 0;
      c.next = now + DAY;
    } else {
      c.next = Math.min(c.next || Infinity, now + 2 * DAY);
    }
  }
  save();
}

function graded(c) {
  return (c?.a || []).filter((a) => !NON_GRADED.has(a.x));
}

export function mastery(cid) {
  const c = S().concepts[cid];
  const list = graded(c);
  if (!list.length) return { score: 0, status: 'none', n: 0, misconception: false };
  const recent = list.slice(-RECENT).reverse();
  let num = 0;
  let den = 0;
  recent.forEach((a, i) => {
    const w = (LEVEL_W[a.lv] || 1) * Math.pow(DECAY, i);
    num += w * attemptScore({ correct: a.ok, conf: a.cf });
    den += w;
  });
  const score = den ? num / den : 0;
  const hasHighCertain = list.some((a) => a.ok && a.cf === 'certeza' && a.lv >= 3);
  const last = recent[0];
  const misconception = !!last && !last.ok && last.cf === 'certeza';
  let status = 'weak';
  if (score >= 0.8 && hasHighCertain) status = 'mastered';
  else if (score >= 0.5) status = 'progress';
  return { score, status, n: list.length, misconception, hasHighCertain };
}

export const STATUS_LABEL = {
  none: 'Sem dados',
  weak: 'Fraco',
  progress: 'Em progresso',
  mastered: 'Dominado',
};

export function isDue(cid, now = Date.now()) {
  const c = S().concepts[cid];
  return !!c && graded(c).length > 0 && c.next && c.next <= now;
}

export function nextDue(cids) {
  let best = Infinity;
  for (const cid of cids) {
    const c = S().concepts[cid];
    if (c && c.next && graded(c).length) best = Math.min(best, c.next);
  }
  return best === Infinity ? null : best;
}

// Caderno de erros
export function noteError(itemId, info) {
  S().errors[itemId] = { t: Date.now(), ...info };
  save();
}

export function clearError(itemId) {
  if (S().errors[itemId]) {
    delete S().errors[itemId];
    save();
  }
}

export function markSeen(qid) {
  S().seen[qid] = Date.now();
  save();
}

export function averageMastery(cids) {
  if (!cids.length) return 0;
  return cids.reduce((s, c) => s + mastery(c).score, 0) / cids.length;
}
