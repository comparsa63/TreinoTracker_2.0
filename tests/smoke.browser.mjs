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
        lastWorkout: document.querySelector('#screen-home h4[data-i18n="last_workout"]').innerText,
        status: document.querySelector('#screen-home .history-status').innerText,
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
    wiring.home.lastWorkout === "Último Treino" &&
    wiring.home.status === "Concluído" &&
    wiring.home.langChip === "PT" && wiring.home.docLang === "pt-BR",
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
      status: document.querySelector('#screen-home .history-status').innerText,
      chip: document.getElementById('lang-text').innerText,
      docLang: document.documentElement.lang,
      persisted: JSON.parse(localStorage.getItem('tt_ds_v1_lang')||'null')
    };
  })()`);

  check("clique no botão PT/EN troca a Home para EN",
    afterToggle.greeting === "Hello, Athlete" &&
    afterToggle.btn === "START WORKOUT" &&
    afterToggle.status === "Completed" &&
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
