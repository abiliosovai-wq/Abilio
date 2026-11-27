#!/usr/bin/env node
// Teste ponta a ponta (Playwright) em tamanho de celular e de tablet.
// Uso: node scripts/build.mjs && node tests/e2e.mjs [--shots pasta]
// Percorre pré-teste → Unidade 1 → portão (aprovação e reprovação com remediação), cadernos e ferramentas.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > -1 ? process.argv[shotsArg + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const M = JSON.parse(readFileSync(join(DIST, 'content/modules/bioq-carboidratos.json'), 'utf8'));
const Q = new Map(M.questions.map((q) => [q.id, q]));
const SCR = new Map(M.units.flatMap((u) => u.screens).map((s) => [s.id, s]));
const plain = (s) => String(s).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, k, l) => l || k).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const firstAnswer = (s) => s.text.match(/\{\{([^}|]+)/)[1];

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log('  ✗ ' + msg);
  } else console.log('  ✓ ' + msg);
};

async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: false });
}

async function current(page) {
  const main = page.locator('main.content[data-kind]').first();
  await main.waitFor();
  return { id: await main.getAttribute('data-step'), kind: await main.getAttribute('data-kind'), role: await main.getAttribute('data-role') };
}

async function primary(page) {
  const b = page.locator('.actionbar .btn.primary:not([disabled])').last();
  await b.waitFor({ timeout: 5000 });
  await b.click();
}

async function clickOption(page, text) {
  const opts = page.locator('.opt');
  const n = await opts.count();
  for (let i = 0; i < n; i++) {
    const t = (await opts.nth(i).locator('.opt-text').innerText()).replace(/\s+/g, ' ').trim();
    if (t === plain(text)) return opts.nth(i).click();
  }
  throw new Error('opção não encontrada: ' + text);
}

async function confirmConf(page, conf = 'certeza') {
  const c = page.locator(`.conf-${conf}:not([disabled])`);
  if (await c.count()) await c.click();
  else await primary(page);
}

// responde a tela atual; plan(id) → 'right' | 'wrong' | 'guess'
async function answerCurrent(page, plan = () => 'right', snap = () => null) {
  const { id, kind, role } = await current(page);
  const mode = plan(id, role);
  if (kind === 'q' || (kind === 'screen' && ['predict', 'mcq'].includes(SCR.get(id)?.type)) || (kind === 'screen' && SCR.get(id)?.type === 'sim' && SCR.get(id)?.mode === 'predict')) {
    const item = kind === 'q' ? Q.get(id) : SCR.get(id);
    const opt = mode === 'wrong' ? item.options.find((o) => !o.correct) : item.options.find((o) => o.correct);
    await clickOption(page, opt.text);
    await snap(id, 'sel');
    const isHook = item.role === 'hook';
    if (isHook) await primary(page);
    else await confirmConf(page, mode === 'guess' ? 'chute' : 'certeza');
    if (role === 'exam') return;
    await page.locator('.feedback').first().waitFor();
    await snap(id, 'fb');
    return primary(page);
  }
  if (kind !== 'screen') {
    await snap(id, 'view');
    return primary(page);
  }
  const s = SCR.get(id);
  switch (s.type) {
    case 'card':
      await snap(id, 'view');
      return primary(page);
    case 'match': {
      for (let guard = 0; guard < 20; guard++) {
        const head = page.locator('.pool-h strong');
        if (!(await head.count())) break;
        const anchor = (await head.innerText()).trim();
        const row = s.rows.find((r) => plain(r[0]) === anchor);
        const filledCols = await page.locator('.slot.active').evaluate((el) => [...el.parentElement.querySelectorAll('.slot')].indexOf(el) + 1);
        const want = plain(row[filledCols]);
        const chips = page.locator('.pool-chips .chip-btn');
        const n = await chips.count();
        let clicked = false;
        for (let i = 0; i < n; i++) {
          if ((await chips.nth(i).innerText()).replace(/\s+/g, ' ').trim() === want) {
            await chips.nth(i).click();
            clicked = true;
            break;
          }
        }
        if (!clicked) throw new Error('chip não encontrado: ' + want);
      }
      await snap(id, 'sel');
      await primary(page);
      await snap(id, 'fb');
      return primary(page);
    }
    case 'order': {
      const items = mode === 'wrong' ? [...s.items].reverse() : s.items;
      for (const t of items) await page.locator('.pool-chips .chip-btn', { hasText: plain(t) }).first().click();
      await snap(id, 'sel');
      await primary(page);
      await snap(id, 'fb');
      return primary(page);
    }
    case 'cloze':
      await page.locator('input.blank').first().fill(mode === 'wrong' ? 'xyz' : firstAnswer(s).toLowerCase().replace('glut4', 'glut 4'));
      await primary(page);
      await snap(id, 'fb');
      return primary(page);
    case 'flip':
      await page.locator('button.flip').click();
      await page.waitForTimeout(550);
      await snap(id, 'fb');
      return primary(page);
    case 'sim':
      if (s.mode === 'explore') {
        await page.locator('.enz-btns .enz').first().click();
        await snap(id, 'view');
        return primary(page);
      }
      if (s.mode === 'challenge') {
        const edge = mode === 'wrong' ? 'g6pase' : s.answer;
        await page.locator(`.enz-btns .enz[data-edge="${edge}"]`).click();
        await snap(id, 'sel');
        await confirmConf(page);
        await page.locator('.feedback').first().waitFor();
        await snap(id, 'fb');
        return primary(page);
      }
  }
  throw new Error('tipo não tratado: ' + id);
}

