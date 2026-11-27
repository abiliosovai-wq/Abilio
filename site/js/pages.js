// Páginas: home, módulo (caminho), cadernos, glossário, laboratório, relatório, Anki, configurações.
import { h, clear, toast, pct, fmtDate, saveFile, pickFile, closeAllSheets } from './ui.js';
import { md, mdInline, plain } from './markup.js';
import { S, save, modState, exportProgress, importProgress, resetProgress } from './store.js';
import { C, conceptName } from './content.js';
import * as SE from './session.js';
import { mastery, STATUS_LABEL, averageMastery, nextDue } from './mastery.js';
import { runSession, stopTimers } from './runner.js';
import { renderMCQ, openCardSheet, ruleBox } from './render.js';
import { glossaryList, labsContent, openTerm } from './sheets.js';
import { buildAnki } from './anki.js';

const app = () => document.getElementById('app');
export const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
});

export function render() {
  stopTimers();
  closeAllSheets();
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const root = app();
  clear(root);
  window.scrollTo(0, 0);
  const [page, arg] = parts;
  try {
    switch (page) {
      case '':
        return home(root);
      case 'm':
        return modulePage(root, C.modules[arg]);
      case 's': {
        const key = arg;
        const m = C.modules[key.split(':')[0]];
        if (!m) return home(root);
        return runSession(root, m, key, go);
      }
      case 'regras':
        return rulesPage(root, C.modules[arg] || firstModule());
      case 'erros':
        return errorsPage(root, C.modules[arg] || firstModule());
      case 'glossario':
        return glossaryPage(root);
      case 'lab':
        return labsPage(root);
      case 'config':
        return configPage(root);
      case 'relatorio':
        return reportPage(root, C.modules[arg] || firstModule());
      case 'anki':
        return ankiPage(root, C.modules[arg] || firstModule());
      case 'instalar':
        return installPage(root);
      default:
        return home(root);
    }
  } catch (e) {
    console.error(e);
    root.append(h('div', { class: 'content' }, h('h1', {}, 'Algo deu errado'), h('p', {}, String(e.message || e)), h('a', { class: 'btn primary', href: '#/' }, 'Voltar ao início')));
  }
}

function firstModule() {
  const last = S().last;
  if (last && C.modules[last.split(':')[0]]) return C.modules[last.split(':')[0]];
  return Object.values(C.modules)[0];
}

function page(root, title, { back = '#/', eyebrow } = {}) {
  const content = h('main', { class: 'content', id: 'main' });
  root.append(h('div', { class: 'screen' },
    h('header', { class: 'topbar plain' }, h('a', { class: 'icon-btn', href: back, 'aria-label': 'Voltar' }, '←'), h('span', { class: 'topbar-title' }, title)),
    content));
  if (eyebrow) content.append(h('p', { class: 'eyebrow' }, eyebrow));
  return content;
}

// ---------- home ----------
function lastSessionInfo() {
  const key = S().last;
  const sess = key && SE.getSession(key);
  if (!sess || sess.done) return null;
  const m = C.modules[sess.module];
  if (!m) return null;
  let where = '';
  if (sess.kind === 'unit' || sess.kind === 'unit-review') where = m.u.get(sess.unit)?.title || '';
  else if (sess.kind === 'pretest') where = 'Pré-teste';
  else if (sess.kind === 'checkpoint' || sess.kind === 'final') where = (m.pathItems.find((p) => p.key === sess.pathKey) || {}).title || '';
  else where = { quick: 'Teste rápido', review: 'Revisão de hoje', errors: 'Revisar erros' }[sess.kind] || '';
  return { key, m, where, pos: `tela ${sess.idx + 1} de ${sess.steps.length}` };
}

