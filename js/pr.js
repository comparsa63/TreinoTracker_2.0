/**
 * js/pr.js — Engine de Recordes Pessoais (PRs).
 * ---------------------------------------------------------------------------
 * Porte do `repositories/PRRepository.js` do TreinoTracker original, adaptado
 * à arquitetura consolidada do TreinoTracker_DeepSeek:
 *
 *   - NÃO grava em localStorage cru: usa `Persistence.loadPRs()` /
 *     `Persistence.savePRs()` (namespace `tt_ds_v1_`, chave lógica `prs`).
 *   - NÃO usa StateAdapter: consome o `state.history` enriquecido (Fase 2C),
 *     cujo formato é { id, name, date, dateISO, durationMin, status,
 *     exercises: [{ catalogId, name, muscle, sets: [{weight,reps}] }] }.
 *   - Datas via `TTUtils` (todayISO/getWeekRange/isSameWeek), sem depender de
 *     globais legados (`today()`, `getWeekRange()`).
 *
 * Critérios preservados (sem inventar novos): carga, reps, volume, oneRM,
 * series e weeklyStreak.
 *
 * Carregado antes do script principal. Expõe `window.PR` e `module.exports`.
 * Depende de: js/utils.js, services/storage.js, js/persistence.js.
 */
(function (global) {
  "use strict";

  const TYPES = ["carga", "reps", "volume", "oneRM", "series", "weeklyStreak"];

  function utils() {
    return global.TTUtils || null;
  }

  function load() {
    const p = global.Persistence;
    if (p && typeof p.loadPRs === "function") return p.loadPRs();
    return [];
  }

  function save(records) {
    const p = global.Persistence;
    if (p && typeof p.savePRs === "function") return p.savePRs(records);
    return false;
  }

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /** Chave estável do exercício: id do catálogo quando houver, senão o nome. */
  function keyOf(ex) {
    if (!ex || typeof ex !== "object") return "";
    return ex.catalogId || ex.name || ex.nome || "";
  }

  /** Séries efetivamente concluídas (aceita `sets` ou `series`). */
  function setsOf(ex) {
    if (!ex || typeof ex !== "object") return [];
    if (Array.isArray(ex.sets)) return ex.sets;
    if (Array.isArray(ex.series)) return ex.series;
    return [];
  }

  function weightOf(s) {
    return s ? num(s.weight != null ? s.weight : s.carga) : 0;
  }

  function repsOf(s) {
    return s ? num(s.reps != null ? s.reps : s.repeticoes) : 0;
  }

  function maxWeight(sets) {
    return sets.reduce((m, s) => Math.max(m, weightOf(s)), 0);
  }

  function maxReps(sets) {
    return sets.reduce((m, s) => Math.max(m, repsOf(s)), 0);
  }

  function volumeOf(sets) {
    const total = sets.reduce((t, s) => t + repsOf(s) * weightOf(s), 0);
    return Math.round(total * 10) / 10;
  }

  function oneRMOf(sets) {
    return sets.reduce((best, s) => {
      const c = weightOf(s);
      const r = repsOf(s);
      if (c > 0 && r > 0) {
        const est = Math.round(c * (1 + r / 30) * 10) / 10;
        return Math.max(best, est);
      }
      return best;
    }, 0);
  }

  /** Nº máximo de vezes que o exercício aparece numa mesma semana. */
  function weeklyStreak(key, history) {
    const U = utils();
    const weeks = {};
    if (!U) return 0;
    const entries = Array.isArray(history) ? history : [];
    entries.forEach((h) => {
      if (!h) return;
      const iso = h.dateISO || (h.id ? U.todayISO(new Date(h.id)) : null);
      if (!iso) return;
      const weekKey = U.todayISO(U.getWeekRange(iso).start);
      (Array.isArray(h.exercises) ? h.exercises : []).forEach((ex) => {
        if (keyOf(ex) === key && setsOf(ex).length) {
          weeks[weekKey] = (weeks[weekKey] || 0) + 1;
        }
      });
    });
    return Object.keys(weeks).reduce((m, k) => Math.max(m, weeks[k]), 0);
  }

  const PR = {
    TYPES,

    /** Lê todos os recordes (via Persistence). */
    getAll(records) {
      return Array.isArray(records) ? records : load();
    },

    /**
     * Verifica e registra novos PRs após salvar um treino.
     * Idempotente: reprocessar o MESMO treino (mesmo `id`) não gera novos
     * recordes nem duplica registros.
     * @param {Object} workout - entrada de histórico enriquecida
     * @param {Array}  history - histórico completo (para weeklyStreak)
     * @returns {Array} novos PRs detectados
     */
    checkNewPR(workout, history) {
      if (!workout || !Array.isArray(workout.exercises)) return [];
      const U = utils();
      const records = load();
      const hist = Array.isArray(history) ? history : [];
      const newPRs = [];

      workout.exercises.forEach((ex) => {
        const sets = setsOf(ex);
        if (!sets.length) return;
        const key = keyOf(ex);
        if (!key) return;
        const name = ex.name || ex.nome || key;

        const values = {
          carga: maxWeight(sets),
          reps: maxReps(sets),
          volume: volumeOf(sets),
          oneRM: oneRMOf(sets),
          series: sets.length,
          weeklyStreak: weeklyStreak(key, hist),
        };

        TYPES.forEach((type) => {
          const newVal = values[type];
          if (!(newVal > 0)) return;

          const existing = records.find((r) => r.exerciseKey === key && r.type === type);

          // Idempotência: já registrado para ESTE treino -> não reemite.
          if (existing && existing.workoutId != null && existing.workoutId === workout.id) return;
          if (existing && newVal <= existing.value) return;

          const oldVal = existing ? existing.value : 0;
          const diff = oldVal > 0 ? Math.round((newVal - oldVal) * 10) / 10 : 0;

          const pr = {
            id: String(workout.id != null ? workout.id : Date.now()) + "_" + key + "_" + type,
            exerciseKey: key,
            exerciseName: name,
            type,
            value: newVal,
            oldValue: oldVal,
            diff,
            workoutId: workout.id == null ? null : workout.id,
            workoutDate: workout.dateISO || workout.date || "",
            createdAt: U ? U.today() : "",
          };

          newPRs.push(pr);

          if (existing) {
            existing.value = newVal;
            existing.oldValue = oldVal;
            existing.diff = diff;
            existing.workoutId = pr.workoutId;
            existing.workoutDate = pr.workoutDate;
            existing.createdAt = pr.createdAt;
          } else {
            records.push(pr);
          }
        });
      });

      if (newPRs.length > 0) {
        save(records);
        if (global.EventBus && typeof global.EventBus.emit === "function") {
          global.EventBus.emit("pr:new", { prs: newPRs, workout });
        }
      }

      return newPRs;
    },

    /** PRs atuais de um exercício, por tipo. */
    getExercisePR(nameOrId, records) {
      const list = PR.getAll(records);
      const result = {};
      TYPES.forEach((t) => { result[t] = null; });
      list.forEach((r) => {
        if (r.exerciseKey === nameOrId || r.exerciseName === nameOrId) {
          if (result[r.type] === null || r.value > result[r.type].value) result[r.type] = r;
        }
      });
      return result;
    },

    /** Histórico de recordes do exercício, mais recentes primeiro. */
    getExerciseHistory(nameOrId, records) {
      return PR.getAll(records)
        .filter((r) => r.exerciseKey === nameOrId || r.exerciseName === nameOrId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    /** Últimos PRs registrados. */
    getLatestPRs(limit, records) {
      const sorted = PR.getAll(records).slice().sort((a, b) => {
        const da = new Date(a.createdAt).getTime() || 0;
        const db = new Date(b.createdAt).getTime() || 0;
        return db - da;
      });
      return sorted.slice(0, limit || 10);
    },

    /** Exercícios com mais recordes. */
    getTopPRs(limit, records) {
      const counts = {};
      PR.getAll(records).forEach((r) => {
        const k = r.exerciseName || r.exerciseKey;
        counts[k] = (counts[k] || 0) + 1;
      });
      const result = Object.keys(counts).map((k) => ({ exerciseName: k, count: counts[k] }));
      result.sort((a, b) => b.count - a.count);
      return result.slice(0, limit || 5);
    },

    /** Estatísticas gerais. */
    getPRStatistics(records) {
      const list = PR.getAll(records);
      const U = utils();
      const now = U ? U.today() : "";
      let thisWeek = 0;
      const byType = {};
      TYPES.forEach((t) => { byType[t] = 0; });

      list.forEach((r) => {
        if (U && r.createdAt && U.isSameWeek(r.createdAt, now)) thisWeek++;
        if (byType[r.type] !== undefined) byType[r.type]++;
      });

      const top = PR.getTopPRs(1, list);
      return {
        total: list.length,
        thisWeek,
        topExercise: top.length > 0 ? top[0].exerciseName : null,
        topCount: top.length > 0 ? top[0].count : 0,
        byType,
      };
    },

    /** Limpa todos os recordes. */
    clear() {
      save([]);
      if (global.EventBus && typeof global.EventBus.emit === "function") {
        global.EventBus.emit("pr:updated");
      }
    },
  };

  global.PR = PR;
  if (typeof module !== "undefined" && module.exports) module.exports = PR;
})(typeof globalThis !== "undefined" ? globalThis : this);
