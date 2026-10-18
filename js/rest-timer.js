/**
 * js/rest-timer.js — DOMÍNIO puro do descanso entre séries (Sprint 4 / E3).
 * ---------------------------------------------------------------------------
 * Mede o descanso por RELÓGIO ABSOLUTO: o estado guarda o prazo (`endsAt`) e o
 * tempo restante é SEMPRE calculado a partir dele — nunca por decremento
 * acumulado. Consequência direta: suspensão da aba, throttling do navegador ou
 * qualquer atraso do render NÃO adiantam nem atrasam a contagem. Uma suspensão
 * de 10 min com 30 s restantes devolve 0 (encerrado), não 30 s.
 *
 * O módulo é DETERMINÍSTICO (toda função recebe `now` explícito), NÃO cria
 * timers (`setInterval`/`setTimeout`/rAF), NÃO acessa DOM, `localStorage`,
 * `Persistence`, `EventBus` nem estado global, e NÃO dispara áudio, vibração
 * ou notificação. Quem renderiza é a UI (etapa E5).
 *
 * ESTADO — uma única autoridade por status (sem duplicidade de fonte):
 *   durationMs  número > 0 — duração PLANEJADA da contagem (base do progresso)
 *   status      "running" | "paused" | "finished"
 *   endsAt      Date | null  — prazo absoluto. AUTORIDADE quando `running`
 *   remainingMs número | null — congelado. AUTORIDADE quando `paused`;
 *                              `0` quando `finished`; `null` quando `running`
 *   pausedAt    Date | null  — instante da pausa em aberto
 *   pausedMs    número       — total já pausado nesta contagem
 *   sessionId   String | null — execução dona do descanso (vínculo)
 *
 * CONTRATO DA API (e ajustes em relação à proposta inicial, documentados):
 *   STATUS                                   -> ["running","paused","finished"]
 *   create(seconds, sessionId, now)          -> fabrica um descanso NOVO (correndo)
 *   start(timer, seconds, now)               -> (re)inicia um descanso EXISTENTE
 *                                               com nova duração, preservando o
 *                                               `sessionId` (criar é `create`)
 *   pause(timer, now) / resume(timer, now)   -> congelam/retomam o restante
 *   restart(timer, now, seconds?)            -> reinicia do zero (duração atual
 *                                               ou a informada), zerando pausas
 *   addTime(timer, milliseconds, now)        -> soma/subtrai tempo (nunca < 0)
 *   skip(timer, now)                         -> encerra imediatamente
 *   settle(timer, now)                       -> aplica `finished` se o prazo venceu
 *   snapshot(timer, now)                     -> LEITURA pura do estado calculado
 *   sanitize(raw, now)                       -> reconstrói/descarta dados inválidos
 *   alignToSession(timer, sessionStatus, now)-> alinha ao estado da sessão
 *
 * Diferenças assumidas em relação à proposta da E3:
 *   - `start` recebe um timer EXISTENTE (não cria objeto); `create` é o
 *     construtor. Sem isso as duas funções seriam a mesma coisa.
 *   - `addTime` usa MILISSEGUNDOS (a UI da E5 converte de ±15 s) e, quando o
 *     restante ultrapassa `durationMs`, a duração planejada cresce junto —
 *     espelha o `total` do timer legado e mantém o progresso em 0..1.
 *   - `snapshot` devolve `null` para entrada inválida (não inventa estado) e
 *     expõe `finished` também quando o prazo já venceu mas o status ainda é
 *     `running` (caso típico de suspensão da aba).
 *   - `pause` num timer já pausado e `resume` num timer já correndo são
 *     no-op IDEMPOTENTES (protegem duplo toque) — não reiniciam `pausedAt`
 *     nem movem `endsAt`, portanto não corrompem o cômputo.
 *   - Timestamps são `Date`; `sanitize` também aceita epoch-ms e ISO 8601.
 *
 * PERSISTÊNCIA: por decisão de produto (D-A) o descanso é EFÊMERO — não é
 * persistido e nenhum descanso antigo é restaurado após recarga. O módulo não
 * conhece a persistência.
 *
 * Sem dependências (nem TTUtils). Carregado antes do script principal.
 * Expõe no global (`globalThis.RestTimer`) e em `module.exports`.
 */
