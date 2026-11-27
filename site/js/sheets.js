// Folhas de apoio: glossário EN↔PT e valores laboratoriais de referência.
import { h, sheet } from './ui.js';
import { md, termKey } from './markup.js';
import { C } from './content.js';

export function openTerm(key) {
  const g = C.glossary.get(termKey(key));
  if (!g) return;
  const body = h('div', { class: 'gloss-entry' },
    h('div', { class: 'gloss-pair' },
      h('div', {}, h('span', { class: 'gloss-lang' }, 'EN'), h('strong', { lang: 'en' }, g.en)),
      h('div', {}, h('span', { class: 'gloss-lang' }, 'PT'), h('strong', {}, g.pt))),
    g.def ? h('div', { class: 'prose', html: md(g.def) }) : null,
    h('a', { class: 'link-btn', href: '#/glossario' }, 'Abrir glossário completo →'));
  sheet('Glossário', body);
}

export function glossaryList(filter = '') {
  const seen = new Set();
  const all = [];
  for (const g of C.glossary.values()) {
    if (seen.has(g)) continue;
    seen.add(g);
    all.push(g);
  }
  const f = termKey(filter);
  return all
    .filter((g) => !f || termKey(g.en).includes(f) || termKey(g.pt).includes(f) || termKey(g.def || '').includes(f))
    .sort((a, b) => a.en.localeCompare(b.en));
}

export function labsContent() {
  const labs = C.labs;
  const wrap = h('div', { class: 'labs' });
  if (!labs) return wrap;
  if (labs.note) wrap.append(h('p', { class: 'muted small' }, labs.note));
  for (const sec of labs.sections) {
    const tbl = h('table', { class: 'labs-table' },
      h('thead', {}, h('tr', {}, h('th', {}, sec.title), h('th', {}, 'Referência'), h('th', {}, 'SI'))),
      h('tbody', {}, sec.rows.map((r) => h('tr', {}, h('td', { lang: 'en' }, r[0]), h('td', {}, r[1]), h('td', {}, r[2] || '')))));
    wrap.append(tbl);
  }
  return wrap;
}

export function openLabs() {
  sheet('Valores de referência', labsContent(), { wide: true });
}
