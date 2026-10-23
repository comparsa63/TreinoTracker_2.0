/**
 * js/home-insights.js — Leituras PURAS do histórico para a Home semanal (5.1).
 * ---------------------------------------------------------------------------
 * Módulo puro e testável: recebe o histórico e a data de referência de forma
 * EXPLÍCITA e devolve números/listas já derivados. Não acessa DOM, não acessa
 * armazenamento, não fala com a rede, não conhece `state` e não inventa dados.
 *
 * Regras da Sprint 5.1
 * --------------------
 *  1. A semana vai de SEGUNDA a DOMINGO e é a que contém a data de referência.
 *  2. Só entram nos recortes temporais entradas com `dateISO` válido. Registros
 *     legados (ex.: "Ontem, 18:30") continuam no histórico, mas são IGNORADOS —
 *     nunca inferidos a partir de texto.
 *  3. Um dia pode ter vários treinos. A faixa mostra o ÚLTIMO (por
 *     `finishedAt`/`startedAt`/`id`) e sinaliza os excedentes ("+N"); para a
 *     contagem de dias o dia vale 1.
 *  4. Cardio = entrada com `category === "cardio"` OU `type === "cardio"`,
 *     somando `durationMin`. Toda entrada sem essa marcação é treino de força
 *     e NÃO entra no total de cardio.
 *  5. Dias consecutivos = dias com pelo menos uma entrada `status === "completed"`
 *     (parcial não conta), contados de trás para frente a partir da referência,
 *     com tolerância de UM dia: quem ainda não treinou hoje mantém a sequência
 *     conquistada até ontem. Qualquer falha na sequência zera o contador.
 *  6. "Treino de hoje" (card de destaque) = ÚLTIMO registro do DIA da referência.
 *     Sem registro no dia, devolve `null`: a UI mostra estado vazio localizado em
 *     vez de inventar treino. Cada resumo vem de UM ÚNICO registro — nunca
 *     mistura campos de execuções diferentes.
 *  7. "Último treino" = registro mais recente com data CONFIÁVEL (maior
 *     `dateISO`; empate pelo instante conhecido), acompanhado de `daysAgo`
 *     calculado em dias locais. Registro legado sem `dateISO` NÃO é inferido:
 *     o rótulo relativo ("Hoje"/"Ontem") sai sempre de uma data confiável.
 *
 * Regras da Sprint 5.1.2
 * ----------------------
 *  8. "Últimos treinos" = no máximo `RECENT_LIMIT` (7) registros com
 *     `status === "completed"` (o status válido do modelo), do mais recente para
 *     o mais antigo. Parcial NÃO entra; nada é inventado para "completar" a
 *     faixa; com menos de 7 concluídos, devolve menos itens.
 *  9. Cronologia SÓ com campo temporal real (`dateISO`); o desempate usa o
 *     instante conhecido (`finishedAt`/`startedAt`/`id`) e, por fim, a ordem do
 *     histórico. Textos livres ("Ontem", "Segunda") NUNCA viram data. Registro
 *     sem `dateISO` fica FORA da faixa — continua no histórico completo, que não
 *     é alterado por nenhuma leitura daqui.
 *
 * O recorte de tempo NÃO reescreve nada: é leitura derivada, sempre a partir do
 * histórico recebido.
 */
