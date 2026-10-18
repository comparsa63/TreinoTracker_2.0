/**
 * js/i18n.js — Internacionalização (pt / en / es).
 * ---------------------------------------------------------------------------
 * Fonte ÚNICA de traduções da aplicação. Substitui o objeto `translations`
 * inline do protótipo (o script principal passa a referenciar `I18n.dict`,
 * mantendo o mesmo formato `dict[locale][key]`).
 *
 * IMPORTANTE (regra de ouro da Home):
 *   `I18n.toggle()` percorre APENAS pt <-> en — exatamente como o botão PT/EN
 *   da Home sempre fez. O idioma `es` fica disponível via `setLocale('es')`
 *   para telas futuras, sem alterar o comportamento da Home.
 *
 * Depende de: services/storage.js (opcional, para persistir o idioma).
 */
(function (global) {
  "use strict";

  const LOCALES = ["pt", "en", "es"];
  const FALLBACK = "pt";
  const STORAGE_KEY = "lang";
  const TOGGLE_ORDER = ["pt", "en"]; // comportamento histórico da Home

  const NATIVE_LANG = { pt: "pt-BR", en: "en", es: "es" };

  const dict = {
    pt: {
      greeting: "Olá, Atleta", greeting_sub: "Pronto para o treino de hoje?",
      today_workout: "Treino A — Peito e Tríceps", exercises: "Exercícios", duration: "Duração",
      start_workout: "INICIAR TREINO", last_workout: "Último Treino", completed: "Concluído",
      my_workouts: "Meus treinos", my_workouts_sub: "Suas rotinas personalizadas",
      edit: "Editar", save: "Salvar", add_exercise: "Adicionar exercício",
      add_exercise_title: "Adicionar exercícios", search_placeholder: "Buscar exercício...", all: "Todos",
      configure_exercise: "Configurar exercício", sets: "Séries", reps: "Repetições",
      load_kg: "Carga prevista (kg)", rest_sec: "Descanso (segundos)", save_config: "Salvar configuração",
      workout_prep: "Iniciar treino", total_sets: "Séries totais", workout_exercises: "Exercícios do treino",
      load: "Carga", prev: "Anterior", next: "Próximo", complete_set: "✓ CONCLUIR SÉRIE",
      finish_workout: "FINALIZAR TREINO",
      pause_workout: "Pausar", resume_workout: "Retomar", workout_paused: "Treino pausado",
      rest_label: "Descanso", skip_rest: "Pular Descanso ➔", auto_rest: "Descanso Automático",
      exit_title: "Sair do treino?", exit_desc: "Você ainda tem exercícios/séries pendentes. O que deseja fazer?",
      continue_workout: "Continuar treinando", save_exit: "Salvar o que foi concluído e sair",
      discard_exit: "Sair e descartar o treino",
      resume_title: "Treino em andamento", resume_desc: "Você tem um treino não finalizado. Deseja retomar de onde parou?",
      resume_btn: "Retomar treino", resume_discard: "Descartar treino", resume_later: "Deixar para depois",
      history_title: "Histórico", nav_home: "Início", nav_workout: "Treino", nav_history: "Histórico",
      partial: "Parcial", start_this_workout: "INICIAR ESTE TREINO",
    },
    en: {
      greeting: "Hello, Athlete", greeting_sub: "Ready for today's workout?",
      today_workout: "Workout A — Chest & Triceps", exercises: "Exercises", duration: "Duration",
      start_workout: "START WORKOUT", last_workout: "Last Workout", completed: "Completed",
      my_workouts: "My workouts", my_workouts_sub: "Your custom routines",
      edit: "Edit", save: "Save", add_exercise: "Add exercise",
      add_exercise_title: "Add exercises", search_placeholder: "Search exercise...", all: "All",
      configure_exercise: "Configure exercise", sets: "Sets", reps: "Reps",
      load_kg: "Target weight (kg)", rest_sec: "Rest (seconds)", save_config: "Save configuration",
      workout_prep: "Start workout", total_sets: "Total sets", workout_exercises: "Workout exercises",
      load: "Weight", prev: "Previous", next: "Next", complete_set: "✓ COMPLETE SET",
      finish_workout: "FINISH WORKOUT",
      pause_workout: "Pause", resume_workout: "Resume", workout_paused: "Workout paused",
      rest_label: "Rest", skip_rest: "Skip Rest ➔", auto_rest: "Auto Rest",
      exit_title: "Exit workout?", exit_desc: "You still have pending exercises/sets. What do you want to do?",
      continue_workout: "Continue workout", save_exit: "Save completed & exit",
      discard_exit: "Exit and discard",
      resume_title: "Workout in progress", resume_desc: "You have an unfinished workout. Do you want to resume where you left off?",
      resume_btn: "Resume workout", resume_discard: "Discard workout", resume_later: "Later",
      history_title: "History", nav_home: "Home", nav_workout: "Workout", nav_history: "History",
      partial: "Partial", start_this_workout: "START THIS WORKOUT",
    },
    es: {
      greeting: "Hola, Atleta", greeting_sub: "¿Listo para el entrenamiento de hoy?",
      today_workout: "Entreno A — Pecho y Tríceps", exercises: "Ejercicios", duration: "Duración",
      start_workout: "COMENZAR ENTRENO", last_workout: "Último Entreno", completed: "Completado",
      my_workouts: "Mis entrenos", my_workouts_sub: "Tus rutinas personalizadas",
      edit: "Editar", save: "Guardar", add_exercise: "Añadir ejercicio",
      add_exercise_title: "Añadir ejercicios", search_placeholder: "Buscar ejercicio...", all: "Todos",
      configure_exercise: "Configurar ejercicio", sets: "Series", reps: "Repeticiones",
      load_kg: "Carga prevista (kg)", rest_sec: "Descanso (segundos)", save_config: "Guardar configuración",
      workout_prep: "Iniciar entreno", total_sets: "Series totales", workout_exercises: "Ejercicios del entreno",
      load: "Carga", prev: "Anterior", next: "Siguiente", complete_set: "✓ COMPLETAR SERIE",
      finish_workout: "FINALIZAR ENTRENO",
      pause_workout: "Pausar", resume_workout: "Reanudar", workout_paused: "Entreno pausado",
      rest_label: "Descanso", skip_rest: "Saltar Descanso ➔", auto_rest: "Descanso Automático",
      exit_title: "¿Salir del entreno?", exit_desc: "Aún tienes ejercicios/series pendientes. ¿Qué quieres hacer?",
      continue_workout: "Seguir entrenando", save_exit: "Guardar lo completado y salir",
      discard_exit: "Salir y descartar el entreno",
      resume_title: "Entreno en curso", resume_desc: "Tienes un entreno sin finalizar. ¿Quieres retomarlo donde lo dejaste?",
      resume_btn: "Retomar entreno", resume_discard: "Descartar entreno", resume_later: "Más tarde",
      history_title: "Historial", nav_home: "Inicio", nav_workout: "Entreno", nav_history: "Historial",
      partial: "Parcial", start_this_workout: "COMENZAR ESTE ENTRENO",
    },
  };

  const listeners = [];

  /** Acesso defensivo ao `state` global (declarado no script principal). */
  function appState() {
    try {
      return typeof state !== "undefined" && state ? state : null;
    } catch (err) {
      return null;
    }
  }

  function storage() {
    return global.StorageService || null;
  }

  function isLocale(locale) {
    return LOCALES.indexOf(locale) !== -1;
  }

  /** Idioma persistido (ou null). */
  function persistedLocale() {
    const store = storage();
    if (!store) return null;
    const value = store.load(STORAGE_KEY, null);
    return isLocale(value) ? value : null;
  }

  const I18n = {
    dict,
    LOCALES,
    TOGGLE_ORDER,
    FALLBACK,

    /** Idioma ativo: estado da app > persistido > fallback. */
    getLocale() {
      const st = appState();
      if (st && isLocale(st.lang)) return st.lang;
      return persistedLocale() || FALLBACK;
    },

    /** Tradução de uma chave, com fallback para o idioma padrão. */
    t(key, locale) {
      const loc = isLocale(locale) ? locale : I18n.getLocale();
      const table = dict[loc] || {};
      if (typeof table[key] === "string") return table[key];
      const fb = dict[FALLBACK] || {};
      return typeof fb[key] === "string" ? fb[key] : key;
    },

    has(key, locale) {
      const loc = isLocale(locale) ? locale : I18n.getLocale();
      return !!(dict[loc] && typeof dict[loc][key] === "string");
    },

    /** Todas as chaves conhecidas (união dos idiomas). */
    keys() {
      const set = new Set();
      LOCALES.forEach((loc) => Object.keys(dict[loc] || {}).forEach((k) => set.add(k)));
      return [...set];
    },

    /** Atualiza a faixa de idioma nativa do documento e o chip PT/EN da Home. */
    syncDocument(locale) {
      const loc = isLocale(locale) ? locale : I18n.getLocale();
      if (global.document) {
        global.document.documentElement.lang = NATIVE_LANG[loc] || loc;
        const chip = global.document.getElementById("lang-text");
        if (chip) chip.innerText = loc.toUpperCase();
      }
    },

    /** Aplica as traduções a todos os elementos [data-i18n] dentro de `root`. */
    applyTranslations(root) {
      const scope = root || (global.document || null);
      if (!scope || !scope.querySelectorAll) return 0;
      const loc = I18n.getLocale();
      const table = dict[loc] || {};
      let applied = 0;
      scope.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        if (table[key]) {
          el.innerText = table[key];
          applied++;
        }
      });
      return applied;
    },

    /**
     * Define o idioma ativo (aceita 'pt' | 'en' | 'es').
     * Persiste, sincroniza o documento e aplica as traduções.
     */
    setLocale(locale, options) {
      const opts = options || {};
      if (!isLocale(locale)) return I18n.getLocale();

      const st = appState();
      if (st) st.lang = locale;

      const store = storage();
      if (store) store.save(STORAGE_KEY, locale);

      I18n.syncDocument(locale);
      if (opts.apply !== false) I18n.applyTranslations(opts.root);

      listeners.forEach((fn) => {
        try {
          fn(locale);
        } catch (err) {
          console.warn("[I18n] listener falhou:", err);
        }
      });
      return locale;
    },

    /**
     * Alterna pt <-> en — comportamento EXATO do botão PT/EN da Home.
     * Não passa por 'es': a Home continua com 2 estados.
     */
    toggle() {
      const current = I18n.getLocale();
      const next = TOGGLE_ORDER[(TOGGLE_ORDER.indexOf(current) + 1) % TOGGLE_ORDER.length] || FALLBACK;
      return I18n.setLocale(next);
    },

    onChange(fn) {
      if (typeof fn === "function") listeners.push(fn);
    },
  };

  global.I18n = I18n;
  if (typeof module !== "undefined" && module.exports) module.exports = I18n;
})(typeof globalThis !== "undefined" ? globalThis : this);
