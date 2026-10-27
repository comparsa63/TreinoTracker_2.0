#!/usr/bin/env node
/**
 * tests/modules.test.js
 * ---------------------------------------------------------------------------
 * Testes unitários dos módulos da Fase 1, executados em Node (vm) com
 * localStorage e document falsos. Sem dependências externas.
 *
 * Uso: node tests/modules.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// Mini-framework
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
let currentSuite = "";

function suite(name) {
  currentSuite = name;
  console.log("\n--- " + name + " ---");
}

function ok(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failures.push(currentSuite + " > " + name + (detail ? "  (" + detail + ")" : ""));
    console.log("  FAIL  " + name + (detail ? "  -> " + detail : ""));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, "esperado " + e + ", obtido " + a);
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------
function makeSandbox() {
  const map = new Map();
  const localStorage = {
    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] === undefined ? null : [...map.keys()][i];
    },
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };

  const sandbox = { console: { log() {}, warn() {}, info() {} }, localStorage };
  vm.createContext(sandbox);
  return sandbox;
}

function loadModules(sandbox, files) {
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), "utf8");
    vm.runInContext(code, sandbox, { filename: f });
  }
}

/** `instanceof Date` não atravessa realms do vm: checagem agnóstica. */
function isDateValue(v) {
  return Object.prototype.toString.call(v) === "[object Date]";
}

/** Deixa a fila de microtasks/eventos drenar (APIs assíncronas do adaptador). */
function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// TTUtils
// ---------------------------------------------------------------------------
function testUtils() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js"]);
  const U = sb.TTUtils;

  suite("TTUtils");

  ok("expõe TTUtils no global", !!U);
  eq("normalize remove acentos e caixa", U.normalize("Elevação Pélvica COM Halteres"), "elevacao pelvica com halteres");
  eq("normalize colapsa espaços", U.normalize("  Supino   Inclinado  "), "supino inclinado");
  eq("parseNumber aceita vírgula", U.parseNumber("12,5"), 12.5);
  eq("parseNumber aceita ponto", U.parseNumber("12.5"), 12.5);
  eq("parseNumber vazio -> null", U.parseNumber(""), null);
  eq("parseNumber lixo -> null", U.parseNumber("abc"), null);
  eq("formatDuration < 60min", U.formatDuration(45), "45 min");
  eq("formatDuration 60min", U.formatDuration(60), "1h");
  eq("formatDuration 90min", U.formatDuration(90), "1h 30min");
  eq("formatClock", U.formatClock(65), "01:05");
  eq("formatClock negativo -> 00:00", U.formatClock(-5), "00:00");
  eq("escapeHtml", U.escapeHtml('<b>"x" & \'y\'</b>'), "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
  eq("clamp acima", U.clamp(15, 0, 10), 10);
  eq("clamp abaixo", U.clamp(-3, 0, 10), 0);
  eq("clamp inválido -> min", U.clamp("x", 1, 10), 1);
  ok("uid único", U.uid("r") !== U.uid("r"));
  ok("todayISO formato", /^\d{4}-\d{2}-\d{2}$/.test(U.todayISO()));
  eq("deepClone", U.deepClone({ a: [1] }), { a: [1] });
}

// ---------------------------------------------------------------------------
// StorageService
// ---------------------------------------------------------------------------
function testStorage() {
  const sb = makeSandbox();
  loadModules(sb, ["services/storage.js"]);
  const S = sb.StorageService;

  suite("StorageService");

  ok("expõe StorageService", !!S);
  ok("localStorage detectado", S.isPersistent());
  eq("prefixo do namespace", S.PREFIX, "tt_ds_v1_");

  S.save("routines", [{ id: "rA" }]);
  eq("round-trip de objeto", S.load("routines"), [{ id: "rA" }]);
  ok("chave física prefixada", sb.localStorage.getItem("tt_ds_v1_routines") === '[{"id":"rA"}]');
  ok("has() verdadeiro", S.has("routines"));
  eq("keys() só do namespace", S.keys(), ["routines"]);

  S.save("lang", "en");
  eq("round-trip de string", S.load("lang"), "en");

  eq("load ausente -> fallback", S.load("naoExiste", "def"), "def");
  eq("load ausente -> null", S.load("naoExiste"), null);

  // Corrompido
  sb.localStorage.setItem("tt_ds_v1_quebrado", "{isso nao e json");
  eq("JSON corrompido -> fallback", S.load("quebrado", "safe"), "safe");
  ok("has() em corrompido continua true", S.has("quebrado"));

  S.remove("routines");
  ok("remove() apaga", !S.has("routines") && S.load("routines") === null);

  // clear() não toca em chaves de fora do namespace
  sb.localStorage.setItem("outra_app", "x");
  S.save("history", []);
  S.clear();
  eq("clear() limpa só o namespace", S.keys(), []);
  ok("clear() preserva chaves de terceiros", sb.localStorage.getItem("outra_app") === "x");

  // storage indisponível -> fallback em memória, sem lançar
  delete sb.localStorage;
  ok("sem localStorage não lança em save", S.save("x", 1) === false);
  eq("sem localStorage ainda lê da memória", S.load("x", null), 1);
  ok("sem localStorage isPersistent=false", S.isPersistent() === false);

  // memoryFallback:false não pode deixar uma cópia antiga da memória
  // ressurgir quando o backend volta a existir e falha na gravação.
  sb.localStorage = {
    get length() { return 0; },
    key() { return null; },
    getItem() { return null; },
    setItem(key) {
      if (key === "tt_ds_v1___probe__") return;
      throw new Error("QuotaExceededError");
    },
    removeItem() {},
  };
  ok("backend ativo falha sem memoryFallback",
    S.save("stale", 2, { memoryFallback: false }) === false);
  eq("cópia antiga da memória não ressurge", S.load("stale", "fallback"), "fallback");
}

// ---------------------------------------------------------------------------
// I18n
// ---------------------------------------------------------------------------
function testI18n() {
  const sb = makeSandbox();
  loadModules(sb, ["services/storage.js", "js/i18n.js"]);
  const I = sb.I18n;

  suite("I18n");

  ok("3 idiomas", I.LOCALES.join(",") === "pt,en,es");
  eq("135 chaves (130 + 5 de próximos exercícios)", I.keys().length, 135);

  const ptKeys = Object.keys(I.dict.pt).sort();
  const enKeys = Object.keys(I.dict.en).sort();
  const esKeys = Object.keys(I.dict.es).sort();
  eq("pt e en têm o mesmo conjunto de chaves", enKeys, ptKeys);
  eq("pt e es têm o mesmo conjunto de chaves", esKeys, ptKeys);
  const phase3Keys = [
    "new_exercise", "new_exercise_title", "exercise_name", "exercise_name_placeholder",
    "exercise_name_help", "muscle_group", "muscle_group_placeholder", "create_exercise",
    "cancel", "back", "custom_badge", "add_exercise_aria", "custom_exercise_created",
    "custom_exercise_save_error", "custom_exercise_unavailable", "custom_error_name_required",
    "custom_error_name_too_long", "custom_error_name_duplicate_official",
    "custom_error_name_duplicate_custom", "custom_error_muscle_required",
    "custom_error_muscle_invalid",
  ];
  ok("textos do cadastro personalizado nos 3 idiomas",
    phase3Keys.every((key) =>
      ["pt", "en", "es"].every((locale) =>
        typeof I.dict[locale][key] === "string" && I.dict[locale][key].length > 0 &&
        I.dict[locale][key] !== key)));
  ok("selo e rótulo acessível traduzidos",
    I.dict.pt.custom_badge === "Personalizado" && I.dict.en.custom_badge === "Custom" &&
      I.dict.es.custom_badge === "Personalizado" &&
      I.dict.pt.add_exercise_aria.includes("{name}") &&
      I.dict.en.add_exercise_aria.includes("{name}") &&
      I.dict.es.add_exercise_aria.includes("{name}"));

  // Sprint 5.2.1 — Fase 4: gerenciamento de exercícios personalizados.
  const phase4Keys = [
    "manage_custom_exercises", "custom_exercises_title", "custom_exercises_sub",
    "custom_exercises_empty", "edit_exercise_title", "save_exercise", "delete",
    "edit_custom_exercise_aria", "delete_custom_exercise_aria",
    "delete_custom_exercise_title", "delete_custom_exercise_desc",
    "custom_exercise_updated", "custom_exercise_deleted", "custom_exercise_delete_error",
    "custom_error_in_use", "custom_error_not_found", "confirm",
  ];
  ok("textos do gerenciamento personalizado nos 3 idiomas",
    phase4Keys.every((key) =>
      ["pt", "en", "es"].every((locale) =>
        typeof I.dict[locale][key] === "string" && I.dict[locale][key].length > 0 &&
        I.dict[locale][key] !== key)));
  const a09Keys = ["custom_exercise_partial_save", "custom_exercise_memory_only"];
  ok("textos de descarte e modo memória nos 3 idiomas (A-09)",
    a09Keys.every((key) =>
      ["pt", "en", "es"].every((locale) =>
        typeof I.dict[locale][key] === "string" && I.dict[locale][key].length > 0 &&
        I.dict[locale][key] !== key)));
  ok("ações e confirmação da exclusão são traduzidas",
    I.dict.pt.delete === "Excluir" && I.dict.en.delete === "Delete" && I.dict.es.delete === "Eliminar" &&
      I.dict.pt.confirm === "Confirmar" && I.dict.en.confirm === "Confirm" &&
      I.dict.es.confirm === "Confirmar" &&
      I.dict.pt.delete_custom_exercise_desc.includes("{name}") &&
      I.dict.en.delete_custom_exercise_desc.includes("{name}") &&
      I.dict.es.delete_custom_exercise_desc.includes("{name}") &&
      I.dict.pt.custom_error_in_use.includes("{name}") &&
      I.dict.en.custom_error_in_use.includes("{name}") &&
      I.dict.es.custom_error_in_use.includes("{name}") &&
      I.dict.pt.edit_custom_exercise_aria.includes("{name}") &&
      I.dict.en.edit_custom_exercise_aria.includes("{name}") &&
      I.dict.es.edit_custom_exercise_aria.includes("{name}") &&
      I.dict.pt.delete_custom_exercise_aria.includes("{name}") &&
      I.dict.en.delete_custom_exercise_aria.includes("{name}") &&
      I.dict.es.delete_custom_exercise_aria.includes("{name}"));

  // Sprint 5.3 — nome da rotina (pt/en/es, paridade e conteúdo útil).
  const routineNameKeys = ["routine_name", "routine_name_placeholder", "routine_name_help"];
  ok("textos do nome da rotina nos 3 idiomas",
    routineNameKeys.every((key) =>
      ["pt", "en", "es"].every((locale) =>
        typeof I.dict[locale][key] === "string" && I.dict[locale][key].length > 0 &&
        I.dict[locale][key] !== key)));
  ok("nome da rotina é diferente da identificação por letra",
    I.dict.pt.routine_name === "Nome da rotina" &&
      I.dict.en.routine_name === "Routine name" &&
      I.dict.es.routine_name === "Nombre de la rutina");
  ok("ajuda do nome cita o limite de 60 caracteres nos 3 idiomas",
    ["pt", "en", "es"].every((locale) => I.dict[locale].routine_name_help.includes("60")));

  // Sprint 5.3 / Inc. 2 — descanso prescrito no Player (pt/en/es).
  const prescribedRestKeys = [
    "rest_config_decrease", "rest_config_increase", "rest_config_save_error",
  ];
  ok("textos do descanso prescrito nos 3 idiomas",
    prescribedRestKeys.every((key) =>
      ["pt", "en", "es"].every((locale) =>
        typeof I.dict[locale][key] === "string" && I.dict[locale][key].length > 0 &&
        I.dict[locale][key] !== key)));
  ok("rótulos do descanso prescrito citam o passo de 30 s",
    ["pt", "en", "es"].every((locale) =>
      I.dict[locale].rest_config_decrease.indexOf("- 30s") === 0 &&
      I.dict[locale].rest_config_increase.indexOf("+ 30s") === 0));
  ok("rótulos do timer em execução continuam em ±15 s",
    ["pt", "en", "es"].every((locale) =>
      I.dict[locale].rest_decrease.indexOf("- 15s") === 0 &&
      I.dict[locale].rest_increase.indexOf("+ 15s") === 0));

  // Sprint 5.5 — próximos exercícios no Player (pt/en/es).
  const upcomingKeys = [
    "upcoming_exercises", "upcoming_empty", "upcoming_remaining",
    "upcoming_remaining_one", "upcoming_fallback",
  ];
  ok("textos de próximos exercícios nos 3 idiomas",
    upcomingKeys.every((key) =>
      ["pt", "en", "es"].every((locale) =>
        typeof I.dict[locale][key] === "string" && I.dict[locale][key].length > 0 &&
        I.dict[locale][key] !== key)));
  ok("contagem e fallback de próximos exercícios usam os tokens certos",
    ["pt", "en", "es"].every((locale) =>
      I.dict[locale].upcoming_remaining.includes("{count}") &&
      I.dict[locale].upcoming_fallback.includes("{n}")));

  // Textos da Home (não podem mudar)
  eq("Home pt greeting", I.dict.pt.greeting, "Olá, Atleta");
  eq("Home en greeting", I.dict.en.greeting, "Hello, Athlete");
  eq("Home es greeting", I.dict.es.greeting, "Hola, Atleta");
  eq("Home pt start_workout", I.dict.pt.start_workout, "INICIAR TREINO");
  eq("Home en last_workout", I.dict.en.last_workout, "Last Workout");
  eq("Home pt completed", I.dict.pt.completed, "Concluído");

  eq("getLocale padrão pt", I.getLocale(), "pt");
  eq("t() usa fallback pt", I.t("greeting"), "Olá, Atleta");
  eq("t() explícito", I.t("greeting", "es"), "Hola, Atleta");
  eq("t() chave inexistente devolve a chave", I.t("nao_existe"), "nao_existe");
  ok("has()", I.has("greeting", "en") && !I.has("nao_existe", "en"));

  eq("setLocale en", I.setLocale("en"), "en");
  eq("t() acompanha o idioma", I.t("greeting"), "Hello, Athlete");
  eq("idioma persistido", sb.StorageService.load("lang"), "en");

  eq("toggle en -> pt", I.toggle(), "pt");
  eq("toggle pt -> en", I.toggle(), "en");
  eq("toggle nunca cai em es", I.toggle() === "pt", true);

  eq("setLocale inválido é ignorado", I.setLocale("xx"), "pt");
  eq("es disponível por setLocale", I.setLocale("es"), "es");
  eq("t() em es", I.t("completed"), "Completado");

  // applyTranslations com DOM falso
  I.setLocale("en");
  const fake = [
    { k: "greeting", t: "" },
    { k: "start_workout", t: "" },
    { k: "sem_traducao", t: "intacto" },
  ];
  const fakeDoc = {
    querySelectorAll() {
      return fake.map((f) => ({
        getAttribute: () => f.k,
        set innerText(v) {
          f.t = v;
        },
      }));
    },
  };
  const applied = I.applyTranslations(fakeDoc);
  eq("applyTranslations aplicou 2", applied, 2);
  eq("texto aplicado", fake[0].t, "Hello, Athlete");
  eq("chave sem tradução fica intacta", fake[2].t, "intacto");
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function testPersistence() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "services/storage.js", "js/i18n.js", "js/persistence.js"]);
  const S = sb.StorageService;
  const P = sb.Persistence;

  suite("Persistence");

  ok("expõe Persistence", !!P);

  // Primeira visita: nada no storage -> estado padrão preservado
  const blank = { routines: ["padrao"], history: ["padrao"], lang: "pt", autoRestEnabled: true };
  const r0 = P.hydrate(blank);
  eq("nada restaurado na 1ª visita", r0.restored, []);
  eq("estado padrão intacto", blank.routines, ["padrao"]);

  // Round-trip
  const routines = [
    { id: "rA", letter: "A", name: "Peito", exercises: [{ catalogId: "ex1", sets: 4, reps: 10, weight: 60, rest: 60 }] },
  ];
  ok("saveRoutines", P.saveRoutines(routines) === true);

  const target = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  const r1 = P.hydrate(target);
  eq("rotinas restauradas", target.routines, routines);
  ok("log de restauração", r1.restored.indexOf("routines(1)") !== -1, JSON.stringify(r1.restored));

  // Lista vazia salva é respeitada (não volta pro padrão)
  P.saveRoutines([]);
  const target2 = { routines: [{ id: "x" }], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(target2);
  eq("lista vazia salva é respeitada", target2.routines, []);

  // Sanitização: lixo é descartado e números são normalizados
  S.save("routines", [
    null,
    "texto",
    { id: "rZ", letter: "Z", name: "Bagunça", exercises: [{ catalogId: "ex9", sets: 0, reps: -5, weight: -10, rest: -1 }, { semCatalog: true }, null] },
  ]);
  const target3 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(target3);
  eq("só 1 rotina válida sobrevive", target3.routines.length, 1);
  eq("exercícios inválidos removidos", target3.routines[0].exercises.length, 1);
  eq("sets mínimo 1", target3.routines[0].exercises[0].sets, 1);
  eq("reps mínimo 1", target3.routines[0].exercises[0].reps, 1);
  eq("weight mínimo 0", target3.routines[0].exercises[0].weight, 0);
  eq("rest mínimo 0", target3.routines[0].exercises[0].rest, 0);

  // Rotinas totalmente inválidas -> chave ignorada, estado preservado
  S.save("routines", { nao: "array" });
  const target4 = { routines: ["keep"], history: [], lang: "pt", autoRestEnabled: true };
  const r4 = P.hydrate(target4);
  eq("payload inválido ignorado", target4.routines, ["keep"]);
  ok("payload inválido registrado em skipped", r4.skipped.indexOf("routines") !== -1);

  // Histórico
  P.saveHistory([{ id: 1, name: "Treino A", date: "hoje", duration: "50 min", status: "partial" }]);
  const target5 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(target5);
  eq("histórico restaurado", target5.history.length, 1);
  eq("status partial preservado", target5.history[0].status, "partial");

  S.save("history", [{ name: "" }, { name: "Bom" }]);
  const target6 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(target6);
  eq("entrada sem nome descartada", target6.history.length, 1);
  eq("status inválido vira completed", target6.history[0].status, "completed");

  // Idioma e descanso automático
  S.save("lang", "es");
  S.save("autoRest", false);
  const target7 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  const r7 = P.hydrate(target7);
  eq("idioma restaurado", target7.lang, "es");
  eq("autoRest restaurado", target7.autoRestEnabled, false);
  ok("logs de lang/autoRest", r7.restored.indexOf("lang:es") !== -1 && r7.restored.indexOf("autoRest:false") !== -1);

  S.save("lang", "klingon");
  const target8 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(target8);
  eq("idioma inválido ignorado", target8.lang, "pt");

  ok("saveLang recusa idioma inválido", P.saveLang("klingon") === false);
  ok("saveAutoRest coage para booleano", P.saveAutoRest("sim") === true && S.load("autoRest") === true);

  // reset() mantém o idioma (preferência do usuário) e limpa o resto
  P.reset();
  eq("reset limpa rotinas", S.load("routines"), null);
  eq("reset limpa histórico", S.load("history"), null);
  eq("reset limpa autoRest", S.load("autoRest"), null);
  eq("reset preserva o idioma", S.load("lang"), "klingon");
}

// ---------------------------------------------------------------------------
// Catalog (Fase 2B — catálogo real de exercícios)
// ---------------------------------------------------------------------------
function testCatalog() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "js/data/exercises.js", "js/catalog.js"]);
  const C = sb.Catalog;

  suite("Catalog");

  ok("expõe Catalog", !!C);
  ok("catálogo real carregado (>=80 exercícios)", C.all().length >= 80, String(C.all().length));

  const items = C.forPrototype();
  ok("forPrototype gera todos os itens", items.length === C.all().length);
  const first = items[0];
  ok("shape {id,name,muscle,img}",
    !!first.id && !!first.name && !!first.muscle && /^assets\/images\//.test(first.img),
    JSON.stringify(first));
  ok("nenhuma imagem externa (sem hotlink)",
    items.every((it) => it.img.indexOf("http") === -1));

  const c02 = C.find("C-02");
  ok("find por id", c02 && c02.nome === "Supino reto", JSON.stringify(c02));
  ok("byName normaliza acentos", !!C.byName("supino reto") && !!C.byName("TRÍCEPS POLIA"));

  const groups = C.groups();
  ok("groups inclui Peito e Pernas",
    groups.indexOf("Peito") !== -1 && groups.indexOf("Pernas") !== -1, groups.join(","));

  const peito = C.search("", "Peito");
  ok("filtro por grupo", peito.length > 0 && peito.every((i) => i.muscle === "Peito"), String(peito.length));
  const supinos = C.search("supino", "all");
  ok("busca por termo", supinos.length >= 3, String(supinos.length));
  ok("filtro 'all' + termo combina", C.search("rosca", "Bíceps").every((i) => i.muscle === "Bíceps"));

  ok("muscleImage com fallback local", /^assets\/images\//.test(C.muscleImage("Inexistente")));

  // API no espírito do ExerciseRepository
  ok("findById", !!C.findById("C-02"));
  ok("findByGroup", C.findByGroup("Peito").length > 0 && C.findByGroup("Peito").every((e) => e.grupoMuscular === "Peito"));

  // ── Taxonomia: grupo principal (grupoMuscular) + grupo específico (subgrupo) ──
  const subgroups = C.subgroups();
  ok("subgroups inclui Quadríceps, Posterior de Coxa, Panturrilha e Lombar",
    ["Quadríceps", "Posterior de Coxa", "Panturrilha", "Lombar"].every((s) => subgroups.indexOf(s) !== -1),
    subgroups.join(","));

  const filterGroups = C.filterGroups();
  ok("filterGroups = grupos principais + subgrupos (sem duplicatas)",
    filterGroups.length === new Set(filterGroups).size &&
    C.groups().every((g) => filterGroups.indexOf(g) !== -1) &&
    subgroups.every((s) => filterGroups.indexOf(s) !== -1),
    filterGroups.join(","));
  ok("filterGroups não duplica 'Glúteo' (grupo principal e subgrupo)",
    filterGroups.filter((g) => g === "Glúteo").length === 1);

  const quad = C.search("", "Quadríceps");
  ok("filtro por subgrupo Quadríceps", quad.length === 6 && quad.every((i) => i.subgroup === "Quadríceps"), String(quad.length));
  const posterior = C.search("", "Posterior de Coxa");
  ok("filtro por subgrupo Posterior de Coxa", posterior.length === 3 && posterior.every((i) => i.subgroup === "Posterior de Coxa"), String(posterior.length));
  const panturrilha = C.search("", "Panturrilha");
  ok("filtro por subgrupo Panturrilha", panturrilha.length === 2 && panturrilha.every((i) => i.subgroup === "Panturrilha"), String(panturrilha.length));
  const lombar = C.search("", "Lombar");
  ok("filtro por subgrupo Lombar", lombar.length === 1 && lombar.every((i) => i.subgroup === "Lombar"), String(lombar.length));

  ok("grupo principal segue contemplando os subgrupos",
    C.search("", "Pernas").length === 12, String(C.search("", "Pernas").length));
  ok("findBySubgroup", C.findBySubgroup("Quadríceps").length === 6);
  ok("ids do catálogo permanecem estáveis e únicos",
    new Set(C.all().map((e) => e.id)).size === C.all().length && !!C.findById("G-04") && !!C.findById("D-10"));
  ok("subgrupo não altera o grupo principal",
    C.findById("G-10").grupoMuscular === "Pernas" && C.findById("G-10").subgrupo === "Panturrilha");
  ok("busca por nome continua funcionando",
    C.search("panturrilha", "all").length >= 2 && C.search("leg press", "all").length >= 1);
  ok("item sem subgrupo expõe subgroup como string vazia",
    C.search("supino", "all").every((i) => typeof i.subgroup === "string"));
  ok("toPrototype preserva rótulo do grupo principal",
    C.search("", "Quadríceps").every((i) => i.muscle === "Pernas"));
  ok("hasInstructions/getInstructions", C.hasInstructions("Supino reto") && C.getInstructions("Supino reto").length >= 3);
  ok("getMistakes/getTips", C.getMistakes("Supino reto").length > 0 && C.getTips("Supino reto").length > 0);
  ok("exercício sem instruções -> []", C.getInstructions("Prancha").length === 0);
}