function home(root) {
  const content = h('main', { class: 'content home', id: 'main' });
  root.append(h('div', { class: 'screen' }, content));
  content.append(h('header', { class: 'home-head' },
    h('div', {}, h('p', { class: 'eyebrow' }, 'USMLE Step 1'), h('h1', {}, C.catalog.title || 'Curso interativo')),
    h('a', { class: 'icon-btn', href: '#/config', 'aria-label': 'Progresso e configurações' }, '⚙')));

  const last = lastSessionInfo();
  if (last) {
    content.append(h('a', { class: 'continue-card', href: `#/s/${encodeURIComponent(last.key)}` },
      h('span', { class: 'cc-k' }, 'Continuar de onde parou'),
      h('strong', {}, last.where),
      h('span', { class: 'muted small' }, `${last.m.title} · ${last.pos}`),
      h('span', { class: 'cc-arrow', 'aria-hidden': 'true' }, '→')));
  }

  // revisões pendentes
  for (const m of Object.values(C.modules)) {
    const due = SE.dueConcepts(m);
    if (due.length) {
      content.append(h('button', { class: 'due-card', onclick: () => startSimple(m, 'review') },
        h('strong', {}, `Revisão de hoje: ${due.length} conceito${due.length > 1 ? 's' : ''}`),
        h('span', { class: 'muted small' }, 'Revisão espaçada: voltar no momento certo fixa por mais tempo.')));
    }
  }

  if (installEvt) {
    content.append(h('button', { class: 'btn wide', onclick: async () => { installEvt.prompt(); installEvt = null; } }, 'Instalar na tela inicial'));
  }

  content.append(h('h2', { class: 'section-h' }, 'Matérias'));
  const grid = h('div', { class: 'subjects' });
  for (const sub of C.catalog.subjects) {
    const mods = C.index.filter((x) => x.subject === sub.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    const card = h('section', { class: 'subject' + (mods.length ? '' : ' soon'), style: { '--sc': sub.color || 'var(--primary)' } },
      h('div', { class: 'subject-head' }, h('span', { class: 'subject-badge', 'aria-hidden': 'true' }, sub.badge || sub.name[0]), h('h3', {}, sub.name)));
    if (mods.length) {
      for (const entry of mods) {
        const m = C.modules[entry.id];
        if (!m) continue;
        const cids = m.concepts.map((c) => c.id);
        const prog = averageMastery(cids);
        const done = SE.pathStatus(m).filter((x) => x.done).length;
        card.append(h('a', { class: 'module-link', href: `#/m/${m.id}` },
          h('span', { class: 'ml-title' }, m.title),
          h('span', { class: 'ml-sub muted small' }, `${done}/${m.pathItems.length} etapas · domínio ${pct(prog)}`),
          h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: pct(prog) } }))));
      }
    }
    if (sub.soon && sub.soon.length) card.append(h('p', { class: 'soon-list muted small' }, (mods.length ? 'Em breve: ' : '') + sub.soon.join(' · ')));
    if (!mods.length) card.append(h('span', { class: 'pill' }, 'Em breve'));
    grid.append(card);
  }
  content.append(grid);

  const m = firstModule();
  content.append(h('h2', { class: 'section-h' }, 'Ferramentas'));
  content.append(h('div', { class: 'tools' },
    tool('⚡', 'Teste rápido', '10 questões dos conceitos liberados, priorizando os mais fracos', () => startSimple(m, 'quick')),
    tool('✗', 'Caderno de erros', `${SE.errorEntries(m).length} itens`, () => go(`#/erros/${m.id}`)),
    tool('§', 'Caderno de regras', 'Todas as Regras lógicas do módulo', () => go(`#/regras/${m.id}`)),
    tool('◎', 'Relatório e mapa de domínio', 'Pré-teste × prova final, conceito por conceito', () => go(`#/relatorio/${m.id}`)),
    tool('A', 'Glossário EN ↔ PT', 'Termos que a prova usa', () => go('#/glossario')),
    tool('Lab', 'Valores de referência', 'Como no painel do NBME', () => go('#/lab')),
    tool('⇪', 'Exportar para Anki', 'Arquivo .txt para o AnkiDroid', () => go(`#/anki/${m.id}`)),
    tool('⇄', 'Progresso e configurações', 'Exportar/importar entre aparelhos, tema, fonte', () => go('#/config')),
    tool('↓', 'Instalar no celular', 'Usar como app, também offline', () => go('#/instalar'))));
  content.append(h('p', { class: 'footer muted small' }, 'Conteúdo original, no estilo da prova. Progresso salvo só neste aparelho.'));
}

