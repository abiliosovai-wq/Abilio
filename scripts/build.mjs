#!/usr/bin/env node
// Monta a pasta dist/ para o GitHub Pages:
//  - copia site/
//  - gera content/index.json a partir dos arquivos em content/modules/ (módulo novo = só um arquivo novo)
//  - grava no service worker a versão e a lista de arquivos para funcionar offline
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'site');
const OUT = join(ROOT, 'dist');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

// índice de módulos
const modDir = join(OUT, 'content', 'modules');
const modules = readdirSync(modDir)
  .filter((f) => f.endsWith('.json'))
  .map((file) => {
    const m = JSON.parse(readFileSync(join(modDir, file), 'utf8'));
    return {
      id: m.id,
      file,
      subject: m.subject,
      order: m.order || 0,
      title: m.title,
      version: m.version || '',
      units: (m.units || []).length,
      ready: (m.units || []).filter((u) => u.status === 'ready').length,
    };
  })
  .sort((a, b) => a.subject.localeCompare(b.subject) || a.order - b.order);
writeFileSync(join(OUT, 'content', 'index.json'), JSON.stringify({ modules }, null, 1));

// lista de arquivos e versão
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(OUT)
  .map((p) => relative(OUT, p).split('\\').join('/'))
  .filter((p) => p !== 'sw.js' && !p.startsWith('.'))
  .sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(OUT, f)));
const version = hash.digest('hex').slice(0, 12);
const assets = ['./', ...files.map((f) => './' + f)];
const sw = readFileSync(join(OUT, 'sw.js'), 'utf8').replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets));
writeFileSync(join(OUT, 'sw.js'), sw);
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`dist/ pronto · versão ${version} · ${files.length} arquivos · ${modules.length} módulo(s)`);
