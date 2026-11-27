// Renderizadores das telas interativas: cartão, múltipla escolha (NBME e lição), prever→revelar,
// associar, ordenar, completar lacuna, cartão de virar e simulador de bloqueio.
import { h, shuffle, sheet } from './ui.js';
import { md, mdInline } from './markup.js';
import { CONF_LABEL } from './mastery.js';
import { createSim, effectsPanel, blockableEdges } from './sim.js';

const LETTERS = 'ABCDEFGH';

// ---------- peças comuns ----------
export function ruleBox(m, ruleId, small = false) {
  const r = ruleId && m.r.get(ruleId);
  if (!r) return null;
  return h('div', { class: 'rule-box' + (small ? ' small' : '') },
    h('span', { class: 'rule-n' }, `Regra lógica ${r.n}`),
    h('span', { html: mdInline(r.text) }));
}

export function testedLine(text) {
  if (!text) return null;
  const t = String(text).replace(/^\s*How it'?s tested:\s*/i, '');
  return h('p', { class: 'tested', lang: 'en' }, h('strong', {}, "How it's tested: "), h('span', { html: mdInline(t) }));
}

function banner(result) {
  const ok = result.correct;
  const el = h('div', { class: 'banner ' + (ok ? 'ok' : 'bad') },
    h('span', { class: 'banner-icon', 'aria-hidden': 'true' }, ok ? '✓' : '✗'),
    h('span', {}, ok ? 'Correto' : 'Incorreto'),
    result.conf ? h('span', { class: 'banner-conf' }, '· ' + CONF_LABEL[result.conf]) : null);
  return el;
}

function confNotes(result) {
  if (result.correct && result.conf === 'chute') {
    return h('p', { class: 'note warn' }, 'Acerto no chute não conta como domínio. Este conceito vai voltar com outra questão.');
  }
  if (!result.correct && result.conf === 'certeza') {
    return h('p', { class: 'note info' }, 'Erro com Certeza: leia o mecanismo com calma — erros confiantes, quando corrigidos, costumam ser os que mais se fixam.');
  }
  return null;
}

function cardButton(ctx, cardId) {
  if (!cardId || !ctx.openCard) return null;
  return h('button', { class: 'link-btn', onclick: () => ctx.openCard(cardId) }, '↩ Rever o cartão da lição');
}

function confBar(ctx, onPick, enabled) {
  const wrap = h('div', { class: 'conf-bar' }, h('span', { class: 'conf-label' }, enabled ? 'Sua confiança?' : 'Escolha uma alternativa'));
  const row = h('div', { class: 'conf-row' });
  for (const [k, label] of [['certeza', 'Certeza'], ['duvida', 'Dúvida'], ['chute', 'Chute']]) {
    row.append(h('button', { class: 'btn conf conf-' + k, disabled: !enabled, onclick: () => onPick(k) }, label));
  }
  wrap.append(row);
  ctx.bar.set([wrap]);
}

function continueBar(ctx, label = 'Continuar') {
  ctx.bar.set([{ label, primary: true, onClick: () => ctx.next() }]);
}

function scrollIntoViewSoon(el) {
  requestAnimationFrame(() => {
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      el.scrollIntoView();
    }
  });
}

// ---------- cartão ----------
export function renderCard(card, ctx) {
  const art = h('article', { class: 'card-lesson' },
    card.title ? h('h2', { html: mdInline(card.title) }) : null,
    h('div', { class: 'prose', html: md(card.body) }));
  if (card.pathway && ctx.m.pathways[card.pathway]) {
    const sim = createSim(ctx.m.pathways[card.pathway], { selectable: false });
    art.append(sim.el);
  }
  ctx.content.append(art);
  if (ctx.mode !== 'sheet') continueBar(ctx);
}

