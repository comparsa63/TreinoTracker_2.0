# Backlog — dívidas técnicas

> **Status geral:** 3 itens abertos, **nenhum bloqueante**.
> **Origem:** Sprint 5.3 (Incrementos 1 e 2), revisão final do Incremento 2.
> **Regra:** este documento registra dívidas; não autoriza correção. Cada item só
> entra em execução quando priorizado.

---

## Índice

| ID | Item | Origem | Severidade | Status |
| --- | --- | --- | --- | --- |
| TD-01 | `PRESCRIBED_REST_STEP` declarada e não utilizada | Inc. 2 (`323bd2f`) | Baixa (cosmética) | Aberto |
| TD-02 | Frequência dos anúncios ARIA no valor do descanso prescrito | Inc. 2 (`323bd2f`) | Baixa (a11y) | Aberto |
| TD-03 | Robustez do rollback em falha dupla de storage | Inc. 2 (`323bd2f`) | Baixa (probabilidade), Média (impacto) | Aberto |

---

## TD-01 — `PRESCRIBED_REST_STEP` declarada e não utilizada

**Local:** `TreinoTracker_DeepSeek.html`, bloco "DESCANSO PRESCRITO", ~linha 2200.

**Contexto**
A constante foi criada para documentar o passo de 30 s, mas o passo efetivo vem do
argumento passado pelos botões (`adjustPrescribedRest(-30)` / `adjustPrescribedRest(30)`).
A constante nunca é lida pelo código de produção.

**Evidência**
```
const PRESCRIBED_REST_MIN = 30;      // usado em nextPrescribedRest
const PRESCRIBED_REST_MAX = 3570;    // usado em nextPrescribedRest
const PRESCRIBED_REST_STEP = 30;     // declarada, nunca referenciada
```

**Impacto**
Nenhum em runtime. Custo de manutenção: quem alterar o passo pode editar a constante
achando que muda o comportamento — e nada acontece. Pior: o teste atual **exige** a
constante, então removê-la sem atualizar o teste quebra a suíte.

**Proposta (escolher uma)**
1. **Usar de verdade:** os `onclick` passam a usar `±PRESCRIBED_REST_STEP` e
   `nextPrescribedRest` valida `Math.abs(delta) === PRESCRIBED_REST_STEP`.
2. **Remover:** apagar a constante e a asserção correspondente.

**Critério de aceite**
- Não existe mais constante declarada e não lida.
- `tests/modules.test.js` deixa de exigir o literal
  `html.includes("const PRESCRIBED_REST_STEP = 30")` (ou passa a exigir o uso real).
- `npm run test:unit` e `npm run test:smoke` verdes.
- Comportamento observável dos botões inalterado (±30 s).

---

## TD-02 — Frequência dos anúncios ARIA no valor do descanso prescrito

**Local:** `TreinoTracker_DeepSeek.html` — `#player-rest-config`
(`role="status"` + `aria-live="polite"`) e `updatePlayerUI()`.

**Contexto**
`updatePlayerUI()` grava `restConfig.innerText = formatRestMMSS(ex.rest)` em **toda**
renderização do Player. Como o elemento é uma região viva, cada escrita dispara um
anúncio — mesmo quando o valor não mudou. `updatePlayerUI()` roda em conclusão de série,
troca de exercício, pausa/retomada, navegação de tela e no próprio ajuste.

**Impacto**
Ruído para quem usa leitor de tela: o valor pode ser reanunciado várias vezes por série,
interrompendo anúncios mais relevantes (série concluída, treino pausado). Não é falha
funcional — o dado está correto na tela.

**Proposta (escolher uma)**
1. **Escrita condicional:** só atribuir `innerText` quando o texto calculado diferir do
   atual. Elimina o ruído sem mudar a semântica.
2. **Região viva dedicada:** manter o valor visível fora da região viva e anunciar apenas
   o resultado de `adjustPrescribedRest` num nó separado (ex.: `aria-live` em um
   `span.prescription-announcer`).