// ---------------------------------------------------------------------------
// CustomExercises (Sprint 5.2.1 — domínio dos exercícios personalizados)
// ---------------------------------------------------------------------------
function testCustomExercises() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "js/custom-exercises.js"]);
  const CX = sb.CustomExercises;

  const official = ["Supino reto", "Rosca direta barra", "Tríceps polia"];
  const groups = ["Peito", "Bíceps", "Tríceps", "Costas", "Pernas"];

  suite("CustomExercises (domínio)");

  ok("expõe CustomExercises", !!CX && typeof CX.create === "function");
  eq("prefixo de id estável", CX.ID_PREFIX, "cx_");
  eq("limite do nome", CX.NAME_MAX, 60);
  ok("isValidId aceita IDs gerados e formatos seguros",
    CX.isValidId("cx_abc123") && CX.isValidId("cx_mvkf2rwex98stf") &&
    CX.isValidId("cx_a-b_c"));
  ok("isValidId rejeita payload e formatos inesperados",
    !CX.isValidId("A-01") && !CX.isValidId("cx_") &&
    !CX.isValidId("cx_');alert(1)//") && !CX.isValidId("cx_<script>") &&
    !CX.isValidId(" cx_abc ") && !CX.isValidId("cx_abc def") &&
    !CX.isValidId("cx_" + "a".repeat(128)));
  eq("normalize usa a regra global", CX.normalize("  Tríceps   POLIA  "), "triceps polia");

  // ── Nome ──────────────────────────────────────────────────────────────
  eq("nome obrigatório", CX.validateName("   ", { list: [], officialNames: official }).reason, "name-required");
  eq("nome acima de 60 rejeitado",
    CX.validateName("x".repeat(61), { list: [], officialNames: official }).reason, "name-too-long");
  ok("nome com exatamente 60 é aceito",
    CX.validateName("x".repeat(60), { list: [], officialNames: official }).ok);
  ok("limite considera o nome já trimado",
    CX.validateName("  " + "x".repeat(60) + "  ", {}).ok);

  // ── Duplicidade global (oficial + personalizados) ─────────────────────
  eq("duplicidade oficial ignora caixa e extremos",
    CX.validateName("  SUPINO RETO  ", { list: [], officialNames: official }).reason,
    "name-duplicate-official");
  eq("duplicidade oficial ignora acentos",
    CX.validateName("triceps POLIA", { list: [], officialNames: official }).reason,
    "name-duplicate-official");

  const customList = [{ id: "cx_existente", name: "Rosca Scott", muscle: "Bíceps" }];
  eq("duplicidade personalizada ignora caixa e extremos",
    CX.validateName("  rosca SCOTT  ", { list: customList }).reason,
    "name-duplicate-custom");
  ok("update ignora o próprio id",
    CX.validateName("Rosca Scott", { list: customList, ignoreId: "cx_existente" }).ok);
  eq("findDuplicate oficial", CX.findDuplicate([], "supino reto", { officialNames: official }).source, "official");
  eq("findDuplicate personalizado devolve id",
    CX.findDuplicate(customList, "ROSCA SCOTT", {}).id, "cx_existente");
  eq("officialName aceita string e objetos",
    [CX.officialName("A"), CX.officialName({ nome: "B" }), CX.officialName({ pt: "C" }), CX.officialName({ name: "D" })],
    ["A", "B", "C", "D"]);

  // ── Grupo muscular ────────────────────────────────────────────────────
  eq("grupo obrigatório", CX.validateMuscle("", groups).reason, "muscle-required");
  eq("grupo fora da lista é rejeitado",
    CX.validateMuscle("Panturrilha", groups).reason, "muscle-invalid");
  eq("grupo é canonicalizado",
    [CX.validateMuscle(" bíceps ", groups).ok, CX.validateMuscle(" bíceps ", groups).value],
    [true, "Bíceps"]);
  eq("sem lista de grupos o grupo não é validado",
    CX.validateMuscle("Panturrilha").reason, "muscle-invalid");
  eq("lista de grupos vazia recusa o grupo",
    CX.validateMuscle("Peito", []).reason, "muscle-invalid");
  eq("create exige a lista de grupos oficiais",
    CX.create([], { name: "X", muscle: "Peito" }, {}).reason, "muscle-invalid");

  // ── create ────────────────────────────────────────────────────────────
  const base = [];
  const created = CX.create(base, { name: "  Rosca Scott  ", muscle: "bíceps" },
    { officialNames: official, groups });
  ok("create devolve id cx_", created.ok && /^cx_/.test(created.exercise.id));
  eq("create normaliza nome e grupo",
    [created.exercise.name, created.exercise.muscle], ["Rosca Scott", "Bíceps"]);
  eq("create não muta a lista original", base, []);
  eq("create devolve nova lista", created.list.length, 1);
  eq("create preserva espaços internos",
    CX.create([], { name: "  Rosca   Scott  ", muscle: "Bíceps" }, { groups }).exercise.name,
    "Rosca   Scott");
  eq("create rejeita nome acima de 60",
    CX.create([], { name: "x".repeat(61), muscle: "Peito" }, { groups }).reason, "name-too-long");

  const customDup = CX.create(created.list, { name: "ROSCA SCOTT", muscle: "Bíceps" },
    { officialNames: official, groups });
  eq("create bloqueia duplicidade personalizada",
    [customDup.ok, customDup.reason], [false, "name-duplicate-custom"]);
  eq("falha preserva a lista", customDup.list.length, 1);
  eq("create bloqueia duplicidade oficial",
    CX.create(created.list, { name: "supino reto", muscle: "Peito" },
      { officialNames: official, groups }).reason,
    "name-duplicate-official");
  eq("create bloqueia grupo inválido",
    CX.create([], { name: "Novo", muscle: "Panturrilha" }, { groups }).reason,
    "muscle-invalid");

  const existing = [{ id: "cx_dup", name: "Existente", muscle: "Peito" }];
  let calls = 0;
  const retry = CX.create(existing, { name: "Novo", muscle: "Peito" }, {
    groups,
    idFactory: () => (calls++ === 0 ? "cx_dup" : "cx_ok"),
  });
  eq("id colidente é descartado", [retry.ok, retry.exercise.id], [true, "cx_ok"]);

  const auto1 = CX.create([], { name: "A", muscle: "Peito" }, { groups });
  const auto2 = CX.create(auto1.list, { name: "B", muscle: "Peito" }, { groups });
  ok("ids gerados são únicos e seguem o padrão",
    auto1.exercise.id !== auto2.exercise.id && /^cx_/.test(auto2.exercise.id));

  // ── update ────────────────────────────────────────────────────────────
  const createdId = created.exercise.id;
  const updated = CX.update(created.list, createdId,
    { name: "Rosca Direta", muscle: "Bíceps" }, { officialNames: official, groups });
  ok("update preserva id", updated.ok && updated.exercise.id === createdId);
  eq("update altera nome", updated.list[0].name, "Rosca Direta");
  eq("update não muta a lista original", created.list[0].name, "Rosca Scott");
  eq("update parcial preserva grupo",
    CX.update(created.list, createdId, { name: "Rosca Direta" }, { groups }).exercise.muscle,
    "Bíceps");
  ok("update com o próprio nome é permitido",
    CX.update(created.list, createdId, { name: "  Rosca Scott  " },
      { officialNames: official, groups }).ok);
  eq("update bloqueia nome oficial",
    CX.update(created.list, createdId, { name: "Supino reto" },
      { officialNames: official, groups }).reason,
    "name-duplicate-official");

  const twoCustom = [
    created.exercise,
    { id: "cx_outro", name: "Rosca Martelo", muscle: "Bíceps" },
  ];
  eq("update bloqueia nome de outro personalizado",
    CX.update(twoCustom, createdId, { name: "Rosca Martelo" }, { groups }).reason,
    "name-duplicate-custom");
  eq("update de id inexistente",
    CX.update(created.list, "cx_inexistente", { name: "X" }, { groups }).reason,
    "not-found");
  eq("update rejeita id inseguro",
    CX.update(created.list, "cx_');alert(1)//", { name: "X" }, { groups }).reason,
    "not-found");

  // ── Uso e exclusão ────────────────────────────────────────────────────
  const list = [
    { id: "cx_use", name: "Rosca Scott", muscle: "Bíceps" },
    { id: "cx_free", name: "Rosca Martelo", muscle: "Bíceps" },
  ];
  const routines = [
    { id: "rA", letter: "A", name: "Peito", exercises: [{ catalogId: "cx_use" }] },
    { id: "rB", letter: "B", name: "Costas", exercises: [{ catalogId: "C-01" }] },
    { id: "rC", letter: "C", name: "Legado", exercises: [{ id: "cx_use" }] },
  ];
  const temp = { id: "rT", letter: "T", name: "Rascunho", exercises: [{ catalogId: "cx_use" }] };
  const session = { exercises: [{ catalogId: "cx_use" }] };

  const usage = CX.usageReport("cx_use", { routines, tempRoutine: temp, session });
  eq("usage encontra rotinas (catalogId e legado)",
    usage.routines.map((r) => r.id), ["rA", "rC"]);
  ok("usage encontra buffer e sessão",
    usage.used && usage.tempRoutine.id === "rT" && usage.session);
  ok("mensagem cita as rotinas",
    usage.message.indexOf("Peito") !== -1 && usage.message.indexOf("Legado") !== -1);
  ok("mensagem orienta remover e finalizar",
    usage.message.indexOf("Remova-o") !== -1 &&
    usage.message.toLowerCase().indexOf("finalize") !== -1);
  eq("usedBy é atalho para as rotinas",
    CX.usedBy(routines, "cx_use").map((r) => r.id), ["rA", "rC"]);

  const sameTemp = { id: "rA", letter: "A", name: "Peito", exercises: [{ catalogId: "cx_use" }] };
  const usageSame = CX.usageReport("cx_use", { routines, tempRoutine: sameTemp });
  eq("buffer da mesma rotina não duplica origem",
    [usageSame.routines.length, usageSame.tempRoutine], [2, null]);

  const usageSession = CX.usageReport("cx_use", { session });
  ok("sessão isolada bloqueia e orienta",
    usageSession.used && usageSession.routines.length === 0 && usageSession.session &&
    usageSession.message.toLowerCase().indexOf("finalize") !== -1);

  const freeUsage = CX.usageReport("cx_free", { routines, tempRoutine: temp, session });
  ok("usage livre não bloqueia", !freeUsage.used && freeUsage.message === "");

  const blocked = CX.remove(list, "cx_use", { routines, tempRoutine: temp, session });
  eq("remove bloqueado em uso", [blocked.ok, blocked.reason], [false, "in-use"]);
  eq("remove bloqueado devolve usage", blocked.usage.routines.length, 2);
  eq("lista intacta quando bloqueado", blocked.list.length, 2);
  eq("remove bloqueado apenas pelo buffer",
    CX.remove(list, "cx_use", { tempRoutine: temp }).reason, "in-use");
  eq("remove bloqueado apenas pela sessão",
    CX.remove(list, "cx_use", { session }).reason, "in-use");

  const free = CX.remove(list, "cx_free", { routines, tempRoutine: temp, session });
  eq("remove livre devolve lista sem o item",
    [free.ok, free.list.map((e) => e.id)], [true, ["cx_use"]]);
  eq("lista original intacta após remoção", list.length, 2);
  eq("remove de id inexistente",
    CX.remove(list, "cx_nao_existe", {}).reason, "not-found");
  eq("remove rejeita id inseguro",
    CX.remove(list, "cx_');alert(1)//", {}).reason, "not-found");

  // ── sanitize ──────────────────────────────────────────────────────────
  const sanitizeOptions = { groups, officialNames: official };
  eq("sanitize não-array -> null", CX.sanitize(null, sanitizeOptions), null);
  eq("sanitize sem grupos -> null (falha fechada)",
    CX.sanitize([{ id: "cx_x", name: "X", muscle: "Peito" }]), null);
  eq("sanitize lista vazia -> []", CX.sanitize([], sanitizeOptions), []);

  const raw = [
    { id: "cx_a", name: "  Supino  ", muscle: "Peito" },
    { id: "cx_a", name: "Duplicado por id", muscle: "Peito" },
    { id: "cx_b", name: "supino", muscle: "Peito" },
    { id: "A-01", name: "Oficial", muscle: "Peito" },
    { id: "cx_c", name: "   ", muscle: "Peito" },
    { id: "cx_d", name: "Sem grupo" },
    { nome: "Sem id", grupoMuscular: "Costas" },
    { id: "cx_e", nome: "Alias", grupoMuscular: "Costas" },
    { id: "cx_f", name: "Grupo alternativo", group: "Pernas" },
    { id: "cx_g", name: "Rosca Teste", muscle: " bíceps " },
    { id: "cx_oficial", name: "  SUPINO   RETO  ", muscle: "Peito" },
    { id: "cx_bad_group", name: "Grupo inexistente", muscle: "Grupo Inexistente" },
    "lixo",
    null,
  ];
  const clean = CX.sanitize(raw, sanitizeOptions);
  eq("sanitize mantém válidos e únicos",
    clean.map((e) => e.id), ["cx_a", "cx_e", "cx_f", "cx_g"]);
  eq("sanitize canonicaliza aliases",
    [clean[1].name, clean[1].muscle, clean[2].muscle], ["Alias", "Costas", "Pernas"]);
  eq("sanitize canonicaliza o grupo oficial",
    [clean[3].muscle], ["Bíceps"]);
  eq("sanitize rejeita grupo não oficial",
    CX.sanitize([{ id: "cx_bad", name: "X", muscle: "Grupo Inexistente" }], sanitizeOptions), []);
  eq("sanitize rejeita duplicidade oficial",
    CX.sanitize([{ id: "cx_of", name: "  SUPINO   RETO  ", muscle: "Peito" }], sanitizeOptions), []);
  eq("sanitize rejeita duplicidade oficial ignorando acentos",
    CX.sanitize([{ id: "cx_of_acc", name: "TRICEPS   POLIA", muscle: "Tríceps" }], sanitizeOptions), []);
  eq("sanitize rejeita id inseguro",
    CX.sanitize([{ id: "cx_');alert(1)//", name: "X", muscle: "Peito" }], sanitizeOptions), []);
  eq("sanitize deduplica caixa/acentos/espaços entre personalizados",
    CX.sanitize([
      { id: "cx_acc", name: "Extensão Custom", muscle: "Pernas" },
      { id: "cx_acc_dup", name: "extensao   custom", muscle: "Pernas" },
    ], sanitizeOptions).map((e) => e.id), ["cx_acc"]);
  eq("sanitize trunca nome em 60",
    CX.sanitize([{ id: "cx_long", name: "x".repeat(70), muscle: "Peito" }], sanitizeOptions)[0].name.length,
    60);
  const generated = CX.create([], { name: "Exercício Gerado", muscle: "Peito" }, { groups }).exercise;
  eq("sanitize preserva id válido gerado pelo sistema",
    CX.sanitize([generated], sanitizeOptions), [generated]);

  // Relatório explícito usado pela Persistence (A-09).
  const report = CX.sanitizeWithReport(raw, sanitizeOptions);
  eq("sanitizeWithReport informa ok e motivo", [report.ok, report.reason], [true, null]);
  eq("sanitizeWithReport conta descartes", report.discarded, raw.length - 4);
  eq("sanitizeWithReport conta normalizações", report.normalized, 2);
  eq("sanitizeWithReport devolve a mesma lista", report.value, clean);
  const invalidReport = CX.sanitizeWithReport(null, sanitizeOptions);
  eq("sanitizeWithReport payload inválido",
    [invalidReport.ok, invalidReport.reason], [false, "invalid-payload"]);
  const missingGroupsReport = CX.sanitizeWithReport([
    { id: "cx_x", name: "X", muscle: "Peito" },
  ]);
  eq("sanitizeWithReport sem grupos",
    [missingGroupsReport.ok, missingGroupsReport.reason], [false, "missing-groups"]);

  // ── Protótipo, busca e consulta ───────────────────────────────────────
  const proto = CX.toPrototype({ id: "cx_a", name: "Supino", muscle: "Peito" },
    (m) => "img/" + m);
  eq("toPrototype shape do protótipo", proto, {
    id: "cx_a", name: "Supino", en: "", muscle: "Peito", subgroup: "",
    equipment: "Personalizado", img: "img/Peito", custom: true,
  });
  eq("toPrototype sem imageOf -> img vazia",
    CX.toPrototype({ id: "cx_a", name: "X", muscle: "Peito" }).img, "");
  eq("toPrototype null", CX.toPrototype(null), null);
  eq("toPrototype rejeita id inseguro",
    CX.toPrototype({ id: "cx_');alert(1)//", name: "X", muscle: "Peito" }), null);

  const searchList = [
    { id: "cx_1", name: "Rosca Scott", muscle: "Bíceps" },
    { id: "cx_2", name: "Supino Inclinado", muscle: "Peito" },
    { id: "cx_3", name: "Remada Baixa", muscle: "Costas" },
  ];
  eq("search sem filtros devolve tudo", CX.search(searchList, "", "all").length, 3);
  eq("search por termo ignora acentos/caixa",
    CX.search(searchList, "ROSCA", "all").map((e) => e.id), ["cx_1"]);
  eq("search por grupo normaliza",
    CX.search(searchList, "", "biceps").map((e) => e.id), ["cx_1"]);
  eq("search combina termo e grupo", CX.search(searchList, "supino", "Costas").length, 0);
  eq("search vazio sem grupo devolve tudo", CX.search(searchList, null, null).length, 3);
  ok("findById",
    CX.findById(searchList, "cx_2") === searchList[1] && CX.findById(searchList, "x") === null);
  eq("findById rejeita id inseguro",
    CX.findById(searchList, "cx_');alert(1)//"), null);

  // ── Pureza e fallback sem TTUtils ─────────────────────────────────────
  const source = fs.readFileSync(path.join(ROOT, "js", "custom-exercises.js"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok("módulo puro: sem DOM/storage/estado/Persistence/EventBus",
    !/\bdocument\b|\blocalStorage\b|\bPersistence\b|\bStorageService\b|\bEventBus\b|\bstate\b/.test(code));

  const sbFallback = makeSandbox();
  loadModules(sbFallback, ["js/custom-exercises.js"]);
  const CXFallback = sbFallback.CustomExercises;
  const fallback = CXFallback.create([], { name: "  Remada  ", muscle: "Costas" },
    { groups: ["Costas"] });
  ok("funciona sem TTUtils (fallback próprio)",
    fallback.ok && fallback.exercise.name === "Remada" && /^cx_/.test(fallback.exercise.id));
  eq("fallback normaliza acentos em duplicidade",
    CXFallback.validateName("triceps", { officialNames: ["Tríceps"] }).reason,
    "name-duplicate-official");
}

// ---------------------------------------------------------------------------
// CustomCatalog (Sprint 5.2.1 - oficial -> personalizado -> fallback)
// ---------------------------------------------------------------------------
function testCustomCatalog() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "js/custom-exercises.js", "js/custom-catalog.js"]);
  const CC = sb.CustomCatalog;

  suite("CustomCatalog (integração de apresentação)");

  ok("expõe CustomCatalog", !!CC && typeof CC.resolve === "function");

  const official = [
    { id: "C-02", name: "Supino reto", muscle: "Peito" },
    { id: "C-01", name: "Supino inclinado", muscle: "Peito" },
  ];
  const custom = [
    { id: "cx_1", name: "Supino Inclinado Custom", muscle: "Peito" },
    { id: "cx_2", name: "Remada Baixa", muscle: "Costas" },
  ];
  const imageOf = (muscle) => "img/" + muscle;

  const customItems = CC.items(custom, imageOf);
  eq("items preserva a ordem personalizada", customItems.map((i) => i.id), ["cx_1", "cx_2"]);
  ok("items marca custom e resolve a imagem",
    customItems[0].custom === true && customItems[0].img === "img/Peito" &&
    customItems[0].equipment === "Personalizado");
  eq("items lista inválida -> []", CC.items(null, imageOf), []);
  eq("items item nulo é descartado", CC.items([null], imageOf), []);
  eq("items descarta id inseguro antes de renderizar",
    CC.items([{ id: "cx_');alert(1)//", name: "X", muscle: "Peito" }], imageOf), []);

  const fallback = { id: "_missing", name: "Exercício removido" };
  ok("resolve oficial primeiro",
    CC.resolve("C-02", official, custom, fallback, imageOf) === official[0]);
  ok("resolve personalizado quando não há oficial",
    CC.resolve("cx_1", official, custom, fallback, imageOf).name === "Supino Inclinado Custom");
  ok("fallback quando o id não existe",
    CC.resolve("nao-existe", official, custom, fallback, imageOf) === fallback);
  ok("fallback nulo é permitido", CC.resolve("nao-existe", official, custom, null, imageOf) === null);
  ok("resolve ignora id inseguro no personalizado",
    CC.resolve("cx_');alert(1)//", official,
      [{ id: "cx_');alert(1)//", name: "X", muscle: "Peito" }], fallback, imageOf) === fallback);

  // Colisão hipotética: o oficial vence, sem alterar o catálogo oficial.
  const collision = [{ id: "cx_colide", name: "Oficial vence", muscle: "Peito" }];
  const collisionCustom = [{ id: "cx_colide", name: "Personalizado perde", muscle: "Peito" }];
  eq("colisão de id resolve pelo oficial",
    CC.resolve("cx_colide", collision, collisionCustom, fallback, imageOf).name,
    "Oficial vence");

  const merged = CC.search(official, custom, "", "all", imageOf);
  eq("search devolve oficiais antes dos personalizados",
    merged.map((i) => i.id), ["C-02", "C-01", "cx_1", "cx_2"]);
  eq("search filtra personalizados por termo",
    CC.search([], custom, "remada", "all", imageOf).map((i) => i.id), ["cx_2"]);
  eq("search combina grupo e termo",
    CC.search(official, custom, "supino", "Peito", imageOf).map((i) => i.id),
    ["C-02", "C-01", "cx_1"]);
  eq("search por grupo sem oficiais no grupo",
    CC.search([], custom, "", "Costas", imageOf).map((i) => i.id),
    ["cx_2"]);
  eq("search sem resultados oficiais mantém personalizados",
    CC.search([], custom, "rosca", "all", imageOf), []);

  // Degradação segura se o módulo de domínio não estiver carregado.
  const sbNoDomain = makeSandbox();
  loadModules(sbNoDomain, ["js/custom-catalog.js"]);
  const CCFallback = sbNoDomain.CustomCatalog;
  eq("sem CustomExercises: items -> []", CCFallback.items(custom, imageOf), []);
  ok("sem CustomExercises: resolve ainda usa oficial/fallback",
    CCFallback.resolve("C-02", official, custom, fallback, imageOf) === official[0] &&
    CCFallback.resolve("cx_1", official, custom, fallback, imageOf) === fallback);
  eq("sem CustomExercises: search só oficiais",
    CCFallback.search(official, custom, "", "all", imageOf), official);
}

// ---------------------------------------------------------------------------
// EventBus (Fase 2A)
// ---------------------------------------------------------------------------
function testEvents() {
  const sb = makeSandbox();
  loadModules(sb, ["js/events.js"]);
  const E = sb.EventBus;

  suite("EventBus");

  ok("expõe EventBus", !!E);

  let got = null;
  const h = (d) => { got = d; };
  E.on("x", h);
  E.emit("x", { a: 1 });
  eq("emit entrega dados", got, { a: 1 });

  E.off("x", h);
  got = null;
  E.emit("x", { a: 2 });
  eq("off remove listener", got, null);

  let n = 0;
  E.on("y", () => { n++; });
  E.on("y", () => { throw new Error("boom"); });
  E.on("y", () => { n++; });
  E.emit("y");
  eq("erro em um listener não interrompe os demais", n, 2);
  eq("count", E.count("y"), 3);

  E.off("y");
  eq("off sem callback limpa o evento", E.count("y"), 0);

  E.on("z", () => { n++; });
  E.clear();
  E.emit("z");
  eq("clear remove todos os listeners", E.count("z"), 0);

  let didThrow = false;
  try { E.emit("constructor", { a: 1 }); } catch (err) { didThrow = true; }
  ok("emit em nome herdado (constructor) não lança", didThrow === false);

  let called = 0;
  const cb = () => { called++; };
  E.on("k", cb);
  E.on("k", cb);
  E.off("k", cb);
  eq("off remove todas as ocorrências do mesmo callback", E.count("k"), 0);
}

// ---------------------------------------------------------------------------
// TTUtils — datas/semanas/carga (Fase 2A)
// ---------------------------------------------------------------------------
function testUtilsDates() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js"]);
  const U = sb.TTUtils;

  suite("TTUtils (datas/semanas/carga)");

  ok("today() em ISO curto", /^\d{4}-\d{2}-\d{2}$/.test(U.today()));
  ok("fmtDate formata dd/mm/aa", /^\d{2}\/\d{2}\/\d{2}$/.test(U.fmtDate("2026-10-18")), U.fmtDate("2026-10-18"));
  eq("fmtDate nulo -> --", U.fmtDate(null), "--");

  // 2026-10-18 é domingo; a semana vai de 12 (seg) a 18 (dom).
  const wk = U.getWeekRange("2026-10-18");
  eq("getWeekRange.start = segunda", U.todayISO(wk.start), "2026-10-12");
  eq("getWeekRange.end = domingo", U.todayISO(wk.end), "2026-10-18");
  ok("isSameWeek mesma semana", U.isSameWeek("2026-10-12", "2026-10-18"));
  ok("isSameWeek semanas diferentes", U.isSameWeek("2026-10-18", "2026-10-19") === false);
  ok("getWeekRange aceita Date", U.todayISO(U.getWeekRange(new Date("2026-10-18T12:00:00")).start) === "2026-10-12");

  // Sprint 5.1.3 (M1): hoje/última semana só valem quando NADA foi passado — o
  // argumento nunca pode ser ignorado em silêncio. Semanas de 2020/2021 provam
  // isso sem depender de qual é a semana corrente (a checagem acima passava por
  // coincidência quando a suíte rodava entre 12 e 18/10/2026).
  ok("todayISO aceita Date de outro realm (sandbox/host) e epoch local",
    U.todayISO(new Date("2026-10-18T12:00:00")) === "2026-10-18" &&
    U.todayISO(new Date(2026, 9, 18, 12, 0, 0).getTime()) === "2026-10-18");
  ok("todayISO aceita 'YYYY-MM-DD' e devolve ESSA data",
    U.todayISO("2026-10-18") === "2026-10-18" && U.todayISO("2026-01-02") === "2026-01-02");
  ok("todayISO sem argumento/inválido cai em hoje (ISO curto, sem lançar)",
    /^\d{4}-\d{2}-\d{2}$/.test(U.todayISO()) && /^\d{4}-\d{2}-\d{2}$/.test(U.todayISO("ontem")) &&
    /^\d{4}-\d{2}-\d{2}$/.test(U.todayISO(null)) && /^\d{4}-\d{2}-\d{2}$/.test(U.todayISO(NaN)));
  ok("getWeekRange: Date de outro realm e 'YYYY-MM-DD' concordam (argumento é respeitado)",
    U.todayISO(U.getWeekRange(new Date("2020-02-05T12:00:00")).start) === "2020-02-03" &&
    U.todayISO(U.getWeekRange("2020-02-05").start) === "2020-02-03" &&
    U.todayISO(U.getWeekRange(new Date("2021-01-01T12:00:00")).start) === "2020-12-28");

  eq("getMaxCarga (series/carga)", U.getMaxCarga({ series: [{ carga: 60 }, { carga: 82.5 }, { carga: 40 }] }), 82.5);
  eq("getMaxCarga (sets/weight)", U.getMaxCarga({ sets: [{ weight: 10 }, { weight: 12.5 }] }), 12.5);
  eq("getMaxCarga vazio -> 0", U.getMaxCarga({ series: [] }), 0);
  eq("getMaxCarga sem exercício -> 0", U.getMaxCarga(null), 0);
  eq("getMaxReps", U.getMaxReps({ sets: [{ reps: 8 }, { reps: 15 }] }), 15);
}


// ---------------------------------------------------------------------------
// Persistence — enriquecimento do histórico e PRs (Fase 2C)
// ---------------------------------------------------------------------------
function testPersistence2C() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "services/storage.js", "js/i18n.js", "js/persistence.js"]);
  const P = sb.Persistence;
  const S = sb.StorageService;

  suite("Persistence (Fase 2C — histórico rico + PRs)");

  eq("schema continua v1 (mudança aditiva)", P.SCHEMA_VERSION, 1);
  eq("chave lógica de PRs", P.KEYS.prs, "prs");

  P.saveHistory([{
    id: 7, name: "Treino A — Peito", date: "18 de out., 10:00", dateISO: "2026-10-18",
    duration: "45 min", durationMin: 45, status: "completed", routineId: "rA", letter: "A",
    exercises: [{ catalogId: "C-02", name: "Supino reto", muscle: "Peito", sets: [{ weight: 60, reps: 12 }] }],
    prs: [{ type: "carga", value: 60 }],
  }]);
  const t1 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(t1);
  eq("séries concluídas restauradas", t1.history[0].exercises[0].sets[0], { weight: 60, reps: 12 });
  eq("exercício (nome/músculo/catalogId)", [t1.history[0].exercises[0].name, t1.history[0].exercises[0].muscle, t1.history[0].exercises[0].catalogId], ["Supino reto", "Peito", "C-02"]);
  eq("duração (min) restaurada", t1.history[0].durationMin, 45);
  eq("dateISO restaurado", t1.history[0].dateISO, "2026-10-18");
  eq("prs do treino restaurados", t1.history[0].prs[0], { type: "carga", value: 60 });

  // Retrocompatível com entradas antigas (só resumo)
  P.saveHistory([{ id: 9, name: "Antigo", date: "x", duration: "10 min", status: "partial" }]);
  const t2 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(t2);
  eq("entrada antiga continua válida", t2.history.length, 1);
  eq("sem campo exercises quando não havia", t2.history[0].exercises, undefined);
  eq("status partial preservado", t2.history[0].status, "partial");

  // Lixo dentro de exercícios/séries é descartado
  P.saveHistory([{
    name: "Bagunça",
    exercises: [{ sets: [{ weight: "x", reps: -3 }] }, { semNome: true }, { name: "Ok", sets: [{ weight: 5, reps: 8 }] }],
  }]);
  const t3 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(t3);
  eq("só exercícios com nome sobrevivem", t3.history[0].exercises.length, 1);
  eq("exercício válido mantém séries", t3.history[0].exercises[0].sets[0], { weight: 5, reps: 8 });

  P.saveHistory([{
    name: "Séries inválidas", exercises: [{ name: "Ok", sets: [
      { weight: 10, reps: 0 }, { weight: 20, reps: -2 }, { weight: 30, reps: "x" }, { weight: 40, reps: 8 },
    ] }],
  }]);
  const tReps = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(tReps);
  eq("histórico descarta séries restauradas com reps menores que 1", tReps.history[0].exercises[0].sets, [{ weight: 40, reps: 8 }]);

  // Sprint 5.1: marcação de MODALIDADE sobrevive ao round-trip (leitura do
  // resumo semanal precisa reconhecer o cardio mesmo após recarregar).
  P.saveHistory([{
    name: "Cardio", status: "completed", dateISO: "2026-10-18", durationMin: 30,
    category: "cardio", type: "cardio",
  }]);
  const tCardio = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(tCardio);
  ok("histórico preserva category/type (marcação de cardio) de forma aditiva",
    tCardio.history[0].category === "cardio" && tCardio.history[0].type === "cardio" &&
    tCardio.history[0].durationMin === 30 && tCardio.history[0].dateISO === "2026-10-18");
  P.saveHistory([{ name: "Força", status: "completed", dateISO: "2026-10-18" }]);
  const tStrength = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(tStrength);
  ok("entrada de força não ganha marcação de cardio",
    tStrength.history[0].category === undefined && tStrength.history[0].type === undefined);

  // Array de exercícios vazio não é persistido
  P.saveHistory([{ name: "Sem exercícios", exercises: [] }]);
  const t4 = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(t4);
  eq("exercises vazio é omitido", t4.history[0].exercises, undefined);

  // PRs: round-trip e sanitização
  ok("savePRs grava", P.savePRs([{ exerciseKey: "C-02", exerciseName: "Supino reto", type: "carga", value: 60, workoutId: 1 }]) === true);
  const prs = P.loadPRs();
  eq("loadPRs round-trip", prs.length, 1);
  eq("id derivado quando ausente", prs[0].id, "C-02_carga");
  eq("value preservado", prs[0].value, 60);

  S.save("prs", [{ nada: true }, null, { exerciseKey: "x", type: "" }]);
  eq("registros inválidos de PR são descartados", P.loadPRs(), []);

  // reset() também limpa os PRs (sem tocar no idioma)
  P.savePRs([{ exerciseKey: "C-02", type: "carga", value: 60 }]);
  S.save("lang", "en");
  P.reset();
  eq("reset limpa PRs", S.load("prs"), null);
  eq("reset preserva idioma", S.load("lang"), "en");
}

// ---------------------------------------------------------------------------
// Engine de PRs (Fase 2C)
// ---------------------------------------------------------------------------
function testPR() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "services/storage.js", "js/i18n.js", "js/persistence.js", "js/events.js", "js/pr.js"]);
  const PR = sb.PR;

  suite("PR engine");

  ok("expõe PR", !!PR);
  eq("6 critérios preservados", PR.TYPES.join(","), "carga,reps,volume,oneRM,series,weeklyStreak");

  const base = [{ id: 1000, name: "Treino A", dateISO: "2026-10-05", exercises: [
    { catalogId: "C-02", name: "Supino reto", muscle: "Peito", sets: [{ weight: 50, reps: 10 }] },
  ] }];
  const workout = { id: 2000, name: "Treino A", dateISO: "2026-10-18", status: "completed", exercises: [
    { catalogId: "C-02", name: "Supino reto", muscle: "Peito", sets: [{ weight: 60, reps: 12 }, { weight: 62.5, reps: 10 }] },
  ] };
  const hist = base.concat([workout]);

  let prEvents = 0;
  sb.EventBus.on("pr:new", () => { prEvents++; });

  const news = PR.checkNewPR(workout, hist);
  eq("detecta os 6 critérios no 1º treino", news.length, 6);
  ok("emite evento pr:new", prEvents === 1);
  eq("registra 6 recordes", PR.getAll().length, 6);

  const byType = (t) => PR.getAll().find((r) => r.exerciseKey === "C-02" && r.type === t);
  eq("carga = maior peso", byType("carga").value, 62.5);
  eq("reps = maior repetição", byType("reps").value, 12);
  eq("volume = soma reps*peso", byType("volume").value, 1345);
  eq("oneRM (Epley)", byType("oneRM").value, 84);
  eq("series = séries concluídas", byType("series").value, 2);
  eq("weeklyStreak", byType("weeklyStreak").value, 1);
  ok("workoutId gravado", byType("carga").workoutId === 2000);

  // Idempotência: reprocessar o MESMO treino não duplica
  const again = PR.checkNewPR(workout, hist);
  eq("reprocessar a mesma sessão não gera PRs", again.length, 0);
  eq("total permanece 6", PR.getAll().length, 6);

  // Novo treino melhor: só os critérios que realmente subiram
  const workout2 = { id: 3000, name: "Treino A", dateISO: "2026-10-18", exercises: [
    { catalogId: "C-02", name: "Supino reto", sets: [{ weight: 70, reps: 8 }] },
  ] };
  const news2 = PR.checkNewPR(workout2, hist.concat([workout2]));
  eq("só critérios superados viram PR", news2.map((p) => p.type).sort().join(","), "carga,oneRM,weeklyStreak");
  eq("registros atualizados no lugar (sem duplicar)", PR.getAll().length, 6);
  eq("carga atualizada", byType("carga").value, 70);

  // Exercício sem catalogId usa o nome como chave (custom)
  const custom = { id: 4000, name: "Treino B", dateISO: "2026-10-18", exercises: [
    { name: "Exercício custom", sets: [{ weight: 10, reps: 15 }] },
  ] };
  PR.checkNewPR(custom, [custom]);
  ok("PR de exercício custom usa o nome", PR.getAll().some((r) => r.exerciseKey === "Exercício custom"));

  // Consultas
  const prC02 = PR.getExercisePR("C-02");
  eq("getExercisePR por id", prC02.carga.value, 70);
  const stats = PR.getPRStatistics();
  ok("getPRStatistics.total", stats.total === 12, String(stats.total));
  ok("getPRStatistics.thisWeek é número", typeof stats.thisWeek === "number");
  eq("getLatestPRs respeita o limite", PR.getLatestPRs(3).length, 3);
  ok("getTopPRs agrega por exercício", PR.getTopPRs(5)[0].count === 6);
  ok("getExerciseHistory do custom", PR.getExerciseHistory("Exercício custom").length === 6);

  // clear
  PR.clear();
  eq("clear zera os recordes", PR.getAll().length, 0);
}

// ---------------------------------------------------------------------------
// RoutineActions — exclusão segura (Fase 2C)
// ---------------------------------------------------------------------------
function testRoutineActions() {
  const sb = makeSandbox();
  loadModules(sb, ["js/routine-actions.js"]);
  const RA = sb.RoutineActions;

  suite("RoutineActions (exclusão)");

  ok("expõe RoutineActions", !!RA);

  const routines = [
    { id: "rA", letter: "A", name: "Peito", exercises: [] },
    { id: "rB", letter: "B", name: "Costas", exercises: [{ catalogId: "D-01" }] },
  ];

  let saved = null;
  const res = RA.deleteRoutine({ routines, id: "rA", session: null, save: (list) => { saved = list; return true; } });
  ok("exclui apenas a rotina selecionada", res.ok === true && res.routines.length === 1 && res.routines[0].id === "rB");
  ok("não muta a lista original", routines.length === 2);
  ok("persiste a lista resultante", !!saved && saved.length === 1 && saved[0].id === "rB");

  eq("id inexistente -> not-found", RA.deleteRoutine({ routines, id: "rZ", save: () => true }).reason, "not-found");
  eq("id vazio -> missing-id", RA.deleteRoutine({ routines, id: "", save: () => true }).reason, "missing-id");
  eq("estado inválido", RA.deleteRoutine({ routines: null, id: "rA" }).reason, "invalid-state");

  let saveCalled = false;
  const active = RA.deleteRoutine({ routines, id: "rA", session: { routineId: "rA" }, save: () => { saveCalled = true; return true; } });
  eq("sessão ativa bloqueia a exclusão", active.reason, "active-session");
  ok("bloqueio não persiste", saveCalled === false);

  const storage = RA.deleteRoutine({ routines, id: "rA", save: () => false });
  eq("falha de storage -> storage", storage.reason, "storage");
  ok("falha de storage não devolve lista", storage.ok === false && storage.routines === undefined);

  const throws = RA.deleteRoutine({ routines, id: "rA", save: () => { throw new Error("boom"); } });
  eq("save que lança -> storage", throws.reason, "storage");

  ok("canDelete verdadeiro", RA.canDelete(routines, "rA", null) === true);
  ok("canDelete falso com sessão ativa", RA.canDelete(routines, "rA", { routineId: "rA" }) === false);
  ok("canDelete falso para id inexistente", RA.canDelete(routines, "rZ", null) === false);

  // --- Sprint 4: mensagem do bloqueio reflete o ESTADO REAL da sessão -------
  ok("bloqueio sem sessão -> mensagem vazia", RA.blockMessage(null, false) === "");
  ok("mensagem de sessão ativa (legado preservado)",
    RA.blockMessage({ routineId: "rA", status: "active" }) === "Treino em execução. Finalize ou saia da sessão antes de excluir.");
  ok("sessão sem status conhecido mantém a mensagem legada",
    RA.blockMessage({ routineId: "rA" }) === "Treino em execução. Finalize ou saia da sessão antes de excluir.");
  ok("mensagem de sessão PAUSADA",
    /pausada/i.test(RA.blockMessage({ routineId: "rA", status: "paused" })));
  ok("mensagem de sessão CONCLUÍDA aguardando finalização",
    /concluída aguardando finalização/i.test(RA.blockMessage({ routineId: "rA", status: "finished" })));
  ok("mensagem de sessão RECUPERADA aguardando decisão",
    /recuperada aguardando decisão/i.test(RA.blockMessage({ routineId: "rA", status: "active" }, true)));
  ok("recuperada tem prioridade sobre o status (é o estado percebido pelo usuário)",
    /recuperada/i.test(RA.blockMessage({ routineId: "rA", status: "paused" }, true)));
  ok("mensagens distinguem os 4 estados",
    new Set([
      RA.blockMessage({ status: "active" }),
      RA.blockMessage({ status: "paused" }),
      RA.blockMessage({ status: "finished" }),
      RA.blockMessage({ status: "active" }, true),
    ]).size === 4);

  const paused = RA.deleteRoutine({ routines, id: "rA", session: { routineId: "rA", status: "paused" } });
  ok("bloqueio por sessão pausada mantém reason e explica o estado",
    paused.reason === "active-session" && /pausada/i.test(paused.message));
  const recovered = RA.deleteRoutine({ routines, id: "rA", session: { routineId: "rA", status: "active" }, recovered: true });
  ok("bloqueio por sessão recuperada mantém reason e explica o estado",
    recovered.reason === "active-session" && /recuperada/i.test(recovered.message));
  ok("regra de bloqueio inalterada (canDelete segue falso com sessão)",
    RA.canDelete(routines, "rA", { routineId: "rA", status: "paused" }) === false);
}

