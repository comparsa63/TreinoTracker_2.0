/**
 * tests/smoke.browser.mjs
 * ---------------------------------------------------------------------------
 * Smoke test de integração (Chrome headless via CDP).
 *
 * Prova, num navegador real, que a Fase 1 (Storage + Persistence + i18n) está
 * ligada de verdade:
 *   1. A página carrega sem erro de JS e a HOME renderiza com o texto esperado.
 *   2. O botão de idioma da Home (clique REAL) troca pt -> en e persiste.
 *   3. Criar/salvar uma rotina grava em localStorage.
 *   4. Após RELOAD, rotina + idioma continuam lá (estado hidratado).
 *   5. A HOME continua sendo a mesma tela (markup/CSS intactos).
 *
 * Uso:  node tests/smoke.browser.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = "/TreinoTracker_DeepSeek.html";

// E6: a blindagem de toque duplo é uma janela de 400 ms por INTENÇÃO da UI. Uma
// série real leva segundos, então os testes que simulam uma sequência de toques
// legítima paceiam como um humano; a janela é o que se testa nos toques em rajada.
const TAP_WAIT_MS = 450;
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const CHROME = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Infra
// ---------------------------------------------------------------------------

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (p === "/") p = PAGE;
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(fs.readFileSync(fp));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port })));
}

function makeCDP(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
        return;
      }
      if (!m.id && m.method && typeof onEvent === "function") onEvent(m);
    });
    ws.addEventListener("error", (e) => reject(new Error("ws: " + e.message)));
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params }));
          return new Promise((res, rej) => pending.set(mid, { resolve: res, reject: rej }));
        },
        close() {
          ws.close();
        },
      })
    );
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  -> " + detail : ""));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!CHROME) {
    console.error("Chrome/Edge não encontrado. Pulando smoke test de browser.");
    process.exit(0);
  }

  const { server, port } = await startServer();
  const profile = path.join(os.tmpdir(), "opencode", "tt-ds-smoke-profile");
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(profile), { recursive: true });

  const chrome = spawn(CHROME, [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "about:blank",
  ]);

  let cdpPort = null;
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150; i++) {
    if (fs.existsSync(portFile)) {
      cdpPort = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
      if (cdpPort) break;
    }
    await sleep(120);
  }
  if (!cdpPort) throw new Error("Chrome não abriu a porta de debug.");

  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();

  const jsErrors = [];
  const cdp = await makeCDP(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
    (m) => {
      if (m.method === "Runtime.exceptionThrown") {
        jsErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      }
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
        jsErrors.push(m.params.entry.text);
      }
    }
  );

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  // Sem rede: os hotlinks do Unsplash não interessam a este teste.
  await cdp.send("Network.setBlockedURLs", { urls: ["*unsplash.com*", "*script.google.com*"] });

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
  });

  const ev = async (expression, label) => {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error("eval falhou" + (label ? " [" + label + "]" : "") + ": " +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result?.value;
  };

  const loadPage = async () => {
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}${PAGE}` });
    for (let i = 0; i < 150; i++) {
      const ready = await ev(
        "typeof Persistence!=='undefined' && typeof I18n!=='undefined' && document.readyState==='complete' && !!document.querySelector('#screen-home h2')"
      );
      if (ready) break;
      await sleep(120);
    }
    await sleep(400);
  };

  console.log("=== SMOKE TEST (browser) — Fase 1 ===");

  // --- Carregamento inicial -------------------------------------------------
  await loadPage();

  const wiring = await ev(`(function(){
    return {
      utils: typeof TTUtils, storage: typeof StorageService, i18n: typeof I18n, persistence: typeof Persistence,
      dictShared: (typeof translations!=='undefined') && translations === I18n.dict,
      persistent: Persistence.isEnabled(),
      lsKeys: Object.keys(localStorage).filter(k=>k.indexOf('tt_ds_v1_')===0),
      home: {
        greeting: document.querySelector('#screen-home h2').innerText,
        startBtn: document.querySelector('#screen-home .btn-primary').innerText.trim(),
        recentTitle: document.querySelector('#screen-home h4[data-i18n="recent_workouts"]').innerText.trim(),
        recentCount: document.querySelectorAll('#home-recent-strip .recent-card').length,
        recentLabel: document.getElementById('home-recent-strip').getAttribute('aria-label'),
        emptyVisible: getComputedStyle(document.getElementById('home-recent-empty')).display !== 'none',
        emptyText: document.getElementById('home-recent-empty').innerText.trim(),
        historyBtn: document.querySelector('#screen-home button[data-i18n="see_full_history"]').innerText.trim(),
        todayLabel: document.querySelector('#screen-home [data-i18n="today_workout"]').innerText.trim(),
        todayCard: document.getElementById('home-today-name').innerText.trim(),
        todayExercises: document.getElementById('home-today-exercises').innerText.trim(),
        todayDuration: document.getElementById('home-today-duration').innerText.trim(),
        langChip: document.getElementById('lang-text').innerText,
        docLang: document.documentElement.lang
      },
      cardBar: getComputedStyle(document.querySelector('#screen-home .card-highlight'), '::before').backgroundColor,
      screensActive: document.querySelectorAll('.screen.active').length
    };
  })()`);

  check("módulos carregados (TTUtils/StorageService/I18n/Persistence)",
    wiring.utils === "object" && wiring.storage === "object" && wiring.i18n === "object" && wiring.persistence === "object",
    `${wiring.utils}/${wiring.storage}/${wiring.i18n}/${wiring.persistence}`);
  check("translations === I18n.dict (fonte única)", wiring.dictShared);
  check("localStorage utilizável", wiring.persistent);
  check("1ª visita: storage da app vazio", wiring.lsKeys.length === 0, JSON.stringify(wiring.lsKeys));
  check("Home em PT renderizada",
    wiring.home.greeting === "Olá, Atleta" &&
    wiring.home.startBtn === "INICIAR TREINO" &&
    wiring.home.recentTitle === "Últimos treinos" &&
    wiring.home.historyBtn === "Ver histórico completo" &&
    wiring.home.todayLabel === "Treino de hoje" &&
    wiring.home.langChip === "PT" && wiring.home.docLang === "pt-BR",
    JSON.stringify(wiring.home));
  check("1ª visita: faixa de recentes vazia e estados vazios localizados (nenhum mock)",
    wiring.home.todayCard === "Sem treino hoje" &&
    wiring.home.todayExercises === "—" && wiring.home.todayDuration === "—" &&
    wiring.home.recentCount === 0 && wiring.home.emptyVisible === true &&
    wiring.home.emptyText === "Nenhum treino concluído ainda" &&
    wiring.home.recentLabel === "Últimos treinos concluídos",
    JSON.stringify(wiring.home));
  check("Home: barra verde do card-highlight presente",
    /rgb\(0,\s*255,\s*85\)|rgba\(0,\s*255,\s*85/.test(wiring.cardBar), wiring.cardBar);
  check("exatamente 1 tela ativa", wiring.screensActive === 1);

  // --- Clique REAL no botão de idioma da Home -------------------------------
  await ev(`document.querySelector('#screen-home header button').click()`);
  await sleep(300);

  const afterToggle = await ev(`(function(){
    return {
      lang: state.lang,
      greeting: document.querySelector('#screen-home h2').innerText,
      btn: document.querySelector('#screen-home .btn-primary').innerText.trim(),
      todayLabel: document.querySelector('#screen-home [data-i18n="today_workout"]').innerText.trim(),
      todayCard: document.getElementById('home-today-name').innerText.trim(),
      recentTitle: document.querySelector('#screen-home h4[data-i18n="recent_workouts"]').innerText.trim(),
      recentLabel: document.getElementById('home-recent-strip').getAttribute('aria-label'),
      emptyText: document.getElementById('home-recent-empty').innerText.trim(),
      historyBtn: document.querySelector('#screen-home button[data-i18n="see_full_history"]').innerText.trim(),
      chip: document.getElementById('lang-text').innerText,
      docLang: document.documentElement.lang,
      persisted: JSON.parse(localStorage.getItem('tt_ds_v1_lang')||'null')
    };
  })()`);

  check("clique no botão PT/EN troca a Home para EN",
    afterToggle.greeting === "Hello, Athlete" &&
    afterToggle.btn === "START WORKOUT" &&
    afterToggle.todayLabel === "Today's workout" &&
    afterToggle.todayCard === "No workout today" &&
    afterToggle.recentTitle === "Recent workouts" &&
    afterToggle.recentLabel === "Recent completed workouts" &&
    afterToggle.emptyText === "No completed workouts yet" &&
    afterToggle.historyBtn === "See full history" &&
    afterToggle.chip === "EN" && afterToggle.docLang === "en",
    JSON.stringify(afterToggle));
  check("idioma persistido (tt_ds_v1_lang)", afterToggle.persisted === "en", JSON.stringify(afterToggle.persisted));

  // --- Criar + salvar rotina ------------------------------------------------
  const routineResult = await ev(`(function(){
    navigate('workouts');
    createNewRoutine();
    state.tempEditRoutine.name = 'Rotina do Smoke';
    state.tempEditRoutine.exercises = [{ catalogId:'ex1', sets:5, reps:8, weight:75.5, rest:90 }];
    saveRoutineEdits();
    var stored = JSON.parse(localStorage.getItem('tt_ds_v1_routines')||'null');
    return {
      inMemory: state.routines.length,
      storedCount: stored ? stored.length : -1,
      storedName: stored ? stored[stored.length-1].name : null,
      storedEx: stored ? stored[stored.length-1].exercises : null
    };
  })()`);

  check("criar + salvar rotina grava em tt_ds_v1_routines",
    routineResult.storedCount === 4 &&
    routineResult.storedName === "Rotina do Smoke" &&
    routineResult.storedEx && routineResult.storedEx[0].weight === 75.5 && routineResult.storedEx[0].sets === 5,
    JSON.stringify(routineResult));

  // --- Histórico ------------------------------------------------------------
  const historyResult = await ev(`(function(){
    state.session = { letter:'A', routineName:'Peito e tríceps', exercises:[{ setsCompleted: 3 }] };
    saveSessionToHistory('completed');
    var stored = JSON.parse(localStorage.getItem('tt_ds_v1_history')||'null');
    return { storedCount: stored ? stored.length : -1, first: stored ? stored[0] : null };
  })()`);

  check("finalizar treino grava em tt_ds_v1_history",
    historyResult.storedCount === 3 && historyResult.first && historyResult.first.status === "completed",
    JSON.stringify(historyResult.first));

  const cardsAfterSave = await ev(`(function(){
    var cards = document.querySelectorAll('#home-recent-strip .recent-card');
    var first = cards[0] || null;
    return {
      today: document.getElementById('home-today-name').innerText.trim(),
      todayExercises: document.getElementById('home-today-exercises').innerText.trim(),
      todayDuration: document.getElementById('home-today-duration').innerText.trim(),
      recentCount: cards.length,
      firstName: first ? first.querySelector('.recent-card-name').innerText.trim() : '',
      firstMeta: first ? first.querySelector('.recent-card-meta').innerText.trim() : '',
      firstRole: first ? first.getAttribute('role') : null,
      emptyHidden: getComputedStyle(document.getElementById('home-recent-empty')).display === 'none'
    };
  })()`);
  check("salvar treino atualiza o card de hoje e a faixa de recentes (dado real, sem mock)",
    cardsAfterSave.today === "Treino A — Peito e tríceps" &&
    cardsAfterSave.recentCount === 1 &&
    cardsAfterSave.firstName === "Treino A — Peito e tríceps" &&
    cardsAfterSave.firstMeta.indexOf("Today") === 0 &&
    cardsAfterSave.firstRole === "listitem" && cardsAfterSave.emptyHidden === true &&
    cardsAfterSave.todayExercises === "—",
    JSON.stringify(cardsAfterSave));

  // --- RELOAD: hidratação ---------------------------------------------------
  await loadPage();

  const afterReload = await ev(`(function(){
    var stored = JSON.parse(localStorage.getItem('tt_ds_v1_routines')||'null');
    return {
      routinesInMemory: state.routines.length,
      routineNames: state.routines.map(r=>r.name),
      lastRoutineExercises: state.routines[state.routines.length-1].exercises,
      historyInMemory: state.history.length,
      lang: state.lang,
      greeting: document.querySelector('#screen-home h2').innerText,
      chip: document.getElementById('lang-text').innerText,
      docLang: document.documentElement.lang,
      storedCount: stored ? stored.length : -1
    };
  })()`);

  check("RELOAD: rotina restaurada do storage",
    afterReload.routinesInMemory === 4 &&
    afterReload.routineNames.indexOf("Rotina do Smoke") !== -1 &&
    afterReload.lastRoutineExercises[0].weight === 75.5,
    JSON.stringify({ n: afterReload.routinesInMemory, names: afterReload.routineNames, ex: afterReload.lastRoutineExercises }));
  check("RELOAD: histórico restaurado", afterReload.historyInMemory === 3, String(afterReload.historyInMemory));
  check("RELOAD: idioma EN restaurado e reaplicado na Home",
    afterReload.lang === "en" && afterReload.greeting === "Hello, Athlete" &&
    afterReload.chip === "EN" && afterReload.docLang === "en",
    JSON.stringify({ lang: afterReload.lang, greeting: afterReload.greeting, chip: afterReload.chip }));

  // --- Sanidade de renderização das outras telas ----------------------------
  const screensResult = await ev(`(function(){
    var out = {};
    ['workouts','history','add-exercise'].forEach(function(s){ navigate(s); out[s] = document.getElementById('screen-'+s).classList.contains('active'); });
    navigate('home');
    out.home = document.getElementById('screen-home').classList.contains('active');
    return out;
  })()`);
  check("navegação entre telas OK",
    screensResult.workouts && screensResult.history && screensResult["add-exercise"] && screensResult.home,
    JSON.stringify(screensResult));

  // --- Fase 2C: navegação de TODOS os grupos musculares (UX) ----------------
  const widths = [320, 360, 390, 430, 1024];
  for (const w of widths) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: w, height: 844, deviceScaleFactor: 1, mobile: w < 768, screenWidth: w, screenHeight: 844,
    });
    await sleep(90);
    const r = await ev(`(function(){
      navigate('add-exercise');
      var host = document.getElementById('catalog-filters');
      var chips = Array.prototype.slice.call(host.querySelectorAll('.filter-btn'));
      var rects = chips.map(function(c){ var b = c.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height) }; });
      return {
        chips: chips.length,
        groups: (typeof Catalog !== 'undefined') ? Catalog.filterGroups().length : -1,
        hostScroll: host.scrollWidth - host.clientWidth,
        pageScroll: document.documentElement.scrollWidth - window.innerWidth,
        allInside: rects.every(function(b){ return b.l >= -1 && b.r <= Math.ceil(window.innerWidth) + 1; }),
        minHeight: rects.length ? Math.min.apply(null, rects.map(function(b){ return b.h; })) : 0
      };
    })()`);
    check("filtros @" + w + "px: 1 chip por grupo + Todos (nada escondido)",
      r.chips === r.groups + 1, JSON.stringify({ chips: r.chips, groups: r.groups }));
    check("filtros @" + w + "px: sem rolagem horizontal (barra e página)",
      r.hostScroll <= 1 && r.pageScroll <= 1, JSON.stringify({ host: r.hostScroll, page: r.pageScroll }));
    check("filtros @" + w + "px: todos os grupos dentro da viewport",
      r.allInside, JSON.stringify(r));
    check("filtros @" + w + "px: alvo de toque >= 28px", r.minHeight >= 28, String(r.minHeight));
  }

  // clicar no ÚLTIMO filtro (o que antes ficava fora da área visível)
  const lastGroup = await ev(`(function(){
    navigate('add-exercise');
    var host = document.getElementById('catalog-filters');
    var chips = Array.prototype.slice.call(host.querySelectorAll('.filter-btn'));
    var last = chips[chips.length - 1];
    var group = last.innerText.trim();
    last.click();
    var active = host.querySelector('.filter-btn.active');
    var items = Array.prototype.slice.call(document.querySelectorAll('#catalog-container .catalog-item'));
    return {
      group: group,
      active: active ? active.innerText.trim() : null,
      items: items.length,
      allMatch: items.length > 0 && items.every(function(it){ return it.querySelector('.info p').innerText.trim().indexOf(group) !== -1; })
    };
  })()`);
  check("filtros: clique no último filtro (fora da área visível inicial) filtra o catálogo",
    lastGroup.items > 0 && lastGroup.allMatch && lastGroup.active === lastGroup.group,
    JSON.stringify(lastGroup));

  // --- Taxonomia: subgrupos específicos filtráveis ---------------------------
  const taxonomy = await ev(`(function(){
    navigate('add-exercise');
    var host = document.getElementById('catalog-filters');
    function chips(){ return Array.prototype.slice.call(host.querySelectorAll('.filter-btn')); }
    function findChip(label){ return chips().filter(function(c){ return c.innerText.trim() === label; })[0]; }
    function items(){ return Array.prototype.slice.call(document.querySelectorAll('#catalog-container .catalog-item')); }
    function subtitleOf(it){ return it.querySelector('.info p').innerText.trim(); }
    function clickChip(name){ var c = findChip(name); if (!c) return null; c.click(); return { items: items().length, labels: items().map(subtitleOf) }; }
    var present = chips().map(function(c){ return c.innerText.trim(); });
    var result = {
      present: present,
      quad: clickChip('Quadríceps'),
      posterior: clickChip('Posterior de Coxa'),
      panturrilha: clickChip('Panturrilha'),
      lombar: clickChip('Lombar'),
      pernas: clickChip('Pernas'),
      peito: clickChip('Peito'),
    };
    state.catalogFilter = 'all';
    renderCatalog();
    return result;
  })()`);
  const allGroups = ["Peito", "Costas", "Ombro", "Bíceps", "Tríceps", "Antebraço", "Pernas", "Glúteo", "Abdômen", "Trapézio"];
  check("taxonomia: todos os grupos atuais continuam disponíveis",
    allGroups.every(function(g){ return taxonomy.present.indexOf(g) !== -1; }),
    taxonomy.present.join(","));
  check("taxonomia: subgrupos novos estão nos filtros",
    ["Quadríceps", "Posterior de Coxa", "Panturrilha", "Lombar"].every(function(s){ return taxonomy.present.indexOf(s) !== -1; }),
    taxonomy.present.join(","));
  check("taxonomia: filtro Quadríceps (6 exercícios, rótulo com o subgrupo)",
    taxonomy.quad && taxonomy.quad.items === 6 && taxonomy.quad.labels.every(function(l){ return l.indexOf("Quadríceps") !== -1; }),
    JSON.stringify(taxonomy.quad));
  check("taxonomia: filtro Posterior de Coxa (3 exercícios)",
    taxonomy.posterior && taxonomy.posterior.items === 3 && taxonomy.posterior.labels.every(function(l){ return l.indexOf("Posterior de Coxa") !== -1; }),
    JSON.stringify(taxonomy.posterior));
  check("taxonomia: filtro Panturrilha (2 exercícios)",
    taxonomy.panturrilha && taxonomy.panturrilha.items === 2 && taxonomy.panturrilha.labels.every(function(l){ return l.indexOf("Panturrilha") !== -1; }),
    JSON.stringify(taxonomy.panturrilha));
  check("taxonomia: filtro Lombar (1 exercício)",
    taxonomy.lombar && taxonomy.lombar.items === 1 && taxonomy.lombar.labels.every(function(l){ return l.indexOf("Lombar") !== -1; }),
    JSON.stringify(taxonomy.lombar));
  check("taxonomia: grupo principal Pernas segue com 12 exercícios",
    taxonomy.pernas && taxonomy.pernas.items === 12, JSON.stringify(taxonomy.pernas));
  check("taxonomia: grupo principal Peito inalterado (10)",
    taxonomy.peito && taxonomy.peito.items === 10, JSON.stringify(taxonomy.peito));

  // busca por nome continua funcionando (com filtro de subgrupo ativo)
  const searchCheck = await ev(`(function(){
    navigate('add-exercise');
    state.catalogFilter = 'all';
    var input = document.getElementById('search-catalog');
    input.value = 'panturrilha';
    renderCatalog();
    var names = Array.prototype.slice.call(document.querySelectorAll('#catalog-container .catalog-item h4')).map(function(h){ return h.innerText.trim(); });
    input.value = '';
    state.catalogFilter = 'all';
    renderCatalog();
    return names;
  })()`);
  check("taxonomia: pesquisa por nome continua funcionando",
    searchCheck.length >= 2 && searchCheck.some(function(n){ return n.toLowerCase().indexOf("panturrilha") !== -1; }),
    searchCheck.join(" | "));

  // volta ao viewport mobile padrão e ao filtro 'all'
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
  });
  await ev(`(function(){ state.catalogFilter = 'all'; return true; })()`);

  // --- Fase 2C: histórico enriquecido + PRs (fluxo real) --------------------
  const enriched = await ev(`(function(){
    state.session = {
      routineId: 'rA', routineName: 'Peito e tríceps', letter: 'A',
      startedAt: new Date(Date.now() - 300000),
      exercises: [
        { catalogId: 'C-02', name: 'Supino reto', muscle: 'Peito', setsCompleted: 2, completedSets: [{ weight: 60, reps: 12 }, { weight: 62.5, reps: 10 }] },
        { catalogId: 'C-01', name: 'Supino inclinado', muscle: 'Peito', setsCompleted: 1, completedSets: [{ weight: 40, reps: 10 }] }
      ]
    };
    saveSessionToHistory('completed');
    state.session = null;
    var prs = JSON.parse(localStorage.getItem('tt_ds_v1_prs') || 'null') || [];
    var top = state.history[0];
    return {
      firstExCount: top.exercises ? top.exercises.length : 0,
      firstSets: top.exercises ? top.exercises[0].sets.length : 0,
      durationMin: top.durationMin,
      prBadge: top.prs ? top.prs.length : 0,
      storedPRs: prs.length,
      c02types: prs.filter(function(p){ return p.exerciseKey === 'C-02'; }).map(function(p){ return p.type; }).sort()
    };
  })()`);
  check("histórico enriquecido: guarda exercícios, séries concluídas e duração",
    enriched.firstExCount === 2 && enriched.firstSets === 2 && enriched.durationMin >= 4,
    JSON.stringify(enriched));
  check("PR: registra os 6 critérios do treino e marca o card",
    enriched.storedPRs > 0 && enriched.c02types.length === 6 && enriched.prBadge > 0,
    JSON.stringify({ n: enriched.storedPRs, types: enriched.c02types, badge: enriched.prBadge }));

  const idem = await ev(`(function(){
    var before = PR.getAll().length;
    var res = PR.checkNewPR(state.history[0], state.history);
    return { newPRs: res.length, before: before, after: PR.getAll().length };
  })()`);
  check("PR: reprocessar a mesma sessão não duplica recordes",
    idem.newPRs === 0 && idem.after === idem.before, JSON.stringify(idem));

  const histUI = await ev(`(function(){
    navigate('history');
    return {
      summary: document.getElementById('pr-summary').innerText.trim().length > 0,
      badges: document.querySelectorAll('#history-container .pr-badge').length,
      exercises: document.querySelectorAll('#history-container .history-exercises').length
    };
  })()`);
  check("histórico: resumo de PRs e badges por treino renderizados",
    histUI.summary && histUI.badges >= 1 && histUI.exercises >= 1, JSON.stringify(histUI));

  // --- Fase 2C: exclusão segura de treino -----------------------------------
  const del = await ev(`(function(){
    navigate('workouts');
    var target = state.routines.find(function(r){ return r.name === 'Rotina do Smoke'; });
    var id = target.id;
    var before = state.routines.length;
    var histBefore = state.history.length;
    var prsBefore = localStorage.getItem('tt_ds_v1_prs');
    var catBefore = Catalog.all().length;

    askDeleteRoutine(id);
    var modalOpen = document.getElementById('confirm-modal').classList.contains('active');
    document.getElementById('confirm-cancel').click();
    var afterCancel = state.routines.length;
    var stillThere = !!state.routines.find(function(r){ return r.id === id; });

    askDeleteRoutine(id);
    document.getElementById('confirm-ok').click();
    var afterDelete = state.routines.length;
    var gone = !state.routines.find(function(r){ return r.id === id; });
    var stored = JSON.parse(localStorage.getItem('tt_ds_v1_routines') || 'null');
    var toast = document.getElementById('app-toast');

    return {
      before: before, modalOpen: modalOpen, afterCancel: afterCancel, stillThere: stillThere,
      afterDelete: afterDelete, gone: gone,
      storedCount: stored ? stored.length : -1,
      toastShown: toast.classList.contains('show') && toast.innerText.indexOf('exclu') !== -1,
      histBefore: histBefore, histAfter: state.history.length,
      prsSame: localStorage.getItem('tt_ds_v1_prs') === prsBefore,
      catSame: Catalog.all().length === catBefore,
      remaining: state.routines.map(function(r){ return r.id; }).sort()
    };
  })()`);
  check("excluir: modal de confirmação abre", del.modalOpen === true);
  check("excluir: cancelar não altera nada",
    del.afterCancel === del.before && del.stillThere, JSON.stringify({ before: del.before, afterCancel: del.afterCancel }));
  check("excluir: confirmar remove apenas a rotina selecionada",
    del.afterDelete === del.before - 1 && del.gone && del.storedCount === del.before - 1 &&
    del.remaining.indexOf('rA') !== -1 && del.remaining.indexOf('rB') !== -1 && del.remaining.indexOf('rC') !== -1,
    JSON.stringify(del));
  check("excluir: confirma visualmente o resultado (toast)", del.toastShown === true);
  check("excluir: preserva catálogo, histórico e PRs",
    del.catSame && del.histAfter === del.histBefore && del.prsSame,
    JSON.stringify({ cat: del.catSame, hist: del.histAfter + "/" + del.histBefore, prs: del.prsSame }));

  const guard = await ev(`(function(){
    navigate('workouts');
    var toast = document.getElementById('app-toast');
    function attempt(session, recovered){
      state.session = session;
      sessionPendingDecision = !!recovered;
      askDeleteRoutine('rA');
      var out = {
        modalOpen: document.getElementById('confirm-modal').classList.contains('active'),
        msg: toast ? toast.innerText : ''
      };
      closeConfirmModal();
      state.session = null;
      sessionPendingDecision = false;
      return out;
    }
    var before = state.routines.length;
    var active = attempt({ routineId: 'rA', status: 'active', exercises: [] }, false);
    var paused = attempt({ routineId: 'rA', status: 'paused', exercises: [] }, false);
    var recovered = attempt({ routineId: 'rA', status: 'active', exercises: [] }, true);
    return { before: before, after: state.routines.length, active: active, paused: paused, recovered: recovered };
  })()`);
  check("excluir: bloqueia rotina em execução (sessão ativa)",
    guard.active.modalOpen === false && guard.after === guard.before, JSON.stringify(guard.active));
  check("excluir: mensagem distingue sessão ativa / pausada / recuperada",
    /em execução/i.test(guard.active.msg) && /pausada/i.test(guard.paused.msg) &&
      /recuperada/i.test(guard.recovered.msg),
    JSON.stringify({ ativa: guard.active.msg, pausada: guard.paused.msg, recuperada: guard.recovered.msg }));

  await loadPage();
  const afterDelReload = await ev(`(function(){
    return {
      n: state.routines.length,
      hasSmoke: state.routines.some(function(r){ return r.name === 'Rotina do Smoke'; }),
      history: state.history.length,
      prs: PR.getAll().length
    };
  })()`);
  check("excluir: exclusão persiste após reload (somente ela)",
    afterDelReload.n === 3 && !afterDelReload.hasSmoke && afterDelReload.history >= 4 && afterDelReload.prs > 0,
    JSON.stringify(afterDelReload));

  // --- Sprint 4: sessão persistida, retomada após reload e sem duplicidade ---
  const sessionStart = await ev(`(function(){
    state.editingRoutineId = 'rC';            // rotina C (1 exercício, 4 séries)
    startWorkoutSession();
    state.autoRestEnabled = false;            // sem descanso: foco na persistência
    completeSet();                            // conclui 1 série real pelo fluxo da UI
    var stored = JSON.parse(localStorage.getItem('tt_ds_v1_session') || 'null');
    return {
      player: document.getElementById('screen-player').classList.contains('active'),
      sessionId: state.session ? state.session.id : null,
      status: state.session ? state.session.status : null,
      setsCompleted: state.session ? state.session.exercises[0].setsCompleted : -1,
      storedId: stored ? stored.id : null,
      storedSets: stored ? stored.exercises[0].setsCompleted : -1,
      routineId: stored ? stored.routineId : null
    };
  })()`);
  check("Sprint 4: iniciar treino abre o player e persiste a sessão",
    sessionStart.player && !!sessionStart.storedId && sessionStart.storedId === sessionStart.sessionId,
    JSON.stringify(sessionStart));
  check("Sprint 4: série concluída é persistida no progresso",
    sessionStart.storedSets === 1 && sessionStart.setsCompleted === 1, JSON.stringify(sessionStart));
  check("Sprint 4: routineId preservado na sessão persistida",
    sessionStart.routineId === 'rC', JSON.stringify(sessionStart));

  const emptyRoutineStart = await ev(`(function(){
    var routine = { id: 'rEmpty', letter: 'V', name: 'Vazia', exercises: [] };
    var savedSession = localStorage.getItem('tt_ds_v1_session');
    state.routines.push(routine);
    state.editingRoutineId = routine.id;
    state.session = null;
    Persistence.clearSession();
    navigate('prep');
    startWorkoutSession();
    var result = {
      player: document.getElementById('screen-player').classList.contains('active'),
      prep: document.getElementById('screen-prep').classList.contains('active'),
      session: state.session,
      persisted: localStorage.getItem('tt_ds_v1_session'),
      toast: document.getElementById('app-toast').innerText,
      error: document.getElementById('app-toast').classList.contains('error')
    };
    if (savedSession !== null) localStorage.setItem('tt_ds_v1_session', savedSession);
    return result;
  })()`);
  check("Sprint 4: rotina sem exercícios não abre Player e orienta o usuário",
    emptyRoutineStart.player === false && emptyRoutineStart.prep === true && emptyRoutineStart.session === null &&
      emptyRoutineStart.persisted === null && emptyRoutineStart.error === true && /Adicione pelo menos um exercício/i.test(emptyRoutineStart.toast),
    JSON.stringify(emptyRoutineStart));

  // --- RELOAD: a sessão em andamento volta e o app oferece retomar ----------
  await loadPage();
  const restored = await ev(`(function(){
    return {
      sessionId: state.session ? state.session.id : null,
      status: state.session ? state.session.status : null,
      sets: state.session ? state.session.exercises[0].setsCompleted : -1,
      routineId: state.session ? state.session.routineId : null,
      modal: document.getElementById('resume-modal').classList.contains('active'),
      player: document.getElementById('screen-player').classList.contains('active')
    };
  })()`);
  check("Sprint 4 RELOAD: sessão em andamento restaurada (sanitizada)",
    restored.sessionId === sessionStart.sessionId && restored.sets === 1 &&
      restored.status === 'active' && restored.routineId === 'rC',
    JSON.stringify(restored));
  check("Sprint 4 RELOAD: oferece retomar ou descartar (não entra no player sozinho)",
    restored.modal === true && restored.player === false, JSON.stringify(restored));

  const resumed = await ev(`(function(){
    resumeRestoredSession();
    return {
      player: document.getElementById('screen-player').classList.contains('active'),
      modal: document.getElementById('resume-modal').classList.contains('active'),
      sessionId: state.session ? state.session.id : null
    };
  })()`);
  check("Sprint 4: retomar volta ao player com a MESMA execução",
    resumed.player && resumed.modal === false && resumed.sessionId === sessionStart.sessionId,
    JSON.stringify(resumed));

  // --- conclui o treino e confere histórico/PRs/limpeza --------------------
  const finished = await ev(`(async function(){
    var before = state.history.length;
    var prsBefore = PR.getAll().length;
    var id = state.session.id;
    var guard = 0;
    var esperarJanela = function(){ return new Promise(function(r){ setTimeout(r, ${TAP_WAIT_MS}); }); };
    // E6: um toque duplo não pode registrar duas séries (a blindagem é uma janela
    // por intenção). O laço paceia os toques como um humano faria — concluir
    // séries leva segundos, não milissegundos.
    while (state.session && state.session.status !== 'finished' && guard++ < 20) {
      completeSet();
      if (state.session && state.session.status !== 'finished') await esperarJanela();
    }
    var isFinished = !!state.session && state.session.status === 'finished';
    await esperarJanela();                    // deixa a janela do último toque passar
    completeSet();                            // toque de CONFIRMAÇÃO: grava e sai
    var top = state.history[0];
    return {
      isFinished: isFinished,
      before: before, after: state.history.length,
      entryId: top ? top.id : null,
      entrySessionId: top ? top.sessionId : null,
      entryStatus: top ? top.status : null,
      entrySets: top && top.exercises && top.exercises[0] ? top.exercises[0].sets.length : 0,
      prsAdded: PR.getAll().length - prsBefore,
      storedSession: localStorage.getItem('tt_ds_v1_session'),
      home: document.getElementById('screen-home').classList.contains('active'),
      id: id
    };
  })()`);
  check("Sprint 4: treino concluído registra o histórico com a execução de origem",
    finished.isFinished && finished.after === finished.before + 1 &&
      String(finished.entrySessionId) === finished.id && finished.entryStatus === 'completed',
    JSON.stringify(finished));
  check("Sprint 4: id da entrada do histórico continua numérico (contrato legado)",
    typeof finished.entryId === 'number' && finished.entryId > 0, String(finished.entryId));
  check("Sprint 4: histórico guarda as séries concluídas e gera PRs",
    finished.entrySets >= 1 && finished.prsAdded > 0 && finished.home, JSON.stringify(finished));
  check("Sprint 4: sessão persistida é limpa ao finalizar",
    finished.storedSession === null, String(finished.storedSession));

  const noDup = await ev(`(function(){
    var histBefore = state.history.length;
    var prsBefore = PR.getAll().length;
    var again = PR.checkNewPR(state.history[0], state.history);
    return { histBefore: histBefore, histAfter: state.history.length, newPRs: again.length, prsSame: PR.getAll().length === prsBefore };
  })()`);
  check("Sprint 4: reprocessar a execução não duplica histórico nem PRs",
    noDup.histAfter === noDup.histBefore && noDup.newPRs === 0 && noDup.prsSame, JSON.stringify(noDup));

  // --- descartar a sessão recuperada não mexe em nada além dela ------------
  const discardedStart = await ev(`(function(){
    state.editingRoutineId = 'rB';
    startWorkoutSession();
    state.autoRestEnabled = false;
    completeSet();
    return { id: state.session.id, stored: !!localStorage.getItem('tt_ds_v1_session') };
  })()`);
  await loadPage();
  const discarded = await ev(`(function(){
    var histBefore = state.history.length;
    var prsBefore = PR.getAll().length;
    var routinesBefore = state.routines.length;
    var catBefore = Catalog.all().length;
    var modal = document.getElementById('resume-modal').classList.contains('active');
    discardRestoredSession();
    return {
      modal: modal,
      session: state.session,
      stored: localStorage.getItem('tt_ds_v1_session'),
      histSame: state.history.length === histBefore,
      prsSame: PR.getAll().length === prsBefore,
      routinesSame: state.routines.length === routinesBefore,
      catSame: Catalog.all().length === catBefore
    };
  })()`);
  check("Sprint 4: descartar a sessão recuperada limpa só a sessão",
    discardedStart.stored === true && discarded.modal === true && discarded.session === null &&
      discarded.stored === null && discarded.histSame && discarded.prsSame &&
      discarded.routinesSame && discarded.catSame,
    JSON.stringify({ start: discardedStart, after: discarded }));

  // --- RELOAD final: nada de sessão pendente e dados preservados -----------
  await loadPage();
  const endState = await ev(`(function(){
    return {
      session: state.session,
      modal: document.getElementById('resume-modal').classList.contains('active'),
      routines: state.routines.length,
      history: state.history.length,
      prs: PR.getAll().length,
      catalog: Catalog.all().length
    };
  })()`);
  check("Sprint 4: sem sessão pendente não há convite para retomar",
    endState.session === null && endState.modal === false, JSON.stringify(endState));
  check("Sprint 4: rotinas, histórico, PRs e catálogo intactos após o ciclo",
    endState.routines === 3 && endState.history >= 5 && endState.prs > 12 && endState.catalog >= 80,
    JSON.stringify(endState));

  // --- E3: o descanso passa a existir como DOMÍNIO, sem tocar o timer visual
  const restWiring = await ev(`(function(){
    const R = window.RestTimer;
    const t = R.create(60, 's_demo', new Date());
    const snap = R.snapshot(t, new Date(t.endsAt.getTime() - 30000));
    return {
      exposto: !!R && typeof R.create === 'function' && typeof R.alignToSession === 'function',
      restante: snap.remainingMs,
      progresso: snap.progress,
      recusaSemSessao: window.WorkoutController.restStart(null, 60, new Date()).reason,
      elementos: typeof startRestTimer === 'function' && typeof skipRest === 'function' &&
        !!document.getElementById('rest-overlay') && !!document.getElementById('rest-timer-display')
    };
  })()`);
  check("E3: domínio do descanso disponível no browser (overlay e telas presentes)",
    restWiring.exposto === true && restWiring.restante === 30000 && restWiring.progresso === 0.5 &&
      restWiring.recusaSemSessao === "no-session" && restWiring.elementos === true,
    JSON.stringify(restWiring));

  // --- E4: a tela acesa acompanha o ciclo do Player -------------------------
  // Intenção declarada (`enabled`) NÃO é o mesmo que bloqueio vivo (`active`):
  // o segundo depende do navegador/contexto. O que se verifica é que a
  // intenção segue o ciclo do Player e que nada quebra quando não há suporte.
  const wakeCycle = await ev(`(function(){
    const W = window.WakeLock;
    const exposto = !!W && typeof W.setEnabled === 'function' && typeof W.attach === 'function';
    const inicial = exposto ? W.status() : null;
    state.editingRoutineId = state.routines[0].id;
    state.session = null;
    startWorkoutSession();
    const ativo = W.status();
    pauseWorkout();
    const pausado = W.status();
    resumeWorkout(new Date());
    const retomado = W.status();
    discardAndExit();
    const saiu = W.status();
    return {
      exposto: exposto,
      suportado: typeof inicial.supported === 'boolean',
      attached: inicial.attached === true,
      semBloqueioInicial: inicial.active === false && inicial.enabled === false,
      ativo: ativo.enabled, pausado: pausado.enabled, retomado: retomado.enabled, saiu: saiu.enabled,
      semBloqueioFinal: saiu.active === false,
      sessaoLimpa: state.session === null,
      foraDoPlayer: !document.getElementById('screen-player').classList.contains('active')
    };
  })()`);
  check("E4: tela acesa segue o ciclo do Player e não quebra o treino",
    wakeCycle.exposto === true && wakeCycle.suportado === true && wakeCycle.attached === true &&
      wakeCycle.semBloqueioInicial === true &&
      wakeCycle.ativo === true && wakeCycle.pausado === false && wakeCycle.retomado === true &&
      wakeCycle.saiu === false && wakeCycle.semBloqueioFinal === true &&
      wakeCycle.sessaoLimpa === true && wakeCycle.foraDoPlayer === true,
    JSON.stringify(wakeCycle));

  // --- E5: pausa/retomada + descanso medido pelo DOMÍNIO (prazo absoluto) ----
  // 1) série REAL abre o descanso com o tempo vindo do domínio
  const restE5 = await ev(`(function(){
    state.editingRoutineId = state.routines[0].id;   // rotina A: descanso de 60s
    state.session = null;
    startWorkoutSession();
    completeSet();
    const t0 = restSnapshot(new Date());
    const antes = t0.remainingMs;
    adjustRestTime(15);
    const mais = restSnapshot(new Date()).remainingMs;
    adjustRestTime(-15);
    const menos = restSnapshot(new Date()).remainingMs;
    return {
      noPlayer: document.getElementById('screen-player').classList.contains('active'),
      overlay: document.getElementById('rest-overlay').classList.contains('active'),
      display: document.getElementById('rest-timer-display').innerText,
      ticker: state.restTimer.id !== null,
      temTimer: !!state.restTimer.timer,
      autoRest: state.autoRestEnabled,
      setCompleta: state.session.exercises[0].setsCompleted,
      total: t0.durationMs, restante: antes, status: t0.status,
      mais: mais, menos: menos, totalDepois: restSnapshot(new Date()).durationMs
    };
  })()`);
  check("E5: concluir série abre o descanso medido pelo domínio (prazo absoluto)",
    restE5.noPlayer === true && restE5.overlay === true && restE5.ticker === true &&
      restE5.temTimer === true && restE5.autoRest === true && restE5.setCompleta === 1 &&
      restE5.total === 60000 && restE5.restante > 59000 && restE5.status === 'running' &&
      /^0[01]:\d\d$/.test(restE5.display),
    JSON.stringify(restE5));
  check("E5: ±15s passa pelo domínio (a duração planejada acompanha o acréscimo)",
    restE5.mais - restE5.restante > 14000 && restE5.mais - restE5.restante <= 15500 &&
      restE5.menos <= restE5.restante && restE5.totalDepois >= restE5.mais,
    JSON.stringify({ antes: restE5.restante, mais: restE5.mais, menos: restE5.menos, total: restE5.totalDepois }));

  // 2) pausar o TREINO congela o descanso e a UI reflete o estado
  const pausaE5 = await ev(`(function(){
    togglePauseWorkout();
    const snap = restSnapshot(new Date());
    return {
      sessao: state.session.status, descanso: snap.status, restante: snap.remainingMs,
      display: document.getElementById('rest-timer-display').innerText,
      ticker: state.restTimer.id !== null,
      botao: document.getElementById('btn-pause-resume').innerText,
      esperado: translations[state.lang].resume_workout,
      cta: document.getElementById('btn-complete-set').innerText,
      esperadoCta: translations[state.lang].workout_paused
    };
  })()`);
  check("E5: pausar congela o descanso e a UI reflete o estado",
    pausaE5.sessao === 'paused' && pausaE5.descanso === 'paused' && pausaE5.ticker === true &&
      pausaE5.botao === pausaE5.esperado && pausaE5.cta === pausaE5.esperadoCta,
    JSON.stringify(pausaE5));

  await sleep(700);
  const congeladoE5 = await ev(`(function(){
    const snap = restSnapshot(new Date());
    return {
      restante: snap.remainingMs, status: snap.status,
      display: document.getElementById('rest-timer-display').innerText,
      recusa: WorkoutController.completeSet(state.session, { weight: 1, reps: 1 }, new Date()).reason
    };
  })()`);
  check("E5: descanso pausado não consome tempo (o ticker não é fonte de verdade)",
    congeladoE5.status === 'paused' && congeladoE5.display === pausaE5.display &&
      Math.abs(congeladoE5.restante - pausaE5.restante) < 60,
    JSON.stringify({ antes: pausaE5.restante, depois: congeladoE5.restante, display: congeladoE5.display }));
  check("E5: sessão pausada recusa concluir série (quem decide é o domínio)",
    congeladoE5.recusa === 'not-active', congeladoE5.recusa);

  // 3) retomar volta a contar do ponto congelado
  const retomaE5 = await ev(`(function(){
    togglePauseWorkout();
    const snap = restSnapshot(new Date());
    return {
      sessao: state.session.status, descanso: snap.status, restante: snap.remainingMs,
      botao: document.getElementById('btn-pause-resume').innerText,
      esperado: translations[state.lang].pause_workout
    };
  })()`);
  await sleep(700);
  const andandoE5 = await ev(`(function(){ const s = restSnapshot(new Date()); return { restante: s.remainingMs, status: s.status }; })()`);
  check("E5: retomar volta a contar do ponto congelado (sem perder nem dobrar tempo)",
    retomaE5.sessao === 'active' && retomaE5.descanso === 'running' &&
      retomaE5.botao === retomaE5.esperado &&
      Math.abs(retomaE5.restante - congeladoE5.restante) < 60 &&
      andandoE5.restante < retomaE5.restante - 400,
    JSON.stringify({ congelado: congeladoE5.restante, retomado: retomaE5.restante, depois: andandoE5.restante }));

  // 4) pular encerra pelo domínio e mata o ticker
  const puloE5 = await ev(`(function(){
    skipRest();
    return {
      overlay: document.getElementById('rest-overlay').classList.contains('active'),
      tickerCancelado: state.restTimer.id === null,
      timerDescartado: state.restTimer.timer === null,
      sessao: state.session ? state.session.status : null
    };
  })()`);
  check("E5: pular encerra o descanso, fecha o overlay e cancela o ticker",
    puloE5.overlay === false && puloE5.tickerCancelado === true &&
      puloE5.timerDescartado === true && puloE5.sessao === 'active',
    JSON.stringify(puloE5));

  // 5) sair do Player com descanso aberto NÃO deixa interval órfão (fim do vazamento)
  const saidaE5 = await ev(`(function(){
    startRestTimer(60);
    const aberto = document.getElementById('rest-overlay').classList.contains('active');
    const tickerAntes = state.restTimer.id !== null;
    saveAndExit();
    return {
      aberto: aberto, tickerAntes: tickerAntes,
      overlayFinal: document.getElementById('rest-overlay').classList.contains('active'),
      tickerFinal: state.restTimer.id !== null,
      timerFinal: state.restTimer.timer !== null,
      sessaoFinal: state.session === null,
      home: document.getElementById('screen-home').classList.contains('active')
    };
  })()`);
  check("E5: sair do Player com descanso aberto encerra timer e ticker (sem vazamento)",
    saidaE5.aberto === true && saidaE5.tickerAntes === true && saidaE5.overlayFinal === false &&
      saidaE5.tickerFinal === false && saidaE5.timerFinal === false &&
      saidaE5.sessaoFinal === true && saidaE5.home === true,
    JSON.stringify(saidaE5));

  // 6) descanso curto vence sozinho e encerra pelo domínio (settle)
  const venceE5 = await ev(`(function(){
    state.editingRoutineId = state.routines[0].id;
    state.session = null;
    startWorkoutSession();
    const abriu = startRestTimer(1);
    return { abriu: abriu, overlay: document.getElementById('rest-overlay').classList.contains('active') };
  })()`);
  await sleep(1700);
  const vencidoE5 = await ev(`(function(){
    return {
      overlay: document.getElementById('rest-overlay').classList.contains('active'),
      tickerCancelado: state.restTimer.id === null,
      timerDescartado: state.restTimer.timer === null
    };
  })()`);
  check("E5: descanso que vence fecha sozinho e encerra pelo domínio",
    venceE5.abriu === true && venceE5.overlay === true && vencidoE5.overlay === false &&
      vencidoE5.tickerCancelado === true && vencidoE5.timerDescartado === true,
    JSON.stringify({ ...venceE5, ...vencidoE5 }));

  // 7) pausado, o prazo estourado NÃO encerra o descanso (pausa congela de propósito)
  const pausaVencidaE5 = await ev(`(function(){
    startRestTimer(1);
    togglePauseWorkout();
    const snap = restSnapshot(new Date());
    return {
      overlay: document.getElementById('rest-overlay').classList.contains('active'),
      restante: snap.remainingMs, status: snap.status
    };
  })()`);
  await sleep(1700);
  const aindaParadoE5 = await ev(`(function(){
    const snap = restSnapshot(new Date());
    return {
      overlay: document.getElementById('rest-overlay').classList.contains('active'),
      restante: snap.remainingMs, status: snap.status, ticker: state.restTimer.id !== null
    };
  })()`);
  check("E5: descanso pausado não vence nem com o prazo estourado",
    pausaVencidaE5.overlay === true && pausaVencidaE5.status === 'paused' &&
      aindaParadoE5.overlay === true && aindaParadoE5.status === 'paused' &&
      aindaParadoE5.ticker === true &&
      Math.abs(aindaParadoE5.restante - pausaVencidaE5.restante) < 60,
    JSON.stringify({ ...pausaVencidaE5, ...aindaParadoE5 }));

  // 8) limpeza final
  const limpezaE5 = await ev(`(function(){
    skipRest();
    discardAndExit();
    return {
      overlay: document.getElementById('rest-overlay').classList.contains('active'),
      tickerFinal: state.restTimer.id !== null,
      sessaoFinal: state.session === null,
      home: document.getElementById('screen-home').classList.contains('active')
    };
  })()`);
  check("E5: descartar a sessão limpa descanso, ticker e estado",
    limpezaE5.overlay === false && limpezaE5.tickerFinal === false &&
      limpezaE5.sessaoFinal === true && limpezaE5.home === true,
    JSON.stringify(limpezaE5));

  // 9) sessão FINALIZADA: a UI não inventa estado (a recusa vem do controlador)
  const finalE5 = await ev(`(function(){
    state.editingRoutineId = state.routines[0].id;
    state.session = null;
    startWorkoutSession();
    WorkoutController.finish(state.session, new Date());
    updatePlayerUI();
    const antes = state.session.status;
    const pausou = togglePauseWorkout();
    const depois = state.session.status;
    const botao = document.getElementById('btn-pause-resume').innerText;
    const cta = document.getElementById('btn-complete-set').innerText;
    discardAndExit();
    return {
      antes: antes, pausou: pausou, depois: depois, botao: botao, cta: cta,
      esperado: translations[state.lang].pause_workout,
      esperadoCta: translations[state.lang].finish_workout,
      limpou: state.session === null &&
        !document.getElementById('rest-overlay').classList.contains('active') &&
        state.restTimer.id === null
    };
  })()`);
  check("E5: sessão finalizada não pausa nem vira 'Retomar' (recusa do controlador)",
    finalE5.antes === 'finished' && finalE5.pausou === false && finalE5.depois === 'finished' &&
      finalE5.botao === finalE5.esperado && finalE5.cta === finalE5.esperadoCta &&
      finalE5.limpou === true,
    JSON.stringify(finalE5));

  // --- E6: blindagem de toque duplo (janela por INTENÇÃO, no fluxo da UI) ----
  // O relógio aqui é o REAL (a UI usa new Date()), então o teste ESPERA a janela
  // passar quando quer simular o toque seguinte de uma sequência legítima.
  const duploE6 = await ev(`(function(){
    state.session = null;
    state.editingRoutineId = state.routines[0].id;   // rotina A: 4 séries no 1º exercício
    startWorkoutSession();
    state.autoRestEnabled = false;                   // foco na blindagem, não no descanso
    completeSet();                                   // toque 1: registra a série
    completeSet();                                   // toque duplo: ignorado
    completeSet();                                   // toque triplo: ignorado
    return {
      series: state.session.exercises[0].setsCompleted,
      registradas: state.session.exercises[0].completedSets.length,
      status: state.session.status
    };
  })()`);
  check("E6: toque duplo/triplo em 'Concluir Série' registra UMA série",
    duploE6.series === 1 && duploE6.registradas === 1 && duploE6.status === 'active',
    JSON.stringify(duploE6));

  await sleep(TAP_WAIT_MS);
  const depoisE6 = await ev(`(function(){
    completeSet();                                   // agora é outro toque, de verdade
    return { series: state.session.exercises[0].setsCompleted };
  })()`);
  check("E6: passada a janela, o toque seguinte registra a série seguinte",
    depoisE6.series === 2, JSON.stringify(depoisE6));

  const alternadorE6 = await ev(`(function(){
    const antes = state.session.status;
    togglePauseWorkout();                            // pausa
    togglePauseWorkout();                            // toque duplo: ignorado (não retoma)
    return {
      antes: antes, depois: state.session.status,
      botao: document.getElementById('btn-pause-resume').innerText,
      esperado: translations[state.lang].resume_workout
    };
  })()`);
  check("E6: toque duplo no alternador pausa UMA vez (não retoma em seguida)",
    alternadorE6.antes === 'active' && alternadorE6.depois === 'paused' &&
      alternadorE6.botao === alternadorE6.esperado,
    JSON.stringify(alternadorE6));

  const recusaE6 = await ev(`(function(){
    // Recusa do domínio NÃO é toque: a janela volta e o toque seguinte é atendido.
    // Execução NOVA (o start zera as janelas), então a checagem não depende do
    // pacing das anteriores; pausa/retoma por FORA da UI (o alternador tem janela
    // própria e não é o alvo aqui).
    discardAndExit();
    state.session = null;
    state.editingRoutineId = state.routines[0].id;
    startWorkoutSession();
    state.autoRestEnabled = false;
    WorkoutController.pause(state.session, new Date());
    const chave = tapKey('complete-set');
    completeSet();                                        // guard aceita, domínio recusa
    const janelaDevolvida = tapGuard.lastAt(chave) === null;
    completeSet();                                        // a janela voltou: recusa de novo
    WorkoutController.resume(state.session, new Date());
    completeSet();                                        // toque imediato após a recusa
    return {
      janelaDevolvida: janelaDevolvida,
      status: state.session.status,
      series: state.session.exercises[0].setsCompleted
    };
  })()`);
  check("E6: recusa não conta como toque (janela devolvida) e a UI não fica presa",
    recusaE6.janelaDevolvida === true && recusaE6.status === 'active' && recusaE6.series === 1,
    JSON.stringify(recusaE6));

  const novaExecucaoE6 = await ev(`(function(){
    discardAndExit();
    state.session = null;
    state.editingRoutineId = state.routines[0].id;
    startWorkoutSession();
    completeSet();                                   // 1ª série da execução NOVA
    return { series: state.session.exercises[0].setsCompleted, status: state.session.status };
  })()`);
  check("E6: a janela não vaza para a execução seguinte",
    novaExecucaoE6.series === 1 && novaExecucaoE6.status === 'active',
    JSON.stringify(novaExecucaoE6));

  // Caminhos NÃO blindados: já são idempotentes ou aditivos por DESIGN (auditoria).
  const auditE6 = await ev(`(function(){
    startRestTimer(60);
    const antes = restSnapshot(new Date()).remainingMs;
    adjustRestTime(15);
    adjustRestTime(15);                              // dois toques = +30 s (de propósito)
    const depois = restSnapshot(new Date()).remainingMs;
    skipRest();
    skipRest();                                      // repetir é no-op (já fechou)
    const out = {
      acrescimo: depois - antes,
      overlay: document.getElementById('rest-overlay').classList.contains('active'),
      ticker: state.restTimer.id !== null,
      timer: state.restTimer.timer !== null
    };
    discardAndExit();                                // deixa o Player limpo para o fim do smoke
    out.home = document.getElementById('screen-home').classList.contains('active');
    return out;
  })()`);
  check("E6: 'Pular Descanso' é idempotente e ±15s é aditivo por design",
    auditE6.acrescimo >= 29000 && auditE6.acrescimo <= 31000 && auditE6.overlay === false &&
      auditE6.ticker === false && auditE6.timer === false && auditE6.home === true,
    JSON.stringify(auditE6));

  // --- E7: acessibilidade (ARIA do Player) ---------------------------------
  const ariaLabelsE7 = await ev(`(function(){
    if (state.session) discardAndExit();
    state.session = null;
    state.editingRoutineId = state.routines[0].id;
    startWorkoutSession();
    var labels = {};
    ['pt','en','es'].forEach(function(l){
      I18n.setLocale(l);
      labels[l] = {
        decrease: document.getElementById('btn-rest-decrease').getAttribute('aria-label'),
        increase: document.getElementById('btn-rest-increase').getAttribute('aria-label'),
        exit: document.querySelector('#screen-player .btn-icon').getAttribute('aria-label'),
        esperadoDecrease: translations[l].rest_decrease,
        esperadoIncrease: translations[l].rest_increase,
        esperadoExit: translations[l].exit_workout
      };
    });
    I18n.setLocale('pt');
    document.getElementById('player-status').innerText = '';
    togglePauseWorkout();                            // pausa (1ª vez: aceita)
    var paused = document.getElementById('player-status').innerText;
    var display = document.getElementById('rest-timer-display');
    return {
      labels: labels, paused: paused,
      esperadoPaused: translations.pt.workout_paused,
      displayLive: display.getAttribute('aria-live'),
      displayInLive: !!display.closest('[aria-live]')
    };
  })()`);
  check("E7: ±15s e ✕ têm nome acessível localizado (pt/en/es)",
    ["pt", "en", "es"].every((l) => {
      const L = ariaLabelsE7.labels[l];
      return L.decrease === L.esperadoDecrease && L.increase === L.esperadoIncrease &&
        L.exit === L.esperadoExit && L.decrease.indexOf("- 15s") === 0 && L.increase.indexOf("+ 15s") === 0;
    }),
    JSON.stringify(ariaLabelsE7.labels.pt));
  check("E7: pausar anuncia o estado na região viva",
    ariaLabelsE7.paused === ariaLabelsE7.esperadoPaused, ariaLabelsE7.paused);
  check("E7: o visor do descanso não é região viva (sem ruído por tick)",
    ariaLabelsE7.displayLive === null && ariaLabelsE7.displayInLive === false,
    JSON.stringify({ live: ariaLabelsE7.displayLive, inLive: ariaLabelsE7.displayInLive }));

  await sleep(TAP_WAIT_MS);                          // E6: toque seguinte é de verdade
  const resumeA11yE7 = await ev(`(function(){
    togglePauseWorkout();                            // retoma
    return { anuncio: document.getElementById('player-status').innerText,
             esperado: translations.pt.workout_resumed, status: state.session.status };
  })()`);
  check("E7: retomar anuncia o estado na região viva",
    resumeA11yE7.anuncio === resumeA11yE7.esperado && resumeA11yE7.status === 'active',
    JSON.stringify(resumeA11yE7));

  const focoE7 = await ev(`(function(){
    // Navegação por teclado: o foco ENTRA no overlay ao abrir e VOLTA ao CTA ao
    // fechar (não fica preso atrás do overlay nem cai no <body>).
    startRestTimer(30);
    var aoAbrir = document.activeElement ? document.activeElement.id : null;
    skipRest();
    var aoFechar = document.activeElement ? document.activeElement.id : null;
    return { aoAbrir: aoAbrir, aoFechar: aoFechar, tela: state.currentScreen };
  })()`);
  check("E7: foco entra no overlay ao abrir e volta ao CTA ao fechar",
    focoE7.aoAbrir === 'btn-rest-increase' && focoE7.aoFechar === 'btn-complete-set' &&
      focoE7.tela === 'player',
    JSON.stringify(focoE7));

  // E7.1: o overlay aberto é um diálogo MODAL com contenção de foco por Tab.
  const trapE7 = await ev(`(function(){
    startRestTimer(60);
    var ov = document.getElementById('rest-overlay');
    var btns = Array.prototype.slice.call(document.querySelectorAll('#rest-overlay button'));
    var first = btns[0].id, last = btns[btns.length - 1].id;
    function press(key, shift){
      document.dispatchEvent(new KeyboardEvent('keydown', { key: key, shiftKey: !!shift, bubbles: true, cancelable: true }));
    }
    var out = {
      role: ov.getAttribute('role'), modal: ov.getAttribute('aria-modal'),
      labelledby: ov.getAttribute('aria-labelledby'),
      focusInicial: document.activeElement.id, trap: restTrapActive, first: first, last: last
    };
    btns[btns.length - 1].focus();                       // no ÚLTIMO controle
    press('Tab', false);                                 // Tab -> volta ao PRIMEIRO
    out.wrapForward = document.activeElement.id;
    btns[0].focus();                                     // no PRIMEIRO
    press('Tab', true);                                  // Shift+Tab -> vai ao ÚLTIMO
    out.wrapBackward = document.activeElement.id;
    document.getElementById('btn-complete-set').focus(); // foco FORA do overlay
    press('Tab', false);                                 // Tab -> traz de volta
    out.pulledIn = document.activeElement.id;
    return out;
  })()`);
  check("E7.1: overlay aberto = diálogo modal com foco inicial e Tab contido",
    trapE7.role === 'dialog' && trapE7.modal === 'true' && trapE7.labelledby === 'rest-overlay-label' &&
      trapE7.focusInicial === 'btn-rest-increase' && trapE7.trap === true &&
      trapE7.wrapForward === trapE7.first && trapE7.wrapBackward === trapE7.last &&
      trapE7.pulledIn === trapE7.first,
    JSON.stringify(trapE7));

  const trapCloseE7 = await ev(`(function(){
    // Escape fecha pelo caminho seguro (skipRest) e NÃO deixa a contenção presa.
    var ov = document.getElementById('rest-overlay');
    var trapAntes = restTrapActive;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    var out = {
      trapAntes: trapAntes, overlay: ov.classList.contains('active'), trap: restTrapActive,
      timer: state.restTimer.timer === null, foco: document.activeElement.id,
      sessao: state.session ? state.session.status : null
    };
    // Fechado: um Tab NÃO deve mais mexer no foco (contenção liberada).
    document.getElementById('btn-complete-set').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    out.focoAposTab = document.activeElement.id;
    return out;
  })()`);
  check("E7.1: Escape fecha com segurança, libera a contenção e devolve o foco",
    trapCloseE7.trapAntes === true && trapCloseE7.overlay === false && trapCloseE7.trap === false &&
      trapCloseE7.timer === true && trapCloseE7.foco === 'btn-complete-set' &&
      trapCloseE7.focoAposTab === 'btn-complete-set' && trapCloseE7.sessao === 'active',
    JSON.stringify(trapCloseE7));

  // --- E7: responsividade do Player (medição real em 5 larguras) -----------
  const E7_WIDTHS = [
    { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 390, h: 844 }, { w: 430, h: 932 }, { w: 1024, h: 768 },
  ];
  for (const vp of E7_WIDTHS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 600,
      screenWidth: vp.w, screenHeight: vp.h,
    });
    // Monta o Player + descanso aberto e espera a animação de entrada terminar
    // (o .screen usa fadeIn com transform; medir durante isso desloca o rect).
    await ev(`(function(){
      if (state.session) discardAndExit();
      state.session = null;
      state.editingRoutineId = state.routines[0].id;
      startWorkoutSession();
      document.getElementById('toggle-auto-rest').checked = false;
      state.autoRestEnabled = false;
      startRestTimer(60);
      return true;
    })()`);
    await sleep(450);
    const probe = await ev(`(function(){
      var vw = window.innerWidth;
      function rect(sel){ var el = document.querySelector(sel); if (!el) return null;
        var b = el.getBoundingClientRect(); return { l:b.left, r:b.right, w:b.width, h:b.height }; }
      var overlay = document.getElementById('rest-overlay');
      return {
        vw: vw,
        app: rect('#app'),
        cta: rect('#btn-complete-set'),
        pause: rect('#btn-pause-resume'),
        exit: rect('#screen-player .btn-icon'),
        adjust: rect('#screen-player .btn-adjust'),
        circle: rect('#rest-overlay .rest-circle-container'),
        minus: rect('#btn-rest-decrease'),
        ovScrollW: overlay.scrollWidth, ovClientW: overlay.clientWidth,
        ovScrollH: overlay.scrollHeight, ovClientH: overlay.clientHeight,
        docScrollW: document.documentElement.scrollWidth
      };
    })()`);
    await ev(`(function(){ skipRest(); discardAndExit(); return true; })()`);

    const p = probe;
    const tag = vp.w + "x" + vp.h;
    const dentroApp = p.cta.l >= p.app.l - 1 && p.cta.r <= p.app.r + 1;
    check(`E7 ${tag}: sem rolagem horizontal`,
      p.docScrollW <= p.vw + 1 && p.ovScrollW <= p.ovClientW + 1 && p.app.r <= p.vw + 1,
      JSON.stringify({ doc: p.docScrollW, vw: p.vw, ovW: p.ovScrollW + "/" + p.ovClientW }));
    check(`E7 ${tag}: overlay do descanso cabe na tela (sem corte)`,
      p.circle.r <= p.vw + 1 && p.minus.l >= -1 && p.minus.r <= p.vw + 1 && p.ovScrollH <= p.ovClientH + 1,
      JSON.stringify({ circle: p.circle.w, ovH: p.ovScrollH + "/" + p.ovClientH }));
    check(`E7 ${tag}: alvos de toque >= 44 px e CTA alinhado à coluna do app`,
      p.pause.h >= 44 && p.exit.w >= 44 && p.exit.h >= 44 && p.adjust.h >= 44 && p.cta.h >= 44 && dentroApp,
      JSON.stringify({ pause: p.pause.h, exit: p.exit.w + "x" + p.exit.h, adjust: p.adjust.h, cta: p.cta.h, dentroApp: dentroApp }));
    if (vp.w >= 900) {
      check(`E7 ${tag}: app centrado e limitado a 480 px`,
        p.app.w <= 480 && Math.abs(p.app.l - (p.vw - p.app.w) / 2) <= 2,
        JSON.stringify({ appW: p.app.w, appL: p.app.l }));
    }
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
  });

  // --- Sprint 5.1: Home semanal (faixa, cardio e dias consecutivos) ---------
  // O histórico é semeado com datas RELATIVAS a hoje (determinístico em qualquer
  // dia de execução) e a Home é conferida a partir de DADOS REAIS.
  const homeWeekly = await ev(`(function(){
    function iso(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
    function rel(n){ var d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n); return iso(d); }
    function mondayISO(){ var d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return iso(d); }
    function weekEndISO(){ var d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)+6); return iso(d); }

    var grade = HomeInsights.build([], new Date()).days;      // só a grade da semana
    var todayIdx = 0;
    grade.forEach(function(d,i){ if (d.isToday) todayIdx = i; });
    var today = grade[todayIdx].dateISO;
    var yesterday = rel(-1);
    var cardioDay = grade[grade[6].isToday ? 5 : 6].dateISO; // dia do cardio != hoje

    state.history = [
      { id:100, name:'Treino A — Peito', status:'completed', dateISO:today, letter:'A' },
      { id:200, name:'Treino B — Costas', status:'completed', dateISO:today, letter:'B' },
      { id:300, name:'Treino C — Pernas', status:'completed', dateISO:today, letter:'C' },
      { id:150, name:'Treino A — Peito', status:'completed', dateISO:yesterday, letter:'A' },
      { id:120, name:'Força (sem marcação)', status:'completed', dateISO:cardioDay, durationMin:45 },
      { id:121, name:'Corrida', status:'completed', dateISO:cardioDay, category:'cardio', durationMin:40 },
      { id:122, name:'Bicicleta', status:'completed', dateISO:cardioDay, type:'cardio', durationMin:20 },
      { id:90,  name:'Cardio de outra semana', status:'completed', dateISO:rel(-10), category:'cardio', durationMin:999 },
      { id:1,   name:'Treino legado', date:'Ontem, 18:30', status:'completed' }
    ];
    navigate('home');

    var t = I18n.dict[I18n.getLocale()];
    var strip = document.getElementById('home-weekly-strip');
    // O render troca o conteúdo da faixa: qualquer leitura nova precisa reconsultar
    // o DOM (nós antigos ficam destacados).
    var cellAt = function(i){ return document.querySelectorAll('#home-weekly-strip .weekly-day')[i]; };
    var cells = Array.prototype.slice.call(strip.querySelectorAll('.weekly-day'));
    var naSemana = function(v){ return grade.some(function(d){ return d.dateISO === v; }); };
    var diasEsperados = [today, yesterday, cardioDay]
      .filter(function(v,i,a){ return naSemana(v) && a.indexOf(v) === i; }).length;
    var vazias = cells.filter(function(c){ return c.classList.contains('empty'); });
    var insights = HomeInsights.build(state.history, new Date());
    var hoje = cellAt(todayIdx);

    // Estado INICIAL (antes de qualquer redesenho) — replicado no retorno.
    var inicial = {
      treinosHoje: insights.days[todayIdx].count,
      contadorHoje: (hoje.querySelector('.weekly-day-more') || {}).innerText || '',
      marcadorHoje: hoje.querySelector('.weekly-day-workout').innerText.trim(),
      diasComTreino: cells.filter(function(c){ return !c.classList.contains('empty'); }).length,
      legadoSome: cells.every(function(c){ return !/Ontem|legado/.test(c.textContent); }),
      cardio: document.getElementById('home-cardio-value').innerText.trim(),
      sequencia: document.getElementById('home-streak-value').innerText.trim(),
      // Sprint 5.1.4: a legenda "atingido / meta" foi removida do card de cardio.
      cardioTitulo: document.querySelector('#screen-home .home-metric-label').innerText.trim(),
      legendaRemovida: document.querySelectorAll('#screen-home .home-metric-note').length === 0,
      textoMetricas: document.querySelector('#screen-home .home-metrics').innerText,
      alturaCardio: document.querySelector('#screen-home .home-metric').getBoundingClientRect().height,
      cardsMetrica: document.querySelectorAll('#screen-home .home-metric').length,
      rotuloFaixa: strip.getAttribute('aria-label') || '',
      lista: strip.getAttribute('role'),
      itens: cells.every(function(c){ return c.getAttribute('role') === 'listitem' && (c.getAttribute('aria-label') || '').length > 0; }),
      rotuloHoje: hoje.getAttribute('aria-label') || ''
    };

    // Salvar um treino REAL precisa atualizar a Home sem depender de navegação.
    var semeado = state.history.slice();
    state.history = [];
    navigate('home');
    var vazioAntes = cellAt(todayIdx).classList.contains('empty');
    state.session = {
      id:'s_smoke_51', letter:'D', routineName:'Smoke 5.1',
      startedAt:new Date(Date.now() - 5*60000),
      exercises:[{ catalogId:'C-02', name:'Supino', completedSets:[{ weight:40, reps:10 }] }]
    };
    var salvo = saveSessionToHistory('completed');
    state.session = null;
    var vazioDepois = cellAt(todayIdx).classList.contains('empty');
    var marcadorSalvo = cellAt(todayIdx).querySelector('.weekly-day-workout').innerText.trim();

    state.history = semeado;                                  // devolve o cenário
    navigate('home');

    return {
      dias: cells.length,
      primeiraISO: grade[0].dateISO,
      ultimaISO: grade[6].dateISO,
      segundaISO: mondayISO(),
      domingoISO: weekEndISO(),
      treinosHoje: inicial.treinosHoje,
      contadorHoje: inicial.contadorHoje,
      marcadorHoje: inicial.marcadorHoje,
      diasSemTreino: vazias.length,
      vazioUsaNoWorkout: vazias.length > 0 && vazias.every(function(c){ return c.querySelector('.weekly-day-workout').innerText.trim() === t.no_workout; }),
      diasEsperados: diasEsperados,
      diasComTreino: inicial.diasComTreino,
      legadoSome: inicial.legadoSome,
      cardio: inicial.cardio,
      cardioTitulo: inicial.cardioTitulo,
      legendaRemovida: inicial.legendaRemovida,
      textoSemLegenda: inicial.textoMetricas.indexOf('atingido') === -1 &&
        inicial.textoMetricas.indexOf('/ meta') === -1 && inicial.textoMetricas.indexOf('/meta') === -1,
      alturaCardio: inicial.alturaCardio,
      cardsMetrica: inicial.cardsMetrica,
      sequencia: inicial.sequencia,
      unidadeDias: t.days,
      rotuloFaixa: inicial.rotuloFaixa,
      rotuloEsperado: t.weekly_strip_label,
      lista: inicial.lista,
      itens: inicial.itens,
      rotuloHoje: inicial.rotuloHoje,
      vazioAntes: vazioAntes,
      salvoOk: !!(salvo && salvo.ok),
      marcadorSalvo: marcadorSalvo,
      vazioDepois: vazioDepois
    };
  })()`, "home semanal");

  check("Sprint 5.1: faixa semanal com os sete dias, de segunda a domingo",
    homeWeekly.dias === 7 && homeWeekly.primeiraISO === homeWeekly.segundaISO &&
      homeWeekly.ultimaISO === homeWeekly.domingoISO,
    JSON.stringify({ dias: homeWeekly.dias, primeira: homeWeekly.primeiraISO, ultima: homeWeekly.ultimaISO }));
  check("Sprint 5.1: vários treinos no mesmo dia -> último registro + contador (+N)",
    homeWeekly.treinosHoje === 3 && homeWeekly.contadorHoje === '+2' && homeWeekly.marcadorHoje === 'C',
    JSON.stringify({ treinos: homeWeekly.treinosHoje, contador: homeWeekly.contadorHoje, marcador: homeWeekly.marcadorHoje }));
  check("Sprint 5.1: dias sem treino ficam vazios e o legado sem dateISO não entra",
    homeWeekly.diasComTreino === homeWeekly.diasEsperados && homeWeekly.diasSemTreino > 0 &&
      homeWeekly.vazioUsaNoWorkout === true && homeWeekly.legadoSome === true,
    JSON.stringify({ comTreino: homeWeekly.diasComTreino, esperados: homeWeekly.diasEsperados, semTreino: homeWeekly.diasSemTreino }));
  check("Sprint 5.1: cardio soma só entradas marcadas da semana (fora da semana não conta)",
    homeWeekly.cardio === '60 / 150 min', homeWeekly.cardio);
  check("Sprint 5.1.4: legenda 'atingido / meta' não aparece mais no card de cardio (título/valor intactos)",
    homeWeekly.legendaRemovida === true && homeWeekly.textoSemLegenda === true &&
      homeWeekly.cardioTitulo === 'Cardio da semana' && homeWeekly.cardio === '60 / 150 min' &&
      homeWeekly.cardsMetrica === 2 && homeWeekly.alturaCardio > 0,
    JSON.stringify({ legendaRemovida: homeWeekly.legendaRemovida, semTextoDeLegenda: homeWeekly.textoSemLegenda,
      titulo: homeWeekly.cardioTitulo, cardio: homeWeekly.cardio, cards: homeWeekly.cardsMetrica,
      altura: homeWeekly.alturaCardio }));
  check("Sprint 5.1: dias consecutivos contam apenas treinos concluídos (hoje + ontem)",
    homeWeekly.sequencia === '2 ' + homeWeekly.unidadeDias, homeWeekly.sequencia);
  check("Sprint 5.1: faixa é lista com nome acessível e cada dia tem rótulo",
    homeWeekly.lista === 'list' && homeWeekly.itens === true &&
      homeWeekly.rotuloFaixa === homeWeekly.rotuloEsperado && homeWeekly.rotuloHoje.length > 0,
    JSON.stringify({ lista: homeWeekly.lista, rotulo: homeWeekly.rotuloFaixa, hoje: homeWeekly.rotuloHoje }));
  check("Sprint 5.1: salvar treino atualiza a Home sem navegar",
    homeWeekly.vazioAntes === true && homeWeekly.salvoOk === true &&
      homeWeekly.vazioDepois === false && homeWeekly.marcadorSalvo === 'D',
    JSON.stringify({ vazioAntes: homeWeekly.vazioAntes, salvoOk: homeWeekly.salvoOk, marcador: homeWeekly.marcadorSalvo, vazioDepois: homeWeekly.vazioDepois }));

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 320, height: 568, deviceScaleFactor: 2, mobile: true, screenWidth: 320, screenHeight: 568,
  });
  await sleep(150);
  const homeWeekly320 = await ev(`(function(){
    function iso(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
    function rel(n){ var d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n); return iso(d); }
    // Três concluídos garantem overflow REAL na faixa (para medir o deslize).
    state.history = [
      { id:1, name:'Treino A — Peito', status:'completed', dateISO:rel(0), durationMin:30,
        exercises:[{ name:'Supino', sets:[{ weight:60, reps:10 }] }] },
      { id:2, name:'Treino B — Costas', status:'completed', dateISO:rel(-1), durationMin:40,
        exercises:[{ name:'Remada', sets:[{ weight:50, reps:10 }] }] },
      { id:3, name:'Treino C — Pernas', status:'completed', dateISO:rel(-10), durationMin:50,
        exercises:[{ name:'Agachamento', sets:[{ weight:80, reps:8 }] }] }
    ];
    navigate('home');
    var app = document.getElementById('app').getBoundingClientRect();
    var strip = document.getElementById('home-weekly-strip');
    var cells = strip.querySelectorAll('.weekly-day');
    var recent = document.getElementById('home-recent-strip');
    var rcards = recent.querySelectorAll('.recent-card');
    var rrect = recent.getBoundingClientRect();
    var prox = rcards.length > 1 ? rcards[1].getBoundingClientRect() : null;
    var hoje = document.getElementById('home-today-name').getBoundingClientRect();
    var recortado = false;
    for (var i = 0; i < rcards.length; i++) {
      var cr = rcards[i].getBoundingClientRect();
      if (cr.left < rrect.right - 1 && cr.right > rrect.right + 1) recortado = true;
    }
    var scrollAntes = window.scrollY;
    window.scrollTo(0, 300);
    var rolouVertical = window.scrollY > scrollAntes;
    window.scrollTo(0, 0);
    // Sprint 5.1.4: os DOIS cards de métrica seguem lado a lado (sem a legenda).
    var metricas = document.querySelectorAll('#screen-home .home-metric');
    var ultimaMetrica = metricas[metricas.length - 1].getBoundingClientRect();
    return {
      doc: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      app: app.width,
      rolavel: strip.scrollWidth > strip.clientWidth,
      celula: cells.length ? cells[cells.length-1].getBoundingClientRect().width : 0,
      dentroDoApp: strip.getBoundingClientRect().right <= app.right + 1,
      hojeDentro: hoje.right <= app.right + 1 && hoje.left >= app.left - 1,
      metricas: metricas.length,
      metricaLargura: metricas[0].getBoundingClientRect().width,
      metricaAltura: metricas[0].getBoundingClientRect().height,
      metricasDentro: ultimaMetrica.right <= app.right + 1 && ultimaMetrica.left >= app.left - 1,
      legendaRemovida: document.querySelectorAll('#screen-home .home-metric-note').length === 0,
      scrollVertical: document.documentElement.scrollHeight > window.innerHeight,
      rolouVertical: rolouVertical,
      recentCount: rcards.length,
      recentRolavel: recent.scrollWidth > recent.clientWidth,
      recentDentro: rrect.right <= app.right + 1 && rrect.left >= app.left - 1,
      recentClient: recent.clientWidth,
      cardLargura: rcards.length ? rcards[0].getBoundingClientRect().width : 0,
      proximoParcial: !!prox && prox.left < rrect.right && prox.right > rrect.right,
      peek: recortado,
      overflowX: getComputedStyle(recent).overflowX,
      touchAction: getComputedStyle(recent).touchAction
    };
  })()`, "home 320");
  check("Sprint 5.1 320px: faixa rolável e sem rolagem horizontal na página",
    homeWeekly320.doc <= 321 && homeWeekly320.app <= 320 && homeWeekly320.rolavel === true &&
      homeWeekly320.celula >= 44 && homeWeekly320.dentroDoApp === true,
    JSON.stringify(homeWeekly320));
  check("Sprint 5.1.2 320px: recentes em faixa rolável, com parte do próximo card, sem rolagem de página",
    homeWeekly320.doc <= 321 && homeWeekly320.recentCount === 3 && homeWeekly320.recentRolavel === true &&
      homeWeekly320.recentDentro === true && homeWeekly320.peek === true &&
      homeWeekly320.cardLargura >= 100 && homeWeekly320.cardLargura <= homeWeekly320.recentClient / 2 &&
      homeWeekly320.overflowX === 'auto' && homeWeekly320.touchAction !== 'none',
    JSON.stringify(homeWeekly320));
  check("Sprint 5.1.3 320px: faixa semanal e de recentes não quebram a rolagem vertical da Home",
    homeWeekly320.scrollVertical === true && homeWeekly320.rolouVertical === true &&
      homeWeekly320.doc <= 321,
    JSON.stringify({ scrollHeight: homeWeekly320.scrollVertical, rolou: homeWeekly320.rolouVertical, doc: homeWeekly320.doc }));
  check("Sprint 5.1.4 320px: dois cards de métrica lado a lado, dentro da largura e sem a legenda",
    homeWeekly320.metricas === 2 && homeWeekly320.metricasDentro === true &&
      homeWeekly320.metricaLargura >= 120 && homeWeekly320.metricaAltura >= 44 &&
      homeWeekly320.legendaRemovida === true && homeWeekly320.doc <= 321,
    JSON.stringify({ metricas: homeWeekly320.metricas, largura: homeWeekly320.metricaLargura,
      altura: homeWeekly320.metricaAltura, dentro: homeWeekly320.metricasDentro,
      legendaRemovida: homeWeekly320.legendaRemovida, doc: homeWeekly320.doc }));
  check("Sprint 5.1.1 320px: card de hoje cabe na largura (sem rolagem)",
    homeWeekly320.doc <= 321 && homeWeekly320.hojeDentro === true,
    JSON.stringify({ doc: homeWeekly320.doc, hoje: homeWeekly320.hojeDentro }));
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
  });
  await sleep(150);

  // --- Sprint 5.1.3 (M2): mesma faixa em 390 px (iPhone 12/13/14) ------------
  const home390 = await ev(`(function(){
    var app = document.getElementById('app').getBoundingClientRect();
    var recent = document.getElementById('home-recent-strip');
    var rrect = recent.getBoundingClientRect();
    var rcards = recent.querySelectorAll('.recent-card');
    var recortado = false;
    for (var i = 0; i < rcards.length; i++) {
      var cr = rcards[i].getBoundingClientRect();
      if (cr.left < rrect.right - 1 && cr.right > rrect.right + 1) recortado = true;
    }
    var hoje = document.getElementById('home-today-name').getBoundingClientRect();
    return {
      doc: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      app: app.width,
      celula: document.querySelectorAll('#home-weekly-strip .weekly-day')[0].getBoundingClientRect().width,
      recentCount: rcards.length,
      recentDentro: rrect.right <= app.right + 1 && rrect.left >= app.left - 1,
      recentClient: recent.clientWidth,
      cardLargura: rcards.length ? rcards[0].getBoundingClientRect().width : 0,
      cardAltura: rcards.length ? rcards[0].getBoundingClientRect().height : 0,
      peek: recortado,
      hojeDentro: hoje.right <= app.right + 1 && hoje.left >= app.left - 1,
      duasInteiras: rcards.length > 1 &&
        rcards[1].getBoundingClientRect().right <= rrect.right + 1
    };
  })()`, "home 390");
  check("Sprint 5.1.3 390px: faixa de recentes com card seguinte à mostra e sem rolagem de página",
    home390.doc <= 391 && home390.recentCount === 3 && home390.recentDentro === true &&
      home390.peek === true && home390.duasInteiras === true &&
      home390.cardLargura >= 100 && home390.cardLargura <= home390.recentClient / 2 &&
      home390.cardAltura >= 44 && home390.celula >= 44 && home390.hojeDentro === true,
    JSON.stringify(home390));

  // --- Sprint 5.1.3 (M3): nome longo não é cortado em 320 px -----------------
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 320, height: 720, deviceScaleFactor: 2, mobile: true, screenWidth: 320, screenHeight: 720,
  });
  await sleep(150);
  const nomeLongo = await ev(`(function(){
    function iso(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
    state.history = [
      { id:252, name:'TreinoSuperHiperMegaBlasterDeResistenciaComNomeEnormeSemEspacos',
        status:'completed', dateISO:iso(new Date()), durationMin:20,
        exercises:[{ name:'Ex', sets:[{ weight:10, reps:10 }] }] }
    ];
    navigate('home');
    var el = document.querySelector('#home-recent-strip .recent-card');
    var pior = 0;
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (c.scrollWidth > c.clientWidth + 1) pior = Math.max(pior, c.scrollWidth - c.clientWidth);
    }
    var nome = el.querySelector('.recent-card-name');
    return {
      count: document.querySelectorAll('#home-recent-strip .recent-card').length,
      roles: Array.prototype.map.call(document.querySelectorAll('#home-recent-strip .recent-card'),
        function(e){ return e.getAttribute('role'); }),
      largura: nome.getBoundingClientRect().width,
      alturaNome: nome.getBoundingClientRect().height,
      transbordo: pior,
      nomeInteiro: nome.innerText.trim().indexOf('SemEspacos') !== -1,
      doc: document.documentElement.scrollWidth
    };
  })()`, "nome longo 320");
  check("Sprint 5.1.3/M3: nome longo quebra dentro do card (sem corte/transbordo) e segue legível",
    nomeLongo.count === 1 && nomeLongo.transbordo === 0 && nomeLongo.alturaNome > 20 &&
    nomeLongo.nomeInteiro === true && nomeLongo.doc <= 321 &&
    nomeLongo.roles[0] === 'listitem',
    JSON.stringify(nomeLongo));
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
  });
  await sleep(150);

  // --- Sprint 5.1.2: faixa "Últimos treinos" (dados reais + rolagem) --------
  const homeCards = await ev(`(function(){
    function iso(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
    function rel(n){ var d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n); return iso(d); }

    var card = function(){
      var items = document.querySelectorAll('#home-recent-strip .recent-card');
      var empty = document.getElementById('home-recent-empty');
      return {
        todayLabel: document.querySelector('#screen-home [data-i18n="today_workout"]').innerText.trim(),
        today: document.getElementById('home-today-name').innerText.trim(),
        todayExercises: document.getElementById('home-today-exercises').innerText.trim(),
        todayDuration: document.getElementById('home-today-duration').innerText.trim(),
        count: items.length,
        names: Array.prototype.map.call(items, function(el){
          return el.querySelector('.recent-card-name').innerText.trim();
        }),
        metas: Array.prototype.map.call(items, function(el){
          return Array.prototype.map.call(el.querySelectorAll('.recent-card-meta'), function(m){ return m.innerText.trim(); });
        }),
        aria: Array.prototype.map.call(items, function(el){ return el.getAttribute('aria-label'); }),
        roles: Array.prototype.map.call(items, function(el){ return el.getAttribute('role'); }),
        overflowCard: (function(){
          var el = items[0];
          if (!el) return null;
          var pior = 0;
          for (var i = 0; i < el.children.length; i++) {
            var c = el.children[i];
            if (c.scrollWidth > c.clientWidth + 1) pior = Math.max(pior, c.scrollWidth - c.clientWidth);
          }
          return pior;
        })(),
        rolagem: getComputedStyle(document.getElementById('home-recent-strip')).overflowX,
        emptyVisible: getComputedStyle(empty).display !== 'none',
        emptyText: empty.innerText.trim(),
        historyBtn: document.querySelector('#screen-home button[data-i18n="see_full_history"]').innerText.trim(),
        recentLabel: document.getElementById('home-recent-strip').getAttribute('aria-label'),
        tabindex: document.getElementById('home-recent-strip').getAttribute('tabindex'),
        legendaCardio: document.querySelectorAll('#screen-home .home-metric-note').length,
        cardioTitulo: document.querySelector('#screen-home .home-metric-label').innerText.trim(),
        cardioValor: document.getElementById('home-cardio-value').innerText.trim()
      };
    };
    var set = function(hist){ state.history = hist; navigate('home'); return card(); };

    // 1) só legado (sem dateISO): faixa vazia + estado vazio localizado.
    var vazio = set([
      { id:1, name:'Treino legado', date:'Ontem, 18:30', duration:'50 min', status:'completed' },
      { id:2, name:'Outro legado', date:'Segunda, 07:00', status:'completed' }
    ]);
    var semMock = !/Treino A — Peito e Tríceps|Treino B — Costas e Bíceps|Ontem • 50 min|45 min/
      .test(document.getElementById('screen-home').innerText);

    // 2) um CONCLUÍDO hoje: um card com nome, rótulo relativo e exercícios.
    var hoje = rel(0);
    var um = set([
      { id:10, name:'Treino A — Peito', status:'completed', dateISO:hoje, letter:'A', durationMin:37,
        exercises:[{ name:'Supino', sets:[{ weight:60, reps:10 }] },
                   { name:'Crucifixo', sets:[{ weight:20, reps:12 }] }] }
    ]);

    // 3) parcial e legado NÃO entram; o concluído antigo entra com data absoluta.
    var misto = set([
      { id:11, name:'Treino P — Parcial', status:'partial', dateISO:rel(-1), durationMin:20,
        exercises:[{ name:'Rosca', sets:[{ weight:15, reps:12 }] }] },
      { id:12, name:'Treino A — Peito', status:'completed', dateISO:hoje, durationMin:37,
        exercises:[{ name:'Supino', sets:[{ weight:60, reps:10 }] }] },
      { id:13, name:'Legado sem data', date:'Terça, 07:00', status:'completed' },
      { id:14, name:'Treino E — Braços', status:'completed', dateISO:rel(-10), durationMin:25,
        exercises:[{ name:'Rosca', sets:[{ weight:15, reps:12 }] }] }
    ]);

    // 3b) B2: com o histórico do passo 3, o legado segue no Histórico completo.
    navigate('history');
    var histCards = document.querySelectorAll('#history-container .history-card');
    var historicoNomes = Array.prototype.map.call(histCards, function(el){
      return el.querySelector('h4').innerText.trim();
    });
    var historicoMisto = histCards.length;
    var historicoBruto = state.history.length;
    navigate('home');

    // 4) mais de sete concluídos: mostra exatamente 7, do mais novo ao mais antigo.
    var oito = set([0,1,2,3,4,5,6,7].map(function(i){
      return { id:100+i, name:'Treino ' + i, status:'completed', dateISO:rel(-i), durationMin:10+i,
        exercises:[{ name:'Ex', sets:[{ weight:10, reps:10 }] }] };
    }));

    // 4b) M3: registro sem nome -> neutro VISÍVEL e no rótulo acessível.
    var semNome = set([
      { id:250, name:'', status:'completed', dateISO:hoje, durationMin:20,
        exercises:[{ name:'Ex', sets:[{ weight:10, reps:10 }] }] }
    ]);

    // 4c) M3: duração ausente/zero não aparece como duração conhecida.
    var semDuracao = set([
      { id:251, name:'Treino Z — Zero', status:'completed', dateISO:hoje, durationMin:0,
        exercises:[{ name:'Ex', sets:[{ weight:10, reps:10 }] }] }
    ]);

    // 5) salvar um treino CONCLUÍDO atualiza a faixa sem depender de navegação.
    var antesDeSalvar = set([]);
    state.session = {
      id:'s_smoke_512', letter:'D', routineName:'Smoke 5.1.2',
      startedAt:new Date(Date.now() - 12*60000),
      exercises:[{ catalogId:'C-02', name:'Supino', completedSets:[{ weight:40, reps:10 }] }]
    };
    var salvo = saveSessionToHistory('completed');
    state.session = null;
    var depoisDeSalvar = card();
    var nomeSalvo = state.history[0].name;

    // 5b) sessão PARCIAL salva não vira card de concluído.
    state.session = {
      id:'s_smoke_512p', letter:'E', routineName:'Smoke Parcial',
      startedAt:new Date(Date.now() - 5*60000),
      exercises:[{ catalogId:'C-02', name:'Supino', completedSets:[{ weight:40, reps:10 }] }]
    };
    saveSessionToHistory('partial');
    state.session = null;
    var comParcial = card();

    // 6) ler a Home não grava, não duplica e não altera o histórico.
    var brutoAntes = localStorage.getItem('tt_ds_v1_history');
    var nAntes = state.history.length;
    renderHome(); renderHome(); renderHome();
    var nDepois = state.history.length;
    var brutoDepois = localStorage.getItem('tt_ds_v1_history');

    // 7) faixa com foco de teclado e rolagem real (3 concluídos = overflow).
    set([
      { id:300, name:'Treino A — Peito', status:'completed', dateISO:hoje, durationMin:30,
        exercises:[{ name:'Supino', sets:[{ weight:60, reps:10 }] }] },
      { id:301, name:'Treino B — Costas', status:'completed', dateISO:rel(-1), durationMin:40,
        exercises:[{ name:'Remada', sets:[{ weight:50, reps:10 }] }] },
      { id:302, name:'Treino C — Pernas', status:'completed', dateISO:rel(-2), durationMin:50,
        exercises:[{ name:'Agachamento', sets:[{ weight:80, reps:8 }] }] }
    ]);
    var stripEl = document.getElementById('home-recent-strip');
    stripEl.focus();
    var focado = document.activeElement === stripEl;
    var tinhaOverflow = stripEl.scrollWidth > stripEl.clientWidth;
    stripEl.scrollLeft = 140;
    var rolou = stripEl.scrollLeft > 0;
    stripEl.scrollLeft = 0;

    // 8) "Ver histórico completo" abre a tela de Histórico existente.
    document.querySelector('#screen-home button[data-i18n="see_full_history"]').click();
    var telaHistorico = state.currentScreen === 'history' &&
      document.getElementById('screen-history').classList.contains('active');
    var itensHistorico = document.querySelectorAll('#history-container .history-card').length;
    var telas = document.querySelectorAll('.screen').length;
    navigate('home');
    var voltou = state.currentScreen === 'home';

    // 9) idiomas: estado vazio, botão e rótulo relativo seguem o idioma ativo.
    var tres = [{ id:200, name:'Treino D — Ombros', status:'completed', dateISO:rel(-3), durationMin:15,
      exercises:[{ name:'Desenvolvimento', sets:[{ weight:30, reps:10 }] }] }];
    I18n.setLocale('en'); var en = set([]), enTres = set(tres);
    I18n.setLocale('es'); var es = set([]), esTres = set(tres);
    I18n.setLocale('pt'); var pt = set([]), ptTres = set(tres);

    state.history = [];
    navigate('home');

    return {
      vazio: vazio, um: um, misto: misto, oito: oito, semNome: semNome, semDuracao: semDuracao,
      historicoMisto: historicoMisto, historicoBruto: historicoBruto, historicoNomes: historicoNomes,
      antesDeSalvar: antesDeSalvar, depoisDeSalvar: depoisDeSalvar, nomeSalvo: nomeSalvo,
      comParcial: comParcial, salvoOk: !!(salvo && salvo.ok), semMock: semMock,
      semDuplicar: nAntes === nDepois && brutoAntes === brutoDepois,
      focado: focado, tinhaOverflow: tinhaOverflow, rolou: rolou,
      telaHistorico: telaHistorico, itensHistorico: itensHistorico,
      telas: telas, voltou: voltou,
      en: en, es: es, pt: pt, enTres: enTres, esTres: esTres, ptTres: ptTres
    };
  })()`, "faixa de recentes 5.1.2");

  check("Sprint 5.1.2: sem concluído datado a faixa fica vazia e mostra estado vazio localizado",
    homeCards.vazio.count === 0 && homeCards.vazio.emptyVisible === true &&
    homeCards.vazio.emptyText === 'Nenhum treino concluído ainda' &&
    homeCards.vazio.historyBtn === 'Ver histórico completo' &&
    homeCards.vazio.recentLabel === 'Últimos treinos concluídos' &&
    homeCards.vazio.tabindex === '0' && homeCards.vazio.rolagem === 'auto',
    JSON.stringify(homeCards.vazio));
  check("Sprint 5.1.2: nenhum valor fictício remanescente na Home",
    homeCards.semMock === true && homeCards.pt.today === 'Sem treino hoje');
  check("Sprint 5.1.2: um concluído hoje -> um card com nome, rótulo e contagem de exercícios",
    homeCards.um.count === 1 && homeCards.um.names[0] === 'Treino A — Peito' &&
    homeCards.um.metas[0][0] === 'Hoje • 37 min' && homeCards.um.metas[0][1] === '2 exercícios' &&
    homeCards.um.aria[0].indexOf('Treino A — Peito') === 0 &&
    homeCards.um.roles[0] === 'listitem' && homeCards.um.overflowCard === 0,
    JSON.stringify(homeCards.um));
  check("Sprint 5.1.2: parcial e legado não entram na faixa; concluído antigo usa dd/mm",
    homeCards.misto.count === 2 && homeCards.misto.names[0] === 'Treino A — Peito' &&
    homeCards.misto.names[1] === 'Treino E — Braços' &&
    /^\d{2}\/\d{2} • 25 min$/.test(homeCards.misto.metas[1][0]) &&
    homeCards.misto.metas[1][1] === '1 exercício',
    JSON.stringify({ count: homeCards.misto.count, names: homeCards.misto.names, metas: homeCards.misto.metas }));
  check("Sprint 5.1.3/B2: o legado segue no Histórico completo (1 card por registro) mesmo fora da faixa",
    homeCards.misto.count === 2 && homeCards.historicoBruto === 4 &&
    homeCards.historicoMisto === homeCards.historicoBruto &&
    homeCards.historicoNomes.indexOf('Legado sem data') !== -1 &&
    homeCards.historicoNomes.indexOf('Treino P — Parcial') !== -1 &&
    homeCards.historicoNomes.indexOf('Treino A — Peito') !== -1 &&
    homeCards.historicoNomes.indexOf('Treino E — Braços') !== -1,
    JSON.stringify({ faixa: homeCards.misto.count, bruto: homeCards.historicoBruto,
      historico: homeCards.historicoMisto, nomes: homeCards.historicoNomes }));
  check("Sprint 5.1.3/M3: registro sem nome mostra o neutro TAMBÉM no rótulo acessível",
    homeCards.semNome.count === 1 && homeCards.semNome.names[0] === 'Sem treino' &&
    homeCards.semNome.aria[0].indexOf('Sem treino') === 0,
    JSON.stringify({ nome: homeCards.semNome.names, aria: homeCards.semNome.aria }));
  check("Sprint 5.1.3/M3: rótulo acessível sem separador visual ('•') e coerente com o card",
    homeCards.um.aria[0].indexOf('•') === -1 &&
    homeCards.um.aria[0] === 'Treino A — Peito, Hoje, 37 min, 2 exercícios',
    JSON.stringify({ aria: homeCards.um.aria[0] }));
  check("Sprint 5.1.3/M3: duração zero/ausente não é exibida como duração conhecida",
    homeCards.semDuracao.count === 1 && homeCards.semDuracao.metas[0].length === 2 &&
    homeCards.semDuracao.metas[0][0] === 'Hoje' &&
    homeCards.semDuracao.aria[0].indexOf('min') === -1,
    JSON.stringify({ metas: homeCards.semDuracao.metas, aria: homeCards.semDuracao.aria }));
  check("Sprint 5.1.2: com mais de sete concluídos mostra exatamente 7, do mais novo ao mais antigo",
    homeCards.oito.count === 7 &&
    homeCards.oito.names.join(',') === 'Treino 0,Treino 1,Treino 2,Treino 3,Treino 4,Treino 5,Treino 6',
    JSON.stringify({ count: homeCards.oito.count, names: homeCards.oito.names }));
  check("Sprint 5.1.2: salvar treino concluído atualiza a faixa sem navegar",
    homeCards.antesDeSalvar.count === 0 && homeCards.salvoOk === true &&
    homeCards.depoisDeSalvar.count === 1 &&
    homeCards.depoisDeSalvar.names[0] === homeCards.nomeSalvo &&
    homeCards.depoisDeSalvar.metas[0][0].indexOf('Hoje') === 0,
    JSON.stringify({ nome: homeCards.nomeSalvo, depois: homeCards.depoisDeSalvar }));
  check("Sprint 5.1.2: sessão PARCIAL salva não entra na faixa como concluída",
    homeCards.comParcial.count === 1 && homeCards.comParcial.names[0] === 'Treino D — Smoke 5.1.2',
    JSON.stringify({ count: homeCards.comParcial.count, names: homeCards.comParcial.names }));
  check("Sprint 5.1.2: redesenhar a Home não grava, não duplica nem altera o histórico",
    homeCards.semDuplicar === true);
  check("Sprint 5.1.2: faixa focável e rolável de forma real (deslize/mouse/trackpad)",
    homeCards.focado === true && homeCards.tinhaOverflow === true && homeCards.rolou === true,
    JSON.stringify({ focado: homeCards.focado, overflow: homeCards.tinhaOverflow, rolou: homeCards.rolou }));
  check("Sprint 5.1.2: 'Ver histórico completo' abre a tela de Histórico existente e volta para a Home",
    homeCards.telaHistorico === true && homeCards.itensHistorico > 0 &&
    homeCards.telas === 9 && homeCards.voltou === true,
    JSON.stringify({ tela: homeCards.telaHistorico, itens: homeCards.itensHistorico, telas: homeCards.telas, voltou: homeCards.voltou }));
  check("Sprint 5.1.2: estado vazio, botão e rótulo relativo traduzidos em EN e ES",
    homeCards.en.emptyText === 'No completed workouts yet' &&
    homeCards.en.historyBtn === 'See full history' &&
    homeCards.en.recentLabel === 'Recent completed workouts' &&
    homeCards.es.emptyText === 'Aún no hay entrenos completados' &&
    homeCards.es.historyBtn === 'Ver historial completo' &&
    homeCards.es.recentLabel === 'Entrenos completados recientes',
    JSON.stringify({ en: homeCards.en, es: homeCards.es }));
  check("Sprint 5.1.4: legenda do cardio ausente nos 3 idiomas (título e valor preservados)",
    [homeCards.pt, homeCards.en, homeCards.es].every((l) => l.legendaCardio === 0) &&
    homeCards.pt.cardioTitulo === 'Cardio da semana' &&
    homeCards.en.cardioTitulo === 'Weekly cardio' &&
    homeCards.es.cardioTitulo === 'Cardio semanal' &&
    [homeCards.pt, homeCards.en, homeCards.es].every((l) => /^0 \/ 150 min$/.test(l.cardioValor)),
    JSON.stringify({ pt: { titulo: homeCards.pt.cardioTitulo, valor: homeCards.pt.cardioValor, legenda: homeCards.pt.legendaCardio },
      en: { titulo: homeCards.en.cardioTitulo, valor: homeCards.en.cardioValor, legenda: homeCards.en.legendaCardio },
      es: { titulo: homeCards.es.cardioTitulo, valor: homeCards.es.cardioValor, legenda: homeCards.es.legendaCardio } }));
  check("Sprint 5.1.2: rótulo de 3 dias traduzido nos 3 idiomas (chave com número)",
    homeCards.ptTres.metas[0][0].indexOf('Há 3 dias') === 0 &&
    homeCards.enTres.metas[0][0].indexOf('3 days ago') === 0 &&
    homeCards.esTres.metas[0][0].indexOf('Hace 3 días') === 0,
    JSON.stringify({ pt: homeCards.ptTres.metas[0], en: homeCards.enTres.metas[0], es: homeCards.esTres.metas[0] }));
  check("Sprint 5.1.1: card de hoje preservado (rótulo i18n e nome real do registro)",
    homeCards.pt.todayLabel === 'Treino de hoje' && homeCards.um.today === 'Treino A — Peito' &&
    homeCards.um.todayExercises === '2' && homeCards.um.todayDuration === '37 min' &&
    homeCards.en.todayLabel === "Today's workout" && homeCards.es.todayLabel === 'Entreno de hoy',
    JSON.stringify({ pt: homeCards.pt.todayLabel, en: homeCards.en.todayLabel, es: homeCards.es.todayLabel }));

  // --- Sprint 5.1.2 (teclado real): Tab alcança a faixa e as setas rolam -----
  await ev(`(function(){
    function iso(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
    function rel(n){ var d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n); return iso(d); }
    state.history = [
      { id:401, name:'Treino A — Peito', status:'completed', dateISO:rel(0), durationMin:30 },
      { id:402, name:'Treino B — Costas', status:'completed', dateISO:rel(-1), durationMin:40 },
      { id:403, name:'Treino C — Pernas', status:'completed', dateISO:rel(-2), durationMin:50 }
    ];
    navigate('home');
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
  })()`);

  const key = async (name, code, vk) => {
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(80);
  };

  let teclado = { alcancou: false, focoVisivel: false, outline: null, rolou: false, visitados: [] };
  for (let i = 0; i < 8 && !teclado.alcancou; i++) {
    await key("Tab", "Tab", 9);
    const passo = await ev(`(function(){
      var el = document.activeElement;
      var strip = document.getElementById('home-recent-strip');
      if (el !== strip) {
        return { atingiu: false, onde: el ? (el.id || el.className || el.tagName) : 'nenhum' };
      }
      var cs = getComputedStyle(strip);
      return { atingiu: true, focoVisivel: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
               outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor };
    })()`);
    teclado.visitados.push(passo.atingiu ? 'faixa' : passo.onde);
    if (passo.atingiu) {
      teclado.alcancou = true;
      teclado.focoVisivel = passo.focoVisivel;
      teclado.outline = passo.outline;
    }
  }
  // Setas para a direita rolam a faixa (comportamento nativo do contêiner focado).
  if (teclado.alcancou) {
    for (let i = 0; i < 4; i++) await key("ArrowRight", "ArrowRight", 39);
    teclado.rolou = await ev(`document.getElementById('home-recent-strip').scrollLeft > 0`);
    await ev(`document.getElementById('home-recent-strip').scrollLeft = 0`);
  }
  check("Sprint 5.1.2: Tab alcança a faixa com indicação visual de foco e as setas rolam o conteúdo",
    teclado.alcancou === true && teclado.focoVisivel === true && teclado.rolou === true,
    JSON.stringify(teclado));

  // --- Sprint 5.1.3 (M2): nenhuma armadilha de foco na faixa ---------------
  let semArmadilha = null;
  if (teclado.alcancou) {
    await key("Tab", "Tab", 9);
    semArmadilha = await ev(`(function(){
      var el = document.activeElement;
      return {
        id: el ? (el.id || '') : '',
        i18n: el ? (el.getAttribute('data-i18n') || '') : '',
        dentroDaFaixa: !!(el && el.closest && el.closest('#home-recent-strip')),
        cardsFocaveis: document.querySelectorAll('#home-recent-strip [tabindex]').length
      };
    })()`);
  }
  check("Sprint 5.1.3/M2: a faixa é um único ponto de parada do Tab (sem armadilha de foco)",
    !!semArmadilha && semArmadilha.i18n === 'see_full_history' &&
    semArmadilha.dentroDaFaixa === false && semArmadilha.cardsFocaveis === 0,
    JSON.stringify(semArmadilha));

  // --- Sprint 5.1.1 (Prioridade B): o cardio sobrevive à recarga -------------
  const cardioSeed = await ev(`(function(){
    function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    var hoje = iso(new Date());
    state.history = [
      { id:901, name:'Treino A — Peito', status:'completed', dateISO:hoje, durationMin:50,
        exercises:[{ name:'Supino', sets:[{ weight:60, reps:10 }] }] }
    ];
    // Sessão de cardio MARCADA -> entrada pelo caminho real de criação.
    state.session = {
      id:'s_smoke_cardio', letter:'E', routineName:'Esteira', category:'cardio',
      startedAt:new Date(Date.now() - 25*60000),
      exercises:[{ catalogId:'C-02', name:'Esteira', completedSets:[{ weight:0, reps:1 }] }]
    };
    var salvo = saveSessionToHistory('completed');
    state.session = null;
    Persistence.saveHistory(state.history);
    var bruto = localStorage.getItem('tt_ds_v1_history') || '';
    return {
      salvoOk: !!(salvo && salvo.ok),
      entradaCardio: !!(salvo && salvo.entry && salvo.entry.category === 'cardio'),
      gravadoComoCardio: bruto.indexOf('"category":"cardio"') !== -1,
      cardioAntes: document.getElementById('home-cardio-value').innerText.trim(),
      n: state.history.length
    };
  })()`, "cardio antes da recarga");
  check("Sprint 5.1.1/B: cardio marcado entra no histórico já classificado e é gravado assim",
    cardioSeed.salvoOk === true && cardioSeed.entradaCardio === true &&
    cardioSeed.gravadoComoCardio === true && cardioSeed.n === 2 &&
    cardioSeed.cardioAntes === '25 / 150 min',
    JSON.stringify(cardioSeed));

  await loadPage();

  const cardioAfter = await ev(`(function(){
    var cardio = state.history.filter(function(e){ return e.sessionId === 's_smoke_cardio'; })[0] || null;
    return {
      n: state.history.length,
      categoria: cardio ? cardio.category : null,
      temTipo: !!cardio && Object.prototype.hasOwnProperty.call(cardio, 'type'),
      duracao: cardio ? cardio.durationMin : null,
      cardio: document.getElementById('home-cardio-value').innerText.trim(),
      semanal: HomeInsights.build(state.history, new Date()).cardioMinutes,
      faixa: document.querySelectorAll('#home-weekly-strip .weekly-day').length,
      recentCount: document.querySelectorAll('#home-recent-strip .recent-card').length,
      recentes: Array.prototype.map.call(document.querySelectorAll('#home-recent-strip .recent-card-name'), function(el){
        return el.innerText.trim();
      })
    };
  })()`, "cardio depois da recarga");
  check("Sprint 5.1.1/B: após recarregar, o cardio continua cardio e segue contando na semana",
    cardioAfter.n === 2 && cardioAfter.categoria === 'cardio' && cardioAfter.temTipo === false &&
    cardioAfter.duracao === 25 && cardioAfter.semanal === 25 &&
    cardioAfter.cardio === '25 / 150 min' && cardioAfter.faixa === 7,
    JSON.stringify(cardioAfter));
  check("Sprint 5.1.2/B: após recarregar, a faixa reflete o histórico persistido (2 concluídos)",
    cardioAfter.recentCount === 2 && cardioAfter.recentes.length === 2 &&
    cardioAfter.recentes.join('|').indexOf('Treino A — Peito') !== -1,
    JSON.stringify({ count: cardioAfter.recentCount, nomes: cardioAfter.recentes }));

  // --- Bug: exercícios não persistem ao salvar o treino ---------------------
  // Os blocos acima criavam rotinas escrevendo DIRETO em `state.tempEditRoutine`,
  // por isso o defeito nunca aparecia: ao voltar do catálogo, `navigate('edit')`
  // recopiava o buffer do estado (`startEditRoutine`) e descartava em silêncio o
  // exercício recém-adicionado — o "Salvar" gravava `exercises: []`.
  // Aqui o fluxo é o do USUÁRIO (cliques nos botões reais) e o localStorage é a
  // fonte da verdade. Fica no fim do arquivo de propósito: cria rotinas e não
  // interfere nas contagens dos blocos anteriores.
  // Helpers de interação (cliques nos botões reais). São reinstalados depois de
  // cada recarga: `loadPage()` troca o documento e leva o `window` junto.
  const installRoutineHelpers = () => ev(`(function(){
    window.__click = function(sel){
      var el = document.querySelector(sel);
      if (!el) return { ok:false, sel:sel };
      el.click();
      return { ok:true, text:(el.innerText || '').trim().slice(0,30) };
    };
    window.__addFromCatalog = function(i){
      __click('#screen-edit button[onclick*="add-exercise"]');
      var itens = document.querySelectorAll('#catalog-container .catalog-item');
      var item = itens[i];
      var btn = item ? item.querySelector('.btn-add-circle') : null;
      if (!btn) return { ok:false, i:i, itens:itens.length };
      btn.scrollIntoView({ block:'center' });
      var r = btn.getBoundingClientRect();
      var hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      btn.click();
      return {
        ok:true,
        clicavel: !!hit && (hit === btn || btn.contains(hit)),
        tela: state.currentScreen,
        buffer: state.tempEditRoutine.exercises.length,
        desenhados: document.querySelectorAll('#edit-exercises-container .exercise-list-item').length
      };
    };
    return true;
  })()`, "helpers do fluxo de rotina");

  await installRoutineHelpers();

  const routineBase = await ev(`(function(){
    navigate('workouts');
    return {
      rotinasAntes: state.routines.length,
      storageAntes: (JSON.parse(localStorage.getItem('tt_ds_v1_routines') || 'null') || []).length
    };
  })()`, "base do fluxo de rotina");

  const routineCreated = await ev(`(function(){
    __click('#screen-workouts .header-nav .btn-primary');   // botão "+": criar treino
    var criado = {
      tela: state.currentScreen,
      rotinas: state.routines.length,
      buffer: state.tempEditRoutine ? state.tempEditRoutine.exercises.length : -1,
      id: state.editingRoutineId,
      linha: (document.getElementById('edit-exercises-container').innerText || '').trim()
    };
    var a = __addFromCatalog(0);
    var b = __addFromCatalog(1);
    var c = __addFromCatalog(2);
    var ids = state.tempEditRoutine.exercises.map(function(e){ return e.catalogId; });
    var linhas = Array.prototype.map.call(
      document.querySelectorAll('#edit-exercises-container .exercise-list-item .info p'),
      function(el){ return el.innerText.trim(); });
    return { criado:criado, a:a, b:b, c:c, ids:ids, unicos:new Set(ids).size, linhas:linhas };
  })()`, "criar treino e adicionar exercícios pelo catálogo");

  check("Bug 5.2: o '+' do catálogo realmente acrescenta o exercício na edição (cliques reais)",
    routineCreated.criado.tela === 'edit' &&
    routineCreated.criado.rotinas === routineBase.rotinasAntes + 1 &&
    routineCreated.criado.buffer === 0 && routineCreated.criado.linha === 'Nenhum exercício adicionado.',
    JSON.stringify(routineCreated.criado));
  check("Bug 5.2: três exercícios adicionados -> três no buffer, três desenhados, sem duplicar id",
    routineCreated.a.ok && routineCreated.a.clicavel === true && routineCreated.a.tela === 'edit' &&
    routineCreated.a.buffer === 1 && routineCreated.a.desenhados === 1 &&
    routineCreated.b.buffer === 2 && routineCreated.b.desenhados === 2 &&
    routineCreated.c.buffer === 3 && routineCreated.c.desenhados === 3 &&
    routineCreated.unicos === 3 && routineCreated.linhas.length === 3,
    JSON.stringify({ a: routineCreated.a, b: routineCreated.b, c: routineCreated.c,
      ids: routineCreated.ids, unicos: routineCreated.unicos }));

  const routineConfigured = await ev(`(function(){
    var info = document.querySelector('#edit-exercises-container .exercise-list-item .info');
    info.click();                                            // abre "Configurar exercício"
    var telaConfig = state.currentScreen;
    __click('#screen-config-exercise .config-group:nth-child(1) .config-controls button:last-child');
    __click('#screen-config-exercise .config-group:nth-child(1) .config-controls button:last-child');
    __click('#screen-config-exercise .config-group:nth-child(2) .config-controls button:last-child');
    __click('#screen-config-exercise .config-group:nth-child(3) .config-controls button:last-child');
    __click('#screen-config-exercise .config-group:nth-child(4) .config-controls button:last-child');
    var noConfig = JSON.parse(JSON.stringify(state.tempEditRoutine.exercises[0]));
    __click('#screen-config-exercise .btn-primary');         // "Salvar configuração"
    var linha = (document.querySelector('#edit-exercises-container .exercise-list-item .info p') || {}).innerText || '';
    var naVolta = JSON.parse(JSON.stringify(state.tempEditRoutine.exercises[0]));
    return { telaConfig:telaConfig, tela:state.currentScreen, noConfig:noConfig, naVolta:naVolta, linha:linha.trim() };
  })()`, "configurar o primeiro exercício");

  check("Bug 5.2: ajustes de séries/reps/carga/descanso sobrevivem à volta de 'Configurar exercício'",
    routineConfigured.telaConfig === 'config-exercise' && routineConfigured.tela === 'edit' &&
    routineConfigured.noConfig.sets === 5 && routineConfigured.noConfig.reps === 11 &&
    routineConfigured.noConfig.weight === 25 && routineConfigured.noConfig.rest === 75 &&
    JSON.stringify(routineConfigured.naVolta) === JSON.stringify(routineConfigured.noConfig) &&
    routineConfigured.linha === '5 séries • 11 reps • 25 kg',
    JSON.stringify(routineConfigured));

  const routineSaved = await ev(`(function(){
    __click('#screen-edit .header-nav .btn-primary');        // "Salvar"
    var st = JSON.parse(localStorage.getItem('tt_ds_v1_routines') || 'null') || [];
    var gravado = st[st.length - 1];
    var naMemoria = state.routines[state.routines.length - 1];
    return {
      tela: state.currentScreen,
      id: state.editingRoutineId,
      itensDetalhes: document.querySelectorAll('#details-exercises-container .exercise-list-item').length,
      textoDetalhes: (document.getElementById('details-exercises-container').innerText || '').trim().slice(0,60),
      gravado: gravado,
      memoria: naMemoria.exercises,
      consistente: JSON.stringify(naMemoria.exercises) === JSON.stringify(gravado.exercises),
      totalStorage: st.length
    };
  })()`, "salvar o treino");

  check("Bug 5.2: 'Salvar' grava os 3 exercícios (com séries/reps/carga/descanso) no storage",
    routineSaved.tela === 'details' && routineSaved.itensDetalhes === 3 &&
    routineSaved.gravado.exercises.length === 3 && routineSaved.consistente === true &&
    routineSaved.gravado.exercises[0].catalogId.length > 0 &&
    routineSaved.gravado.exercises[0].sets === 5 && routineSaved.gravado.exercises[0].reps === 11 &&
    routineSaved.gravado.exercises[0].weight === 25 && routineSaved.gravado.exercises[0].rest === 75 &&
    routineSaved.gravado.exercises.slice(1).every((e) => e.sets === 3 && e.reps === 10 && e.weight === 20 && e.rest === 60),
    JSON.stringify(routineSaved.gravado.exercises));

  await loadPage();
  await installRoutineHelpers();

  const routineReloaded = await ev(`(function(){
    var novo = state.routines[state.routines.length - 1];
    var st = JSON.parse(localStorage.getItem('tt_ds_v1_routines') || 'null') || [];
    var ids = novo.exercises.map(function(e){ return e.catalogId; });
    navigate('details', novo.id);
    var itensDetalhes = document.querySelectorAll('#details-exercises-container .exercise-list-item').length;
    navigate('workouts');
    var contadores = Array.prototype.map.call(
      document.querySelectorAll('#routines-container .routine-card .routine-info p'),
      function(el){ return el.innerText.trim(); });
    return {
      n: novo.exercises.length,
      unicos: new Set(ids).size,
      exercicios: novo.exercises,
      gravados: st[st.length - 1].exercises.length,
      totalStorage: st.length,
      itensDetalhes: itensDetalhes,
      contadorUltima: contadores[contadores.length - 1]
    };
  })()`, "recarregar e conferir o treino salvo");

  check("Bug 5.2: depois de RECARREGAR, os 3 exercícios continuam salvos (sem duplicar)",
    routineReloaded.n === 3 && routineReloaded.unicos === 3 && routineReloaded.gravados === 3 &&
    routineReloaded.itensDetalhes === 3 && routineReloaded.contadorUltima === '3 exercícios' &&
    routineReloaded.exercicios[0].sets === 5 && routineReloaded.exercicios[0].rest === 75,
    JSON.stringify({ n: routineReloaded.n, unicos: routineReloaded.unicos,
      gravados: routineReloaded.gravados, itens: routineReloaded.itensDetalhes,
      contador: routineReloaded.contadorUltima }));

  const routineSecond = await ev(`(function(){
    navigate('workouts');
    __click('#screen-workouts .header-nav .btn-primary');    // segunda rotina
    __addFromCatalog(3);
    __click('#screen-edit .header-nav .btn-primary');        // "Salvar"
    var st = JSON.parse(localStorage.getItem('tt_ds_v1_routines') || 'null') || [];
    return {
      tela: state.currentScreen,
      total: st.length,
      primeiraDoFluxo: st[st.length - 2].exercises.length,
      segunda: st[st.length - 1].exercises.length
    };
  })()`, "segunda rotina");

  check("Bug 5.2: salvar uma segunda rotina não sobrescreve a primeira nem duplica o total",
    routineSecond.tela === 'details' && routineSecond.total === routineReloaded.totalStorage + 1 &&
    routineSecond.primeiraDoFluxo === 3 && routineSecond.segunda === 1,
    JSON.stringify(routineSecond));

  const routineLegacySeed = await ev(`(function(){
    var st = JSON.parse(localStorage.getItem('tt_ds_v1_routines') || 'null') || [];
    // Registro LEGADO: sem o campo exercises (formato anterior ao enriquecido).
    st.push({ id:'rSmokeLegado', letter:'Y', name:'Legado sem lista de exercícios' });
    localStorage.setItem('tt_ds_v1_routines', JSON.stringify(st));
    return { gravados: st.length };
  })()`, "semear rotina legada");

  await loadPage();
  await installRoutineHelpers();

  const routineLegacyRead = await ev(`(function(){
    var r = state.routines.filter(function(x){ return x.id === 'rSmokeLegado'; })[0] || null;
    navigate('workouts');
    var cartoes = document.querySelectorAll('#routines-container .routine-card').length;
    var semLista = (document.getElementById('routines-container').innerText || '').indexOf('Legado sem lista de exercícios') !== -1;
    navigate('history');
    var historico = document.querySelectorAll('#screen-history .history-card').length;
    navigate('details', 'rSmokeLegado');
    var vazio = (document.getElementById('details-exercises-container').innerText || '').trim();
    return {
      achou: !!r,
      exercicios: r ? r.exercises : null,
      cartoes: cartoes,
      semLista: semLista,
      historico: historico,
      detalhesVazios: vazio,
      total: state.routines.length
    };
  })()`, "rotina legada hidratada");

  check("Bug 5.2: registro legado sem exercícios hidrata como lista vazia e não quebra o Histórico",
    routineLegacyRead.achou === true && Array.isArray(routineLegacyRead.exercicios) &&
    routineLegacyRead.exercicios.length === 0 &&
    routineLegacyRead.total === routineLegacySeed.gravados &&
    routineLegacyRead.cartoes === routineLegacySeed.gravados && routineLegacyRead.semLista === true &&
    routineLegacyRead.historico >= 2 && routineLegacyRead.detalhesVazios.length > 0,
    JSON.stringify({ achou: routineLegacyRead.achou, exercicios: routineLegacyRead.exercicios,
      cartoes: routineLegacyRead.cartoes, historico: routineLegacyRead.historico,
      total: routineLegacyRead.total }));

  const routineFailure = await ev(`(function(){
    navigate('workouts');
    __click('#screen-workouts .header-nav .btn-primary');    // rotina só para o teste de falha
    __addFromCatalog(0);
    var idAlvo = state.editingRoutineId;
    var antes = localStorage.getItem('tt_ds_v1_routines');
    var buffer = JSON.parse(JSON.stringify(state.tempEditRoutine.exercises));
    // Storage passa a FALHAR (a persistência segue habilitada: "modo memória" é
    // outro contrato e continua sendo sucesso).
    var original = Persistence.saveRoutines;
    Persistence.saveRoutines = function(){ return false; };
    __click('#screen-edit .header-nav .btn-primary');        // "Salvar"
    var depois = localStorage.getItem('tt_ds_v1_routines');
    var toast = document.getElementById('app-toast');
    var alvo = state.routines.filter(function(x){ return x.id === idAlvo; })[0] || {};
    var estado = {
      persistenciaHabilitada: Persistence.isEnabled(),
      tela: state.currentScreen,
      toast: (toast.innerText || '').trim(),
      toastErro: toast.className.indexOf('error') !== -1,
      toastVisivel: toast.className.indexOf('show') !== -1,
      storageIntacto: depois === antes,
      alvoNaMemoria: alvo.exercises || [],
      bufferIntacto: JSON.stringify(state.tempEditRoutine.exercises) === JSON.stringify(buffer)
    };
    Persistence.saveRoutines = original;
    return estado;
  })()`, "falha de gravação ao salvar");

  check("Bug 5.2: falha de gravação não é apresentada como sucesso (avisa, não grava, não perde o buffer)",
    routineFailure.persistenciaHabilitada === true && routineFailure.tela === 'edit' &&
    routineFailure.storageIntacto === true && routineFailure.toastVisivel === true &&
    routineFailure.toastErro === true && routineFailure.toast.indexOf('salvar') !== -1 &&
    routineFailure.alvoNaMemoria.length === 0 && routineFailure.bufferIntacto === true,
    JSON.stringify(routineFailure));

  const playerFromRoutine = await ev(`(function(){
    var id = ${JSON.stringify(routineCreated.criado.id)};
    navigate('details', id);
    __click('#screen-details .btn-primary');                 // INICIAR ESTE TREINO
    var telaPrep = state.currentScreen;
    var naPrep = document.getElementById('prep-total-exercises').innerText.trim();
    var seriesNaPrep = document.getElementById('prep-total-sets').innerText.trim();
    __click('#screen-prep .btn-primary');                    // COMECAR TREINO
    var s = state.session;
    var out = {
      telaPrep: telaPrep, naPrep: naPrep, seriesNaPrep: seriesNaPrep,
      tela: state.currentScreen,
      sessao: s ? s.exercises.length : -1,
      primeiraSerie: s ? s.exercises[0].sets : -1,
      primeiroId: s ? s.exercises[0].catalogId : null,
      status: s ? s.status : null,
      persistida: !!localStorage.getItem('tt_ds_v1_session')
    };
    state.session = null;
    if (Persistence.clearSession) Persistence.clearSession();
    navigate('home');
    return out;
  })()`, "player a partir da rotina criada pelo fluxo");

  check("Bug 5.2: o treino salvo pelo fluxo abre no Player com os mesmos exercícios (nada regrediu)",
    playerFromRoutine.telaPrep === 'prep' && playerFromRoutine.naPrep === '3' &&
    playerFromRoutine.seriesNaPrep === '11' && playerFromRoutine.tela === 'player' &&
    playerFromRoutine.sessao === 3 && playerFromRoutine.primeiraSerie === 5 &&
    playerFromRoutine.primeiroId === routineSaved.gravado.exercises[0].catalogId &&
    playerFromRoutine.status === 'active' && playerFromRoutine.persistida === true,
    JSON.stringify(playerFromRoutine));

  // --- Erros de JS ----------------------------------------------------------
  const realErrors = jsErrors.filter((e) => !/unsplash|net::ERR|Failed to load resource|ERR_BLOCKED/i.test(e));
  check("nenhum erro de JS no console", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  // -------------------------------------------------------------------------
  cdp.close();
  chrome.kill();
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " checagens OK");
  if (failed.length) {
    console.log("FALHAS: " + failed.map((f) => f.name).join(" | "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("ERRO FATAL:", err.message);
  process.exit(1);
});
