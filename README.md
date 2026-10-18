# TreinoTracker DeepSeek

App de treino (single-page, sem build). Esta é a evolução do protótipo
`TreinoTracker_DeepSeek.html` recebendo, módulo a módulo, a arquitetura do
projeto `TreinoTracker` (persistência, catálogo de exercícios, histórico/PRs,
player, descanso, etc.).

> ⚠️ **A tela Home está BLINDADA.** Antes de mexer em qualquer coisa, leia
> [`docs/HOME-BOUNDARY.md`](docs/HOME-BOUNDARY.md).

---

## Como rodar

Não há build nem dependências. Basta abrir `TreinoTracker_DeepSeek.html` no
navegador — ou, para ter `localStorage` de verdade, servir por HTTP:

```bash
npx serve .        # ou: python -m http.server
```

## Testes

```bash
npm test          # tudo: guarda da Home + unitários + smoke no Chrome
npm run test:home # só a guarda da Home (golden master)
npm run test:unit # só os módulos (Node, rápido)
npm run test:smoke # integração real no Chrome headless (CDP)
npm run test:update # ⚠️ REGRAVA o golden master da Home (só com autorização)
```

| Suíte | O que garante | Nº |
|---|---|---|
| `tests/home-guard.test.js` | A Home não mudou 1 byte (markup, CSS, textos pt/en/es) | 1 |
| `tests/modules.test.js` | Utils, Storage, EventBus, i18n, Persistence, Catalog (grupos + subgrupos), PR e RoutineActions + wiring do HTML | 229 |
| `tests/smoke.browser.mjs` | Chrome real: Home, PT/EN, rotina+histórico+PRs persistem, navegação de TODOS os grupos/subgrupos musculares (320→1024px) e exclusão segura de treino | 57 |

## Estrutura

```
TreinoTracker_DeepSeek.html   # app (HTML + CSS + script principal)
js/
  utils.js                    # TTUtils — utilitários puros (datas/semanas, números, texto)
  i18n.js                     # I18n — fonte ÚNICA de traduções (pt/en/es)
  events.js                   # EventBus — pub/sub entre módulos (Fase 2A)
  persistence.js              # Persistence — hidratação/gravação do estado
  pr.js                       # PR — engine de recordes pessoais (Fase 2C)
  routine-actions.js          # RoutineActions — exclusão segura de rotina (Fase 2C)
  catalog.js                  # Catalog — catálogo real + taxonomia/API (Fases 2B + taxonomia)
  data/
    exercises.js              # ExerciseCatalog — 81 exercícios (grupoMuscular + subgrupo)
assets/
  images/                     # ícones de anatomia muscular (13 jpg, sem hotlink)
services/
  storage.js                  # StorageService — wrapper de localStorage (namespace tt_ds_v1_)
tests/
  home-guard.test.js          # guarda da Home (golden master)
  home-golden.json            # snapshot congelado da Home
  modules.test.js             # testes unitários dos módulos
  smoke.browser.mjs           # smoke test de integração (Chrome headless)
docs/
  HOME-BOUNDARY.md            # contrato da Home blindada
```

## Chaves persistidas (`localStorage`)

Todas com o prefixo `tt_ds_v1_` (definido em `StorageService.PREFIX`):

| Chave | Conteúdo | Dono |
|---|---|---|
| `tt_ds_v1_routines` | rotinas do usuário | `Persistence` |
| `tt_ds_v1_history` | histórico de treinos (enriquecido na Fase 2C) | `Persistence` |
| `tt_ds_v1_prs` | recordes pessoais (PRs) | `Persistence` / `PR` |
| `tt_ds_v1_lang` | idioma ativo | `I18n` / `Persistence` |
| `tt_ds_v1_autoRest` | toggle de descanso automático | `Persistence` |

### Formato do histórico (Fase 2C)

Cada entrada é **aditiva e retrocompatível** com o formato antigo (resumo):

```jsonc
{
  "id": 1792352123475,
  "name": "Treino A — Peito e tríceps",
  "date": "18 de out., 16:39",       // rótulo exibido
  "dateISO": "2026-10-18",           // usado pela engine de PRs (semana)
  "durationMin": 42,                 // duração real (0 quando desconhecida)
  "duration": "42 min",
  "status": "completed",             // completed | partial
  "routineId": "rA", "letter": "A",
  "exercises": [                     // apenas SÉRIES CONCLUÍDAS
    { "catalogId": "C-02", "name": "Supino reto", "muscle": "Peito",
      "sets": [{ "weight": 60, "reps": 12 }, { "weight": 62.5, "reps": 10 }] }
  ],
  "prs": [{ "type": "carga", "value": 62.5 }]   // recordes batidos nesse treino
}
```

Séries pendentes nunca entram no histórico. Alterações posteriores em rotinas ou
exercícios do catálogo não reescrevem treinos já registrados.

## Arquitetura dos módulos

Cada módulo é um IIFE que se registra em `globalThis` (e também em
`module.exports`, para os testes em Node). Não há bundler.

**Ordem de carregamento importa:**

```
js/utils.js → services/storage.js → js/i18n.js → js/data/exercises.js
  → js/catalog.js → js/events.js → js/routine-actions.js → js/pr.js
   ↓
<script> principal da app (usa I18n.dict/Catalog, define `state`, as telas)
   ↓
js/persistence.js → Persistence.init()   (antes do DOMContentLoaded)
```

⚠️ **Pegadinha:** `state` é declarado com `let` no script principal, logo vive no
*escopo léxico global* e **não** como propriedade de `window`. Acesse-o pelo
identificador direto (`typeof state !== 'undefined'`), nunca via `window.state`.