// ---------------------------------------------------------------------------
// WorkoutSession — domínio da sessão (Sprint 4 / E1)
// ---------------------------------------------------------------------------
function testWorkoutSession() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "js/workout-session.js"]);
  const WS = sb.WorkoutSession;

  suite("WorkoutSession (domínio da sessão)");

  // `instanceof Date` não atravessa realms do vm: checagem agnóstica.
  const isDate = (v) => Object.prototype.toString.call(v) === "[object Date]";

  ok("expõe WorkoutSession no global", !!WS);
  ok("module.exports expõe a mesma API",
    typeof require(path.join(ROOT, "js/workout-session.js")).create === "function");
  eq("STATUS canônico", [WS.STATUS.ACTIVE, WS.STATUS.PAUSED, WS.STATUS.FINISHED],
    ["active", "paused", "finished"]);

  // ---- Fixtures com o formato REAL das rotinas do app --------------------
  const T0 = new Date("2026-10-18T10:00:00.000Z");
  const routine = {
    id: "rA",
    letter: "A",
    name: "Peito e tríceps",
    exercises: [
      { catalogId: "C-02", sets: 2, reps: 12, weight: 60, rest: 60 },
      { catalogId: "C-01", sets: 1, reps: 10, weight: 40, rest: 60 },
    ],
  };
  const resolve = (id) => ({ name: "Ex " + id, muscle: "Peito", img: "assets/images/peito.jpg" });

  // ---- create() ----------------------------------------------------------
  const s = WS.create(routine, T0, { resolve });
  ok("create gera sessão ativa", !!s && s.status === "active" && s.isFinished === false);
  ok("create preserva a rotina de origem",
    s.routineId === "rA" && s.letter === "A" && s.routineName === "Peito e tríceps");
  ok("create gera id estável e único",
    typeof s.id === "string" && s.id.length > 0 && WS.create(routine, T0).id !== s.id);
  ok("startedAt registrado como Date",
    isDate(s.startedAt) && s.startedAt.getTime() === T0.getTime());
  eq("índices iniciais", [s.currentExerciseIndex, s.currentSetIndex], [0, 1]);

  const ex0 = s.exercises[0];
  ok("preserva id do catálogo e metas da rotina",
    ex0.catalogId === "C-02" && ex0.sets === 2 && ex0.reps === 12 && ex0.weight === 60 && ex0.rest === 60);
  ok("resolve enriquece nome/músculo/imagem",
    ex0.name === "Ex C-02" && ex0.muscle === "Peito" && /^assets\/images\//.test(ex0.img));
  ok("actualWeight/actualReps partem da meta", ex0.actualWeight === 60 && ex0.actualReps === 12);
  ok("inicia sem séries concluídas",
    ex0.setsCompleted === 0 && Array.isArray(ex0.completedSets) && ex0.completedSets.length === 0);
  eq("progresso inicial", WS.progress(s), {
    totalExercises: 2, completedExercises: 0, totalSets: 3, completedSets: 0,
    currentExerciseIndex: 0, currentSetIndex: 1, percent: 0,
  });

  const noResolve = WS.create(routine, T0);
  ok("sem resolve mantém os dados da rotina e não quebra",
    noResolve.exercises[0].catalogId === "C-02" && noResolve.exercises[0].name === "");

  ok("create rejeita entrada inválida",
    WS.create(null) === null && WS.create([]) === null && WS.create("x") === null);

  const emptyRoutine = WS.create({ id: "rZ", letter: "Z", name: "Vazia", exercises: [] }, T0);
  ok("rotina vazia ainda é uma sessão válida",
    !!emptyRoutine && emptyRoutine.exercises.length === 0);
  eq("progresso de rotina vazia", WS.progress(emptyRoutine).percent, 0);

  const injected = WS.create({ id: "rI", exercises: [null, "x", { foo: 1 }] }, T0);
  ok("exercícios sem identidade são descartados",
    injected.exercises.length === 0 && WS.progress(injected).percent === 0);

  // ---- completeSet(): séries reais ---------------------------------------
  ok("completeSet registra a série com carga/reps reais",
    WS.completeSet(s, { weight: 62.5, reps: 12 }, T0) === s);
  eq("série gravada", s.exercises[0].completedSets, [{ weight: 62.5, reps: 12 }]);
  ok("setsCompleted espelha completedSets",
    s.exercises[0].setsCompleted === 1 && s.exercises[0].setsCompleted === s.exercises[0].completedSets.length);
  eq("avança para a próxima série", s.currentSetIndex, 2);
  eq("progresso 1/3", WS.progress(s).completedSets, 1);
  eq("percentual arredondado", WS.progress(s).percent, 33);

  const before = JSON.stringify(s);
  ok("weight não numérico é rejeitado",
    WS.completeSet(s, { weight: "abc", reps: 5 }) === null);
  ok("reps < 1 é rejeitado", WS.completeSet(s, { weight: 10, reps: 0 }) === null);
  ok("weight negativo é rejeitado", WS.completeSet(s, { weight: -5, reps: 5 }) === null);
  ok("entrada ausente é rejeitada", WS.completeSet(s) === null && WS.completeSet(s, {}) === null);
  ok("rejeição não altera a sessão", JSON.stringify(s) === before);

  ok("aceita string numérica ('62,5' / '10')",
    WS.completeSet(s, { weight: "62,5", reps: "10" }, T0) === s);
  eq("string numérica normalizada", s.exercises[0].completedSets[1], { weight: 62.5, reps: 10 });
  ok("ao esgotar as séries o exercício avança",
    s.currentExerciseIndex === 1 && s.currentSetIndex === 1);
  ok("séries pendentes do próximo exercício não contam",
    s.exercises[1].completedSets.length === 0 && s.exercises[1].setsCompleted === 0);
  eq("progresso 2/3", WS.progress(s).completedSets, 2);

  const T1 = new Date("2026-10-18T10:30:00.000Z");
  ok("a última série encerra a sessão",
    WS.completeSet(s, { weight: 40, reps: 10 }, T1) === s && s.status === "finished" && s.isFinished === true);
  ok("finishedAt registrado", isDate(s.finishedAt) && s.finishedAt.getTime() === T1.getTime());
  eq("progresso final", WS.progress(s), {
    totalExercises: 2, completedExercises: 2, totalSets: 3, completedSets: 3,
    currentExerciseIndex: 1, currentSetIndex: 1, percent: 100,
  });

  // ---- transições inválidas ---------------------------------------------
  ok("sessão finalizada não aceita nova série",
    WS.completeSet(s, { weight: 40, reps: 10 }) === null);
  ok("navegação em sessão finalizada é recusada", WS.next(s) === null && WS.prev(s) === null);
  ok("pause/resume em sessão finalizada é recusado", WS.pause(s) === null && WS.resume(s) === null);
  ok("não completa série sem exercício corrente",
    WS.completeSet(WS.create(emptyRoutine, T0), { weight: 10, reps: 10 }) === null);
  ok("completeSet em estrutura inválida -> null", WS.completeSet({}, { weight: 1, reps: 1 }) === null);

  // ---- navegação nos limites --------------------------------------------
  const nav = WS.create(routine, T0);
  ok("prev no primeiro exercício -> null", WS.prev(nav) === null);
  ok("next avança de exercício", WS.next(nav) === nav && nav.currentExerciseIndex === 1);
  ok("next no último exercício -> null", WS.next(nav) === null);
  ok("prev volta de exercício", WS.prev(nav) === nav && nav.currentExerciseIndex === 0);
  ok("navegação em rotina vazia -> null",
    WS.next(emptyRoutine) === null && WS.prev(emptyRoutine) === null);
  ok("currentSetIndex nunca ultrapassa o planejado",
    nav.currentSetIndex >= 1 && nav.currentSetIndex <= nav.exercises[nav.currentExerciseIndex].sets);

  // ---- pausa / retomada --------------------------------------------------
  const p = WS.create(routine, T0);
  WS.completeSet(p, { weight: 60, reps: 12 }, T0);
  const T5 = new Date("2026-10-18T10:05:00.000Z");
  const T15 = new Date("2026-10-18T10:15:00.000Z");
  ok("pause marca status e pausedAt",
    WS.pause(p, T5) === p && p.status === "paused" && p.pausedAt.getTime() === T5.getTime());
  ok("pause é idempotente",
    WS.pause(p, new Date("2026-10-18T10:06:00.000Z")) === p && p.pausedAt.getTime() === T5.getTime());
  ok("sessão pausada não aceita série", WS.completeSet(p, { weight: 60, reps: 12 }) === null);
  eq("progresso preservado na pausa", WS.progress(p).completedSets, 1);
  ok("resume acumula pausedMs e limpa pausedAt",
    WS.resume(p, T15) === p && p.status === "active" && p.pausedAt === null && p.pausedMs === 10 * 60000);
  ok("resume é idempotente quando já ativa",
    WS.resume(p, new Date("2026-10-18T10:20:00.000Z")) === p && p.pausedMs === 10 * 60000);
  eq("progresso intacto após pausa/retomada", WS.progress(p).completedSets, 1);
  eq("elapsedMs desconta o tempo pausado",
    WS.elapsedMs(p, new Date("2026-10-18T10:30:00.000Z")), 20 * 60000);
  ok("elapsedMs de estrutura inválida -> 0", WS.elapsedMs(null) === 0);

  // ---- finish() ----------------------------------------------------------
  const f = WS.create(routine, T0);
  WS.pause(f, T5);
  ok("finish em sessão ativa/pausada encerra",
    WS.finish(f, T15) === f && f.status === "finished" && f.isFinished === true);
  ok("finish fecha a pausa em aberto", f.pausedAt === null && f.pausedMs === 10 * 60000);
  const fId = f.id;
  const fAt = f.finishedAt.getTime();
  WS.finish(f, new Date("2026-10-18T11:30:00.000Z"));
  ok("finish é idempotente (mesma identidade e mesmo instante)",
    f.id === fId && f.finishedAt.getTime() === fAt && f.status === "finished");
  ok("finish em estrutura inválida -> null", WS.finish(null) === null);

  const early = WS.create(routine, T0);
  ok("finish antes de concluir mantém o progresso parcial",
    WS.finish(early, T5) === early && WS.progress(early).percent === 0 && early.status === "finished");

  // ---- progress(): bordas ------------------------------------------------
  ok("progress de estrutura inválida não lança",
    WS.progress(null).percent === 0 && WS.progress({}).percent === 0 && WS.progress([]).percent === 0);
  ok("progress tolera dados incompletos",
    WS.progress({ exercises: [{ sets: 4 }, null, { sets: 0, setsCompleted: 9 }] }).percent === 0);
  ok("progress clampa séries concluídas ao planejado",
    WS.progress({ exercises: [{ sets: 2, setsCompleted: 5 }] }).completedSets === 2);
  ok("percentual sempre entre 0 e 100",
    [0, 33, 99, 100, 250].every((n) => {
      const pr = WS.progress({ exercises: [{ sets: 3, setsCompleted: n }] });
      return pr.percent >= 0 && pr.percent <= 100;
    }));

  // ---- sanitize() --------------------------------------------------------
  const raw = JSON.parse(JSON.stringify(s));
  const san = WS.sanitize(raw);
  ok("sanitize preserva a identidade", san.id === s.id && san.routineId === "rA" && san.letter === "A");
  ok("sanitize preserva o encerramento",
    san.status === "finished" && san.isFinished === true &&
      isDate(san.finishedAt) && san.finishedAt.getTime() === T1.getTime());
  eq("sanitize preserva o progresso", WS.progress(san), WS.progress(s));
  eq("sanitize preserva as séries concluídas", san.exercises[0].completedSets, s.exercises[0].completedSets);
  eq("sanitize preserva as metas da rotina",
    [san.exercises[0].catalogId, san.exercises[0].sets, san.exercises[0].reps, san.exercises[0].weight],
    ["C-02", 2, 12, 60]);

  const paused = WS.create(routine, T0);
  WS.pause(paused, T5);
  const sanPaused = WS.sanitize(JSON.parse(JSON.stringify(paused)));
  ok("sanitize preserva pausa em aberto",
    sanPaused.status === "paused" && sanPaused.isFinished === false && isDate(sanPaused.pausedAt));

  const sanActive = WS.sanitize(JSON.parse(JSON.stringify(p)));
  ok("sanitize preserva pausedMs acumulado",
    sanActive.status === "active" && sanActive.pausedAt === null && sanActive.pausedMs === 10 * 60000);

  ok("sanitize rejeita não-objeto/array",
    WS.sanitize(null) === null && WS.sanitize([]) === null && WS.sanitize("x") === null && WS.sanitize(0) === null);
  ok("sanitize rejeita exercises que não é array",
    WS.sanitize({ startedAt: "2026-10-18T10:00:00Z" }) === null &&
      WS.sanitize({ startedAt: "2026-10-18T10:00:00Z", exercises: "x" }) === null);
  ok("sanitize rejeita startedAt ausente/inválido",
    WS.sanitize({ exercises: [] }) === null && WS.sanitize({ exercises: [], startedAt: "nope" }) === null);
  ok("sanitize rejeita sessão finalizada sem finishedAt",
    WS.sanitize({ exercises: [], startedAt: "2026-10-18T10:00:00Z", status: "finished" }) === null);

  const bad = WS.sanitize({
    startedAt: "2026-10-18T10:00:00Z",
    isFinished: true,
    finishedAt: "2026-10-18T10:40:00Z",
    currentExerciseIndex: 99,
    currentSetIndex: 0,
    exercises: [
      null,
      "x",
      { catalogId: "C-02", sets: 2, reps: 12, weight: 60, rest: 60, completedSets: [
        { weight: 60, reps: 12 }, { weight: "x", reps: 5 }, { weight: 0, reps: 0 }, { weight: 70, reps: 8 }, { weight: 80, reps: 6 },
      ] },
      { name: "Exercício custom", sets: "3", reps: "10" },
      { foo: "bar" },
    ],
  });
  ok("sanitize deriva status do isFinished legado",
    bad.status === "finished" && bad.isFinished === true && isDate(bad.finishedAt));
  eq("sanitize descarta exercícios inválidos", bad.exercises.length, 2);
  eq("sanitize descarta séries inválidas (inclusive reps 0) e clampa ao planejado", bad.exercises[0].completedSets.length, 2);
  ok("sanitize sincroniza setsCompleted com completedSets",
    bad.exercises[0].setsCompleted === bad.exercises[0].completedSets.length);
  ok("sanitize reconhece exercício só com nome", bad.exercises[1].name === "Exercício custom" &&
    bad.exercises[1].sets === 3 && bad.exercises[1].reps === 10);
  ok("sanitize clampa os índices aos limites",
    bad.currentExerciseIndex === 1 && bad.currentSetIndex === 1);
  ok("sanitize corrige valores corrompidos",
    WS.sanitize({ startedAt: "2026-10-18T10:00:00Z", exercises: [
      { catalogId: "A-01", sets: -3, reps: 0, weight: -10, rest: "x", completedSets: [{ weight: -5, reps: -2 }] },
    ] }).exercises[0].weight === 0);

  // ---- independência de DOM / localStorage / estado global ---------------
  const bare = { console: { log() {}, warn() {}, info() {} } };
  vm.createContext(bare);
  loadModules(bare, ["js/workout-session.js"]);
  ok("módulo carrega sem document/localStorage",
    typeof bare.WorkoutSession === "object" && bare.localStorage === undefined && bare.document === undefined);
  const bareSession = bare.WorkoutSession.create(routine, T0);
  ok("módulo opera sem document/localStorage",
    bareSession.status === "active" && bare.WorkoutSession.completeSet(bareSession, { weight: 10, reps: 10 }, T0) === bareSession);

  const src = fs.readFileSync(path.join(ROOT, "js/workout-session.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok("código não referencia DOM/storage/estado global",
    !/\bdocument\b|\blocalStorage\b|\bwindow\b|\bsessionStorage\b/.test(src) &&
      !/\bPersistence\b|\bEventBus\b|\bCatalog\b|\bStorageService\b|\bstate\b/.test(src));
}

// ---------------------------------------------------------------------------
// Persistence — sessão de treino em andamento (Sprint 4 / E2)
// ---------------------------------------------------------------------------
function testPersistenceSession() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "services/storage.js", "js/i18n.js", "js/workout-session.js", "js/persistence.js"]);
  const S = sb.StorageService;
  const P = sb.Persistence;
  const WS = sb.WorkoutSession;

  suite("Persistence (sessão em andamento)");

  const T0 = new Date("2026-10-18T10:00:00.000Z");
  const T5 = new Date("2026-10-18T10:05:00.000Z");
  const routine = {
    id: "rA", letter: "A", name: "Peito e tríceps",
    exercises: [
      { catalogId: "C-02", sets: 2, reps: 12, weight: 60, rest: 60 },
      { catalogId: "C-01", sets: 1, reps: 10, weight: 40, rest: 60 },
    ],
  };
  const resolve = (id) => ({ name: "Ex " + id, muscle: "Peito", img: "assets/images/peito.jpg" });

  eq("chave lógica própria da sessão", P.KEYS.session, "session");
  ok("schema continua v1 (mudança aditiva)", P.SCHEMA_VERSION === 1);
  eq("sem sessão salva -> loadSession null", P.loadSession(), null);

  // ---- Round-trip de sessão ativa ----------------------------------------
  const s = WS.create(routine, T0, { resolve });
  WS.completeSet(s, { weight: 62.5, reps: 12 }, T0);
  ok("saveSession grava", P.saveSession(s) === true);
  ok("gravou na chave física do namespace", !!sb.localStorage.getItem("tt_ds_v1_session"));

  const back = P.loadSession();
  ok("loadSession devolve sessão utilizável", !!back && back.id === s.id && back.status === "active");
  ok("preserva o routineId (proteção de exclusão)", back.routineId === "rA");
  ok("preserva nome/músculo vindos do resolve", back.exercises[0].name === "Ex C-02" && back.exercises[0].muscle === "Peito");
  eq("preserva o progresso", WS.progress(back), WS.progress(s));
  eq("preserva as séries concluídas", back.exercises[0].completedSets, [{ weight: 62.5, reps: 12 }]);
  ok("startedAt volta como Date", isDateValue(back.startedAt) && back.startedAt.getTime() === T0.getTime());

  // ---- Hidratação ---------------------------------------------------------
  const target = { routines: [], history: [], session: null, lang: "pt", autoRestEnabled: true };
  const r1 = P.hydrate(target);
  ok("hydrate restaura a sessão", !!target.session && target.session.id === s.id);
  ok("hydrate registra a restauração (log)",
    r1.restored.indexOf("session(2ex, active)") !== -1, JSON.stringify(r1.restored));

  // ---- Sessão pausada ----------------------------------------------------
  const paused = WS.create(routine, T0, { resolve });
  WS.pause(paused, T5);
  P.saveSession(paused);
  const backPaused = P.loadSession();
  ok("recupera sessão pausada", backPaused.status === "paused" && backPaused.isFinished === false);
  ok("preserva pausedAt da sessão pausada",
    isDateValue(backPaused.pausedAt) && backPaused.pausedAt.getTime() === T5.getTime());
  ok("hydrate entrega a sessão pausada", P.hydrate({ session: null }).restored.length === 1);
  P.clearSession();
  const noSession = { session: "intacto" };
  const rNoSession = P.hydrate(noSession);
  ok("sem chave salva: hydrate não mexe em session",
    noSession.session === "intacto" && rNoSession.skipped.indexOf("session") !== -1);

  // ---- Dados corrompidos -------------------------------------------------
  ok("saveSession recusa sessão inválida", P.saveSession({ id: "x", exercises: [] }) === false);
  ok("saveSession recusa não-objeto", P.saveSession(null) === false && P.saveSession("x") === false);
  P.saveSession(s);
  S.save("session", { id: "x", exercises: "nope" });
  eq("loadSession de dado corrompido -> null", P.loadSession(), null);
  const corrupt = { session: "intacto" };
  const rCorrupt = P.hydrate(corrupt);
  ok("hydrate ignora sessão corrompida",
    corrupt.session === "intacto" && rCorrupt.skipped.indexOf("session") !== -1);

  // ---- clearSession: cirúrgico -------------------------------------------
  P.saveRoutines([{ id: "rA", letter: "A", name: "Peito", exercises: [] }]);
  P.saveHistory([{ id: 1, name: "Treino antigo", date: "seg, 7:00", duration: "40 min", status: "completed" }]);
  P.saveSession(s);
  ok("clearSession remove a sessão", P.clearSession() === true && P.loadSession() === null);
  ok("clearSession preserva rotinas e histórico",
    S.has("routines") && S.has("history") && !S.has("session"));

  // ---- reset(): contrato existente + sessão ------------------------------
  P.saveLang("en");
  P.savePRs([{ exerciseKey: "C-02", type: "carga", value: 60 }]);
  P.saveAutoRest(true);
  P.saveSession(s);
  ok("reset executa", P.reset() === true);
  ok("reset limpa a sessão", P.loadSession() === null && !S.has("session"));
  ok("reset limpa rotinas/histórico/PRs/autoRest",
    !S.has("routines") && !S.has("history") && !S.has("prs") && !S.has("autoRest"));
  ok("reset preserva o idioma (contrato existente)", S.load("lang") === "en");
}

// ---------------------------------------------------------------------------
// Persistence (exercícios personalizados — Sprint 5.2.1)
// ---------------------------------------------------------------------------
function testPersistenceCustomExercises() {
  const sb = makeSandbox();
  loadModules(sb, [
    "js/utils.js", "services/storage.js", "js/i18n.js",
    "js/data/exercises.js", "js/catalog.js",
    "js/custom-exercises.js", "js/persistence.js",
  ]);
  const P = sb.Persistence;
  const S = sb.StorageService;

  // Nomes deliberadamente fora do catálogo oficial: a hidratação agora
  // reaplica a unicidade global e rejeitaria "Rosca scott"/"Supino inclinado".
  const cxA = { id: "cx_a", name: "Rosca Scott Custom", muscle: "Bíceps" };
  const cxB = { id: "cx_b", name: "Supino Inclinado Custom", muscle: "Peito" };

  suite("Persistence (exercícios personalizados)");

  eq("schema continua v1", P.SCHEMA_VERSION, 1);
  eq("chave lógica própria", P.KEYS.customExercises, "customExercises");
  eq("chave física no namespace", S.key(P.KEYS.customExercises), "tt_ds_v1_customExercises");

  // Chave ausente: primeira visita/legado -> estado intacto.
  const t0 = { customExercises: ["keep"], routines: [], history: [], lang: "pt", autoRestEnabled: true };
  const r0 = P.hydrate(t0);
  eq("chave ausente preserva o estado", t0.customExercises, ["keep"]);
  ok("chave ausente registrada em skipped", r0.skipped.indexOf("customExercises") !== -1);
  eq("loadCustomExercises sem chave -> []", P.loadCustomExercises(), []);

  // Round-trip e hidratação.
  const saved = P.saveCustomExercises([cxA, cxB]);
  eq("saveCustomExercises grava sem descartes",
    [saved.ok, saved.status, saved.durable, saved.discarded, saved.normalized],
    [true, "saved", true, 0, 0]);
  eq("saveCustomExercises devolve a lista aceita", saved.stored, [cxA, cxB]);
  eq("gravou na chave física",
    JSON.parse(sb.localStorage.getItem("tt_ds_v1_customExercises")), [cxA, cxB]);
  eq("loadCustomExercises round-trip", P.loadCustomExercises(), [cxA, cxB]);

  const t1 = { customExercises: [], routines: [], history: [], lang: "pt", autoRestEnabled: true };
  const r1 = P.hydrate(t1);
  eq("hydrate restaura os exercícios personalizados", t1.customExercises, [cxA, cxB]);
  ok("hydrate registra a restauração", r1.restored.indexOf("customExercises(2)") !== -1,
    JSON.stringify(r1.restored));
  eq("hydrate sem descartes não reporta descartes", r1.discarded, []);
  eq("hydrate sem normalização não reporta normalização", r1.normalized, []);

  // Lista vazia é escolha legítima e não volta ao estado anterior.
  const emptySaved = P.saveCustomExercises([]);
  ok("saveCustomExercises aceita lista vazia",
    emptySaved.ok === true && emptySaved.status === "saved" && emptySaved.stored.length === 0);
  const t2 = { customExercises: ["keep"] };
  const r2 = P.hydrate(t2);
  eq("lista vazia salva é respeitada", t2.customExercises, []);
  ok("lista vazia restaurada com contador zero", r2.restored.indexOf("customExercises(0)") !== -1);

  // Dados legados/tolerância de aliases + sanitização pelo domínio.
  S.save("customExercises", [
    { id: "cx_1", name: "  Rosca Scott Custom  ", muscle: " Bíceps " },
    { id: "cx_2", nome: "Supino Inclinado Custom", grupoMuscular: "Peito" },
    { id: "cx_3", name: "Remada Baixa Custom", group: "Costas" },
    { id: "cx_1", name: "Duplicado por id", muscle: "Peito" },
    { id: "cx_4", name: "rosca scott custom", muscle: "Bíceps" },
    { id: "A-01", name: "Oficial", muscle: "Peito" },
    { id: "cx_5", name: "   ", muscle: "Peito" },
    { id: "cx_6", name: "Sem grupo" },
    { nome: "Sem id", grupoMuscular: "Costas" },
    "lixo",
    null,
  ]);
  const t3 = { customExercises: [] };
  const r3 = P.hydrate(t3);
  eq("sanitização mantém apenas registros válidos e únicos",
    t3.customExercises.map((e) => e.id), ["cx_1", "cx_2", "cx_3"]);
  eq("aliases legados são canonicalizados", t3.customExercises[1],
    { id: "cx_2", name: "Supino Inclinado Custom", muscle: "Peito" });
  eq("grupo alternativo é aceito", t3.customExercises[2],
    { id: "cx_3", name: "Remada Baixa Custom", muscle: "Costas" });
  eq("espaços das extremidades são removidos", t3.customExercises[0].name, "Rosca Scott Custom");
  ok("log reflete apenas os válidos", r3.restored.indexOf("customExercises(3)") !== -1);
  eq("hydrate explicita os descartes da sanitização", r3.discarded, ["customExercises(8)"]);
  eq("hydrate explicita as normalizações da sanitização", r3.normalized, ["customExercises(1)"]);

  // A-02/A-03: a hidratação reaplica grupos oficiais e unicidade global.
  S.save("customExercises", [
    { id: "cx_ok", name: "  Elevação Lateral Custom  ", muscle: " ombro " },
    { id: "cx_oficial", name: "  SUPINO   RETO  ", muscle: "Peito" },
    { id: "cx_bad_group", name: "Grupo inexistente", muscle: "Grupo Inexistente" },
    { id: "cx_dup_a", name: "Remada Curvada Custom", muscle: "Costas" },
    { id: "cx_dup_b", name: "remada   curvada custom", muscle: "Costas" },
    { id: "cx_');alert(1)//", name: "ID inseguro", muscle: "Peito" },
  ]);
  const t3b = { customExercises: [] };
  const r3b = P.hydrate(t3b);
  eq("hidratação rejeita duplicidade oficial, grupo inválido e id inseguro",
    t3b.customExercises.map((e) => e.id), ["cx_ok", "cx_dup_a"]);
  eq("hidratação canonicaliza o grupo oficial",
    [t3b.customExercises[0].name, t3b.customExercises[0].muscle],
    ["Elevação Lateral Custom", "Ombro"]);
  eq("hidratação deduplica personalizados por caixa/acentos/espaços",
    t3b.customExercises[1].name, "Remada Curvada Custom");
  ok("log reflete apenas os válidos na hidratação estrita",
    r3b.restored.indexOf("customExercises(2)") !== -1);
  eq("hidratação estrita reporta descartes", r3b.discarded, ["customExercises(4)"]);
  eq("hidratação estrita reporta normalização", r3b.normalized, ["customExercises(1)"]);

  // Nome acima do limite é truncado pelo domínio, não inventado.
  S.save("customExercises", [{ id: "cx_long", name: "x".repeat(70), muscle: "Peito" }]);
  const t4 = { customExercises: [] };
  P.hydrate(t4);
  eq("nome longo é truncado em 60", t4.customExercises[0].name.length, 60);

  // Lixo total em formato de array -> lista vazia válida (chave presente).
  S.save("customExercises", ["lixo", null, { id: "A-01", name: "Oficial", muscle: "Peito" }]);
  const t5 = { customExercises: ["keep"] };
  P.hydrate(t5);
  eq("array sem registros válidos hidrata como lista vazia", t5.customExercises, []);

  // Payload que não é array -> chave ignorada, estado preservado.
  S.save("customExercises", { nao: "array" });
  const t6 = { customExercises: ["keep"] };
  const r6 = P.hydrate(t6);
  eq("payload não-array é ignorado", t6.customExercises, ["keep"]);
  ok("payload não-array registrado em skipped", r6.skipped.indexOf("customExercises") !== -1);
  eq("loadCustomExercises de payload inválido -> []", P.loadCustomExercises(), []);

  // JSON corrompido -> a chave existe, mas o conteúdo não é confiável.
  sb.localStorage.setItem("tt_ds_v1_customExercises", "{isso nao e json");
  const t7 = { customExercises: ["keep"] };
  const r7 = P.hydrate(t7);
  eq("JSON corrompido preserva o estado", t7.customExercises, ["keep"]);
  ok("JSON corrompido registrado em skipped", r7.skipped.indexOf("customExercises") !== -1);
  eq("loadCustomExercises de JSON corrompido -> []", P.loadCustomExercises(), []);

  // saveCustomExercises valida antes de gravar e não grava lixo.
  S.save("customExercises", [cxA]);
  const invalidPayload = P.saveCustomExercises(null);
  eq("saveCustomExercises recusa não-array com contrato explícito",
    [invalidPayload.ok, invalidPayload.status, invalidPayload.stored, invalidPayload.durable],
    [false, "validation-error", null, false]);
  eq("payload inválido não sobrescreve o storage", P.loadCustomExercises(), [cxA]);
  const invalidObject = P.saveCustomExercises({ id: "cx_x" });
  eq("saveCustomExercises recusa objeto", invalidObject.status, "validation-error");
  eq("objeto inválido não sobrescreve o storage", P.loadCustomExercises(), [cxA]);

  const partial = P.saveCustomExercises([
    cxA, { id: "A-01", name: "Oficial", muscle: "Peito" }, null,
  ]);
  eq("saveCustomExercises explicita descarte parcial",
    [partial.ok, partial.status, partial.durable, partial.discarded, partial.normalized],
    [false, "normalized", true, 2, 0]);
  eq("somente a lista aceita é devolvida", partial.stored, [cxA]);
  eq("apenas registros válidos foram gravados", P.loadCustomExercises(), [cxA]);

  const invalidRecords = P.saveCustomExercises([
    cxA,
    { id: "cx_of", name: "  SUPINO   RETO  ", muscle: "Peito" },
    { id: "cx_bad", name: "Grupo inexistente", muscle: "Grupo Inexistente" },
  ]);
  eq("saveCustomExercises mantém os válidos e relata os demais",
    [invalidRecords.status, invalidRecords.discarded, invalidRecords.stored],
    ["normalized", 2, [cxA]]);
  eq("apenas o personalizado válido permanece", P.loadCustomExercises(), [cxA]);

  const normalized = P.saveCustomExercises([
    { id: "cx_norm", name: "  Rosca Teste  ", muscle: " bíceps " },
  ]);
  eq("normalização sem descarte é distinguida",
    [normalized.ok, normalized.status, normalized.durable, normalized.discarded, normalized.normalized],
    [false, "normalized", true, 0, 1]);
  eq("lista normalizada é a aceita pelo storage",
    P.loadCustomExercises(), [{ id: "cx_norm", name: "Rosca Teste", muscle: "Bíceps" }]);

  // Nenhum registro válido em um array com conteúdo não pode apagar o que já
  // estava persistido: falha de validação, sem update destrutivo.
  S.save("customExercises", [cxA]);
  const allInvalid = P.saveCustomExercises([
    { id: "A-01", name: "Oficial", muscle: "Peito" }, null, "lixo",
  ]);
  eq("array só com registros inválidos é falha de validação",
    [allInvalid.ok, allInvalid.status, allInvalid.stored, allInvalid.discarded],
    [false, "validation-error", null, 3]);
  eq("registros válidos existentes são preservados", P.loadCustomExercises(), [cxA]);

  // saveAll inclui a chave; reset limpa sem tocar no idioma.
  const allState = {
    routines: [], prs: [], history: [], customExercises: [cxB], lang: "pt", autoRestEnabled: true,
  };
  const allSaved = P.saveAll(allState);
  eq("saveAll bem-sucedido devolve contrato completo",
    [allSaved.ok, allSaved.status, allSaved.durable, allSaved.attempted],
    [true, "saved", true, 6]);
  eq("saveAll lista as chaves duráveis",
    allSaved.saved, ["routines", "customExercises", "history", "prs", "lang", "autoRest"]);
  eq("saveAll não lista falhas", [allSaved.normalized, allSaved.failed, allSaved.memory], [[], [], []]);
  ok("saveAll grava customExercises", S.has(P.KEYS.customExercises));
  eq("saveAll conteúdo persistido", P.loadCustomExercises(), [cxB]);
  ok("saveLang antes do reset", P.saveLang("en") === true);
  ok("reset executa", P.reset() === true);
  ok("reset limpa customExercises", !S.has(P.KEYS.customExercises) && P.loadCustomExercises().length === 0);
  eq("reset preserva o idioma", S.load("lang"), "en");

  // Falha de gravação com storage ativo: false, sem lançar.
  const sbQuota = makeSandbox();
  const setItemOriginal = sbQuota.localStorage.setItem.bind(sbQuota.localStorage);
  sbQuota.localStorage.setItem = (k, v) => {
    if (String(v).length > 10) throw new Error("QuotaExceededError");
    return setItemOriginal(k, v);
  };
  loadModules(sbQuota, [
    "js/utils.js", "services/storage.js", "js/i18n.js",
    "js/data/exercises.js", "js/catalog.js",
    "js/custom-exercises.js", "js/persistence.js",
  ]);
  const Pq = sbQuota.Persistence;
  ok("storage ativo com falha simulada", Pq.isEnabled() === true);
  const quota = Pq.saveCustomExercises([cxA]);
  eq("falha de gravação é storage-error, não sucesso",
    [quota.ok, quota.status, quota.durable, quota.stored],
    [false, "storage-error", false, null]);
  eq("falha de gravação não cria cópia divergente na memória", Pq.loadCustomExercises(), []);

  // Storage indisponível: modo memória, sem lançar e com leitura funcional.
  const sbMem = makeSandbox();
  delete sbMem.localStorage;
  loadModules(sbMem, [
    "js/utils.js", "services/storage.js", "js/i18n.js",
    "js/data/exercises.js", "js/catalog.js",
    "js/custom-exercises.js", "js/persistence.js",
  ]);
  const Pm = sbMem.Persistence;
  ok("modo memória: isEnabled false", Pm.isEnabled() === false);
  const memory = Pm.saveCustomExercises([cxA]);
  eq("modo memória é explícito e não durável",
    [memory.ok, memory.status, memory.durable, memory.stored],
    [false, "memory", false, [cxA]]);
  eq("modo memória: leitura continua funcionando", Pm.loadCustomExercises(), [cxA]);
  const tm = { customExercises: [] };
  Pm.hydrate(tm);
  eq("modo memória: hydrate restaura da memória", tm.customExercises, [cxA]);

  // Sem o módulo de domínio, a Persistence degrada com segurança.
  const sbNoCx = makeSandbox();
  loadModules(sbNoCx, ["js/utils.js", "services/storage.js", "js/i18n.js", "js/persistence.js"]);
  const Pn = sbNoCx.Persistence;
  const Sn = sbNoCx.StorageService;
  const noDomain = Pn.saveCustomExercises([cxA]);
  eq("sem CustomExercises: saveCustomExercises recusa com contrato explícito",
    [noDomain.ok, noDomain.status, noDomain.reason], [false, "validation-error", "unavailable"]);
  Sn.save("customExercises", [cxA]);
  const tn = { customExercises: ["keep"] };
  const rn = Pn.hydrate(tn);
  eq("sem CustomExercises: hydrate preserva o estado", tn.customExercises, ["keep"]);
  ok("sem CustomExercises: chave registrada em skipped",
    rn.skipped.indexOf("customExercises") !== -1);
  eq("sem CustomExercises: load devolve []", Pn.loadCustomExercises(), []);

  // Sem catálogo oficial carregado, a sanitização falha fechada e não aceita
  // dados sem validar grupos/nomes. A ordem real da aplicação carrega o
  // catálogo antes da Persistence; este teste protege a degradação segura.
  const sbNoCatalog = makeSandbox();
  loadModules(sbNoCatalog, [
    "js/utils.js", "services/storage.js", "js/i18n.js",
    "js/custom-exercises.js", "js/persistence.js",
  ]);
  const Pc = sbNoCatalog.Persistence;
  const Sc = sbNoCatalog.StorageService;
  Sc.save("customExercises", [cxA]);
  const noCatalog = Pc.saveCustomExercises([cxA]);
  eq("sem catálogo: saveCustomExercises recusa com contrato explícito",
    [noCatalog.ok, noCatalog.status, noCatalog.reason],
    [false, "validation-error", "unavailable"]);
  const tc = { customExercises: ["keep"] };
  const rc = Pc.hydrate(tc);
  eq("sem catálogo: hydrate preserva o estado", tc.customExercises, ["keep"]);
  ok("sem catálogo: chave registrada em skipped",
    rc.skipped.indexOf("customExercises") !== -1);
}

