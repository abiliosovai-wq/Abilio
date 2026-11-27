# CLAUDE.md — Step 1 Interativo

Curso interativo baseado em questões para o USMLE Step 1, para um residente de Neurologia (R2) no Brasil. O usuário **não tem computador**: usa tablet Android e iPhone. Tudo é publicado pelo GitHub Pages com deploy automático (GitHub Actions). Qualquer passo que ele precise fazer deve ser explicado para o navegador do celular.

## Estrutura

```
site/                  site estático (sem build de JS; ES modules)
  index.html, sw.js, manifest.webmanifest, css/, icons/
  js/                  MOTOR — não contém conteúdo
    app.js             inicialização, service worker, glossário por toque
    pages.js           home, módulo, cadernos, relatório, Anki, configurações
    runner.js          moldura da sessão e telas especiais (portão, revisão de prova…)
    session.js         lógica: montagem das sessões, repetição, portão, remediação
    render.js          telas interativas (múltipla escolha, associar, ordenar, lacuna, flip, simulador)
    sim.js             simulador genérico de bloqueio enzimático (configurado por dados)
    mastery.js         domínio por conceito + revisão espaçada
    store.js           progresso no localStorage + exportar/importar
  content/
    catalog.json       matérias da home (e “em breve”)
    labs.json          valores de referência
    modules/*.json     UM ARQUIVO POR MÓDULO (conteúdo) — esquema em docs/SCHEMA.md
scripts/validate.mjs   validação do conteúdo (bloqueia o deploy se falhar)
scripts/build.mjs      gera dist/ (índice de módulos + service worker versionado)
tests/e2e.mjs          teste Playwright em celular e tablet
docs/SCHEMA.md         esquema de dados
docs/PLANO-PILOTO.md   plano pedagógico do módulo piloto
```

Comandos: `node scripts/validate.mjs` · `node scripts/build.mjs` · `node tests/e2e.mjs --shots <pasta>` (precisa do build).
Deploy: `.github/workflows/deploy.yml` roda validação → build → publica `dist/` no Pages a cada push.

## Para criar um módulo novo
1. Criar `site/content/modules/<id>.json` seguindo `docs/SCHEMA.md` (o motor não muda).
2. Unidades sem conteúdo ficam com `"status": "draft"` (aparecem como “em construção”).
3. Rodar a validação, o build e o teste e2e; testar em 390×844 e 820×1180.
4. Registrar no topo do arquivo de plano (`docs/`) as unidades, conceitos, checkpoints e Regras lógicas antes de escrever — e esperar a aprovação do usuário.

## Regras de conteúdo (obrigatórias)

### Idioma
- Interface, lições e comentários em **português**; questões NBME (enunciado e alternativas) em **inglês**.
- Termos da prova ficam em inglês: na primeira vez, termo em PT seguido do original marcado no glossário: `glicogênio fosforilase ([[glycogen phosphorylase]])`. Todo `[[termo]]` precisa existir no glossário do módulo.
- Todo comentário termina com **How it's tested:** — uma frase em inglês de como a banca descreve aquilo (campo `tested`).

### Pedagogia (a prioridade é entender, lembrar e resolver por lógica)
1. **Mecanismo antes do fato**: todo fato cobrado precisa poder ser deduzido de um princípio ensinado.
2. Cada conceito tem uma **Regra lógica** curta e generalizável; todas formam o Caderno de regras.
3. **Testar o tempo todo**: pergunta-gancho antes de ensinar (efeito pré-teste), cartão → pergunta → cartão. **Nunca mais de 2 cartões seguidos** sem interação (o validador verifica). Cartões ≤ ~80 palavras.
4. Progressão do nível 1 ao 4; avanço por **domínio demonstrado** (portão: ≥80% no mini-teste **e** acerto com Certeza nas 2 últimas).
5. **Intercalação**: mini-testes trazem 1–2 questões de unidades anteriores; checkpoints e prova final misturam tudo.
6. **Repetição com variante nova**: conceito errado volta algumas telas depois com outra questão, nunca a mesma.
7. **Revisão espaçada entre dias** (reaprendizagem sucessiva): conceitos voltam em 1, 3, 7, 16, 35 dias; erro reinicia.
8. Confiança Certeza/Dúvida/Chute antes da resposta; acerto no chute não conta como domínio; erro com Certeza é destacado (efeito de hipercorreção).

### Questões NBME
- Vinheta clínica completa (idade, sexo, queixa, história, exame, exames) → pergunta final clara → **5 alternativas homogêneas**, uma única melhor resposta. Sem “all of the above”, “none of the above” ou “EXCEPT”.
- Cada distrator é plausível e representa um erro de raciocínio comum.
- Níveis: 1 = recordar o mecanismo; 2 = aplicação direta; 3 = vinheta de 2 passos (diagnóstico → mecanismo); 4 = 3 passos ou integração com outro sistema/farmacologia.
- Comentário: (a) por que a correta está correta, pelo mecanismo; (b) por que **cada** errada está errada **e** em que situação seria a resposta (`wouldBe`); (c) Regra lógica; (d) How it's tested; (e) link para o cartão da lição (`card`).
- **Mínimo 3 variantes por conceito** (alvo 5–6, para remediação e novas tentativas terem questões inéditas) e pelo menos uma de nível 3–4.
- Valores laboratoriais em unidades convencionais (mg/dL), como na NBME; o painel “Lab” mostra as faixas de referência.

### Originalidade, precisão e privacidade
- Conteúdo **100% original**. Não copiar texto, questões nem mnemônicos de UWorld, NBME, AMBOSS, First Aid ou qualquer outra fonte.
- Materiais enviados pelo usuário servem só para calibrar escopo e o que é high-yield. **Nunca** colocá-los no repositório (ele é público).
- Seguir o conteúdo padrão atual do Step 1. Em caso de dúvida sobre um fato, preencher `"verify": "…"` no item e avisar o usuário — nunca inventar. O validador lista todos os itens “verificar”.

## Decisões técnicas
- Sem backend; progresso em `localStorage` (gravação síncrona a cada resposta), exportar/importar arquivo JSON para levar entre aparelhos. No iPhone, o app da tela de início tem armazenamento separado do Safari.
- PWA: `sw.js` faz cache de tudo (lista e versão gravadas pelo build) → funciona offline; aviso “Nova versão disponível” quando há deploy novo.
- Mobile first: botões ≥ 44 px, modo escuro (automático/claro/escuro), tamanho de fonte ajustável, sem rolagem horizontal.
- Sessões guardam ids de telas/questões: prefira **acrescentar** a renomear ids de conteúdo já publicado.
