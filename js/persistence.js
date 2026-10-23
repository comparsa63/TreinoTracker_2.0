/**
 * js/persistence.js — Hidratação e gravação do estado da aplicação.
 * ---------------------------------------------------------------------------
 * Liga o `state` em memória (do script principal) ao StorageService.
 * Carregado DEPOIS do script principal e executado ANTES do DOMContentLoaded,
 * garantindo que a app já inicialize com os dados salvos.
 *
 * Chaves persistidas (namespace `tt_ds_v1_`):
 *   routines  -> lista de rotinas do usuário
 *   history   -> histórico de treinos concluídos/parciais (enriquecido na Fase 2C
 *                com exercícios, séries concluídas, carga/reps e duração;
 *                `sessionId` (Sprint 4) identifica a execução de origem, sendo
 *                `id` mantido numérico por retrocompatibilidade)
 *   prs       -> recordes pessoais (engine js/pr.js)
 *   lang      -> idioma ativo (compartilhado com js/i18n.js)
 *   autoRest  -> preferência do toggle de descanso automático
 *   session   -> sessão de treino EM ANDAMENTO (Sprint 4). Aditiva: as chaves
 *                acima continuam com o mesmo formato e a mesma versão 1.
 *
 * Depende de: services/storage.js, js/utils.js, js/i18n.js
 *             js/workout-session.js (apenas para a chave `session`)
 */
