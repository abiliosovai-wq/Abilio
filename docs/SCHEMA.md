# Esquema de dados de um módulo

Cada módulo é **um único arquivo JSON** em `site/content/modules/<id>.json`. O motor (`site/js/`) não sabe nada de conteúdo: para criar um módulo novo basta adicionar um arquivo novo. O `scripts/build.mjs` gera o índice (`content/index.json`) sozinho, e a matéria aparece na home pelo campo `subject` (que deve existir em `site/content/catalog.json`).

Valide sempre com `node scripts/validate.mjs` — a publicação é bloqueada se houver erro.

## Mini-markup aceito nos textos

| Escrita | Resultado |
|---|---|
| `**negrito**` | negrito |
| `_itálico_` | itálico |
| `[[glycogen phosphorylase]]` | termo do glossário (toque abre EN↔PT). Busca por `id`, `en`, `pt` ou `aliases` |
| `[[id\|texto mostrado]]` | termo do glossário com outro texto |
| linha começando com `- ` ou `1. ` | lista |
| linha em branco | novo parágrafo |

Não use `[[ ]]` dentro do texto de alternativas (elas já são botões). Não cite letras (“option C”) nos comentários: as alternativas são embaralhadas.

## Topo do arquivo

```json
{
  "schema": 1,
  "id": "bioq-carboidratos",          // único, sem espaços
  "subject": "bioquimica",            // id de matéria em catalog.json
  "order": 1,                         // ordem dentro da matéria
  "title": "Metabolismo dos carboidratos",
  "subtitle": "…",
  "version": "2026.11.27",
  "path": [ … ],                      // caminho do módulo (ver abaixo)
  "pretest": ["q-…", …],              // 8–10 ids de questões do banco
  "units": [ … ],
  "concepts": [ … ],
  "rules": [ … ],
  "pathways": { … },                  // vias do simulador de bloqueio
  "glossary": [ … ],
  "questions": [ … ]                  // banco NBME
}
```

### `path`
Sequência que o aluno percorre. Cada item libera o seguinte.
```json
{ "type": "pretest", "id": "pretest", "title": "Pré-teste diagnóstico", "subtitle": "…" }
{ "type": "unit", "unit": "u1" }
{ "type": "checkpoint", "id": "cp1", "title": "Checkpoint 1", "units": ["u1","u2","u3"], "focus": ["u2","u3"], "size": 8 }
{ "type": "final", "id": "final", "title": "Prova final cumulativa", "size": 30, "secondsPerQuestion": 90 }
```
- Checkpoint: 8–10 vinhetas, ~60% dos conceitos de `focus`, modo prova, meta 80%.
- Prova final: 25–30 vinhetas de todas as unidades (~20% nível 2, 40% nível 3, 40% nível 4), meta 85%.

### `concepts`
```json
{
  "id": "fedfast.switch",             // prefixo da unidade + nome curto
  "unit": "u1",
  "name": "Interruptor insulina × glucagon",
  "rule": "interruptor",              // regra lógica principal
  "rules": ["bloqueio"],              // (opcional) regras extras
  "anki": [ { "front": "…", "back": "…" } ]   // cartões de mecanismo (obrigatório em unidade pronta)
}
```

### `rules` (Caderno de regras)
A numeração mostrada (Regra 1, 2, …) segue a ordem da lista.
```json
{ "id": "bloqueio", "unit": "u1", "text": "**Bloqueio enzimático** → acumula o que vem antes, …" }
```

### `units`
```json
{
  "id": "u1",
  "status": "ready",                 // "ready" (publicada) ou "draft" (aparece como “em construção”)
  "title": "Estado alimentado × jejum",
  "short": "U1 · Alimentado × jejum",
  "subtitle": "…",
  "objectives": ["…"],
  "concepts": ["fedfast.switch", …],
  "miniTest": { "levels": [1,2,2,3,3,4,4], "previous": 1 },  // 5–8 questões; "previous" = quantas de unidades anteriores
  "screens": [ … ]
}
```
**Regra do validador:** nunca mais de 2 telas passivas seguidas (`card` ou `sim` no modo `explore`; a introdução da unidade conta como uma).

