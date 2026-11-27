// Inicialização: carrega progresso e conteúdo, roteador por hash, glossário por toque e service worker.
import { load, requestPersistence } from './store.js';
import { loadAll } from './content.js';
import { render, applySettings } from './pages.js';
import { openTerm } from './sheets.js';
import { h, toast, clear } from './ui.js';

load();
applySettings();

document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('.term');
  if (t) {
    e.preventDefault();
    e.stopPropagation();
    openTerm(t.dataset.term);
  }
});

async function boot() {
  const root = document.getElementById('app');
  clear(root).append(h('div', { class: 'loading' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, 'Carregando…')));
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    clear(root).append(h('div', { class: 'content' }, h('h1', {}, 'Não consegui carregar o conteúdo'), h('p', {}, 'Verifique a conexão e tente de novo. Se já abriu o site antes, ele também funciona offline.'), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Tentar de novo')));
    return;
  }
  window.addEventListener('hashchange', render);
  render();
  requestPersistence();
  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const ask = (worker) => {
      toast('Nova versão do curso disponível.', {
        label: 'Atualizar',
        timeout: 0,
        action: () => worker.postMessage('skipWaiting'),
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

boot();