(function (global) {
  "use strict";

  const KEYS = { routines: "routines", history: "history", prs: "prs", lang: "lang", autoRest: "autoRest", session: "session" };
  // v1: histórico passou a guardar exercícios/séries concluídas e PRs de forma
  // ADITIVA e retrocompatível (entradas antigas continuam válidas). Não houve
  // mudança de formato que exija migração, por isso a versão permanece 1.
  // (Sprint 4: a chave `session` também é aditiva — nada existente mudou.)
  const SCHEMA_VERSION = 1;
  const VALID_STATUS = ["completed", "partial"];

  function store() {
    return global.StorageService || null;
  }

  function utils() {
    return global.TTUtils || null;
  }

  function i18n() {
    return global.I18n || null;
  }

  /**
   * Módulo de domínio da sessão (js/workout-session.js).
   * A validação/correção da sessão recuperada é responsabilidade do domínio:
   * a Persistence NÃO reimplementa essas regras (fonte única).
   */
  function sessionModule() {
    return global.WorkoutSession || null;
  }

  /**
   * Resolve o `state` global da app.
   * ATENÇÃO: `state` é declarado com `let` no script principal, portanto vive
   * no escopo léxico global e NÃO como propriedade de `window`. Só o
   * identificador direto (com guarda de TDZ) o alcança.
   */
  function appState() {
    try {
      return typeof state !== "undefined" && state ? state : null;
    } catch (err) {
      return null;
    }
  }

  function toNumber(value, fallback) {
    const u = utils();
    const n = u ? u.parseNumber(value) : parseFloat(value);
    return n === null || !isFinite(n) ? fallback : n;
  }

  function str(value, fallback) {
    return typeof value === "string" && value.trim() !== "" ? value : fallback;
  }

  // -------------------------------------------------------------------------
  // Sanitização (dados vêm do disco: nunca confiar)
  // -------------------------------------------------------------------------

  function sanitizeExercise(raw) {
    if (!raw || typeof raw !== "object") return null;
    const catalogId = str(raw.catalogId || raw.id, null);
    if (!catalogId) return null;
    return {
      catalogId,
      sets: Math.max(1, Math.round(toNumber(raw.sets, 3))),
      reps: Math.max(1, Math.round(toNumber(raw.reps, 10))),
      weight: Math.max(0, toNumber(raw.weight, 0)),
      rest: Math.max(0, Math.round(toNumber(raw.rest, 60))),
    };
  }

  function sanitizeRoutine(raw, index) {
    if (!raw || typeof raw !== "object") return null;
    const letter = str(raw.letter, String.fromCharCode(65 + index));
    const id = str(raw.id, "r" + letter);
    const exercises = Array.isArray(raw.exercises)
      ? raw.exercises.map(sanitizeExercise).filter(Boolean)
      : [];
    return { id, letter, name: str(raw.name, "Treino " + letter), exercises };
  }

  function sanitizeRoutines(raw) {
    if (!Array.isArray(raw)) return null;
    return raw.map(sanitizeRoutine).filter(Boolean);
  }

  function sanitizeHistoryEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = str(raw.name, null);
    if (!name) return null;
    const entry = {
      id: raw.id == null ? Date.now() : raw.id,
      name,
      date: str(raw.date, ""),
      duration: str(raw.duration, "-- min"),
      status: VALID_STATUS.indexOf(raw.status) !== -1 ? raw.status : "completed",
    };
    // Campos enriquecidos (Fase 2C) - opcionais e retrocompatíveis.
    if (str(raw.dateISO, null)) entry.dateISO = raw.dateISO;
    if (raw.durationMin != null) {
      entry.durationMin = Math.max(0, Math.round(toNumber(raw.durationMin, 0)));
    }
    if (str(raw.routineId, null)) entry.routineId = raw.routineId;
    if (str(raw.letter, null)) entry.letter = raw.letter;
    // Sprint 5.1: marcadores de MODALIDADE (aditivos). Sem eles o cardio seria
    // reconhecido no resumo semanal em memória, mas perderia a marcação ao
    // recarregar a página — e a leitura semanal ficaria errada após o reload.
    if (str(raw.category, null)) entry.category = raw.category;
    if (str(raw.type, null)) entry.type = raw.type;
    // Sprint 4: identidade estável da execução (aditiva). Precisa sobreviver ao
    // round-trip para que a deduplicação continue valendo após uma recarga.
    if (str(raw.sessionId, null)) entry.sessionId = raw.sessionId;
    const exercises = sanitizeHistoryExercises(raw.exercises);
    if (exercises && exercises.length) entry.exercises = exercises;
    const prs = sanitizePRBadges(raw.prs);
    if (prs && prs.length) entry.prs = prs;
    return entry;
  }

  function sanitizeSet(raw) {
    if (!raw || typeof raw !== "object") return null;
    const weight = Math.max(0, toNumber(raw.weight, toNumber(raw.carga, 0)));
    const sourceReps = raw.reps != null ? raw.reps : raw.repeticoes;
    const parsedReps = toNumber(sourceReps, null);
    // Histórico enriquecido só representa séries efetivamente concluídas.
    // Não promover `0` para `1` preserva os dados válidos sem inventar série.
    if (parsedReps === null || parsedReps < 1) return null;
    const reps = Math.round(parsedReps);
    return { weight, reps };
  }

  function sanitizeHistoryExercise(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = str(raw.name || raw.nome, null);
    if (!name) return null;
    const sets = Array.isArray(raw.sets)
      ? raw.sets.map(sanitizeSet).filter(Boolean)
      : (Array.isArray(raw.series) ? raw.series.map(sanitizeSet).filter(Boolean) : []);
    return {
      catalogId: str(raw.catalogId, null),
      name,
      muscle: str(raw.muscle || raw.grupo, ""),
      sets,
    };
  }

  function sanitizeHistoryExercises(raw) {
    if (!Array.isArray(raw)) return null;
    return raw.map(sanitizeHistoryExercise).filter(Boolean);
  }

  function sanitizePRBadges(raw) {
    if (!Array.isArray(raw)) return null;
    return raw.map((p) => {
      if (!p || typeof p !== "object") return null;
      const type = str(p.type, null);
      if (!type) return null;
      return { type, value: toNumber(p.value, 0) };
    }).filter(Boolean);
  }

  function sanitizeHistory(raw) {
    if (!Array.isArray(raw)) return null;
    return raw.map(sanitizeHistoryEntry).filter(Boolean);
  }

  function sanitizePRRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    const exerciseKey = str(raw.exerciseKey || raw.exerciseName, null);
    const type = str(raw.type, null);
    if (!exerciseKey || !type) return null;
    return {
      id: raw.id == null ? exerciseKey + "_" + type : raw.id,
      exerciseKey,
      exerciseName: str(raw.exerciseName, exerciseKey),
      type,
      value: toNumber(raw.value, 0),
      oldValue: toNumber(raw.oldValue, 0),
      diff: toNumber(raw.diff, 0),
      workoutId: raw.workoutId == null ? null : raw.workoutId,
      workoutDate: str(raw.workoutDate, ""),
      createdAt: str(raw.createdAt, ""),
    };
  }

  function sanitizePRs(raw) {
    if (!Array.isArray(raw)) return null;
    return raw.map(sanitizePRRecord).filter(Boolean);
  }

  /**
   * Sessão em andamento. Delega TODA a validação ao domínio
   * (`WorkoutSession.sanitize`): a Persistence não duplica as regras.
   * @returns {Object|null} null quando ausente/corrompida ou sem o módulo.
   */
  function sanitizeSession(raw) {
    const ws = sessionModule();
    if (!ws || typeof ws.sanitize !== "function") return null;
    return ws.sanitize(raw);
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  const Persistence = {
    KEYS,
    SCHEMA_VERSION,

    isEnabled() {
      const s = store();
      return !!(s && s.isPersistent());
    },

    /**
     * Aplica os dados salvos sobre o `state` em memória.
     * Só sobrescreve quando a chave EXISTE no storage (assim um histórico ou
     * lista de rotinas vazia — escolha legítima do usuário — é respeitada).
     * @returns {{restored: string[], skipped: string[]}}
     */
    hydrate(target) {
      const st = target || null;
      const s = store();
      const result = { restored: [], skipped: [] };
      if (!st || !s) return result;

      // Rotinas
      if (s.has(KEYS.routines)) {
        const routines = sanitizeRoutines(s.load(KEYS.routines, null));
        if (routines) {
          st.routines = routines;
          result.restored.push("routines(" + routines.length + ")");
        } else {
          result.skipped.push("routines");
        }
      } else {
        result.skipped.push("routines");
      }

      // Histórico
      if (s.has(KEYS.history)) {
        const history = sanitizeHistory(s.load(KEYS.history, null));
        if (history) {
          st.history = history;
          result.restored.push("history(" + history.length + ")");
        } else {
          result.skipped.push("history");
        }
      } else {
        result.skipped.push("history");
      }

      // Idioma (mesma chave usada por I18n)
      if (s.has(KEYS.lang)) {
        const lang = s.load(KEYS.lang, null);
        if (i18n() && i18n().LOCALES.indexOf(lang) !== -1) {
          st.lang = lang;
          result.restored.push("lang:" + lang);
        } else {
          result.skipped.push("lang");
        }
      } else {
        result.skipped.push("lang");
      }

      // Descanso automático
      if (s.has(KEYS.autoRest)) {
        const flag = s.load(KEYS.autoRest, null);
        if (typeof flag === "boolean") {
          st.autoRestEnabled = flag;
          result.restored.push("autoRest:" + flag);
        } else {
          result.skipped.push("autoRest");
        }
      } else {
        result.skipped.push("autoRest");
      }

      // Sessão de treino em andamento (Sprint 4). Corrompida -> ignorada
      // (a chave só é removida por `clearSession`/`reset`, nunca na leitura).
      if (s.has(KEYS.session)) {
        const session = sanitizeSession(s.load(KEYS.session, null));
        if (session) {
          st.session = session;
          result.restored.push("session(" + session.exercises.length + "ex, " + session.status + ")");
        } else {
          result.skipped.push("session");
        }
      } else {
        result.skipped.push("session");
      }

      return result;
    },

    saveRoutines(routines) {
      const s = store();
      if (!s) return false;
      const clean = sanitizeRoutines(routines);
      if (!clean) return false;
      return s.save(KEYS.routines, clean);
    },

    saveHistory(history) {
      const s = store();
      if (!s) return false;
      const clean = sanitizeHistory(history);
      if (!clean) return false;
      return s.save(KEYS.history, clean);
    },

    /** Lê os recordes pessoais (PRs). Sempre devolve um array. */
    loadPRs() {
      const s = store();
      if (!s) return [];
      const clean = sanitizePRs(s.load(KEYS.prs, []));
      return Array.isArray(clean) ? clean : [];
    },

    savePRs(records) {
      const s = store();
      if (!s) return false;
      const clean = sanitizePRs(records);
      if (!clean) return false;
      return s.save(KEYS.prs, clean);
    },

    saveLang(lang) {
      const s = store();
      if (!s) return false;
      const i = i18n();
      if (i && i.LOCALES.indexOf(lang) === -1) return false;
      return s.save(KEYS.lang, lang);
    },

    saveAutoRest(enabled) {
      const s = store();
      if (!s) return false;
      return s.save(KEYS.autoRest, !!enabled);
    },

    /**
     * Lê a sessão de treino em andamento já sanitizada pelo domínio.
     * @returns {Object|null}
     */
    loadSession() {
      const s = store();
      if (!s) return null;
      return sanitizeSession(s.load(KEYS.session, null));
    },

    /**
     * Persiste a sessão em andamento. Uma sessão inválida NUNCA é gravada
     * (evita gravar lixo que depois não poderia ser recuperado com segurança).
     */
    saveSession(session) {
      const s = store();
      if (!s) return false;
      const clean = sanitizeSession(session);
      if (!clean) return false;
      return s.save(KEYS.session, clean);
    },

    /**
     * Remove a sessão em andamento. Não toca em histórico, rotinas, catálogo
     * nem PRs — apenas a chave `session`.
     */
    clearSession() {
      const s = store();
      if (!s) return false;
      s.remove(KEYS.session);
      return true;
    },

    /** Grava tudo de uma vez (usado no bootstrap pós-hidratação, se preciso). */
    saveAll(target) {
      const st = target || null;
      if (!st) return false;
      Persistence.saveRoutines(st.routines || []);
      Persistence.saveHistory(st.history || []);
      Persistence.saveLang(st.lang);
      Persistence.saveAutoRest(st.autoRestEnabled);
      return true;
    },

    /** Apaga apenas os dados da app (mantém o idioma, preferência do usuário). */
    reset() {
      const s = store();
      if (!s) return false;
      s.remove(KEYS.routines);
      s.remove(KEYS.history);
      s.remove(KEYS.prs);
      s.remove(KEYS.autoRest);
      s.remove(KEYS.session);
      return true;
    },

    /**
     * Bootstrap: hidrata o estado global e sincroniza a UI de idioma.
     * Deve ser chamado uma única vez, antes do DOMContentLoaded da app.
     */
    init(target) {
      const st = target || appState() || global.state || null;
      const result = Persistence.hydrate(st);
      const i = i18n();
      if (i) i.syncDocument(i.getLocale());
      if (global.console && console.info) {
        console.info(
          "[Persistence] restaurado: " +
            (result.restored.length ? result.restored.join(", ") : "nada") +
            (Persistence.isEnabled() ? "" : " (storage indisponível: modo memória)")
        );
      }
      return result;
    },
  };

  global.Persistence = Persistence;
  if (typeof module !== "undefined" && module.exports) module.exports = Persistence;
})(typeof globalThis !== "undefined" ? globalThis : this);
