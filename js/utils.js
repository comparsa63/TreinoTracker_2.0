/**
 * js/utils.js — Utilitários compartilhados (sem dependências).
 * ---------------------------------------------------------------------------
 * Carregado antes do script principal. Expõe `window.TTUtils` no navegador e
 * `module.exports` no Node (para os testes).
 */
(function (global) {
  "use strict";

  const TTUtils = {
    /** Gera um id único e ordenável (Date.now + sufixo aleatório). */
    uid(prefix) {
      const rand = Math.random().toString(36).slice(2, 8);
      return (prefix ? prefix + "_" : "") + Date.now().toString(36) + rand;
    },

    /** "7" -> "07" */
    pad2(n) {
      return String(n).padStart(2, "0");
    },

    /**
     * Normaliza Date/epoch/"YYYY-MM-DD" numa Date local (ou o agora, quando o
     * valor não representa um instante). NÃO usa `instanceof Date`: um Date vindo
     * de outro realm (iframe, worker, sandbox `vm` dos testes) não passa nesse
     * teste e, sem isto, o argumento era IGNORADO em silêncio — devolvendo "hoje".
     */
    toDate(value) {
      if (value && typeof value.getTime === "function") {
        const t = value.getTime();
        return isFinite(t) ? new Date(t) : new Date();
      }
      if (typeof value === "number" && isFinite(value)) return new Date(value);
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(value + "T12:00:00"); // meio-dia local: evita fuso
      }
      return new Date();
    },

    /**
     * Data local em ISO curto: "2026-10-18". Aceita Date (de qualquer realm),
     * epoch, "YYYY-MM-DD" ou nada (= hoje).
     */
    todayISO(date) {
      const d = TTUtils.toDate(date);
      return d.getFullYear() + "-" + TTUtils.pad2(d.getMonth() + 1) + "-" + TTUtils.pad2(d.getDate());
    },

    /** Data local de hoje (ISO curto). Equivalente ao `today()` legado. */
    today() {
      return TTUtils.todayISO();
    },

    /**
     * Formata uma data como "dd/mm/aa" (pt-BR).
     * Porte do `fmtDate()` do TreinoTracker original. Aceita "YYYY-MM-DD"
     * (interpretado ao meio-dia, evitando fuso) ou qualquer data válida.
     */
    fmtDate(d) {
      if (!d) return "--";
      try {
        if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
          return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", {
            day: "2-digit", month: "2-digit", year: "2-digit",
          });
        }
        const dt = new Date(d);
        if (!isNaN(dt.getTime())) {
          return dt.toLocaleDateString("pt-BR", {
            day: "2-digit", month: "2-digit", year: "2-digit",
          });
        }
        return String(d);
      } catch (e) {
        return String(d);
      }
    },

    /**
     * Intervalo da semana (segunda a domingo) que contém a data.
     * Porte do `getWeekRange()` legado; aceita "YYYY-MM-DD" ou `Date`.
     * @returns {{start: Date, end: Date}}
     */
    getWeekRange(date) {
      const base = TTUtils.toDate(date);
      const d = isNaN(base.getTime()) ? new Date() : base;
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // segunda-feira
      const mon = new Date(d);
      mon.setDate(diff);
      mon.setHours(12, 0, 0, 0);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { start: mon, end: sun };
    },

    /** Duas datas caem na mesma semana (seg-dom)? Porte do `isSameWeek()` legado. */
    isSameWeek(d1, d2) {
      return TTUtils.getWeekRange(d1).start.toDateString() ===
        TTUtils.getWeekRange(d2).start.toDateString();
    },

    /**
     * Maior carga entre as séries de um exercício.
     * Porte do `getMaxCarga()` legado; aceita `series[].carga` ou `sets[].weight`.
     */
    getMaxCarga(ex) {
      const arr = ex && (Array.isArray(ex.series) ? ex.series : (Array.isArray(ex.sets) ? ex.sets : null));
      if (!arr || arr.length === 0) return 0;
      return arr.reduce((max, s) => {
        const raw = s ? (s.carga != null ? s.carga : s.weight) : 0;
        const v = TTUtils.parseNumber(raw);
        return Math.max(max, v === null ? 0 : v);
      }, 0);
    },

    /** Maior número de repetições entre as séries de um exercício. */
    getMaxReps(ex) {
      const arr = ex && (Array.isArray(ex.series) ? ex.series : (Array.isArray(ex.sets) ? ex.sets : null));
      if (!arr || arr.length === 0) return 0;
      return arr.reduce((max, s) => {
        const raw = s ? (s.reps != null ? s.reps : s.repeticoes) : 0;
        const v = TTUtils.parseNumber(raw);
        return Math.max(max, v === null ? 0 : v);
      }, 0);
    },

    /** Segundos -> "MM:SS" (usado pelo timer de descanso). */
    formatClock(totalSeconds) {
      const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
      return TTUtils.pad2(Math.floor(s / 60)) + ":" + TTUtils.pad2(s % 60);
    },

    /** Minutos -> "45 min" (texto curto para cards/histórico). */
    formatDuration(minutes) {
      const m = Math.max(0, Math.round(Number(minutes) || 0));
      if (m < 60) return m + " min";
      const h = Math.floor(m / 60);
      const rest = m % 60;
      return rest === 0 ? h + "h" : h + "h " + TTUtils.pad2(rest) + "min";
    },

    /** Escapa texto para interpolação segura em template strings de HTML. */
    escapeHtml(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => {
        switch (ch) {
          case "&": return "&amp;";
          case "<": return "&lt;";
          case ">": return "&gt;";
          case '"': return "&quot;";
          default: return "&#39;";
        }
      });
    },

    /** Normaliza texto para busca: sem acentos, minúsculo, espaços colapsados. */
    normalize(value) {
      return String(value == null ? "" : value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    },

    /** Limita um número ao intervalo [min, max]. */
    clamp(n, min, max) {
      const v = Number(n);
      if (!isFinite(v)) return min;
      return Math.min(Math.max(v, min), max);
    },

    /** Cópia profunda por serialização (mesmo padrão já usado no protótipo). */
    deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    },

    /** Converte "12,5" / "12.5" / "" em número (ou null). */
    parseNumber(value) {
      if (value == null || value === "") return null;
      const n = parseFloat(String(value).replace(",", "."));
      return isFinite(n) ? n : null;
    },

    isArrayOfObjects(list) {
      return Array.isArray(list) && list.every((it) => it && typeof it === "object" && !Array.isArray(it));
    },
  };

  global.TTUtils = TTUtils;
  if (typeof module !== "undefined" && module.exports) module.exports = TTUtils;
})(typeof globalThis !== "undefined" ? globalThis : this);
