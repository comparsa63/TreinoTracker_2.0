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
                 ──> renderEditList()                                (redesenha a tela)
                 ──> saveRoutineEdits()  ──> persistRoutines() ──> Persistence.saveRoutines() ──> localStorage
```

- `tempEditRoutine` é o **buffer da edição**: até o "Salvar", nada toca o estado
  persistido. O `state.routines[...]` original **não** é mutado durante a edição.
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
- `createNewRoutine()` continua ignorando o retorno de `Persistence.saveRoutines`
  (o mesmo `persistRoutines()` pode ser aplicado ali numa próxima passada — não faz
  parte deste defeito).