// ---------------------------------------------------------------------------
// Persistence.saveAll — contrato de resultado (A-06)
// ---------------------------------------------------------------------------
function testPersistenceSaveAll() {
  const modules = [
    "js/utils.js", "services/storage.js", "js/i18n.js",
    "js/data/exercises.js", "js/catalog.js",
    "js/custom-exercises.js", "js/workout-session.js", "js/persistence.js",
  ];
  const make = () => {
    const sb = makeSandbox();
    loadModules(sb, modules);
    return sb;
  };
  const cx = { id: "cx_save_all", name: "Rosca Save All", muscle: "Bíceps" };
  const target = {
    routines: [], prs: [], history: [], customExercises: [cx], lang: "pt", autoRestEnabled: true,
  };
  const countersCoherent = (r) =>
    r.attempted === r.saved.length + r.normalized.length + r.failed.length + r.memory.length;

  suite("Persistence (saveAll A-06)");

  const sbOk = make();
  const allOk = sbOk.Persistence.saveAll(target);
  eq("saveAll: todas as gravações duráveis",
    [allOk.ok, allOk.status, allOk.durable, allOk.attempted],
    [true, "saved", true, 6]);
  eq("saveAll: nenhuma falha quando tudo grava",
    [allOk.normalized, allOk.failed, allOk.memory], [[], [], []]);
  eq("saveAll: lista as chaves duráveis, incluindo prs",
    allOk.saved, ["routines", "customExercises", "history", "prs", "lang", "autoRest"]);
  ok("saveAll: contadores coerentes no sucesso", countersCoherent(allOk));
  ok("saveAll: session ausente não é tentada", !("session" in allOk.results));

  const invalid = sbOk.Persistence.saveAll(null);
  eq("saveAll: alvo inválido é falha de validação",
    [invalid.ok, invalid.status, invalid.attempted, invalid.durable],
    [false, "validation-error", 0, false]);

  // Backend ativo, mas todas as gravações reais falham (quota/erro no setItem).
  const sbFail = makeSandbox();
  const failSetItem = sbFail.localStorage.setItem.bind(sbFail.localStorage);
  sbFail.localStorage.setItem = (key, value) => {
    if (key === "tt_ds_v1___probe__") return failSetItem(key, value);
    throw new Error("QuotaExceededError");
  };
  loadModules(sbFail, modules);
  const Pf = sbFail.Persistence;
  ok("saveAll: storage ativo com falha simulada", Pf.isEnabled() === true);
  const allFailed = Pf.saveAll(target);
  eq("saveAll: falha total não é sucesso",
    [allFailed.ok, allFailed.status, allFailed.durable, allFailed.attempted],
    [false, "failed", false, 6]);
  eq("saveAll: falha total lista todas as chaves", allFailed.failed.length, 6);
  eq("saveAll: customExercises relata storage-error",
    [allFailed.results.customExercises.status, allFailed.results.customExercises.ok],
    ["storage-error", false]);
  ok("saveAll: contadores coerentes na falha total", countersCoherent(allFailed));
  eq("saveAll: falha total não cria cópia em memória",
    [sbFail.StorageService.has("routines"), sbFail.StorageService.load("routines", null)],
    [false, null]);

  // Falha apenas em routines: deve ser parcial, nunca sucesso.
  const sbPartial = makeSandbox();
  const partialSetItem = sbPartial.localStorage.setItem.bind(sbPartial.localStorage);
  sbPartial.localStorage.setItem = (key, value) => {
    if (key === "tt_ds_v1_routines") throw new Error("QuotaExceededError");
    return partialSetItem(key, value);
  };
  loadModules(sbPartial, modules);
  const Pp = sbPartial.Persistence;
  const partial = Pp.saveAll(target);
  eq("saveAll: falha parcial é explicitada",
    [partial.ok, partial.status, partial.durable, partial.failed],
    [false, "partial", false, ["routines"]]);
  eq("saveAll: as demais chaves continuam duráveis",
    partial.saved, ["customExercises", "history", "prs", "lang", "autoRest"]);
  eq("saveAll: rotina com falha de quota relata storage-error",
    partial.results.routines.status, "storage-error");
  eq("saveAll: falha de quota não deixa cópia em memória",
    [sbPartial.StorageService.has("routines"), sbPartial.StorageService.load("routines", null)],
    [false, null]);
  ok("saveAll: contadores coerentes na falha parcial", countersCoherent(partial));

  // Modo memória: nenhuma gravação é durável.
  const sbMemory = makeSandbox();
  delete sbMemory.localStorage;
  loadModules(sbMemory, modules);
  const Pm = sbMemory.Persistence;
  const memory = Pm.saveAll(target);
  eq("saveAll: modo memória não é sucesso durável",
    [memory.ok, memory.status, memory.durable, memory.saved],
    [false, "memory", false, []]);
  eq("saveAll: modo memória lista as chaves em memória",
    memory.memory, ["routines", "customExercises", "history", "prs", "lang", "autoRest"]);
  eq("saveAll: customExercises em modo memória",
    memory.results.customExercises.status, "memory");
  ok("saveAll: contadores coerentes no modo memória", countersCoherent(memory));

  // Normalização/descarte em customExercises não pode virar "saved".
  const sbNormalized = make();
  const normalized = sbNormalized.Persistence.saveAll({
    routines: [], prs: [], history: [], customExercises: [cx, null], lang: "pt", autoRestEnabled: true,
  });
  eq("saveAll: descarte/normalização é distinguido de sucesso",
    [normalized.ok, normalized.status, normalized.durable],
    [false, "normalized", true]);
  eq("saveAll: chave normalizada é listada",
    normalized.normalized, ["customExercises"]);
  eq("saveAll: as demais chaves continuam salvas",
    normalized.saved, ["routines", "history", "prs", "lang", "autoRest"]);
  ok("saveAll: contadores coerentes na normalização", countersCoherent(normalized));

  // A-06/A: exercício inválido em rotina não pode ser reportado como "saved".
  const sbRoutineDrop = make();
  const routineDrop = sbRoutineDrop.Persistence.saveAll({
    routines: [{
      id: "rA", letter: "A", name: "Peito",
      exercises: [
        { catalogId: "ex1", sets: 3, reps: 10, weight: 10, rest: 60 },
        { sets: 4, reps: 8 },
      ],
    }],
    prs: [], history: [], customExercises: [], lang: "pt", autoRestEnabled: true,
  });
  eq("saveAll: rotina com exercício descartado não é sucesso integral",
    [routineDrop.ok, routineDrop.status, routineDrop.durable],
    [false, "normalized", true]);
  ok("saveAll: rotina normalizada é listada", routineDrop.normalized.indexOf("routines") !== -1);
  eq("saveAll: contador de descartes da rotina",
    routineDrop.results.routines.discarded, 1);
  eq("saveAll: rotina gravada mantém apenas o exercício válido",
    sbRoutineDrop.StorageService.load("routines", null)[0].exercises.length, 1);
  ok("saveAll: contadores coerentes no descarte de rotina", countersCoherent(routineDrop));

  // A-06/A: normalização de campos (defaults/coerção) também é distinguida.
  const sbRoutineNorm = make();
  const routineNorm = sbRoutineNorm.Persistence.saveAll({
    routines: [{
      id: "rA", letter: "A", name: "Peito",
      exercises: [{ catalogId: "ex1", sets: 3, reps: 10 }],
    }],
    prs: [], history: [], customExercises: [], lang: "pt", autoRestEnabled: true,
  });
  eq("saveAll: rotina normalizada (defaults) não é sucesso integral",
    [routineNorm.ok, routineNorm.status], [false, "normalized"]);
  ok("saveAll: normalização da rotina é contabilizada",
    routineNorm.results.routines.normalized >= 1);

  // A-06/B: locale inválido em modo memória não pode aparecer como memória.
  const sbLangMemory = makeSandbox();
  delete sbLangMemory.localStorage;
  loadModules(sbLangMemory, modules);
  const langMemory = sbLangMemory.Persistence.saveAll({
    routines: [], prs: [], history: [], customExercises: [],
    lang: "klingon", autoRestEnabled: true,
  });
  eq("saveAll: locale inválido em memória não é contabilizado como memória",
    langMemory.memory.indexOf("lang"), -1);
  ok("saveAll: locale inválido é falha explícita",
    langMemory.failed.indexOf("lang") !== -1);
  eq("saveAll: locale inválido mantém o status de validação",
    langMemory.results.lang.status, "validation-error");
  eq("saveAll: status agregado com falha em memória",
    [langMemory.ok, langMemory.status, langMemory.durable], [false, "partial", false]);
  ok("saveAll: contadores coerentes com locale inválido", countersCoherent(langMemory));

  // A-06/D: prs e session pertencem ao contrato e são gravados de fato.
  const sbKeys = make();
  const session = sbKeys.WorkoutSession.create({
    id: "rA", letter: "A", name: "Peito",
    exercises: [{ catalogId: "ex1", sets: 3, reps: 10, weight: 10, rest: 60 }],
  });
  const withKeys = sbKeys.Persistence.saveAll({
    routines: [], prs: [{
      id: "ex1_carga", exerciseKey: "ex1", exerciseName: "Supino", type: "carga",
      value: 100, oldValue: 90, diff: 10, workoutId: 1,
      workoutDate: "2026-10-23", createdAt: "2026-10-23T00:00:00.000Z",
    }],
    history: [], customExercises: [], lang: "pt", autoRestEnabled: true, session,
  });
  eq("saveAll: inclui prs e session no total tentado",
    [withKeys.attempted, withKeys.status], [7, "saved"]);
  ok("saveAll: prs e session são duráveis",
    withKeys.saved.indexOf("prs") !== -1 && withKeys.saved.indexOf("session") !== -1);
  eq("saveAll: sessão é gravada na chave própria",
    !!sbKeys.StorageService.load("session", null), true);
  eq("saveAll: PR é gravado na chave própria",
    sbKeys.StorageService.load("prs", null).length, 1);
  ok("saveAll: contadores coerentes com prs e session", countersCoherent(withKeys));

  // Sem StorageService não há gravação nem fallback: estado explícito.
  const sbNoStorage = makeSandbox();
  loadModules(sbNoStorage, [
    "js/utils.js", "js/i18n.js", "js/data/exercises.js", "js/catalog.js",
    "js/custom-exercises.js", "js/persistence.js",
  ]);
  const Pns = sbNoStorage.Persistence;
  const noStorage = Pns.saveAll(target);
  eq("saveAll: sem StorageService é unavailable",
    [noStorage.ok, noStorage.status, noStorage.durable, noStorage.attempted, noStorage.reason],
    [false, "unavailable", false, 0, "unavailable"]);
  const noStorageCustom = Pns.saveCustomExercises([cx]);
  eq("saveCustomExercises: sem StorageService é unavailable",
    [noStorageCustom.ok, noStorageCustom.status, noStorageCustom.reason],
    [false, "unavailable", "unavailable"]);
}

// ---------------------------------------------------------------------------
// WorkoutController — integração sessão + persistência + histórico (E2)
// ---------------------------------------------------------------------------
function testWorkoutController() {
  const sb = makeSandbox();
  loadModules(sb, [
    "js/utils.js", "services/storage.js", "js/i18n.js",
    "js/workout-session.js", "js/rest-timer.js", "js/persistence.js", "js/pr.js", "js/workout-controller.js",
  ]);
  const C = sb.WorkoutController;
  const P = sb.Persistence;
  const WS = sb.WorkoutSession;
  const PR = sb.PR;

  suite("WorkoutController (integração)");

  const T0 = new Date("2026-10-18T10:00:00.000Z");
  const T5 = new Date("2026-10-18T10:05:00.000Z");
  const T15 = new Date("2026-10-18T10:15:00.000Z");
  const T30 = new Date("2026-10-18T10:30:00.000Z");
  const routine = {
    id: "rA", letter: "A", name: "Peito e tríceps",
    exercises: [
      { catalogId: "C-02", sets: 2, reps: 12, weight: 60, rest: 60 },
      { catalogId: "C-01", sets: 1, reps: 10, weight: 40, rest: 60 },
    ],
  };
  const resolve = (id) => ({ name: "Ex " + id, muscle: "Peito", img: "assets/images/peito.jpg" });

  ok("expõe WorkoutController", !!C);
  ok("module.exports expõe a mesma API",
    typeof require(path.join(ROOT, "js", "workout-controller.js")).start === "function");

  // ---- start --------------------------------------------------------------
  const started = C.start(routine, resolve, T0);
  ok("start cria a sessão", started.ok === true && !!started.session && started.session.status === "active");
  ok("start persiste de imediato", started.persisted === true && !!P.loadSession());
  ok("start usa resolve (nome/músculo/imagem)",
    started.session.exercises[0].name === "Ex C-02" && started.session.exercises[0].img === "assets/images/peito.jpg");
  const bad = C.start(null, resolve, T0);
  ok("start sem rotina -> recusa com mensagem",
    bad.ok === false && bad.reason === "invalid-routine" && bad.message.length > 0 && bad.session === null);
  const storageBeforeEmptyStart = sb.localStorage.getItem("tt_ds_v1_session");
  const empty = C.start({ id: "rV", letter: "V", name: "Vazia", exercises: [] }, resolve, T0);
  ok("start de rotina vazia é bloqueado com feedback e não persiste sessão",
    empty.ok === false && empty.reason === "empty-routine" && /Adicione pelo menos um exercício/i.test(empty.message) &&
      empty.session === null && sb.localStorage.getItem("tt_ds_v1_session") === storageBeforeEmptyStart);

  const s = started.session;

  // ---- completeSet -------------------------------------------------------
  const c1 = C.completeSet(s, { weight: 60, reps: 12 }, T0);
  ok("completeSet ok + progresso", c1.ok === true && c1.isFinished === false && c1.progress.completedSets === 1);
  ok("cada série é persistida", P.loadSession().exercises[0].setsCompleted === 1);

  const badSet = C.completeSet(s, { weight: "abc", reps: 5 }, T0);
  ok("carga inválida -> recusa clara",
    badSet.ok === false && badSet.reason === "invalid-set" && badSet.message.length > 0);
  ok("reps < 1 -> recusa", C.completeSet(s, { weight: 10, reps: 0 }, T0).reason === "invalid-set");
  ok("recusa não altera nem persiste", s.exercises[0].setsCompleted === 1 && P.loadSession().exercises[0].setsCompleted === 1);

  // ---- navegação ---------------------------------------------------------
  ok("prev no primeiro -> at-start", C.prev(s).reason === "at-start");
  ok("next avança e persiste", C.next(s).ok === true && P.loadSession().currentExerciseIndex === 1);
  ok("next no último -> at-end", C.next(s).reason === "at-end");
  ok("prev volta", C.prev(s).ok === true && s.currentExerciseIndex === 0);

  // ---- pausa / retomada --------------------------------------------------
  ok("pause grava o estado pausado", C.pause(s, T5).ok === true && P.loadSession().status === "paused");
  const restoredPaused = P.loadSession();
  ok("sessão pausada recuperada íntegra",
    restoredPaused.status === "paused" && isDateValue(restoredPaused.pausedAt) && restoredPaused.exercises[0].setsCompleted === 1);
  ok("completeSet em sessão pausada -> not-active",
    C.completeSet(s, { weight: 10, reps: 10 }, T5).reason === "not-active");
  ok("resume volta a ativa e acumula a pausa",
    C.resume(s, T15).ok === true && P.loadSession().status === "active" && P.loadSession().pausedMs === 10 * 60000);
  eq("duração desconta a pausa", C.elapsedMs(s, T15), 5 * 60000);

  // ---- discriminação de recusas na sessão finalizada ---------------------
  const fin = C.finish(s, T30);
  ok("finish encerra a sessão", fin.ok === true && s.status === "finished" && s.isFinished === true);
  ok("finish limpa a persistência", P.loadSession() === null);
  ok("finish é idempotente",
    C.finish(s, new Date("2026-10-18T11:00:00.000Z")).ok === true &&
      s.finishedAt.getTime() === T30.getTime() && P.loadSession() === null);
  ok("completeSet/pause/resume após finalizar -> not-active",
    C.completeSet(s, { weight: 1, reps: 1 }).reason === "not-active" &&
      C.pause(s).reason === "not-active" && C.resume(s).reason === "not-active");
  ok("next/prev após finalizar -> not-active", C.next(s).reason === "not-active" && C.prev(s).reason === "not-active");
  ok("sem sessão -> no-session",
    C.completeSet(null).reason === "no-session" && C.save(null).reason === "no-session" &&
      C.finish(null).reason === "no-session" && C.next(null).reason === "no-session");

  // ---- descarte ----------------------------------------------------------
  const d = C.start(routine, resolve, T0).session;
  ok("clear descarta a sessão persistida", C.clear().ok === true && P.loadSession() === null);
  ok("sessão descartada segue utilizável em memória (progresso intacto)",
    d.status === "active" && WS.progress(d).percent === 0);

  // ---- histórico: identidade estável + idempotência ----------------------
  const h0 = C.start(routine, resolve, T0).session;
  C.completeSet(h0, { weight: 60, reps: 12 }, T0);
  C.completeSet(h0, { weight: 62.5, reps: 10 }, T0);
  C.pause(h0, T5);
  C.resume(h0, T15);
  C.completeSet(h0, { weight: 40, reps: 10 }, T30);
  ok("fluxo real conclui a sessão", h0.status === "finished" && WS.progress(h0).percent === 100);
  ok("sessão concluída continua recuperável até confirmar o histórico",
    P.loadSession() !== null && P.loadSession().status === "finished");

  const entry = C.buildHistoryEntry(h0, "completed", T30);
  ok("entrada guarda a identidade ESTÁVEL da execução em sessionId",
    entry.sessionId === h0.id);
  ok("id da entrada continua NUMÉRICO (contrato legado preservado)",
    typeof entry.id === "number" && entry.id > 0);
  ok("entrada mantém o formato do histórico atual",
    entry.name === "Treino A — Peito e tríceps" && entry.routineId === "rA" && entry.letter === "A" &&
      entry.status === "completed" && /^\d{4}-\d{2}-\d{2}$/.test(entry.dateISO));
  ok("entrada guarda as séries efetivamente concluídas",
    entry.exercises.length === 2 && entry.exercises[0].sets.length === 2 &&
      entry.exercises[0].sets[1].weight === 62.5 && entry.exercises[1].sets.length === 1);
  eq("duração usa elapsedMs (30min - 10min de pausa)", entry.durationMin, 20);
  eq("duração formatada", entry.duration, "20 min");
  ok("sessão sem séries e status partial não gera entrada",
    C.buildHistoryEntry(WS.create(routine, T0, { resolve: resolve }), "partial", T0) === null);
  ok("status inválido não gera entrada", C.buildHistoryEntry(h0, "x", T30) === null);

  // Simula exatamente o fluxo da UI: controlador -> PR -> Persistence.
  function saveToHistory(history, session, status, now) {
    const res = C.appendToHistory(history, session, status, now);
    if (!res.ok) return res;
    const newPRs = PR.checkNewPR(res.entry, res.history);
    if (newPRs.length > 0) res.entry.prs = newPRs.map((p) => ({ type: p.type, value: p.value }));
    P.saveHistory(res.history);
    return res;
  }

  let history = [];
  const first = saveToHistory(history, h0, "completed", T30);
  history = first.history;
  ok("grava no histórico com a identidade da execução",
    first.ok === true && history.length === 1 && history[0].sessionId === h0.id);
  ok("dedupe não depende de id numérico (usa sessionId)",
    C.hasHistoryEntry([{ id: 123, sessionId: h0.id }], h0) === true);
  ok("entrada legada (sem sessionId) não é confundida com a execução",
    C.hasHistoryEntry([{ id: 123, name: "Antigo" }], h0) === false);
  const prsAfterFirst = P.loadPRs().length;
  ok("motor de PRs registra os critérios por exercício", prsAfterFirst === 12, String(prsAfterFirst));
  ok("cada exercício rende os 6 critérios",
    P.loadPRs().filter((p) => p.exerciseKey === "C-02").length === 6 &&
      P.loadPRs().filter((p) => p.exerciseKey === "C-01").length === 6);
  ok("workoutId do PR continua sendo o id NUMÉRICO da entrada (contrato do motor)",
    P.loadPRs().every((p) => p.workoutId === first.entry.id && typeof p.workoutId === "number"));

  // Finalização repetida na MESMA execução.
  const again = saveToHistory(history, h0, "completed", T30);
  ok("finalização repetida não duplica histórico",
    again.ok === false && again.reason === "duplicate-history" && history.length === 1);
  ok("finalização repetida não duplica PRs", P.loadPRs().length === prsAfterFirst);

  // Simula RECARGA: hidrata do disco e reprocessa.
  const reloadTarget = { routines: [], history: [], session: null, lang: "pt", autoRestEnabled: true };
  P.hydrate(reloadTarget);
  ok("RELOAD: histórico restaurado com a identidade da execução",
    reloadTarget.history.length === 1 && reloadTarget.history[0].sessionId === h0.id);
  ok("RELOAD: id numérico e sessionId sobrevivem ao round-trip",
    typeof reloadTarget.history[0].id === "number" && reloadTarget.history[0].sessionId === h0.id);
  ok("RELOAD: sessão recuperada com a mesma identidade",
    !!reloadTarget.session && reloadTarget.session.id === h0.id);
  const prsBeforeReload = P.loadPRs().length;
  ok("RELOAD: reprocessar o PR não duplica recordes",
    PR.checkNewPR(reloadTarget.history[0], reloadTarget.history).length === 0 &&
      P.loadPRs().length === prsBeforeReload);
  const afterReload = C.appendToHistory(reloadTarget.history, reloadTarget.session, "completed", T30);
  ok("RELOAD: não entra duas vezes no histórico",
    afterReload.ok === false && afterReload.reason === "duplicate-history" &&
      afterReload.duplicated === true && afterReload.history.length === 1);

  // ---- descartar/finalizar não destroem o resto ---------------------------
  const routinesBefore = [
    { id: "rZ", letter: "Z", name: "Custom", exercises: [{ catalogId: "ex1", sets: 5, reps: 8, weight: 12.5, rest: 90 }] },
  ];
  P.saveRoutines(routinesBefore);
  const historyBefore = P.loadPRs().length;
  const alive = C.start(routine, resolve, T0).session;
  C.clear();
  const t = { routines: null, history: null, session: null, lang: "pt", autoRestEnabled: true };
  P.hydrate(t);
  ok("descartar preserva rotinas (inclusive exercício personalizado)",
    t.routines.length === 1 && t.routines[0].exercises[0].catalogId === "ex1" && t.routines[0].exercises[0].weight === 12.5);
  ok("descartar preserva histórico", Array.isArray(t.history) && t.history.length === 1 && t.history[0].sessionId === h0.id);
  ok("descartar preserva PRs", P.loadPRs().length === historyBefore);
  ok("descartar remove só a sessão", t.session === null && alive.status === "active");

  // ---- sessão com exercício personalizado (sem catalogId no catálogo) -----
  const custom = C.start({
    id: "rZ", letter: "Z", name: "Custom",
    exercises: [{ catalogId: "ex1", name: "Exercício custom", sets: 2, reps: 8, weight: 12.5, rest: 60 }],
  }, null, T0).session;
  ok("sessão de exercício personalizado preserva o nome",
    custom.exercises[0].name === "Exercício custom" && custom.exercises[0].catalogId === "ex1");
  ok("exercício personalizado sobrevive ao round-trip",
    P.loadSession().exercises[0].name === "Exercício custom" && P.loadSession().exercises[0].weight === 12.5);

  // ---- regressão do consumidor legado de `id` -----------------------------
  // js/pr.js (weeklyStreak) faz `new Date(h.id)` quando a entrada NÃO tem
  // dateISO. Como o id da entrada continua numérico, esse caminho segue vivo.
  const legacyEntry = {
    id: Date.now(), name: "Treino legado (sem dateISO)", date: "x", duration: "10 min",
    status: "completed",
    exercises: [{ catalogId: "C-99", name: "Exercício legado", muscle: "Peito", sets: [{ weight: 80, reps: 10 }] }],
  };
  const legacyPRs = PR.checkNewPR(legacyEntry, [legacyEntry]);
  ok("consumidor legado (weeklyStreak via id numérico) continua funcionando",
    legacyPRs.some((p) => p.type === "weeklyStreak" && p.value === 1),
    JSON.stringify(legacyPRs.map((p) => p.type)));
}

