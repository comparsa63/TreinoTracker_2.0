/**
 * js/catalog.js — Catálogo real de exercícios (Fase 2B).
 * ---------------------------------------------------------------------------
 * Ponte entre os DADOS puros (`js/data/exercises.js`, porte do `ExerciseCatalog`
 * do TreinoTracker) e o formato consumido pelas telas do protótipo:
 *
 *     { id, name, muscle, img, en, equipment }
 *
 * Objetivo da fase: substituir o mock com hotlink do Unsplash por dados reais
 * e imagens locais (assets/images/*.jpg), sem tocar na Home.
 *
 * Não depende de nenhum módulo (usa TTUtils.normalize se disponível).
 */
(function (global) {
  "use strict";

  // Grupo muscular -> ícone de anatomia local (assets/images/).
  const MUSCLE_IMAGES = {
    "Bíceps": "assets/images/biceps.jpg",
    "Tríceps": "assets/images/triceps.jpg",
    "Peito": "assets/images/peito.jpg",
    "Costas": "assets/images/costas.jpg",
    "Ombro": "assets/images/ombro.jpg",
    "Ombros": "assets/images/ombro.jpg",
    "Trapézio": "assets/images/trapezio.jpg",
    "Pernas": "assets/images/quadriceps.jpg",
    "Quadríceps": "assets/images/quadriceps.jpg",
    "Glúteo": "assets/images/gluteos.jpg",
    "Glúteos": "assets/images/gluteos.jpg",
    "Abdômen": "assets/images/abdomen.jpg",
    "Antebraço": "assets/images/ante_braco.jpg",
    "Lombar": "assets/images/lombar.jpg",
    "Panturrilha": "assets/images/panturrilha.jpg",
    "Posterior de Coxa": "assets/images/posterior_de_coxa.jpg",
    "Manguito Rotador": "assets/images/ombro.jpg",
  };

  const FALLBACK_IMAGE = "assets/images/quadriceps.jpg";

  /** Fonte de dados: global (browser) ou require (Node, testes). */
  function dataSource() {
    if (global.ExerciseCatalog && Array.isArray(global.ExerciseCatalog.exercicios)) {
      return global.ExerciseCatalog;
    }
    if (typeof require === "function") {
      try {
        return require("./data/exercises.js");
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  function normalize(value) {
    const u = global.TTUtils;
    if (u && typeof u.normalize === "function") return u.normalize(value);
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function list() {
    const d = dataSource();
    return d && Array.isArray(d.exercicios) ? d.exercicios : [];
  }

  function muscleOf(ex) {
    return ex.grupoMuscular || ex.group || "";
  }

  function nameOf(ex) {
    return ex.nome || ex.pt || ex.en || "";
  }

  /** Imagem local para um grupo muscular (com fallback). */
  function muscleImage(group) {
    return MUSCLE_IMAGES[group] || FALLBACK_IMAGE;
  }

  /** Converte um registro do catálogo no shape do protótipo. */
  function toPrototype(ex) {
    const group = muscleOf(ex);
    return {
      id: ex.id || nameOf(ex),
      name: nameOf(ex),
      en: ex.en || "",
      muscle: group,
      equipment: ex.equipment || ex.equipamento || "",
      img: muscleImage(group),
    };
  }

  const Catalog = {
    FALLBACK_IMAGE,
    MUSCLE_IMAGES,

    muscleImage,

    /** Grupos musculares realmente presentes no catálogo (ordem de aparição). */
    groups() {
      const seen = Object.create(null);
      const out = [];
      list().forEach((ex) => {
        const g = muscleOf(ex);
        if (g && !seen[g]) {
          seen[g] = true;
          out.push(g);
        }
      });
      return out;
    },

    /** Registros crus do catálogo. */
    all() {
      return list();
    },

    /** Catálogo no formato das telas do protótipo. */
    forPrototype() {
      return list().map(toPrototype);
    },

    /** Busca um registro cru por id (ou, como fallback, por nome). */
    find(id) {
      return list().find((ex) => ex.id === id || nameOf(ex) === id) || null;
    },

    /** Busca um registro cru pelo nome normalizado. */
    byName(name) {
      const n = normalize(name);
      return list().find((ex) => normalize(nameOf(ex)) === n) || null;
    },

    // ── API no espírito do ExerciseRepository (TreinoTracker) ──────────
    // Consumida por telas futuras (modal do exercício, "como executar").

    findById(id) {
      return list().find((ex) => ex.id === id) || null;
    },

    findByGroup(group) {
      const g = normalize(group);
      return list().filter((ex) => normalize(muscleOf(ex)) === g);
    },

    findByMuscle(muscle) {
      const m = normalize(muscle);
      return list().filter((ex) => {
        const pools = [].concat(ex.muscles || [], ex.secondary || []);
        return pools.some((v) => normalize(v).indexOf(m) !== -1);
      });
    },

    hasInstructions(name) {
      const ex = Catalog.byName(name);
      return !!(ex && Array.isArray(ex.instructions) && ex.instructions.length > 0);
    },

    getInstructions(name) {
      const ex = Catalog.byName(name);
      return ex && Array.isArray(ex.instructions) ? ex.instructions : [];
    },

    getMistakes(name) {
      const ex = Catalog.byName(name);
      return ex && Array.isArray(ex.mistakes) ? ex.mistakes : [];
    },

    getTips(name) {
      const ex = Catalog.byName(name);
      return ex && Array.isArray(ex.tips) ? ex.tips : [];
    },

    /**
     * Busca para a tela de adicionar exercício.
     * @param {string} term  texto livre
     * @param {string} group grupo muscular (ou 'all')
     * @returns {Array} itens no formato do protótipo
     */
    search(term, group) {
      const t = normalize(term);
      const g = group && group !== "all" ? group : null;
      return list()
        .filter((ex) => {
          if (g && muscleOf(ex) !== g) return false;
          if (!t) return true;
          return [nameOf(ex), ex.en, muscleOf(ex), ex.equipment, ex.equipamento]
            .some((v) => normalize(v).indexOf(t) !== -1);
        })
        .map(toPrototype);
    },
  };

  global.Catalog = Catalog;
  if (typeof module !== "undefined" && module.exports) module.exports = Catalog;
})(typeof globalThis !== "undefined" ? globalThis : this);