(function (global) {
  "use strict";

  /** Meta semanal padrão de cardio (minutos). */
  const DEFAULT_CARDIO_GOAL = 150;

  /** Quantos treinos concluídos a faixa "Últimos treinos" mostra (Sprint 5.1.2). */
  const RECENT_LIMIT = 7;

  /**
   * Status de conclusão VÁLIDO do modelo atual (a lista de status aceitos vive
   * em `js/persistence.js`). Exigimos o valor explícito: um registro parcial — ou
   * um status desconhecido — nunca é promovido a concluído só para preencher a
   * faixa.
   */
  const COMPLETED_STATUS = "completed";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** Data local em ISO curto: "2026-10-18". */
  function isoOf(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  /** Converte "YYYY-MM-DD" em Date local à meia-noite, ou null se inválida. */
  function parseISO(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(5, 7));
    const d = Number(value.slice(8, 10));
    const date = new Date(y, m - 1, d);
    const ok = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    return ok ? date : null;
  }

  function startOfDay(date) {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Segunda-feira da semana que contém `date` (cópia, à meia-noite). */
  function startOfWeek(date) {
    const d = startOfDay(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  /**
   * Instante em ms de um Date/epoch — SEM `instanceof Date`: um Date criado em
   * outro realm (ex.: o sandbox `vm` dos testes) não é `instanceof` o Date local.
   * Devolve NaN quando o valor não representa um instante (aí o chamador decide).
   */
  function timeOf(value) {
    if (value && typeof value.getTime === "function") return value.getTime();
    if (typeof value === "number" && isFinite(value)) return value;
    return NaN;
  }

  /** Data de referência normalizada; sem `now` válido, usa o agora (fallback). */
  function reference(now) {
    const t = timeOf(now);
    return startOfDay(isFinite(t) ? new Date(t) : new Date());
  }

  /** Só entradas-objeto com `dateISO` válido participam dos recortes de tempo. */
  function dated(history) {
    return (Array.isArray(history) ? history : []).filter(function (entry) {
      return !!entry && typeof entry === "object" && !!parseISO(entry.dateISO);
    });
  }

  /**
   * Instante conhecido da entrada (`finishedAt`/`startedAt`/`id`) em ms, ou NaN.
   * É o `stamp` sem o desempate por índice: aqui "não sei o instante" precisa ser
   * distinguível de "o índice é 3".
   */
  function instantOf(entry) {
    const raw = entry.finishedAt || entry.startedAt || entry.id;
    const t = timeOf(raw);
    if (isFinite(t)) return t;
    const parsed = Date.parse(raw);
    return isFinite(parsed) ? parsed : NaN;
  }

  /** Instante conhecido da entrada (para saber qual foi o ÚLTIMO treino do dia). */
  function stamp(entry, index) {
    const t = instantOf(entry);
    return isFinite(t) ? t : index;
  }

  /** Última entrada por instante conhecido; empate resolve pela ordem do array. */
  function latest(entries) {
    return entries.reduce(function (best, entry, index) {
      if (!best) return { entry: entry, index: index };
      return stamp(entry, index) >= stamp(best.entry, best.index)
        ? { entry: entry, index: index }
        : best;
    }, null);
  }

  function isCardio(entry) {
    return entry.category === "cardio" || entry.type === "cardio";
  }

  function cardioMinutes(entry) {
    const value = Number(entry.durationMin);
    return isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  /** Os sete dias (segunda→domingo) da semana de `refDate`, com marca de "hoje". */
  function weekDays(refDate) {
    const start = startOfWeek(refDate);
    const today = isoOf(refDate);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(start.getTime());
      date.setDate(start.getDate() + i);
      const dateISO = isoOf(date);
      days.push({
        dateISO: dateISO,
        dayOfMonth: date.getDate(),
        weekdayIndex: i,
        isToday: dateISO === today,
      });
    }
    return days;
  }

  /**
   * Dias consecutivos com treino CONCLUÍDO, terminando na referência (ou em
   * ontem, se hoje ainda não houve treino). Parcial não conta; vários treinos no
   * mesmo dia contam como um único dia.
   */
  function consecutiveDays(entries, refDate) {
    const completed = new Set();
    entries.forEach(function (entry) {
      if (entry.status === "completed") completed.add(entry.dateISO);
    });
    const cursor = new Date(refDate.getTime());
    if (!completed.has(isoOf(cursor))) cursor.setDate(cursor.getDate() - 1);
    let total = 0;
    while (completed.has(isoOf(cursor))) {
      total++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return total;
  }

  /**
   * Resumo de UMA entrada do histórico (nunca mistura registros diferentes).
   * Campos ausentes/inválidos viram neutros (`0` / vazio) para a UI decidir o que
   * mostrar — nada é inventado.
   */
  function summaryOf(entry) {
    const exercises = Array.isArray(entry.exercises) ? entry.exercises : [];
    const duration = Number(entry.durationMin);
    return {
      entry: entry,
      name: typeof entry.name === "string" ? entry.name : "",
      exercises: exercises.length,
      durationMin: isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
      status: entry.status === "partial" ? "partial" : "completed",
    };
  }

  /**
   * Treino REGISTRADO no dia da referência (o último, se houve mais de um) ou
   * `null` quando ainda não há registro hoje.
   * @returns {{entry:Object, name:string, exercises:number, durationMin:number,
   *            status:string}|null}
   */
  function todayWorkout(history, now) {
    const refDate = reference(now);
    const todayISO = isoOf(refDate);
    const ofDay = dated(history).filter(function (entry) {
      return entry.dateISO === todayISO;
    });
    const chosen = latest(ofDay);
    return chosen ? summaryOf(chosen.entry) : null;
  }

  /**
   * Registro mais recente com data CONFIÁVEL + `daysAgo` (dias locais até a
   * referência). Devolve `null` sem nenhum registro datado — legado sem
   * `dateISO` é ignorado, não inferido.
   * @returns {{entry:Object, dateISO:string, daysAgo:number, name:string,
   *            exercises:number, durationMin:number, status:string}|null}
   */
  function lastWorkout(history, now) {
    const refDate = reference(now);
    const entries = dated(history);
    if (!entries.length) return null;

    let chosen = entries[0];
    let chosenIndex = 0;
    entries.forEach(function (entry, index) {
      if (index === 0) return;
      if (entry.dateISO > chosen.dateISO ||
          (entry.dateISO === chosen.dateISO && stamp(entry, index) >= stamp(chosen, chosenIndex))) {
        chosen = entry;
        chosenIndex = index;
      }
    });

    const day = parseISO(chosen.dateISO);
    const daysAgo = Math.max(0, Math.round((refDate.getTime() - day.getTime()) / 86400000));
    return Object.assign(summaryOf(chosen), { dateISO: chosen.dateISO, daysAgo: daysAgo });
  }

  /**
   * Últimos treinos CONCLUÍDOS, do mais recente para o mais antigo (Sprint 5.1.2).
   *
   * - Só entra `status === "completed"` (parcial/desconhecido fica fora).
   * - Só entra registro com `dateISO` VÁLIDO: cronologia sai de campo temporal
   *   real, nunca do texto livre do legado ("Ontem", "Segunda"). Registro sem
   *   data confiável não aparece aqui nem é reescrito — segue no histórico.
   * - Desempate determinístico: instante conhecido (`finishedAt`/`startedAt`/`id`)
   *   desc, e por fim a ordem do histórico (a entrada que aparece antes na lista —
   *   que o app mantém do mais novo para o mais antigo — fica na frente).
   * - Devolve no máximo `limit` itens (padrão `RECENT_LIMIT`); com menos
   *   concluídos devolve menos itens, sem inventar registros.
   * - Não modifica o histórico recebido (trabalha numa lista nova).
   *
   * @param {Array} history
   * @param {number} [limit=7]
   * @param {Date} now data de referência (explícita)
   * @returns {Array<{entry:Object, dateISO:string, daysAgo:number, name:string,
   *                  exercises:number, durationMin:number, status:string}>}
   */
  function recentCompletedWorkouts(history, limit, now) {
    const refDate = reference(now);
    const wanted = Number(limit);
    const max = isFinite(wanted) && wanted > 0 ? Math.floor(wanted) : RECENT_LIMIT;

    const candidates = [];
    (Array.isArray(history) ? history : []).forEach(function (entry, index) {
      if (!entry || typeof entry !== "object") return;
      if (entry.status !== COMPLETED_STATUS) return;
      const day = parseISO(entry.dateISO);
      if (!day) return;
      candidates.push({ entry: entry, index: index, day: day });
    });

    candidates.sort(function (a, b) {
      if (a.entry.dateISO !== b.entry.dateISO) {
        return a.entry.dateISO < b.entry.dateISO ? 1 : -1;
      }
      const ta = instantOf(a.entry);
      const tb = instantOf(b.entry);
      const knownA = isFinite(ta);
      const knownB = isFinite(tb);
      if (knownA && knownB && ta !== tb) return tb - ta;
      if (knownA !== knownB) return knownA ? -1 : 1;
      return a.index - b.index;
    });

    return candidates.slice(0, max).map(function (item) {
      const daysAgo = Math.max(0, Math.round((refDate.getTime() - item.day.getTime()) / 86400000));
      return Object.assign(summaryOf(item.entry), {
        dateISO: item.entry.dateISO,
        daysAgo: daysAgo,
      });
    });
  }

  /**
   * Monta o resumo semanal.
   * @param {Array} history  histórico (qualquer formato; legado é ignorado)
   * @param {Date}  now      data de referência (explícita)
   * @param {number} [cardioGoal] meta semanal em minutos (padrão 150)
   * @returns {{weekStartISO:string, weekEndISO:string, days:Array,
   *            cardioMinutes:number, cardioGoal:number, consecutiveDays:number}}
   */
  function build(history, now, cardioGoal) {
    const refDate = reference(now);
    const entries = dated(history);
    const days = weekDays(refDate);
    const weekISO = new Set(days.map(function (d) { return d.dateISO; }));
    const weekly = entries.filter(function (e) { return weekISO.has(e.dateISO); });

    const goal = Number(cardioGoal);
    const safeGoal = isFinite(goal) && goal > 0 ? Math.round(goal) : DEFAULT_CARDIO_GOAL;

    return {
      weekStartISO: days[0].dateISO,
      weekEndISO: days[6].dateISO,
      days: days.map(function (day) {
        const ofDay = weekly.filter(function (e) { return e.dateISO === day.dateISO; });
        const chosen = latest(ofDay);
        return {
          dateISO: day.dateISO,
          dayOfMonth: day.dayOfMonth,
          weekdayIndex: day.weekdayIndex,
          isToday: day.isToday,
          count: ofDay.length,
          extra: Math.max(0, ofDay.length - 1),
          entry: chosen ? chosen.entry : null,
        };
      }),
      cardioMinutes: weekly.filter(isCardio).reduce(function (total, e) {
        return total + cardioMinutes(e);
      }, 0),
      cardioGoal: safeGoal,
      consecutiveDays: consecutiveDays(entries, refDate),
    };
  }

  const HomeInsights = {
    DEFAULT_CARDIO_GOAL: DEFAULT_CARDIO_GOAL,
    RECENT_LIMIT: RECENT_LIMIT,
    startOfWeek: startOfWeek,
    weekDays: weekDays,
    build: build,
    todayWorkout: todayWorkout,
    lastWorkout: lastWorkout,
    recentCompletedWorkouts: recentCompletedWorkouts,
  };

  global.HomeInsights = HomeInsights;
  if (typeof module !== "undefined" && module.exports) module.exports = HomeInsights;
})(typeof globalThis !== "undefined" ? globalThis : this);
