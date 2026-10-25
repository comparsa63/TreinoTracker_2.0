# Contrato de Rotina e Persistência de Exercícios

> Documento de apoio do fluxo **criar → editar → salvar → recuperar** de um treino.
> Descreve as três estruturas de dados do domínio, onde cada transformação acontece
> e o que foi corrigido no bug crítico **5.2** (exercícios não persistiam).

---

## 1. As três estruturas

### 1.1 ROTINA (o que o usuário monta e o que fica salvo)

```js
{ id, letter, name, exercises: [{ catalogId, sets, reps, weight, rest }] }
```

- Definida/normalizada em `js/persistence.js` (`sanitizeExercise`, `sanitizeRoutine`).
- `letter` é a **identificação automática** do treino (`A`, `B`, `C`…) e não muda
  quando o usuário edita o nome. `name` é o rótulo livre exibido ao lado dela.
- `name` é opcional e tem limite visual de **60 caracteres** na UI. Na leitura do
  disco, `sanitizeRoutine` aplica `str(raw.name, "Treino " + letter)`: registro
  legado sem `name`, ou com `name` vazio/só espaços, recebe `Treino <letter>`.
  Não há migração destrutiva — o valor existente é preservado.
- `sets`, `reps`, `weight`, `rest` são a **prescrição planejada** (o "combinado"),
  não o que foi executado.
- Mínimos garantidos na leitura do disco: `sets ≥ 1`, `reps ≥ 1`, `weight ≥ 0`,
  `rest ≥ 0`. Exercício sem `catalogId` é descartado (não há como resolver o
  catálogo depois).
- Chave física no `localStorage`: `tt_ds_v1_routines`.

### 1.2 SESSÃO (a execução em andamento)

```js
{ id, status, startedAt, routineId, routineName, letter,
  exercises: [{ catalogId, name, muscle, img, sets, reps, weight, rest,
                actualWeight, actualReps, setsCompleted, completedSets }] }
```

- Criada por `WorkoutSession.create(routine, now, { resolve })` e orquestrada por
  `WorkoutController` (`js/workout-controller.js`).
- Chave física: `tt_ds_v1_session`.

### 1.3 ENTRADA DE HISTÓRICO (o que já foi feito)

```js
{ id, name, date, dateISO, durationMin, duration, status, routineId, letter,
  exercises: [{ catalogId, name, muscle, sets: [{ weight, reps }] }],
  prs?, sessionId?, category?, type? }
```

- Montada por `WorkoutController.buildHistoryEntry(session, status, now)`.
- Chave física: `tt_ds_v1_history`.

---

## 2. Transformações (rotina → sessão → histórico)

| De → Para | Onde | O que é copiado | O que muda |
|---|---|---|---|
| ROTINA → SESSÃO | `WorkoutController.start` / `WorkoutSession.create` | `catalogId`, `sets`, `reps`, `weight`, `rest` (planejados) | `name`/`muscle`/`img` resolvidos no catálogo via `resolve`; entram `actualWeight`/`actualReps` (valores de partida do Player), `setsCompleted: 0` e `completedSets: []` |
| SESSÃO → HISTÓRICO | `WorkoutController.buildHistoryEntry` | `catalogId`, `name`, `muscle`; **só** `completedSets` → `sets: [{ weight, reps }]` | `duration`/`durationMin` derivados de `elapsedMs`; `name` = `"Treino <letter> — <routineName>"`; `dateISO` pela data local; `sessionId` (identidade estável, usada para não duplicar); `category`/`type` quando a sessão é de cardio |
| HISTÓRICO → HOME | `js/home-insights.js` (leitura pura) | `dateISO`, `durationMin`, `status`, `category`/`type` | Nada é gravado; é só recorte/soma para o resumo semanal |

