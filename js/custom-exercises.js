/**
 * js/custom-exercises.js — Domínio dos exercícios personalizados (Sprint 5.2.1).
 * ---------------------------------------------------------------------------
 * Responsabilidades:
 *   - Validar nome (obrigatório, até 60 caracteres) e grupo muscular (um dos
 *     grupos oficiais informados pelo chamador).
 *   - Impedir duplicidade GLOBAL por nome normalizado (caixa, acentos e espaços
 *     excedentes nas extremidades), considerando catálogo oficial + personalizados.
 *   - Gerar identificadores estáveis no padrão `cx_...`, compatíveis com
 *     `catalogId` das rotinas, da sessão e dos PRs.
 *   - Sanear dados carregados contra IDs seguros, grupos oficiais e nomes do
 *     catálogo oficial fornecidos pelo chamador.
 *   - Criar/renomear/remover sem mutar a lista recebida e sem tocar em DOM,
 *     storage, estado da aplicação ou Persistence.
 *   - Bloquear a exclusão quando o exercício está em uso por rotina, buffer de
 *     edição ou sessão de treino.
 *
 * O catálogo oficial permanece separado: este módulo recebe apenas os nomes e
 * grupos oficiais como parâmetro e nunca os altera.
 *
 * Depende de (opcional): js/utils.js (`TTUtils.normalize`/`TTUtils.uid`).
 * Expõe `window.CustomExercises` e `module.exports`.
 */
