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
  const finished = await ev(`(function(){
    var before = state.history.length;
    var prsBefore = PR.getAll().length;
    var id = state.session.id;
    var guard = 0;
    while (state.session && state.session.status !== 'finished' && guard++ < 20) completeSet();
    var isFinished = !!state.session && state.session.status === 'finished';
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
