/**
 * js/custom-catalog.js — Adaptador de apresentação do catálogo personalizado.
 * ---------------------------------------------------------------------------
 * Mantém o catálogo OFICIAL intocado e compõe, apenas para as telas:
 *
 *   oficial (primeiro) -> personalizado -> fallback
 *
 * Não valida cadastro nem persiste nada: essas responsabilidades continuam em
 * `js/custom-exercises.js` e `js/persistence.js`. Aqui só há transformação de
 * dados e resolução de id, sem DOM e sem storage.
 *
 * Depende de: js/custom-exercises.js (opcional em runtime; sem ele o adaptador
 * devolve apenas os itens oficiais/fallback).
 * Expõe `window.CustomCatalog` e `module.exports`.
 */
(function (global) {
  "use strict";

  function domain() {
    return global.CustomExercises || null;
  }

  /** Registros personalizados no shape das telas (com `custom: true`). */
  function items(customList, imageOf) {
    const cx = domain();
    if (!cx || typeof cx.toPrototype !== "function" || !Array.isArray(customList)) return [];
    return customList
      .map((exercise) => cx.toPrototype(exercise, imageOf))
      .filter(Boolean);
  }

  /**
   * Resolve um `catalogId` na ordem oficial -> personalizado -> fallback.
   * Um id oficial vence até uma colisão hipotética com um personalizado.
   */
  function resolve(id, officialList, customList, fallback, imageOf) {
    const official = (Array.isArray(officialList) ? officialList : [])
      .find((item) => item && item.id === id);
    if (official) return official;

    const custom = items(customList, imageOf).find((item) => item && item.id === id);
    if (custom) return custom;

    return fallback || null;
  }

  /**
   * Junta resultados oficiais já filtrados aos personalizados que casam com o
   * termo/grupo. A ordem devolvida é sempre a da resolução: oficiais primeiro.
   */
  function search(officialResults, customList, term, group, imageOf) {
    const official = Array.isArray(officialResults) ? officialResults.slice() : [];
    const cx = domain();
    if (!cx || typeof cx.search !== "function") return official;

    const matched = cx.search(customList, term, group);
    return official.concat(items(matched, imageOf));
  }

  const CustomCatalog = {
    items,
    resolve,
    search,
  };

  global.CustomCatalog = CustomCatalog;
  if (typeof module !== "undefined" && module.exports) module.exports = CustomCatalog;
})(typeof globalThis !== "undefined" ? globalThis : this);
