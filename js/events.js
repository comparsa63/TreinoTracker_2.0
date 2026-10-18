/**
 * js/events.js — Event Bus (pub/sub) para comunicação entre módulos.
 * ---------------------------------------------------------------------------
 * Porte fiel do `EventBus` do TreinoTracker original (js/events.js), com a
 * mesma API (on/off/emit) e a mesma tolerância a erros de listeners.
 *
 * Zero dependências. Carregado antes do script principal. Expõe
 * `window.EventBus` no navegador e `module.exports` no Node (testes).
 *
 * Não cria uma segunda camada de estado: apenas notifica eventos como
 * `routine:deleted`, `history:added` e `pr:new`.
 */
(function (global) {
  "use strict";

  const EventBus = {
    _listeners: {},

    on(event, callback) {
      if (typeof callback !== "function") return;
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(callback);
    },

    off(event, callback) {
      if (!this._listeners[event]) return;
      if (!callback) {
        this._listeners[event] = [];
        return;
      }
      this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
    },

    /** Emite o evento para uma cópia da lista (listener pode se remover). */
    emit(event, data) {
      if (!this._listeners[event]) return;
      // Ignora eventos internos herdados de Object.prototype.
      if (!Object.prototype.hasOwnProperty.call(this._listeners, event)) return;
      const cbs = this._listeners[event].slice();
      for (let i = 0; i < cbs.length; i++) {
        try {
          cbs[i](data);
        } catch (e) {
          // silent (mesmo comportamento do original)
        }
      }
    },

    /** Remove todos os listeners (usado em testes/reinício). */
    clear() {
      this._listeners = {};
    },

    /** Quantidade de listeners de um evento. */
    count(event) {
      return this._listeners[event] ? this._listeners[event].length : 0;
    },
  };

  global.EventBus = EventBus;
  if (typeof module !== "undefined" && module.exports) module.exports = EventBus;
})(typeof globalThis !== "undefined" ? globalThis : this);
