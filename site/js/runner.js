// Executor de sessão: moldura (barra de progresso, painel de laboratório, cronômetro, barra de ação)
// e telas especiais (introduções, portão de domínio, remediação, revisão de prova, resumos).
import { h, clear, shuffle, toast, pct } from './ui.js';
import { md, mdInline } from './markup.js';
import { S, save, modState } from './store.js';
import * as SE from './session.js';
import { mastery, STATUS_LABEL } from './mastery.js';
import { renderCard, renderMCQ, renderMatch, renderOrder, renderCloze, renderFlip, renderSim, openCardSheet, ruleBox } from './render.js';
import { openLabs } from './sheets.js';
import { conceptName } from './content.js';

let tick = null;

export function runSession(root, m, key, go) {
  let sess = SE.getSession(key);
  if (!sess) {
    go(`#/m/${m.id}`);
    return;
  }
  S().last = key;
  save();
  clearInterval(tick);

  const draw = () => {
    clearInterval(tick);
    clear(root);
    const step = sess.steps[sess.idx];
    if (!step) {
      go(`#/m/${m.id}`);
      return;
    }
    const item = SE.itemOf(m, step);
    const screen = h('div', { class: 'screen session' });
    const content = h('main', { class: 'content', id: 'main', 'data-step': step.id || step.t, 'data-kind': step.t, 'data-role': step.role || '' });
    const bar = h('div', { class: 'actionbar' });
    const barInner = h('div', { class: 'actionbar-inner' });
    bar.append(barInner);
    screen.append(topbar(step), content, bar);
    root.append(screen);

    const barApi = {
      set(items) {
        clear(barInner);
        for (const it of items) {
          if (it instanceof Node) barInner.append(it);
          else barInner.append(h('button', { class: 'btn' + (it.primary ? ' primary' : '') + (it.cls ? ' ' + it.cls : ''), disabled: !!it.disabled, onclick: it.onClick }, it.label));
        }
      },
    };
    const ctx = {
      m,
      mode: step.role === 'pre' ? 'pre' : step.role === 'exam' ? 'exam' : 'learn',
      content,
      bar: barApi,
      result: sess.res[sess.idx] || null,
      order: orderFor(step, item),
      answer: (r) => {
        sess = SE.answer(m, sess, r);
        updateProgress();
      },
      next: () => {
        sess = SE.advance(m, sess);
        draw();
        window.scrollTo(0, 0);
      },
      openCard: (id) => openCardSheet(m, id),
    };

    const tag = stepTag(step);
    if (tag) content.append(tag);
    if (step.reused) content.append(h('p', { class: 'note small' }, 'As questões inéditas deste conceito acabaram; esta já apareceu antes, com as alternativas reembaralhadas.'));

    try {
      dispatch(step, item, ctx);
    } catch (e) {
      console.error(e);
      content.append(h('p', { class: 'note warn' }, 'Erro ao mostrar esta tela. Toque em Continuar para seguir.'));
      barApi.set([{ label: 'Continuar', primary: true, onClick: ctx.next }]);
    }
    const first = content.querySelector('h1,h2,.stem,.prompt');
    if (first) first.setAttribute('tabindex', '-1');
  };

  function orderFor(step, item) {
    if (!item) return null;
    const i = sess.idx;
    let n = 0;
    if (item.options && item.shuffle !== false) n = item.options.length;
    else if (item.type === 'order') n = item.items.length;
    else if (item.type === 'match') return null;
    else return null;
    if (!sess.ord[i] || sess.ord[i].length !== n) {
      let o = shuffle([...Array(n).keys()]);
      if (item.type === 'order') {
        let guard = 0;
        while (o.every((v, k) => v === k) && guard++ < 10) o = shuffle(o);
      }
      sess.ord[i] = o;
      save();
    }
    return sess.ord[i];
  }

  function topbar(step) {
    const total = sess.steps.length;
    const pctv = Math.round(((sess.idx + 1) / total) * 100);
    const isQ = step.t === 'q';
    const bar = h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Sair (o progresso fica salvo)', onclick: () => go(`#/m/${m.id}`) }, '✕'),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pctv) }, h('div', { class: 'progress-fill', style: { width: pctv + '%' } })),
      h('span', { class: 'progress-n' }, `${sess.idx + 1}/${total}`),
      isQ ? h('button', { class: 'icon-btn labs-btn', 'aria-label': 'Valores laboratoriais de referência', onclick: openLabs }, 'Lab') : null);
    if (sess.timer && sess.timer.limit && step.role === 'exam') {
      if (!sess.timer.start) {
        sess.timer.start = Date.now();
        save();
      }
      const t = h('span', { class: 'timer' });
      bar.append(t);
      const upd = () => {
        const left = Math.max(0, Math.round(sess.timer.limit - (Date.now() - sess.timer.start) / 1000));
        t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        t.classList.toggle('low', left < 120);
        if (left <= 0) {
          clearInterval(tick);
          timeUp();
        }
      };
      upd();
      tick = setInterval(upd, 1000);
    }
    return bar;
  }

  function timeUp() {
    sess.steps.forEach((s, i) => {
      if (s.t === 'q' && s.role === 'exam' && !sess.res[i]) sess.res[i] = { choice: null, correct: false, conf: null, skipped: true };
    });
    const ri = sess.steps.findIndex((s) => s.t === 'review');
    sess = SE.goTo(sess, ri);
    toast('Tempo esgotado. Veja a revisão completa.');
    draw();
  }

  function updateProgress() {
    const fill = root.querySelector('.progress-fill');
    const n = root.querySelector('.progress-n');
    if (fill) fill.style.width = Math.round(((sess.idx + 1) / sess.steps.length) * 100) + '%';
    if (n) n.textContent = `${sess.idx + 1}/${sess.steps.length}`;
  }

  function stepTag(step) {
    const map = { repeat: 'Revendo um conceito (questão nova)', remed: 'Remediação', mt: 'Mini-teste', exam: sess.kind === 'final' ? 'Prova final' : 'Checkpoint', quick: 'Teste rápido', review: 'Revisão espaçada', errors: 'Revisar erros', pre: 'Pré-teste', hook: 'Pergunta-gancho · errar é esperado' };
    let label = map[step.role];
    if (step.t === 'screen') {
      const it = SE.itemOf(m, step);
      if (it && it.role === 'hook') label = map.hook;
      else label = null;
    }
    if (!label || step.t !== 'q' && step.t !== 'screen') return null;
    if (step.role === 'mt' || step.role === 'exam' || step.role === 'pre') {
      const same = sess.steps.filter((s) => s.t === 'q' && s.role === step.role && (step.role !== 'mt' || s.attempt === step.attempt));
      label += ` · ${same.indexOf(step) + 1} de ${same.length}`;
    }
    return h('div', { class: 'step-tag' + (step.role === 'repeat' || step.role === 'remed' ? ' warn' : '') }, label);
  }

  function dispatch(step, item, ctx) {
    switch (step.t) {
      case 'screen':
      case 'q':
        if (!item) {
          ctx.content.append(h('p', { class: 'muted' }, 'Este item não existe mais nesta versão do conteúdo.'));
          ctx.bar.set([{ label: 'Continuar', primary: true, onClick: ctx.next }]);
          return;
        }
        return renderItem(item, ctx);
      case 'intro':
        return renderIntro(step, ctx);
      case 'gate':
        return renderGate(step, ctx);
      case 'remed':
        return renderRemed(step, ctx);
      case 'cardref': {
        const ref = m.screens.get(step.id);
        ctx.content.append(h('div', { class: 'step-tag warn' }, 'Remediação · rever o cartão'));
        if (ref) renderCard(ref.screen, ctx);
        else ctx.bar.set([{ label: 'Continuar', primary: true, onClick: ctx.next }]);
        return;
      }
      case 'review':
        return renderExamReview(step, ctx);
      case 'exam-done':
        return renderExamDone(step, ctx);
      case 'summary':
        return renderSummary(step, ctx);
      default:
        ctx.bar.set([{ label: 'Continuar', primary: true, onClick: ctx.next }]);
    }
  }

  function renderItem(item, ctx) {
    const type = item.kind === 'nbme' ? 'nbme' : item.type;
    switch (type) {
      case 'card':
        return renderCard(item, ctx);
      case 'nbme':
      case 'mcq':
      case 'predict':
        return renderMCQ(item, ctx);
      case 'match':
        return renderMatch(item, ctx);
      case 'order':
        return renderOrder(item, ctx);
      case 'cloze':
        return renderCloze(item, ctx);
      case 'flip':
        return renderFlip(item, ctx);
      case 'sim':
        return renderSim(item, ctx);
      default:
        ctx.content.append(h('p', {}, 'Tipo desconhecido: ' + type));
        ctx.bar.set([{ label: 'Continuar', primary: true, onClick: ctx.next }]);
    }
  }

  function renderIntro(step, ctx) {
    const c = ctx.content;
    if (step.id === 'unit' || step.id === 'unit-review') {
      const u = m.u.get(sess.unit);
      c.append(h('p', { class: 'eyebrow' }, step.id === 'unit-review' ? 'Revisão da unidade' : m.title),
        h('h1', {}, u.title),
        u.subtitle ? h('p', { class: 'lead' }, u.subtitle) : null,
        h('h3', {}, 'Ao final desta unidade você vai conseguir'),
        h('ul', { class: 'objectives' }, (u.objectives || []).map((o) => h('li', { html: mdInline(o) }))),
        h('h3', {}, 'Conceitos'),
        h('ul', { class: 'concept-list' }, u.concepts.map((cid) => conceptRow(cid))),
        step.id === 'unit'
          ? h('div', { class: 'note' }, h('strong', {}, 'Como funciona: '), 'cartões curtos intercalados com perguntas. No fim, um mini-teste. A próxima unidade só libera com ≥80% e acerto com ', h('em', {}, 'Certeza'), ' nas duas últimas questões.')
          : h('p', { class: 'muted' }, 'Revisão livre: as respostas atualizam seu domínio, mas não mudam o portão.'));
      ctx.bar.set([{ label: 'Começar', primary: true, onClick: ctx.next }]);
    } else if (step.id === 'pretest') {
      c.append(h('p', { class: 'eyebrow' }, m.title), h('h1', {}, 'Pré-teste diagnóstico'),
        h('div', { class: 'prose', html: md(`São **${m.pretest.length} questões** cobrindo o módulo inteiro. Elas medem seu ponto de partida — não é para saber tudo agora.\n\nResponder antes de estudar ajuda a aprender depois (efeito pré-teste), mesmo quando você erra. Escolha a alternativa e diga sua confiança: **Certeza**, **Dúvida** ou **Chute**.\n\nNo fim do módulo você vai comparar este resultado com a prova final, conceito por conceito.`) }));
      ctx.bar.set([{ label: 'Começar o pré-teste', primary: true, onClick: ctx.next }]);
    } else if (step.id === 'mt') {
      const u = m.u.get(sess.unit);
      const n = sess.steps.filter((s) => s.t === 'q' && s.role === 'mt' && s.attempt === step.attempt).length;
      c.append(h('p', { class: 'eyebrow' }, u.title), h('h1', {}, step.attempt > 1 ? `Mini-teste · tentativa ${step.attempt}` : 'Mini-teste da unidade'),
        h('div', { class: 'prose', html: md(`**${n} questões** no formato NBME, do nível 1 ao 4${step.attempt > 1 ? ', todas novas' : ''}.\n\nPara liberar a próxima unidade:\n- pelo menos **80% de acertos**;\n- acerto com **Certeza** nas **duas últimas** questões (as mais difíceis).\n\nO painel **Lab** no topo mostra os valores de referência.`) }));
      ctx.bar.set([{ label: 'Começar', primary: true, onClick: ctx.next }]);
    } else if (step.id === 'exam' || step.id === 'final') {
      const item = m.pathItems.find((p) => p.key === sess.pathKey) || {};
      const n = sess.steps.filter((s) => s.role === 'exam').length;
      const final = step.id === 'final';
      c.append(h('p', { class: 'eyebrow' }, m.title), h('h1', {}, item.title || (final ? 'Prova final' : 'Checkpoint')),
        h('div', { class: 'prose', html: md(`**${n} vinhetas** misturando tudo o que veio até aqui, em **modo prova**: sem comentários até o fim. Depois você revisa cada questão com o comentário completo.\n\nMeta: **${final ? '≥85%' : '≥80%'}**. Abaixo disso, vem uma remediação focada nos conceitos fracos${final ? ' e você pode refazer a prova com questões novas' : ' antes de seguir'}.`) }));
      if (final) {
        ctx.bar.set([
          { label: 'Sem cronômetro', onClick: () => { sess.timer = null; ctx.next(); } },
          { label: `Modo prova (${item.secondsPerQuestion || 90} s/questão)`, primary: true, onClick: () => { sess.timer = { start: null, limit: n * (item.secondsPerQuestion || 90) }; save(); ctx.next(); } },
        ]);
      } else ctx.bar.set([{ label: 'Começar', primary: true, onClick: ctx.next }]);
    } else {
      ctx.bar.set([{ label: 'Continuar', primary: true, onClick: ctx.next }]);
    }
  }

  function conceptRow(cid) {
    const ms = mastery(cid);
    return h('li', { class: 'concept-row' }, h('span', { class: 'dot ' + ms.status, title: STATUS_LABEL[ms.status] }), h('span', {}, conceptName(m, cid)), ms.n ? h('span', { class: 'muted small' }, pct(ms.score)) : null);
  }

  function renderGate(step, ctx) {
    const g = SE.evalGate(m, sess, step.attempt);
    const u = m.u.get(sess.unit);
    const c = ctx.content;
    c.append(h('p', { class: 'eyebrow' }, u.title), h('h1', {}, g.pass ? 'Unidade dominada!' : 'Quase lá'));
    c.append(h('div', { class: 'gate-stats' },
      stat(pct(g.score), `${g.correct}/${g.total} acertos`, g.score >= SE.GATE_MIN),
      stat(g.last2ok ? '✓' : '✗', 'Certeza nas 2 últimas', g.last2ok)));
    if (g.pass) {
      c.append(h('p', {}, 'Você demonstrou domínio. Regras desta unidade, agora no seu Caderno de regras:'));
      c.append(...m.rules.filter((r) => r.unit === u.id).map((r) => ruleBox(m, r.id)));
      ctx.bar.set([{ label: 'Concluir unidade', primary: true, onClick: () => {
        SE.resolveGate(m, sess, g);
        toast(`${u.title}: concluída ✓`);
        go(`#/m/${m.id}`);
      } }]);
    } else {
      const why = [];
      if (g.score < SE.GATE_MIN) why.push('acertos abaixo de 80%');
      if (!g.last2ok) why.push('as duas últimas não foram acertos com Certeza');
      c.append(h('p', {}, `Ainda não liberou: ${why.join(' e ')}. Isso é normal — é aqui que o aprendizado se consolida.`));
      c.append(h('h3', {}, 'Vamos reforçar'));
      c.append(h('ul', { class: 'concept-list' }, [...g.weak.keys()].map((cid) => conceptRow(cid))));
      c.append(h('p', { class: 'muted' }, 'Para cada conceito: o cartão da lição, a regra e questões novas. Depois, um mini-teste com questões inéditas.'));
      ctx.bar.set([{ label: 'Começar remediação', primary: true, onClick: () => {
        SE.resolveGate(m, sess, g);
        sess = SE.getSession(key);
        ctx.next();
      } }]);
    }
  }

  function stat(big, small, ok) {
    return h('div', { class: 'stat ' + (ok ? 'ok' : 'bad') }, h('div', { class: 'stat-big' }, big), h('div', { class: 'stat-small' }, small));
  }

  function renderRemed(step, ctx) {
    const c = m.c.get(step.cid);
    ctx.content.append(h('div', { class: 'step-tag warn' }, 'Remediação'), h('h1', {}, c ? c.name : step.cid),
      h('p', {}, 'Vamos rever este conceito pelo mecanismo e testar com questões que você ainda não viu.'),
      c && c.rule ? ruleBox(m, c.rule) : null);
    ctx.bar.set([{ label: 'Continuar', primary: true, onClick: ctx.next }]);
  }

  function reviewList(stepsFilter, container) {
    const list = h('div', { class: 'review-list' });
    let k = 0;
    sess.steps.forEach((s, i) => {
      if (!stepsFilter(s)) return;
      k++;
      const q = SE.itemOf(m, s);
      const r = sess.res[i];
      const ok = r && r.correct;
      const det = h('details', { class: 'review-item ' + (ok ? 'ok' : 'bad') });
      det.append(h('summary', {}, h('span', { class: 'ri-n' }, k), h('span', { class: 'ri-mark' }, ok ? '✓' : '✗'), h('span', { class: 'ri-c' }, q ? conceptName(m, q.concepts[0]) : s.id), r && r.conf ? h('span', { class: 'pill' }, r.conf === 'certeza' ? 'Certeza' : r.conf === 'duvida' ? 'Dúvida' : 'Chute') : null));
      let rendered = false;
      det.addEventListener('toggle', () => {
        if (!det.open || rendered || !q) return;
        rendered = true;
        const body = h('div', { class: 'ri-body' });
        det.append(body);
        renderMCQ(q, { m, mode: 'review', content: body, bar: { set() {} }, result: r || { choice: null, correct: false, conf: null, skipped: true }, order: sess.ord[i], answer() {}, next() {}, openCard: (id) => openCardSheet(m, id) });
      });
      list.append(det);
    });
    container.append(list);
  }

  function renderExamReview(step, ctx) {
    const exam = SE.evalExam(m, sess);
    if (!sess.meta.resolved) {
      SE.resolveExam(m, sess, exam);
      sess = SE.getSession(key);
    }
    const final = sess.kind === 'final';
    const min = final ? SE.FINAL_MIN : SE.CHECKPOINT_MIN;
    const passed = exam.score >= min;
    const c = ctx.content;
    c.append(h('p', { class: 'eyebrow' }, final ? 'Prova final' : 'Checkpoint'), h('h1', {}, passed ? 'Aprovado' : 'Revisão do resultado'));
    c.append(h('div', { class: 'gate-stats' }, stat(pct(exam.score), `${exam.correct}/${exam.total} · meta ${pct(min)}`, passed)));
    c.append(h('p', { class: 'muted' }, 'Toque em cada questão para ver o comentário completo.'));
    reviewList((s) => s.t === 'q' && s.role === 'exam', c);
    if (!passed && exam.weak.size) {
      c.append(h('h3', {}, 'Conceitos para remediar'), h('ul', { class: 'concept-list' }, [...exam.weak.keys()].slice(0, 5).map((cid) => conceptRow(cid))));
    }
    ctx.bar.set([{ label: passed ? 'Concluir' : 'Começar remediação', primary: true, onClick: ctx.next }]);
  }

  function renderExamDone(step, ctx) {
    const final = sess.kind === 'final';
    SE.finishExam(m, sess, step.passed);
    const c = ctx.content;
    if (final) {
      c.append(h('h1', {}, step.passed ? 'Domínio do módulo atingido' : 'Prova final: ainda abaixo de 85%'));
      c.append(h('p', {}, step.passed ? 'Veja a comparação com o pré-teste, seu mapa de domínio e o que ainda vale revisar.' : 'Você fez a remediação dos conceitos fracos. Quando quiser, refaça a prova final — as questões serão outras.'));
      ctx.bar.set([
        { label: 'Voltar ao módulo', onClick: () => go(`#/m/${m.id}`) },
        { label: 'Ver relatório', primary: true, onClick: () => go(`#/relatorio/${m.id}`) },
      ]);
    } else {
      c.append(h('h1', {}, 'Checkpoint concluído'), h('p', {}, 'A próxima etapa do caminho está liberada.'));
      ctx.bar.set([{ label: 'Voltar ao módulo', primary: true, onClick: () => go(`#/m/${m.id}`) }]);
    }
  }

  function renderSummary(step, ctx) {
    const c = ctx.content;
    const qs = sess.steps.map((s, i) => ({ s, i, r: sess.res[i] })).filter((x) => x.s.t === 'q');
    const correct = qs.filter((x) => x.r && x.r.correct).length;
    if (sess.kind === 'pretest') {
      SE.finishPretest(m, sess);
      c.append(h('p', { class: 'eyebrow' }, m.title), h('h1', {}, 'Ponto de partida registrado'));
      c.append(h('div', { class: 'gate-stats' }, stat(`${correct}/${qs.length}`, 'acertos no pré-teste', true)));
      const byUnit = {};
      for (const x of qs) {
        const q = m.q.get(x.s.id);
        if (!q) continue;
        const u = m.c.get(q.concepts[0]).unit;
        byUnit[u] = byUnit[u] || { ok: 0, n: 0 };
        byUnit[u].n++;
        if (x.r && x.r.correct) byUnit[u].ok++;
      }
      c.append(h('ul', { class: 'unit-scores' }, m.units.filter((u) => byUnit[u.id]).map((u) => h('li', {}, h('span', {}, u.short || u.title), h('strong', {}, `${byUnit[u.id].ok}/${byUnit[u.id].n}`)))));
      c.append(h('p', { class: 'muted' }, 'Esses números não importam agora. Na tela de encerramento você vai ver quanto evoluiu em cada conceito.'));
      const firstUnit = m.units[0];
      ctx.bar.set([{ label: 'Voltar ao módulo', onClick: () => go(`#/m/${m.id}`) }, { label: 'Começar a Unidade 1', primary: true, onClick: () => {
        SE.buildUnit(m, firstUnit.id);
        go(`#/s/${encodeURIComponent(`${m.id}:${firstUnit.id}`)}`);
      } }]);
      return;
    }
    SE.finishSimple(sess);
    const titles = { quick: 'Teste rápido concluído', review: 'Revisão de hoje concluída', errors: 'Revisão de erros concluída', 'unit-review': 'Revisão da unidade concluída' };
    c.append(h('h1', {}, titles[sess.kind] || 'Concluído'));
    if (qs.length) {
      c.append(h('div', { class: 'gate-stats' }, stat(`${correct}/${qs.length}`, 'acertos', correct / qs.length >= 0.8)));
      reviewList((s) => s.t === 'q', c);
    }
    ctx.bar.set([{ label: 'Voltar ao módulo', primary: true, onClick: () => go(`#/m/${m.id}`) }]);
  }

  draw();
}

export function stopTimers() {
  clearInterval(tick);
}