(function (global) {
  "use strict";

  const STATUS = ["running", "paused", "finished"];

  // -------------------------------------------------------------------------
  // Utilidades locais (realm-safe: as suítes rodam em vm)
  // -------------------------------------------------------------------------

  /** Número finito (aceita "90" / "1,5"). null quando inválido. */
  function num(value) {
    if (typeof value === "number") return isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value.replace(",", "."));
      return isFinite(n) ? n : null;
    }
    return null;
  }

  /** Epoch-ms a partir de Date | number | ISO-8601. null quando inválido. */
  function toMs(value) {
    if (Object.prototype.toString.call(value) === "[object Date]") {
      const t = value.getTime();
      return isNaN(t) ? null : t;
    }
    if (typeof value === "number" && isFinite(value)) return value;
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

  /** Instante de referência (determinístico quando `now` é informado). */
  function nowMs(now) {
    const ms = toMs(now);
    return ms === null ? Date.now() : ms;
  }

  function isTimer(timer) {
    if (!timer || typeof timer !== "object" || Array.isArray(timer)) return false;
    const d = num(timer.durationMs);
    return d !== null && d > 0 && STATUS.indexOf(timer.status) !== -1;
  }

  function cleanId(value) {
    return (typeof value === "string" && value.trim() !== "") ? value.trim() : null;
  }

  // -------------------------------------------------------------------------
  // Leitura (nunca muta o timer)
  // -------------------------------------------------------------------------

  /** Tempo restante (ms). AUTORIDADE: `endsAt` correndo, `remainingMs` pausado. */
  function remainingAt(timer, ms) {
    if (!isTimer(timer)) return null;
    if (timer.status === "running") {
      const end = toMs(timer.endsAt);
      if (end === null) return null;
      return Math.max(0, end - ms);
    }
    if (timer.status === "paused") {
      const frozen = num(timer.remainingMs);
      return frozen === null ? null : Math.max(0, frozen);
    }
    return 0;
  }

  /** Tempo já decorrido na contagem (desconta pausas), clampado em >= 0. */
  function elapsedAt(timer, ms) {
    const remaining = remainingAt(timer, ms);
    if (remaining === null) return null;
    const duration = num(timer.durationMs) || 0;
    return Math.max(0, duration - remaining);
  }

  // -------------------------------------------------------------------------
  // Transições internas
  // -------------------------------------------------------------------------

  /** Fecha a pausa em aberto acumulando o tempo parado. */
  function closePause(timer, ms) {
    const at = toMs(timer.pausedAt);
    if (at !== null && ms >= at) {
      timer.pausedMs = Math.max(0, num(timer.pausedMs) || 0) + (ms - at);
    }
    timer.pausedAt = null;
  }

  /** Encerra a contagem (idempotente: chamar de novo não muda nada). */
  function applyFinish(timer) {
    timer.status = "finished";
    timer.endsAt = null;
    timer.remainingMs = 0;
    timer.pausedAt = null;
    return timer;
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  const RestTimer = {
    STATUS: STATUS,

    /**
     * Fabrica um descanso NOVO, já correndo.
     * @param {number|string} seconds  duração (> 0)
     * @param {String} [sessionId] execução dona do descanso (vínculo)
     * @param {Date|number|string} [now]
     * @returns {Object|null} null quando a duração é inválida
     */
    create(seconds, sessionId, now) {
      const secs = num(seconds);
      if (secs === null || secs <= 0) return null;
      const durationMs = Math.round(secs * 1000);
      if (durationMs <= 0) return null;
      return {
        durationMs: durationMs,
        endsAt: new Date(nowMs(now) + durationMs),
        remainingMs: null,
        pausedAt: null,
        pausedMs: 0,
        status: "running",
        sessionId: cleanId(sessionId),
      };
    },

    /**
     * (Re)inicia um descanso EXISTENTE com nova duração, zerando as pausas e
     * preservando o `sessionId`. Para criar um descanso novo, use `create`.
     * @returns {Object|null} null se o timer é inválido ou a duração não serve
     */
    start(timer, seconds, now) {
      if (!isTimer(timer)) return null;
      const secs = num(seconds);
      if (secs === null || secs <= 0) return null;
      const durationMs = Math.round(secs * 1000);
      if (durationMs <= 0) return null;
      const ms = nowMs(now);
      timer.durationMs = durationMs;
      timer.endsAt = new Date(ms + durationMs);
      timer.remainingMs = null;
      timer.pausedAt = null;
      timer.pausedMs = 0;
      timer.status = "running";
      return timer;
    },

    /**
     * Congela o tempo restante. No-op idempotente se já estiver pausado.
     * @returns {Object|null} null se o timer é inválido ou já terminou
     */
    pause(timer, now) {
      if (!isTimer(timer)) return null;
      if (timer.status === "finished") return null;
      if (timer.status === "paused") return timer;
      const ms = nowMs(now);
      const remaining = remainingAt(timer, ms);
      if (remaining === null) return null;
      timer.status = "paused";
      timer.remainingMs = remaining;
      timer.endsAt = null;
      timer.pausedAt = new Date(ms);
      return timer;
    },

    /**
     * Retoma a partir do tempo congelado (recalcula o prazo absoluto).
     * No-op idempotente se já estiver correndo.
     * @returns {Object|null} null se o timer é inválido ou já terminou
     */
    resume(timer, now) {
      if (!isTimer(timer)) return null;
      if (timer.status === "finished") return null;
      if (timer.status === "running") return timer;
      const ms = nowMs(now);
      const remaining = remainingAt(timer, ms);
      if (remaining === null) return null;
      closePause(timer, ms);
      timer.status = "running";
      timer.endsAt = new Date(ms + remaining);
      timer.remainingMs = null;
      return timer;
    },

    /**
     * Reinicia a contagem do zero (mantendo a duração, ou adotando `seconds`).
     * @returns {Object|null} null se o timer é inválido
     */
    restart(timer, now, seconds) {
      if (!isTimer(timer)) return null;
      const secs = (seconds == null) ? (num(timer.durationMs) || 0) / 1000 : num(seconds);
      return RestTimer.start(timer, secs, now);
    },

    /**
     * Soma (ou subtrai, com valor negativo) tempo à contagem, correndo ou
     * pausada. O tempo restante NUNCA fica negativo.
     * @param {number|string} milliseconds
     * @returns {Object|null} null se o timer é inválido, já terminou ou o
     *                        valor não é numérico
     */
    addTime(timer, milliseconds, now) {
      if (!isTimer(timer)) return null;
      if (timer.status === "finished") return null;
      const delta = num(milliseconds);
      if (delta === null) return null;
      const ms = nowMs(now);

      if (timer.status === "running") {
        const end = toMs(timer.endsAt);
        if (end === null) return null;
        timer.endsAt = new Date(Math.max(ms, end + delta));
      } else {
        timer.remainingMs = Math.max(0, (num(timer.remainingMs) || 0) + delta);
      }

      // Se o restante passou da duração planejada, ela cresce junto (espelha o
      // `total` do timer legado e mantém o progresso dentro de 0..1).
      const remaining = remainingAt(timer, ms) || 0;
      timer.durationMs = Math.max(num(timer.durationMs) || 0, remaining);
      return timer;
    },

    /**
     * Encerra a contagem imediatamente. IDEMPOTENTE: repetir não altera nada.
     * @returns {Object|null} null apenas se o timer é inválido
     */
    skip(timer, now) {
      if (!isTimer(timer)) return null;
      if (timer.status === "finished") return timer;
      const ms = nowMs(now);
      if (timer.status === "paused") closePause(timer, ms);
      return applyFinish(timer);
    },

    /**
     * Aplica a transição para `finished` QUANDO O PRAZO JÁ VENCEU — é o que
     * reconhece um descanso que expirou durante a suspensão da aba.
     * IDEMPOTENTE e nunca mexe num timer pausado (pausa congela de propósito).
     * @returns {Object|null} null se o timer é inválido
     */
    settle(timer, now) {
      if (!isTimer(timer)) return null;
      if (timer.status !== "running") return timer;
      const ms = nowMs(now);
      const remaining = remainingAt(timer, ms);
      if (remaining === null) return null;
      if (remaining <= 0) return applyFinish(timer);
      return timer;
    },

    /**
     * Estado CALCULADO num instante, sem efeito colateral e sem duplicar a
     * fonte de verdade (nada é escrito no timer).
     * `finished` também é true quando o prazo já venceu e o status ainda é
     * `running` — o chamador decide entre `settle` e `skip`.
     * @returns {Object|null} null se o timer é inválido
     */
    snapshot(timer, now) {
      if (!isTimer(timer)) return null;
      const ms = nowMs(now);
      const remaining = remainingAt(timer, ms);
      if (remaining === null) return null;
      const duration = num(timer.durationMs) || 0;
      const elapsed = Math.max(0, duration - remaining);
      return {
        status: timer.status,
        durationMs: duration,
        remainingMs: remaining,
        elapsedMs: elapsed,
        progress: duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0,
        finished: timer.status === "finished" || remaining <= 0,
        sessionId: timer.sessionId || null,
      };
    },

    /**
     * Reconstrói um timer a partir de dados possivelmente corrompidos.
     * Deriva o `status` dos campos quando ele falta; corrige/clampa o resto.
     * @returns {Object|null} null quando não há o mínimo recuperável
     */
    sanitize(raw, now) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

      const durationMs = num(raw.durationMs);
      if (durationMs === null || durationMs <= 0) return null;

      const endsAt = toMs(raw.endsAt);
      const remaining = num(raw.remainingMs);

      let status = STATUS.indexOf(raw.status) !== -1 ? raw.status : null;
      if (status === null) {
        if (endsAt !== null) status = "running";
        else if (remaining !== null && remaining >= 0) status = "paused";
        else return null;
      }

      const ms = nowMs(now);
      const timer = {
        durationMs: Math.round(durationMs),
        endsAt: null,
        remainingMs: null,
        pausedAt: null,
        pausedMs: Math.max(0, num(raw.pausedMs) || 0),
        status: status,
        sessionId: cleanId(raw.sessionId),
      };

      if (status === "running") {
        const end = endsAt !== null
          ? endsAt
          : ms + Math.max(0, remaining === null ? timer.durationMs : remaining);
        timer.endsAt = new Date(end);
      } else if (status === "paused") {
        const frozen = (remaining !== null && remaining >= 0) ? remaining : timer.durationMs;
        timer.remainingMs = Math.max(0, frozen);
        timer.pausedAt = toDate(raw.pausedAt) || new Date(ms);
      } else {
        timer.remainingMs = 0;
      }

      // O anel de progresso precisa de uma duração coerente com o restante.
      timer.durationMs = Math.max(timer.durationMs, timer.remainingMs || 0);
      return timer;
    },

    /**
     * Alinha o descanso ao estado REAL da sessão (contrato da E5):
     *   sessão pausada  -> pausa o descanso
     *   sessão ativa    -> retoma o descanso
     *   sessão finalizada -> encerra o descanso
     * Status desconhecido ou descanso já finalizado: nada a fazer.
     * @returns {Object|null} null se o timer é inválido
     */
    alignToSession(timer, sessionStatus, now) {
      if (!isTimer(timer)) return null;
      if (timer.status === "finished") return timer;
      if (sessionStatus === "paused") return RestTimer.pause(timer, now);
      if (sessionStatus === "active") return RestTimer.resume(timer, now);
      if (sessionStatus === "finished") return RestTimer.skip(timer, now);
      return timer;
    },
  };

  global.RestTimer = RestTimer;
  if (typeof module !== "undefined" && module.exports) module.exports = RestTimer;
})(typeof globalThis !== "undefined" ? globalThis : this);
