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
      today_workout: "Treino de hoje", exercises: "Exercícios", duration: "Duração",
      start_workout: "INICIAR TREINO", last_workout: "Último Treino", completed: "Concluído",
      my_workouts: "Meus treinos", my_workouts_sub: "Suas rotinas personalizadas",
      routine_name: "Nome da rotina",
      routine_name_placeholder: "Ex.: Peito e Tríceps",
      routine_name_help: "Máximo de 60 caracteres. Se ficar vazio, usamos \"Treino A\".",
      edit: "Editar", save: "Salvar", add_exercise: "Adicionar exercício",
      add_exercise_title: "Adicionar exercícios", search_placeholder: "Buscar exercício...", all: "Todos",
      configure_exercise: "Configurar exercício", sets: "Séries", reps: "Repetições",
      load_kg: "Carga prevista (kg)", rest_sec: "Descanso (segundos)", save_config: "Salvar configuração",
      workout_prep: "Iniciar treino", total_sets: "Séries totais", workout_exercises: "Exercícios do treino",
      load: "Carga", prev: "Anterior", next: "Próximo", complete_set: "✓ CONCLUIR SÉRIE",
      finish_workout: "FINALIZAR TREINO",
      pause_workout: "Pausar", resume_workout: "Retomar", workout_paused: "Treino pausado",
      workout_resumed: "Treino retomado", set_completed: "Série concluída", rest_finished: "Descanso concluído",
      rest_decrease: "- 15s: diminuir o descanso", rest_increase: "+ 15s: aumentar o descanso", exit_workout: "Sair do treino",
      rest_label: "Descanso", skip_rest: "Pular Descanso ➔", auto_rest: "Descanso Automático",
      exit_title: "Sair do treino?", exit_desc: "Você ainda tem exercícios/séries pendentes. O que deseja fazer?",
      continue_workout: "Continuar treinando", save_exit: "Salvar o que foi concluído e sair",
      discard_exit: "Sair e descartar o treino",
      resume_title: "Treino em andamento", resume_desc: "Você tem um treino não finalizado. Deseja retomar de onde parou?",
      resume_btn: "Retomar treino", resume_discard: "Descartar treino", resume_later: "Deixar para depois",
      history_title: "Histórico", nav_home: "Início", nav_workout: "Treino", nav_history: "Histórico",
      partial: "Parcial", start_this_workout: "INICIAR ESTE TREINO",
      weekly_summary: "Resumo da semana", weekly_strip_label: "Treinos desta semana",
      no_workout: "Sem treino", workouts_count: "treinos", cardio_week: "Cardio da semana",
      cardio_goal: "atingido / meta", consecutive_days: "Dias seguidos", days: "dias",
      weekday_mon: "Seg", weekday_tue: "Ter", weekday_wed: "Qua", weekday_thu: "Qui", weekday_fri: "Sex", weekday_sat: "Sáb", weekday_sun: "Dom",
      // Sprint 5.1.1: rótulo relativo de data (sempre derivado de `dateISO`) e
      // estados vazios dos cards "Treino de hoje" / "Último treino" (sem mock).
      date_today: "Hoje", date_yesterday: "Ontem", date_days_ago: "Há {n} dias",
      home_no_workout_today: "Sem treino hoje", home_no_history: "Nenhum treino registrado",
      // Sprint 5.1.2: faixa "Últimos treinos" (cards de treino concluído).
      recent_workouts: "Últimos treinos", recent_strip_label: "Últimos treinos concluídos",
      no_recent_workouts: "Nenhum treino concluído ainda", see_full_history: "Ver histórico completo",
      exercises_count: "exercícios", exercises_count_one: "exercício",
      // Sprint 5.2.1: cadastro de exercício personalizado.
      new_exercise: "Novo exercício", new_exercise_title: "Novo exercício",
      exercise_name: "Nome do exercício", exercise_name_placeholder: "Ex.: Rosca Scott",
      exercise_name_help: "Máximo de 60 caracteres.",
      muscle_group: "Grupo muscular", muscle_group_placeholder: "Selecione o grupo",
      create_exercise: "Criar exercício", cancel: "Cancelar", back: "Voltar",
      custom_badge: "Personalizado",
      add_exercise_aria: "Adicionar {name} ao treino",
      custom_exercise_created: "Exercício criado.",
      custom_exercise_save_error: "Não foi possível salvar o exercício. Tente novamente.",
      custom_exercise_partial_save: "Operação concluída, mas alguns registros inválidos foram descartados.",
      custom_exercise_memory_only: "Alteração mantida apenas nesta sessão. O armazenamento não está disponível.",
      custom_exercise_unavailable: "Não foi possível criar o exercício.",
      custom_error_name_required: "Informe o nome do exercício.",
      custom_error_name_too_long: "O nome deve ter no máximo 60 caracteres.",
      custom_error_name_duplicate_official: "Já existe um exercício com esse nome no catálogo oficial.",
      custom_error_name_duplicate_custom: "Já existe um exercício personalizado com esse nome.",
      custom_error_muscle_required: "Selecione o grupo muscular.",
      custom_error_muscle_invalid: "Selecione um grupo muscular válido.",
      // Sprint 5.2.1: gerenciamento de exercícios personalizados.
      manage_custom_exercises: "Meus exercícios",
      custom_exercises_title: "Meus exercícios",
      custom_exercises_sub: "Exercícios criados por você.",
      custom_exercises_empty: "Nenhum exercício personalizado ainda.",
      edit_exercise_title: "Editar exercício",
      save_exercise: "Salvar alterações",
      delete: "Excluir",
      edit_custom_exercise_aria: "Editar {name}",
      delete_custom_exercise_aria: "Excluir {name}",
      delete_custom_exercise_title: "Excluir exercício?",
      delete_custom_exercise_desc: "O exercício \"{name}\" será removido. Esta ação não pode ser desfeita.",
      custom_exercise_updated: "Exercício atualizado.",
      custom_exercise_deleted: "Exercício excluído.",
      custom_exercise_delete_error: "Não foi possível excluir o exercício. Tente novamente.",
      custom_error_in_use: "O exercício \"{name}\" está em uso. Remova-o das rotinas ou finalize o treino antes de excluir.",
      custom_error_not_found: "Exercício personalizado não encontrado.",
      confirm: "Confirmar",
    },
    en: {
      greeting: "Hello, Athlete", greeting_sub: "Ready for today's workout?",
      today_workout: "Today's workout", exercises: "Exercises", duration: "Duration",
      start_workout: "START WORKOUT", last_workout: "Last Workout", completed: "Completed",
      my_workouts: "My workouts", my_workouts_sub: "Your custom routines",
      routine_name: "Routine name",
      routine_name_placeholder: "E.g. Chest and triceps",
      routine_name_help: "Up to 60 characters. If left empty, the default \"Treino A\" is used.",
      edit: "Edit", save: "Save", add_exercise: "Add exercise",
      add_exercise_title: "Add exercises", search_placeholder: "Search exercise...", all: "All",
      configure_exercise: "Configure exercise", sets: "Sets", reps: "Reps",
      load_kg: "Target weight (kg)", rest_sec: "Rest (seconds)", save_config: "Save configuration",
      workout_prep: "Start workout", total_sets: "Total sets", workout_exercises: "Workout exercises",
      load: "Weight", prev: "Previous", next: "Next", complete_set: "✓ COMPLETE SET",
      finish_workout: "FINISH WORKOUT",
      pause_workout: "Pause", resume_workout: "Resume", workout_paused: "Workout paused",
      workout_resumed: "Workout resumed", set_completed: "Set completed", rest_finished: "Rest finished",
      rest_decrease: "- 15s: decrease rest", rest_increase: "+ 15s: increase rest", exit_workout: "Exit workout",
      rest_label: "Rest", skip_rest: "Skip Rest ➔", auto_rest: "Auto Rest",
      exit_title: "Exit workout?", exit_desc: "You still have pending exercises/sets. What do you want to do?",
      continue_workout: "Continue workout", save_exit: "Save completed & exit",
      discard_exit: "Exit and discard",
      resume_title: "Workout in progress", resume_desc: "You have an unfinished workout. Do you want to resume where you left off?",
      resume_btn: "Resume workout", resume_discard: "Discard workout", resume_later: "Later",
      history_title: "History", nav_home: "Home", nav_workout: "Workout", nav_history: "History",
      partial: "Partial", start_this_workout: "START THIS WORKOUT",
      weekly_summary: "Weekly summary", weekly_strip_label: "This week's workouts",
      no_workout: "No workout", workouts_count: "workouts", cardio_week: "Weekly cardio",
      cardio_goal: "done / goal", consecutive_days: "Consecutive days", days: "days",
      weekday_mon: "Mon", weekday_tue: "Tue", weekday_wed: "Wed", weekday_thu: "Thu", weekday_fri: "Fri", weekday_sat: "Sat", weekday_sun: "Sun",
      date_today: "Today", date_yesterday: "Yesterday", date_days_ago: "{n} days ago",
      home_no_workout_today: "No workout today", home_no_history: "No workouts recorded",
      recent_workouts: "Recent workouts", recent_strip_label: "Recent completed workouts",
      no_recent_workouts: "No completed workouts yet", see_full_history: "See full history",
      exercises_count: "exercises", exercises_count_one: "exercise",
      // Sprint 5.2.1: custom exercise creation.
      new_exercise: "New exercise", new_exercise_title: "New exercise",
      exercise_name: "Exercise name", exercise_name_placeholder: "E.g. Scott curl",
      exercise_name_help: "Maximum 60 characters.",
      muscle_group: "Muscle group", muscle_group_placeholder: "Select a group",
      create_exercise: "Create exercise", cancel: "Cancel", back: "Back",
      custom_badge: "Custom",
      add_exercise_aria: "Add {name} to workout",
      custom_exercise_created: "Exercise created.",
      custom_exercise_save_error: "Could not save the exercise. Try again.",
      custom_exercise_partial_save: "Operation completed, but some invalid records were discarded.",
      custom_exercise_memory_only: "Change kept only for this session. Storage is unavailable.",
      custom_exercise_unavailable: "Could not create the exercise.",
      custom_error_name_required: "Enter the exercise name.",
      custom_error_name_too_long: "The name must be at most 60 characters.",
      custom_error_name_duplicate_official: "An exercise with this name already exists in the official catalog.",
      custom_error_name_duplicate_custom: "A custom exercise with this name already exists.",
      custom_error_muscle_required: "Select a muscle group.",
      custom_error_muscle_invalid: "Select a valid muscle group.",
      // Sprint 5.2.1: custom exercise management.
      manage_custom_exercises: "My exercises",
      custom_exercises_title: "My exercises",
      custom_exercises_sub: "Exercises you created.",
      custom_exercises_empty: "No custom exercises yet.",
      edit_exercise_title: "Edit exercise",
      save_exercise: "Save changes",
      delete: "Delete",
      edit_custom_exercise_aria: "Edit {name}",
      delete_custom_exercise_aria: "Delete {name}",
      delete_custom_exercise_title: "Delete exercise?",
      delete_custom_exercise_desc: "The exercise \"{name}\" will be removed. This cannot be undone.",
      custom_exercise_updated: "Exercise updated.",
      custom_exercise_deleted: "Exercise deleted.",
      custom_exercise_delete_error: "Could not delete the exercise. Try again.",
      custom_error_in_use: "The exercise \"{name}\" is in use. Remove it from routines or finish the workout before deleting.",
      custom_error_not_found: "Custom exercise not found.",
      confirm: "Confirm",
    },
    es: {
      greeting: "Hola, Atleta", greeting_sub: "¿Listo para el entrenamiento de hoy?",
      today_workout: "Entreno de hoy", exercises: "Ejercicios", duration: "Duración",
      start_workout: "COMENZAR ENTRENO", last_workout: "Último Entreno", completed: "Completado",
      my_workouts: "Mis entrenos", my_workouts_sub: "Tus rutinas personalizadas",
      routine_name: "Nombre de la rutina",
      routine_name_placeholder: "Ej.: Pecho y tríceps",
      routine_name_help: "Máximo de 60 caracteres. Si queda vacío, se usa \"Treino A\" por defecto.",
      edit: "Editar", save: "Guardar", add_exercise: "Añadir ejercicio",
      add_exercise_title: "Añadir ejercicios", search_placeholder: "Buscar ejercicio...", all: "Todos",
      configure_exercise: "Configurar ejercicio", sets: "Series", reps: "Repeticiones",
      load_kg: "Carga prevista (kg)", rest_sec: "Descanso (segundos)", save_config: "Guardar configuración",
      workout_prep: "Iniciar entreno", total_sets: "Series totales", workout_exercises: "Ejercicios del entreno",
      load: "Carga", prev: "Anterior", next: "Siguiente", complete_set: "✓ COMPLETAR SERIE",
      finish_workout: "FINALIZAR ENTRENO",
      pause_workout: "Pausar", resume_workout: "Reanudar", workout_paused: "Entreno pausado",
      workout_resumed: "Entreno reanudado", set_completed: "Serie completada", rest_finished: "Descanso terminado",
      rest_decrease: "- 15s: reducir el descanso", rest_increase: "+ 15s: aumentar el descanso", exit_workout: "Salir del entreno",
      rest_label: "Descanso", skip_rest: "Saltar Descanso ➔", auto_rest: "Descanso Automático",
      exit_title: "¿Salir del entreno?", exit_desc: "Aún tienes ejercicios/series pendientes. ¿Qué quieres hacer?",
      continue_workout: "Seguir entrenando", save_exit: "Guardar lo completado y salir",
      discard_exit: "Salir y descartar el entreno",
      resume_title: "Entreno en curso", resume_desc: "Tienes un entreno sin finalizar. ¿Quieres retomarlo donde lo dejaste?",
      resume_btn: "Retomar entreno", resume_discard: "Descartar entreno", resume_later: "Más tarde",
      history_title: "Historial", nav_home: "Inicio", nav_workout: "Entreno", nav_history: "Historial",
      partial: "Parcial", start_this_workout: "COMENZAR ESTE ENTRENO",
      weekly_summary: "Resumen semanal", weekly_strip_label: "Entrenos de esta semana",
      no_workout: "Sin entreno", workouts_count: "entrenos", cardio_week: "Cardio semanal",
      cardio_goal: "hecho / meta", consecutive_days: "Días seguidos", days: "días",
      weekday_mon: "Lun", weekday_tue: "Mar", weekday_wed: "Mié", weekday_thu: "Jue", weekday_fri: "Vie", weekday_sat: "Sáb", weekday_sun: "Dom",
      date_today: "Hoy", date_yesterday: "Ayer", date_days_ago: "Hace {n} días",
      home_no_workout_today: "Sin entreno hoy", home_no_history: "Ningún entreno registrado",
      recent_workouts: "Entrenos recientes", recent_strip_label: "Entrenos completados recientes",
      no_recent_workouts: "Aún no hay entrenos completados", see_full_history: "Ver historial completo",
      exercises_count: "ejercicios", exercises_count_one: "ejercicio",
      // Sprint 5.2.1: creación de ejercicio personalizado.
      new_exercise: "Nuevo ejercicio", new_exercise_title: "Nuevo ejercicio",
      exercise_name: "Nombre del ejercicio", exercise_name_placeholder: "Ej.: Curl Scott",
      exercise_name_help: "Máximo 60 caracteres.",
      muscle_group: "Grupo muscular", muscle_group_placeholder: "Selecciona el grupo",
      create_exercise: "Crear ejercicio", cancel: "Cancelar", back: "Volver",
      custom_badge: "Personalizado",
      add_exercise_aria: "Añadir {name} al entreno",
      custom_exercise_created: "Ejercicio creado.",
      custom_exercise_save_error: "No se pudo guardar el ejercicio. Inténtalo de nuevo.",
      custom_exercise_partial_save: "Operación completada, pero se descartaron algunos registros no válidos.",
      custom_exercise_memory_only: "Cambio mantenido solo en esta sesión. El almacenamiento no está disponible.",
      custom_exercise_unavailable: "No se pudo crear el ejercicio.",
      custom_error_name_required: "Introduce el nombre del ejercicio.",
      custom_error_name_too_long: "El nombre debe tener como máximo 60 caracteres.",
      custom_error_name_duplicate_official: "Ya existe un ejercicio con ese nombre en el catálogo oficial.",
      custom_error_name_duplicate_custom: "Ya existe un ejercicio personalizado con ese nombre.",
      custom_error_muscle_required: "Selecciona el grupo muscular.",
      custom_error_muscle_invalid: "Selecciona un grupo muscular válido.",
      // Sprint 5.2.1: gestión de ejercicios personalizados.
      manage_custom_exercises: "Mis ejercicios",
      custom_exercises_title: "Mis ejercicios",
      custom_exercises_sub: "Ejercicios creados por ti.",
      custom_exercises_empty: "Aún no hay ejercicios personalizados.",
      edit_exercise_title: "Editar ejercicio",
      save_exercise: "Guardar cambios",
      delete: "Eliminar",
      edit_custom_exercise_aria: "Editar {name}",
      delete_custom_exercise_aria: "Eliminar {name}",
      delete_custom_exercise_title: "¿Eliminar ejercicio?",
      delete_custom_exercise_desc: "El ejercicio \"{name}\" se eliminará. Esta acción no se puede deshacer.",
      custom_exercise_updated: "Ejercicio actualizado.",
      custom_exercise_deleted: "Ejercicio eliminado.",
      custom_exercise_delete_error: "No se pudo eliminar el ejercicio. Inténtalo de nuevo.",
      custom_error_in_use: "El ejercicio \"{name}\" está en uso. Elimínalo de las rutinas o finaliza el entreno antes de borrarlo.",
      custom_error_not_found: "Ejercicio personalizado no encontrado.",
      confirm: "Confirmar",
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