### Telas (`screens`)
Todas têm `id` único no módulo e `type`. Telas avaliadas (`predict`, `mcq`, `match`, `order`, `cloze`, `sim` predict/challenge) exigem `concepts`, `level` (1–4) e `tested` (frase em inglês, sem o prefixo “How it's tested:”). `rule` (id da regra) é recomendado.

| type | campos |
|---|---|
| `card` | `title`, `body` (≤ ~80 palavras), `concepts`, `pathway` (opcional: mostra o diagrama), `verify` (opcional) |
| `predict` | `prompt`, `options[{text, correct?, why?}]`, `reveal`, `shuffle` (false para manter a ordem, ex.: Sobe/Cai/Não muda), `role: "hook"` para a pergunta-gancho (sem confiança, errar é esperado) |
| `mcq` | mini-vinheta em inglês: `prompt` (opcional, PT), `stem`, `question`, `options[{text, correct?, why?}]`, `reveal` |
| `match` | `prompt`, `headers` (["Coluna fixa","Coluna 2",…]), `rows` ([["âncora","valor2","valor3"],…]), `explanation` — aceita 2 ou 3 colunas (doença ↔ enzima ↔ achado) |
| `order` | `prompt`, `items` (na ordem correta), `explanation` — o aluno toca em sequência |
| `cloze` | `text` com `{{resposta|variante1|variante2}}`, `explanation` — tolera acentos, hífens, espaços, letras gregas e pequenos erros (números precisam bater) |
| `flip` | `front`, `back` ou `rule` (o verso vira o texto da regra) |
| `sim` | `pathway`, `mode`: `explore` (livre), `predict` (`block`, `options`, `reveal`) ou `challenge` (`answer` = id da etapa, `explanation`) |

### `questions` (banco NBME — em inglês)
```json
{
  "id": "q-u1-sw-2",
  "concepts": ["fedfast.switch"],     // o 1º é o principal
  "level": 2,                         // 1 recordar · 2 aplicação direta · 3 dois passos · 4 três passos/integração
  "rule": "interruptor",
  "card": "u1-c02",                   // cartão da lição para "Rever o cartão" (obrigatório se a unidade estiver pronta)
  "stem": "A 34-year-old man …",
  "question": "Which of the following …?",
  "options": [                        // exatamente 5, uma correta; a ordem é embaralhada na tela
    { "text": "Phosphorylated and inactive", "correct": true, "why": "mecanismo (PT)" },
    { "text": "…", "why": "por que está errada (PT)", "wouldBe": "em que situação seria a resposta (PT)" }
  ],
  "tested": "A stressed or fasting patient … (EN)",
  "verify": "(opcional) dúvida a conferir"
}
```
Proibido: “all of the above”, “none of the above”, “EXCEPT”. Mínimo de **3 variantes por conceito** (alvo 5–6) e pelo menos uma de nível 3–4.

### `pathways` (simulador de bloqueio)
Grade de colunas × linhas. O efeito do bloqueio pode ser calculado pelo grafo (acumula = substrato; falta = o que só se alcança passando pela etapa; desvia = arestas `side` que saem do que acumulou) ou definido em `blocks`.
```json
"liver-output": {
  "title": "…",
  "cols": 3,
  "nodes": [ { "id": "g6p", "label": "Glicose-6-P", "col": 1, "row": 2, "kind": "output?" } ],
  "edges": [
    { "id": "g6pase", "from": "g6p", "to": "glc", "enzyme": "Glicose-6-fosfatase", "short": "rótulo curto", "blockable": true, "labelDx": 20 },
    { "id": "s-lac", "from": "g6p", "to": "lactate", "side": true }
  ],
  "blocks": {
    "g6pase": { "accumulates": ["g6p"], "lacks": ["glc"], "diverts": ["s-lac"], "note": "…", "clinical": "…", "labs": "…", "disease": "…", "rule": "bloqueio" }
  }
}
```
Dois nós não podem ocupar a mesma posição. Toda etapa `blockable` precisa de `blocks[id]` com `clinical`.

### `glossary`
```json
{ "id": "glycogen phosphorylase", "en": "glycogen phosphorylase", "pt": "glicogênio fosforilase", "def": "…", "aliases": ["…"] }
```

## Progresso (no aparelho)
`localStorage['step1-progress-v1']`: sessões em andamento (passos, respostas, ordem das alternativas — para retomar exatamente), tentativas por conceito (acerto, confiança, nível, contexto), agenda de revisão espaçada, questões vistas e caderno de erros. Exportar/Importar gera/lê esse mesmo objeto em JSON. Os passos referenciam ids de telas e questões — mudar um id quebra a retomada de quem está no meio daquela unidade; prefira acrescentar a renomear.
