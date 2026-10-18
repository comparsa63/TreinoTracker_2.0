/**
 * js/workout-session.js — Domínio da SESSÃO DE TREINO (Sprint 4 / E1).
 * ---------------------------------------------------------------------------
 * MÓDULO PURO de domínio:
 *   - não toca no DOM (nenhum `document`, `window` ou elemento);
 *   - não acessa `localStorage` nem qualquer storage;
 *   - não depende do `state` global da aplicação;
 *   - não persiste nada (quem grava é a `Persistence`, na E2);
 *   - não emite eventos (quem emite é quem orquestra o fluxo);
 *   - roda em Node sem DOM (testável em `tests/modules.test.js`).
 *
 * Responsabilidade única: manter as REGRAS da sessão (criar, concluir série,
 * navegar, pausar/retomar, finalizar, calcular progresso e sanitizar dados
 * recuperados). NÃO decide como salvar histórico nem como calcular PRs.
 *
 * Compatibilidade com o formato REAL já usado pelo app (verificado em
 * `startWorkoutSession()`, `completeSet()` e `saveSessionToHistory()`):
 *
 *   rotina : { id, letter, name, exercises: [{ catalogId, sets, reps, weight, rest }] }
 *
 *   sessão : shape produzido hoje pelo script principal —
 *            { routineId, routineName, letter, currentExerciseIndex,
 *              currentSetIndex, isFinished, startedAt,
 *              exercises: [{ catalogId, sets, reps, weight, rest,
 *                            name, muscle, img,
 *                            actualWeight, actualReps,
 *                            setsCompleted, completedSets }] }
 *
 * Campos ADITIVOS (não quebram o consumidor atual, que só lê os campos acima):
 *   session.id             identidade estável da sessão
 *   session.status         'active' | 'paused' | 'finished'  (estado canônico)
 *   session.isFinished     ESPELHO de status === 'finished'  (compat)
 *   session.pausedAt       instante da pausa atual (ou null)
 *   session.pausedMs       total de tempo pausado em ms
 *   session.finishedAt     instante da finalização (ou null)
 *   exercise.completedSets FONTE ÚNICA das séries concluídas
 *   exercise.setsCompleted ESPELHO de completedSets.length      (compat)
 *
 * API pública (module.exports + global.WorkoutSession):
 *   STATUS, create, completeSet, next, prev, pause, resume, finish,
 *   progress, sanitize, elapsedMs
 *
 * Diferenças documentadas em relação à proposta inicial (todas ADITIVAS):
 *   1. `create(routine, now, options)` — 3º parâmetro OPCIONAL
 *      `{ resolve(catalogId) -> {name, muscle, img} }`, para enriquecer o
 *      exercício sem acoplar o módulo ao `Catalog` (a UI injeta a função).
 *   2. `completeSet(session, set, now)` — 3º parâmetro OPCIONAL com o instante
 *      da conclusão, usado apenas quando a série encerra a sessão (mantém o
 *      módulo determinístico nos testes; sem ele, usa `Date.now()`).
 *   3. `elapsedMs(session, now)` — utilitário extra para que o cálculo de
 *      duração (regra 7) fique DENTRO do módulo e não seja reimplementado.
 *
 * Depende de (opcional): js/utils.js — usa `TTUtils.uid` se existir; caso
 * contrário, gera o id localmente. Nenhuma outra dependência.
 */
