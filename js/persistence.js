/**
 * js/persistence.js — Hidratação e gravação do estado da aplicação.
 * ---------------------------------------------------------------------------
 * Liga o `state` em memória (do script principal) ao StorageService.
 * Carregado DEPOIS do script principal e executado ANTES do DOMContentLoaded,
 * garantindo que a app já inicialize com os dados salvos.
 *
 * Chaves persistidas (namespace `tt_ds_v1_`):
 *   routines  -> lista de rotinas do usuário
 *   customExercises -> exercícios personalizados do usuário (Sprint 5.2.1)
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
 *             js/catalog.js (fonte oficial de grupos/nomes para a sanitização
 *             de `customExercises`)
 *             js/workout-session.js (apenas para a chave `session`)
 *             js/custom-exercises.js (apenas para a chave `customExercises`)
 */
(function (global) {
  "use strict";

  const KEYS = {
    routines: "routines",
    customExercises: "customExercises",
    history: "history",
    prs: "prs",
    lang: "lang",
    autoRest: "autoRest",
    session: "session",
  };
  // v1: histórico passou a guardar exercícios/séries concluídas e PRs de forma
  // ADITIVA e retrocompatível (entradas antigas continuam válidas). Não houve
  // mudança de formato que exija migração, por isso a versão permanece 1.
  // (Sprint 4: a chave `session` também é aditiva — nada existente mudou.)
  // (Sprint 5.2.1: `customExercises` é aditiva — o schema continua 1.)
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
   * Módulo de domínio dos exercícios personalizados (js/custom-exercises.js).
   * A Persistence não reimplementa a sanitização: o domínio é a fonte única
   * das regras de id/nome/grupo e da deduplicação dos dados carregados.
   */
  function customExercisesModule() {
    return global.CustomExercises || null;
  }

  /**
   * Fonte oficial única para validar os personalizados hidratados:
   * grupos principais e nomes do catálogo oficial. O catálogo é carregado
   * antes da Persistence; se não estiver disponível, a sanitização falha
   * fechada (retorna null) em vez de aceitar dados sem validação.
   */
  function catalogModule() {
    return global.Catalog || null;
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

  /**
   * Detecta se um exercício válido precisou de normalização (defaults,
   * arredondamento ou coerção). Não conta o descarte: exercício inválido é
   * contabilizado separadamente por quem chama.
   */
  function exerciseWasNormalized(raw, clean) {
    if (!raw || typeof raw !== "object") return false;
    if (typeof raw.sets !== "number" || !isFinite(raw.sets) || raw.sets !== clean.sets) return true;
    if (typeof raw.reps !== "number" || !isFinite(raw.reps) || raw.reps !== clean.reps) return true;
    if (typeof raw.weight !== "number" || !isFinite(raw.weight) || raw.weight !== clean.weight) return true;
    if (typeof raw.rest !== "number" || !isFinite(raw.rest) || raw.rest !== clean.rest) return true;
    // Formato legado: o exercício trazia `id` em vez de `catalogId`.
    if (!str(raw.catalogId, null) && str(raw.id, null)) return true;
    return false;
  }

  /**
   * Sanitiza rotinas e informa o que foi descartado/normalizado. A saída é
   * idêntica à de `sanitizeRoutines`; o relatório existe para que `saveAll`
   * não apresente como sucesso integral uma gravação que perdeu exercícios.
   */
  function sanitizeRoutinesWithReport(raw) {
    if (!Array.isArray(raw)) {
      return { ok: false, value: null, discarded: 0, normalized: 0, reason: "invalid-payload" };
    }
    let discarded = 0;
    let normalized = 0;
    const value = [];
    raw.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        discarded++;
        return;
      }
      const clean = sanitizeRoutine(item, index);
      if (!clean) {
        discarded++;
        return;
      }
      if (!str(item.letter, null) || !str(item.id, null) || !str(item.name, null)) {
        normalized++;
      }
      if (Array.isArray(item.exercises)) {
        item.exercises.forEach((ex) => {
          const cleanEx = sanitizeExercise(ex);
          if (!cleanEx) discarded++;
          else if (exerciseWasNormalized(ex, cleanEx)) normalized++;
        });
      } else if (item.exercises != null) {
        // Presente, mas fora do formato de lista: a lista é descartada.
        discarded++;
      } else {
        // Ausente vira [] na saída: normalização estrutural, sem perda.
        normalized++;
      }
      value.push(clean);
    });
    return { ok: true, value, discarded, normalized, reason: null };
  }

  function sanitizeRoutines(raw) {
    const report = sanitizeRoutinesWithReport(raw);
    return report.ok ? report.value : null;
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

  /**
   * Sanitiza o histórico preservando o mesmo formato de `sanitizeHistory` e
   * contabilizando entradas/campos descartados ou normalizados. Assim o
   * `saveAll` não declara sucesso integral quando houve perda silenciosa.
   */
  function sanitizeHistoryWithReport(raw) {
    if (!Array.isArray(raw)) {
      return { ok: false, value: null, discarded: 0, normalized: 0, reason: "invalid-payload" };
    }
    let discarded = 0;
    let normalized = 0;
    const value = [];
    raw.forEach((item) => {
      if (!item || typeof item !== "object" || !str(item.name, null)) {
        discarded++;
        return;
      }
      const clean = sanitizeHistoryEntry(item);
      if (!clean) {
        discarded++;
        return;
      }
      if (item.id == null || !str(item.date, null) || !str(item.duration, null) ||
          VALID_STATUS.indexOf(item.status) === -1) {
        normalized++;
      }
      if (item.durationMin != null &&
          (typeof item.durationMin !== "number" || !isFinite(item.durationMin) ||
           clean.durationMin !== item.durationMin)) {
        normalized++;
      }
      if (Array.isArray(item.exercises)) {
        item.exercises.forEach((rawEx) => {
          const cleanEx = sanitizeHistoryExercise(rawEx);
          if (!cleanEx) {
            discarded++;
            return;
          }
          const rawSets = Array.isArray(rawEx.sets)
            ? rawEx.sets
            : (Array.isArray(rawEx.series) ? rawEx.series : null);
          if (rawSets) {
            if (rawSets.length > cleanEx.sets.length) {
              discarded += rawSets.length - cleanEx.sets.length;
            }
          } else if (rawEx.sets != null || rawEx.series != null) {
            discarded++;
          }
        });
      } else if (item.exercises != null) {
        discarded++;
      }
      if (Array.isArray(item.prs)) {
        const cleanPrs = sanitizePRBadges(item.prs);
        const kept = cleanPrs ? cleanPrs.length : 0;
        if (item.prs.length > kept) discarded += item.prs.length - kept;
      } else if (item.prs != null) {
        discarded++;
      }
      value.push(clean);
    });
    return { ok: true, value, discarded, normalized, reason: null };
  }

  function sanitizeHistory(raw) {
    const report = sanitizeHistoryWithReport(raw);
    return report.ok ? report.value : null;
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

  function sanitizePRsWithReport(raw) {
    if (!Array.isArray(raw)) {
      return { ok: false, value: null, discarded: 0, normalized: 0, reason: "invalid-payload" };
    }
    let discarded = 0;
    let normalized = 0;
    const value = [];
    raw.forEach((item) => {
      const clean = sanitizePRRecord(item);
      if (!clean) {
        discarded++;
        return;
      }
      if (item.id == null || !str(item.exerciseKey, null) ||
          typeof item.value !== "number" || typeof item.oldValue !== "number" ||
          typeof item.diff !== "number") {
        normalized++;
      }
      value.push(clean);
    });
    return { ok: true, value, discarded, normalized, reason: null };
  }

  function sanitizePRs(raw) {
    const report = sanitizePRsWithReport(raw);
    return report.ok ? report.value : null;
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

  /**
   * Executa a sanitização de exercícios personalizados e devolve também o
   * relatório do domínio (descartes, normalizações e motivo de falha).
   * A fonte oficial é sempre o catálogo carregado antes da Persistence.
   * @returns {{
   *   ok: boolean,
   *   value: Array|null,
   *   discarded: number,
   *   normalized: number,
   *   reason: string|null
   * }}
   */
  function customExercisesSanitizeReport(raw) {
    const cx = customExercisesModule();
    const catalog = catalogModule();
    const unavailable = {
      ok: false, value: null, discarded: 0, normalized: 0, reason: "unavailable",
    };
    if (!cx || !catalog) return unavailable;

    const groups = typeof catalog.groups === "function" ? catalog.groups() : null;
    if (!Array.isArray(groups) || groups.length === 0) {
      return { ok: false, value: null, discarded: 0, normalized: 0, reason: "missing-groups" };
    }

    const officialNames = typeof catalog.all === "function" ? catalog.all() : [];
    if (typeof cx.sanitizeWithReport === "function") {
      return cx.sanitizeWithReport(raw, { groups, officialNames });
    }
    if (typeof cx.sanitize !== "function") return unavailable;

    // Compatibilidade com uma versão anterior do domínio (sem relatório).
    const value = cx.sanitize(raw, { groups, officialNames });
    if (!Array.isArray(value)) {
      return { ok: false, value: null, discarded: 0, normalized: 0, reason: "invalid-payload" };
    }
    const discarded = Array.isArray(raw) ? Math.max(0, raw.length - value.length) : 0;
    return { ok: true, value, discarded, normalized: 0, reason: null };
  }

  /**
   * Exercícios personalizados. Mantém o contrato de leitura (array ou null)
   * delegando ao domínio, que é a fonte única de validação.
   * @returns {Array|null} null quando inválido, sem módulo ou sem catálogo.
   */
  function sanitizeCustomExercises(raw) {
    const report = customExercisesSanitizeReport(raw);
    return report.ok ? report.value : null;
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  /** Relatório padrão de uma gravação (mesmo shape para todas as chaves). */
  function writeReport() {
    return {
      ok: false,
      status: "validation-error",
      durable: false,
      accepted: null,
      stored: null,
      discarded: 0,
      normalized: 0,
      reason: null,
    };
  }

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
     * `discarded`/`normalized` tornam explícitos os ajustes feitos na
     * sanitização dos exercícios personalizados.
     * @returns {{restored: string[], skipped: string[], discarded: string[], normalized: string[]}}
     */
    hydrate(target) {
      const st = target || null;
      const s = store();
      const result = { restored: [], skipped: [], discarded: [], normalized: [] };
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

      // Exercícios personalizados (Sprint 5.2.1). A chave é aditiva: dados de
      // versões anteriores simplesmente não existem e o estado segue intacto.
      if (s.has(KEYS.customExercises)) {
        const report = customExercisesSanitizeReport(s.load(KEYS.customExercises, null));
        if (report.ok) {
          st.customExercises = report.value;
          result.restored.push("customExercises(" + report.value.length + ")");
          if (report.discarded > 0) {
            result.discarded.push("customExercises(" + report.discarded + ")");
          }
          if (report.normalized > 0) {
            result.normalized.push("customExercises(" + report.normalized + ")");
          }
        } else {
          result.skipped.push("customExercises");
        }
      } else {
        result.skipped.push("customExercises");
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

    /**
     * Persiste rotinas e informa o que realmente aconteceu.
     *
     * O retorno é o mesmo contrato de `saveCustomExercises`: `status "saved"`
     * só quando nada foi descartado/normalizado; `"normalized"` quando a
     * gravação é durável mas perdeu/ajustou dados; `"memory"` quando só a
     * memória foi atualizada; `"storage-error"` quando o backend ativo falhou.
     * Em `storage-error` não há fallback em memória, para que o estado
     * carregado não divirja do resultado reportado.
     *
     * @returns {{ok:boolean,status:string,durable:boolean,accepted:Array|null,stored:Array|null,discarded:number,normalized:number,reason:string|null}}
     */
    saveRoutinesWithReport(routines) {
      const result = writeReport();
      const s = store();
      if (!s) {
        result.status = "unavailable";
        result.reason = "unavailable";
        return result;
      }

      const report = sanitizeRoutinesWithReport(routines);
      result.discarded = report.discarded;
      result.normalized = report.normalized;
      if (!report.ok) {
        result.reason = report.reason || "invalid-payload";
        return result;
      }

      result.accepted = report.value;
      const storageAvailable = Persistence.isEnabled();
      const saved = s.save(KEYS.routines, report.value, {
        memoryFallback: !storageAvailable,
      });

      if (saved) {
        result.stored = report.value;
        result.durable = true;
        if (report.discarded > 0 || report.normalized > 0) {
          result.status = "normalized";
          result.reason = "normalized";
        } else {
          result.status = "saved";
          result.ok = true;
        }
        return result;
      }

      if (!storageAvailable) {
        result.status = "memory";
        result.stored = report.value;
        result.reason = "memory";
        return result;
      }

      result.status = "storage-error";
      result.reason = "storage-error";
      return result;
    },

    /** Compatibilidade: true somente quando a gravação foi durável. */
    saveRoutines(routines) {
      const result = Persistence.saveRoutinesWithReport(routines);
      return result.status === "saved" || result.status === "normalized";
    },

    /** Lê os exercícios personalizados já sanitizados. Sempre devolve array. */
    loadCustomExercises() {
      const s = store();
      if (!s) return [];
      const clean = sanitizeCustomExercises(s.load(KEYS.customExercises, []));
      return Array.isArray(clean) ? clean : [];
    },

    /**
     * Persiste exercícios personalizados e informa o que realmente aconteceu.
     *
     * Contrato:
     *   status "saved"             -> gravação durável, sem descarte/normalização
     *   status "normalized"        -> gravação durável após normalização/descarte
     *   status "validation-error"  -> payload inválido; nada foi gravado
     *   status "storage-error"     -> backend ativo recusou a gravação
     *   status "memory"            -> fallback em memória; NÃO é durável
     *   status "unavailable"       -> StorageService indisponível
     *
     * `ok` é true somente em "saved". `accepted` é a lista saneada; `stored`
     * é a lista efetivamente aceita pelo armazenamento (null quando não houve
     * gravação). Em "storage-error" não há fallback em memória, evitando
     * divergência entre estado, interface e storage.
     *
     * @returns {{ok:boolean,status:string,durable:boolean,accepted:Array|null,stored:Array|null,discarded:number,normalized:number,reason:string|null}}
     */
    saveCustomExercises(customExercises) {
      const result = {
        ok: false,
        status: "validation-error",
        durable: false,
        accepted: null,
        stored: null,
        discarded: 0,
        normalized: 0,
        reason: null,
      };
      const s = store();
      if (!s) {
        result.status = "unavailable";
        result.reason = "unavailable";
        return result;
      }

      const report = customExercisesSanitizeReport(customExercises);
      result.discarded = report.discarded;
      result.normalized = report.normalized;
      if (!report.ok) {
        result.reason = report.reason || "invalid-payload";
        return result;
      }

      // Um array com conteúdo mas sem nenhum registro válido não pode apagar
      // silenciosamente os dados já persistidos: é falha de validação.
      if (Array.isArray(customExercises) && customExercises.length > 0 &&
          report.value.length === 0) {
        result.reason = "invalid-records";
        return result;
      }

      const clean = report.value;
      result.accepted = clean;
      const storageAvailable = Persistence.isEnabled();
      const saved = s.save(KEYS.customExercises, clean, {
        // Em modo memória o fallback é a única cópia disponível; com backend
        // ativo, uma falha não deve criar uma cópia divergente na memória.
        memoryFallback: !storageAvailable,
      });

      if (saved) {
        result.stored = clean;
        result.durable = true;
        if (report.discarded > 0 || report.normalized > 0) {
          result.status = "normalized";
          result.reason = "normalized";
        } else {
          result.status = "saved";
          result.ok = true;
        }
        return result;
      }

      if (!storageAvailable) {
        result.status = "memory";
        result.stored = clean;
        result.reason = "memory";
        return result;
      }

      result.status = "storage-error";
      result.reason = "storage-error";
      return result;
    },

    saveHistoryWithReport(history) {
      const result = writeReport();
      const s = store();
      if (!s) {
        result.status = "unavailable";
        result.reason = "unavailable";
        return result;
      }

      const report = sanitizeHistoryWithReport(history);
      result.discarded = report.discarded;
      result.normalized = report.normalized;
      if (!report.ok) {
        result.reason = report.reason || "invalid-payload";
        return result;
      }

      result.accepted = report.value;
      const storageAvailable = Persistence.isEnabled();
      const saved = s.save(KEYS.history, report.value, {
        memoryFallback: !storageAvailable,
      });

      if (saved) {
        result.stored = report.value;
        result.durable = true;
        if (report.discarded > 0 || report.normalized > 0) {
          result.status = "normalized";
          result.reason = "normalized";
        } else {
          result.status = "saved";
          result.ok = true;
        }
        return result;
      }

      if (!storageAvailable) {
        result.status = "memory";
        result.stored = report.value;
        result.reason = "memory";
        return result;
      }

      result.status = "storage-error";
      result.reason = "storage-error";
      return result;
    },

    saveHistory(history) {
      const result = Persistence.saveHistoryWithReport(history);
      return result.status === "saved" || result.status === "normalized";
    },

    /** Lê os recordes pessoais (PRs). Sempre devolve um array. */
    loadPRs() {
      const s = store();
      if (!s) return [];
      const clean = sanitizePRs(s.load(KEYS.prs, []));
      return Array.isArray(clean) ? clean : [];
    },

    savePRsWithReport(records) {
      const result = writeReport();
      const s = store();
      if (!s) {
        result.status = "unavailable";
        result.reason = "unavailable";
        return result;
      }

      const report = sanitizePRsWithReport(records);
      result.discarded = report.discarded;
      result.normalized = report.normalized;
      if (!report.ok) {
        result.reason = report.reason || "invalid-payload";
        return result;
      }

      result.accepted = report.value;
      const storageAvailable = Persistence.isEnabled();
      const saved = s.save(KEYS.prs, report.value, {
        memoryFallback: !storageAvailable,
      });

      if (saved) {
        result.stored = report.value;
        result.durable = true;
        if (report.discarded > 0 || report.normalized > 0) {
          result.status = "normalized";
          result.reason = "normalized";
        } else {
          result.status = "saved";
          result.ok = true;
        }
        return result;
      }

      if (!storageAvailable) {
        result.status = "memory";
        result.stored = report.value;
        result.reason = "memory";
        return result;
      }

      result.status = "storage-error";
      result.reason = "storage-error";
      return result;
    },

    savePRs(records) {
      const result = Persistence.savePRsWithReport(records);
      return result.status === "saved" || result.status === "normalized";
    },

    /**
     * Persiste o idioma. Um locale inválido é `validation-error` (nada foi
     * tentado), e não uma gravação em memória: o resultado precisa refletir a
     * gravação efetiva, não a simples chamada.
     */
    saveLangWithReport(lang) {
      const result = writeReport();
      const s = store();
      if (!s) {
        result.status = "unavailable";
        result.reason = "unavailable";
        return result;
      }

      const i = i18n();
      if (i && i.LOCALES.indexOf(lang) === -1) {
        result.reason = "invalid-locale";
        return result;
      }

      const storageAvailable = Persistence.isEnabled();
      const saved = s.save(KEYS.lang, lang, {
        memoryFallback: !storageAvailable,
      });

      if (saved) {
        result.status = "saved";
        result.ok = true;
        result.durable = true;
        result.accepted = lang;
        result.stored = lang;
        return result;
      }

      if (!storageAvailable) {
        result.status = "memory";
        result.accepted = lang;
        result.stored = lang;
        result.reason = "memory";
        return result;
      }

      result.status = "storage-error";
      result.reason = "storage-error";
      return result;
    },

    saveLang(lang) {
      const result = Persistence.saveLangWithReport(lang);
      return result.status === "saved";
    },

    saveAutoRestWithReport(enabled) {
      const result = writeReport();
      const s = store();
      if (!s) {
        result.status = "unavailable";
        result.reason = "unavailable";
        return result;
      }

      const normalized = typeof enabled !== "boolean";
      const value = !!enabled;
      const storageAvailable = Persistence.isEnabled();
      const saved = s.save(KEYS.autoRest, value, {
        memoryFallback: !storageAvailable,
      });

      if (saved) {
        result.status = normalized ? "normalized" : "saved";
        result.ok = !normalized;
        result.durable = true;
        result.accepted = value;
        result.stored = value;
        if (normalized) result.reason = "normalized";
        return result;
      }

      if (!storageAvailable) {
        result.status = "memory";
        result.accepted = value;
        result.stored = value;
        result.reason = "memory";
        return result;
      }

      result.status = "storage-error";
      result.reason = "storage-error";
      return result;
    },

    saveAutoRest(enabled) {
      const result = Persistence.saveAutoRestWithReport(enabled);
      return result.status === "saved" || result.status === "normalized";
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
    saveSessionWithReport(session) {
      const result = writeReport();
      const s = store();
      if (!s) {
        result.status = "unavailable";
        result.reason = "unavailable";
        return result;
      }

      const clean = sanitizeSession(session);
      if (!clean) {
        result.reason = "invalid-session";
        return result;
      }

      result.accepted = clean;
      const storageAvailable = Persistence.isEnabled();
      const saved = s.save(KEYS.session, clean, {
        memoryFallback: !storageAvailable,
      });

      if (saved) {
        result.status = "saved";
        result.ok = true;
        result.durable = true;
        result.stored = clean;
        return result;
      }

      if (!storageAvailable) {
        result.status = "memory";
        result.stored = clean;
        result.reason = "memory";
        return result;
      }

      result.status = "storage-error";
      result.reason = "storage-error";
      return result;
    },

    saveSession(session) {
      const result = Persistence.saveSessionWithReport(session);
      return result.status === "saved";
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

    /**
     * Grava o conjunto de chaves de estado de uma vez.
     *
     * Chaves cobertas: routines, customExercises, history, prs, lang e
     * autoRest. A chave `session` só é tentada quando `target.session` existe
     * (não há o que gravar quando não há sessão em andamento).
     *
     * Contrato:
     *   status "saved"      -> todas as gravações duráveis, sem normalização
     *   status "normalized" -> todas duráveis, mas houve normalização/descarte
     *   status "partial"    -> pelo menos uma efetivada e pelo menos uma falhou
     *   status "failed"     -> nenhuma gravação efetivada
     *   status "memory"     -> todas as tentativas foram para a memória; NÃO é durável
     *   status "unavailable"-> StorageService ausente
     *
     * `ok` só é true em "saved". `saved`/`normalized` listam chaves duráveis,
     * `memory` lista chaves apenas em memória e `failed` lista as rejeitadas.
     * `results` contém o relatório detalhado de cada operação (incluindo
     * `discarded`/`normalized`), de modo que uma perda silenciosa nunca seja
     * apresentada como sucesso integral.
     *
     * @returns {{ok:boolean,status:string,durable:boolean,attempted:number,saved:string[],normalized:string[],failed:string[],memory:string[],results:Object,reason:string|null}}
     */
    saveAll(target) {
      const result = {
        ok: false,
        status: "validation-error",
        durable: false,
        attempted: 0,
        saved: [],
        normalized: [],
        failed: [],
        memory: [],
        results: {},
        reason: null,
      };
      const st = target || null;
      if (!st) {
        result.reason = "invalid-target";
        return result;
      }

      const s = store();
      if (!s) {
        result.status = "unavailable";
        result.reason = "unavailable";
        return result;
      }

      const storageAvailable = Persistence.isEnabled();
      const recordReport = (key, report) => {
        result.attempted++;
        result.results[key] = report;
        if (report.durable) {
          if (report.status === "normalized") result.normalized.push(key);
          else result.saved.push(key);
        } else if (report.status === "memory") {
          result.memory.push(key);
        } else {
          result.failed.push(key);
        }
      };

      recordReport("routines", Persistence.saveRoutinesWithReport(st.routines || []));
      recordReport("customExercises", Persistence.saveCustomExercises(st.customExercises || []));
      recordReport("history", Persistence.saveHistoryWithReport(st.history || []));
      recordReport("prs", Persistence.savePRsWithReport(st.prs || []));
      recordReport("lang", Persistence.saveLangWithReport(st.lang));
      recordReport("autoRest", Persistence.saveAutoRestWithReport(st.autoRestEnabled));
      if (st.session != null) {
        recordReport("session", Persistence.saveSessionWithReport(st.session));
      }

      const durableCount = result.saved.length + result.normalized.length;
      if (!storageAvailable) {
        if (result.failed.length > 0 && result.memory.length === 0) {
          result.status = "failed";
          result.reason = "all-failed";
        } else if (result.failed.length > 0) {
          result.status = "partial";
          result.reason = "partial-failure";
        } else {
          result.status = "memory";
          result.reason = "memory";
        }
      } else if (durableCount === 0) {
        result.status = "failed";
        result.reason = "all-failed";
      } else if (result.failed.length > 0) {
        result.status = "partial";
        result.reason = "partial-failure";
      } else if (result.memory.length > 0) {
        // Não deveria ocorrer com backend ativo (memoryFallback:false), mas
        // se ocorrer o resultado não pode ser declarado durável.
        result.status = "partial";
        result.reason = "partial-memory";
      } else if (result.normalized.length > 0) {
        result.status = "normalized";
        result.reason = "normalized";
        result.durable = true;
      } else {
        result.status = "saved";
        result.ok = true;
        result.durable = true;
      }
      return result;
    },

    /** Apaga apenas os dados da app (mantém o idioma, preferência do usuário). */
    reset() {
      const s = store();
      if (!s) return false;
      s.remove(KEYS.routines);
      s.remove(KEYS.customExercises);
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
