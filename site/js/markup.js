// Mini-markup usado nos arquivos de conteúdo.
//   **negrito**        _itálico_
//   [[termo]]          termo do glossário (busca por id, inglês ou português)
//   [[id|texto]]       termo do glossário com texto de exibição diferente
//   linha começando com "- " → lista com marcadores
//   linha começando com "1. " → lista numerada
//   linha em branco → novo parágrafo; quebra simples → <br>

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function termKey(s) {
  return String(s).toLowerCase().trim();
}

function inline(text, { terms = true } = {}) {
  let s = esc(text);
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, key, label) => {
    const shown = label || key;
    if (!terms) return `<strong>${shown}</strong>`;
    return `<button type="button" class="term" data-term="${esc(termKey(key))}">${shown}</button>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(“"])_([^_\n]+?)_(?=[\s.,;:!?)”"]|$)/g, '$1<em>$2</em>');
  return s;
}

export function md(text) {
  if (!text) return '';
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      const out = [];
      let list = null;
      let para = [];
      const flushPara = () => {
        if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
        para = [];
      };
      const flushList = () => {
        if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
        list = null;
      };
      for (const line of lines) {
        const ul = line.match(/^\s*[-•]\s+(.*)$/);
        const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ul || ol) {
          flushPara();
          const tag = ul ? 'ul' : 'ol';
          if (!list || list.tag !== tag) {
            flushList();
            list = { tag, items: [] };
          }
          list.items.push((ul || ol)[1]);
        } else {
          flushList();
          if (line.trim()) para.push(line);
        }
      }
      flushPara();
      flushList();
      return out.join('');
    })
    .join('');
}

// Versão em linha (sem <p>), para alternativas e títulos.
export function mdInline(text, opts) {
  return inline(text ?? '', opts);
}

// Texto puro (para contagem de palavras, exportações, Anki).
export function plain(text) {
  return String(text ?? '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, k, l) => l || k)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)_([^_\n]+?)_/g, '$1$2');
}
