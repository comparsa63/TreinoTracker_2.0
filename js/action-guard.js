/**
 * js/action-guard.js — blindagem de TOQUE DUPLO da UI (Sprint 4 / E6).
 * ---------------------------------------------------------------------------
 * Responsabilidade ÚNICA: decidir se uma INTENÇÃO de UI pode ser executada
 * agora, considerando a última vez que a MESMA intenção foi aceita. É a cerca
 * contra o toque duplo: "Concluir Série" duas vezes em milissegundos
 * registraria DUAS séries (a segunda com os mesmos valores) e o alternador
 * Pausar/Retomar pausaria E retomaria em sequência.
 *
 * Puro de propósito: recebe `now` (injetável — nunca lê o relógio) e não
 * conhece DOM, localStorage, Persistence, EventBus, timers nem a sessão.
 * Quem decide QUAIS intenções são blindadas e qual a CHAVE de cada uma é a UI
 * (o mesmo botão pode ter intenções diferentes conforme o estado).
 *
 * CONTRATO
 *   WINDOW_MS            -> Number  janela padrão (400 ms)
 *   create(windowMs?)    -> Guard   instância isolada; windowMs inválido cai no padrão
 *   accept(key, now)     -> Boolean true na PRIMEIRA chamada e nas chamadas fora
 *                                   da janela; false nas repetições dentro dela
 *   forget(key)          -> Boolean true se havia janela aberta para a chave
 *   lastAt(key)          -> Number|null  ms do último ACEITE da chave
 *   reset()              -> Number   quantas chaves foram esquecidas
 *
 * GARANTIAS
 *   - Nada de "flag presa": a janela é contada a partir do último ACEITE, então
 *     uma chamada RECUSADA não a estende — o pior caso é esperar a janela.
 *   - Chamada malformada (chave vazia/não-string ou `now` inválido) devolve
 *     false e NÃO mexe no estado (fail-closed: o mal-entendido não libera a ação).
 *   - Relógio para trás não libera a ação (diferença negativa cai dentro da janela).
 *   - Sem efeito colateral: o único estado é key -> ms do último aceite.
 */
(function (global) {
  "use strict";

  /** Janela padrão entre dois toques que ainda são UM toque (toque duplo humano
   *  fica em ~250-300 ms; séries reais são separadas por segundos). */
  const WINDOW_MS = 400;

  /** Normaliza o instante: Date ou number (ms). Qualquer outra coisa -> null.
   *  `[object Date]` em vez de `instanceof` porque Date não atravessa realms. */
  function toMs(value) {
    if (Object.prototype.toString.call(value) === "[object Date]") {
      const t = value.getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  }

  function create(windowMs) {
    const win = (typeof windowMs === "number" && Number.isFinite(windowMs) && windowMs > 0)
      ? windowMs
      : WINDOW_MS;
    const last = Object.create(null);

    /** `true` = pode executar agora (e a janela passa a contar daqui). */
    function accept(key, now) {
      const at = toMs(now);
      if (typeof key !== "string" || key === "" || at === null) return false;
      const previous = last[key];
      if (previous !== undefined && at - previous < win) return false;
      last[key] = at;
      return true;
    }

    /** Devolve a janela (usado quando a ação foi recusada: recusa não é toque). */
    function forget(key) {
      if (typeof key !== "string" || last[key] === undefined) return false;
      delete last[key];
      return true;
    }

    /** ms do último aceite (introspectivo; null quando nunca foi aceita). */
    function lastAt(key) {
      return (typeof key === "string" && last[key] !== undefined) ? last[key] : null;
    }

    function reset() {
      const keys = Object.keys(last);
      keys.forEach((k) => { delete last[k]; });
      return keys.length;
    }

    return { windowMs: win, accept: accept, forget: forget, lastAt: lastAt, reset: reset };
  }

  const ActionGuard = { WINDOW_MS: WINDOW_MS, create: create };

  global.ActionGuard = ActionGuard;
  if (typeof module !== "undefined" && module.exports) module.exports = ActionGuard;
})(typeof globalThis !== "undefined" ? globalThis : this);
