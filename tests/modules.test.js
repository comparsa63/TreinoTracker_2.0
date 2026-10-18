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
  eq("44 chaves", I.keys().length, 44);

  const ptKeys = Object.keys(I.dict.pt).sort();
  const enKeys = Object.keys(I.dict.en).sort();
  const esKeys = Object.keys(I.dict.es).sort();
  eq("pt e en têm o mesmo conjunto de chaves", enKeys, ptKeys);
  eq("pt e es têm o mesmo conjunto de chaves", esKeys, ptKeys);

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
        { weight: 60, reps: 12 }, { weight: "x", reps: 5 }, { weight: 70, reps: 8 }, { weight: 80, reps: 6 },
      ] },
      { name: "Exercício custom", sets: "3", reps: "10" },
      { foo: "bar" },
    ],
  });
  ok("sanitize deriva status do isFinished legado",
    bad.status === "finished" && bad.isFinished === true && isDate(bad.finishedAt));
  eq("sanitize descarta exercícios inválidos", bad.exercises.length, 2);
  eq("sanitize descarta séries inválidas e clampa ao planejado", bad.exercises[0].completedSets.length, 2);
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
// Wiring estático do HTML
// ---------------------------------------------------------------------------
function testWiring() {
  suite("Wiring do HTML");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");

  const order = ["js/utils.js", "services/storage.js", "js/i18n.js", "js/data/exercises.js", "js/catalog.js", "js/events.js", "js/routine-actions.js", "js/pr.js"].map((src) => ({
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
  ok("botão de exclusão (−) no card da rotina", html.includes("askDeleteRoutine('${r.id}')") && html.includes("btn-minus"));
  ok("histórico enriquecido grava séries concluídas", html.includes("completedSets.push(") && html.includes("dateISO"));
  ok("PR integrado ao salvar treino", html.includes("PR.checkNewPR("));

  const homeBlock = html.match(/<section id="screen-home"[\s\S]*?<\/section>/)[0];
  ok("nenhum <script>/<link> foi enfiado DENTRO do bloco da Home",
    !/<script|<link/i.test(homeBlock));
  ok("Home não referencia nenhum módulo novo (sem I18n./Persistence. no markup)",
    !/I18n\.|Persistence\.|StorageService\.|TTUtils\./.test(homeBlock));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
testUtils();
testUtilsDates();
testStorage();
testEvents();
testI18n();
testPersistence();
testPersistence2C();
testCatalog();
testPR();
testRoutineActions();
testWorkoutSession();
testWiring();

console.log("\n==========================================");
console.log(passed + " checagens OK, " + failures.length + " falha(s)");
if (failures.length) {
  console.log("\nFALHAS:");
  failures.forEach((f) => console.log("  x " + f));
  process.exit(1);
}
console.log("Tudo certo.");