function tool(icon, title, sub, onclick) {
  return h('button', { class: 'tool', onclick }, h('span', { class: 'tool-i', 'aria-hidden': 'true' }, icon), h('span', { class: 'tool-t' }, h('strong', {}, title), h('span', { class: 'muted small' }, sub)));
}

function startSimple(m, kind) {
  const builders = { quick: SE.buildQuick, review: SE.buildReview, errors: SE.buildErrors };
  const sess = builders[kind](m);
  if (!sess) {
    const msg = {
      quick: 'Faça o pré-teste e comece a Unidade 1 para liberar o teste rápido.',
      review: 'Nada para revisar hoje.',
      errors: 'Seu caderno de erros está vazio.',
    }[kind];
    toast(msg);
    return;
  }
  go(`#/s/${encodeURIComponent(sess.key)}`);
}

// ---------- módulo ----------
function modulePage(root, m) {
  if (!m) return home(root);
  const sub = C.catalog.subjects.find((s) => s.id === m.subject);
  const content = page(root, m.title, { back: '#/', eyebrow: sub ? sub.name : '' });
  content.append(h('h1', {}, m.title));
  if (m.subtitle) content.append(h('p', { class: 'lead' }, m.subtitle));
  const cids = m.concepts.map((c) => c.id);
  const mastered = cids.filter((c) => mastery(c).status === 'mastered').length;
  content.append(h('div', { class: 'mod-summary' },
    h('div', { class: 'stat' }, h('div', { class: 'stat-big' }, pct(averageMastery(cids))), h('div', { class: 'stat-small' }, 'domínio médio')),
    h('div', { class: 'stat' }, h('div', { class: 'stat-big' }, `${mastered}/${cids.length}`), h('div', { class: 'stat-small' }, 'conceitos dominados'))));
  const due = SE.dueConcepts(m).length;
  content.append(h('div', { class: 'quick-actions' },
    h('button', { class: 'chip-btn', onclick: () => startSimple(m, 'quick') }, '⚡ Teste rápido'),
    h('button', { class: 'chip-btn', onclick: () => startSimple(m, 'review') }, `↻ Revisão de hoje${due ? ` (${due})` : ''}`),
    h('a', { class: 'chip-btn', href: `#/regras/${m.id}` }, '§ Regras'),
    h('a', { class: 'chip-btn', href: `#/erros/${m.id}` }, `✗ Erros (${SE.errorEntries(m).length})`),
    h('a', { class: 'chip-btn', href: `#/relatorio/${m.id}` }, '◎ Relatório')));

  content.append(h('h2', { class: 'section-h' }, 'Caminho'));
  const list = h('ol', { class: 'path' });
  const ms = modState(m.id);
  for (const ps of SE.pathStatus(m)) {
    const p = ps.item;
    const icon = { done: '✓', open: '▶', locked: '🔒', draft: '…' }[ps.status];
    let subtitle = p.subtitle || '';
    let meter = null;
    if (p.type === 'unit') {
      const u = m.u.get(p.unit);
      const uc = u ? u.concepts : [];
      subtitle = subtitle || (u ? u.subtitle : '');
      if (ps.ready) meter = h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: pct(averageMastery(uc)) } }));
    }
    if ((p.type === 'checkpoint' || p.type === 'final') && ms.path[p.key] && ms.path[p.key].best != null) subtitle += ` · melhor: ${pct(ms.path[p.key].best)}`;
    const key = `${m.id}:${p.key}`;
    const sess = SE.getSession(key);
    let action = { open: sess && !sess.done ? 'Continuar' : 'Começar', done: 'Revisar', locked: 'Bloqueado', draft: 'Em construção' }[ps.status];
    if (p.type === 'final' && ps.status === 'open' && ms.path[p.key] && ms.path[p.key].attempts && !(sess && !sess.done)) action = 'Refazer prova';
    const disabled = ps.status === 'locked' || ps.status === 'draft' || (ps.status === 'done' && p.type !== 'unit' && p.type !== 'final');
    const li = h('li', { class: 'path-item ' + ps.status + ' t-' + p.type },
      h('span', { class: 'path-icon', 'aria-hidden': 'true' }, icon),
      h('div', { class: 'path-body' },
        h('span', { class: 'path-kind' }, { pretest: 'Pré-teste', unit: 'Unidade', checkpoint: 'Checkpoint', final: 'Prova final' }[p.type]),
        h('strong', {}, p.title || (m.u.get(p.unit) || {}).title),
        subtitle ? h('span', { class: 'muted small' }, subtitle) : null,
        meter),
      h('button', { class: 'btn sm' + (ps.status === 'open' ? ' primary' : ''), disabled, onclick: () => openPathItem(m, p, ps) }, action));
    list.append(li);
  }
  content.append(list);
}

