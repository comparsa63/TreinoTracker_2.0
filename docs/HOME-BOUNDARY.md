# Contrato da Home (protegida por golden master)

> **REGRA:** a tela **Home** (`<section id="screen-home">`) é protegida por *golden master*.
> Nenhuma alteração — visual, de texto ou de comportamento — sem **autorização explícita**.

Este documento define exatamente o que está congelado, o que é permitido e como a
regra é verificada automaticamente.

> **Histórico de escopo:** a Home ficou "finalizada" até a Sprint 4. Na **Sprint 5.1**
> o usuário autorizou, de forma explícita e restrita, transformá-la em **resumo
> semanal real** (faixa segunda–domingo + cards de cardio e dias consecutivos). O
> escopo aprovado está na seção 6 e o golden master foi **reblindado** ao final.
> Na **Sprint 5.1.1** a mesma autorização foi estendida aos dois cards que ainda
> tinham valores **fictícios** ("Treino A — Peito e Tríceps"/`6`/`45 min` e
> "Treino B — Costas e Bíceps"/"Ontem • 50 min"): escopo na seção 7.
> Na **Sprint 5.1.2** o card único "Último Treino" foi substituído pela faixa
> horizontal **"Últimos treinos"** (até 7 concluídos, com rolagem lateral): escopo na
> seção 9.

---

## 1. O que está congelado (e é verificado por hash)

| Alvo | Onde | Módulo |
|---|---|---|
| Bloco `<section id="screen-home">…</section>` (byte-exato, **incluindo a seção aninhada**) | HTML | — |
| `.logo` | CSS | — |
| `.logo span` | CSS | — |
| `.card-highlight` | CSS | — |
| `.card-highlight::before` | CSS | — |
| `.last-workout` | CSS | — |
| `.home-insights` | CSS | Sprint 5.1 |
| `.weekly-strip` | CSS | Sprint 5.1 |
| `.weekly-day` | CSS | Sprint 5.1 |
| `.home-metrics` | CSS | Sprint 5.1 |
| `.home-metric` | CSS | Sprint 5.1 |
| `.recent-strip` | CSS | Sprint 5.1.2 |
| `.recent-strip:focus-visible` | CSS | Sprint 5.1.2 |
| `.recent-card` | CSS | Sprint 5.1.2 |
| `.recent-card-name` | CSS | Sprint 5.1.2 |
| `.recent-card-meta` | CSS | Sprint 5.1.2 |
| `.recent-empty` | CSS | Sprint 5.1.2 |
| Chaves i18n usadas na Home (`data-i18n`) × 3 idiomas | `js/i18n.js` | snapshot em `tests/home-golden.json` |

Os **hashes e tamanhos canônicos** vivem em `tests/home-golden.json` (fonte única;
não duplicar aqui para não ficar obsoleto). O extrator **balanceia** as tags
`<section>`, então a Home é protegida por inteiro mesmo com a seção aninhada da 5.1.

Além dos hashes, a guarda verifica que **continuam existindo**:

- **Seletores compartilhados** que a Home consome: `.screen`, `.screen.active`, `.btn`,
  `.btn-primary`, `.btn-sm`, `.text-muted`, `.history-status`
- **Variáveis CSS**: `--primary`, `--card-bg`, `--border-radius`, `--border-radius-sm`,
  `--text-main`, `--text-muted`, `--bg-color`, `--font-family`, `--nav-height`
- Os **textos exatos** das chaves i18n usadas na Home, em pt/en/es

## 2. O que é PERMITIDO

✅ Adicionar tags `<script src="...">` e `<link>` no HTML (fora do bloco da Home).
✅ Adicionar/alterar módulos em `js/`, `services/`, `tests/`.
✅ Alterar o **script principal** (as outras 8 telas, utilidades, dados mock).
✅ Adicionar uma linha `Persistence.save*()` dentro de funções que **não** são da Home.
✅ Alterar a Home **somente** com autorização explícita (ver seção 6) e reblindar via
`npm run test:update` ao final.

## 3. O que é PROIBIDO

🚫 Editar qualquer byte do bloco `<section id="screen-home">…</section>` sem autorização.
🚫 Editar as regras CSS congeladas da Home (seção 1).
🚫 Renomear/remover os seletores compartilhados ou as variáveis CSS acima.
🚫 Mudar os textos da Home em qualquer idioma sem autorização.
🚫 Inserir `<script>`/`<link>` **dentro** do bloco da Home.
🚫 Fazer a Home depender de `I18n.` / `Persistence.` / `StorageService.` / `TTUtils.` no markup.
🚫 Criar dados mockados para o resumo semanal (a faixa e os cards são **derivados**
de `state.history`).