// ---------------------------------------------------------------------------
// RestTimer — domínio puro do descanso (E3)
// ---------------------------------------------------------------------------
function testRestTimer() {
  const sb = makeSandbox();
  loadModules(sb, ["js/rest-timer.js"]);
  const R = sb.RestTimer;

  suite("RestTimer (domínio do descanso)");

  const BASE = Date.parse("2026-10-18T10:00:00.000Z");
  const at = (offsetMs) => new Date(BASE + offsetMs);
  const SEC = 1000;
  const MIN = 60000;

  ok("expõe RestTimer", !!R);
  ok("module.exports expõe a mesma API",
    typeof require(path.join(ROOT, "js", "rest-timer.js")).create === "function");
  eq("STATUS canônico", R.STATUS, ["running", "paused", "finished"]);

  // ---- isolamento (regras 6, 7 e 8) ---------------------------------------
  const src = fs.readFileSync(path.join(ROOT, "js", "rest-timer.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok("não cria timers (sem setInterval/setTimeout/rAF)",
    !/setInterval|setTimeout|requestAnimationFrame|clearInterval|clearTimeout/.test(code));
  ok("não acessa DOM nem global de janela",
    !/\bdocument\b|\bwindow\b/.test(code));
  ok("não acessa storage, Persistence, EventBus nem StorageService",
    !/\blocalStorage\b|\bsessionStorage\b|\bPersistence\b|\bEventBus\b|\bStorageService\b/.test(code));

  // ---- create -------------------------------------------------------------
  const t = R.create(60, "s_1", at(0));
  ok("create fabrica um descanso correndo",
    !!t && t.status === "running" && t.durationMs === 60 * SEC && t.sessionId === "s_1");
  ok("create grava o prazo absoluto (endsAt) e não guarda remainingMs",
    isDateValue(t.endsAt) && t.endsAt.getTime() === BASE + 60 * SEC && t.remainingMs === null);
  ok("create sem duração válida -> null",
    R.create(0, "s_1", at(0)) === null && R.create(-5, "s_1", at(0)) === null &&
      R.create("abc", "s_1", at(0)) === null && R.create(null, "s_1", at(0)) === null);
  ok("create aceita duração como string numérica", (R.create("90", "s_1", at(0)) || {}).durationMs === 90 * SEC);
  ok("create sem sessionId devolve vínculo nulo (não inventa identidade)",
    R.create(60, "   ", at(0)).sessionId === null && R.create(60, null, at(0)).sessionId === null);

  // ---- snapshot: início e avanço de tempo ---------------------------------
  const snap0 = R.snapshot(t, at(0));
  ok("snapshot inicial: restante = duração, progresso 0",
    snap0.remainingMs === 60 * SEC && snap0.elapsedMs === 0 && snap0.progress === 0 && snap0.finished === false);
  const snap30 = R.snapshot(t, at(30 * SEC));
  ok("snapshot a 30s: restante e progresso corretos",
    snap30.remainingMs === 30 * SEC && snap30.elapsedMs === 30 * SEC && snap30.progress === 0.5 && snap30.finished === false);
  ok("snapshot não muta o timer (leitura pura)",
    t.status === "running" && t.remainingMs === null && t.endsAt.getTime() === BASE + 60 * SEC);

  // ---- expiração: no limite e depois --------------------------------------
  const snapEnd = R.snapshot(t, at(60 * SEC));
  ok("no limite de endsAt: restante 0, progresso 1, finished",
    snapEnd.remainingMs === 0 && snapEnd.progress === 1 && snapEnd.finished === true && snapEnd.status === "running");
  const snapLate = R.snapshot(t, at(60 * SEC + 1));
  ok("após o prazo: restante não fica negativo", snapLate.remainingMs === 0 && snapLate.finished === true);

  // ---- suspensão prolongada da aba ---------------------------------------
  const susp = R.create(30, "s_1", at(0));
  const snapSusp = R.snapshot(susp, at(10 * MIN));
  ok("SUSPENSÃO: 10 min com 30 s restantes encerra (não devolve 30 s)",
    snapSusp.remainingMs === 0 && snapSusp.finished === true);
  const settledSusp = R.settle(susp, at(10 * MIN));
  ok("SUSPENSÃO: settle reconhece o término", settledSusp.status === "finished" && settledSusp.remainingMs === 0);

  // ---- settle -------------------------------------------------------------
  const sess = R.create(60, "s_1", at(0));
  ok("settle antes do prazo não encerra",
    R.settle(sess, at(59 * SEC)).status === "running" && R.snapshot(sess, at(59 * SEC)).remainingMs === SEC);
  ok("settle após o prazo encerra", R.settle(sess, at(60 * SEC)).status === "finished");
  ok("settle é IDEMPOTENTE",
    R.settle(sess, at(10 * MIN)) === sess && sess.status === "finished" && sess.remainingMs === 0);
  ok("settle em timer inválido -> null", R.settle(null, at(0)) === null && R.settle({}, at(0)) === null);
  ok("settle não encerra timer pausado (pausa congela de propósito)",
    R.settle(R.pause(R.create(60, "s_1", at(0)), at(10 * SEC)), at(10 * MIN)).status === "paused");

  // ---- pausa / retomada ---------------------------------------------------
  const p = R.create(60, "s_1", at(0));
  ok("pause congela o restante", R.pause(p, at(20 * SEC)).status === "paused" && p.remainingMs === 40 * SEC);
  ok("pause troca a autoridade para remainingMs (endsAt deixa de valer)",
    p.endsAt === null && isDateValue(p.pausedAt) && p.pausedAt.getTime() === BASE + 20 * SEC);
  ok("TIMER PAUSADO NÃO CONSOME TEMPO (20 min depois, ainda 40 s)",
    R.snapshot(p, at(20 * MIN)).remainingMs === 40 * SEC &&
      R.snapshot(p, at(20 * MIN)).progress === (20 * SEC) / (60 * SEC));
  ok("pause repetido é no-op idempotente (não reinicia pausedAt)",
    R.pause(p, at(5 * MIN)) === p && p.pausedAt.getTime() === BASE + 20 * SEC && p.remainingMs === 40 * SEC);
  ok("resume recalcula o prazo absoluto",
    R.resume(p, at(20 * MIN)) === p && p.status === "running" && p.endsAt.getTime() === BASE + 20 * MIN + 40 * SEC);
  ok("resume acumula o tempo pausado", p.pausedMs === 20 * MIN - 20 * SEC);
  ok("após resume o restante continua de onde parou",
    R.snapshot(p, at(20 * MIN + 10 * SEC)).remainingMs === 30 * SEC);
  ok("resume em timer correndo é no-op",
    R.resume(p, at(20 * MIN + 10 * SEC)).endsAt.getTime() === BASE + 20 * MIN + 40 * SEC);
  ok("pause/resume em timer finalizado -> recusa",
    R.pause(R.skip(R.create(60, "s_1", at(0)), at(0)), at(0)) === null &&
      R.resume(R.skip(R.create(60, "s_1", at(0)), at(0)), at(0)) === null);

  // ---- addTime ------------------------------------------------------------
  const add = R.create(60, "s_1", at(0));
  ok("addTime positivo estende o prazo",
    R.addTime(add, 30 * SEC, at(10 * SEC)) === add &&
      R.snapshot(add, at(10 * SEC)).remainingMs === 80 * SEC);
  ok("addTime negativo encurta o prazo",
    R.snapshot(R.addTime(add, -60 * SEC, at(10 * SEC)), at(10 * SEC)).remainingMs === 20 * SEC);
  const zeroed = R.addTime(R.create(60, "s_1", at(0)), -10 * MIN, at(10 * SEC));
  ok("addTime NUNCA deixa tempo negativo",
    zeroed.endsAt.getTime() === BASE + 10 * SEC &&
      R.snapshot(zeroed, at(10 * SEC)).remainingMs === 0 && R.snapshot(zeroed, at(10 * SEC)).finished === true);
  ok("addTime não reduz a duração planejada (anel de progresso)", zeroed.durationMs === 60 * SEC);
  const inflated = R.addTime(R.create(60, "s_1", at(0)), 2 * MIN, at(10 * SEC));
  ok("addTime acima do planejado infla a duração (progresso segue em 0..1)",
    inflated.durationMs === 170 * SEC && R.snapshot(inflated, at(10 * SEC)).progress === 0);
  const addPaused = R.pause(R.create(60, "s_1", at(0)), at(10 * SEC));
  ok("addTime em timer pausado ajusta o restante congelado",
    R.addTime(addPaused, 30 * SEC, at(MIN)).remainingMs === 80 * SEC &&
      R.snapshot(addPaused, at(10 * MIN)).remainingMs === 80 * SEC);
  ok("addTime em timer finalizado -> recusa",
    R.addTime(R.skip(R.create(60, "s_1", at(0)), at(0)), 10 * SEC, at(0)) === null);
  ok("addTime com valor não numérico -> recusa",
    R.addTime(R.create(60, "s_1", at(0)), "abc", at(0)) === null);

  // ---- restart ------------------------------------------------------------
  const r2 = R.pause(R.create(90, "s_1", at(0)), at(30 * SEC));
  R.resume(r2, at(40 * SEC));
  ok("restart reinicia do zero com a MESMA duração",
    R.restart(r2, at(5 * MIN)) === r2 && r2.status === "running" &&
      r2.durationMs === 90 * SEC && R.snapshot(r2, at(5 * MIN)).remainingMs === 90 * SEC);
  ok("restart zera as pausas acumuladas", r2.pausedMs === 0 && r2.pausedAt === null && r2.remainingMs === null);
  ok("restart preserva o vínculo da execução", r2.sessionId === "s_1");
  ok("restart com nova duração adota o valor",
    R.snapshot(R.restart(r2, at(5 * MIN), 45), at(5 * MIN)).remainingMs === 45 * SEC);
  ok("restart repetido é estável",
    R.restart(r2, at(6 * MIN)) === r2 && R.snapshot(r2, at(6 * MIN)).remainingMs === 45 * SEC);
  ok("restart em timer inválido -> null", R.restart(null, at(0)) === null);

  // ---- skip ---------------------------------------------------------------
  const sk = R.create(60, "s_1", at(0));
  ok("skip encerra imediatamente", R.skip(sk, at(5 * SEC)) === sk && sk.status === "finished" && sk.remainingMs === 0);
  ok("skip é IDEMPOTENTE", R.skip(sk, at(60 * SEC)) === sk && sk.status === "finished" && sk.remainingMs === 0);
  const skPaused = R.pause(R.create(60, "s_1", at(0)), at(10 * SEC));
  ok("skip em timer pausado também encerra", R.skip(skPaused, at(MIN)).status === "finished");
  ok("skip em timer inválido -> null", R.skip(null, at(0)) === null);

  // ---- sanitize -----------------------------------------------------------
  ok("sanitize descarta lixo",
    R.sanitize(null, at(0)) === null && R.sanitize([], at(0)) === null &&
      R.sanitize({}, at(0)) === null && R.sanitize({ durationMs: 0 }, at(0)) === null &&
      R.sanitize({ durationMs: "abc" }, at(0)) === null && R.sanitize("x", at(0)) === null);
  const sRun = R.sanitize({ durationMs: 60000, endsAt: at(30 * SEC).toISOString(), sessionId: "s_9" }, at(0));
  ok("sanitize reconstrói um descanso correndo (ISO date)",
    sRun.status === "running" && isDateValue(sRun.endsAt) && sRun.sessionId === "s_9" && sRun.remainingMs === null);
  const sRunNoEnd = R.sanitize({ durationMs: 60000, status: "running" }, at(0));
  ok("sanitize deriva endsAt quando falta o prazo",
    isDateValue(sRunNoEnd.endsAt) && sRunNoEnd.endsAt.getTime() === BASE + 60 * SEC);
  const sPaused = R.sanitize({ durationMs: 60000, remainingMs: 30000 }, at(0));
  ok("sanitize DERIVA 'paused' de remainingMs e carimba pausedAt",
    sPaused.status === "paused" && sPaused.remainingMs === 30000 && sPaused.endsAt === null && isDateValue(sPaused.pausedAt));
  ok("sanitize aceita status explícito 'finished'",
    R.sanitize({ durationMs: 60000, status: "finished" }, at(0)).remainingMs === 0);
  const sScrub = R.sanitize({
    durationMs: "60000", status: "paused", remainingMs: "30000", pausedMs: -5, sessionId: "  s_9  ",
  }, at(0));
  ok("sanitize normaliza strings, clampa pausas e limpa o vínculo",
    sScrub.durationMs === 60000 && sScrub.remainingMs === 30000 && sScrub.pausedMs === 0 && sScrub.sessionId === "s_9");
  ok("sanitize mantém o progresso coerente (duração >= restante)",
    R.sanitize({ durationMs: 60000, status: "paused", remainingMs: 90000 }, at(0)).durationMs === 90000);
  ok("sanitize rejeita status desconhecido sem dado derivável",
    R.sanitize({ durationMs: 60000, status: "corrompido" }, at(0)) === null);
  const roundTrip = R.sanitize(JSON.parse(JSON.stringify(R.create(60, "s_1", at(0)))), at(10 * SEC));
  ok("sanitize sobrevive ao round-trip JSON",
    roundTrip.status === "running" && R.snapshot(roundTrip, at(10 * SEC)).remainingMs === 50 * SEC);

  // ---- alignToSession -----------------------------------------------------
  ok("alignToSession: sessão pausada pausa o descanso",
    R.alignToSession(R.create(60, "s_1", at(0)), "paused", at(10 * SEC)).status === "paused");
  ok("alignToSession: sessão ativa retoma o descanso",
    R.alignToSession(R.pause(R.create(60, "s_1", at(0)), at(10 * SEC)), "active", at(MIN)).status === "running");
  ok("alignToSession: sessão finalizada encerra o descanso",
    R.alignToSession(R.create(60, "s_1", at(0)), "finished", at(10 * SEC)).status === "finished");
  ok("alignToSession: descanso já finalizado é ignorado",
    R.alignToSession(R.skip(R.create(60, "s_1", at(0)), at(0)), "paused", at(MIN)).status === "finished");
  ok("alignToSession: status desconhecido não altera nada",
    R.alignToSession(R.create(60, "s_1", at(0)), "bogus", at(10 * SEC)).status === "running");
  ok("alignToSession em timer inválido -> null", R.alignToSession(null, "paused", at(0)) === null);
  ok("alignToSession: retomada após pausa da sessão não consome tempo",
    (() => {
      const x = R.alignToSession(R.create(60, "s_1", at(0)), "paused", at(10 * SEC));
      R.alignToSession(x, "active", at(10 * MIN));
      return R.snapshot(x, at(10 * MIN)).remainingMs === 50 * SEC;
    })());
}

// ---------------------------------------------------------------------------
// WorkoutController — integração do descanso (E3)
// ---------------------------------------------------------------------------
function testWorkoutControllerRest() {
  const sb = makeSandbox();
  loadModules(sb, [
    "js/utils.js", "services/storage.js", "js/i18n.js", "js/workout-session.js",
    "js/rest-timer.js", "js/persistence.js", "js/pr.js", "js/workout-controller.js",
  ]);
  const C = sb.WorkoutController;
  const R = sb.RestTimer;

  suite("WorkoutController (descanso / E3)");

  const BASE = Date.parse("2026-10-18T10:00:00.000Z");
  const at = (offsetMs) => new Date(BASE + offsetMs);
  const SEC = 1000;
  const MIN = 60000;

  const routine = {
    id: "rA", letter: "A", name: "Peito e tríceps",
    exercises: [{ catalogId: "C-02", sets: 2, reps: 12, weight: 60, rest: 60 }],
  };
  const resolve = (id) => ({ name: "Ex " + id, muscle: "Peito", img: "assets/images/peito.jpg" });

  ok("módulo exposto no sandbox de integração", !!R && typeof R.create === "function");

  const session = C.start(routine, resolve, at(0)).session;
  const persistedBefore = JSON.stringify(sb.Persistence.loadSession());
  ok("sessão iniciada e persistida (pré-descanso)", persistedBefore.length > 10);

  // ---- guardas ------------------------------------------------------------
  ok("restStart sem sessão -> no-session", C.restStart(null, 60, at(0)).reason === "no-session");
  ok("restStart com sessão sem identidade estável -> invalid-session",
    C.restStart({ status: "active" }, 60, at(0)).reason === "invalid-session");
  ok("restStart com duração inválida -> invalid-rest",
    C.restStart(session, 0, at(0)).reason === "invalid-rest" &&
      C.restStart(session, "abc", at(0)).reason === "invalid-rest");

  // ---- restStart ----------------------------------------------------------
  const started = C.restStart(session, 60, at(0));
  ok("restStart cria o descanso vinculado à execução",
    started.ok === true && started.timer.sessionId === session.id &&
      started.timer.status === "running" && started.session === session);
  ok("restStart NÃO persiste nada (descanso efêmero, D-A)",
    JSON.stringify(sb.Persistence.loadSession()) === persistedBefore);
  const timer = started.timer;

  // ---- restSnapshot -------------------------------------------------------
  const snap = C.restSnapshot(timer, at(30 * SEC));
  ok("restSnapshot devolve o estado calculado",
    snap.ok === true && snap.rest.remainingMs === 30 * SEC && snap.rest.progress === 0.5 && snap.timer === timer);
  ok("restSnapshot sem timer -> no-rest",
    C.restSnapshot(null, at(0)).reason === "no-rest" && C.restSnapshot({}, at(0)).reason === "rest-state");
  ok("restSnapshot é leitura pura (não persiste nem muta)",
    timer.status === "running" && timer.remainingMs === null &&
      JSON.stringify(sb.Persistence.loadSession()) === persistedBefore);

  // ---- vínculo entre execuções --------------------------------------------
  const other = C.start({ id: "rB", letter: "B", name: "Costas", exercises: routine.exercises }, resolve, at(0)).session;
  ok("timer de outra execução não é aplicado à sessão atual",
    C.restPause(timer, at(40 * SEC), other).reason === "rest-other-session" &&
      C.restSync(timer, other, at(40 * SEC)).reason === "rest-other-session" &&
      C.restAdd(timer, 15 * SEC, at(40 * SEC), other).reason === "rest-other-session" &&
      C.restSkip(timer, at(40 * SEC), other).reason === "rest-other-session");
  ok("recusa por vínculo NÃO corrompe o descanso",
    timer.status === "running" && C.restSnapshot(timer, at(40 * SEC)).rest.remainingMs === 20 * SEC);

  // ---- pausa/retomada junto com a sessão (D-C) ----------------------------
  C.pause(session, at(40 * SEC));
  const syncPaused = C.restSync(timer, session, at(40 * SEC));
  ok("restSync pausa o descanso quando a sessão pausa",
    syncPaused.ok === true && timer.status === "paused" && timer.remainingMs === 20 * SEC);
  ok("descanso pausado não consome tempo", C.restSnapshot(timer, at(20 * MIN)).rest.remainingMs === 20 * SEC);

  C.resume(session, at(20 * MIN));
  ok("a pausa do descanso NÃO altera a duração do treino",
    C.elapsedMs(session, at(20 * MIN)) === 40 * SEC && session.pausedMs === 20 * MIN - 40 * SEC);
  const syncActive = C.restSync(timer, session, at(20 * MIN));
  ok("restSync retoma o descanso quando a sessão volta a ativa",
    syncActive.ok === true && timer.status === "running" && timer.endsAt.getTime() === BASE + 20 * MIN + 20 * SEC);

  // ---- operações ----------------------------------------------------------
  ok("restAdd soma tempo ao descanso",
    C.restAdd(timer, 15 * SEC, at(20 * MIN), session).ok === true &&
      C.restSnapshot(timer, at(20 * MIN)).rest.remainingMs === 35 * SEC);
  ok("restAdd negativo respeita o piso em zero",
    C.restAdd(timer, -30 * SEC, at(20 * MIN), session).ok === true &&
      C.restSnapshot(timer, at(20 * MIN)).rest.remainingMs === 5 * SEC);
  ok("restRestart reinicia com a duração planejada",
    C.restRestart(timer, at(20 * MIN), undefined, session).ok === true &&
      C.restSnapshot(timer, at(20 * MIN)).rest.remainingMs === 60 * SEC);
  ok("restRestart aceita nova duração",
    C.restRestart(timer, at(20 * MIN), 30, session).ok === true &&
      C.restSnapshot(timer, at(20 * MIN)).rest.remainingMs === 30 * SEC);
  ok("restSettle reconhece o descanso expirado",
    C.restSettle(timer, at(60 * MIN), session).ok === true && timer.status === "finished");
  ok("restSettle é idempotente",
    C.restSettle(timer, at(70 * MIN), session).ok === true && timer.status === "finished");

  // ---- recusas de estado --------------------------------------------------
  ok("operar descanso finalizado -> rest-state",
    C.restPause(timer, at(70 * MIN), session).reason === "rest-state" &&
      C.restAdd(timer, 10 * SEC, at(70 * MIN), session).reason === "rest-state");
  ok("timer estruturalmente inválido -> no-rest/rest-state",
    C.restPause(null, at(0), session).reason === "no-rest" &&
      C.restSync(null, session, at(0)).reason === "no-rest" &&
      C.restSync({}, session, at(0)).reason === "rest-state");
  ok("restSync sem sessão -> no-session", C.restSync(timer, null, at(0)).reason === "no-session");

  // ---- sessão finalizada encerra o descanso -------------------------------
  const outroTimer = C.restStart(session, 60, at(0)).timer;
  ok("restStart pode substituir o descanso da mesma execução", outroTimer.status === "running");
  C.finish(session, at(80 * MIN));
  ok("restSync encerra o descanso quando a sessão finaliza",
    C.restSync(outroTimer, session, at(80 * MIN)).ok === true && outroTimer.status === "finished");
  ok("finalizar não deixa descanso nem sessão persistidos", sb.Persistence.loadSession() === null);
  ok("restSkip encerra e é idempotente",
    C.restSkip(outroTimer, at(90 * MIN), session).ok === true && outroTimer.status === "finished");

  // ---- degradação graciosa sem o módulo -----------------------------------
  const bare = makeSandbox();
  loadModules(bare, [
    "js/utils.js", "services/storage.js", "js/i18n.js", "js/workout-session.js",
    "js/persistence.js", "js/workout-controller.js",
  ]);
  ok("sem js/rest-timer.js as operações degradam para 'unavailable'",
    bare.WorkoutController.restStart({ id: "s_1" }, 60, at(0)).reason === "unavailable" &&
      bare.WorkoutController.restSnapshot({}, at(0)).reason === "unavailable" &&
      bare.WorkoutController.restSync(null, { id: "s_1" }, at(0)).reason === "unavailable");
}

// ---------------------------------------------------------------------------
// WakeLock — adaptador do Screen Wake Lock (E4)
// ---------------------------------------------------------------------------
/** Sandbox com `navigator.wakeLock` e `document` simulados (promises reais). */
function makeWakeSandbox() {
  const sb = makeSandbox();
  const fake = { mode: "resolve", requests: 0, lastType: null, sentinels: [] };

  function makeSentinel() {
    const s = {
      released: false,
      listeners: [],
      addEventListener(type, fn) { if (type === "release") s.listeners.push(fn); },
      removeEventListener(type, fn) {
        if (type === "release") s.listeners = s.listeners.filter((f) => f !== fn);
      },
      release() {
        if (s.released) return Promise.reject(new Error("sentinel já liberado"));
        s.released = true;
        s.listeners.slice().forEach((fn) => fn());
        return Promise.resolve();
      },
      /** Simula o NAVEGADOR liberando sozinho (aba escondida, troca de app). */
      browserRelease() { s.released = true; s.listeners.slice().forEach((fn) => fn()); },
    };
    fake.sentinels.push(s);
    return s;
  }

  sb.navigator = {
    wakeLock: {
      request(type) {
        fake.requests++;
        fake.lastType = type;
        if (fake.mode === "throw") throw new Error("falha síncrona");
        if (fake.mode === "reject") return Promise.reject(new Error("NotAllowedError"));
        return Promise.resolve(makeSentinel());
      },
    },
  };

  const doc = {
    visibilityState: "visible",
    handlers: [],
    addEventListener(type, fn) { if (type === "visibilitychange") doc.handlers.push(fn); },
    removeEventListener(type, fn) {
      if (type === "visibilitychange") doc.handlers = doc.handlers.filter((f) => f !== fn);
    },
    fire() { doc.handlers.slice().forEach((fn) => fn()); },
  };
  sb.document = doc;

  return {
    sb, fake, doc,
    lastSentinel: () => fake.sentinels[fake.sentinels.length - 1],
  };
}

async function testWakeLock() {
  suite("WakeLock (adaptador de tela acesa)");

  // ---- carrega sem ambiente de navegador (Node/vm) ------------------------
  const bare = makeSandbox();
  loadModules(bare, ["js/wake-lock.js"]);
  const WB = bare.WakeLock;
  ok("carrega sem navigator/document e expõe a API",
    !!WB && typeof WB.request === "function" && typeof WB.release === "function" &&
      typeof WB.setEnabled === "function" && typeof WB.onVisibility === "function" &&
      typeof WB.attach === "function" && typeof WB.isSupported === "function");
  ok("module.exports expõe a mesma API",
    typeof require(path.join(ROOT, "js", "wake-lock.js")).setEnabled === "function");
  ok("sem navigator.wakeLock -> isSupported false", WB.isSupported() === false);
  const bareReq = await WB.setEnabled(true, "test");
  ok("sem suporte: intenção registrada, nada adquirido e nada lançado",
    bareReq.ok === false && bareReq.reason === "unsupported" && bareReq.active === false &&
      bareReq.enabled === true && bareReq.error === null && bareReq.message.length > 0);
  ok("sem suporte: release é seguro e zera a intenção",
    (await WB.release("test")).ok === true && WB.status().enabled === false && WB.status().active === false);
  ok("sem document: attach devolve false", WB.attach() === false && WB.attach(null) === false);
  ok("sem document: onVisibility não quebra", (await WB.onVisibility(true)).ok === true);
  WB.reset();

  // ---- API disponível: aquisição e idempotência ---------------------------
  const env = makeWakeSandbox();
  loadModules(env.sb, ["js/wake-lock.js"]);
  const W = env.sb.WakeLock;
  const F = env.fake;

  ok("isSupported true com navigator.wakeLock", W.isSupported() === true);
  // O app instala o listener de visibilidade uma vez, no boot (ver wiring).
  ok("attach no boot instala UM listener de visibilitychange",
    W.attach(env.doc) === true && env.doc.handlers.length === 1 && W.status().attached === true);
  const r1 = await W.setEnabled(true, "start");
  ok("solicitação bem-sucedida cria o bloqueio",
    r1.ok === true && r1.acquired === true && r1.active === true && r1.enabled === true && r1.reason === null);
  ok("pediu o tipo 'screen' e SÓ uma vez", F.requests === 1 && F.lastType === "screen");
  ok("status reporta o bloqueio vivo",
    W.status().supported === true && W.status().active === true && W.status().enabled === true);

  const r2 = await W.request("again");
  ok("chamada repetida reaproveita o sentinel vivo",
    r2.ok === true && r2.acquired === false && r2.active === true && F.requests === 1);
  await W.setEnabled(true, "again");
  ok("setEnabled(true) repetido não gera nova solicitação", F.requests === 1);

  W.reset();
  const nConc = F.requests;
  const both = await Promise.all([W.request("a"), W.request("b")]);
  ok("solicitações concorrentes não duplicam (inflight reaproveitado)",
    F.requests === nConc + 1 && both[0].active === true && both[1].active === true);

  // ---- liberação explícita ------------------------------------------------
  const liveConc = env.lastSentinel();
  const rel = await W.release("exit");
  ok("liberação explícita derruba o bloqueio e zera a intenção",
    rel.ok === true && rel.active === false && W.isActive() === false && W.isEnabled() === false);
  ok("sentinel realmente liberado e sem listener órfão",
    liveConc.released === true && liveConc.listeners.length === 0);
  const nAfterRel = F.requests;
  const rel2 = await W.release("exit-again");
  ok("liberar de novo é no-op (sem nova solicitação, sem sentinel morto)",
    rel2.ok === true && rel2.active === false && F.requests === nAfterRel);

  // ---- liberação inesperada do sentinel -----------------------------------
  W.reset();
  await W.request("start");
  const live = env.lastSentinel();
  live.browserRelease();
  ok("liberação inesperada (navegador) zera o bloqueio e MANTÉM a intenção",
    W.isActive() === false && W.isEnabled() === true);
  ok("listener de release também sai junto", live.listeners.length === 0);
  const nUnexpected = F.requests;
  const back = await W.onVisibility(true);
  ok("ao voltar a ficar visível, reavalia e re-adquire",
    back.ok === true && back.active === true && F.requests === nUnexpected + 1);

  // ---- aba escondida ------------------------------------------------------
  // `reset()` é teardown COMPLETO (derruba intenção, sentinel e listener); o
  // app instala o listener a cada carregamento, então re-instalamos aqui para
  // exercitar o caminho de visibilidade.
  W.attach(env.doc);
  ok("re-attach após teardown volta a observar a visibilidade",
    env.doc.handlers.length === 1 && W.status().attached === true);
  const nHidden = F.requests;
  env.doc.visibilityState = "hidden";
  env.lastSentinel().browserRelease(); // o navegador libera ao esconder
  env.doc.fire();
  await flushAsync();
  ok("aba escondida: sem bloqueio vivo e intenção preservada",
    W.isActive() === false && W.isEnabled() === true && F.requests === nHidden);
  env.doc.visibilityState = "visible";
  env.doc.fire();
  await flushAsync();
  ok("aba visível de novo: o listener ÚNICO re-adquire sozinho",
    W.isActive() === true && F.requests === nHidden + 1);

  await W.release("pause");
  const nIdle = F.requests;
  env.doc.visibilityState = "hidden"; env.doc.fire();
  env.doc.visibilityState = "visible"; env.doc.fire();
  await flushAsync();
  ok("visibilidade sem intenção não adquire nada", W.isActive() === false && F.requests === nIdle);

  env.doc.visibilityState = "hidden";
  const hiddenReq = await W.setEnabled(true, "hidden");
  ok("com a aba escondida não se pede bloqueio (o navegador rejeitaria)",
    hiddenReq.ok === false && hiddenReq.reason === "hidden" && hiddenReq.active === false &&
      hiddenReq.enabled === true && F.requests === nIdle);
  env.doc.visibilityState = "visible";
  ok("ao reaparecer, adquire de fato",
    (await W.onVisibility(true)).active === true && F.requests === nIdle + 1);

  // ---- attach/detach (um único listener) ----------------------------------
  W.detach();
  ok("detach sem listener devolve false (idempotente)", W.detach() === false);
  ok("attach instala UM listener de visibilitychange",
    W.attach(env.doc) === true && env.doc.handlers.length === 1 && W.status().attached === true);
  ok("attach repetido NÃO duplica listener",
    W.attach(env.doc) === true && env.doc.handlers.length === 1);
  ok("attach em documento inválido devolve false", W.attach({}) === false && env.doc.handlers.length === 1);
  ok("detach limpa o listener", W.detach() === true && env.doc.handlers.length === 0);

  W.attach(env.doc);
  await W.request("x");
  ok("reset limpa intenção, bloqueio e listeners",
    W.reset() === true && W.status().enabled === false && W.status().active === false &&
      W.status().attached === false && env.doc.handlers.length === 0);

  // ---- rejeição e erro síncrono -------------------------------------------
  const broken = makeWakeSandbox();
  broken.fake.mode = "reject";
  loadModules(broken.sb, ["js/wake-lock.js"]);
  const Wr = broken.sb.WakeLock;
  const rej = await Wr.setEnabled(true, "start");
  ok("solicitação rejeitada degrada em ok:false (sem lançar)",
    rej.ok === false && rej.reason === "rejected" && rej.active === false && rej.enabled === true &&
      typeof rej.error === "string" && rej.message.length > 0);
  ok("rejeição não deixa sentinel nem listener pendurado",
    Wr.status().active === false && broken.fake.sentinels.length === 0);

  broken.fake.mode = "throw";
  Wr.reset();
  const thr = await Wr.setEnabled(true, "start");
  ok("erro SÍNCRONO do navegador também vira ok:false",
    thr.ok === false && thr.reason === "rejected" && thr.active === false);

  broken.fake.mode = "resolve";
  Wr.reset();
  await Wr.request("start");
  broken.lastSentinel().release = () => Promise.reject(new Error("sentinel liberado"));
  const relStuck = await Wr.release("exit");
  ok("falha ao liberar não vira exceção e o estado fica limpo",
    relStuck.ok === true && relStuck.active === false && typeof relStuck.error === "string" &&
      Wr.status().active === false && Wr.status().enabled === false);

  // ---- erro de Wake Lock NÃO impede o treino ------------------------------
  const flow = makeWakeSandbox();
  flow.fake.mode = "reject";
  loadModules(flow.sb, [
    "js/utils.js", "services/storage.js", "js/i18n.js", "js/workout-session.js",
    "js/rest-timer.js", "js/persistence.js", "js/pr.js", "js/wake-lock.js",
    "js/workout-controller.js",
  ]);
  const CF = flow.sb.WorkoutController;
  const RF = flow.sb.RestTimer;
  const t0 = new Date("2026-10-18T10:00:00.000Z");
  const t1 = new Date("2026-10-18T10:10:00.000Z");
  const routine = {
    id: "rA", letter: "A", name: "Peito",
    exercises: [{ catalogId: "C-02", sets: 1, reps: 10, weight: 40, rest: 60 }],
  };
  const resolveItem = (id) => ({ name: "Ex " + id, muscle: "Peito", img: "x.jpg" });

  const wakeFail = await flow.sb.WakeLock.setEnabled(true, "start");
  const started = CF.start(routine, resolveItem, t0);
  const set1 = CF.completeSet(started.session, { weight: 40, reps: 10 }, t0);
  const rest = CF.restStart(started.session, 60, t0);
  const restOk = rest.ok === true && RF.snapshot(rest.timer, t0).remainingMs === 60000;
  const fin = CF.finish(started.session, t1);
  const entry = CF.buildHistoryEntry(started.session, "completed", t1);
  ok("erro de Wake Lock não impede iniciar, executar, descansar e finalizar",
    wakeFail.ok === false && started.ok === true && set1.ok === true && set1.isFinished === true &&
      restOk === true && fin.ok === true && !!entry && entry.status === "completed");
}

// ---------------------------------------------------------------------------
// Player: pausa/retomada e descanso medido pelo domínio (E5)
// ---------------------------------------------------------------------------
function testWorkoutPlayerE5() {
  suite("Player: pausa/retomada e descanso (E5)");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");

  // --- i18n das chaves novas (pt/en/es) ------------------------------------
  const sb = makeSandbox();
  loadModules(sb, ["js/i18n.js"]);
  const dict = sb.I18n.dict;
  ["pause_workout", "resume_workout", "workout_paused"].forEach((k) => {
    ok("i18n '" + k + "' nos 3 idiomas",
      ["pt", "en", "es"].every((l) => dict[l] && typeof dict[l][k] === "string" &&
        dict[l][k].length > 0 && dict[l][k] !== k));
  });
  ok("i18n: as chaves da Home seguem intactas",
    dict.pt.last_workout === "Último Treino" && dict.en.last_workout === "Last Workout" &&
      dict.es.last_workout === "Último Entreno");

  // --- descanso medido pelo DOMÍNIO (o contador legado saiu) ---------------
  ok("descanso: nada de contador decrementado na UI",
    !/state\.restTimer\.time\b/.test(html) && !/restTimer\.isRunning/.test(html) &&
      !/restTimer\.total\b/.test(html) && !/restTimer\.time--/.test(html));
  ok("descanso: a UI conversa com o domínio (start/snapshot/add/skip/settle)",
    html.includes("WorkoutController.restStart(") && html.includes("WorkoutController.restSnapshot(") &&
      html.includes("WorkoutController.restAdd(") && html.includes("WorkoutController.restSkip(") &&
      html.includes("WorkoutController.restSettle("));
  ok("descanso: holder só guarda o timer e o id do ticker",
    html.includes("restTimer: { timer: null, id: null }"));
  ok("descanso: ticker é só de TELA (um por vez, cancela o anterior)",
    html.includes("function startRestTicker()") &&
      /function startRestTicker\(\)[\s\S]{0,200}?stopRestTicker\(\)/.test(html) &&
      html.includes("setInterval(tickRest, REST_TICK_MS)"));
  ok("descanso: render lê o restante CALCULADO (snapshot), não o tick",
    html.includes("function renderRest(rest)") && html.includes("rest.remainingMs") &&
      html.includes("rest.progress"));
  ok("descanso: prazo vencido encerra pelo domínio (settle)",
    /if \(rest\.finished\) \{[\s\S]{0,160}?endRest\('settle'\)/.test(html));
  ok("descanso: botão Pular encerra pelo domínio (skip)",
    /function skipRest\(\)[\s\S]{0,80}?endRest\('skip'\)/.test(html));
  ok("descanso: encerrar pelo domínio e depois fechar (idempotente)",
    /function endRest\(mode\)[\s\S]{0,520}?WorkoutController\.restSkip\(timer, now, state\.session\)[\s\S]{0,200}?closeRestOverlay\(\)/.test(html));

  // --- fim do vazamento de intervalos -------------------------------------
  ok("descanso: fechar o overlay cancela o ticker e descarta o timer",
    /function closeRestOverlay\(\)[\s\S]{0,200}?stopRestTicker\(\)[\s\S]{0,200}?classList\.remove\('active'\)[\s\S]{0,200}?restTimer\.timer = null/.test(html));
  ["saveAndExit", "discardAndExit", "discardRestoredSession", "resumeRestoredSession"].forEach((fn) => {
    ok("descanso: " + fn + " não deixa ticker órfão",
      new RegExp("function " + fn + "\\([^)]*\\)[\\s\\S]{0,500}?closeRestOverlay\\(\\)").test(html));
  });
  ok("descanso: finalizar (auto e confirmação) também fecha o descanso",
    (html.match(/closeRestOverlay\(\);/g) || []).length >= 7);
  ok("descanso: o interval só existe dentro do ticker (nada solto)",
    (html.match(/setInterval\(/g) || []).length === 1);

  // --- pausa/retomada do treino (UI) --------------------------------------
  // E6: a blindagem engordou o alternador — a cerca passa a ser o CORPO da
  // função (extraído UMA vez), não um limite de proximidade em caracteres.
  const toggleBody = (html.match(/function togglePauseWorkout\(\)[\s\S]*?\n    \}/) || [""])[0];
  ok("pausa: botão único alterna pausa/retomada",
    html.includes('id="btn-pause-resume"') && html.includes('onclick="togglePauseWorkout()"') &&
      toggleBody.includes("resumeWorkout(new Date()) : pauseWorkout()"));
  ok("pausa: rótulo e CTA vêm do ESTADO da sessão (sem cópia local)",
    html.includes("const paused = s.status === 'paused'") &&
      html.includes("'resume_workout' : 'pause_workout'") &&
      html.includes('data-i18n="workout_paused"'));
  ok("pausa: pausar sincroniza o descanso (D-C)",
    /function pauseWorkout\(\)[\s\S]{0,600}?restSyncSession\(now\)/.test(html));
  ok("pausa: retomar sincroniza o descanso (D-C)",
    /function resumeWorkout\(now\)[\s\S]{0,700}?restSyncSession\(at\)/.test(html));
  ok("pausa: restSyncSession usa o ponto único do controlador",
    /function restSyncSession\(now\)[\s\S]{0,320}?WorkoutController\.restSync\(timer, state\.session/.test(html));
  // E6 acrescentou a blindagem ao alternador: a cerca da E5 era de PROXIMIDADE
  // (`[\s\S]{0,420}`) e passou a usar o CORPO da função (extraído acima) — o que
  // importa é o alternador delegar para pausar/retomar, não o tamanho do trecho.
  ok("pausa: sessão finalizada não inventa estado (recusa vem do controlador)",
    toggleBody.includes("pauseWorkout()") && toggleBody.includes("resumeWorkout(new Date())") &&
      /function pauseWorkout\(\)[\s\S]{0,420}?showToast\(result\.message/.test(html) &&
      html.includes("const paused = s.status === 'paused'"));
}


// ---------------------------------------------------------------------------
// ActionGuard — blindagem de toque duplo da UI (E6)
// ---------------------------------------------------------------------------
function testActionGuard() {
  suite("ActionGuard (blindagem de toque duplo / E6)");

  const sb = makeSandbox();
  loadModules(sb, ["js/action-guard.js"]);
  const A = sb.ActionGuard;

  const src = fs.readFileSync(path.join(ROOT, "js", "action-guard.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  ok("módulo puro: sem DOM, storage, persistência, eventos, timers ou domínio",
    !/\bdocument\b|\blocalStorage\b|\bPersistence\b|\bEventBus\b|\bsetTimeout\b|\bsetInterval\b|\bWorkoutSession\b|\bWorkoutController\b|\bRestTimer\b|\bWakeLock\b/.test(code));
  ok("não lê o relógio: o instante entra por parâmetro",
    !/new Date\(\)/.test(code));
  eq("janela padrão é 400 ms", A.WINDOW_MS, 400);
  eq("instância sem parâmetro usa a janela padrão", A.create().windowMs, 400);

  // ---- aceite x recusa por janela ------------------------------------------
  const g = A.create();
  ok("primeira chamada da chave é aceita", g.accept("complete-set:s_1", 1000) === true);
  ok("repetição dentro da janela é recusada", g.accept("complete-set:s_1", 1300) === false);
  ok("exatamente na borda da janela é aceita", g.accept("complete-set:s_1", 1400) === true);
  ok("depois da janela é aceita", g.accept("complete-set:s_1", 5000) === true);

  // ---- recusa NÃO estende a janela (nada de flag presa) --------------------
  const g2 = A.create();
  g2.accept("k", 0);
  g2.accept("k", 100);
  g2.accept("k", 200);
  ok("recusas não estendem a janela (contada do último ACEITE)",
    g2.accept("k", 400) === true && g2.lastAt("k") === 400);

  // ---- chaves independentes -----------------------------------------------
  const g3 = A.create();
  ok("chaves diferentes não interferem (intenções separadas)",
    g3.accept("complete-set:s_1", 0) === true && g3.accept("pause-toggle:s_1", 10) === true &&
      g3.accept("complete-set:s_1", 20) === false && g3.accept("pause-toggle:s_1", 30) === false);
  ok("a MESMA intenção em EXECUÇÕES diferentes não se bloqueia",
    g3.accept("complete-set:s_2", 25) === true);

  // ---- forget / lastAt / reset --------------------------------------------
  const g4 = A.create();
  ok("lastAt devolve null antes de qualquer aceite", g4.lastAt("k") === null);
  g4.accept("k", 777);
  eq("lastAt devolve o ms do último aceite", g4.lastAt("k"), 777);
  ok("forget libera a janela na hora",
    g4.forget("k") === true && g4.accept("k", 778) === true && g4.lastAt("k") === 778);
  ok("forget de chave inexistente é no-op", g4.forget("nao-existe") === false);
  g4.accept("outra", 1000);
  eq("reset devolve quantas chaves esqueceu", g4.reset(), 2);
  ok("reset limpa as janelas", g4.lastAt("k") === null && g4.accept("k", 1010) === true);

  // ---- instâncias isoladas ------------------------------------------------
  const a = A.create(50);
  const b = A.create(50);
  a.accept("k", 0);
  ok("instâncias são isoladas (sem estado compartilhado)",
    b.accept("k", 1) === true && a.accept("k", 1) === false);

  // ---- janela customizada e fallback --------------------------------------
  const g5 = A.create(100);
  ok("janela customizada é respeitada",
    g5.accept("k", 0) === true && g5.accept("k", 99) === false && g5.accept("k", 100) === true);
  eq("janela inválida (0) cai no padrão", A.create(0).windowMs, 400);
  eq("janela inválida (negativa) cai no padrão", A.create(-5).windowMs, 400);
  eq("janela inválida (NaN) cai no padrão", A.create(NaN).windowMs, 400);
  eq("janela inválida (string) cai no padrão", A.create("400").windowMs, 400);

  // ---- fail-closed em chamada malformada ----------------------------------
  const g6 = A.create();
  ok("chave vazia ou não-string é recusada",
    g6.accept("", 0) === false && g6.accept(null, 0) === false && g6.accept(42, 0) === false);
  ok("instante inválido é recusado",
    g6.accept("k", undefined) === false && g6.accept("k", NaN) === false &&
      g6.accept("k", "1000") === false && g6.accept("k", new Date(NaN)) === false);
  ok("chamada malformada NÃO suja o estado (aceite seguinte funciona)",
    g6.accept("k", 5000) === true && g6.lastAt("k") === 5000);
  ok("relógio para trás não libera a ação",
    g6.accept("k", 3000) === false && g6.lastAt("k") === 5000);

  // ---- Date e number são o MESMO instante ---------------------------------
  const g7 = A.create();
  const t = new Date("2026-10-18T10:00:00.000Z");
  ok("aceita Date (de outro realm) e number como o mesmo instante",
    g7.accept("k", t) === true && g7.accept("k", t.getTime() + 100) === false &&
      g7.lastAt("k") === t.getTime() && g7.accept("k", t.getTime() + 400) === true);
}

// ---------------------------------------------------------------------------
// Wiring estático do HTML
// ---------------------------------------------------------------------------
function testWiring() {
  suite("Wiring do HTML");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");

  const order = ["js/utils.js", "services/storage.js", "js/i18n.js", "js/data/exercises.js", "js/catalog.js", "js/custom-exercises.js", "js/custom-catalog.js", "js/events.js", "js/routine-actions.js", "js/pr.js", "js/workout-session.js", "js/rest-timer.js", "js/wake-lock.js", "js/action-guard.js", "js/workout-controller.js"].map((src) => ({
    src,
    at: html.indexOf('src="' + src + '"'),
  }));
  order.forEach((o) => ok("carrega " + o.src, o.at !== -1));
  ok("módulos carregam antes do script principal",
    order.every((o) => o.at >= 0) &&
      Math.max(...order.map((o) => o.at)) < html.indexOf("<script>\n    // ================= CATÁLOGO REAL"),
    JSON.stringify(order.map((o) => o.at)));
  ok("catálogo real substitui o mock do Unsplash",
    !html.includes("images.unsplash.com") && html.includes("Catalog.forPrototype()"));
  ok("bootstrap da persistência presente", html.includes('src="js/persistence.js"') && html.includes("Persistence.init()"));
  ok("dicionário inline substituído pela fonte única",
    html.includes("const translations = I18n.dict;") && !html.includes("const translations = {\n        pt:"));
  ok("toggleLanguage delega para I18n", /function toggleLanguage\(\)\s*\{\s*I18n\.toggle\(\)/.test(html));

  // Fase 2C — UX dos grupos musculares e exclusão de treino
  ok("filtros usam wrap (sem rolagem horizontal escondida)",
    /\.filters\s*\{[^}]*flex-wrap:\s*wrap/.test(html) && !/\.filters\s*\{[^}]*overflow-x:\s*auto/.test(html));
  ok("modal de confirmação presente", html.includes('id="confirm-modal"') && html.includes("function askDeleteRoutine"));
  ok("toast de feedback presente", html.includes('id="app-toast"'));
  ok("resumo de PRs no histórico presente", html.includes('id="pr-summary"'));
  ok("exclusão usa RoutineActions + persistência existente",
    html.includes("RoutineActions.deleteRoutine(") && html.includes("Persistence.saveRoutines("));
  ok("card da rotina usa delegação data-* (sem onclick inline com dados do usuário)",
    html.includes('data-routine-action="delete"') &&
      html.includes('data-routine-action="edit"') && html.includes("btn-minus") &&
      !html.includes("askDeleteRoutine('${r.id}')") &&
      !html.includes("navigate('details', '${r.id}')"));
  ok("campo de nome da rotina presente, acessível e limitado a 60",
    html.includes('id="routine-name"') && html.includes('for="routine-name"') &&
      /id="routine-name"[^>]*maxlength="60"/.test(html) &&
      html.includes('aria-describedby="routine-name-help"'));
  // Sprint 4: as séries concluídas passaram a ser registradas pelo DOMÍNIO
  // (WorkoutSession.completeSet) e a entrada de histórico é montada pelo
  // CONTROLADOR (que passou a deter `dateISO`/duração).
  const sessionSrc = fs.readFileSync(path.join(ROOT, "js", "workout-session.js"), "utf8");
  const controllerSrc = fs.readFileSync(path.join(ROOT, "js", "workout-controller.js"), "utf8");
  ok("histórico enriquecido grava séries concluídas",
    sessionSrc.includes("completedSets.push(") && controllerSrc.includes("dateISO") &&
      html.includes("WorkoutController.appendToHistory("));
  ok("Player usa o domínio + controlador da sessão",
    html.includes("WorkoutController.start(") && html.includes("WorkoutController.completeSet(") &&
      html.includes("js/workout-session.js") && html.includes("js/workout-controller.js"));
  ok("sessão recuperada tem fluxo de retomar/descartar",
    html.includes('id="resume-modal"') && html.includes("function resumeRestoredSession") &&
      html.includes("function discardRestoredSession") && html.includes("showResumePrompt()"));
  ok("persistência da sessão centralizada no controlador",
    html.includes("WorkoutController.clear()") && !/Persistence\.saveSession\(/.test(html));
  ok("PR integrado ao salvar treino", html.includes("PR.checkNewPR("));

  // Sprint 4 / E3 — o descanso passou a existir como DOMÍNIO testável, mas o
  // timer VISUAL (ticker, overlay e botões) continua o legado: removê-lo e
  // ligá-lo ao domínio é escopo da E5. Esta checagem é a cerca da etapa.
  const restSrc = fs.readFileSync(path.join(ROOT, "js", "rest-timer.js"), "utf8");
  ok("descanso: módulo de domínio carregado antes do script principal",
    html.includes('src="js/rest-timer.js"') && restSrc.includes("alignToSession") &&
      html.indexOf('src="js/rest-timer.js"') < html.indexOf("<script>\n    // ================= CATÁLOGO REAL"));
  ok("descanso: módulo não conhece DOM nem persistência",
    !/\bdocument\b|\blocalStorage\b|\bPersistence\b/.test(restSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
  ok("E5: o timer visual passou a ser medido pelo DOMÍNIO (fence da E3 atualizada)",
    html.includes("function startRestTimer(") && html.includes('id="rest-overlay"') &&
      html.includes("WorkoutController.restSnapshot(") && !/state\.restTimer\.time\b/.test(html));

  // Sprint 4 / E4 — tela acesa: adaptador isolado + intenção no ciclo do Player
  const wakeSrc = fs.readFileSync(path.join(ROOT, "js", "wake-lock.js"), "utf8");
  const wakeCode = wakeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok("tela acesa: adaptador isolado do domínio (sem sessão/descanso/persistência)",
    !/\bWorkoutSession\b|\bRestTimer\b|\bWorkoutController\b|\bPersistence\b|\bEventBus\b|\blocalStorage\b/.test(wakeCode));
  ok("tela acesa: adaptador fala com navigator.wakeLock e pede o tipo 'screen'",
    /navigator/.test(wakeCode) && /wakeLock/.test(wakeCode) && wakeCode.includes('"screen"'));
  ok("tela acesa: a UI guarda o módulo e nunca deixa o erro subir",
    html.includes("function syncWakeLock(shouldHold, reason)") &&
      html.includes("typeof WakeLock === 'undefined'") && html.includes("WakeLock.setEnabled("));
  ok("tela acesa: intenção segue o ciclo do Player",
    html.includes("syncWakeLock(true, 'start')") && html.includes("syncWakeLock(false, 'paused')") &&
      html.includes("syncWakeLock(true, 'resumed')") && html.includes("syncWakeLock(false, 'finished')") &&
      html.includes("syncWakeLock(false, 'exit')") && html.includes("syncWakeLock(false, 'discard')"));
  ok("tela acesa: sessão recuperada só bloqueia se estiver ATIVA",
    html.includes("syncWakeLock(state.session.status === 'active', 'resume')"));
  ok("tela acesa: listener único de visibilidade + limpeza no descarregamento",
    html.includes("WakeLock.attach(document)") && html.includes("WakeLock.detach()") &&
      html.includes("'pagehide'"));

  // Sprint 4 / E6 — a blindagem de toque duplo é uma JANELA por INTENÇÃO da UI
  // (js/action-guard.js, puro); só as intenções com dano real são blindadas.
  const guardSrc = fs.readFileSync(path.join(ROOT, "js", "action-guard.js"), "utf8");
  const guardCode = guardSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok("blindagem: módulo de janela carregado antes do script principal",
    html.includes('src="js/action-guard.js"') &&
      html.indexOf('src="js/action-guard.js"') < html.indexOf("<script>\n    // ================= CATÁLOGO REAL"));
  ok("blindagem: módulo puro (sem DOM, storage, domínio, timers ou relógio)",
    !/\bdocument\b|\blocalStorage\b|\bPersistence\b|\bEventBus\b|\bWorkoutSession\b|\bWorkoutController\b|\bRestTimer\b|\bWakeLock\b|\bsetTimeout\b|\bsetInterval\b/.test(guardCode) &&
      !/new Date\(\)/.test(guardCode));
  ok("blindagem: uma instância no Player, com a janela declarada",
    html.includes("const TAP_WINDOW_MS = 400;") && html.includes("ActionGuard.create(TAP_WINDOW_MS)"));
  ok("blindagem: chave = INTENÇÃO da UI + execução (não vaza entre treinos)",
    /function tapKey\(intent\)/.test(html) &&
      html.includes("intent + ':' + (state.session ? state.session.id : 'sem-sessao')"));
  ok("blindagem: cobre as intenções com dano real (série, confirmar, alternar)",
    html.includes("tapKey('complete-set')") && html.includes("tapKey('finish-confirm')") &&
      html.includes("tapKey('pause-toggle')") &&
      html.includes("tapGuard.accept(tapKey('complete-set'), new Date())") &&
      html.includes("tapGuard.accept(tapKey('finish-confirm'), new Date())") &&
      html.includes("tapGuard.accept(key, new Date())"));
  ok("blindagem: recusa do domínio não conta como toque (forget)",
    html.includes("tapGuard.forget(tapKey('complete-set'))") && html.includes("tapGuard.forget(key)"));
  ok("blindagem: execução nova zera as janelas (reset no início do treino)",
    /function startWorkoutSession\(\)[\s\S]{0,260}?tapGuard\.reset\(\)/.test(html));
  ok("blindagem: alternador é UMA intenção para duas ações do domínio",
    html.includes("? resumeWorkout(new Date()) : pauseWorkout();"));
  ok("blindagem: sem toast para toque duplo (o primeiro toque já valeu)",
    !/showToast\([^)]*duplicat/i.test(html) && !/showToast\([^)]*duplo/i.test(html));

  const homeBlock = html.match(/<section id="screen-home"[\s\S]*?<\/section>/)[0];
  ok("nenhum <script>/<link> foi enfiado DENTRO do bloco da Home",
    !/<script|<link/i.test(homeBlock));
  ok("Home não referencia nenhum módulo novo (sem I18n./Persistence. no markup)",
    !/I18n\.|Persistence\.|StorageService\.|TTUtils\./.test(homeBlock));

  // Sprint 5.2.1 — exercícios personalizados no catálogo apresentado.
  ok("estado inicia com a lista de personalizados",
    /customExercises:\s*\[\]/.test(html));
  ok("personalizados carregam antes da persistência e do script principal",
    html.indexOf('src="js/custom-exercises.js"') !== -1 &&
      html.indexOf('src="js/custom-catalog.js"') !== -1 &&
      html.indexOf('src="js/custom-exercises.js"') < html.indexOf('src="js/custom-catalog.js"') &&
      html.indexOf('src="js/custom-catalog.js"') < html.indexOf('src="js/persistence.js"') &&
      html.indexOf('src="js/custom-catalog.js"') < html.indexOf("<script>\n    // ================= CATÁLOGO REAL"));
  ok("seleção combina oficiais + personalizados pelo adaptador",
    html.includes("CustomCatalog.search(official, state.customExercises") &&
      html.includes("state.catalogFilter, catalogImage"));
  ok("resolução de catalogId usa oficial -> personalizado -> fallback",
    /function catalogItem\(id\)[\s\S]{0,320}?CustomCatalog\.resolve\(id, mockCatalog, state\.customExercises,\s*FALLBACK_CATALOG_ITEM, catalogImage\)/.test(html));
  ok("personalizado é identificado pelo selo traduzível",
    html.includes('class="custom-badge"') && html.includes('data-i18n="custom_badge"'));
  ok("botão 'Novo exercício' na seleção abre a tela dedicada",
    html.includes('id="btn-new-custom-exercise"') &&
      html.includes("openCustomExerciseCreate('add-exercise')"));
  ok("tela do formulário tem rótulos, limite de 60 e grupo obrigatório",
    html.includes('id="screen-add-custom-exercise"') &&
      html.includes('for="custom-exercise-name"') &&
      html.includes('id="custom-exercise-name"') &&
      html.includes('maxlength="60"') &&
      html.includes('for="custom-exercise-muscle"') &&
      html.includes('id="custom-exercise-muscle"') &&
      /<select id="custom-exercise-muscle"[^>]*required/.test(html));
  ok("erro do cadastro é uma região viva assertiva",
    /<div id="custom-exercise-error"[^>]*role="alert"[^>]*aria-live="assertive"/.test(html));
  ok("formulário usa submit nativo e limpa erro ao editar",
    html.includes("customForm.addEventListener('submit'") &&
      html.includes("customName.addEventListener('input', clearCustomExerciseError)") &&
      html.includes("customMuscle.addEventListener('change', clearCustomExerciseError)"));
  ok("gravação acontece antes de atualizar o estado",
    /Persistence\.saveCustomExercises\(result\.list\);[\s\S]{0,520}?state\.customExercises\s*=\s*customExerciseAcceptedList\(saveResult, result\.list\)/.test(html) &&
      !/Persistence\.saveCustomExercises\(result\.list\);[\s\S]{0,520}?state\.customExercises\s*=\s*result\.list/.test(html));
  ok("falha de gravação mantém o formulário intacto e não atualiza estado",
    /Persistence\.saveCustomExercises\(result\.list\);[\s\S]{0,320}?saveStatus !== 'saved'[\s\S]{0,120}?setCustomExerciseError\('save-error', false\);\s*return false;/.test(html));
  ok("A-09: descarte e modo memória não exibem toast de sucesso",
    html.includes("saveStatus === 'normalized'") &&
      html.includes("showToast(I18n.t('custom_exercise_partial_save'), 'error')") &&
      html.includes("showToast(I18n.t('custom_exercise_memory_only'), 'error')") &&
      html.includes("customExerciseAcceptedList"));
  ok("duplicidade global usa catálogo oficial + grupos oficiais",
    html.includes("officialNames: officialNames") && html.includes("groups: groups") &&
      html.includes("CustomExercises.create("));

  // Sprint 5.2.1 — Fase 4: gerenciar (editar/excluir) personalizados.
  ok("tela 'Meus exercícios' com título, subtítulo, erro e lista acessíveis",
    html.includes('id="screen-custom-exercises"') &&
      html.includes('aria-labelledby="custom-exercises-title"') &&
      html.includes('id="custom-exercises-title"') &&
      html.includes('id="custom-exercises-error"') &&
      /<div id="custom-exercises-error"[^>]*role="alert"[^>]*aria-live="assertive"/.test(html) &&
      /<div id="custom-exercises-list"[^>]*role="list"/.test(html));
  ok("A-07: estado vazio é região de status fora da lista e sem item fictício",
    /<div id="custom-exercises-list"[^>]*role="list"><\/div>\s*<p id="custom-exercises-empty"[^>]*role="status"[^>]*hidden><\/p>/.test(html) &&
      !/<p class="custom-manage-empty" role="status">/.test(html) &&
      html.includes("function setCustomExercisesEmptyState(message)") &&
      html.includes("if (empty.textContent !== text) empty.textContent = text;") &&
      html.includes("container.innerHTML = '';") &&
      html.includes("setCustomExercisesEmptyState(I18n.t('custom_exercises_empty'))") &&
      html.includes("setCustomExercisesEmptyState('')"));
  ok("A-08: {name} é interpolado por função, sem interpretar $&, $', $` ou $$",
    html.includes("function interpolateName(template, name)") &&
      html.includes(".replace('{name}', () => String(name == null ? '' : name))") &&
      html.includes("interpolateName(I18n.t('add_exercise_aria'), c.name)") &&
      html.includes("interpolateName(I18n.t('custom_error_in_use'), customExercisesErrorName)") &&
      html.includes("interpolateName(I18n.t('edit_custom_exercise_aria'), ex.name)") &&
      html.includes("interpolateName(I18n.t('delete_custom_exercise_aria'), ex.name)") &&
      html.includes("interpolateName(I18n.t('delete_custom_exercise_desc'), exercise.name)") &&
      !/\.replace\('\{name\}',\s*[A-Za-z_$]/.test(html));
  ok("seleção abre o gerenciador e a rota existe",
    html.includes('id="btn-manage-custom-exercises"') &&
      html.includes("openCustomExerciseManager()") &&
      html.includes("'custom-exercises': 1") &&
      html.includes("if (screenId === 'custom-exercises') renderCustomExercisesScreen();"));
  ok("formulário alterna criação e edição (título, botão e retorno)",
    html.includes("state.editingCustomExerciseId") &&
      html.includes("state.customExerciseReturnScreen") &&
      html.includes("function openCustomExerciseCreate(") &&
      html.includes("function openCustomExerciseEdit(") &&
      html.includes("function closeCustomExerciseForm(") &&
      html.includes("syncCustomExerciseFormMode()") &&
      html.includes("edit_exercise_title") && html.includes("save_exercise"));
  ok("edição usa o domínio com validação global e grava antes do estado",
    /CustomExercises\.update\(state\.customExercises, state\.editingCustomExerciseId, payload,/.test(html) &&
      /CustomExercises\.update\([\s\S]{0,200}?officialNames: officialNames, groups: groups/.test(html));
  ok("lista de personalizados expõe editar/excluir com nomes acessíveis",
    html.includes('class="btn custom-manage-edit"') &&
      html.includes('class="btn custom-manage-delete"') &&
      html.includes("edit_custom_exercise_aria") &&
      html.includes("delete_custom_exercise_aria") &&
      html.includes('data-custom-action="edit"') &&
      html.includes('data-custom-action="delete"'));
  ok("A-01: IDs personalizados não são interpolados em onclick inline",
    !/onclick="[^"]*addExerciseToRoutine/.test(html) &&
      !/onclick="[^"]*openCustomExerciseEdit/.test(html) &&
      !/onclick="[^"]*askDeleteCustomExercise/.test(html) &&
      html.includes('data-catalog-id="${catalogText(c.id)}"') &&
      html.includes('data-custom-id="${catalogText(ex.id)}"') &&
      html.includes("closest('.btn-add-circle')") &&
      html.includes("closest('[data-custom-action]')") &&
      html.includes("addEventListener('click'"));
  ok("exclusão bloqueia uso e consulta rotinas, buffer e sessão",
    html.includes("CustomExercises.usageReport(id, customExerciseUsageOptions())") &&
      /routines: Array\.isArray\(state\.routines\) \? state\.routines : \[\]/.test(html) &&
      html.includes("tempRoutine: state.tempEditRoutine || null") &&
      html.includes("session: state.session || null"));
  ok("exclusão grava antes de atualizar estado e preserva em falha",
    /CustomExercises\.remove\(state\.customExercises, id, customExerciseUsageOptions\(\)\)/.test(html) &&
      /Persistence\.saveCustomExercises\(result\.list\);[\s\S]{0,420}?state\.customExercises = customExerciseAcceptedList\(saveResult, result\.list\)/.test(html) &&
      /setCustomExercisesScreenError\('delete-error'\);\s*return false;/.test(html));
  ok("modal de confirmação é diálogo com foco inicial e fallback programático",
    html.includes('id="confirm-modal" role="dialog" aria-modal="true"') &&
      html.includes('aria-labelledby="confirm-title" aria-describedby="confirm-desc" tabindex="-1"') &&
      html.includes("_confirmReturnFocus = isUsableFocusTarget(document.activeElement)") &&
      html.includes("const cancel = document.getElementById('confirm-cancel')") &&
      html.includes("const initial = focusables.indexOf(cancel) !== -1 ? cancel : (focusables[0] || modal)") &&
      html.includes("if (initial && typeof initial.focus === 'function') initial.focus()"));
  ok("A-04: conteúdo do modal fica contido por Tab/Shift+Tab",
    html.includes("function confirmModalTrapKeydown(e)") &&
      html.includes("const items = modalFocusables(modal)") &&
      html.includes("if (!items.length)") &&
      html.includes("active === last") && html.includes("active === first") &&
      html.includes("first.focus()") && html.includes("last.focus()"));
  ok("A-04: Escape respeita modal não descartável e não fecha duas camadas",
    html.includes("if (e.key === 'Escape')") &&
      html.includes("if (e.defaultPrevented) return") &&
      html.includes("if (_confirmDismissible) closeConfirmModal()") &&
      html.includes("stopImmediatePropagation()"));
  ok("A-04: fundo recebe inert e estado anterior é restaurado",
    html.includes("function setModalBackgroundInert(modal, inert)") &&
      html.includes("hasAttribute('inert')") &&
      html.includes("setAttribute('inert'") &&
      html.includes("removeAttribute('inert')") &&
      html.includes("setModalBackgroundInert(modal, true)") &&
      html.includes("setModalBackgroundInert(modal, false)") &&
      html.includes("releaseConfirmFocusTrap()"));
  ok("A-05: cadastro/edição lembram o acionador e restauram foco válido",
    html.includes("let customExerciseReturnFocus = null") &&
      html.includes("function rememberCustomExerciseFocus()") &&
      html.includes("function restoreCustomExerciseFocus(targetScreen)") &&
      html.includes("customExerciseReturnFocus = isUsableFocusTarget(active) ? active : null") &&
      html.includes("isUsableFocusTarget(opener)") &&
      html.includes("focusCustomExercisesTitle()") &&
      html.includes("focusFallbackForScreen()"));
  ok("A-05: voltar do gerenciador devolve o foco ao acionador",
    html.includes("let customExerciseManagerReturnFocus = null") &&
      html.includes("function closeCustomExerciseManager()") &&
      html.includes("customExerciseManagerReturnFocus = isUsableFocusTarget(active) ? active : null") &&
      html.includes('onclick="closeCustomExerciseManager()"') &&
      /function closeCustomExerciseManager\(\)[\s\S]{0,700}?isUsableFocusTarget\(opener\)/.test(html) &&
      /function closeCustomExerciseManager\(\)[\s\S]{0,1000}?focusFallbackForScreen\(\)/.test(html));
  ok("botões do modal de confirmação são traduzíveis",
    html.includes('id="confirm-ok" data-i18n="confirm"') &&
      html.includes('id="confirm-cancel" data-i18n="cancel"'));
}

// ---------------------------------------------------------------------------
// Player: responsividade e acessibilidade (E7)
// ---------------------------------------------------------------------------
function testWorkoutPlayerE7() {
  suite("Player: responsividade e acessibilidade (E7)");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");

  // --- i18n das chaves novas (pt/en/es) ------------------------------------
  const sb = makeSandbox();
  loadModules(sb, ["js/i18n.js"]);
  const dict = sb.I18n.dict;
  ["rest_decrease", "rest_increase", "exit_workout", "workout_resumed", "set_completed", "rest_finished"]
    .forEach((k) => {
      ok("i18n '" + k + "' nos 3 idiomas",
        ["pt", "en", "es"].every((l) => dict[l] && typeof dict[l][k] === "string" &&
          dict[l][k].length > 0 && dict[l][k] !== k));
    });
  // WCAG 2.5.3 (Label in Name): o nome acessível dos ± DEVE conter o texto visível.
  ["pt", "en", "es"].forEach((l) => {
    ok("i18n '" + l + "': rótulo dos ± contém o texto visível",
      dict[l].rest_decrease.indexOf("- 15s") === 0 && dict[l].rest_increase.indexOf("+ 15s") === 0);
  });

  // --- região viva: anúncio por EVENTO, nunca pelo ticker ------------------
  ok("a11y: região viva de status no Player (role=status / aria-live=polite)",
    /<div id="player-status"[^>]*class="sr-only"[^>]*role="status"[^>]*aria-live="polite"/.test(html) &&
      html.indexOf('id="player-status"') > html.indexOf('id="screen-player"') &&
      html.indexOf('id="player-status"') < html.indexOf('<!-- ================= TELA 10'));
  ok("a11y: o visor do descanso NÃO é região viva (sem spam a cada 250 ms)",
    !/id="rest-timer-display"[^>]*aria-live/.test(html) && !/aria-live[^>]*id="rest-timer-display"/.test(html));
  const pauseBody = (html.match(/function pauseWorkout\(\)[\s\S]*?\n    \}/) || [""])[0];
  const resumeBody = (html.match(/function resumeWorkout\(now\)[\s\S]*?\n    \}/) || [""])[0];
  const endRestBody = (html.match(/function endRest\(mode\)[\s\S]*?\n    \}/) || [""])[0];
  const tickBody = (html.match(/function tickRest\(\)[\s\S]*?\n    \}/) || [""])[0];
  const renderBody = (html.match(/function renderRest\(rest\)[\s\S]*?\n    \}/) || [""])[0];
  ok("a11y: pausa anuncia o estado (workout_paused)",
    pauseBody.includes("announcePlayer(translations[state.lang].workout_paused)"));
  ok("a11y: retomada anuncia o estado (workout_resumed)",
    resumeBody.includes("announcePlayer(translations[state.lang].workout_resumed)"));
  ok("a11y: série concluída anuncia (set_completed)",
    html.includes("announcePlayer(translations[state.lang].set_completed)"));
  ok("a11y: descanso que vence sozinho anuncia (rest_finished)",
    endRestBody.includes("announcePlayer(translations[state.lang].rest_finished)") &&
      /mode === 'settle'/.test(endRestBody));
  ok("a11y: o ticker/render do descanso NÃO anuncia (sem ruído por tick)",
    !tickBody.includes("announcePlayer(") && !renderBody.includes("announcePlayer("));

  // --- nomes acessíveis de controles simbólicos ----------------------------
  ok("a11y: nome acessível do ✕ (sair do treino) via i18n",
    /<button class="btn btn-icon"[^>]*data-i18n-aria-label="exit_workout"[^>]*>✕<\/button>/.test(html));
  ok("a11y: nomes acessíveis dos ±15s via i18n",
    /id="btn-rest-decrease"[^>]*data-i18n-aria-label="rest_decrease"/.test(html) &&
      /id="btn-rest-increase"[^>]*data-i18n-aria-label="rest_increase"/.test(html) &&
      html.includes('onclick="adjustRestTime(-15)"') && html.includes('onclick="adjustRestTime(15)"'));

  // --- Sprint 5.3 / Inc. 2: descanso PRESCRITO no Player -------------------
  const autoRestRow = (html.match(/<div class="auto-rest-row">[\s\S]*?<\/div>\s*<\/div>/) || [""])[0];
  const restConfigRow = (html.match(/<div class="rest-config-row"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/) || [""])[0];
  ok("prescrição: controles ficam logo abaixo de Descanso Automático",
    html.indexOf('class="auto-rest-row"') !== -1 &&
      html.indexOf('class="rest-config-row"') > html.indexOf('class="auto-rest-row"') &&
      html.indexOf('class="rest-config-row"') < html.indexOf('class="player-nav-btns"') &&
      autoRestRow.length > 0 && restConfigRow.length > 0);
  ok("prescrição: − à esquerda, tempo centralizado e + à direita",
    /id="btn-player-rest-decrease"[^>]*onclick="adjustPrescribedRest\(-30\)"[\s\S]*?id="player-rest-config"[\s\S]*?id="btn-player-rest-increase"[^>]*onclick="adjustPrescribedRest\(30\)"/.test(html));
  ok("prescrição: valor em MM:SS com role=status e rótulo traduzível",
    /id="player-rest-config"[^>]*role="status"[^>]*aria-live="polite"/.test(html) &&
      /id="player-rest-config-label"[^>]*data-i18n="rest_label"/.test(html) &&
      html.includes("formatRestMMSS"));
  ok("prescrição: nomes acessíveis dos ±30s via i18n",
    /id="btn-player-rest-decrease"[^>]*data-i18n-aria-label="rest_config_decrease"/.test(html) &&
      /id="btn-player-rest-increase"[^>]*data-i18n-aria-label="rest_config_increase"/.test(html));
  ok("prescrição: limites 30 s / 3.570 s e passo de 30 s",
    html.includes("const PRESCRIBED_REST_MIN = 30") &&
      html.includes("const PRESCRIBED_REST_MAX = 3570") &&
      html.includes("const PRESCRIBED_REST_STEP = 30"));
  const nextRestBody = (html.match(/function nextPrescribedRest\(current, delta\)[\s\S]*?\n    \}/) || [""])[0];
  ok("prescrição: rest=0 permanece sem descanso até o usuário aumentar",
    nextRestBody.includes("if (value === 0) return step > 0 ? PRESCRIBED_REST_MIN : 0;"));
  ok("prescrição: primeiro ajuste normaliza valores legados para a faixa",
    nextRestBody.includes("if (target < PRESCRIBED_REST_MIN) return PRESCRIBED_REST_MIN;") &&
      nextRestBody.includes("if (target > PRESCRIBED_REST_MAX) return PRESCRIBED_REST_MAX;"));
  const adjustPrescribedBody = (html.match(/function adjustPrescribedRest\(deltaSeconds\)[\s\S]*?\n    \}/) || [""])[0];
  ok("prescrição: persiste sessão e rotina (sem tocar no timer)",
    adjustPrescribedBody.includes("WorkoutController.save(s)") &&
      adjustPrescribedBody.includes("persistRoutines(state.routines)") &&
      !adjustPrescribedBody.includes("adjustRestTime") &&
      !adjustPrescribedBody.includes("restAdd"));
  const adjustRestBody = (html.match(/function adjustRestTime\(amountSeconds\)[\s\S]*?\n    \}/) || [""])[0];
  ok("timer: ajuste rápido ±15s continua sem alterar a prescrição",
    adjustRestBody.includes("WorkoutController.restAdd") &&
      !adjustRestBody.includes("WorkoutController.save") &&
      !adjustRestBody.includes("persistRoutines") &&
      !adjustRestBody.includes(".rest ="));
  ok("a11y: helper aplica os rótulos e é reaplicado na troca de idioma",
    html.includes("function applyPlayerA11yLabels()") &&
      html.includes("querySelectorAll('[data-i18n-aria-label]')") &&
      html.includes("I18n.onChange(() => applyPlayerA11yLabels())") &&
      /I18n\.applyTranslations\(\);\s*\n\s*\/\/ E7:[^\n]*\n\s*applyPlayerA11yLabels\(\);/.test(html.replace(/\r/g, "")));
  ok("a11y: CSS .sr-only presente (conteúdo só para leitor de tela)",
    /\.sr-only\s*\{[^}]*clip:\s*rect\(0 0 0 0\)/.test(html));

  // --- foco visível / ordem de foco (escopo Player) ------------------------
  ok("a11y: foco visível (focus-visible) no Player e suas sobreposições",
    /#screen-player :focus-visible[\s\S]{0,260}?outline:\s*2px solid var\(--primary\)/.test(html) &&
      html.includes("#rest-overlay :focus-visible") &&
      html.includes("#exit-modal :focus-visible") &&
      html.includes("#resume-modal :focus-visible"));
  ok("a11y: abrir o descanso leva o foco ao primeiro controle do overlay",
    /getElementById\('btn-rest-increase'\)[\s\S]{0,80}?firstRestControl\.focus\(\)/.test(html));
  ok("a11y: fechar o descanso devolve o foco ao CTA do Player",
    /function closeRestOverlay\(\)[\s\S]{0,420}?state\.currentScreen === 'player'[\s\S]{0,160}?btn-complete-set[\s\S]{0,40}?\.focus\(\)/.test(html));

  // --- responsividade (sem media query redundante) ------------------------
  ok("resp: círculo do descanso cabe em 320 px (min(280px, 72vw))",
    /\.rest-circle-container\s*\{[^}]*width:\s*min\(280px,\s*72vw\)[^}]*height:\s*min\(280px,\s*72vw\)/.test(html));
  ok("resp: visor do descanso escala com o círculo (clamp)",
    /\.rest-time-text\s*\{[^}]*font-size:\s*clamp\(2\.4rem,\s*15vw,\s*4rem\)/.test(html));
  ok("resp: overlay rola em telas curtas (sem corte)",
    /#rest-overlay\s*\{[^}]*overflow-y:\s*auto/.test(html));
  ok("resp: alvos de toque >= 44 px no Player (escopo por ID)",
    /#screen-player \.btn-sm,\s*#screen-player \.btn-icon\s*\{[^}]*min-height:\s*44px/.test(html) &&
      /#rest-overlay \.btn\s*\{[^}]*min-height:\s*48px/.test(html));

  // --- ticker: sem render repetido enquanto o descanso está congelado ------
  ok("ticker: descanso PAUSADO não re-renderiza a cada 250 ms",
    /if \(rest\.status === 'paused'\) return;/.test(tickBody));
  ok("ticker: o intervalo continua único e suspender não é necessário",
    (html.match(/setInterval\(/g) || []).length === 1 && html.includes("setInterval(tickRest, REST_TICK_MS)"));
}

// ---------------------------------------------------------------------------
// Próximos exercícios no Player (Sprint 5.5)
// ---------------------------------------------------------------------------
function testUpcomingExercises() {
  suite("Player: próximos exercícios (Sprint 5.5)");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");
  const flat = html.replace(/\r/g, "");
  const section = (flat.match(/<section id="player-upcoming"[\s\S]*?<\/section>/) || [""])[0];
  const renderBody = (flat.match(/function renderUpcomingExercises\(s\)[\s\S]*?\n    \}/) || [""])[0];
  const nameBody = (flat.match(/function upcomingExerciseName\(ex, position\)[\s\S]*?\n    \}/) || [""])[0];
  const metaBody = (flat.match(/function upcomingExerciseMeta\(ex\)[\s\S]*?\n    \}/) || [""])[0];
  const playerBody = (flat.match(/function updatePlayerUI\(\)[\s\S]*?\n    \}/) || [""])[0];
  const innerHTMLBlock = (html.match(/id="screen-player"[\s\S]*?<!-- ================= TELA 10/) || [""])[0];

  // --- posição: ABAIXO de Anterior/Próximo --------------------------------
  ok("seção existe dentro do Player, abaixo de Anterior/Próximo",
    section.length > 0 &&
      flat.indexOf('id="player-upcoming"') > flat.indexOf('class="player-nav-btns"') &&
      flat.indexOf('id="player-upcoming"') < flat.indexOf('class="fixed-action-btn"') &&
      innerHTMLBlock.indexOf('id="player-upcoming"') !== -1);
  ok("seção nomeada por título próprio (aria-labelledby)",
    /<section id="player-upcoming"[^>]*aria-labelledby="player-upcoming-title"/.test(section) &&
      /<h3[^>]*id="player-upcoming-title"[^>]*data-i18n="upcoming_exercises"/.test(section));
  ok("lista é <ol> (ordem semântica) e vazia no HTML",
    /<ol[^>]*id="player-upcoming-list"[^>]*>\s*<\/ol>/.test(section));
  ok("mensagem de fim começa oculta e é traduzível",
    /id="player-upcoming-empty"[^>]*data-i18n="upcoming_empty"[^>]*hidden/.test(section));
  ok("contagem restante começa oculta (preenchida por JS)",
    /id="player-upcoming-remaining"[^>]*hidden/.test(section));

  // --- somente leitura ----------------------------------------------------
  ok("lista não tem botões, cliques, tabindex nem navegação",
    section.length > 0 &&
      !/<button/i.test(section) && !/onclick/i.test(section) &&
      !/tabindex/i.test(section) && !/role="button"/i.test(section) &&
      !/data-(routine|exercise)-action/i.test(section));
  ok("render não altera a sessão nem escreve em storage",
    renderBody.length > 0 &&
      !/currentExerciseIndex\s*=/.test(renderBody) &&
      !/\.exercises\s*=/.test(renderBody) &&
      !/WorkoutController\.save|Persistence|localStorage|WorkoutSession/.test(renderBody));

  // --- derivação: até 3, a partir do atual + 1 ----------------------------
  ok("limite de 3 itens é uma constante explícita",
    /const UPCOMING_LIMIT = 3;/.test(flat));
  ok("lista derivada de currentExerciseIndex + 1 com slice",
    renderBody.includes("const start = s.currentExerciseIndex + 1;") &&
      renderBody.includes("s.exercises.slice(start, start + UPCOMING_LIMIT)"));
  ok("numeração é a posição ABSOLUTA no treino",
    renderBody.includes("const position = start + i + 1;") &&
      renderBody.includes("${position}"));
  ok("restantes contados pela sessão, nunca negativos",
    renderBody.includes("Math.max(0, s.exercises.length - start)"));
  ok("fim da lista aparece quando não há próximos",
    renderBody.includes("emptyEl.hidden = upcoming.length > 0") &&
      renderBody.includes("upcoming_remaining"));

  // --- conteúdo: nome, grupo, séries/reps, sem carga/descanso -------------
  ok("usa nome do exercício e fallback 'Exercício N'",
    nameBody.includes("upcoming_fallback") && nameBody.includes("'{n}'") &&
      nameBody.includes("ex.name"));
  ok("grupo muscular e séries × repetições só quando disponíveis",
    metaBody.includes("ex.muscle") && metaBody.includes("ex.sets") &&
      metaBody.includes("ex.reps") && metaBody.includes("isFinite(sets)"));
  ok("não exibe carga nem descanso prescrito",
    !/\bweight\b|\brest\b|\bkg\b|\bCarga\b/i.test(renderBody) &&
      !/\bweight\b|\brest\b|\bkg\b/i.test(metaBody));
  ok("textos do usuário passam por escape (catalogText)",
    renderBody.includes("catalogText(upcomingExerciseName(ex, position))") &&
      renderBody.includes("catalogText(meta)"));
  ok("numeração absoluta exposta ao leitor de tela (badge não é decorativo)",
    /<span class="player-upcoming-index">\$\{position\}<\/span>/.test(renderBody) &&
      !/player-upcoming-index[^>]*aria-hidden/.test(renderBody));
  ok("semântica de lista preservada com list-style: none (role=list p/ Safari)",
    /<ol[^>]*id="player-upcoming-list"[^>]*role="list"/.test(section) &&
      /\.player-upcoming-list\s*\{[\s\S]{0,200}?list-style:\s*none/.test(flat));

  // --- integração: updatePlayerUI e idioma --------------------------------
  ok("render chamado dentro de updatePlayerUI()",
    playerBody.includes("renderUpcomingExercises(s);") &&
      playerBody.indexOf("renderUpcomingExercises(s);") < playerBody.indexOf("querySelectorAll('#screen-player [data-i18n]')"));
  ok("não re-renderiza quando a assinatura não mudou",
    renderBody.includes("if (signature === upcomingSignature) return;") &&
      renderBody.includes("state.lang"));
  ok("troca de idioma redesenha a lista derivada",
    /I18n\.onChange\(\(\) => \{\s*if \(!state\.session\) return;\s*upcomingSignature = '';\s*renderUpcomingExercises\(state\.session\);\s*\}\);/.test(flat));

  // --- responsividade e acessibilidade ------------------------------------
  ok("CSS da seção não usa largura fixa e trunca nomes longos",
    /\.player-upcoming\s*\{[^}]*margin-bottom:[^}]*\}/.test(flat) &&
      /\.player-upcoming-name,[\s\S]{0,160}?text-overflow:\s*ellipsis/.test(flat) &&
      !/\.player-upcoming\s*\{[^}]*width:\s*\d+px/.test(flat));
  ok("CSS remove marcadores da lista e respeita [hidden]",
    /\.player-upcoming-list\s*\{[^}]*list-style:\s*none/.test(flat) &&
      /\.player-upcoming-note\[hidden\]\s*\{\s*display:\s*none/.test(flat));
  ok("seção não cria região viva (sem ruído para leitor de tela)",
    !/aria-live/i.test(section) && !/role="status"/i.test(section));

  // --- regressões: timer, descanso, CTA e pausa continuam no lugar --------
  ok("updatePlayerUI preserva timer, descanso prescrito e CTA",
    playerBody.includes("player-rest-config") &&
      playerBody.includes("btn-complete-set") &&
      playerBody.includes("btn-prev-ex"));
  ok("pausa/retomada continuam chamando updatePlayerUI",
    (flat.match(/function pauseWorkout\(\)[\s\S]*?\n    \}/) || [""])[0].includes("updatePlayerUI();") &&
      (flat.match(/function resumeWorkout\(now\)[\s\S]*?\n    \}/) || [""])[0].includes("updatePlayerUI();"));
  ok("navegação anterior/próximo continua redesenhando o Player",
    (flat.match(/function prevExercise\(\)[\s\S]*?\n    \}/) || [""])[0].includes("updatePlayerUI();") &&
      (flat.match(/function nextExercise\(\)[\s\S]*?\n    \}/) || [""])[0].includes("updatePlayerUI();"));
}