**Critério de aceite**
- Ajustar a prescrição gera **1** anúncio por toque.
- Navegar entre exercícios/séries sem mudar o valor gera **0** anúncios.
- Verificação manual com NVDA ou VoiceOver em desktop; valor e rótulo continuam acessíveis
  via `aria-label` traduzido (`rest_config_decrease` / `rest_config_increase`).
- `npm run test:smoke` verde (o check de `role="status"`/`aria-live` pode precisar de ajuste).

---

## TD-03 — Robustez do rollback em falha dupla de storage

**Local:** `TreinoTracker_DeepSeek.html` — `adjustPrescribedRest(deltaSeconds)`.

**Contexto**
O ajuste grava em dois donos, sequencialmente:

```
sessionSaved  = WorkoutController.save(s).ok            // chave `session`
routinesSaved = persistRoutines(state.routines)         // chave `routines`
```

Se um falha, os dois objetos voltam ao valor anterior em memória e o lado que gravou é
regravado com o valor antigo (`if (sessionSaved) WorkoutController.save(s);`). O retorno
dessa **regravação de rollback é ignorado**.

**Cenários cobertos hoje (validados no smoke)**
- sessão OK + rotina falha → memória revertida, sessão regravada com o valor antigo.
- sessão falha + rotina OK → memória revertida, rotina regravada com o valor antigo.
- ambas falham → memória revertida, storage intocado.

**Risco residual**
1. **Falha dupla:** se a regravação de rollback também falhar (ex.: quota já esgotada, ou
   `setItem` recusando), o storage fica com o valor **novo** e a memória com o **antigo**.
   O usuário vê o toast de erro, mas só descobre a divergência ao recarregar.
2. **Escrita não atômica:** `session` e `routines` são duas chaves distintas. Um crash entre
   as duas gravações deixa `session` novo e `routines` antigo. Não é destrutivo (a rotina é
   a fonte da verdade da prescrição), mas é um estado intermediário possível.

**Impacto**
Baixa probabilidade (exige duas falhas consecutivas), impacto não destrutivo. O erro já é
sinalizado ao usuário, e a divergência é corrigível pelo próximo ajuste bem-sucedido.

**Proposta**
- Verificar o retorno da regravação de rollback.
- Em caso de falha do rollback, sinalizar explicitamente (toast específico e/ou `console.warn`
  com a chave afetada) em vez de silenciar.
- Decidir e documentar a política: **retentar** ou **aceitar e reconciliar na leitura**.
- **Não-objetivo:** transação atômica entre chaves — `localStorage` não oferece isso.

**Critério de aceite**
- Existe um teste de smoke que força a falha da **regravação de rollback** (não só da
  primeira gravação) e comprova o comportamento escolhido.
- Nenhum caminho termina com "sucesso" reportado ao usuário quando uma gravação falhou.
- A política adotada está registrada em `docs/ROUTINE-PERSISTENCE.md` §6.3.
- `npm test` verde.

---

## Observações registradas (não são dívidas)

Ficam documentadas para não voltarem como "achado novo":

| Observação | Situação |
| --- | --- |
| Legado `15 s` com `−30` sobe para `30 s`; `3.600 s` converge para `3.570 s` em ambas as direções. | Comportamento **intencional e documentado** (`docs/ROUTINE-PERSISTENCE.md` §6.2): o primeiro ajuste aplica `atual ± 30` limitado a `[30, 3570]`. |
| `rest = 0` permanece "sem descanso" até o primeiro `+`. | Intencional e documentado (§6.2). |
| Duas chaves (`session`, `routines`) sem atomicidade. | Inerente ao `localStorage`; tratado no escopo do TD-03. |
| Prescrição é regra de **UI** (30–3.570), não de leitura. | Intencional (§6.3): não há migração destrutiva na inicialização. |

---

## Como este backlog é mantido

- Um item por dívida, com **contexto → evidência → impacto → proposta → critério de aceite**.
- "Severidade" considera probabilidade × impacto, não esforço.
- Fechar um item exige: código + teste + atualização do documento de contrato afetado.
- Itens não bloqueantes **não** impedem release; entram por priorização explícita.