> **Nota sobre o botão PT/EN:** continua com **2 estados** (`pt ↔ en`), exatamente como
> sempre foi. O idioma `es` existe em `js/i18n.js` e é aplicável via `I18n.setLocale('es')`.

## 4. Como a regra é verificada

```bash
npm run test:home     # guarda da Home (golden master)
npm test              # guarda da Home + testes unitários + smoke test de browser
```

Se `test:home` falhar com `HOME MUDOU -> ...`, a Home foi alterada sem autorização.
**Reverta a alteração** — ou, se a mudança foi aprovada, documente o escopo e reblindе.

## 5. Manutenção do golden master

Só use `npm run test:update` quando a mudança da Home foi **aprovada explicitamente**:
ele regrava `tests/home-golden.json` e "abençoa" a alteração.

## 6. Escopo aprovado na Sprint 5.1 (Home semanal)

Autorizado: transformar a Home em **resumo semanal real**, derivado de `state.history`,
sem conteúdo semanal mockado.

Novos elementos protegidos (além do bloco da Home):

- **Faixa semanal** `#home-weekly-strip` (`.weekly-strip`, `role="list"`):
  segunda→domingo da semana corrente; no máximo **um resumo por dia**; mostra a
  letra/nome do treino; com mais de um treino no dia, mostra o **último** e um
  contador de excedentes (`+N`); dias sem treino têm estado vazio (`no_workout`).
  Nome acessível por dia (`aria-label`) e nome da faixa resolvido de
  `data-i18n-label="weekly_strip_label"`.
- **Cardio da semana** `#home-cardio-value` (`.home-metric`): valor no formato
  `atingido / meta` (`0 / 150 min`, com a meta padrão de **150 min**). Só entram
  entradas com `category: "cardio"` ou `type: "cardio"`, somando `durationMin`.
  Sem cardio: `0 / 150 min`. A **legenda textual** da convenção
  (`atingido / meta`) foi removida do card na Sprint 5.1.4 (§11): o próprio valor
  comunica o progresso, e a legenda ocupava espaço no mobile.
- **Dias consecutivos** `#home-streak-value` (`.home-metric`): dias com pelo menos
  uma entrada `status: "completed"`; `partial` não conta; vários treinos no mesmo
  dia contam **um** dia.

Regras que a implementação **não** pode violar:

- Nada é inferido de textos legados (ex.: "Ontem"). Entradas sem `dateISO` válido
  ficam de fora dos recortes e não geram erro.
- Nenhuma métrica infere ou modifica dados antigos (leitura pura de `state.history`).
- O histórico detalhado (tela Histórico) permanece intacto.

Chaves i18n da 5.1 (pt/en/es, conjuntos consistentes): `weekly_summary`,
`weekly_strip_label`, `no_workout`, `workouts_count`, `cardio_week`, `cardio_goal`,
`consecutive_days`, `days`, `weekday_mon`…`weekday_sun`.

> `cardio_goal` continua **no dicionário** nos três idiomas (e é exigida pelo teste
> unitário de i18n), embora desde a 5.1.4 **não** seja mais exibida no markup da
> Home — mesmo critério já usado para `last_workout` e `home_no_history` na 5.1.2.

> As chaves usadas **dinamicamente** (dias, contadores, `no_workout`) não entram no
> snapshot `data-i18n` do golden; elas são protegidas pela consistência dos
> dicionários (teste unitário de i18n) e pelo smoke test de browser.

## 7. Escopo aprovado na Sprint 5.1.1 (cards de hoje e último treino)

Autorizado: **remover os dados mockados** do `card-highlight` e do card
`last-workout`, substituindo-os por dados **reais** derivados de `state.history`.
Nenhum fluxo novo foi criado e nenhuma métrica foi inventada.

| Card | Elementos dinâmicos | Origem do dado |
|---|---|---|
| **Treino de hoje** (`.card-highlight`) | `#home-today-name`, `#home-today-exercises`, `#home-today-duration` | `HomeInsights.todayWorkout(history, now)` |
| **Último treino** (`.last-workout`) — *substituído na 5.1.2 pela seção "Últimos treinos"* | `#home-last-name`, `#home-last-meta`, `#home-last-status` (não existem mais no markup) | `HomeInsights.lastWorkout(history, now)` |