// ---------------------------------------------------------------------------
// Overlay de descanso como diálogo modal (E7.1)
// ---------------------------------------------------------------------------
function testRestOverlayDialogE71() {
  suite("Overlay de descanso: diálogo modal (E7.1)");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");

  const overlayTag = (html.match(/<div id="rest-overlay"[^>]*>/) || [""])[0];
  const keydownBody = (html.match(/function restTrapKeydown\(e\)[\s\S]*?\n    \}/) || [""])[0];
  const engageBody = (html.match(/function engageRestFocusTrap\(\)[\s\S]*?\n    \}/) || [""])[0];
  const releaseBody = (html.match(/function releaseRestFocusTrap\(\)[\s\S]*?\n    \}/) || [""])[0];
  const startBody = (html.match(/function startRestTimer\(seconds\)[\s\S]*?\n    \}/) || [""])[0];
  const closeBody = (html.match(/function closeRestOverlay\(\)[\s\S]*?\n    \}/) || [""])[0];

  // --- semântica do diálogo ------------------------------------------------
  ok("semântica: overlay é role=dialog com aria-modal e nome pelo próprio título",
    /role="dialog"/.test(overlayTag) && /aria-modal="true"/.test(overlayTag) &&
      /aria-labelledby="rest-overlay-label"/.test(overlayTag) &&
      /id="rest-overlay-label"[^>]*data-i18n="rest_label"/.test(html));

  // --- contenção de foco ---------------------------------------------------
  ok("foco: lista de focáveis restrita ao overlay",
    html.includes("function restFocusables()") &&
      html.includes("'#rest-overlay button:not([disabled]), #rest-overlay [href], '"));
  ok("foco: Tab no último controle volta ao primeiro (e Shift+Tab no primeiro vai ao último)",
    /if \(e\.key !== 'Tab'\) return;/.test(keydownBody) &&
      /e\.shiftKey/.test(keydownBody) && /active === first/.test(keydownBody) &&
      /active === last/.test(keydownBody) && /last\.focus\(\)/.test(keydownBody) &&
      /first\.focus\(\)/.test(keydownBody));
  ok("foco: foco fora do overlay é trazido para dentro",
    /const inside = items\.indexOf\(active\) !== -1;/.test(keydownBody) &&
      /!inside/.test(keydownBody));
  ok("foco: Escape fecha pelo caminho seguro (skipRest, mesmo do Pular)",
    /if \(e\.key === 'Escape'\)/.test(keydownBody) && /skipRest\(\);/.test(keydownBody));
  ok("foco: abrir o descanso engaja a contenção",
    startBody.includes("engageRestFocusTrap();"));
  ok("foco: fechar o descanso SEMPRE libera a contenção",
    closeBody.includes("releaseRestFocusTrap();"));
  ok("foco: contenção é idempotente e simétrica (add/remove com captura)",
    /if \(restTrapActive\) return;[\s\S]{0,60}?restTrapActive = true;[\s\S]{0,80}?addEventListener\('keydown', restTrapKeydown, true\)/.test(engageBody) &&
      /if \(!restTrapActive\) return;[\s\S]{0,60}?restTrapActive = false;[\s\S]{0,80}?removeEventListener\('keydown', restTrapKeydown, true\)/.test(releaseBody));
  ok("foco: um único ponto de engajamento/liberação na UI",
    (html.match(/engageRestFocusTrap\(\);/g) || []).length === 1 &&
      (html.match(/releaseRestFocusTrap\(\);/g) || []).length === 1 &&
      /function engageRestFocusTrap\(\)/.test(html) && /function releaseRestFocusTrap\(\)/.test(html));
}