const consoleErrors = [];
function watch(page) {
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push('console: ' + m.text());
  });
}

const browser = await chromium.launch();

// ---------------- Cenário A: celular, caminho feliz com um erro no meio ----------------
console.log('\nCenário A — celular (390×844): pré-teste, Unidade 1, aprovação no portão');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE);
  await page.locator('.subject').first().waitFor();
  await shot(page, 'A01-home');
  check((await page.locator('.subject').count()) === 9, 'home mostra as 9 matérias');
  check((await page.locator('.subject.soon').count()) === 8, '8 matérias “em breve”');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'sem rolagem horizontal na home');
  await page.locator('.module-link').first().click();
  await page.locator('.path-item').first().waitFor();
  await shot(page, 'A02-module');
  check((await page.locator('.path-item.open').count()) === 1, 'só o pré-teste está liberado no início');
  await page.locator('.path-item.open .btn').click();

  const snapA = (prefix) => async (id, phase) => {
    const want = new Set(['pretest:view', 'q-u1-sw-2:sel', 'q-u1-sw-2:fb', 'summary:view', 'unit:view', 'u1-s01:fb', 'u1-c01:view', 'u1-s04:sel', 'u1-s04:fb', 'u1-s05:fb', 'u1-s07:fb', 'u1-s08:sel', 'u1-s08:fb', 'u1-c08:view', 'u1-s11:fb', 'u1-s12:view', 'u1-s13:sel', 'u1-s13:fb', 'u1-s15:fb', 'mt:view', 'gate:view', 'u1-s09:fb']);
    if (want.has(`${id}:${phase}`)) await shot(page, `${prefix}-${id}-${phase}`);
  };
  // pré-teste: acerta metade
  let k = 0;
  for (let guard = 0; guard < 20; guard++) {
    const c = await current(page);
    if (c.kind === 'summary') break;
    await answerCurrent(page, () => (k++ % 2 ? 'wrong' : 'right'), snapA('A03'));
  }
  await shot(page, 'A04-pretest-summary');
  await page.locator('.actionbar .btn.primary').click(); // Começar a Unidade 1

  // Unidade 1: erra a u1-s09 (deve voltar uma variante nova) e chuta a u1-s10
  const seen = [];
  let reloaded = false;
  for (let guard = 0; guard < 80; guard++) {
    const c = await current(page);
    seen.push(c);
    if (c.id === 'u1-s06' && !reloaded) {
      reloaded = true;
      await page.reload();
      const after = await current(page);
      check(after.id === 'u1-s06', 'retoma exatamente a mesma tela após recarregar');
    }
    if (c.kind === 'gate') {
      await shot(page, 'A06-gate');
      check((await page.locator('.stat.ok').count()) === 2, 'portão aprovado (≥80% e Certeza nas 2 últimas)');
      await primary(page);
      break;
    }
    await answerCurrent(page, (id) => (id === 'u1-s09' ? 'wrong' : id === 'u1-s10' ? 'guess' : 'right'), snapA('A05'));
  }
  const repeatIdx = seen.findIndex((x) => x.role === 'repeat');
  const s09 = seen.findIndex((x) => x.id === 'u1-s09');
  check(repeatIdx > s09 && repeatIdx - s09 <= 5, `conceito errado volta algumas telas depois com questão nova (tela ${repeatIdx - s09} após o erro)`);
  const mt = seen.filter((x) => x.role === 'mt');
  check(mt.length >= 5 && mt.length <= 8, `mini-teste com ${mt.length} questões`);
  const mtLevels = mt.map((x) => Q.get(x.id).level);
  check(mtLevels.every((l, i) => i === 0 || l >= mtLevels[i - 1]), `mini-teste sobe de nível (${mtLevels.join(',')})`);
  const lessonQ = new Set(seen.filter((x) => x.kind === 'q').map((x) => x.id));
  check(lessonQ.size === seen.filter((x) => x.kind === 'q').length, 'nenhuma questão repetida dentro da unidade');

  await page.locator('.path-item').first().waitFor();
  await shot(page, 'A07-module-after');
  check((await page.locator('.path-item.done').count()) === 2, 'pré-teste e Unidade 1 concluídos');
  check((await page.locator('.path-item.draft').count()) >= 1, 'próximas unidades aparecem como “em construção”');

  await page.goto(BASE + '#/regras/bioq-carboidratos');
  await page.locator('.rule-card').first().waitFor();
  await shot(page, 'A08-rules');
  check((await page.locator('.rule-card:not(.locked)').count()) === 5, 'caderno de regras mostra as 5 regras da U1');

  await page.goto(BASE + '#/erros/bioq-carboidratos');
  await page.locator('.review-item').first().waitFor();
  check((await page.locator('.review-item').count()) >= 2, 'caderno de erros registrou o erro e o chute');
  await page.locator('.review-item summary').first().click();
  await shot(page, 'A09-errors');

  await page.goto(BASE + '#/relatorio/bioq-carboidratos');
  await page.locator('.cmp-table, .map-sec').first().waitFor();
  await shot(page, 'A10-report');

  await page.goto(BASE + '#/anki/bioq-carboidratos');
  await page.locator('.btn.primary.wide').waitFor();
  const ankiInfo = await page.locator('.content p.muted').first().innerText();
  check(/\d+ cartões/.test(ankiInfo) && !/^0 /.test(ankiInfo), 'exportação para Anki tem cartões: ' + ankiInfo);

  await page.goto(BASE + '#/');
  await page.locator('.tool').first().waitFor();
  await page.locator('.tool', { hasText: 'Teste rápido' }).click();
  const q1 = await current(page);
  check(q1.role === 'quick', 'teste rápido abre questões');
  await page.locator('.labs-btn').click();
  await page.locator('.labs-table').first().waitFor();
  await shot(page, 'A11-labs');
  await page.locator('.sheet .icon-btn').click();
  await page.waitForTimeout(300);
  await page.goto(BASE + '#/s/' + encodeURIComponent('bioq-carboidratos:u1:revisao'));
  await page.goto(BASE + '#/m/bioq-carboidratos');
  await page.goto(BASE + '#/glossario');
  await page.locator('.gloss-list dt').first().waitFor();
  check((await page.locator('.gloss-list dt').count()) > 20, 'glossário lista os termos');

  // glossário por toque dentro de um cartão
  await page.goto(BASE + '#/m/bioq-carboidratos');
  await page.locator('.path-item.t-unit.done .btn').first().click(); // revisão da unidade
  await primary(page); // intro
  await answerCurrent(page); // pergunta-gancho
  check((await current(page)).id === 'u1-c01', 'revisão da unidade percorre as telas');
  await page.locator('.card-lesson .term').first().click();
  await page.locator('.gloss-entry').waitFor();
  check(true, 'tocar num termo abre o glossário EN↔PT');
  await shot(page, 'A13-glossary-sheet');
  await page.goto(BASE + '#/config');
  await page.locator('.seg-btns .btn', { hasText: 'Escuro' }).click();
  await shot(page, 'A12-config-dark');
  await ctx.close();
}

