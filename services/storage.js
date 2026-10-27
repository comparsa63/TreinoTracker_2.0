/**
 * services/storage.js — Camada de persistência (wrapper de localStorage).
 * ---------------------------------------------------------------------------
 * Responsabilidades:
 *   - Namespacear as chaves (prefixo) para não colidir com outras apps/versões.
 *   - Serializar/deserializar JSON com tolerância a falhas.
 *   - Nunca lançar: se o localStorage estiver indisponível (modo privado,
 *     quota cheia), cai para um fallback em memória e a app continua viva.
 *
 * Não depende de nenhum outro módulo.
 */
(function (global) {
  "use strict";

  const PREFIX = "tt_ds_v1_";
  const memory = Object.create(null);

  function getBackend() {
    try {
      const ls = global.localStorage;
      if (!ls) return null;
      const probe = PREFIX + "__probe__";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      return ls;
    } catch (err) {
      return null;
    }
  }

  const StorageService = {
    PREFIX,
    /** true se o localStorage real está utilizável nesta sessão. */
    isPersistent() {
      return getBackend() !== null;
    },

    /** Nome físico da chave (com prefixo). */
    key(name) {
      return PREFIX + name;
    },

    /** Chaves da app presentes no storage (sem o prefixo). */
    keys() {
      const backend = getBackend();
      if (!backend) return Object.keys(memory);
      const out = [];
      for (let i = 0; i < backend.length; i++) {
        const k = backend.key(i);
        if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
      }
      return out;
    },

    /**
     * Grava um valor (qualquer JSON-serializável). Retorna true/false.
     * Nunca lança.
     *
     * Por padrão, quando o backend não está disponível ou falha, o payload
     * também fica no fallback em memória (comportamento histórico). O chamador
     * que precisa distinguir gravação durável de fallback pode passar
     * `{ memoryFallback: false }`; nesse caso uma falha não altera a memória.
     */
    save(name, value, options) {
      let payload;
      try {
        payload = JSON.stringify(value);
      } catch (err) {
        console.warn("[Storage] não serializável:", name, err);
        return false;
      }
      const opts = options || {};
      const memoryFallback = opts.memoryFallback !== false;
      const backend = getBackend();
      const physical = PREFIX + name;
      if (!backend) {
        if (memoryFallback) memory[physical] = payload;
        else delete memory[physical];
        return false;
      }
      try {
        backend.setItem(physical, payload);
        return true;
      } catch (err) {
        console.warn("[Storage] falha ao gravar (quota?):", name, err);
        if (memoryFallback) memory[physical] = payload;
        else delete memory[physical];
        return false;
      }
    },

    /** Lê e desserializa. Retorna `fallback` se ausente ou corrompido. */
    load(name, fallback) {
      const fb = arguments.length > 1 ? fallback : null;
      const physical = PREFIX + name;
      const backend = getBackend();
      let raw = null;
      if (backend) {
        try {
          raw = backend.getItem(physical);
        } catch (err) {
          raw = null;
        }
      }
      if (raw === null && physical in memory) raw = memory[physical];
      if (raw === null || raw === undefined) return fb;
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.warn("[Storage] dado corrompido, ignorando:", name, err);
        return fb;
      }
    },

    has(name) {
      const backend = getBackend();
      const physical = PREFIX + name;
      if (backend) {
        try {
          return backend.getItem(physical) !== null;
        } catch (err) {
          return false;
        }
      }
      return physical in memory;
    },

    remove(name) {
      const physical = PREFIX + name;
      const backend = getBackend();
      if (backend) {
        try {
          backend.removeItem(physical);
        } catch (err) {
          /* ignora */
        }
      }
      delete memory[physical];
    },

    /** Remove TODAS as chaves da app (com o prefixo). Só a app, não o domínio. */
    clear() {
      StorageService.keys().forEach((k) => StorageService.remove(k));
      Object.keys(memory).forEach((k) => delete memory[k]);
    },
  };

  global.StorageService = StorageService;
  if (typeof module !== "undefined" && module.exports) module.exports = StorageService;
})(typeof globalThis !== "undefined" ? globalThis : this);
