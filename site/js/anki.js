// Exportação para Anki: .txt separado por tab (frente, verso, tags), com cabeçalhos que o
// importador atual do Anki/AnkiDroid reconhece.
import { S } from './store.js';
import { mastery } from './mastery.js';
import { plain } from './markup.js';

const clean = (s) => plain(s).replace(/\t/g, ' ').replace(/\r?\n/g, '<br>').trim();

export function buildAnki(m, scope = 'errors') {
  const errs = Object.values(S().errors).filter((e) => e.module === m.id);
  const errConcepts = new Set(errs.flatMap((e) => e.concepts || []));
  const concepts = m.concepts.filter((c) => {
    const st = mastery(c.id);
    if (scope === 'all') return st.n > 0;
    return errConcepts.has(c.id) || (st.n > 0 && st.status !== 'mastered');
  });
  const cards = [];
  for (const c of concepts) {
    const tag = `usmle::${m.subject}::${m.id} ${c.id.replace(/[^\w.-]/g, '_')}`;
    for (const a of c.anki || []) cards.push([clean(a.front), clean(a.back), tag]);
    const r = c.rule && m.r.get(c.rule);
    if (r) cards.push([clean(`Regra lógica — ${c.name}: qual é o princípio?`), clean(r.text), tag]);
  }
  const header = ['#separator:tab', '#html:true', '#tags column:3', `#deck:USMLE Step 1::${m.title}`];
  const text = header.join('\n') + '\n' + cards.map((r) => r.join('\t')).join('\n') + '\n';
  return { text, cards, concepts };
}