function openPathItem(m, p, ps) {
  const key = `${m.id}:${p.key}`;
  let sess = SE.getSession(key);
  if (p.type === 'unit' && ps.status === 'done') {
    sess = SE.getSession(`${key}:revisao`);
    if (!sess || sess.done) sess = SE.buildUnitReview(m, p.unit);
    return go(`#/s/${encodeURIComponent(sess.key)}`);
  }
  if (!sess || sess.done) {
    if (p.type === 'pretest') sess = SE.buildPretest(m);
    else if (p.type === 'unit') sess = SE.buildUnit(m, p.unit);
    else if (p.type === 'checkpoint') sess = SE.buildCheckpoint(m, p);
    else if (p.type === 'final') sess = SE.buildFinal(m, p, false);
  }
  go(`#/s/${encodeURIComponent(sess.key)}`);
}

// ---------- caderno de regras ----------
function rulesPage(root, m) {
  const content = page(root, 'Caderno de regras', { back: `#/m/${m.id}`, eyebrow: m.title });
  content.append(h('h1', {}, 'Caderno de regras'));
  content.append(h('p', { class: 'lead' }, 'Frases curtas e generalizáveis. Cada uma resolve questões que você nunca viu.'));
  const ms = modState(m.id);
  for (const u of m.units) {
    const rules = m.rules.filter((r) => r.unit === u.id);
    if (!rules.length) continue;
    const open = !!(ms.units[u.id] && (ms.units[u.id].started || ms.units[u.id].passed));
    const sec = h('section', { class: 'rules-sec' }, h('h3', {}, u.title));
    for (const r of rules) {
      if (open) {
        const cs = m.concepts.filter((c) => c.rule === r.id || (c.rules || []).includes(r.id));
        sec.append(h('div', { class: 'rule-card' },
          h('span', { class: 'rule-n' }, `Regra ${r.n}`),
          h('div', { html: md(r.text) }),
          cs.length ? h('div', { class: 'rule-cs' }, cs.map((c) => h('span', { class: 'chip-tag' }, h('span', { class: 'dot ' + mastery(c.id).status }), c.name))) : null));
      } else {
        sec.append(h('div', { class: 'rule-card locked' }, h('span', { class: 'rule-n' }, `Regra ${r.n}`), h('span', { class: 'muted' }, '🔒 Desbloqueia quando você começar esta unidade.')));
      }
    }
    content.append(sec);
  }
}

// ---------- caderno de erros ----------
function errorsPage(root, m) {
  const content = page(root, 'Caderno de erros', { back: `#/m/${m.id}`, eyebrow: m.title });
  const entries = SE.errorEntries(m);
  content.append(h('h1', {}, 'Caderno de erros'));
  content.append(h('p', { class: 'lead' }, 'Itens errados ou acertados no chute. Ao revisar, você recebe uma questão nova do mesmo conceito; acertando com Certeza, o item sai do caderno.'));
  if (!entries.length) {
    content.append(h('p', { class: 'muted' }, 'Nada por aqui ainda.'));
    return;
  }
  content.append(h('button', { class: 'btn primary wide', onclick: () => startSimple(m, 'errors') }, `Revisar erros (${Math.min(10, entries.length)} de ${entries.length})`));
  const list = h('div', { class: 'review-list' });
  for (const [id, e] of entries) {
    const q = m.q.get(id);
    const scr = m.screens.get(id);
    const det = h('details', { class: 'review-item bad' },
      h('summary', {}, h('span', { class: 'ri-mark' }, e.correct ? '?' : '✗'), h('span', { class: 'ri-c' }, conceptName(m, (e.concepts || [])[0])), h('span', { class: 'pill' }, e.correct ? 'chute' : e.conf === 'certeza' ? 'erro com certeza' : 'erro'), h('span', { class: 'muted small' }, fmtDate(e.t))));
    let done = false;
    det.addEventListener('toggle', () => {
      if (!det.open || done) return;
      done = true;
      const body = h('div', { class: 'ri-body' });
      det.append(body);
      if (q) {
        renderMCQ({ ...q, kind: 'nbme' }, { m, mode: 'review', content: body, bar: { set() {} }, result: { choice: e.choice ?? null, correct: e.correct, conf: e.conf }, order: null, answer() {}, next() {}, openCard: (cid) => openCardSheet(m, cid) });
      } else if (scr) {
        const s = scr.screen;
        body.append(h('div', { class: 'prose', html: md(s.prompt || s.text || s.front || '') }));
        if (s.reveal || s.explanation) body.append(h('div', { class: 'prose', html: md(s.reveal || s.explanation) }));
        body.append(ruleBox(m, s.rule));
      }
    });
    list.append(det);
  }
  content.append(list);
}

