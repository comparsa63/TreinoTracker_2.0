/**
 * js/workout-controller.js — CAMADA DE INTEGRAÇÃO da sessão de treino.
 * ---------------------------------------------------------------------------
 * Sprint 4 / E2. Faz a ponte entre:
 *
 *   UI (script principal)  <->  DOMÍNIO (js/workout-session.js)  <->  Persistência
 *
 * Por que existe:
 *   - o domínio (`WorkoutSession`) é PURO e recusa operações inválidas
 *     devolvendo `null` — sem direito a mensagem. A UI precisa de feedback
 *     claro ("rejeitada porque..."), então a tradução de recusa/erro para
 *     `{ ok, reason, message }` vive AQUI, sem alterar a API do domínio;
 *   - a gravação/limpeza da sessão em andamento é centralizada aqui, para que
 *     exista UMA fonte de verdade do ciclo de vida (a UI não chama
 *     `Persistence.saveSession`/`clearSession` em pontos espalhados);
 *   - a entrada de HISTÓRICO é construída aqui (função testável em Node),
 *     com identidade estável (`session.id`) e detecção de duplicidade.
 *
 * CONTRATO DA ENTRADA DE HISTÓRICO (revisado na E2 após auditoria):
 *   id        -> numérico (Date.now()), como sempre foi. Há consumidor que
 *                depende disso: `js/pr.js` (weeklyStreak) usa `new Date(h.id)`
 *                como fallback quando a entrada não tem `dateISO`.
 *   sessionId -> identidade ESTÁVEL da execução (`session.id`), aditiva e
 *                opcional. É o campo usado para reconhecer "a mesma execução"
 *                e impedir entrada duplicada, inclusive após recarga.
 *   dateISO   -> data local (YYYY-MM-DD) da execução; presente em toda entrada
 *                criada por este módulo.
 * O motor de PRs (js/pr.js) NÃO foi alterado: ele já é idempotente por
 * `workoutId` (que continua sendo `entry.id`, agora estável porque a entrada
 * só é criada uma vez por execução).
 *
 * Padrão de retorno (o mesmo de js/routine-actions.js):
 *   sucesso -> { ok: true,  reason: null, message: "", ... }
 *   recusa  -> { ok: false, reason: "<codigo>", message: "<pt-BR>", ... }
 *
 * Mensagens em pt-BR, como em `RoutineActions` (o app já usa strings pt-BR
 * diretas em toasts/modais e o dicionário i18n é fechado por chave).
 *
 * ÔNUS DE ESCOPO: NÃO inicia RestTimer nem Wake Lock (etapas seguintes).
 *
 * Depende de: js/workout-session.js (domínio), js/persistence.js (chave
 * `session`), js/utils.js (TTUtils). Nenhum acesso a DOM.
 */