(function (global) {
  "use strict";

  const STATUS = { ACTIVE: "active", PAUSED: "paused", FINISHED: "finished" };
  const STATUSES = [STATUS.ACTIVE, STATUS.PAUSED, STATUS.FINISHED];

  // Defaults idênticos à sanitização de rotinas (js/persistence.js), para que
  // uma rotina não sanitizada produza a mesma sessão que uma sanitizada.
  const DEFAULT_SETS = 3;
  const DEFAULT_REPS = 10;
  const DEFAULT_REST = 60;

  // -------------------------------------------------------------------------
  // Helpers internos (sem efeito colateral fora do objeto recebido)
  // -------------------------------------------------------------------------

  function str(value) {
    if (typeof value === "string") return value;
    return value == null ? "" : String(value);
  }

  /** Número finito a partir de number ou string numérica ("12,5"). Senao null. */
  function toNum(value) {
    if (typeof value === "number") return isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
      const n = parseFloat(value.replace(",", "."));
      return isFinite(n) ? n : null;
    }
    return null;
  }

  /** Número com fallback (para dados vindos do disco). */
  function num(value, fallback) {
    const n = toNum(value);
    return n === null ? fallback : n;
  }

  /** Date de QUALQUER realm (vm/sandbox) ou objeto que exponha `getTime`. */
  function isDate(value) {
    return Object.prototype.toString.call(value) === "[object Date]" ||
      (!!value && typeof value === "object" && typeof value.getTime === "function");
  }

  /** ms a partir de Date | number | string ISO. Senao null. */
  function toMs(value) {
    if (isDate(value)) {
      const t = value.getTime();
      return isFinite(t) ? t : null;
    }
    if (typeof value === "number") return isFinite(value) ? value : null;
    if (typeof value === "string" && value !== "") {
      const t = Date.parse(value);
      return isNaN(t) ? null : t;
    }
    return null;
  }

  function toDate(value) {
    const ms = toMs(value);
    return ms === null ? null : new Date(ms);
  }

  /** Instante atual como Date (aceita Date/number/ISO; default = agora). */
  function nowDate(now) {
    return toDate(now) || new Date();
  }

  /** Id estável de sessão (delega ao TTUtils quando disponível). */
  function newId() {
    const u = global.TTUtils;
    if (u && typeof u.uid === "function") return u.uid("s");
    return "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Uma sessão só é válida se for objeto com `exercises` em array. */
  function isSession(session) {
    return !!session && typeof session === "object" &&
      !Array.isArray(session) && Array.isArray(session.exercises);
  }

  function currentExercise(session) {
    if (!isSession(session)) return null;
    const i = session.currentExerciseIndex;
    return (typeof i === "number" && i >= 0 && i < session.exercises.length)
      ? session.exercises[i]
      : null;
  }

  /** Normaliza um exercício de ROTINA (ou já de sessão) para o shape da sessão. */
  function normalizeExercise(raw, resolve) {
    if (!raw || typeof raw !== "object") return null;

    const catalogId = str(raw.catalogId || raw.id).trim();
    let name = str(raw.name || raw.nome);
    let muscle = str(raw.muscle || raw.grupo);
    let img = str(raw.img);

    if (resolve && catalogId) {
      let cat = null;
      try {
        cat = resolve(catalogId);
      } catch (err) {
        cat = null;
      }
      if (cat && typeof cat === "object") {
        name = str(cat.name) || name;
        muscle = str(cat.muscle) || muscle;
        img = str(cat.img) || img;
      }
    }

    // Sem identidade (nem id de catálogo nem nome) o exercício é descartado.
    if (!catalogId && !name) return null;

    const sets = Math.max(1, Math.round(num(raw.sets, DEFAULT_SETS)));
    const reps = Math.max(1, Math.round(num(raw.reps, DEFAULT_REPS)));
    const weight = Math.max(0, num(raw.weight, 0));
    const rest = Math.max(0, Math.round(num(raw.rest, DEFAULT_REST)));

    return {
      catalogId,
      name,
      muscle,
      img,
      sets,
      reps,
      weight,
      rest,
      actualWeight: Math.max(0, num(raw.actualWeight, weight)),
      actualReps: Math.max(1, Math.round(num(raw.actualReps, reps))),
      setsCompleted: 0,
      completedSets: [],
    };
  }

  /** Sanitiza uma SÉRIE concluída ({ weight, reps }). Rejeita o inválido. */
  function sanitizeSet(raw) {
    if (!raw || typeof raw !== "object") return null;
    const w = toNum(raw.weight != null ? raw.weight : raw.carga);
    const r = toNum(raw.reps != null ? raw.reps : raw.repeticoes);
    if (w === null || r === null) return null;
    return { weight: Math.max(0, w), reps: Math.max(0, Math.round(r)) };
  }

  /** Sanitiza um exercício já persistido (modo tolerante: corrige, não inventa). */
  function sanitizeSessionExercise(raw) {
    if (!raw || typeof raw !== "object") return null;

    const catalogId = str(raw.catalogId || raw.id).trim();
    const name = str(raw.name || raw.nome);
    if (!catalogId && !name) return null;

    const sets = Math.max(1, Math.round(num(raw.sets, DEFAULT_SETS)));
    const reps = Math.max(1, Math.round(num(raw.reps, DEFAULT_REPS)));
    const weight = Math.max(0, num(raw.weight, 0));

    // completedSets é a FONTE ÚNICA: séries sem carga/reps válidos não existem.
    const rawSets = Array.isArray(raw.completedSets) ? raw.completedSets : [];
    const completedSets = rawSets.map(sanitizeSet).filter(Boolean).slice(0, sets);

    return {
      catalogId,
      name,
      muscle: str(raw.muscle || raw.grupo),
      img: str(raw.img),
      sets,
      reps,
      weight,
      rest: Math.max(0, Math.round(num(raw.rest, DEFAULT_REST))),
      actualWeight: Math.max(0, num(raw.actualWeight, weight)),
      actualReps: Math.max(1, Math.round(num(raw.actualReps, reps))),
      setsCompleted: completedSets.length,
      completedSets,
    };
  }

  /** Mantém índices dentro dos limites (nunca "ultrapassa" — regra 5). */
  function clampIndices(session) {
    const exs = session.exercises;
    if (!exs.length) {
      session.currentExerciseIndex = 0;
      session.currentSetIndex = 1;
      return session;
    }
    const i = Math.round(num(session.currentExerciseIndex, 0));
    session.currentExerciseIndex = Math.min(Math.max(0, i), exs.length - 1);
    const ex = exs[session.currentExerciseIndex];
    const sets = Math.max(1, Math.round(num(ex.sets, 1)));
    const s = Math.round(num(session.currentSetIndex, 1));
    session.currentSetIndex = Math.min(Math.max(1, s), sets);
    return session;
  }

  /** Aplica a transição para FINISHED (espelha isFinished) — núcleo de finish(). */
  function applyFinish(session, now) {
    if (session.status === STATUS.FINISHED) return session; // idempotente
    const at = nowDate(now);
    if (session.status === STATUS.PAUSED) {
      const pausedAt = toMs(session.pausedAt);
      if (pausedAt !== null) {
        session.pausedMs = Math.max(0, num(session.pausedMs, 0)) + Math.max(0, at.getTime() - pausedAt);
      }
      session.pausedAt = null;
    }
    session.status = STATUS.FINISHED;
    session.isFinished = true;
    session.finishedAt = at;
    return session;
  }

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  const WorkoutSession = {
    STATUS,

    /**
     * Cria a sessão a partir de uma rotina REAL.
     * @param {Object} routine  { id, letter, name, exercises: [...] }
     * @param {Date|number|string} [now] instante de início (default: agora)
     * @param {Object} [options] { resolve?: (catalogId) => {name,muscle,img} }
     * @returns {Object|null} sessão no estado 'active' (ou null se a rotina não
     *          for um objeto). Rotina SEM exercícios é válida (progresso 0%).
     */
    create(routine, now, options) {
      if (!routine || typeof routine !== "object" || Array.isArray(routine)) return null;

      const opts = options || {};
      const resolve = typeof opts.resolve === "function" ? opts.resolve : null;
      const src = Array.isArray(routine.exercises) ? routine.exercises : [];
      const exercises = src.map(function (raw) {
        return normalizeExercise(raw, resolve);
      }).filter(Boolean);

      return {
        id: newId(),
        routineId: str(routine.id),
        routineName: str(routine.name),
        letter: str(routine.letter),
        status: STATUS.ACTIVE,
        isFinished: false,
        currentExerciseIndex: 0,
        currentSetIndex: 1,
        exercises,
        startedAt: nowDate(now),
        pausedAt: null,
        pausedMs: 0,
        finishedAt: null,
      };
    },

    /**
     * Registra UMA série concluída, com a carga/reps REAIS do momento.
     * Regras de validação (estritas — entrada de usuário):
     *   - a sessão precisa existir e estar 'active';
     *   - weight: número finito >= 0 (string numérica é aceita);
     *   - reps:   número finito >= 1;
     *   - o exercício atual não pode ter mais séries que o planejado.
     * Nenhuma dessas condições altera a sessão: rejeitam com `null`.
     * @returns {Object|null} a própria sessão (mutada) ou null se rejeitado
     */
    completeSet(session, set, now) {
      if (!isSession(session) || session.status !== STATUS.ACTIVE) return null;

      const ex = currentExercise(session);
      if (!ex) return null;

      const planned = Math.max(1, Math.round(num(ex.sets, 1)));
      if (ex.setsCompleted >= planned) return null; // não inventa série extra

      const input = set || {};
      const w = toNum(input.weight);
      const r = toNum(input.reps);
      if (w === null || w < 0) return null;   // carga inválida
      if (r === null || r < 1) return null;   // repetições inválidas

      if (!Array.isArray(ex.completedSets)) ex.completedSets = [];
      ex.completedSets.push({ weight: w, reps: Math.round(r) });
      ex.setsCompleted = ex.completedSets.length;   // espelho da fonte única

      if (ex.setsCompleted >= planned) {
        // Exercício esgotado: avança de exercício ou encerra a sessão.
        if (session.currentExerciseIndex < session.exercises.length - 1) {
          session.currentExerciseIndex += 1;
          const nextEx = session.exercises[session.currentExerciseIndex];
          session.currentSetIndex = Math.min(
            Math.max(1, Math.round(num(nextEx.setsCompleted, 0)) + 1),
            Math.max(1, Math.round(num(nextEx.sets, 1)))
          );
        } else {
          applyFinish(session, now);
        }
      } else {
        session.currentSetIndex = ex.setsCompleted + 1;
      }

      return session;
    },

    /** Avança para o próximo exercício. null se já está no último / inválido. */
    next(session) {
      if (!isSession(session) || session.status !== STATUS.ACTIVE) return null;
      if (session.exercises.length === 0) return null;
      if (session.currentExerciseIndex >= session.exercises.length - 1) return null;

      session.currentExerciseIndex += 1;
      const ex = session.exercises[session.currentExerciseIndex];
      session.currentSetIndex = Math.min(
        Math.max(1, Math.round(num(ex.setsCompleted, 0)) + 1),
        Math.max(1, Math.round(num(ex.sets, 1)))
      );
      return session;
    },

    /** Volta ao exercício anterior. null se já está no primeiro / inválido. */
    prev(session) {
      if (!isSession(session) || session.status !== STATUS.ACTIVE) return null;
      if (session.exercises.length === 0) return null;
      if (session.currentExerciseIndex <= 0) return null;

      session.currentExerciseIndex -= 1;
      const ex = session.exercises[session.currentExerciseIndex];
      session.currentSetIndex = Math.min(
        Math.max(1, Math.round(num(ex.setsCompleted, 0)) + 1),
        Math.max(1, Math.round(num(ex.sets, 1)))
      );
      return session;
    },

    /**
     * Pausa a sessão (registra `pausedAt`). Idempotente quando já pausada.
     * null se a sessão for inválida ou já estiver finalizada.
     */
    pause(session, now) {
      if (!isSession(session)) return null;
      if (session.status === STATUS.FINISHED) return null;
      if (session.status === STATUS.PAUSED) return session; // idempotente
      session.status = STATUS.PAUSED;
      session.pausedAt = nowDate(now);
      return session;
    },

    /**
     * Retoma a sessão (acumula `pausedMs` e limpa `pausedAt`).
     * Idempotente quando já está ativa. null se inválida ou finalizada.
     */
    resume(session, now) {
      if (!isSession(session)) return null;
      if (session.status === STATUS.FINISHED) return null;
      if (session.status === STATUS.ACTIVE) return session; // idempotente

      const at = nowDate(now);
      const pausedAt = toMs(session.pausedAt);
      if (pausedAt !== null) {
        session.pausedMs = Math.max(0, num(session.pausedMs, 0)) + Math.max(0, at.getTime() - pausedAt);
      }
      session.pausedAt = null;
      session.status = STATUS.ACTIVE;
      return session;
    },

    /**
     * Finaliza a sessão. IDEMPOTENTE: chamadas repetidas devolvem a MESMA
     * sessão, sem trocar `id` nem `finishedAt`. Se estava pausada, fecha a
     * pausa antes de encerrar. null se a sessão for inválida.
     */
    finish(session, now) {
      if (!isSession(session)) return null;
      return applyFinish(session, now);
    },

    /**
     * Progresso consistente (contagens + percentual válido 0..100).
     * Seguro para rotina vazia ou dados incompletos: nunca lança.
     */
    progress(session) {
      const empty = {
        totalExercises: 0,
        completedExercises: 0,
        totalSets: 0,
        completedSets: 0,
        currentExerciseIndex: 0,
        currentSetIndex: 1,
        percent: 0,
      };
      if (!isSession(session)) return empty;

      let totalSets = 0;
      let doneSets = 0;
      let doneExercises = 0;

      session.exercises.forEach(function (ex) {
        if (!ex || typeof ex !== "object") return;
        const sets = Math.max(0, Math.round(num(ex.sets, 0)));
        const done = Math.min(sets, Math.max(0, Math.round(num(ex.setsCompleted, 0))));
        totalSets += sets;
        doneSets += done;
        if (sets > 0 && done >= sets) doneExercises += 1;
      });

      const percent = totalSets > 0
        ? Math.max(0, Math.min(100, Math.round((doneSets / totalSets) * 100)))
        : 0;

      return {
        totalExercises: session.exercises.length,
        completedExercises: doneExercises,
        totalSets: totalSets,
        completedSets: doneSets,
        currentExerciseIndex: Math.max(0, Math.round(num(session.currentExerciseIndex, 0))),
        currentSetIndex: Math.max(1, Math.round(num(session.currentSetIndex, 1))),
        percent: percent,
      };
    },

    /**
     * Duração EFETIVA da sessão em ms, descontando o tempo pausado.
     * Usa `finishedAt` quando finalizada; senão, o instante `now`.
     * (Mantém o cálculo dentro do módulo — regra 7.)
     */
    elapsedMs(session, now) {
      if (!isSession(session)) return 0;
      const start = toMs(session.startedAt);
      if (start === null) return 0;

      const finished = toMs(session.finishedAt);
      const refMs = finished !== null ? finished : (toMs(now) !== null ? toMs(now) : Date.now());

      let paused = Math.max(0, num(session.pausedMs, 0));
      if (session.status === STATUS.PAUSED) {
        const pausedAt = toMs(session.pausedAt);
        if (pausedAt !== null) paused += Math.max(0, refMs - pausedAt);
      }
      return Math.max(0, refMs - start - paused);
    },

    /**
     * Valida/corrige uma sessão recuperada do disco.
     * REJEITA (null) estruturas que não podem ser uma sessão:
     *   - não-objeto, array, ou `exercises` que não seja array;
     *   - `startedAt` ausente/inválido;
     *   - status `finished` sem `finishedAt` válido (sem os dois instantes a
     *     duração gravada seria irrecuperável/corrompida).
     * CORRIGE o resto: descarta exercícios/séries inválidos, reclampa números,
     * sincroniza `setsCompleted` com `completedSets` (fonte única) e os índices.
     * @returns {Object|null}
     */
    sanitize(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      if (!Array.isArray(raw.exercises)) return null;

      const startedAt = toDate(raw.startedAt);
      if (!startedAt) return null;

      let status = STATUSES.indexOf(str(raw.status)) !== -1 ? str(raw.status) : null;
      if (status === null) status = raw.isFinished ? STATUS.FINISHED : STATUS.ACTIVE;

      const finishedAt = toDate(raw.finishedAt);
      if (status === STATUS.FINISHED && !finishedAt) return null;

      const pausedAt = toDate(raw.pausedAt);
      const exercises = raw.exercises.map(sanitizeSessionExercise).filter(Boolean);

      const session = {
        id: str(raw.id).trim() || newId(),
        routineId: str(raw.routineId),
        routineName: str(raw.routineName),
        letter: str(raw.letter),
        status: status,
        isFinished: status === STATUS.FINISHED,
        currentExerciseIndex: Math.max(0, Math.round(num(raw.currentExerciseIndex, 0))),
        currentSetIndex: Math.max(1, Math.round(num(raw.currentSetIndex, 1))),
        exercises: exercises,
        startedAt: startedAt,
        pausedAt: status === STATUS.PAUSED ? (pausedAt || startedAt) : null,
        pausedMs: Math.max(0, num(raw.pausedMs, 0)),
        finishedAt: finishedAt || null,
      };

      return clampIndices(session);
    },
  };

  global.WorkoutSession = WorkoutSession;
  if (typeof module !== "undefined" && module.exports) module.exports = WorkoutSession;
})(typeof globalThis !== "undefined" ? globalThis : this);