**Ponto importante:** a prescrição (`sets`/`reps`/`weight`/`rest` da rotina) **não**
é promovida para o histórico. O histórico representa séries *efetivamente
concluídas* — exercício que ficou sem nenhuma série concluída sai da entrada
(`filter((ex) => ex.sets.length > 0)` em `buildHistoryEntry`). Isso é intencional:
planejado ≠ executado.

---

## 3. Fluxo de edição da rotina (UI)

```
lista/detalhes ──"✎"/"Editar"──> navigate('edit', id)
                                    └─> startEditRoutine(id): tempEditRoutine = cópia de state.routines[id]

tempEditRoutine  <── push ── addExerciseToRoutine(catalogId)        ("+" do catálogo)
                 <── ajuste ─ updateConfig('sets'|'reps'|'weight'|'rest', delta)
                 <── input ── updateRoutineName(value)               (campo #routine-name)
                 ──> renderEditList()                                (redesenha a tela)
                 ──> saveRoutineEdits()  ──> persistRoutines() ──> Persistence.saveRoutines() ──> localStorage
```

- `tempEditRoutine` é o **buffer da edição**: até o "Salvar", nada toca o estado
  persistido. O `state.routines[...]` original **não** é mutado durante a edição.
- O campo `#routine-name` grava em `state.tempEditRoutine.name` a cada `input`.
  Como o buffer é a fonte da verdade da tela, o nome digitado sobrevive a idas ao
  catálogo, a "Adicionar exercício" e a "Configurar exercício".
- No "Salvar", o nome recebe `trim`; se ficar vazio, vira `Treino <letter>`.
  Nome e letra são independentes: a letra continua automática.
- Voltar do catálogo (`navigate('edit')` **sem** id) ou de "Configurar exercício"
  mantém o buffer (`showEditScreen()`); abrir a rotina pela lista/detalhes (**com**
  id) começa uma edição nova, descartando o rascunho (`startEditRoutine(id)`).
- `Persistence.saveRoutines` sempre passa por `sanitizeRoutines` antes de gravar
  (round-trip: o que sai do disco passa pela mesma regra).
- Legado: registro sem `exercises` (ou com `series` no histórico) continua válido —
  rotina sem exercícios vira `exercises: []`, nunca erro.

---

## 4. Bug 5.2 — exercícios não ficavam salvos

### 4.1 Causa raiz

`addExerciseToRoutine()` empurrava o exercício em `state.tempEditRoutine` e chamava
`navigate('edit')`. A navegação executava `startEditRoutine(param || editingRoutineId)`,
que **recopiava** `tempEditRoutine` a partir de `state.routines` — descartando, em
silêncio, o exercício que acabara de ser adicionado (e, pelo mesmo motivo, os ajustes
de séries/reps/carga/descanso feitos em "Configurar exercício", quando o usuário
voltava com "←").

Resultado: `state.tempEditRoutine.exercises` voltava a `[]`, e o "Salvar" persistia
`exercises: []`. **A perda era na Etapa A/B (montagem do buffer), não no storage** —
o `localStorage` gravou fielmente o que recebeu.

Evidência (cliques reais, Chrome headless, antes da correção):

```
click '+' do 1º item -> tela: "edit" | buffer: 0 | lista desenhada: 0
storage após o 1º add: [{"id":"rA","ex":2},{"id":"rB","ex":0}]   // rB = treino em edição
"Salvar" -> exercises: []                                        // e a tela de detalhes: "Nenhum exercício adicionado."
```

### 4.2 Correção (3 pontos, um só defeito)

1. `navigate()`: a rota `edit` com `param` abre edição nova; **sem** `param`
   (volta do catálogo/configurar) mantém a edição em andamento (`showEditScreen()`).
2. `showEditScreen()` (nova): redesenha o buffer sem recopiar do estado; sem buffer
   (ou de outra rotina) delega ao `startEditRoutine()` — caminho antigo preservado.