// ---------- glossário / laboratório ----------
function glossaryPage(root) {
  const content = page(root, 'Glossário', { back: '#/' });
  content.append(h('h1', {}, 'Glossário EN ↔ PT'));
  const input = h('input', { class: 'search', type: 'search', placeholder: 'Buscar em inglês ou português…', autocapitalize: 'off' });
  const list = h('dl', { class: 'gloss-list' });
  const draw = () => {
    clear(list);
    for (const g of glossaryList(input.value)) {
      list.append(h('dt', {}, h('strong', { lang: 'en' }, g.en), h('span', { class: 'muted' }, ' · ' + g.pt)), h('dd', { html: md(g.def || '') }));
    }
  };
  input.addEventListener('input', draw);
  content.append(input, list);
  draw();
}

function labsPage(root) {
  const content = page(root, 'Valores de referência', { back: '#/' });
  content.append(h('h1', {}, 'Valores de referência'), labsContent());
}

// ---------- relatório / encerramento ----------
function reportPage(root, m) {
  const content = page(root, 'Relatório', { back: `#/m/${m.id}`, eyebrow: m.title });
  const ms = modState(m.id);
  const final = ms.path.final;
  content.append(h('h1', {}, final && final.passed ? 'Encerramento do módulo' : 'Relatório e mapa de domínio'));
  if (!(final && final.passed)) content.append(h('p', { class: 'muted' }, 'Relatório parcial: a comparação completa aparece quando você fizer a prova final.'));

  content.append(h('h2', { class: 'section-h' }, 'Pré-teste × prova final'));
  const pre = (ms.pretest && ms.pretest.byConcept) || {};
  const fin = (final && final.byConcept) || {};
  const tbl = h('table', { class: 'cmp-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Conceito'), h('th', {}, 'Pré'), h('th', {}, 'Final'), h('th', {}, 'Agora'))));
  const tb = h('tbody');
  for (const c of m.concepts) {
    const p = pre[c.id];
    const f = fin[c.id];
    const st = mastery(c.id);
    if (p === undefined && !f && st.n === 0) continue;
    tb.append(h('tr', {}, h('td', {}, c.name), h('td', {}, p === undefined ? '—' : p ? '✓' : '✗'), h('td', {}, f ? `${f.ok}/${f.n}` : '—'), h('td', {}, h('span', { class: 'dot ' + st.status }), ' ', st.n ? pct(st.score) : '—')));
  }
  tbl.append(tb);
  content.append(tb.children.length ? tbl : h('p', { class: 'muted' }, 'Sem dados ainda.'));

  content.append(h('h2', { class: 'section-h' }, 'Mapa de domínio'));
  content.append(h('p', { class: 'legend small' }, ['mastered', 'progress', 'weak', 'none'].map((s) => h('span', {}, h('span', { class: 'dot ' + s }), ' ' + STATUS_LABEL[s] + '  '))));
  for (const u of m.units) {
    const sec = h('section', { class: 'map-sec' }, h('h3', {}, u.title));
    sec.append(h('ul', { class: 'concept-list' }, u.concepts.map((cid) => {
      const st = mastery(cid);
      return h('li', { class: 'concept-row' }, h('span', { class: 'dot ' + st.status }), h('span', {}, conceptName(m, cid)), h('span', { class: 'muted small' }, st.n ? pct(st.score) : ''), st.misconception ? h('span', { class: 'pill warn' }, 'erro confiante') : null);
    })));
    content.append(sec);
  }

  content.append(h('h2', { class: 'section-h' }, 'O que revisar'));
  const weak = m.concepts.filter((c) => {
    const st = mastery(c.id);
    return st.n > 0 && st.status !== 'mastered';
  });
  if (weak.length) {
    content.append(h('ul', { class: 'concept-list' }, weak.map((c) => h('li', { class: 'concept-row' }, h('span', { class: 'dot ' + mastery(c.id).status }), h('span', {}, c.name), c.rule && m.r.get(c.rule) ? h('span', { class: 'muted small' }, `Regra ${m.r.get(c.rule).n}`) : null))));
    content.append(h('div', { class: 'row-btns' },
      h('button', { class: 'btn primary', onclick: () => startSimple(m, 'quick') }, 'Teste rápido'),
      h('a', { class: 'btn', href: `#/anki/${m.id}` }, 'Exportar para Anki'),
      h('a', { class: 'btn', href: `#/regras/${m.id}` }, 'Caderno de regras')));
  } else content.append(h('p', { class: 'muted' }, 'Nenhum conceito pendente entre os que você já estudou.'));
}