// ---------------------------------------------------------------------------
// Home semanal: leituras puras do histórico (Sprint 5.1)
// ---------------------------------------------------------------------------
function testHomeInsights() {
  suite("HomeInsights: resumo semanal (Sprint 5.1)");

  const src = fs.readFileSync(path.join(ROOT, "js/home-insights.js"), "utf8");
  const sb = makeSandbox();
  loadModules(sb, ["js/home-insights.js"]);
  const H = sb.HomeInsights;

  // Datas fixas (sem relógio): 18/10/2026 é domingo, 12/10/2026 é segunda.
  const MON = new Date(2026, 9, 12, 9, 0, 0);
  const TUE = new Date(2026, 9, 13, 9, 0, 0);
  const WED = new Date(2026, 9, 14, 18, 30, 0);
  const THU = new Date(2026, 9, 15, 10, 0, 0);
  const SUN = new Date(2026, 9, 18, 12, 0, 0);
  const NEXT_MON = new Date(2026, 9, 19, 9, 0, 0);
  const WEEK = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];

  const entry = (extra) => Object.assign({ name: "Treino", status: "completed" }, extra);

  // --- forma do módulo -----------------------------------------------------
  ok("expõe build + meta padrão de cardio (150)",
    typeof H.build === "function" && H.DEFAULT_CARDIO_GOAL === 150);
  ok("módulo puro: sem DOM, armazenamento, persistência, rede ou aleatoriedade",
    !/document|localStorage|sessionStorage|Persistence|StorageService|window\.|Math\.random|fetch\(/.test(src));
  ok("módulo opera sem document/localStorage no sandbox", typeof sb.HomeInsights.build === "function");

  // --- semana segunda → domingo -------------------------------------------
  const wed = H.build([], WED);
  eq("sete dias, de segunda a domingo", wed.days.map((d) => d.dateISO), WEEK);
  eq("índices dos dias 0..6", wed.days.map((d) => d.weekdayIndex), [0, 1, 2, 3, 4, 5, 6]);
  eq("dia do mês de cada célula", wed.days.map((d) => d.dayOfMonth), [12, 13, 14, 15, 16, 17, 18]);
  ok("limites da semana expostos", wed.weekStartISO === "2026-10-12" && wed.weekEndISO === "2026-10-18");
  ok("marca apenas o dia de referência como 'hoje'",
    wed.days.filter((d) => d.isToday).length === 1 && wed.days[2].isToday === true);

  // --- determinismo e virada de semana ------------------------------------
  eq("determinístico por entrada (mesma referência -> mesmo resultado)",
    JSON.stringify(H.build([], WED)), JSON.stringify(H.build([], WED)));
  ok("domingo pertence à mesma semana da segunda",
    H.build([], SUN).weekStartISO === "2026-10-12" &&
    H.build([], MON).weekStartISO === "2026-10-12");
  ok("virada de semana: segunda seguinte abre uma semana nova",
    H.build([], NEXT_MON).weekStartISO === "2026-10-19" &&
    H.build([], NEXT_MON).weekEndISO === "2026-10-25" && H.build([], NEXT_MON).days[0].dateISO === "2026-10-19");
  ok("startOfWeek devolve segunda à meia-noite",
    H.startOfWeek(WED).getDay() === 1 && H.startOfWeek(WED).getHours() === 0 &&
    H.startOfWeek(WED).getDate() === 12);

  // --- agrupamento de vários treinos no mesmo dia -------------------------
  const multi = H.build([
    entry({ id: 10, dateISO: "2026-10-14", name: "Treino A" }),
    entry({ id: 30, dateISO: "2026-10-14", name: "Treino C" }),
    entry({ id: 20, dateISO: "2026-10-14", name: "Treino B" }),
  ], WED);
  ok("três treinos no mesmo dia: conta 3, mostra o ÚLTIMO e sinaliza os excedentes",
    multi.days[2].count === 3 && multi.days[2].extra === 2 && multi.days[2].entry.id === 30 &&
    multi.days[2].entry.name === "Treino C");
  const byTime = H.build([
    entry({ id: 1, dateISO: "2026-10-13", name: "Mais cedo", finishedAt: "2026-10-13T09:00:00" }),
    entry({ id: 2, dateISO: "2026-10-13", name: "Mais tarde", finishedAt: "2026-10-13T20:00:00" }),
  ], WED);
  ok("último do dia pelo instante (finishedAt) e não pela ordem do array",
    byTime.days[1].entry.name === "Mais tarde" && byTime.days[1].extra === 1);

  // --- dias vazios ---------------------------------------------------------
  ok("dias sem treino ficam vazios (entry nula, count 0, extra 0)",
    wed.days[0].count === 0 && wed.days[0].entry === null && wed.days[0].extra === 0);

  // --- histórico legado (sem dateISO) -------------------------------------
  const legacy = [
    { id: 1, name: "Treino legado", date: "Ontem, 18:30", duration: "50 min", status: "completed" },
    { id: 2, name: "Texto enganoso", date: "Segunda, 07:00", status: "completed" },
  ];
  const legacyOut = H.build(legacy, WED);
  ok("histórico sem dateISO não entra em nenhum dia e não lança",
    legacyOut.days.every((d) => d.count === 0) && legacyOut.consecutiveDays === 0 &&
    legacyOut.cardioMinutes === 0);
  ok("dateISO inválido ('2026-13-45', 'ontem') é ignorado",
    H.build([
      entry({ dateISO: "2026-13-45" }), entry({ dateISO: "ontem" }), entry({ dateISO: 20261014 }),
    ], WED).days.every((d) => d.count === 0));
  ok("entradas não-objeto são toleradas",
    H.build([null, 7, "x", entry({ dateISO: "2026-10-14", id: 9 })], WED).days[2].count === 1 &&
    H.build(null, WED).days.length === 7);

  // --- cardio --------------------------------------------------------------
  const cardio = H.build([
    entry({ dateISO: "2026-10-13", category: "cardio", durationMin: 30 }),
    entry({ dateISO: "2026-10-14", type: "cardio", durationMin: "20" }),
    entry({ dateISO: "2026-10-14", durationMin: 45 }),                    // força: fora do total
    entry({ dateISO: "2026-10-05", category: "cardio", durationMin: 99 }), // fora da semana
  ], WED);
  eq("cardio soma apenas category/type 'cardio' da semana (min)", cardio.cardioMinutes, 50);
  eq("meta padrão de cardio", cardio.cardioGoal, 150);
  ok("meta inválida cai no padrão de 150",
    H.build([], WED, 0).cardioGoal === 150 && H.build([], WED, -5).cardioGoal === 150 &&
    H.build([], WED, "x").cardioGoal === 150 && H.build([], WED, null).cardioGoal === 150);
  ok("meta customizada é respeitada", H.build([], WED, 300).cardioGoal === 300);
  ok("sem cardio registrado o total é zero",
    H.build([entry({ dateISO: "2026-10-13" })], WED).cardioMinutes === 0);
  ok("cardio exige a marcação: type/category diferentes não contam",
    H.build([
      entry({ dateISO: "2026-10-13", category: "strength", type: "forca", durationMin: 60 }),
    ], WED).cardioMinutes === 0);

  // --- dias consecutivos ---------------------------------------------------
  const streak = (hist, ref) => H.build(hist, ref).consecutiveDays;
  eq("sequência de três dias até a referência", streak([
    entry({ dateISO: "2026-10-12" }), entry({ dateISO: "2026-10-13" }), entry({ dateISO: "2026-10-14" }),
  ], WED), 3);
  eq("parcial NÃO conta no lugar do dia concluído", streak([
    entry({ dateISO: "2026-10-12" }), entry({ dateISO: "2026-10-13" }),
    entry({ dateISO: "2026-10-14", status: "partial" }),
  ], WED), 2);
  eq("só parcial -> sequência zero", streak([entry({ dateISO: "2026-10-14", status: "partial" })], WED), 0);
  eq("tolerância de um dia: ainda não treinou hoje, a sequência de ontem vale", streak([
    entry({ dateISO: "2026-10-12" }), entry({ dateISO: "2026-10-13" }), entry({ dateISO: "2026-10-14" }),
  ], THU), 3);
  eq("buraco na sequência zera o contador", streak([entry({ dateISO: "2026-10-12" })], WED), 0);
  eq("vários treinos no mesmo dia contam um único dia", streak([
    entry({ dateISO: "2026-10-14" }), entry({ dateISO: "2026-10-14" }),
  ], WED), 1);
  eq("sequência atravessa a virada de semana (sáb, dom, seg)", streak([
    entry({ dateISO: "2026-10-17" }), entry({ dateISO: "2026-10-18" }), entry({ dateISO: "2026-10-19" }),
  ], NEXT_MON), 3);
  eq("legado sem dateISO não gera sequência", streak(legacy, THU), 0);

  // --- leitura pura (não muta a entrada) ----------------------------------
  const original = [
    entry({ id: 1, dateISO: "2026-10-14", name: "Treino A" }),
    entry({ id: 2, dateISO: "2026-10-13", category: "cardio", durationMin: 15 }),
  ];
  const snapshot = JSON.stringify(original);
  H.build(original, WED, 200);
  eq("build não muta o histórico recebido", JSON.stringify(original), snapshot);
  ok("build expõe as chaves do resumo",
    ["weekStartISO", "weekEndISO", "days", "cardioMinutes", "cardioGoal", "consecutiveDays"]
      .every((k) => k in H.build([], WED)));

  // --- cards "Treino de hoje" / "Último treino" (Sprint 5.1.1) -------------
  ok("expõe todayWorkout + lastWorkout",
    typeof H.todayWorkout === "function" && typeof H.lastWorkout === "function");
  ok("histórico vazio: os dois cards ficam sem dado (nada é inventado)",
    H.todayWorkout([], WED) === null && H.lastWorkout([], WED) === null &&
    H.todayWorkout(null, WED) === null && H.lastWorkout(null, WED) === null);
  ok("legado sem dateISO não alimenta os cards",
    H.todayWorkout(legacy, WED) === null && H.lastWorkout(legacy, WED) === null);

  const cards = [
    entry({ id: 1, dateISO: "2026-10-14", name: "Treino A — Peito", durationMin: 30,
      exercises: [{ name: "Supino" }, { name: "Crucifixo" }] }),
    entry({ id: 2, dateISO: "2026-10-14", name: "Treino C — Pernas", durationMin: 42,
      exercises: [{ name: "Agachamento" }], finishedAt: "2026-10-14T20:00:00" }),
    entry({ id: 3, dateISO: "2026-10-13", name: "Treino B — Costas", durationMin: 50 }),
  ];
  const cardToday = H.todayWorkout(cards, WED);
  eq("card de hoje: resumo do ÚLTIMO registro do dia (um único registro, sem mistura)",
    [cardToday.name, cardToday.exercises, cardToday.durationMin, cardToday.status],
    ["Treino C — Pernas", 1, 42, "completed"]);
  ok("card de hoje: aponta para o próprio registro do dia",
    cardToday.entry === cards[1]);
  ok("card de hoje: sem registro no dia da referência -> null (estado vazio)",
    H.todayWorkout(cards, THU) === null && H.todayWorkout(cards, MON) === null);

  const cardLastWed = H.lastWorkout(cards, WED);
  eq("último treino: registro datado mais recente + daysAgo",
    [cardLastWed.name, cardLastWed.dateISO, cardLastWed.daysAgo, cardLastWed.durationMin],
    ["Treino C — Pernas", "2026-10-14", 0, 42]);
  eq("último treino: daysAgo em dias locais (ontem = 1)",
    [H.lastWorkout(cards, THU).name, H.lastWorkout(cards, THU).daysAgo],
    ["Treino C — Pernas", 1]);
  eq("último treino: distância maior (5 dias depois)", H.lastWorkout(cards, NEXT_MON).daysAgo, 5);
  ok("último treino: empate de data resolve pelo instante conhecido",
    H.lastWorkout([
      entry({ id: 1, dateISO: "2026-10-14", name: "Mais cedo", finishedAt: "2026-10-14T08:00:00" }),
      entry({ id: 2, dateISO: "2026-10-14", name: "Mais tarde", finishedAt: "2026-10-14T21:00:00" }),
    ], WED).name === "Mais tarde");
  ok("último treino: registro parcial é o último treino e preserva o status",
    H.lastWorkout([entry({ dateISO: "2026-10-14", name: "Parcial", status: "partial" })], WED).status === "partial");
  ok("cards: duração/séries inválidas viram neutro (sem contaminação)",
    [H.todayWorkout([entry({ dateISO: "2026-10-14", durationMin: "x" })], WED).durationMin,
     H.todayWorkout([entry({ dateISO: "2026-10-14", durationMin: -5 })], WED).durationMin,
     H.todayWorkout([entry({ dateISO: "2026-10-14" })], WED).exercises],
    [0, 0, 0]);
  ok("cards: registro sem nome não ganha nome inventado",
    H.todayWorkout([{ dateISO: "2026-10-14", status: "completed" }], WED).name === "");
  ok("cards: data no futuro não gera daysAgo negativo",
    H.lastWorkout([entry({ dateISO: "2026-10-20" })], WED).daysAgo === 0);
  ok("cards: dateISO inválido é ignorado nos dois cards",
    H.todayWorkout([entry({ dateISO: "ontem" })], WED) === null &&
    H.lastWorkout([entry({ dateISO: "2026-13-45" })], WED) === null);

  const cardsSnapshot = JSON.stringify(cards);
  H.todayWorkout(cards, WED);
  H.lastWorkout(cards, WED);
  eq("cards não mutam o histórico recebido", JSON.stringify(cards), cardsSnapshot);

  // --- "Últimos treinos": faixa de concluídos (Sprint 5.1.2) ----------------
  ok("expõe recentCompletedWorkouts + limite de 7",
    typeof H.recentCompletedWorkouts === "function" && H.RECENT_LIMIT === 7);
  eq("histórico vazio/válido-ausente: faixa vazia (nada é inventado)",
    [H.recentCompletedWorkouts([], WED).length, H.recentCompletedWorkouts(null, WED).length,
     H.recentCompletedWorkouts(undefined, WED).length, H.recentCompletedWorkouts("x", WED).length],
    [0, 0, 0, 0]);
  eq("legado sem dateISO fica FORA da faixa (mas segue no histórico)",
    H.recentCompletedWorkouts(legacy, WED).length, 0);
  eq("parcial e status desconhecido/ausente não entram na faixa",
    H.recentCompletedWorkouts([
      entry({ dateISO: "2026-10-14", name: "Parcial", status: "partial" }),
      entry({ dateISO: "2026-10-14", name: "Cancelado", status: "cancelled" }),
      { dateISO: "2026-10-14", name: "Sem status" },
      entry({ dateISO: "2026-10-14", name: "Válido" }),
    ], WED).map((w) => w.name), ["Válido"]);
  eq("dateISO inválido e entradas não-objeto são tolerados",
    H.recentCompletedWorkouts([
      entry({ dateISO: "ontem", name: "Texto" }), entry({ dateISO: "2026-13-45", name: "Data" }),
      null, 7, "x", entry({ dateISO: "2026-10-14", name: "Ok" }),
    ], WED).map((w) => w.name), ["Ok"]);

  const many = [
    entry({ dateISO: "2026-10-18", name: "D0" }), entry({ dateISO: "2026-10-17", name: "D1" }),
    entry({ dateISO: "2026-10-16", name: "D2" }), entry({ dateISO: "2026-10-15", name: "D3" }),
    entry({ dateISO: "2026-10-14", name: "D4" }), entry({ dateISO: "2026-10-13", name: "D5" }),
    entry({ dateISO: "2026-10-12", name: "D6" }), entry({ dateISO: "2026-10-11", name: "D7" }),
  ];
  eq("ordena do mais recente para o mais antigo e corta em 7 (sem inventar 8º)",
    H.recentCompletedWorkouts(many, undefined, SUN).map((w) => w.name),
    ["D0", "D1", "D2", "D3", "D4", "D5", "D6"]);
  eq("com menos de 7 concluídos devolve menos itens",
    H.recentCompletedWorkouts(many.slice(0, 3), undefined, SUN).length, 3);
  eq("limite explícito é respeitado (3)",
    H.recentCompletedWorkouts(many, 3, SUN).map((w) => w.name), ["D0", "D1", "D2"]);
  eq("limite inválido cai no padrão de 7",
    [H.recentCompletedWorkouts(many, 0, SUN).length, H.recentCompletedWorkouts(many, -2, SUN).length,
     H.recentCompletedWorkouts(many, "x", SUN).length, H.recentCompletedWorkouts(many, null, SUN).length],
    [7, 7, 7, 7]);
  eq("referência sem registro: daysAgo por item (ontem = 1, data absoluta depois)",
    H.recentCompletedWorkouts(many.slice(0, 3), undefined, NEXT_MON).map((w) => w.daysAgo), [1, 2, 3]);

  const recentCards = H.recentCompletedWorkouts([
    entry({ id: 1, dateISO: "2026-10-14", name: "Pernas", durationMin: 42,
      exercises: [{ name: "Agachamento" }] }),
    entry({ id: 2, dateISO: "2026-10-14", name: "Peito", durationMin: "x" }),
  ], undefined, WED);
  eq("cada card resume UM registro (nome, duração válida, exercícios) sem misturar",
    [recentCards[1].name, recentCards[1].durationMin, recentCards[1].exercises,
     recentCards[1].dateISO, recentCards[1].daysAgo],
    ["Pernas", 42, 1, "2026-10-14", 0]);
  ok("duração ausente/inválida vira neutro (0) e nunca é inventada",
    recentCards[0].durationMin === 0 && recentCards[0].exercises === 0);
  eq("o empate de data resolve pelo instante conhecido (finishedAt mais recente primeiro)",
    H.recentCompletedWorkouts([
      entry({ id: 1, dateISO: "2026-10-14", name: "Mais cedo", finishedAt: "2026-10-14T08:00:00" }),
      entry({ id: 2, dateISO: "2026-10-14", name: "Mais tarde", finishedAt: "2026-10-14T21:00:00" }),
    ], undefined, WED).map((w) => w.name), ["Mais tarde", "Mais cedo"]);
  eq("empate sem instante conhecido cai na ordem do histórico (determinístico)",
    H.recentCompletedWorkouts([
      entry({ dateISO: "2026-10-14", name: "Primeiro" }),
      entry({ dateISO: "2026-10-14", name: "Segundo" }),
      entry({ dateISO: "2026-10-14", name: "Terceiro" }),
    ], undefined, WED).map((w) => w.name), ["Primeiro", "Segundo", "Terceiro"]);
  eq("instante conhecido tem prioridade sobre a ordem do histórico",
    H.recentCompletedWorkouts([
      entry({ dateISO: "2026-10-14", name: "Sem instante" }),
      entry({ dateISO: "2026-10-14", name: "Com instante", id: 5000 }),
    ], undefined, WED).map((w) => w.name), ["Com instante", "Sem instante"]);
  ok("sem histórico de sequência: data no futuro não gera daysAgo negativo",
    H.recentCompletedWorkouts([entry({ dateISO: "2026-10-20" })], undefined, WED)[0].daysAgo === 0);

  const recentSnapshot = JSON.stringify(many);
  H.recentCompletedWorkouts(many, undefined, SUN);
  eq("a faixa não muta o histórico recebido", JSON.stringify(many), recentSnapshot);
  ok("a faixa não reordena o array original (cópia interna)",
    many[0].name === "D0" && many[7].name === "D7");

  // --- M1 (Sprint 5.1.3): regras temporais nas bordas ----------------------
  // Todas as datas abaixo são verificadas contra o calendário: 2026-12-28 é
  // segunda e 2027-01-03 é domingo; 2026-03-30 é segunda e 2026-04-05 domingo.
  const NEW_YEAR_MON = new Date(2026, 11, 28, 8, 0, 0);  // segunda, 28/12/2026
  const NEW_YEAR_SUN = new Date(2027, 0, 3, 12, 0, 0);   // domingo, 03/01/2027
  const newYear = H.build([], NEW_YEAR_MON);
  eq("virada de ANO: sete dias de 28/12/2026 a 03/01/2027 (segunda a domingo)",
    newYear.days.map((d) => d.dateISO),
    ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31",
     "2027-01-01", "2027-01-02", "2027-01-03"]);
  ok("virada de ano: limites expostos e o ano do calendário acompanha o dia",
    newYear.weekStartISO === "2026-12-28" && newYear.weekEndISO === "2027-01-03" &&
    newYear.days[4].dateISO === "2027-01-01" && newYear.days[4].dayOfMonth === 1 &&
    newYear.days[4].weekdayIndex === 4 &&
    H.build([], NEW_YEAR_SUN).weekStartISO === "2026-12-28" &&
    H.build([], NEW_YEAR_SUN).days[6].isToday === true);
  eq("virada de ano: dias consecutivos atravessam 31/12 -> 01/01",
    streak([
      entry({ dateISO: "2026-12-31" }), entry({ dateISO: "2027-01-01" }),
      entry({ dateISO: "2027-01-02" }),
    ], new Date(2027, 0, 2, 9, 0, 0)), 3);

  const MAR_MON = new Date(2026, 2, 30, 9, 0, 0);        // segunda, 30/03/2026
  const month = H.build([], MAR_MON);
  eq("virada de MÊS: sete dias de 30/03/2026 a 05/04/2026",
    month.days.map((d) => d.dateISO),
    ["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
     "2026-04-03", "2026-04-04", "2026-04-05"]);
  ok("virada de mês: dia 01/04 é quarta (índice 2) e o domingo fecha a semana",
    month.days[2].dateISO === "2026-04-01" && month.days[2].weekdayIndex === 2 &&
    month.days[6].weekdayIndex === 6 && month.weekEndISO === "2026-04-05");

  // meia-noite: o dia é LOCAL e a virada acontece exatamente na meia-noite
  const MIDNIGHT = new Date(2026, 9, 14, 23, 59, 59);
  ok("meia-noite: 23:59:59 ainda é o MESMO dia local (card de hoje e faixa)",
    H.build([entry({ dateISO: "2026-10-14", name: "Hoje" })], MIDNIGHT).days[2].isToday === true &&
    H.todayWorkout([entry({ dateISO: "2026-10-14", name: "Hoje" })], MIDNIGHT).name === "Hoje" &&
    H.recentCompletedWorkouts([entry({ dateISO: "2026-10-14" })], undefined, MIDNIGHT)[0].daysAgo === 0);
  ok("meia-noite: um segundo depois já é outro dia (ontem não é 'hoje')",
    H.build([entry({ dateISO: "2026-10-14" })], new Date(2026, 9, 15, 0, 0, 1)).days[3].isToday === true &&
    H.build([entry({ dateISO: "2026-10-14" })], new Date(2026, 9, 15, 0, 0, 1)).days[2].isToday === false &&
    H.todayWorkout([entry({ dateISO: "2026-10-14" })], new Date(2026, 9, 15, 0, 0, 1)) === null);

  // dateISO é a única fonte do DIA; startedAt/finishedAt só desempatam instantes
  ok("o DIA vem sempre de dateISO (startedAt/finishedAt não movem o treino de dia)",
    H.build([
      entry({ dateISO: "2026-10-14", startedAt: "2026-10-13T23:40:00",
        finishedAt: "2026-10-14T00:20:00" }),
    ], WED).days.map((d) => d.count).join() === "0,0,1,0,0,0,0" &&
    H.build([
      entry({ dateISO: "2026-10-13", startedAt: "2026-10-12T23:40:00",
        finishedAt: "2026-10-13T00:20:00" }),
    ], WED).days[1].count === 1 &&
    H.build([
      entry({ dateISO: "2026-10-13", name: "Ontem" }),
    ], WED).consecutiveDays === 1);

  // coerência entre as três leituras do MESMO histórico
  const consistente = [
    entry({ dateISO: "2026-10-11", name: "Fora da semana" }),   // domingo anterior
    entry({ dateISO: "2026-10-12", name: "Seg" }),
    entry({ dateISO: "2026-10-14", name: "Qua A", status: "partial" }),
    entry({ dateISO: "2026-10-14", name: "Qua B" }),
  ];
  ok("mesmo histórico: semana, dias consecutivos e faixa leem os mesmos registros",
    H.build(consistente, WED).days.filter((d) => d.count > 0).length === 2 &&
    H.build(consistente, WED).days[2].count === 2 && H.build(consistente, WED).days[2].extra === 1 &&
    H.build(consistente, WED).days[2].entry.name === "Qua B" &&
    H.build(consistente, WED).consecutiveDays === 1 &&
    H.recentCompletedWorkouts(consistente, undefined, WED).map((w) => w.name).join() ===
      "Qua B,Seg,Fora da semana");

  // --- B1 (Sprint 5.1.3): semântica do "+N" da faixa semanal --------------
  ok("B1: '+' é o número de EXCEDENTES além do treino exibido (total - 1)",
    multi.days[2].count === 3 && multi.days[2].extra === 2 &&
    multi.days[2].extra === multi.days[2].count - 1);
  ok("B1: dia com um único treino não tem excedente (nenhum '+N' é desenhado)",
    H.build([entry({ dateISO: "2026-10-12" })], WED).days[0].count === 1 &&
    H.build([entry({ dateISO: "2026-10-12" })], WED).days[0].extra === 0);
  ok("B1: dia vazio tem count e extra zerados (nenhum dia é inventado)",
    H.build([], WED).days.every((d) => d.count === 0 && d.extra === 0));
}

