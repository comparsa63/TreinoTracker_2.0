/**
 * js/routine-actions.js — Operações puras sobre rotinas (Fase 2C).
 * ---------------------------------------------------------------------------
 * Concentra a REGRA de exclusão de um treino, de forma testável e sem tocar
 * em DOM, `state` ou `localStorage`. A camada de UI (script principal) decide
 * quando chamar e usa `Persistence.saveRoutines` como `save` injetado.
 *
 * Garantias:
 *   - Identifica a rotina por `id` estável (não pelo nome exibido).
 *   - Não remove nada se a rotina não existir.
 *   - Bloqueia a exclusão quando há uma SESSÃO ATIVA usando a rotina
 *     (preserva a execução em andamento).
 *   - Só altera o resultado se a persistência confirmar (`save` retorna true).
 *   - Não toca em catálogo, histórico nem PRs.
 *
 * Carregado antes do script principal. Expõe `window.RoutineActions` e
 * `module.exports`.
 */
(function (global) {
  "use strict";

  const RoutineActions = {
    /**
     * @param {Object}   opts
     * @param {Array}    opts.routines  lista atual de rotinas
     * @param {string}   opts.id        id da rotina a excluir
     * @param {Object}   [opts.session] sessão ativa (se houver)
     * @param {Function} [opts.save]    (routines) => boolean; se omitido, não persiste
     * @returns {{ok:boolean, routines?:Array, removedId?:string, reason?:string, message?:string}}
     */
    deleteRoutine(opts) {
      const o = opts || {};
      const routines = o.routines;
      const id = o.id;

      if (!Array.isArray(routines)) {
        return { ok: false, reason: "invalid-state", message: "Estado de rotinas inválido." };
      }
      if (id == null || id === "") {
        return { ok: false, reason: "missing-id", message: "Rotina não identificada." };
      }

      const index = routines.findIndex((r) => r && r.id === id);
      if (index === -1) {
        return { ok: false, reason: "not-found", message: "Treino não encontrado." };
      }

      const session = o.session;
      if (session && session.routineId === id) {
        return {
          ok: false,
          reason: "active-session",
          message: "Treino em execução. Finalize ou saia da sessão antes de excluir.",
        };
      }

      const next = routines.filter((r) => !(r && r.id === id));

      if (typeof o.save === "function") {
        let saved = false;
        try {
          saved = o.save(next) === true;
        } catch (e) {
          return { ok: false, reason: "storage", message: "Falha ao salvar a exclusão." };
        }
        if (!saved) {
          return { ok: false, reason: "storage", message: "Falha ao salvar a exclusão." };
        }
      }

      return { ok: true, routines: next, removedId: id };
    },

    /** Apenas consulta: pode excluir a rotina agora? (não altera nada) */
    canDelete(routines, id, session) {
      if (!Array.isArray(routines) || id == null) return false;
      if (session && session.routineId === id) return false;
      return routines.some((r) => r && r.id === id);
    },
  };

  global.RoutineActions = RoutineActions;
  if (typeof module !== "undefined" && module.exports) module.exports = RoutineActions;
})(typeof globalThis !== "undefined" ? globalThis : this);