// ---------------- Cenário B: reprovação no portão → remediação → nova tentativa ----------------
console.log('\nCenário B — reprovação no mini-teste, remediação e nova tentativa');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + '#/m/bioq-carboidratos');
  await page.locator('.path-item.open .btn').click();
  for (let g = 0; g < 20; g++) {
    if ((await current(page)).kind === 'summary') break;
    await answerCurrent(page);
  }
  await page.locator('.actionbar .btn.primary').click();
  let mtCount = 0;
  let sawFail = false;
  let sawRemed = false;
  let attempt2 = [];
  const attempt1 = [];
  for (let guard = 0; guard < 120; guard++) {
    const c = await current(page);
    if (c.kind === 'gate') {
      const failed = (await page.locator('.stat.bad').count()) > 0;
      if (failed && !sawFail) {
        sawFail = true;
        await shot(page, 'B01-gate-fail');
        await primary(page);
        continue;
      }
      check(!failed, 'segunda tentativa aprovada');
      await primary(page);
      break;
    }
    if (c.role === 'remed' || c.kind === 'remed' || c.kind === 'cardref') sawRemed = true;
    if (c.role === 'mt') {
      mtCount++;
      if (!sawFail) attempt1.push(c.id);
      else attempt2.push(c.id);
    }
    // 1ª tentativa: erra as duas primeiras e acerta as duas últimas com dúvida
    const plan = (id, role) => (role === 'mt' && !sawFail && attempt1.length <= 2 ? 'wrong' : 'right');
    if (c.role === 'mt' && !sawFail && attempt1.length > 2) {
      const item = Q.get(c.id);
      await clickOption(page, item.options.find((o) => o.correct).text);
      await confirmConf(page, 'duvida');
      await page.locator('.feedback').first().waitFor();
      await primary(page);
      continue;
    }
    await answerCurrent(page, plan);
  }
  check(sawFail, 'portão reprovou a 1ª tentativa');
  check(sawRemed, 'remediação apareceu (cartão + questões novas)');
  check(attempt2.length >= 5 && attempt2.every((id) => !attempt1.includes(id)), 'nova tentativa usa só questões inéditas');
  await ctx.close();
}

// ---------------- Cenário C: tablet ----------------
console.log('\nCenário C — tablet (820×1180)');
{
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE);
  await page.locator('.subject').first().waitFor();
  await shot(page, 'C01-home-tablet');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'sem rolagem horizontal no tablet');
  await page.goto(BASE + '#/m/bioq-carboidratos');
  await page.locator('.path-item.open .btn').click();
  await primary(page);
  await clickOption(page, Q.get(M.pretest[0]).options.find((o) => o.correct).text);
  await confirmConf(page);
  await shot(page, 'C02-question-tablet');
  // vai direto a uma tela do simulador
  await ctx.close();
}

await browser.close();
server.close();
console.log('\nErros de console/página: ' + (consoleErrors.length ? '\n  ' + consoleErrors.join('\n  ') : 'nenhum'));
if (consoleErrors.length) failures++;
console.log(failures ? `\n✗ ${failures} falha(s)` : '\n✓ Todos os testes passaram');
process.exit(failures ? 1 : 0);
