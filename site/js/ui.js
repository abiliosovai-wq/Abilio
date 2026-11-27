// Utilitários de interface: criação de elementos, folhas (bottom sheets), avisos e arquivos.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let openSheets = [];
let ignorePop = 0;

// O botão "voltar" do Android/navegador fecha a folha aberta em vez de sair da tela.
window.addEventListener('popstate', () => {
  if (ignorePop > 0) {
    ignorePop--;
    return;
  }
  const top = openSheets[openSheets.length - 1];
  if (top) top({ fromHistory: true });
});

export function sheet(title, content, { onClose, wide = false } = {}) {
  const root = document.getElementById('sheet-root');
  let closed = false;
  const close = ({ fromHistory = false, keepHistory = false } = {}) => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    openSheets = openSheets.filter((s) => s !== close);
    setTimeout(() => wrap.remove(), 200);
    document.removeEventListener('keydown', onKey);
    if (!fromHistory && !keepHistory && history.state && history.state.sheet) {
      ignorePop++;
      history.back();
    }
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const body = h('div', { class: 'sheet-body' }, content);
  body.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const target = a.getAttribute('href');
    close();
    setTimeout(() => (location.hash = target), 60);
  });
  const panel = h(
    'div',
    { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Fechar' }, '✕')),
    body
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: () => close() });
  const wrap = h('div', { class: 'sheet-wrap' }, backdrop, panel);
  root.append(wrap);
  try {
    history.pushState({ sheet: true }, '');
  } catch (e) {
    /* ignora */
  }
  requestAnimationFrame(() => wrap.classList.add('open'));
  document.addEventListener('keydown', onKey);
  openSheets.push(close);
  panel.querySelector('.icon-btn').addEventListener('click', () => close());
  panel.querySelector('.icon-btn').focus({ preventScroll: true });
  return close;
}

// Ao trocar de página, fecha folhas sem mexer no histórico.
export function closeAllSheets() {
  [...openSheets].forEach((c) => c({ keepHistory: true }));
}

export function toast(msg, { action, label, timeout = 3500 } = {}) {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, msg));
  if (action) {
    el.append(
      h('button', {
        class: 'toast-btn',
        onclick: () => {
          action();
          el.remove();
        },
      }, label || 'OK')
    );
  }
  root.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function pct(x) {
  return Math.round((x || 0) * 100) + '%';
}

// Salva um arquivo: tenta o menu de compartilhar (bom no iPhone e no Android) e cai para download.
export async function saveFile(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  downloadFile(filename, blob);
  return 'downloaded';
}

export function downloadFile(filename, blobOrText, mime = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: String(r.result) });
      r.onerror = () => resolve(null);
      r.readAsText(f);
    });
    document.body.append(input);
    input.click();
  });
}