// ---------------------------------------------------------------------------
// Home semanal: integração na Home (Sprint 5.1)
// ---------------------------------------------------------------------------
function testHomeWeeklyWiring() {
  suite("Home semanal: integração (Sprint 5.1)");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");
  const inlineStart = html.indexOf("<script>\n    // ================= CATÁLOGO REAL");

  // --- módulo carregado antes do script principal --------------------------
  ok("carrega js/home-insights.js antes do script principal",
    html.includes('<script src="js/home-insights.js"></script>') &&
    html.indexOf('<script src="js/home-insights.js"></script>') < inlineStart);

  // --- elementos da Home (o markup não traz dado semanal mockado) ----------
  ok("faixa semanal é uma lista vazia no markup (preenchida pelo render)",
    /<div id="home-weekly-strip" class="weekly-strip" role="list" data-i18n-label="weekly_strip_label"><\/div>/.test(html));
  ok("cards de cardio e dias consecutivos presentes com valores neutros",
    html.includes('id="home-cardio-value"') && html.includes('id="home-streak-value"') &&
    />0 \/ 150 min</.test(html));
  // Sprint 5.1.4: a legenda redundante "atingido / meta" saiu do card de cardio —
  // título e valor continuam no markup (a chave segue no dicionário, ver KEYS51).
  ok("Sprint 5.1.4: legenda do cardio removida do markup (título e valor preservados)",
    !/class="home-metric-note"/.test(html) && !/data-i18n="cardio_goal"/.test(html) &&
    /id="home-cardio-value"[^>]*>0 \/ 150 min</.test(html) &&
    /data-i18n="cardio_week"/.test(html));

  // --- render derivado do módulo puro --------------------------------------
  const body = (html.match(/function renderHome\(\)[\s\S]*?\n    \}/) || [""])[0];
  ok("renderHome deriva do módulo puro com data explícita (uma única referência)",
    body.includes("const now = new Date();") && body.includes("HomeInsights.build(state.history, now)"));
  ok("renderHome escapa texto vindo do histórico",
    body.includes("TTUtils.escapeHtml("));
  ok("renderHome usa as chaves de i18n da 5.1 (dias, contadores, vazio)",
    body.includes("HOME_WEEKDAY_KEYS") && body.includes("t.workouts_count") &&
    body.includes("t.no_workout") && body.includes("t.days") && body.includes("data-i18n-label"));
  ok("renderHome preenche os três alvos (faixa, cardio, streak)",
    body.includes("home-weekly-strip") && body.includes("home-cardio-value") &&
    body.includes("home-streak-value") && body.includes("insights.cardioMinutes") &&
    body.includes("insights.consecutiveDays"));

  // --- pontos de atualização ------------------------------------------------
  const navigateBody = (html.match(/function navigate\(screenId, param = null\)[\s\S]*?\n    \}/) || [""])[0];
  ok("navegar para a Home atualiza o resumo",
    /if \(screenId === 'home'\) renderHome\(\);/.test(navigateBody));
  const saveBody = (html.match(/function saveSessionToHistory\(status\)[\s\S]*?\n    \}/) || [""])[0];
  ok("salvar treino no histórico atualiza o resumo antes de qualquer navegação",
    /Persistence\.saveHistory\(state\.history\);[\s\S]{0,400}?renderHome\(\);/.test(saveBody));
  ok("troca de idioma redesenha o resumo",
    /I18n\.onChange\(\(\) => renderHome\(\)\);/.test(html));

  // --- nada de conteúdo semanal mockado -----------------------------------
  ok("nenhum dia/valor semanal hardcoded no markup da Home",
    !/weekly-day(-name|-date|-workout|-more)?["' >]/.test(html.slice(html.indexOf('id="screen-home"'), html.indexOf('id="screen-workouts"'))) &&
    !/\b\+2\b/.test(html.slice(html.indexOf('id="home-weekly-strip"'), html.indexOf('id="screen-workouts"'))));

  // --- i18n: chaves da 5.1 presentes e consistentes nos 3 idiomas ---------
  const isb = makeSandbox();
  loadModules(isb, ["js/i18n.js"]);
  const dict = isb.I18n.dict;
  const KEYS51 = ["weekly_summary", "weekly_strip_label", "no_workout", "workouts_count",
    "cardio_week", "cardio_goal", "consecutive_days", "days",
    "weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];
  ok("15 chaves da 5.1 em pt/en/es",
    KEYS51.length === 15 &&
    ["pt", "en", "es"].every((l) => KEYS51.every((k) => typeof dict[l][k] === "string" && dict[l][k].trim() !== "")));
  ok("os 7 nomes de dia existem e são curtos (célula da faixa)",
    ["pt", "en", "es"].every((l) =>
      ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"]
        .every((k) => dict[l][k].length > 0 && dict[l][k].length <= 5)));
}

// ---------------------------------------------------------------------------
// Home: "Treino de hoje" + faixa "Últimos treinos" sem dado mockado (E5.1.1/5.1.2)
// ---------------------------------------------------------------------------
function testHomeCardsWiring() {
  suite("Home: card de hoje e faixa de últimos treinos (Sprint 5.1.1/5.1.2)");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");
  const home = html.slice(html.indexOf('id="screen-home"'), html.indexOf('id="screen-workouts"'));

  // --- card de destaque "Treino de hoje" (5.1.1, preservado) ---------------
  ok("card de destaque tem alvos para nome, exercícios e duração",
    /id="home-today-name"/.test(home) && /id="home-today-exercises"/.test(home) &&
    /id="home-today-duration"/.test(home));
  ok("os alvos do dia começam neutros (—)",
    /id="home-today-name">—<\/h3>/.test(home) &&
    /id="home-today-exercises"[^>]*>—<\/p>/.test(home) &&
    /id="home-today-duration"[^>]*>—<\/p>/.test(home));
  ok("o rótulo do card de hoje é i18n (hoje o título é dado real, não tradução)",
    /data-i18n="today_workout"/.test(home));

  // --- seção "Últimos treinos" (5.1.2) -------------------------------------
  ok("seção 'Últimos treinos' substituiu o card único de último treino",
    /id="home-recent-title"[^>]*data-i18n="recent_workouts"/.test(home) &&
    !/id="home-last-name"/.test(home) && !/id="home-last-meta"/.test(home) &&
    !/id="home-last-status"/.test(home));
  ok("a faixa é uma lista vazia no markup, com rótulo acessível e foco de teclado",
    /<div id="home-recent-strip" class="recent-strip" role="list" tabindex="0" data-i18n-label="recent_strip_label"><\/div>/.test(home));
  ok("estado vazio localizado no markup (nenhum card fictício de reserva)",
    /id="home-recent-empty"[^>]*data-i18n="no_recent_workouts"[^>]*>/.test(home));
  ok("botão 'Ver histórico completo' reutiliza navigate('history')",
    /<button[^>]*onclick="navigate\('history'\)"[^>]*data-i18n="see_full_history"/.test(home));
  ok("nenhum dado fictício remanescente na seção de treinos recentes",
    !/Treino A — Peito e Tríceps|Treino B — Costas e Bíceps|Ontem • 50 min|>45 min<|>6</.test(home));
  ok("nenhuma tela/lista de histórico duplicada (a tela existente é reusada)",
    !/id="screen-recent"|id="home-history-list"|id="recent-history-container"/.test(html) &&
    /id="screen-history"/.test(html));

  // --- render (5.1.2) ------------------------------------------------------
  const body = (html.match(/function renderHome\(\)[\s\S]*?\n    \}/) || [""])[0];
  const helper = (html.match(/function homeDayLabel\([\s\S]*?\n    \}/) || [""])[0];
  ok("renderHome deriva o card de hoje do histórico real",
    body.includes("HomeInsights.todayWorkout(state.history"));
  ok("renderHome deriva a faixa da seleção pura (limite de 7 explícito)",
    body.includes("HomeInsights.recentCompletedWorkouts(state.history, HomeInsights.RECENT_LIMIT, now)"));
  ok("renderHome usa UMA data de referência para resumo, card de hoje e faixa",
    /const now = new Date\(\);/.test(body) && body.includes("HomeInsights.build(state.history, now)"));
  ok("renderHome preenche a faixa e o estado vazio",
    ["home-recent-strip", "home-recent-empty"].every((id) => body.includes(id)) &&
    body.includes("recent.length ? 'none' : ''"));
  ok("os cards usam o rótulo relativo confiável (daysAgo/dateISO), nunca texto livre",
    body.includes("homeDayLabel(item.daysAgo, item.dateISO") &&
    helper.includes("daysAgo <= 0") && helper.includes("daysAgo === 1") &&
    helper.includes("t.date_today") && helper.includes("t.date_yesterday") &&
    helper.includes("t.date_days_ago") && helper.includes(".replace('{n}'"));
  ok("estado vazio é localizado (nenhum valor estático de reserva)",
    body.includes("t.home_no_workout_today") &&
    /id="home-recent-empty"[^>]*data-i18n="no_recent_workouts"/.test(home));
  ok("texto do usuário entra por textContent no card de hoje",
    (body.match(/\.textContent = /g) || []).length >= 3);
  ok("os cards da faixa escapam nome/metadados e usam o MESMO nome no card e no rótulo (5.1.3)",
    body.includes("TTUtils.escapeHtml(name)") && body.includes("TTUtils.escapeHtml(meta)") &&
    body.includes("TTUtils.escapeHtml(label)") &&
    /const name = item\.name \|\| t\.no_workout;/.test(body) &&
    body.includes("[name, when, duration, exercises].filter(Boolean).join(', ')"));
  ok("a faixa tem nome acessível resolvido pelo idioma ativo",
    body.includes("getAttribute('data-i18n-label')") && body.includes("setAttribute('aria-label'"));
  ok("a seção de treinos recentes é renderizada na Home (mesmo renderHome)",
    /if \(screenId === 'home'\) renderHome\(\);/.test(html) &&
    /I18n\.onChange\(\(\) => renderHome\(\)\)/.test(html));
  ok("o selo de status do card único NÃO reaparece de forma estática na faixa",
    !/class="history-status"[^>]*data-i18n/.test(home));

  // --- i18n das chaves novas (pt/en/es) ------------------------------------
  const isb = makeSandbox();
  loadModules(isb, ["js/i18n.js"]);
  const dict = isb.I18n.dict;
  const KEYS511 = ["date_today", "date_yesterday", "date_days_ago",
    "home_no_workout_today", "home_no_history"];
  ok("5 chaves da 5.1.1 em pt/en/es",
    ["pt", "en", "es"].every((l) => KEYS511.every((k) => typeof dict[l][k] === "string" && dict[l][k].trim() !== "")));
  ok("today_workout deixou de ser nome de treino mockado",
    ["pt", "en", "es"].every((l) => !/Treino A|Workout A|Entreno A/.test(dict[l].today_workout)));
  ok("chave do rótulo relativo tem espaço para o número",
    ["pt", "en", "es"].every((l) => dict[l].date_days_ago.indexOf("{n}") !== -1));

  const KEYS512 = ["recent_workouts", "recent_strip_label", "no_recent_workouts",
    "see_full_history", "exercises_count", "exercises_count_one"];
  ok("6 chaves da 5.1.2 em pt/en/es",
    ["pt", "en", "es"].every((l) => KEYS512.every((k) => typeof dict[l][k] === "string" && dict[l][k].trim() !== "")));
  ok("contagem de exercícios tem forma singular distinta (1 exercício, não '1 exercícios')",
    ["pt", "en", "es"].every((l) => dict[l].exercises_count_one !== dict[l].exercises_count));
  ok("nenhuma chave da 5.1.2 repete texto de treino mockado",
    ["pt", "en", "es"].every((l) => KEYS512.every((k) => !/Treino A|Treino B|Workout A|Entreno A/.test(dict[l][k]))));
}

// ---------------------------------------------------------------------------
// Cardio: criação -> persistência -> recarga -> leitura semanal (E5.1.1)
// ---------------------------------------------------------------------------
function testCardioPipeline() {
  const sb = makeSandbox();
  loadModules(sb, [
    "js/utils.js", "services/storage.js", "js/i18n.js", "js/workout-session.js",
    "js/persistence.js", "js/pr.js", "js/workout-controller.js", "js/home-insights.js",
  ]);
  const C = sb.WorkoutController;
  const P = sb.Persistence;
  const H = sb.HomeInsights;

  suite("Cardio: criação -> persistência -> leitura (Sprint 5.1.1)");

  const T0 = new Date(2026, 9, 14, 10, 0, 0);
  const T40 = new Date(2026, 9, 14, 10, 40, 0);

  // 1) criação/gravação: a modalidade da sessão não se perde na entrada.
  const cardioSession = {
    id: "s_cardio_1", letter: "C", routineName: "Esteira", category: "cardio",
    startedAt: T0, exercises: [{ catalogId: "c-esteira", name: "Esteira", completedSets: [{ weight: 0, reps: 1 }] }],
  };
  const appended = C.appendToHistory([], cardioSession, "completed", T40);
  ok("cardio marcado continua marcado na entrada do histórico",
    appended.ok && appended.entry.category === "cardio", JSON.stringify(appended.entry));
  eq("duração da sessão vira durationMin na entrada", appended.entry.durationMin, 40);
  ok("entrada de força (sem marcação) não ganha modalidade por inferência",
    !("category" in C.buildHistoryEntry({
      id: "s_forca_1", letter: "A", routineName: "Peito", startedAt: T0,
      exercises: [{ catalogId: "c1", name: "Supino", completedSets: [{ weight: 50, reps: 8 }] }],
    }, "completed", T40)));

  // 2) persistência: round-trip pelo storage (JSON) preserva a modalidade.
  P.saveHistory(appended.history);
  const raw = sb.localStorage.getItem("tt_ds_v1_history");
  ok("cardio gravado no storage com a marcação",
    !!raw && raw.indexOf('"category":"cardio"') !== -1 && raw.indexOf('"durationMin":40') !== -1);

  // 3) recarga: a hidratação reconstrói a entrada ainda como cardio.
  const reloaded = {};
  P.hydrate(reloaded);
  const cardio = reloaded.history.filter((e) => e.sessionId === "s_cardio_1")[0];
  ok("após a recarga o registro continua cardio",
    !!cardio && cardio.category === "cardio" && cardio.type === undefined);
  eq("após a recarga a duração é preservada", cardio.durationMin, 40);

  // 4) leitura semanal: cardio conta; força e legado sem marcação não.
  eq("resumo semanal soma o cardio sobrevivente à recarga",
    H.build(reloaded.history, T40).cardioMinutes, 40);

  const mixed = [
    { id: 1, name: "Corrida", status: "completed", dateISO: "2026-10-14", category: "cardio", durationMin: 25 },
    { id: 2, name: "Bicicleta", status: "completed", dateISO: "2026-10-14", type: "cardio", durationMin: "35" },
    { id: 3, name: "Treino A — Peito", status: "completed", dateISO: "2026-10-14", durationMin: 60 },
    { id: 4, name: "Legado", status: "completed", date: "Ontem, 18:30", duration: "50 min" },
    { id: 5, name: "Corrida sem duração", status: "completed", dateISO: "2026-10-14", category: "cardio" },
    { id: 6, name: "Corrida corrompida", status: "completed", dateISO: "2026-10-14", category: "cardio", durationMin: "x" },
  ];
  eq("cardio soma category/type e ignora musculação, legado e duração inválida",
    H.build(mixed, T40).cardioMinutes, 60);
  eq("histórico misto preserva todas as entradas (nada é duplicado pela leitura)",
    H.build(mixed, T40).days[2].count, 5);

  // 5) sanitização (via round-trip de storage) não converte a modalidade nem
  //    ressuscita valor inválido.
  P.saveHistory(mixed);
  const restoredMixed = {};
  P.hydrate(restoredMixed);
  const clean = restoredMixed.history;
  const byId = (id) => clean.filter((e) => e.id === id)[0];
  ok("sanitizeHistory preserva category/type sem conversão",
    byId(1).category === "cardio" && byId(2).type === "cardio");
  ok("sanitizeHistory mantém durationMin inválido fora da soma (0, não NaN)",
    byId(6).durationMin === 0 && H.build(clean, T40).cardioMinutes === 60);
  ok("sanitizeHistory descarta modalidade vazia em vez de inferir",
    !("category" in byId(3)) && !("type" in byId(3)));
}

// ---------------------------------------------------------------------------
// Rotina: exercícios salvos (bug 5.2 — o buffer da edição era descartado)
// ---------------------------------------------------------------------------
function testRoutinePersistence() {
  const sb = makeSandbox();
  loadModules(sb, ["js/utils.js", "services/storage.js", "js/i18n.js", "js/persistence.js"]);
  const P = sb.Persistence;
  const S = sb.StorageService;

  suite("Rotina: exercícios persistidos (bug 5.2)");

  // Estado montado como o `tempEditRoutine` do fluxo real (2 exercícios
  // adicionados pelo catálogo, o primeiro já reconfigurado).
  const rotina = {
    id: "rD", letter: "D", name: "Novo treino",
    exercises: [
      { catalogId: "A-01", sets: 5, reps: 11, weight: 25, rest: 75 },
      { catalogId: "A-02", sets: 3, reps: 10, weight: 20, rest: 60 },
    ],
  };
  ok("salvar a rotina com exercícios devolve sucesso", P.saveRoutines([rotina]) === true);

  const alvo = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(alvo);
  eq("os DOIS exercícios sobrevivem ao round-trip", alvo.routines[0].exercises.length, 2);
  eq("catalogId preservado na ordem",
    alvo.routines[0].exercises.map((e) => e.catalogId), ["A-01", "A-02"]);
  eq("séries/reps/carga/descanso preservados",
    alvo.routines[0].exercises[0], { catalogId: "A-01", sets: 5, reps: 11, weight: 25, rest: 75 });
  ok("nenhum exercício duplicado na leitura",
    new Set(alvo.routines[0].exercises.map((e) => e.catalogId)).size === 2);

  // Compatibilidade: registro legado sem `exercises` não pode sumir nem
  // inventar exercício — e não pode derrubar as rotinas enriquecidas ao lado.
  S.save("routines", [{ id: "rLegado", letter: "Y", name: "Legado" }, rotina]);
  const legado = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  P.hydrate(legado);
  eq("rotina legada é preservada", legado.routines.length, 2);
  eq("rotina legada ganha lista vazia (nada é inventado)", legado.routines[0].exercises, []);
  eq("rotina enriquecida ao lado do legado continua inteira", legado.routines[1].exercises.length, 2);

  // Falha de gravação: false — nunca "sucesso silencioso" — com storage ATIVO
  // (quota/erro no setItem). Assim o contrato de "modo memória" não se confunde.
  const sbQuota = makeSandbox();
  const setItemOriginal = sbQuota.localStorage.setItem.bind(sbQuota.localStorage);
  sbQuota.localStorage.setItem = (k, v) => {
    if (String(v).length > 10) throw new Error("QuotaExceededError");
    return setItemOriginal(k, v);
  };
  loadModules(sbQuota, ["js/utils.js", "services/storage.js", "js/i18n.js", "js/persistence.js"]);
  const Pq = sbQuota.Persistence;
  ok("storage segue habilitado (falha de gravação, não modo memória)", Pq.isEnabled() === true);
  ok("saveRoutines devolve false quando a gravação falha", Pq.saveRoutines([rotina]) === false);

  // Travas de origem do defeito: voltar para a edição (do catálogo/configurar)
  // NÃO pode recopiar o buffer do estado.
  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");
  ok("rota 'edit' com rotina abre edição nova; sem rotina mantém a edição em andamento",
    html.includes("if (screenId === 'edit') {") &&
    html.includes("if (param) startEditRoutine(param);") &&
    html.includes("else showEditScreen();"));
  ok("a rota antiga (recopiar o buffer SEMPRE) não existe mais",
    !html.includes("if (screenId === 'edit') startEditRoutine(param || state.editingRoutineId);"));
  const corpoShow = html.slice(html.indexOf("function showEditScreen()"), html.indexOf("function renderEditList()"));
  ok("showEditScreen redesenha o buffer e nunca o sobrescreve",
    corpoShow.includes("renderEditList()") && !corpoShow.includes("tempEditRoutine ="));
  ok("o '+' do catálogo continua empurrando no buffer da edição",
    html.includes("state.tempEditRoutine.exercises.push({"));
  ok("'Salvar' só troca o estado DEPOIS de gravar (falha não vira sucesso)",
    html.includes("if (!persistRoutines(next)) {") && html.includes("state.routines = next;"));

  // Sprint 5.3 — nome da rotina: round-trip, legado e separação letra/nome.
  suite("Rotina: nome personalizado (Sprint 5.3)");
  const sbName = makeSandbox();
  loadModules(sbName, ["js/utils.js", "services/storage.js", "js/i18n.js", "js/persistence.js"]);
  const Pn = sbName.Persistence;
  const Sn = sbName.StorageService;

  const nomeada = {
    id: "rA", letter: "A", name: "Peito e Tríceps",
    exercises: [{ catalogId: "A-01", sets: 4, reps: 10, weight: 30, rest: 60 }],
  };
  ok("grava rotina com nome personalizado", Pn.saveRoutines([nomeada]) === true);
  const alvoNome = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  Pn.hydrate(alvoNome);
  eq("nome personalizado sobrevive ao round-trip", alvoNome.routines[0].name, "Peito e Tríceps");
  eq("nome não substitui a letra de identificação", alvoNome.routines[0].letter, "A");
  eq("nome não substitui o id", alvoNome.routines[0].id, "rA");

  Sn.save("routines", [{ id: "rLegadoNome", letter: "Z", exercises: [] }]);
  const alvoLegadoNome = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  Pn.hydrate(alvoLegadoNome);
  eq("rotina legada sem name recebe o padrão Treino <letter>",
    alvoLegadoNome.routines[0].name, "Treino Z");
  eq("rotina legada preserva id e letra", [alvoLegadoNome.routines[0].id, alvoLegadoNome.routines[0].letter],
    ["rLegadoNome", "Z"]);

  Sn.save("routines", [{ id: "rBranco", letter: "B", name: "   ", exercises: [] }]);
  const alvoBranco = { routines: [], history: [], lang: "pt", autoRestEnabled: true };
  Pn.hydrate(alvoBranco);
  eq("name vazio/whitespace também cai no padrão", alvoBranco.routines[0].name, "Treino B");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async function main() {
  testUtils();
  testUtilsDates();
  testStorage();
  testEvents();
  testI18n();
  testPersistence();
  testPersistence2C();
  testCatalog();
  testCustomExercises();
  testCustomCatalog();
  testPR();
  testRoutineActions();
  testWorkoutSession();
  testPersistenceSession();
  testPersistenceCustomExercises();
  testPersistenceSaveAll();
  testRestTimer();
  await testWakeLock();
  testWorkoutController();
  testWorkoutControllerRest();
  testWorkoutPlayerE5();
  testActionGuard();
  testWorkoutPlayerE7();
  testUpcomingExercises();
  testRestOverlayDialogE71();
  testHomeInsights();
  testHomeWeeklyWiring();
  testHomeCardsWiring();
  testCardioPipeline();
  testWiring();
  testRoutinePersistence();

  console.log("\n==========================================");
  console.log(passed + " checagens OK, " + failures.length + " falha(s)");
  if (failures.length) {
    console.log("\nFALHAS:");
    failures.forEach((f) => console.log("  x " + f));
    process.exit(1);
  }
  console.log("Tudo certo.");
})();