3. `saveRoutineEdits()`: monta a lista à parte, grava via `persistRoutines()` e só
   então troca `state.routines`; falha de gravação vira aviso (toast) em vez de
   "sucesso" silencioso — mesmo critério já usado pela exclusão de rotina.

O contrato da rotina **não mudou** (nem os campos, nem a sanitização): a correção
apenas preserva o buffer até o "Salvar".

### 4.3 Evidências depois da correção

```
'+' do catálogo -> buffer: 1, lista: 1, tela: edit
'+' de novo     -> buffer: 2, lista: 2
'Configurar'    -> sets 5, reps 11, weight 25, rest 75 (voltam intactos para a edição)
'Salvar'        -> [{catalogId:"A-01",sets:5,reps:11,weight:25,rest:75},
                    {catalogId:"A-02",sets:3,reps:10,weight:20,rest:60},
                    {catalogId:"A-03",sets:3,reps:10,weight:20,rest:60}]
RECARREGAR      -> 3 exercícios na memória e no storage (sem duplicar)
2ª rotina       -> a 1ª continua com 3 exercícios (nada é sobrescrito)
Player          -> sessão com 3 exercícios e 5 séries no 1º (prescrição preservada)
```

### 4.4 Cobertura de teste

- `tests/smoke.browser.mjs` — 9 checagens de integração no fluxo **real** (cliques
  nos botões, `localStorage` como fonte da verdade): criação, "+" do catálogo,
  configuração, salvamento, recarga, segunda rotina, registro legado, falha de
  gravação e abertura no Player.
- `tests/modules.test.js` — suíte **"Rotina: exercícios persistidos (bug 5.2)"**:
  round-trip preservando os 4 campos e a ordem, ausência de duplicidade, registro
  legado sem `exercises`, `saveRoutines` devolvendo `false` com storage ativo
  (quota) e travas de origem no HTML (a rota antiga não pode voltar).

### 4.5 O que NÃO mudou

- Estrutura persistida da rotina, sanitização, chaves do `localStorage`.
- Home (resumo semanal, faixa de recentes, cardio, dias consecutivos), i18n pt/en/es,
  Histórico, PRs, Player/descanso/Wake Lock/ActionGuard.
- `createNewRoutine()` naquele momento ignorava o retorno de `Persistence.saveRoutines`.
  Isso foi corrigido na Sprint 5.3 (ver seção 5), sem alterar o contrato público.

---

## 5. Sprint 5.3 — nome da rotina

### 5.1 Regra funcional

- A **letra** (`letter`) e o **id** (`r<letter>`) continuam automáticos e estáveis;
  o **nome** (`name`) é editável e não participa da identificação.
- Tela de edição: campo `#routine-name` com `<label for>`, placeholder, ajuda
  (`aria-describedby`) e `maxlength="60"`. O valor é sincronizado com
  `state.tempEditRoutine.name` a cada alteração e repintado a partir do buffer
  quando a tela volta do catálogo/configuração.
- Ao salvar: `trim`; nome vazio/só espaços → `Treino <letter>`. O limite de 60 é
  aplicado na digitação e novamente no salvamento.
- A lista de rotinas e a tela de detalhes exibem o nome. A letra continua no
  título (`Treino A`); o nome aparece como subtítulo quando é diferente do padrão.
  Preparação e histórico mantêm o comportamento anterior.

### 5.2 Compatibilidade e persistência

- Rotinas legadas sem `name` (ou com nome em branco) são lidas como
  `Treino <letter>` por `sanitizeRoutine`, sem reescrever o storage e sem perder
  `id`, `letter` ou `exercises`.
- `createNewRoutine()` e `saveRoutineEdits()` usam o `persistRoutines()` existente
  e só atualizam `state.routines` depois da gravação. Falha de storage vira toast
  de erro, mantém o buffer e **não** indica sucesso.
