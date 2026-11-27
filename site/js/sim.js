// Simulador genérico de bloqueio enzimático, configurado por dados (module.pathways).
// Uma via = nós (metabólitos, em grade col/row) + arestas (reações). Arestas com "blockable"
// podem ser bloqueadas; o efeito vem de "blocks[edgeId]" ou é calculado pelo grafo:
//   acumula = substrato da etapa; falta = o que só é alcançado passando por ela;
//   desvia = arestas laterais ("side") que saem do que acumulou.
import { h } from './ui.js';
import { md, mdInline, esc } from './markup.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 360;
const ROW_H = 86;
const NODE_H = 48;
const PAD = 10;

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

function wrapLabel(label, max = 15) {
  const words = String(label).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

export function computeEffects(pw, edgeId) {
  const edge = pw.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const cfg = (pw.blocks || {})[edgeId] || {};
  const main = pw.edges.filter((e) => !e.side);
  const sources = pw.nodes.filter((n) => !pw.edges.some((e) => e.to === n.id && !e.side)).map((n) => n.id);
  const reach = (starts, skip) => {
    const seen = new Set(starts);
    const stack = [...starts];
    while (stack.length) {
      const cur = stack.pop();
      for (const e of main) {
        if (e.from === cur && e.id !== skip && !seen.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    return seen;
  };
  const downstream = reach([edge.to], null);
  const alt = reach(sources.filter((x) => x !== edge.to), edgeId);
  const autoLacks = [...downstream].filter((n) => !alt.has(n));
  const accumulates = cfg.accumulates || [edge.from];
  const lacks = cfg.lacks || autoLacks;
  const diverts = cfg.diverts || pw.edges.filter((e) => e.side && accumulates.includes(e.from)).map((e) => e.id);
  return { edge, cfg, accumulates, lacks, diverts };
}

export function createSim(pw, { selectable = true, onTap } = {}) {
  const rows = Math.max(...pw.nodes.map((n) => n.row)) + 1;
  const cols = pw.cols || Math.max(...pw.nodes.map((n) => n.col)) + 1;
  const colW = W / cols;
  const nodeW = colW - 14;
  const H = PAD * 2 + (rows - 1) * ROW_H + NODE_H;
  const pos = {};
  for (const n of pw.nodes) {
    const cx = colW * n.col + colW / 2 + (n.dx || 0);
    const y = PAD + n.row * ROW_H;
    pos[n.id] = { cx, cy: y + NODE_H / 2, top: y, bottom: y + NODE_H, left: cx - nodeW / 2, right: cx + nodeW / 2 };
  }

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sim-svg', role: 'img', 'aria-label': pw.title || 'Via metabólica' });
  const defs = s('defs');
  for (const [id, cls] of [['arrow', 'arrow'], ['arrow-div', 'arrow-div'], ['arrow-side', 'arrow-side']]) {
    defs.append(
      s('marker', { id: `${pw.key}-${id}`, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
        s('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }))
    );
  }
  svg.append(defs);
  const gEdges = s('g', { class: 'edges' });
  const gNodes = s('g', { class: 'nodes' });
  const gChips = s('g', { class: 'chips' });
  svg.append(gEdges, gNodes, gChips);

  const edgeEls = {};
  const chipEls = {};
  const nodeEls = {};

  for (const e of pw.edges) {
    const a = pos[e.from];
    const b = pos[e.to];
    if (!a || !b) continue;
    const fromN = pw.nodes.find((n) => n.id === e.from);
    const toN = pw.nodes.find((n) => n.id === e.to);
    let x1, y1, x2, y2;
    if (e.side && toN.row > fromN.row && toN.col !== fromN.col) {
      // vias laterais saem pela lateral do nó, para não cruzar o rótulo da via principal
      const dir = Math.sign(toN.col - fromN.col);
      x1 = dir > 0 ? a.right : a.left;
      y1 = a.cy;
      x2 = b.cx;
      y2 = b.top;
    } else if (toN.row > fromN.row) {
      const dc = Math.sign(toN.col - fromN.col);
      x1 = a.cx + dc * nodeW * 0.28;
      y1 = a.bottom;
      x2 = b.cx - dc * nodeW * 0.28;
      y2 = b.top;
    } else if (toN.row < fromN.row) {
      const dc = Math.sign(toN.col - fromN.col);
      x1 = a.cx + dc * nodeW * 0.28;
      y1 = a.top;
      x2 = b.cx - dc * nodeW * 0.28;
      y2 = b.bottom;
    } else {
      const dir = Math.sign(toN.col - fromN.col) || 1;
      x1 = dir > 0 ? a.right : a.left;
      x2 = dir > 0 ? b.left : b.right;
      y1 = y2 = a.cy;
    }
    // encurta um pouco para a ponta da seta não encostar no nó
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    x2 -= ux * 3;
    y2 -= uy * 3;
    const line = s('line', {
      x1, y1, x2, y2,
      class: 'edge' + (e.side ? ' side' : ''),
      'marker-end': `url(#${pw.key}-${e.side ? 'arrow-side' : 'arrow'})`,
      'data-edge': e.id || '',
    });
    gEdges.append(line);
    if (e.id) edgeEls[e.id] = line;
    const mx = (x1 + x2) / 2 + (e.labelDx || 0);
    const my = (y1 + y2) / 2 + (e.labelDy || 0);
    if (e.enzyme) {
      const text = e.short || e.enzyme;
      const tw = Math.min(text.length * 6.1 + 18, colW * 1.9);
      const g = s('g', { class: 'chip' + (e.blockable ? ' blockable' : ''), 'data-edge': e.id, transform: `translate(${mx},${my})` });
      g.append(s('rect', { x: -tw / 2 - 4, y: -20, width: tw + 8, height: 40, class: 'chip-hit' }));
      g.append(s('rect', { x: -tw / 2, y: -12, width: tw, height: 24, rx: 12, class: 'chip-bg' }));
      const t = s('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'chip-text' });
      t.textContent = (e.blockable ? '✂ ' : '') + text;
      g.append(t);
      if (e.blockable) {
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', `Bloquear ${text}`);
        g.addEventListener('click', () => selectable && onTap && onTap(e.id));
        g.addEventListener('keydown', (ev) => {
          if ((ev.key === 'Enter' || ev.key === ' ') && selectable && onTap) {
            ev.preventDefault();
            onTap(e.id);
          }
        });
      }
      gChips.append(g);
      chipEls[e.id] = g;
    } else if (e.label) {
      const t = s('text', { x: mx + 4, y: my - 4, class: 'edge-label', 'text-anchor': 'middle' });
      t.textContent = e.label;
      gChips.append(t);
    }
  }

  for (const n of pw.nodes) {
    const p = pos[n.id];
    const g = s('g', { class: 'node' + (n.kind ? ' ' + n.kind : '') + (pw.edges.some((e) => e.side && e.to === n.id) ? ' side-target' : ''), 'data-node': n.id });
    g.append(s('rect', { x: p.left, y: p.top, width: nodeW, height: NODE_H, rx: 10, class: 'node-bg' }));
    const lines = wrapLabel(n.label, Math.floor(nodeW / 7.2));
    const t = s('text', { x: p.cx, y: p.cy - ((lines.length - 1) * 13) / 2 + 4, 'text-anchor': 'middle', class: 'node-text' });
    lines.forEach((ln, i) => {
      const ts = s('tspan', { x: p.cx, dy: i === 0 ? 0 : 13 });
      ts.textContent = ln;
      t.append(ts);
    });
    g.append(t);
    const badge = s('text', { x: p.right - 8, y: p.top + 13, 'text-anchor': 'end', class: 'node-badge' });
    g.append(badge);
    gNodes.append(g);
    nodeEls[n.id] = { g, badge };
  }

  const el = h('div', { class: 'sim' });
  el.append(svg);

  const api = {
    el,
    blocked: null,
    selected: null,
    selectable,
    clear() {
      api.blocked = null;
      svg.querySelectorAll('.acc,.lack,.div,.blocked,.selected,.correct-pick,.wrong-pick').forEach((x) => x.classList.remove('acc', 'lack', 'div', 'blocked', 'selected', 'correct-pick', 'wrong-pick'));
      Object.values(nodeEls).forEach((n) => (n.badge.textContent = ''));
      gEdges.querySelectorAll('.side').forEach((l) => l.setAttribute('marker-end', `url(#${pw.key}-arrow-side)`));
    },
    select(edgeId) {
      Object.values(chipEls).forEach((c) => c.classList.remove('selected'));
      api.selected = edgeId;
      if (edgeId && chipEls[edgeId]) chipEls[edgeId].classList.add('selected');
    },
    mark(edgeId, cls) {
      if (chipEls[edgeId]) chipEls[edgeId].classList.add(cls);
    },
    block(edgeId) {
      api.clear();
      const fx = computeEffects(pw, edgeId);
      if (!fx) return null;
      api.blocked = edgeId;
      if (edgeEls[edgeId]) edgeEls[edgeId].classList.add('blocked');
      if (chipEls[edgeId]) chipEls[edgeId].classList.add('blocked');
      for (const id of fx.accumulates) if (nodeEls[id]) {
        nodeEls[id].g.classList.add('acc');
        nodeEls[id].badge.textContent = '↑';
      }
      for (const id of fx.lacks) if (nodeEls[id]) {
        nodeEls[id].g.classList.add('lack');
        nodeEls[id].badge.textContent = '↓';
      }
      for (const eid of fx.diverts) {
        const e = pw.edges.find((x) => x.id === eid);
        if (edgeEls[eid]) {
          edgeEls[eid].classList.add('div');
          edgeEls[eid].setAttribute('marker-end', `url(#${pw.key}-arrow-div)`);
        }
        if (e && nodeEls[e.to]) {
          nodeEls[e.to].g.classList.add('div');
          nodeEls[e.to].badge.textContent = '↑';
        }
      }
      return fx;
    },
  };
  return api;
}

const label = (pw, id) => (pw.nodes.find((n) => n.id === id) || {}).label || id;

export function effectsPanel(pw, edgeId, m) {
  const fx = computeEffects(pw, edgeId);
  if (!fx) return h('div');
  const cfg = fx.cfg;
  const chips = (ids, cls) => h('div', { class: 'chips-row' }, ids.map((id) => h('span', { class: 'chip-tag ' + cls }, label(pw, id))));
  const divTargets = fx.diverts.map((eid) => {
    const e = pw.edges.find((x) => x.id === eid);
    return e ? label(pw, e.to) + (e.label ? ` (${e.label})` : '') : eid;
  });
  const rule = cfg.rule && m && m.r.get(cfg.rule);
  const panel = h('div', { class: 'fx-panel' },
    h('h4', {}, 'Bloqueio: ', h('span', { html: mdInline(fx.edge.enzyme, { terms: false }) })),
    h('div', { class: 'fx-row' }, h('span', { class: 'fx-k acc' }, '↑ Acumula'), chips(fx.accumulates, 'acc')),
    h('div', { class: 'fx-row' }, h('span', { class: 'fx-k lack' }, '↓ Falta'), fx.lacks.length ? chips(fx.lacks, 'lack') : h('span', { class: 'muted' }, 'nada essencial — há rota alternativa')),
    h('div', { class: 'fx-row' }, h('span', { class: 'fx-k div' }, '↪ Desvia para'), divTargets.length ? h('div', { class: 'chips-row' }, divTargets.map((t) => h('span', { class: 'chip-tag div' }, t))) : h('span', { class: 'muted' }, 'sem via lateral relevante')),
  );
  if (cfg.note) panel.append(h('div', { class: 'fx-note', html: md(cfg.note) }));
  if (cfg.clinical) panel.append(h('div', { class: 'fx-block' }, h('strong', {}, 'Quadro clínico'), h('div', { html: md(cfg.clinical) })));
  if (cfg.labs) panel.append(h('div', { class: 'fx-block' }, h('strong', {}, 'Laboratório'), h('div', { html: md(cfg.labs) })));
  if (cfg.disease) panel.append(h('div', { class: 'fx-block' }, h('strong', {}, 'Exemplo'), h('div', { html: md(cfg.disease) })));
  if (rule) panel.append(h('div', { class: 'rule-box small' }, h('span', { class: 'rule-n' }, `Regra ${rule.n}`), h('span', { html: mdInline(rule.text) })));
  return panel;
}

export function blockableEdges(pw) {
  return pw.edges.filter((e) => e.blockable);
}

export { esc };
