/**
 * js/wake-lock.js — ADAPTADOR de Screen Wake Lock (Sprint 4 / E4).
 * ---------------------------------------------------------------------------
 * Responsabilidade ÚNICA: conversar com `navigator.wakeLock` e esconder a
 * bagunça do navegador atrás de uma API pequena e previsível. O domínio
 * (`WorkoutSession`, `RestTimer`) e o controlador NÃO conhecem Wake Lock: a
 * tela acesa é infraestrutura de UI, não regra de treino.
 *
 * CONTRATO
 *   isSupported()                  -> Boolean  (nunca lança)
 *   isEnabled() / isActive()       -> Boolean
 *   request(reason?)               -> Promise<Result>  liga a intenção e adquire
 *   release(reason?)               -> Promise<Result>  libera e desliga a intenção
 *   setEnabled(shouldHold, reason?)-> Promise<Result>  escolhe entre os dois
 *   onVisibility(visible)          -> Promise<Result>  reavalia ao voltar à aba
 *   attach(doc?) / detach()        -> Boolean  listener ÚNICO de visibilitychange
 *   status()                       -> { supported, enabled, active, attached, inflight }
 *   reset()                        -> Boolean  teardown (intenção + sentinel + listeners)
 *
 * Result:
 *   { ok, reason, message, supported, enabled, active, acquired, error }
 *   ok:true   -> reason null e message "" ; `acquired` diz se um sentinel NOVO
 *                foi obtido (false quando reaproveitou o atual ou quando não
 *                havia nada a adquirir)
 *   ok:false  -> reason: "unsupported" | "hidden" | "rejected"
 *
 * `enabled` é a INTENÇÃO declarada pela UI; `active` é o bloqueio REALMENTE
 * vivo. São coisas diferentes de propósito: sem suporte (ou com o navegador
 * recusando) a intenção continua registrada e o treino segue normalmente.
 *
 * GARANTIAS
 *   - NUNCA rejeita e nunca lança: toda falha do navegador vira `ok:false`.
 *   - Sem solicitações duplicadas: sentinel vivo é reaproveitado e uma
 *     solicitação em voo (`inflight`) é devolvida em vez de repetida.
 *   - Sem referência a sentinel já liberado: a liberação explícita e o evento
 *     `release` do próprio sentinel zeram a referência ANTES de liberar, e
 *     liberar de novo é no-op (o listener também não fica órfão).
 *   - Aba escondida: não se pede bloqueio (o navegador rejeitaria); quando a
 *     aba volta a ficar visível, `onVisibility` reavalia sozinho se a intenção
 *     continua ligada.
 *   - UM único listener de `visibilitychange` por documento (`attach`
 *     idempotente), removível por `detach`.
 *   - Nada de DOM/`Persistence`/`EventBus`/`localStorage`: `navigator` e
 *     `document` são lidos só quando existem (carrega em Node/`vm`).
 *
 * Carregado antes do script principal. Expõe no global (`globalThis.WakeLock`)
 * e em `module.exports`. Sem dependências.
 */