- `createNewRoutine()` escolhe a próxima letra considerando **rotinas e histórico**:
  uma letra referenciada por um treino antigo não é reutilizada (evita que um novo
  treino herde registros de outro). Depois de excluir uma rotina intermediária,
  a próxima criação não colide com IDs/letras existentes.

### 5.3 Segurança (XSS)

`renderRoutines()` não interpola mais `id`, `letter` ou `name` em `onclick` inline.
O HTML é montado com `TTUtils.escapeHtml` e os cliques usam delegação por
`data-routine-action` / `data-routine-id`. Nome contendo `<`, `>`, `&`, aspas ou
um id malformado aparece como texto e nunca é executado. O mesmo padrão de
delegação já usado pelo catálogo foi adotado.

### 5.4 Cobertura de teste

- `tests/modules.test.js` — contagem/paridade de i18n (130 chaves), textos do nome
  nos 3 idiomas, round-trip do nome, separação letra/nome, legado sem `name` e
  `name` em branco.
- `tests/smoke.browser.mjs` — fluxo real: criação com nome, recarga, edição,
  vazio/só espaços, limite de 60, preservação ao navegar por catálogo/configuração,
  exibição em lista/detalhes/preparação, legado, XSS, exclusão de rotina
  intermediária sem colisão e falha de persistência (criar e salvar nome).

---

## 6. Sprint 5.3 / Incremento 2 — descanso prescrito no Player

### 6.1 Duas coisas diferentes (não confundir)

| O quê | Onde | Passo | Persiste? | Efeito |
| --- | --- | --- | --- | --- |
| Descanso **prescrito** do exercício | Player, logo abaixo de “Descanso Automático” | 30 s | Sim (sessão + rotina) | Define o tempo usado quando uma série é concluída |
| Descanso **em execução** | Overlay do timer | 15 s | Não (efêmero) | Ajusta apenas o timer aberto; some ao pular/encerrar/recarregar |

- O ajuste rápido do overlay continua sendo `−15s` / `+15s` e passa por
  `adjustRestTime` → `WorkoutController.restAdd` → `RestTimer.addTime`. Esse
  caminho **não** grava a prescrição.
- Os controles do Player usam `adjustPrescribedRest(±30)`, que altera
  `session.exercises[current].rest` e o exercício correspondente em
  `state.routines` (`routineId` da sessão), depois persiste com
  `WorkoutController.save` + `persistRoutines`.

### 6.2 Regras de valor

- Faixa configurável: **30 s (00:30)** a **3.570 s (59:30)**, passo de 30 s.
- Exibição em `MM:SS` (`formatRestMMSS`), inclusive para valores legados.
- `rest = 0` continua significando **sem descanso**. Ele não é convertido em 30
  automaticamente: no primeiro `+` vira 30 s; `−` em zero permanece zero.
- Valores legados positivos fora da faixa (ex.: 10 s ou 5.000 s) são exibidos
  como estão, sem migração automática. O primeiro ajuste aplica o limite:
  `target = atual ± 30`, limitado a `[30, 3570]`. Valores como 45 s e 90 s
  continuam válidos e não são arredondados para múltiplos de 30.
- O toggle “Descanso Automático” continua sendo estado separado
  (`state.autoRestEnabled`): ligar/desligar não altera o valor prescrito.

### 6.3 Compatibilidade e falha

- A sessão e a rotina são sanitizadas pelo caminho já existente
  (`Math.max(0, Math.round(rest))`); a faixa de 30–3.570 é uma regra de **UI**
  aplicada no ajuste, não uma nova regra destrutiva de leitura.
- Se a gravação da sessão ou da rotina falhar, o valor em memória volta ao
  anterior, o toast `rest_config_save_error` é exibido e a UI é repintada.
- A rotina é localizada por `session.routineId`; o exercício é casado primeiro
  pela mesma posição e validado por `catalogId`, com fallback para o primeiro
  `catalogId` igual. Sem correspondência, apenas a sessão é persistida.
