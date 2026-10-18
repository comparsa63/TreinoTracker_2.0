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
  eq("49 chaves", I.keys().length, 49);

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
// Wiring estático do HTML
// ---------------------------------------------------------------------------
function testWiring() {
  suite("Wiring do HTML");

  const html = fs.readFileSync(path.join(ROOT, "TreinoTracker_DeepSeek.html"), "utf8");

  const order = ["js/utils.js", "services/storage.js", "js/i18n.js", "js/data/exercises.js", "js/catalog.js", "js/events.js", "js/routine-actions.js", "js/pr.js", "js/workout-session.js", "js/rest-timer.js", "js/wake-lock.js", "js/workout-controller.js"].map((src) => ({
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
  ok("E3: o timer VISUAL continua o legado (ligá-lo ao domínio é a E5)",
    html.includes("function startRestTimer(") && html.includes("state.restTimer.time") &&
      html.includes('id="rest-overlay"') && !/WorkoutController\.restStart\(/.test(html));

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

  const homeBlock = html.match(/<section id="screen-home"[\s\S]*?<\/section>/)[0];
  ok("nenhum <script>/<link> foi enfiado DENTRO do bloco da Home",
    !/<script|<link/i.test(homeBlock));
  ok("Home não referencia nenhum módulo novo (sem I18n./Persistence. no markup)",
    !/I18n\.|Persistence\.|StorageService\.|TTUtils\./.test(homeBlock));
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
  testPR();
  testRoutineActions();
  testWorkoutSession();
  testPersistenceSession();
  testRestTimer();
  await testWakeLock();
  testWorkoutController();
  testWorkoutControllerRest();
  testWiring();

  console.log("\n==========================================");
  console.log(passed + " checagens OK, " + failures.length + " falha(s)");
  if (failures.length) {
    console.log("\nFALHAS:");
    failures.forEach((f) => console.log("  x " + f));
    process.exit(1);
  }
  console.log("Tudo certo.");
})();