// ---------- múltipla escolha (NBME e perguntas da lição) ----------
export function renderMCQ(item, ctx, hooks = {}) {
  const { content, mode } = ctx;
  const nbme = item.kind === 'nbme';
  const askConf = mode !== 'review' && item.conf !== false && item.role !== 'hook';
  const order = ctx.order || item.options.map((_, i) => i);
  const root = h('div', { class: 'mcq' + (nbme ? ' nbme' : '') });
  if (nbme && mode !== 'exam' && mode !== 'pre') root.append(h('div', { class: 'q-meta' }, `Nível ${item.level}`));
  if (item.prompt) root.append(h('div', { class: 'prompt prose', html: md(item.prompt) }));
  if (item.stem) root.append(h('div', { class: 'stem prose', lang: nbme ? 'en' : null, html: md(item.stem) }));
  if (item.question) root.append(h('p', { class: 'question', lang: nbme ? 'en' : null, html: mdInline(item.question, { terms: false }) }));
  if (hooks.beforeOptions) hooks.beforeOptions(root);

  const list = h('div', { class: 'options', role: 'radiogroup' });
  const btns = [];
  let selected = null;
  order.forEach((oi, pos) => {
    const o = item.options[oi];
    const b = h('button', {
      class: 'opt',
      role: 'radio',
      'aria-checked': 'false',
      lang: nbme ? 'en' : null,
      onclick: () => {
        if (root.classList.contains('answered')) return;
        selected = oi;
        btns.forEach((x) => {
          x.el.classList.toggle('sel', x.oi === oi);
          x.el.setAttribute('aria-checked', x.oi === oi ? 'true' : 'false');
        });
        if (askConf) confBar(ctx, submit, true);
        else ctx.bar.set([{ label: 'Confirmar', primary: true, onClick: () => submit(null) }]);
      },
    }, h('span', { class: 'letter' }, LETTERS[pos]), h('span', { class: 'opt-text', html: mdInline(o.text, { terms: false }) }));
    btns.push({ el: b, oi, pos });
    list.append(b);
  });
  root.append(list);
  content.append(root);

  const fbHost = h('div', { class: 'fb-host' });
  root.append(fbHost);

  function showAnswered(result, { scroll = true } = {}) {
    root.classList.add('answered');
    btns.forEach((x) => {
      const o = item.options[x.oi];
      x.el.disabled = true;
      if (mode === 'exam') {
        x.el.classList.toggle('sel', x.oi === result.choice);
        return;
      }
      if (o.correct) x.el.classList.add('correct');
      if (x.oi === result.choice && !o.correct) x.el.classList.add('wrong');
      if (x.oi === result.choice) x.el.classList.add('sel');
    });
    if (mode === 'exam') {
      continueBar(ctx, 'Próxima');
      return;
    }
    const fb = h('div', { class: 'feedback' });
    if (result.skipped) fb.append(h('div', { class: 'banner bad' }, '⏱ Sem resposta (tempo esgotado)'));
    else fb.append(banner(result));
    const correctIdx = item.options.findIndex((o) => o.correct);
    const correctPos = order.indexOf(correctIdx);
    if (mode === 'pre') {
      fb.append(h('p', {}, 'Resposta correta: ', h('strong', {}, `${LETTERS[correctPos]}. `), h('span', { html: mdInline(item.options[correctIdx].text, { terms: false }) })));
      fb.append(h('p', { class: 'muted' }, 'No pré-teste não há comentário: ele só mede seu ponto de partida. Tudo isso será ensinado no módulo.'));
    } else if (nbme) {
      const cn = confNotes(result);
      if (cn) fb.append(cn);
      fb.append(h('h3', { class: 'fb-h' }, 'Resposta correta: ', h('span', { lang: 'en', html: `${LETTERS[correctPos]}. ` + mdInline(item.options[correctIdx].text, { terms: false }) })));
      fb.append(h('div', { class: 'fb-sec' }, h('h4', {}, 'Por que está correta'), h('div', { class: 'prose', html: md(item.options[correctIdx].why) })));
      const wrongs = h('div', { class: 'fb-sec' }, h('h4', {}, 'Por que as outras estão erradas'));
      order.forEach((oi, pos) => {
        const o = item.options[oi];
        if (o.correct) return;
        wrongs.append(h('div', { class: 'why-wrong' + (oi === result.choice ? ' chosen' : '') },
          h('div', { class: 'ww-head', lang: 'en' }, h('span', { class: 'letter sm' }, LETTERS[pos]), h('span', { html: mdInline(o.text, { terms: false }) }), oi === result.choice ? h('span', { class: 'pill' }, 'sua resposta') : null),
          h('div', { class: 'prose', html: md(o.why) }),
          o.wouldBe ? h('p', { class: 'would' }, h('strong', {}, 'Seria a resposta se: '), h('span', { html: mdInline(o.wouldBe) })) : null));
      });
      fb.append(wrongs);
      fb.append(ruleBox(ctx.m, item.rule));
      fb.append(testedLine(item.tested));
      fb.append(cardButton(ctx, item.card));
    } else {
      const cn = confNotes(result);
      if (cn) fb.append(cn);
      if (item.reveal) fb.append(h('div', { class: 'prose', html: md(item.reveal) }));
      const chosen = item.options[result.choice];
      if (chosen && !chosen.correct && chosen.why) fb.append(h('p', { class: 'note' }, h('strong', {}, 'Sobre a sua escolha: '), h('span', { html: mdInline(chosen.why) })));
      if (hooks.afterReveal) hooks.afterReveal(fb, result);
      fb.append(ruleBox(ctx.m, item.rule));
      fb.append(testedLine(item.tested));
      fb.append(cardButton(ctx, item.card));
    }
    fbHost.append(fb);
    if (mode !== 'review') continueBar(ctx);
    if (scroll && mode !== 'review') scrollIntoViewSoon(fb);
  }

  function submit(conf) {
    if (selected == null) return;
    const result = { choice: selected, correct: !!item.options[selected].correct, conf };
    ctx.answer(result);
    if (mode === 'exam') {
      ctx.next();
      return;
    }
    showAnswered(result);
  }

  if (ctx.result) {
    showAnswered(ctx.result, { scroll: false });
  } else if (mode !== 'review') {
    if (askConf) confBar(ctx, submit, false);
    else ctx.bar.set([{ label: 'Confirmar', primary: true, disabled: true }]);
  }
  return root;
}