Regras aprovadas:

- **Treino de hoje** = último registro cujo `dateISO` é o **dia da referência**
  (o último por `finishedAt`/`startedAt`/`id` se houver mais de um). Sem registro
  hoje → estado vazio localizado (`home_no_workout_today`), estatísticas neutras
  (`—`). O título do card deixou de ser um nome de treino mockado: virou o rótulo
  traduzido `today_workout` ("Treino de hoje"), e o nome real vem do histórico.
- **Último treino** = registro **mais recente com data confiável**: maior
  `dateISO`, empate resolvido pelo instante conhecido; acompanha `daysAgo`
  calculado em dias locais. Sem registro datado → estado vazio localizado
  (`home_no_history`).
- **Rótulo relativo** (`Hoje`/`Ontem`/`Há N dias`/data `dd/mm`) é sempre calculado
  a partir do `dateISO` e **nunca** do texto livre legado (ex.: "Ontem, 18:30") —
  entradas legadas sem `dateISO` não alimentam nenhum dos dois cards.
- **Um card, um registro**: cada resumo deriva de **um único** registro (nunca
  mistura nome/duração/contagem de execuções diferentes).
- **Selo de status** do último treino é **estado dinâmico** (`completed`/`partial`
  do registro). Por isso **não** tem `data-i18n`: uma associação estática era
  exatamente o que simulava um treino registrado — e seria reescrita por
  `applyTranslations()` depois do render.
- **Sem duplicação**: redesenhar a Home é leitura pura; o histórico não muda de
  tamanho nem de conteúdo por causa do render.
- O **histórico detalhado** (tela Histórico, `renderHistory`) permanece intacto e
  ainda exibe o `state.history` completo, inclusive o legado.

Chaves i18n da 5.1.1 (pt/en/es): `date_today`, `date_yesterday`, `date_days_ago`
(contém `{n}`), `home_no_workout_today`, `home_no_history`.

Continuam protegidas (fora desta sprint): a faixa semanal, o card de cardio, a
métrica de dias consecutivos, o layout responsivo (320 px sem rolagem horizontal),
a acessibilidade e o contrato de atualização (`navigate('home')`,
`saveSessionToHistory()` e `I18n.onChange`).

## 8. Cardio: modalidade na entrada do histórico

O resumo semanal reconhece cardio por `category: "cardio"` **ou** `type: "cardio"`
somando `durationMin`. Para que esse contrato funcione de ponta a ponta:

- `Persistence.sanitizeHistoryEntry` **preserva** `category`/`type`/`durationMin`
  (aditivo, retrocompatível) — sem isso a marcação se perderia na recarga.
- `WorkoutController.buildHistoryEntry` propaga `category`/`type` **quando a
  sessão já vem marcada** (aditivo; sessões sem marcação geram a mesma entrada).
- Entradas **sem** marcação nunca são classificadas por inferência; `durationMin`
  inválido não contamina a soma.
- **Fluxo ausente:** o app ainda **não** tem UI de cadastro/execução de cardio. A
  marcação só chega hoje por dados externos/semeados; quando o fluxo existir, ele
  deve marcar a sessão (ou a entrada) e nada mais precisa mudar.

## 9. Escopo aprovado na Sprint 5.1.2 (faixa "Últimos treinos")

Autorizado: **substituir a seção "Último Treino"** (um card único) pela seção
**"Últimos treinos"** — uma faixa horizontal com os últimos **treinos concluídos**.
O resto da Home (saudação, `card-highlight`, resumo semanal, faixa dos dias,
cardio, dias consecutivos, navegação inferior) permanece intacto.

| Elemento | Papel | Origem do dado |
|---|---|---|
| Título `#home-recent-title` | rótulo traduzido (`recent_workouts`) | i18n |
| Faixa `#home-recent-strip` (`.recent-strip`, `role="list"`, `tabindex="0"`) | lista rolável dos cards | `HomeInsights.recentCompletedWorkouts(history, 7, now)` |
| Card (`.recent-card`, `role="listitem"`) | nome + "quando • duração" + "N exercícios" | um único registro do histórico |
| Estado vazio `#home-recent-empty` (`.recent-empty`) | mensagem localizada (`no_recent_workouts`) | i18n |
| Botão "Ver histórico completo" | `onclick="navigate('history')"` (mesma rota da navegação inferior) | i18n (`see_full_history`) |

Regras aprovadas:

- **Só concluídos**: entra apenas `status === "completed"` (o status válido do
  modelo). `partial` e status desconhecido **nunca** são promovidos a concluído.
- **Só com data confiável**: a cronologia vem de `dateISO` válido. O texto livre do
  legado ("Ontem, 18:30") **nunca** vira data. Investigação registrada: os campos
  temporais reais de uma entrada são `dateISO` (data) e o instante conhecido
  (`finishedAt`/`startedAt`/`id`, este último `Date.now()` na criação). Como o `id`
  do legado não é confiável (usa `1`, `2`, ...), ele serve apenas como
  **desempate**, nunca como fonte de data.
- **Regra conservadora para o legado**: registro sem `dateISO` fica **fora** da
  faixa, mas **continua no histórico completo** — nada é apagado, reescrito ou
  inventado para "completar" os sete espaços. Com menos de sete concluídos, a faixa
  mostra menos cards; sem nenhum, mostra o estado vazio.
- **Ordem determinística** (mais recente primeiro): `dateISO` desc → instante
  conhecido desc (entrada sem instante vai depois) → ordem do histórico.
- **Um card, um registro**: nome, duração e contagem de exercícios saem do mesmo
  registro; campo ausente/inválido fica neutro (`—`/omissão), sem invenção.
- **Sem tela nova**: o acesso ao histórico reutiliza `navigate('history')` e a tela
  existente (filtros e comportamentos preservados).
- **Rolagem horizontal isolada**: `.recent-strip` tem `overflow-x: auto` com
  `scrollbar-width: thin` (mesmo padrão discreto da faixa semanal) e
  `scroll-snap-type: x proximity`; os cards **não encolhem** e o card seguinte
  aparece parcialmente (largura proporcional à faixa — ver §10, que refinou a base
  fixa de 168px da 5.1.2). A faixa **não**
  aumenta a largura da página (a rolagem vertical da Home segue normal) e é
  focável por teclado (`tabindex="0"`) com foco visível
  (`.recent-strip:focus-visible` → contorno de 2px na cor primária).
- **Sem carrossel automático**: a navegação é só do usuário (deslize, mouse,
  trackpad, Tab + setas).
- **Atualização**: usa o mecanismo já existente (`navigate('home')`,
  `saveSessionToHistory()`, `I18n.onChange`) — sem listener novo. O render é
  **leitura pura**: não grava, não duplica e não altera `state.history`.
- **Selo de status omitido de propósito**: como a seção só contém treinos
  concluídos, repetir "Concluído" em todos os cards não agrega informação; o selo
  dinâmico antigo (`home-last-status`) não reaparece como elemento estático.
- `HomeInsights.lastWorkout` **permanece** exportado e testado (a seção anterior
  era seu único consumidor na UI); sua remoção, se desejada, é escopo de outra
  sprint.

Chaves i18n da 5.1.2 (pt/en/es): `recent_workouts`, `recent_strip_label`,
`no_recent_workouts`, `see_full_history`, `exercises_count`, `exercises_count_one`
(forma singular, para não exibir "1 exercícios"). `last_workout` e
`home_no_history` continuam no dicionário, embora não sejam mais exibidas na Home.

Proteções afetadas (autorizadas nesta sprint):

- `tests/home-golden.json` **regenerado** (`npm run test:update`): muda o
  fingerprint do bloco da Home, entram 6 novos fingerprints CSS (`.recent-strip`,
  `.recent-strip:focus-visible`, `.recent-card`, `.recent-card-name`,
  `.recent-card-meta`, `.recent-empty`) e o snapshot de i18n da Home troca
  `last_workout` por `recent_workouts`, `no_recent_workouts` e `see_full_history`.
- `tests/home-guard.test.js`: `FROZEN_CSS` **cresce** com as novas regras. Nenhum
  fingerprint CSS existente foi removido, nenhum seletor compartilhado ou variável
  saiu da lista, e o guard continua exigindo todos eles.
- Nenhuma regra CSS, variável ou seletor já congelado foi alterado — a mudança é
  puramente aditiva na folha de estilo.

## 10. Escopo aprovado na Sprint 5.1.3 (refinamentos Média/Baixa)

Sprint de **auditoria + refino**: só foi alterado o que a inspeção ou um teste
demonstrou estar errado. Auditoria item por item:

| Item | Prioridade | Situação | Ação |
|---|---|---|---|
| M1 — regras temporais do resumo semanal | Média | Semântica correta e coberta; cobertura incompleta nas bordas (virada de mês/ano, meia-noite) | **Testes** novos (nenhuma regra de negócio mudou) + 1 correção real de raiz (abaixo) |
| M2 — acessibilidade da faixa de recentes | Média | Teclado/foco/rótulos/roles OK desde a 5.1.2; **"card seguinte à mostra" falhava em 390px** | **Correção** da largura do card (abaixo) + teste em 390px |
| M3 — semântica de quantidade/conteúdo dos cards | Média | Singular/plural, omissão de campo inválido e `dd/mm` OK; **rótulo acessível divergia do card** quando o registro não tem nome | **Correção** do rótulo (abaixo) + testes |
| B1 — convenção do `+N` na faixa semanal | Baixa | Convenção **clara e consistente** (código + doc + rótulo acessível) | Sem alteração; testes travam a semântica |
| B2 — estados vazios e histórico legado | Baixa | Contrato cumprido (nada inventado, legado preservado) | Sem alteração; teste novo prova que o legado segue no Histórico completo |

### M1 — auditoria temporal (nenhuma regra mudou)

Verificado e coberto: semana de segunda a domingo, virada de semana, semana
atravessando mês e ano, referência às 23:59:59 (mesmo dia local) e 00:00:01 (dia
seguinte), `dateISO` inválido ignorado, sequência contada uma vez por dia,
sequência sem treino hoje (tolerância de ontem) e sequência atravessando a virada
de semana. **`dateISO` é a única fonte do dia**; `startedAt`/`finishedAt` só
desempatam instantes (`finishedAt` → `startedAt` → `id`), nunca movem um treino de
dia. Dias consecutivos usam **todo** o histórico datado; a faixa semanal só os
dias da semana — comportamento intencional e agora testado em conjunto.

Correção real encontrada (raiz compartilhada, fora da Home mas na cadeia de datas
que a alimenta): `TTUtils.todayISO(date)` e `TTUtils.getWeekRange(date)` usavam
`date instanceof Date`. Quando a `Date` vem de **outro realm** (iframe, worker,
sandbox `vm` dos testes) esse teste é falso e o argumento era **ignorado em
silêncio**, devolvendo "hoje"/a semana corrente. Como `dateISO` de cada entrada
nasce de `U.todayISO(at)`, o efeito podia ser um `dateISO` errado — e a Home
( semana, sequência, faixa de recentes) lê exatamente esse campo. Agora existe
`TTUtils.toDate(value)` (sem `instanceof`, aceita `Date` de qualquer realm, epoch
e `"YYYY-MM-DD"`), usado pelos dois métodos — mesmo critério já adotado em
`js/home-insights.js` (`timeOf`). Nenhuma saída válida mudou; dois testes que
passavam **por coincidência** (só quando a semana corrente era a do fixture)
agora passam por construção, com semanas de 2020/2021.

### M2 — largura do card e "card seguinte à mostra" em 390px

Medição (Chrome emulado, faixa de 350px de conteúdo = viewport de 390px): com
cards de 168px cabiam dois cards inteiros e o terceiro começava **fora** da faixa
— nenhuma pista visual de que havia mais treinos (sem barra de rolagem visível em
toque). Correção: `.recent-card` passou de base fixa `168px` para
`flex: 0 0 calc((100% - 24px) / 2.25)`, com `min-width: 0`. A largura passa a ser
proporcional à faixa e a regra **garante** dois cards inteiros + o começo do
terceiro em qualquer largura (em 320px: ~112px; em 390px: ~143px). Nenhuma
propriedade de rolagem, foco, `role` ou `tabindex` mudou.

### M3 — rótulo acessível do card

O card visível mostrava o neutro localizado (`Sem treino`) quando o registro não
tem nome, mas o `aria-label` era montado a partir do campo cru e saía **sem
nome**, divergindo do que está na tela. Agora o **mesmo** valor (`name`, com o
neutro localizado de reserva) alimenta o texto visível e o rótulo acessível.
Aproveitou-se para separar o rótulo por vírgula (`Nome, Hoje, 37 min, 2
exercícios`): o separador visual `•` era anunciado como "bullet" pelos leitores de
tela. O que não existe no registro continua omitido — nenhum campo é inventado.

### B1 — `+N` (sem alteração)