// ---------- Anki ----------
function ankiPage(root, m) {
  const content = page(root, 'Exportar para Anki', { back: '#/', eyebrow: m.title });
  content.append(h('h1', {}, 'Exportar para Anki'));
  content.append(h('div', { class: 'prose', html: md('Gera um arquivo **.txt separado por tab** (frente/verso) com cartões **de mecanismo** dos conceitos que você errou ou ainda não domina, mais a Regra lógica de cada um.') }));
  let scope = 'errors';
  const info = h('p', { class: 'muted' });
  const upd = () => {
    const { cards, concepts } = buildAnki(m, scope);
    info.textContent = `${cards.length} cartões de ${concepts.length} conceitos.`;
  };
  content.append(h('div', { class: 'seg' },
    h('label', {}, h('input', { type: 'radio', name: 'scope', checked: true, onchange: () => { scope = 'errors'; upd(); } }), ' Só os conceitos que errei ou não domino'),
    h('label', {}, h('input', { type: 'radio', name: 'scope', onchange: () => { scope = 'all'; upd(); } }), ' Todos os conceitos já estudados')));
  content.append(info);
  upd();
  content.append(h('button', { class: 'btn primary wide', onclick: async () => {
    const { text, cards } = buildAnki(m, scope);
    if (!cards.length) return toast('Nenhum cartão para exportar ainda.');
    const d = new Date().toISOString().slice(0, 10);
    const r = await saveFile(`anki-${m.id}-${d}.txt`, text, 'text/plain');
    if (r !== 'cancelled') toast('Arquivo gerado.');
  } }, 'Gerar arquivo para o Anki'));
  content.append(h('h3', {}, 'Como importar no AnkiDroid (tablet)'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Toque em "Gerar arquivo" e salve (ou compartilhe direto com o AnkiDroid).'),
      h('li', {}, 'No AnkiDroid: menu ⋮ → Importar → escolha o arquivo .txt.'),
      h('li', {}, 'Confira: separador = Tab, "Permitir HTML" ligado, tipo de nota = Básico, e escolha o baralho.'),
      h('li', {}, 'Toque em Importar. As etiquetas (tags) já vêm com o nome do módulo e do conceito.')),
    h('p', { class: 'muted small' }, 'No iPhone, o mais simples é importar no AnkiDroid do tablet e sincronizar pelo AnkiWeb.'));
}