// ---------- associar pares ----------
export function renderMatch(item, ctx) {
  const rows = item.rows;
  const k = rows[0].length;
  const headers = item.headers || [];
  const filled = rows.map(() => Array(k).fill(null));
  let active = null;
  const root = h('div', { class: 'match' });
  if (item.prompt) root.append(h('div', { class: 'prompt prose', html: md(item.prompt) }));
  const grid = h('div', { class: 'match-grid' });
  const pool = h('div', { class: 'pool' });
  root.append(grid, pool);
  ctx.content.append(root);
  const fbHost = h('div', { class: 'fb-host' });
  root.append(fbHost);
  const slots = [];
  const order = ctx.order && ctx.order.length === rows.length ? ctx.order : rows.map((_, i) => i);
  // pools embaralhados por coluna (determinísticos para retomar)
  const pools = {};
  for (let c = 1; c < k; c++) pools[c] = shuffle(rows.map((r) => r[c]));

  order.forEach((r) => {
    const row = h('div', { class: 'match-row' }, h('div', { class: 'anchor', html: mdInline(rows[r][0], { terms: false }) }));
    for (let c = 1; c < k; c++) {
      const b = h('button', { class: 'slot', onclick: () => tapSlot(r, c) }, h('span', { class: 'slot-h' }, headers[c] || ''), h('span', { class: 'slot-v' }, 'toque para escolher'));
      slots.push({ r, c, el: b });
      row.append(b);
    }
    grid.append(row);
  });

  function remaining(c) {
    const used = rows.map((_, r) => filled[r][c]).filter((v) => v != null);
    const left = pools[c].slice();
    for (const u of used) {
      const i = left.indexOf(u);
      if (i >= 0) left.splice(i, 1);
    }
    return left;
  }

  function nextEmpty() {
    for (const s of slots) if (filled[s.r][s.c] == null) return { r: s.r, c: s.c };
    return null;
  }

  function draw() {
    for (const s of slots) {
      const v = filled[s.r][s.c];
      s.el.querySelector('.slot-v').innerHTML = v ? mdInline(v, { terms: false }) : 'toque para escolher';
      s.el.classList.toggle('filled', v != null);
      s.el.classList.toggle('active', !!active && active.r === s.r && active.c === s.c);
    }
    pool.innerHTML = '';
    if (root.classList.contains('answered')) return;
    if (active) {
      const label = headers[active.c] ? `Escolha: ${headers[active.c]}` : 'Escolha';
      pool.append(h('div', { class: 'pool-h' }, label, ' para ', h('strong', { html: mdInline(rows[active.r][0], { terms: false }) })));
      const chips = h('div', { class: 'pool-chips' });
      remaining(active.c).forEach((v) => chips.append(h('button', { class: 'chip-btn', onclick: () => pick(v) , html: mdInline(v, { terms: false }) })));
      pool.append(chips);
    }
    const complete = !nextEmpty();
    ctx.bar.set([{ label: 'Verificar', primary: true, disabled: !complete, onClick: check }]);
  }

  function tapSlot(r, c) {
    if (root.classList.contains('answered')) return;
    if (filled[r][c] != null) filled[r][c] = null;
    active = { r, c };
    draw();
  }

  function pick(v) {
    if (!active) return;
    filled[active.r][active.c] = v;
    active = nextEmpty();
    draw();
  }

  function showAnswered(result) {
    root.classList.add('answered');
    active = null;
    pool.innerHTML = '';
    for (const s of slots) {
      const v = result.filled[s.r][s.c];
      const ok = v === rows[s.r][s.c];
      s.el.disabled = true;
      s.el.classList.add(ok ? 'ok' : 'bad');
      s.el.querySelector('.slot-v').innerHTML = mdInline(v || '—', { terms: false }) + (ok ? '' : `<span class="fix">✓ ${mdInline(rows[s.r][s.c], { terms: false })}</span>`);
    }
    const fb = h('div', { class: 'feedback' }, banner(result));
    if (item.explanation) fb.append(h('div', { class: 'prose', html: md(item.explanation) }));
    fb.append(ruleBox(ctx.m, item.rule));
    fb.append(testedLine(item.tested));
    fbHost.append(fb);
    if (ctx.mode !== 'review') {
      continueBar(ctx);
      scrollIntoViewSoon(fb);
    }
  }

  function check() {
    const ok = slots.every((s) => filled[s.r][s.c] === rows[s.r][s.c]);
    const result = { correct: ok, filled: filled.map((r) => r.slice()) };
    ctx.answer(result);
    showAnswered(result);
  }

  if (ctx.result) showAnswered(ctx.result);
  else {
    active = nextEmpty();
    draw();
  }
}