(function (global) {
  "use strict";

  const ID_PREFIX = "cx_";
  const ID_PATTERN = /^cx_[A-Za-z0-9_-]+$/;
  const ID_MAX = 128;
  const NAME_MAX = 60;

  const MESSAGES = {
    "name-required": "Informe o nome do exercício.",
    "name-too-long": "O nome do exercício deve ter no máximo " + NAME_MAX + " caracteres.",
    "name-duplicate-official": "Já existe um exercício com esse nome no catálogo oficial.",
    "name-duplicate-custom": "Já existe um exercício personalizado com esse nome.",
    "muscle-required": "Selecione o grupo muscular.",
    "muscle-invalid": "Selecione um grupo muscular válido.",
    "not-found": "Exercício personalizado não encontrado.",
    "in-use": "Exercício em uso. Remova-o antes de excluir.",
  };

  function ttUtils() {
    return global.TTUtils || null;
  }

  /** Normaliza texto para comparação: sem acentos, minúsculo, espaços colapsados. */
  function normalize(value) {
    const u = ttUtils();
    if (u && typeof u.normalize === "function") return u.normalize(value);
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  /** Nome persistido: espaços das extremidades removidos e limite respeitado. */
  function cleanName(value) {
    const name = trim(value);
    return name.length > NAME_MAX ? name.slice(0, NAME_MAX) : name;
  }

  /**
   * IDs persistidos só podem conter o prefixo `cx_` e caracteres seguros.
   * Isso impede que dados malformados do storage entrem em atributos/handlers
   * da interface (ex.: `cx_');alert(1)//`).
   */
  function isValidId(id) {
    return typeof id === "string" && id.length <= ID_MAX && ID_PATTERN.test(id);
  }

  function defaultIdFactory() {
    const u = ttUtils();
    if (u && typeof u.uid === "function") return u.uid("cx");
    return ID_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Gera um id `cx_` ainda não presente na lista. Um `idFactory` injetado é
   * usado primeiro (testes/importação); colisões e valores inválidos são
   * descartados antes do fallback interno.
   */
  function uniqueId(list, idFactory) {
    const used = new Set((Array.isArray(list) ? list : []).map((ex) => ex && ex.id));
    const make = typeof idFactory === "function" ? idFactory : defaultIdFactory;

    for (let i = 0; i < 50; i++) {
      const id = make();
      if (isValidId(id) && !used.has(id)) return id;
    }

    const base = defaultIdFactory();
    let id = base;
    let suffix = 1;
    while (used.has(id)) {
      id = base + "_" + suffix;
      suffix++;
    }
    return id;
  }

  /** Nome de um registro oficial, aceitando string ou objeto do catálogo. */
  function officialName(item) {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    return item.nome || item.pt || item.name || item.en || "";
  }

  function officialList(officialNames) {
    return (Array.isArray(officialNames) ? officialNames : [])
      .map(officialName)
      .filter(Boolean);
  }

  /**
   * Procura duplicidade global por nome normalizado.
   * @returns {null|{source:"official"|"custom",name:string,id?:string}}
   */
  function findDuplicate(list, name, options) {
    const opts = options || {};
    const normalized = normalize(name);
    if (!normalized) return null;

    const official = officialList(opts.officialNames).find((it) => normalize(it) === normalized);
    if (official) return { source: "official", name: official };

    const custom = (Array.isArray(list) ? list : []).find(
      (ex) => ex && ex.id !== opts.ignoreId && normalize(ex.name) === normalized
    );
    if (custom) return { source: "custom", id: custom.id, name: custom.name };

    return null;
  }

  function validateName(name, options) {
    const value = trim(name);
    if (!value) {
      return { ok: false, reason: "name-required", message: MESSAGES["name-required"] };
    }
    if (value.length > NAME_MAX) {
      return {
        ok: false,
        reason: "name-too-long",
        message: MESSAGES["name-too-long"],
      };
    }

    const duplicate = findDuplicate(options && options.list, value, options);
    if (duplicate) {
      const reason = duplicate.source === "official" ? "name-duplicate-official" : "name-duplicate-custom";
      return { ok: false, reason, message: MESSAGES[reason], duplicate };
    }

    return { ok: true, reason: null, message: "", value };
  }

  function validateMuscle(muscle, groups) {
    const value = trim(muscle);
    if (!value) {
      return { ok: false, reason: "muscle-required", message: MESSAGES["muscle-required"] };
    }

    // A lista de grupos oficiais é a autoridade: sem ela não há como garantir
    // que o grupo pertence ao catálogo existente.
    if (!Array.isArray(groups) || groups.length === 0) {
      return { ok: false, reason: "muscle-invalid", message: MESSAGES["muscle-invalid"] };
    }

    const canonical = groups.find((group) => normalize(group) === normalize(value));
    if (!canonical) {
      return { ok: false, reason: "muscle-invalid", message: MESSAGES["muscle-invalid"] };
    }
    return { ok: true, reason: null, message: "", value: canonical };
  }

  /** Valida o payload completo, devolvendo os valores já canônicos. */
  function validate(data, options) {
    const payload = data || {};
    const name = validateName(payload.name, options);
    if (!name.ok) return name;

    const muscle = validateMuscle(payload.muscle, options && options.groups);
    if (!muscle.ok) return muscle;

    return {
      ok: true,
      reason: null,
      message: "",
      value: { name: name.value, muscle: muscle.value },
    };
  }

  function create(list, data, options) {
    const current = Array.isArray(list) ? list : [];
    const opts = options || {};
    const result = validate(data, {
      list: current,
      officialNames: opts.officialNames,
      groups: opts.groups,
    });

    if (!result.ok) {
      return { ok: false, reason: result.reason, message: result.message, list: current };
    }

    const exercise = {
      id: uniqueId(current, opts.idFactory),
      name: result.value.name,
      muscle: result.value.muscle,
    };

    return {
      ok: true,
      reason: null,
      message: "",
      exercise,
      list: current.concat([exercise]),
    };
  }

  function update(list, id, data, options) {
    const current = Array.isArray(list) ? list : [];
    const index = isValidId(id) ? current.findIndex((ex) => ex && ex.id === id) : -1;
    if (index === -1) {
      return { ok: false, reason: "not-found", message: MESSAGES["not-found"], list: current };
    }

    const existing = current[index];
    const patch = data || {};
    const opts = options || {};
    const result = validate(
      {
        name: patch.name !== undefined ? patch.name : existing.name,
        muscle: patch.muscle !== undefined ? patch.muscle : existing.muscle,
      },
      {
        list: current,
        officialNames: opts.officialNames,
        groups: opts.groups,
        ignoreId: id,
      }
    );

    if (!result.ok) {
      return { ok: false, reason: result.reason, message: result.message, list: current };
    }

    const next = current.slice();
    next[index] = {
      id: existing.id,
      name: result.value.name,
      muscle: result.value.muscle,
    };

    return {
      ok: true,
      reason: null,
      message: "",
      exercise: next[index],
      list: next,
    };
  }

  function routineRef(routine) {
    if (!routine || typeof routine !== "object") return null;
    return {
      id: routine.id == null ? null : routine.id,
      letter: routine.letter || "",
      name: routine.name || "",
    };
  }

  function usesExercise(routine, id) {
    const exercises = routine && Array.isArray(routine.exercises) ? routine.exercises : [];
    return exercises.some((ex) => ex && (ex.catalogId === id || ex.id === id));
  }

  function routineLabel(routine) {
    if (!routine) return "";
    const name = trim(routine.name);
    if (routine.letter && name && name !== "Treino " + routine.letter) {
      return "Treino " + routine.letter + " - " + name;
    }
    if (name) return name;
    return routine.letter ? "Treino " + routine.letter : "Rotina sem nome";
  }

  function usageMessage(routines, tempRoutine, session) {
    const parts = [];
    if (routines.length) {
      parts.push("nas rotinas: " + routines.map(routineLabel).join(", "));
    }
    if (tempRoutine) parts.push("no treino em edição");
    if (session) parts.push("no treino em andamento");

    const actions = [];
    if (routines.length || tempRoutine) {
      actions.push("remova-o das rotinas ou do treino em edição");
    }
    if (session) actions.push("finalize ou descarte o treino em andamento");

    const actionText = actions.join(" e ");
    return "Exercício em uso " + parts.join("; ") + ". " +
      actionText.charAt(0).toUpperCase() + actionText.slice(1) + " antes de excluir.";
  }

  /**
   * Relatório de uso por rotinas salvas, buffer de edição e sessão ativa.
   * Exercícios legados (`id`) e enriquecidos (`catalogId`) são considerados.
   */
  function usageReport(id, options) {
    const opts = options || {};
    const routines = [];
    const seen = new Set();

    (Array.isArray(opts.routines) ? opts.routines : []).forEach((routine) => {
      if (!usesExercise(routine, id)) return;
      const key = routine && routine.id != null
        ? "r:" + routine.id
        : "n:" + (routine && routine.name) + ":" + (routine && routine.letter);
      if (seen.has(key)) return;
      seen.add(key);
      routines.push(routineRef(routine));
    });

    const temp = opts.tempRoutine && usesExercise(opts.tempRoutine, id)
      ? routineRef(opts.tempRoutine)
      : null;
    // Se o buffer é a mesma rotina já listada, não repetir a origem no aviso.
    const tempRoutine = temp && !(temp.id != null && routines.some((r) => r.id === temp.id))
      ? temp
      : null;

    const session = !!(opts.session &&
      Array.isArray(opts.session.exercises) &&
      opts.session.exercises.some((ex) => ex && (ex.catalogId === id || ex.id === id)));

    const used = routines.length > 0 || !!tempRoutine || session;
    return {
      used,
      routines,
      tempRoutine,
      session,
      message: used ? usageMessage(routines, tempRoutine, session) : "",
    };
  }

  function remove(list, id, options) {
    const current = Array.isArray(list) ? list : [];
    const index = isValidId(id) ? current.findIndex((ex) => ex && ex.id === id) : -1;
    if (index === -1) {
      return { ok: false, reason: "not-found", message: MESSAGES["not-found"], list: current };
    }

    const usage = usageReport(id, options);
    if (usage.used) {
      return {
        ok: false,
        reason: "in-use",
        message: usage.message,
        usage,
        list: current,
      };
    }

    return {
      ok: true,
      reason: null,
      message: "",
      removed: current[index],
      list: current.filter((ex) => ex && ex.id !== id),
    };
  }

  function findById(list, id) {
    if (!isValidId(id)) return null;
    return (Array.isArray(list) ? list : []).find((ex) => ex && ex.id === id) || null;
  }

  /**
   * Saneia dados carregados: tolera aliases (`nome`/`grupoMuscular`), valida
   * id contra o padrão seguro, aceita apenas grupos oficiais, descarta nomes
   * que dupliquem o catálogo oficial ou outro personalizado, trunca nomes
   * longos e mantém a ordem dos registros válidos.
   *
   * `options.groups` é obrigatório: sem a fonte oficial não há como garantir
   * que o grupo é válido, então o payload é tratado como não confiável
   * (`null`, preservando o estado em memória). `options.officialNames` ativa a
   * checagem de duplicidade global durante a hidratação.
   * Lista não-array -> null (mesmo contrato da persistência).
   */
  function sanitize(raw, options) {
    const report = sanitizeWithReport(raw, options);
    return report.ok ? report.value : null;
  }

  /**
   * Versão da sanitização que também informa o que aconteceu com o payload.
   * As regras de ID, grupo, nome e duplicidade são exatamente as mesmas de
   * `sanitize`; aqui só acrescentamos contadores para a camada de persistência.
   *
   * @returns {{
   *   ok: boolean,
   *   value: Array|null,
   *   discarded: number,
   *   normalized: number,
   *   reason: "invalid-payload"|"missing-groups"|null
   * }}
   */
  function sanitizeWithReport(raw, options) {
    const report = { ok: false, value: null, discarded: 0, normalized: 0, reason: null };
    if (!Array.isArray(raw)) {
      report.reason = "invalid-payload";
      return report;
    }

    const opts = options || {};
    const groups = Array.isArray(opts.groups) ? opts.groups : [];
    if (groups.length === 0) {
      report.reason = "missing-groups";
      return report;
    }

    const officialNames = new Set(officialList(opts.officialNames).map(normalize));
    const out = [];
    const ids = new Set();
    const names = new Set();
    let discarded = 0;
    let normalizedCount = 0;

    raw.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        discarded++;
        return;
      }

      const id = typeof item.id === "string" ? item.id : "";
      const rawName = item.name != null ? item.name : item.nome;
      const rawMuscle = item.muscle != null
        ? item.muscle
        : (item.grupoMuscular != null ? item.grupoMuscular : item.group);
      const name = cleanName(rawName);
      const muscle = validateMuscle(rawMuscle, groups);
      if (!isValidId(id) || !name || !muscle.ok) {
        discarded++;
        return;
      }

      const nameKey = normalize(name);
      if (ids.has(id) || names.has(nameKey) || officialNames.has(nameKey)) {
        discarded++;
        return;
      }

      if (typeof rawName !== "string" || rawName !== name ||
          typeof rawMuscle !== "string" || rawMuscle !== muscle.value) {
        normalizedCount++;
      }

      ids.add(id);
      names.add(nameKey);
      out.push({ id, name, muscle: muscle.value });
    });

    report.ok = true;
    report.value = out;
    report.discarded = discarded;
    report.normalized = normalizedCount;
    return report;
  }

  /** Busca por termo/grupo (sem acentos, caixa indiferente). Retorna registros crus. */
  function search(list, term, group) {
    const t = normalize(term);
    const g = group && group !== "all" ? normalize(group) : null;

    return (Array.isArray(list) ? list : []).filter((ex) => {
      if (!ex) return false;
      if (g && normalize(ex.muscle) !== g) return false;
      if (!t) return true;
      return normalize(ex.name).indexOf(t) !== -1 || normalize(ex.muscle).indexOf(t) !== -1;
    });
  }

  /** Item no shape consumido pelas telas, sem alterar o catálogo oficial. */
  function toPrototype(exercise, imageOf) {
    if (!exercise || !isValidId(exercise.id)) return null;
    return {
      id: exercise.id,
      name: exercise.name,
      en: "",
      muscle: exercise.muscle,
      subgroup: "",
      equipment: "Personalizado",
      img: typeof imageOf === "function" ? (imageOf(exercise.muscle) || "") : "",
      custom: true,
    };
  }

  const CustomExercises = {
    ID_PREFIX,
    NAME_MAX,
    MESSAGES,

    normalize,
    isValidId,
    officialName,
    findDuplicate,
    validateName,
    validateMuscle,
    validate,
    create,
    update,
    remove,
    usageReport,
    sanitize,
    sanitizeWithReport,
    search,
    toPrototype,
    findById,

    /** Rotinas (salvas) que usam o exercício. Atalho para `usageReport`. */
    usedBy(routines, id) {
      return usageReport(id, { routines }).routines;
    },
  };

  global.CustomExercises = CustomExercises;
  if (typeof module !== "undefined" && module.exports) module.exports = CustomExercises;
})(typeof globalThis !== "undefined" ? globalThis : this);