// ---------- configurações / progresso ----------
function configPage(root) {
  const content = page(root, 'Progresso e configurações', { back: '#/' });
  const st = S();
  content.append(h('h1', {}, 'Progresso e configurações'));
  content.append(h('h2', { class: 'section-h' }, 'Passar o progresso para outro aparelho'));
  content.append(h('div', { class: 'prose', html: md('1. Neste aparelho: **Exportar progresso** → salve o arquivo ou mande para você mesmo (WhatsApp, e-mail, Google Drive).\n2. No outro aparelho: abra o site → aqui → **Importar progresso** → escolha o arquivo.\n\nA importação **substitui** o progresso do aparelho de destino.') }));
  content.append(h('div', { class: 'row-btns' },
    h('button', { class: 'btn primary', onclick: async () => {
      const d = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const r = await saveFile(`progresso-step1-${d}.json`, exportProgress(), 'application/json');
      if (r !== 'cancelled') toast('Progresso exportado.');
    } }, 'Exportar progresso'),
    h('button', { class: 'btn', onclick: async () => {
      const f = await pickFile();
      if (!f) return;
      if (!confirm('Substituir o progresso deste aparelho pelo do arquivo?')) return;
      try {
        importProgress(f.text);
        toast('Progresso importado.');
        go('#/');
      } catch (e) {
        toast('Arquivo inválido: ' + e.message, { timeout: 6000 });
      }
    } }, 'Importar progresso')));
  content.append(h('p', { class: 'muted small' }, `Última alteração: ${new Date(st.updated).toLocaleString('pt-BR')}`));

  content.append(h('h2', { class: 'section-h' }, 'Aparência'));
  const themeRow = h('div', { class: 'seg-btns' });
  for (const [k, label] of [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']]) {
    themeRow.append(h('button', { class: 'btn sm' + (st.settings.theme === k ? ' primary' : ''), onclick: () => { st.settings.theme = k; save(); applySettings(); render(); } }, label));
  }
  content.append(h('p', {}, 'Tema'), themeRow);
  const fontRow = h('div', { class: 'seg-btns' });
  for (const [k, label] of [[0.9, 'A−'], [1, 'A'], [1.12, 'A+'], [1.25, 'A++']]) {
    fontRow.append(h('button', { class: 'btn sm' + (st.settings.font === k ? ' primary' : ''), onclick: () => { st.settings.font = k; save(); applySettings(); render(); } }, label));
  }
  content.append(h('p', {}, 'Tamanho do texto'), fontRow);

  content.append(h('h2', { class: 'section-h' }, 'Onde fica salvo'));
  content.append(h('div', { class: 'prose', html: md('O progresso fica **só neste aparelho**, neste navegador. No iPhone, o app instalado na tela de início e o Safari guardam progressos **separados**: use sempre o mesmo (de preferência o ícone da tela de início) e exporte de vez em quando como cópia de segurança.') }));
  content.append(h('h2', { class: 'section-h' }, 'Zona de perigo'));
  content.append(h('button', { class: 'btn btn-bad', onclick: () => {
    if (confirm('Apagar TODO o progresso deste aparelho? Exporte antes se quiser guardar.')) {
      resetProgress();
      toast('Progresso apagado.');
      go('#/');
    }
  } }, 'Apagar progresso'));
}

function installPage(root) {
  const content = page(root, 'Instalar no celular', { back: '#/' });
  content.append(h('h1', {}, 'Instalar como app'));
  content.append(h('div', { class: 'prose', html: md('Instalado, o curso abre em tela cheia e **funciona offline** depois do primeiro acesso.\n\n**Android (Chrome)**\n1. Abra o site no Chrome.\n2. Toque no menu **⋮** (canto superior direito).\n3. Toque em **Instalar app** (ou **Adicionar à tela inicial**).\n\n**iPhone (Safari)**\n1. Abra o site no **Safari** (não funciona pelo navegador do Instagram/WhatsApp).\n2. Toque no botão **Compartilhar** (quadrado com seta para cima).\n3. Role e toque em **Adicionar à Tela de Início** → **Adicionar**.\n\n**Atenção no iPhone:** o app da tela de início tem progresso separado do Safari. Escolha um dos dois e use sempre ele. Para levar o progresso de um aparelho para outro, use **Progresso e configurações → Exportar/Importar**.') }));
}

export function applySettings() {
  const st = S().settings;
  const root = document.documentElement;
  if (st.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', st.theme);
  root.style.setProperty('--font-scale', String(st.font || 1));
}

export { openTerm, plain, mdInline };