// ---------- ordenar (tocar em sequência) ----------
export function renderOrder(item, ctx) {
  const n = item.items.length;
  let pool = ctx.order && ctx.order.length === n ? ctx.order.slice() : shuffle([...Array(n).keys()]);
  const seq = [];
  const root = h('div', { class: 'order' });
  if (item.prompt) root.append(h('div', { class: 'prompt prose', html: md(item.prompt) }));
  root.append(h('p', { class: 'hint' }, 'Toque nas etapas na ordem certa. Toque numa etapa já colocada para devolvê-la.'));
  const seqEl = h('ol', { class: 'seq' });
  const poolEl = h('div', { class: 'pool-chips' });
  root.append(seqEl, h('div', { class: 'pool' }, poolEl));
  const fbHost = h('div', { class: 'fb-host' });
  root.append(fbHost);
  ctx.content.append(root);

  function draw() {
    seqEl.innerHTML = '';
    seq.forEach((i, pos) => seqEl.append(h('li', {}, h('button', { class: 'seq-item', onclick: () => remove(pos) }, h('span', { class: 'seq-n' }, pos + 1), h('span', { html: mdInline(item.items[i], { terms: false }) })))));
    for (let p = seq.length; p < n; p++) seqEl.append(h('li', { class: 'empty' }, h('span', { class: 'seq-n' }, p + 1), h('span', { class: 'muted' }, '…')));
    poolEl.innerHTML = '';
    pool.filter((i) => !seq.includes(i)).forEach((i) => poolEl.append(h('button', { class: 'chip-btn', onclick: () => add(i), html: mdInline(item.items[i], { terms: false }) })));
    ctx.bar.set([
      { label: 'Limpar', onClick: () => { seq.length = 0; draw(); }, disabled: !seq.length },
      { label: 'Verificar', primary: true, disabled: seq.length !== n, onClick: check },
    ]);
  }
  function add(i) {
    seq.push(i);
    draw();
  }
  function remove(pos) {
    seq.splice(pos, 1);
    draw();
  }
  function showAnswered(result) {
    root.classList.add('answered');
    poolEl.innerHTML = '';
    seqEl.innerHTML = '';
    result.seq.forEach((i, pos) => seqEl.append(h('li', { class: i === pos ? 'ok' : 'bad' }, h('span', { class: 'seq-n' }, pos + 1), h('span', { html: mdInline(item.items[i], { terms: false }) }))));
    const fb = h('div', { class: 'feedback' }, banner(result));
    if (!result.correct) {
      fb.append(h('h4', {}, 'Ordem correta'), h('ol', { class: 'seq correct' }, item.items.map((t) => h('li', { html: mdInline(t, { terms: false }) }))));
    }
    if (item.explanation) fb.append(h('div', { class: 'prose', html: md(item.explanation) }));
    fb.append(ruleBox(ctx.m, item.rule));
    fb.append(testedLine(item.tested));
    fbHost.append(fb);
    if (ctx.mode !== 'review') {
      continueBar(ctx);
      scrollIntoViewSoon(fb);
    }
  }
  function check() {
    const result = { correct: seq.every((v, i) => v === i), seq: seq.slice() };
    ctx.answer(result);
    showAnswered(result);
  }
  if (ctx.result) showAnswered(ctx.result);
  else draw();
}