## Decisões de port

- **`translations` → `I18n.dict`**: o dicionário inline foi removido; o script
  principal mantém `const translations = I18n.dict;` para não alterar nenhum
  consumidor. `pt`/`en` preservados byte a byte; `es` adicionado.
- **`toggleLanguage()` delega para `I18n.toggle()`**, que percorre apenas
  `pt ↔ en` — preservando o comportamento de 2 estados do botão da Home.
- **`StorageService` nunca lança**: se o `localStorage` falhar (modo privado,
  quota), cai para um fallback em memória e a app continua funcionando.
- **`Persistence.hydrate` só sobrescreve se a chave EXISTE** no storage — assim
  um histórico/lista de rotinas vazio (escolha do usuário) é respeitado, e a
  primeira visita mantém os dados mock de demonstração.
- **Catálogo → `js/data/exercises.js` + `Catalog`**: os 81 exercícios do
  `ExerciseCatalog` do TreinoTracker foram portados como dados puros; `js/catalog.js`
  adapta cada registro para o formato do protótipo (`{id, name, muscle, img}`) e
  expõe a API de consulta (`findById`, `findByGroup`, `findByMuscle`,
  `getInstructions`, `getMistakes`, `getTips`). **Mídia**: os GIFs do projeto
  original apontavam para `assets/gifs/` (inexistente) e foram substituídos pelos
  13 ícones de anatomia locais (`assets/images/`) — sem hotlink do Unsplash.
- **Taxonomia muscular (`grupoMuscular` + `subgrupo`)**: cada exercício tem o
  **grupo principal** em `grupoMuscular` (compatível com tudo que já existia) e,
  quando a classificação é inequívoca, um **grupo específico** opcional em
  `subgrupo` — `Quadríceps`, `Posterior de Coxa`, `Panturrilha`, `Lombar` e
  `Glúteo` (13 exercícios). O `Catalog` expõe `subgroups()`, `filterGroups()`
  (principais + específicos, sem duplicar) e `findBySubgroup()`; o filtro da tela
  de adicionar exercício usa `filterGroups()` e o mesmo `Catalog.search()`
  (filtra por grupo principal **ou** por subgrupo, preservando a pesquisa por
  nome). O rótulo exibido compõe os dois (`Pernas · Quadríceps`). O campo é
  **aditivo/opcional**: ids, `grupoMuscular`, imagens, equipamentos,
  instruções e as rotinas salvas permanecem intactos.
- **`catalogItem(id)` com fallback**: rotinas antigas com `catalogId` inexistente
  não quebram mais a renderização (recebem um item "Exercício removido").
- **`EventBus` (`js/events.js`)**: porte fiel do pub/sub do TreinoTracker
  (`on/off/emit`). Única camada de eventos; emite `routine:deleted`,
  `history:added` e `pr:new`.
- **Utilitários de data/carga** (`TTUtils`): `today`, `fmtDate`, `getWeekRange`,
  `isSameWeek`, `getMaxCarga` e `getMaxReps` portados do `legacy-state.js`.
- **Histórico enriquecido**: ao concluir uma série, `completeSet()` guarda
  `{weight, reps}` reais em `completedSets`; `saveSessionToHistory` transforma
  isso em `exercises[]` (só séries concluídas) + `durationMin`/`dateISO`. A
  mudança é **aditiva**: entradas antigas continuam válidas, por isso o
  `SCHEMA_VERSION` permanece **1** (sem migração destrutiva).
- **`PR` (`js/pr.js`)**: porte do `PRRepository` com os mesmos 6 critérios
  (`carga`, `reps`, `volume`, `oneRM`, `series`, `weeklyStreak`) — **nenhum
  critério novo**. Grava pela `Persistence` (`tt_ds_v1_prs`), não em
  `localStorage` cru, e **não usa `StateAdapter`** (consome `state.history`).
  É **idempotente**: reprocessar o mesmo treino (mesmo `id`) não duplica
  recordes. Exercícios sem `catalogId` (custom) usam o nome como chave.
- **Exclusão segura de treino**: botão `−` no card da rotina → modal de
  confirmação → `RoutineActions.deleteRoutine` (lógica pura) identifica a
  rotina por `id`, bloqueia quando há **sessão ativa** e só aplica a mudança
  após a `Persistence` confirmar. Não toca em catálogo, histórico nem PRs.
- **UX dos grupos musculares**: `.filters` passou de `overflow-x: auto` (com
  scrollbar oculta, inacessível no desktop) para `flex-wrap: wrap`. Todos os
  grupos ficam visíveis e clicáveis em 320/360/390/430px e no desktop, sem
  rolagem horizontal na página.

## Roadmap

| Fase | Escopo | Status |
|---|---|---|
| **0** | Blindagem da Home (golden master + guarda) | ✅ |
| **1** | Fundação de dados: `utils`, `storage`, `persistence`, `i18n` | ✅ |
| **2B** | Catálogo real de exercícios + `Catalog` (API do `ExerciseRepository`) + mídia local (matar hotlink do Unsplash) | ✅ |
| **2A** | Fundação: `EventBus`, utils de data/carga, schema de persistência consolidado | ✅ |
| **2C** | Histórico enriquecido + PRs; UX dos grupos musculares; exclusão segura de treino | ✅ |
| **4** | Player, timer de descanso e **WakeLock** | ⏳ |
| **5** | Google Sheets / sincronização | ⏳ |

Fora de escopo: gamification, quests, planner, calendar, achievements,
intelligence, importer, review, `data/ai/*` e `ai/*`.