Confirmado: `extra = count - 1` é o número de **excedentes além do treino
exibido** (o último do dia), e o dia mostra o último registro com contagem total
acessível no rótulo (`Dom 18: Treino C — Pernas, 3 treinos`). Convenção
consistente entre código, §6 deste documento e o rótulo acessível — mantida.
Verificado também em 320px: a faixa semanal continua rolável, as células têm
≥44px e a rolagem vertical da Home continua funcionando (a faixa não captura a
rotação de página).

### B2 — vazios e legado (sem alteração)

Nenhuma migração, nenhum dado reescrito. Teste novo comprova: com um histórico
misto (parcial + concluído + legado sem data + concluído antigo), o Histórico
completo renderiza **um card por registro persistido** (incluindo o legado) e a
faixa de recentes mostra apenas os concluídos com `dateISO` válido.

Proteções afetadas (autorizadas nesta sprint):

- `tests/home-golden.json` **regenerado** (`npm run test:update`) **apenas** por
  causa da regra `.recent-card`: comparando com o estado deixado pela 5.1.2, o
  guard acusou exclusivamente `css:.recent-card` e todos os outros fingerprints
  continuaram byte-idênticos (o `generatedAt`, claro, é reescrito). Nenhum
  fingerprint foi removido.
- `tests/home-guard.test.js`: `FROZEN_CSS` **não** foi mexido — o seletor
  `.recent-card` continua na lista, apenas com o hash da regra atualizado.

## 11. Escopo aprovado na Sprint 5.1.4 (legenda do cardio)

Autorizado: **remover somente o texto visível “atingido / meta”** exibido abaixo do
indicador `#home-cardio-value`. O valor (`0 / 150 min`) já comunica o progresso em
relação à meta e a legenda ocupava espaço desnecessário no mobile.

Auditoria de acessibilidade antes da remoção (motivo: a instrução pedia para manter a
acessibilidade caso o texto alimentasse algum rótulo):

| Verificação | Resultado |
|---|---|
| `<p>` da legenda possui `id`? | **Não** (não pode ser referenciado) |
| Algum `aria-labelledby`/`aria-describedby` aponta para ela? | **Não** — as únicas referências da Home são `home-recent-title` e `home-weekly-title` |
| Algum JS lê o elemento? | **Não** — `renderHome` escreve apenas em `#home-cardio-value` |
| Algum teste exigia o texto? | **Não** — nenhum teste citava `atingido / meta` |
| A chave `cardio_goal` tem outro consumidor? | **Não** — só o `data-i18n` da legenda removida |

Conclusão: o texto **não** era parte de nenhum rótulo acessível, então a remoção não
quebra leitura por leitor de tela: o card segue lendo (título localizado) +
(valor com a meta). Se o PO quiser paridade de leitor de tela, a alternativa de uma
linha é um `span.sr-only` (a classe `.sr-only` já existe no projeto) reutilizando a
chave `cardio_goal` — **não aplicada** por não ser exigida pelo escopo.

O que mudou (e só isso):

- Markup: removido apenas `<p class="home-metric-note" data-i18n="cardio_goal">`.
  Título (`cardio_week`), valor (`0 / 150 min`), cálculo, meta de 150 min,
  persistência e regras de negócio **intactos**; nenhum card foi reorganizado.
- CSS: `.home-metric-note` **permanece** na folha (não estava congelada, mas removê-la
  não estava autorizado; mesmo critério do `.last-workout` na 5.1.2).
- i18n: `cardio_goal` **continua no dicionário** nos três idiomas — as traduções
  seguem exigidas pelo teste unitário de i18n (KEYS51), então nenhuma proteção se
  perdeu.

Proteções afetadas (autorizadas nesta sprint):

- `tests/home-golden.json` **regenerado** (`npm run test:update`). Antes do reblind o
  guard acusou **exatamente**: `HOME MUDOU -> home` e `i18n[{pt,en,es}].cardio_goal`
  ausentes. **Nenhum** fingerprint CSS mudou e nenhum seletor/variável compartilhada
  saiu da lista.
- `tests/home-guard.test.js`: `FROZEN_CSS` inalterado. O conjunto de chaves i18n da
  Home é **derivado do markup**, então ele passa de 13 para 12 chaves — consequência
  automática da remoção autorizada, não remoção manual de proteção.
- Testes novos: 1 unitário (markup sem `home-metric-note`/`cardio_goal`, com título e
  valor presentes) e 3 no smoke (legenda ausente + título/valor intactos, ausência da
  legenda nos três idiomas com valor preservado, e 320 px com os dois cards de
  métrica lado a lado dentro da largura).