// ---------- completar lacuna (tolerante a variações de escrita) ----------
const GREEK = { α: 'alfa', β: 'beta', γ: 'gama', δ: 'delta', alpha: 'alfa', gamma: 'gama' };
export function normalize(s) {
  let t = String(s || '').toLowerCase().trim();
  t = t.replace(/[αβγδ]/g, (c) => GREEK[c]).replace(/\balpha\b/g, 'alfa').replace(/\bgamma\b/g, 'gama');
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 8320)).replace(/[⁰¹²³⁴-⁹]/g, (c) => ({ '⁰': '0', '¹': '1', '²': '2', '³': '3' }[c] ?? String(c.charCodeAt(0) - 8304)));
  t = t.replace(/[\s\-–—_.,;:'"()/+⁺]/g, '');
  return t;
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

export function accepts(input, answers) {
  const x = normalize(input);
  if (!x) return false;
  for (const ans of answers) {
    const y = normalize(ans);
    if (x === y) return true;
    const dx = x.replace(/\D/g, '');
    const dy = y.replace(/\D/g, '');
    if (dx !== dy) continue; // números precisam bater exatamente (GLUT1 ≠ GLUT4)
    const tol = y.length >= 10 ? 2 : y.length >= 5 ? 1 : 0;
    if (tol && lev(x, y) <= tol) return true;
  }
  return false;
}

export function parseCloze(text) {
  const parts = [];
  let last = 0;
  const re = /\{\{([^}]+)\}\}/g;
  let mm;
  while ((mm = re.exec(text))) {
    if (mm.index > last) parts.push({ text: text.slice(last, mm.index) });
    parts.push({ answers: mm[1].split('|').map((s) => s.trim()) });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function renderCloze(item, ctx) {
  const parts = parseCloze(item.text);
  const root = h('div', { class: 'cloze' });
  if (item.prompt) root.append(h('div', { class: 'prompt prose', html: md(item.prompt) }));
  const p = h('p', { class: 'cloze-text' });
  const inputs = [];
  parts.forEach((part) => {
    if (part.text != null) p.append(h('span', { html: mdInline(part.text) }));
    else {
      const w = Math.max(6, Math.min(22, part.answers[0].length + 2));
      const inp = h('input', { class: 'blank', type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', style: { width: w + 'ch' }, 'aria-label': 'Lacuna' });
      inp.addEventListener('input', update);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const i = inputs.findIndex((x) => x.el === inp);
          if (inputs[i + 1]) inputs[i + 1].el.focus();
          else if (inputs.every((x) => x.el.value.trim())) check();
        }
      });
      inputs.push({ el: inp, answers: part.answers });
      p.append(inp);
    }
  });
  root.append(p);
  const fbHost = h('div', { class: 'fb-host' });
  root.append(fbHost);
  ctx.content.append(root);

  function update() {
    ctx.bar.set([{ label: 'Verificar', primary: true, disabled: !inputs.every((x) => x.el.value.trim()), onClick: check }]);
  }
  function showAnswered(result) {
    root.classList.add('answered');
    inputs.forEach((x, i) => {
      x.el.value = result.values[i];
      x.el.disabled = true;
      const ok = result.ok[i];
      x.el.classList.add(ok ? 'ok' : 'bad');
      if (!ok) x.el.after(h('span', { class: 'fix' }, ' ✓ ' + x.answers[0]));
    });
    const fb = h('div', { class: 'feedback' }, banner(result));
    if (item.explanation) fb.append(h('div', { class: 'prose', html: md(item.explanation) }));
    fb.append(ruleBox(ctx.m, item.rule));
    fb.append(testedLine(item.tested));
    fbHost.append(fb);
    if (ctx.mode !== 'review') {
      continueBar(ctx);
      scrollIntoViewSoon(fb);
    }
  }
  function check() {
    const values = inputs.map((x) => x.el.value);
    const ok = inputs.map((x) => accepts(x.el.value, x.answers));
    const result = { correct: ok.every(Boolean), values, ok };
    ctx.answer(result);
    showAnswered(result);
  }
  if (ctx.result) showAnswered(ctx.result);
  else update();
}

// ---------- cartão de virar (recordação rápida) ----------
export function renderFlip(item, ctx) {
  const rule = item.rule && ctx.m.r.get(item.rule);
  const back = item.back || (rule ? rule.text : '');
  const card = h('button', { class: 'flip', 'aria-label': 'Virar cartão' },
    h('div', { class: 'flip-inner' },
      h('div', { class: 'flip-face front' }, h('span', { class: 'flip-tag' }, rule ? `Regra ${rule.n}` : 'Recordação'), h('div', { class: 'prose', html: md(item.front) }), h('span', { class: 'flip-hint' }, 'Tente lembrar · toque para virar')),
      h('div', { class: 'flip-face back' }, h('span', { class: 'flip-tag' }, 'Resposta'), h('div', { class: 'prose', html: md(back) }))));
  ctx.content.append(h('p', { class: 'hint' }, 'Recordação rápida: responda mentalmente antes de virar.'), card);
  let flipped = false;
  const flip = () => {
    flipped = !flipped;
    card.classList.toggle('flipped', flipped);
    if (flipped && !ctx.result) {
      ctx.bar.set([
        { label: 'Não lembrei', cls: 'btn-bad', onClick: () => done(false) },
        { label: 'Lembrei', primary: true, onClick: () => done(true) },
      ]);
    }
  };
  card.addEventListener('click', flip);
  function done(ok) {
    ctx.answer({ correct: ok, self: true });
    ctx.next();
  }
  if (ctx.result) {
    card.classList.add('flipped');
    flipped = true;
    continueBar(ctx);
  } else ctx.bar.set([{ label: 'Virar', primary: true, onClick: flip }]);
}

// ---------- simulador de bloqueio ----------
export function renderSim(item, ctx) {
  const pw = ctx.m.pathways[item.pathway];
  if (!pw) {
    ctx.content.append(h('p', {}, 'Via não encontrada: ' + item.pathway));
    continueBar(ctx);
    return;
  }
  const mode = item.mode || 'explore';
  if (mode === 'predict') return simPredict(item, pw, ctx);
  if (mode === 'challenge') return simChallenge(item, pw, ctx);
  return simExplore(item, pw, ctx);
}

function enzymeButtons(pw, onTap) {
  return h('div', { class: 'enz-list' },
    h('div', { class: 'enz-h' }, 'Etapas que você pode bloquear:'),
    h('div', { class: 'enz-btns' }, blockableEdges(pw).map((e) => h('button', { class: 'chip-btn enz', 'data-edge': e.id, onclick: () => onTap(e.id), html: '✂ ' + mdInline(e.enzyme, { terms: false }) }))));
}

function simExplore(item, pw, ctx) {
  if (item.prompt) ctx.content.append(h('div', { class: 'prompt prose', html: md(item.prompt) }));
  const panelHost = h('div', { class: 'fx-host' });
  let sim;
  const tap = (id) => {
    if (sim.blocked === id) {
      sim.clear();
      panelHost.innerHTML = '';
      highlight(null);
      return;
    }
    sim.block(id);
    panelHost.innerHTML = '';
    panelHost.append(effectsPanel(pw, id, ctx.m));
    highlight(id);
  };
  sim = createSim(pw, { selectable: true, onTap: tap });
  const btns = enzymeButtons(pw, tap);
  const highlight = (id) => btns.querySelectorAll('.enz').forEach((b) => b.classList.toggle('on', b.dataset.edge === id));
  ctx.content.append(h('div', { class: 'sim-wrap' }, sim.el), btns, panelHost);
  continueBar(ctx);
}

function simPredict(item, pw, ctx) {
  const sim = createSim(pw, { selectable: false });
  sim.mark(item.block, 'target');
  renderMCQ({ ...item, kind: 'lesson' }, ctx, {
    beforeOptions: (root) => root.append(h('div', { class: 'sim-wrap' }, sim.el)),
    afterReveal: (fb) => {
      sim.block(item.block);
      fb.append(effectsPanel(pw, item.block, ctx.m));
    },
  });
}

function simChallenge(item, pw, ctx) {
  const root = h('div', { class: 'mcq sim-challenge' });
  if (item.prompt) root.append(h('div', { class: 'prompt prose', html: md(item.prompt) }));
  let selected = null;
  const tap = (id) => {
    if (root.classList.contains('answered')) return;
    selected = id;
    sim.select(id);
    btns.querySelectorAll('.enz').forEach((b) => b.classList.toggle('on', b.dataset.edge === id));
    if (item.conf === false) ctx.bar.set([{ label: 'Confirmar', primary: true, onClick: () => submit(null) }]);
    else confBar(ctx, submit, true);
  };
  const sim = createSim(pw, { selectable: true, onTap: tap });
  const btns = enzymeButtons(pw, tap);
  root.append(h('div', { class: 'sim-wrap' }, sim.el), btns);
  const fbHost = h('div', { class: 'fb-host' });
  root.append(fbHost);
  ctx.content.append(root);

  function showAnswered(result) {
    root.classList.add('answered');
    sim.selectable = false;
    sim.block(item.answer);
    sim.mark(item.answer, 'correct-pick');
    if (!result.correct && result.choice) sim.mark(result.choice, 'wrong-pick');
    btns.querySelectorAll('.enz').forEach((b) => {
      b.disabled = true;
      b.classList.toggle('ok', b.dataset.edge === item.answer);
      b.classList.toggle('bad', !result.correct && b.dataset.edge === result.choice);
    });
    const fb = h('div', { class: 'feedback' }, banner(result));
    const cn = confNotes(result);
    if (cn) fb.append(cn);
    const ans = pw.edges.find((e) => e.id === item.answer);
    fb.append(h('p', {}, 'Resposta: ', h('strong', { html: mdInline(ans.enzyme, { terms: false }) })));
    if (item.explanation) fb.append(h('div', { class: 'prose', html: md(item.explanation) }));
    if (!result.correct && result.choice) {
      const ch = pw.edges.find((e) => e.id === result.choice);
      const cfg = (pw.blocks || {})[result.choice] || {};
      if (ch && cfg.clinical) fb.append(h('p', { class: 'note' }, h('strong', { html: `Sua escolha (${mdInline(ch.enzyme, { terms: false })}) causaria: ` }), h('span', { html: mdInline(cfg.clinical) })));
    }
    fb.append(effectsPanel(pw, item.answer, ctx.m));
    fb.append(ruleBox(ctx.m, item.rule));
    fb.append(testedLine(item.tested));
    fbHost.append(fb);
    if (ctx.mode !== 'review') {
      continueBar(ctx);
      scrollIntoViewSoon(fb);
    }
  }
  function submit(conf) {
    if (!selected) return;
    const result = { choice: selected, correct: selected === item.answer, conf };
    ctx.answer(result);
    showAnswered(result);
  }
  if (ctx.result) showAnswered(ctx.result);
  else if (item.conf === false) ctx.bar.set([{ label: 'Confirmar', primary: true, disabled: true }]);
  else confBar(ctx, submit, false);
}

// Abre um cartão da lição numa folha (usado nos comentários e na remediação).
export function openCardSheet(m, cardId) {
  const ref = m.screens.get(cardId);
  if (!ref) return;
  const content = h('div');
  renderCard(ref.screen, { m, content, mode: 'sheet', bar: { set() {} } });
  sheet(ref.screen.title ? 'Cartão da lição' : 'Lição', content);
}