(function (global) {
  "use strict";

  const VALID_HISTORY_STATUS = ["completed", "partial"];

  const MESSAGES = {
    unavailable: "Recursos de treino indisponíveis.",
    "no-session": "Nenhum treino em andamento.",
    "invalid-session": "Sessão de treino inválida.",
    "invalid-routine": "Rotina inválida para iniciar o treino.",
    "invalid-status": "Status de histórico inválido.",
    "no-exercise": "Não há exercício para concluir.",
    "invalid-set": "Informe carga (maior ou igual a 0) e repetições (maior ou igual a 1).",
    "exercise-complete": "Todas as séries deste exercício já foram concluídas.",
    "not-active": "O treino está pausado ou finalizado.",
    "at-start": "Você já está no primeiro exercício.",
    "at-end": "Você já está no último exercício.",
    "no-storage": "Não foi possível gravar a sessão de treino.",
    "duplicate-history": "Este treino já foi registrado no histórico.",
    "empty-history": "Nenhuma série concluída para salvar.",
  };

  // -------------------------------------------------------------------------
  // Acessores (sem estado próprio — nada de segunda fonte de verdade)
  // -------------------------------------------------------------------------

  function domain() {
    return global.WorkoutSession || null;
  }

  function persistence() {
    return global.Persistence || null;
  }

  function utils() {
    return global.TTUtils || null;
  }

  function fail(reason, message, session) {
    return {
      ok: false,
      reason: reason,
      message: message != null ? message : (MESSAGES[reason] || ""),
      session: session || null,
    };
  }

  function done(session, extra) {
    const res = { ok: true, reason: null, message: "", session: session || null };
    return extra ? Object.assign(res, extra) : res;
  }

  function toDate(value) {
    if (Object.prototype.toString.call(value) === "[object Date]") return value;
    if (typeof value === "number" && isFinite(value)) return new Date(value);
    if (typeof value === "string" && value !== "") {
      const t = Date.parse(value);
      if (!isNaN(t)) return new Date(t);
    }
    return null;
  }

  function exercisesOf(session) {
    return session && Array.isArray(session.exercises) ? session.exercises : null;
  }

  function currentExercise(session) {
    const exs = exercisesOf(session);
    if (!exs) return null;
    const i = session.currentExerciseIndex;
    return (typeof i === "number" && i >= 0 && i < exs.length) ? exs[i] : null;
  }

  function plannedSets(ex) {
    const n = Number(ex && ex.sets);
    return isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : 1;
  }

  /**
   * Identidade estável da execução, quando existir (sessões do domínio sempre
   * têm). Sessões sintéticas/legadas sem `id` devolvem null e são tratadas
   * com o comportamento antigo (sem deduplicação por identidade).
   * @returns {String|null}
   */
  function sessionKey(session) {
    if (!session || typeof session !== "object") return null;
    const id = session.id;
    if (typeof id === "string" && id.trim() !== "") return id.trim();
    if (typeof id === "number" && isFinite(id)) return String(id);
    return null;
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  const WorkoutController = {
    MESSAGES: MESSAGES,

    /** Duração efetiva (ms), descontando pausas — regra no domínio. */
    elapsedMs(session, now) {
      const W = domain();
      if (W && typeof W.elapsedMs === "function") return W.elapsedMs(session, now);
      // Fallback legado (apenas se o domínio não estiver carregado).
      const start = session ? toDate(session.startedAt) : null;
      const at = toDate(now) || new Date();
      if (!start) return 0;
      return Math.max(0, at.getTime() - start.getTime());
    },

    /** Progresso consistente (delegação). */
    progress(session) {
      const W = domain();
      if (W && typeof W.progress === "function") return W.progress(session);
      return { totalExercises: 0, completedExercises: 0, totalSets: 0, completedSets: 0, currentExerciseIndex: 0, currentSetIndex: 1, percent: 0 };
    },

    /**
     * Inicia uma sessão a partir de uma rotina real e JÁ a persiste.
     * @param {Object} routine rotina no formato do app
     * @param {Function} [resolve] `catalogItem` (id -> {name, muscle, img})
     * @param {Date|number|string} [now]
     */
    start(routine, resolve, now) {
      const W = domain();
      if (!W || typeof W.create !== "function") return fail("unavailable");
      const options = typeof resolve === "function" ? { resolve: resolve } : undefined;
      const session = W.create(routine, now, options);
      if (!session) return fail("invalid-routine");
      const res = done(session);
      res.persisted = WorkoutController.save(session).ok;
      return res;
    },

    /**
     * Persiste o progresso atual da sessão (chamado após cada alteração
     * relevante: série, navegação, ajuste de carga/reps, pausa, retomada).
     */
    save(session) {
      const W = domain();
      const P = persistence();
      if (!W || !P) return fail("unavailable", MESSAGES.unavailable, session);
      if (!session) return fail("no-session", MESSAGES["no-session"]);
      if (!W.sanitize(session)) return fail("invalid-session", MESSAGES["invalid-session"], session);
      return P.saveSession(session)
        ? done(session, { persisted: true })
        : fail("no-storage", MESSAGES["no-storage"], session);
    },

    /**
     * Descarta a sessão EM ANDAMENTO: remove a chave `session` da persistência.
     * Não finaliza a sessão no domínio (quem decide descartar é a UI) e não
     * toca em histórico, rotinas, catálogo ou PRs.
     */
    clear() {
      const P = persistence();
      if (!P) return fail("unavailable");
      return P.clearSession() ? done(null) : fail("no-storage");
    },

    /** Conclui uma série e persiste o progresso. */
    completeSet(session, set, now) {
      const W = domain();
      if (!W) return fail("unavailable");
      if (!session) return fail("no-session", MESSAGES["no-session"]);
      if (session.status === "paused" || session.status === "finished") {
        return fail("not-active", MESSAGES["not-active"], session);
      }
      const ex = currentExercise(session);
      if (!ex) return fail("no-exercise", MESSAGES["no-exercise"], session);
      if (Number(ex.setsCompleted) >= plannedSets(ex)) {
        return fail("exercise-complete", MESSAGES["exercise-complete"], session);
      }
      const out = W.completeSet(session, set, now);
      if (!out) return fail("invalid-set", MESSAGES["invalid-set"], session);

      const res = done(session, {
        isFinished: session.status === "finished",
        progress: W.progress(session),
      });
      res.persisted = WorkoutController.save(session).ok;
      return res;
    },

    /** Avança para o próximo exercício e persiste. */
    next(session) {
      const W = domain();
      if (!W) return fail("unavailable");
      if (!session) return fail("no-session", MESSAGES["no-session"]);
      const exs = exercisesOf(session);
      if (session.status !== "active") return fail("not-active", MESSAGES["not-active"], session);
      if (!exs || exs.length === 0) return fail("no-exercise", MESSAGES["no-exercise"], session);
      if (session.currentExerciseIndex >= exs.length - 1) return fail("at-end", MESSAGES["at-end"], session);
      if (!W.next(session)) return fail("at-end", MESSAGES["at-end"], session);
      const res = done(session);
      res.persisted = WorkoutController.save(session).ok;
      return res;
    },

    /** Volta ao exercício anterior e persiste. */
    prev(session) {
      const W = domain();
      if (!W) return fail("unavailable");
      if (!session) return fail("no-session", MESSAGES["no-session"]);
      const exs = exercisesOf(session);
      if (session.status !== "active") return fail("not-active", MESSAGES["not-active"], session);
      if (!exs || exs.length === 0) return fail("no-exercise", MESSAGES["no-exercise"], session);
      if (session.currentExerciseIndex <= 0) return fail("at-start", MESSAGES["at-start"], session);
      if (!W.prev(session)) return fail("at-start", MESSAGES["at-start"], session);
      const res = done(session);
      res.persisted = WorkoutController.save(session).ok;
      return res;
    },

    /** Pausa a sessão e persiste o estado pausado. */
    pause(session, now) {
      const W = domain();
      if (!W) return fail("unavailable");
      if (!session) return fail("no-session", MESSAGES["no-session"]);
      if (session.status === "finished") return fail("not-active", MESSAGES["not-active"], session);
      if (!W.pause(session, now)) return fail("invalid-session", MESSAGES["invalid-session"], session);
      const res = done(session);
      res.persisted = WorkoutController.save(session).ok;
      return res;
    },

    /** Retoma a sessão pausada e persiste o retorno a `active`. */
    resume(session, now) {
      const W = domain();
      if (!W) return fail("unavailable");
      if (!session) return fail("no-session", MESSAGES["no-session"]);
      if (session.status === "finished") return fail("not-active", MESSAGES["not-active"], session);
      if (!W.resume(session, now)) return fail("invalid-session", MESSAGES["invalid-session"], session);
      const res = done(session);
      res.persisted = WorkoutController.save(session).ok;
      return res;
    },

    /**
     * Finaliza a sessão (idempotente no domínio) e REMOVE a persistência:
     * depois de finalizada não há mais nada para retomar.
     */
    finish(session, now) {
      const W = domain();
      if (!W) return fail("unavailable");
      if (!session) return fail("no-session", MESSAGES["no-session"]);
      if (!W.finish(session, now)) return fail("invalid-session", MESSAGES["invalid-session"], session);
      const res = done(session, { elapsedMs: W.elapsedMs(session, now) });
      res.cleared = WorkoutController.clear().ok;
      return res;
    },

    // -----------------------------------------------------------------------
    // Integração com o HISTÓRICO (idempotente)
    // -----------------------------------------------------------------------

    /** Identidade estável da execução (ver `sessionKey`). */
    sessionKey: sessionKey,

    /**
     * O histórico já contém esta execução?
     * Compara por `sessionId` (identidade estável). Entradas legadas — sem
     * `sessionId` — nunca são consideradas "esta execução", pois são de uma
     * época em que a execução não era identificável.
     * @returns {Boolean}
     */
    hasHistoryEntry(history, session) {
      const key = sessionKey(session);
      if (!key) return false;
      const list = Array.isArray(history) ? history : [];
      return list.some((h) => h && (h.sessionId === key || String(h.id) === key));
    },

    /**
     * Monta a entrada de histórico de uma sessão.
     * Formato IDÊNTICO ao que a UI sempre gravou (nome, rotina, data, duração,
     * exercícios com as séries EFETIVAMENTE concluídas):
     *   - `id` continua numérico (`Date.now()`) — contrato preservado;
     *   - `sessionId` é acrescentado (aditivo) com a identidade ESTÁVEL da
     *     execução, que é o que permite recusar entrada duplicada.
     * Sessões sem `id` estável não recebem `sessionId` e mantêm o
     * comportamento antigo (sem deduplicação).
     * @returns {Object|null} null se não houver o que salvar / dados inválidos
     */
    buildHistoryEntry(session, status, now) {
      if (!session || !Array.isArray(session.exercises)) return null;
      if (VALID_HISTORY_STATUS.indexOf(status) === -1) return null;

      // Só as séries EFETIVAMENTE concluídas entram no histórico (Fase 2C).
      const exercises = session.exercises.map((ex) => ({
        catalogId: ex.catalogId || null,
        name: ex.name || "",
        muscle: ex.muscle || "",
        sets: (Array.isArray(ex.completedSets) ? ex.completedSets : [])
          .map((st) => ({ weight: Number(st.weight) || 0, reps: Number(st.reps) || 0 })),
      })).filter((ex) => ex.sets.length > 0);

      const completedExercises = exercises.length ||
        session.exercises.filter((ex) => ex.setsCompleted > 0).length;
      if (completedExercises === 0 && status === "partial") return null;

      const at = toDate(now) || new Date();
      const U = utils();
      const pad2 = U && U.pad2 ? U.pad2 : (n) => String(n).padStart(2, "0");
      const durationMin = Math.max(0, Math.round(WorkoutController.elapsedMs(session, at) / 60000));
      const dateStr = at.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

      const entry = {
        id: Date.now(),
        name: "Treino " + (session.letter || "") + " — " + (session.routineName || ""),
        routineId: session.routineId || null,
        letter: session.letter || null,
        date: dateStr + ", " + at.getHours() + ":" + pad2(at.getMinutes()),
        dateISO: U && U.todayISO ? U.todayISO(at) : at.toISOString().slice(0, 10),
        durationMin: durationMin,
        duration: durationMin > 0 ? (U && U.formatDuration ? U.formatDuration(durationMin) : durationMin + " min") : "-- min",
        status: status,
        exercises: exercises,
      };

      const key = sessionKey(session);
      if (key) entry.sessionId = key;

      return entry;
    },

    /**
     * Prepara a gravação no histórico SEM efeitos colaterais: devolve a nova
     * lista (com a entrada à frente) ou recusa por duplicidade/vazio.
     * Quem persiste (`Persistence.saveHistory`), calcula PRs e emite eventos é
     * a UI — mantendo o fluxo atual, mas com identidade estável.
     * @returns {{ok:boolean, reason:string|null, message:string, entry:Object|null,
     *            history:Array, duplicated:boolean}}
     */
    appendToHistory(history, session, status, now) {
      const list = Array.isArray(history) ? history : [];
      if (status !== "completed" && status !== "partial") {
        return Object.assign(fail("invalid-status", MESSAGES["invalid-status"], session), { history: list, entry: null, duplicated: false });
      }
      const entry = WorkoutController.buildHistoryEntry(session, status, now);
      if (!entry) {
        return Object.assign(fail("empty-history", MESSAGES["empty-history"], session), { history: list, entry: null, duplicated: false });
      }
      if (WorkoutController.hasHistoryEntry(list, session)) {
        return Object.assign(fail("duplicate-history", MESSAGES["duplicate-history"], session), { history: list, entry: null, duplicated: true });
      }
      return {
        ok: true,
        reason: null,
        message: "",
        entry: entry,
        history: [entry].concat(list),
        duplicated: false,
        session: session,
      };
    },
  };

  global.WorkoutController = WorkoutController;
  if (typeof module !== "undefined" && module.exports) module.exports = WorkoutController;
})(typeof globalThis !== "undefined" ? globalThis : this);