(function (global) {
  "use strict";

  const TYPE = "screen"; // único tipo de wake lock usado pelo app

  const MESSAGES = {
    unsupported: "Este navegador não mantém a tela acesa durante o treino.",
    hidden: "A página não está visível: o bloqueio volta quando ela reaparecer.",
    rejected: "O navegador recusou manter a tela acesa.",
  };

  // Estado do adaptador: apenas a PRÓPRIA intenção e o sentinel do navegador.
  let enabled = false;        // a UI quer a tela acesa agora?
  let sentinel = null;        // WakeLockSentinel vivo (null quando não há)
  let sentinelHandler = null; // handler do evento `release` do sentinel atual
  let inflight = null;        // solicitação em andamento (evita duplicidade)
  let visDoc = null;          // documento observado por `attach`
  let visHandler = null;      // handler ÚNICO de `visibilitychange`

  // -------------------------------------------------------------------------
  // Leitura do ambiente (defensiva: funciona sem navegador)
  // -------------------------------------------------------------------------

  function wakeApi() {
    const nav = global.navigator;
    return (nav && nav.wakeLock && typeof nav.wakeLock.request === "function") ? nav.wakeLock : null;
  }

  function isSupported() {
    return !!wakeApi();
  }

  function isActive() {
    return !!(sentinel && sentinel.released !== true);
  }

  function isEnabled() {
    return enabled;
  }

  function visibilityState() {
    if (visDoc && visDoc.visibilityState) return visDoc.visibilityState;
    const doc = global.document;
    if (doc && doc.visibilityState) return doc.visibilityState;
    return "visible"; // sem documento (Node/vm): assume visível
  }

  function errorText(err) {
    if (!err) return null;
    if (typeof err === "string") return err;
    return err.message ? String(err.message) : String(err);
  }

  function state(extra) {
    const base = {
      ok: true, reason: null, message: "",
      supported: isSupported(), enabled: enabled, active: isActive(),
      acquired: false, error: null,
    };
    return extra ? Object.assign(base, extra) : base;
  }

  function fail(reason, error) {
    return {
      ok: false, reason: reason, message: MESSAGES[reason] || "",
      supported: isSupported(), enabled: enabled, active: isActive(),
      acquired: false, error: errorText(error),
    };
  }

  // -------------------------------------------------------------------------
  // Sentinel
  // -------------------------------------------------------------------------

  /** Solta a referência (e o listener) SEM tocar no navegador. */
  function forgetSentinel() {
    const s = sentinel;
    if (s && sentinelHandler && typeof s.removeEventListener === "function") {
      try { s.removeEventListener("release", sentinelHandler); } catch (err) { /* ignora */ }
    }
    sentinel = null;
    sentinelHandler = null;
  }

  /**
   * O navegador pode liberar o sentinel SOZINHO (aba escondida, troca de app,
   * economia de energia). Não é erro: só não há mais bloqueio vivo — a
   * intenção continua registrada e a volta à visibilidade reavalia.
   */
  function watchSentinel(s) {
    sentinelHandler = function () {
      if (sentinel === s) forgetSentinel();
    };
    if (typeof s.addEventListener === "function") {
      try { s.addEventListener("release", sentinelHandler); } catch (err) { sentinelHandler = null; }
    }
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  /** Liga a intenção e adquire o bloqueio (idempotente). */
  function request(reason) {
    enabled = true;
    if (!isSupported()) return Promise.resolve(fail("unsupported"));
    if (isActive()) return Promise.resolve(state());
    if (inflight) return inflight;
    if (visibilityState() === "hidden") return Promise.resolve(fail("hidden"));

    const lib = wakeApi();
    const job = Promise.resolve()
      .then(function () { return lib.request(TYPE); })
      .then(function (s) {
        if (!s || typeof s.release !== "function") throw new Error("sentinel inválido");
        if (!enabled) {
          // A intenção caiu enquanto a solicitação estava em voo.
          try { s.release(); } catch (err) { /* ignora */ }
          return state({ active: false });
        }
        sentinel = s;
        watchSentinel(s);
        return state({ active: true, acquired: true });
      })
      .catch(function (err) {
        forgetSentinel();
        return fail("rejected", err);
      })
      .then(function (res) {
        if (inflight === job) inflight = null;
        return res;
      });

    inflight = job;
    return job;
  }

  /** Libera o bloqueio e desliga a intenção (no-op quando não há bloqueio). */
  function release(reason) {
    enabled = false;
    const s = isActive() ? sentinel : null;
    forgetSentinel(); // nunca guarda referência a sentinel liberado
    if (!s) return Promise.resolve(state());

    return Promise.resolve()
      .then(function () { return s.release(); })
      .then(function () { return state(); })
      .catch(function (err) {
        // Sentinel já morto/inválido: o objetivo (não haver bloqueio) está
        // cumprido. Não é motivo para alarmar o treino.
        return state({ error: errorText(err) });
      });
  }

  function setEnabled(shouldHold, reason) {
    return shouldHold ? request(reason) : release(reason);
  }

  /**
   * Reavalia a tela acesa quando a visibilidade muda. Escondida, o navegador
   * já libera (a intenção fica); visível, pede de novo se a intenção segue.
   */
  function onVisibility(visible) {
    if (visible === false) return Promise.resolve(state({ active: isActive() }));
    if (!enabled || isActive()) return Promise.resolve(state({ active: isActive() }));
    return request("visibility");
  }

  /**
   * Instala o listener ÚNICO de `visibilitychange` (idempotente: chamar de
   * novo com o mesmo documento não registra outro listener).
   * @returns {Boolean} true se há documento observado
   */
  function attach(target) {
    const doc = target || global.document;
    if (!doc || typeof doc.addEventListener !== "function") return false;
    if (visDoc === doc && visHandler) return true;
    detach();
    visDoc = doc;
    visHandler = function () { onVisibility(doc.visibilityState !== "hidden"); };
    doc.addEventListener("visibilitychange", visHandler);
    return true;
  }

  /** Remove o listener de visibilidade (limpeza de ciclo de vida). */
  function detach() {
    const had = !!(visDoc && visHandler);
    if (had && typeof visDoc.removeEventListener === "function") {
      try { visDoc.removeEventListener("visibilitychange", visHandler); } catch (err) { /* ignora */ }
    }
    visDoc = null;
    visHandler = null;
    return had;
  }

  function status() {
    return {
      supported: isSupported(),
      enabled: enabled,
      active: isActive(),
      attached: !!(visDoc && visHandler),
      inflight: !!inflight,
    };
  }

  /** Teardown completo (fim de ciclo de vida / testes). */
  function reset() {
    enabled = false;
    inflight = null;
    forgetSentinel();
    detach();
    return true;
  }

  const WakeLock = {
    MESSAGES: MESSAGES,
    isSupported: isSupported,
    isEnabled: isEnabled,
    isActive: isActive,
    request: request,
    release: release,
    setEnabled: setEnabled,
    onVisibility: onVisibility,
    attach: attach,
    detach: detach,
    status: status,
    reset: reset,
  };

  global.WakeLock = WakeLock;
  if (typeof module !== "undefined" && module.exports) module.exports = WakeLock;
})(typeof globalThis !== "undefined" ? globalThis : this);
