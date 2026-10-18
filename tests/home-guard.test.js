#!/usr/bin/env node
/**
 * tests/home-guard.test.js
 * ---------------------------------------------------------------------------
 * GUARDA DA HOME (golden master test).
 *
 * A tela HOME do TreinoTracker_DeepSeek está BLINDADA. Este teste falha se
 * qualquer byte do bloco da Home, das 3 regras CSS exclusivas dela, dos
 * seletores/variaveis compartilhados que ela consome ou das chaves de i18n
 * que ela exibe mudar.
 *
 * Uso:
 *   node tests/home-guard.test.js            -> valida contra o golden master
 *   node tests/home-guard.test.js --update   -> regenera o golden master
 *
 * (--update só deve ser usado com autorizacao explicita: ele "abenca" a
 *  mudanca da Home, o que a regra de ouro proibe.)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const HTML_PATH = path.join(ROOT, "TreinoTracker_DeepSeek.html");
const I18N_PATH = path.join(ROOT, "js", "i18n.js");
const GOLDEN_PATH = path.join(__dirname, "home-golden.json");

const UPDATE = process.argv.includes("--update");

/** Regras CSS exclusivas da Home (blindadas). */
const FROZEN_CSS = [
  ".logo",
  ".logo span",
  ".card-highlight",
  ".card-highlight::before",
  ".last-workout",
];

/** Seletores compartilhados dos quais a Home depende (devem continuar existindo). */
const SHARED_SELECTORS = [
  ".screen",
  ".screen.active",
  ".btn",
  ".btn-primary",
  ".btn-sm",
  ".text-muted",
  ".history-status",
];

/** Variaveis CSS que a Home usa. */
const REQUIRED_VARS = [
  "--primary",
  "--card-bg",
  "--border-radius",
  "--border-radius-sm",
  "--text-main",
  "--text-muted",
  "--bg-color",
  "--font-family",
  "--nav-height",
];

const LOCALES = ["pt", "en", "es"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extrai o bloco `<section id="screen-home">...</section>` (byte-exato). */
function extractHomeSection(html) {
  const m = /<section id="screen-home"[\s\S]*?<\/section>/.exec(html);
  if (!m) throw new Error('Bloco <section id="screen-home"> nao encontrado no HTML.');
  return m[0];
}

/** Extrai uma regra CSS (do seletor ate a chave de fechamento balanceada). */
function extractRule(css, selector) {
  const re = new RegExp("(?:^|\\n)[ \\t]*(" + escapeRegex(selector) + "[ \\t]*\\{)");
  const m = re.exec(css);
  if (!m) return null;
  const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
  const open = css.indexOf("{", m.index);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    else if (css[end] === "}") {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
  }
  return css.slice(start, end).replace(/\s+$/, "");
}

function hasRule(css, selector) {
  const re = new RegExp("(?:^|\\n)[ \\t]*" + escapeRegex(selector) + "[ \\t]*[{,]", "m");
  return re.test(css);
}

function hasVar(css, name) {
  return css.includes(name + ":");
}

/** Chaves i18n consumidas pela Home (atributos data-i18n dentro do bloco). */
function homeI18nKeys(homeSection) {
  const keys = new Set();
  const re = /data-i18n="([^"]+)"/g;
  let m;
  while ((m = re.exec(homeSection))) keys.add(m[1]);
  return [...keys].sort();
}

function bytesOf(text) {
  return Buffer.byteLength(text, "utf8");
}

// ---------------------------------------------------------------------------
// Coleta do estado atual
// ---------------------------------------------------------------------------

function collect() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const home = extractHomeSection(html);

  const frozen = { home, css: {} };
  for (const sel of FROZEN_CSS) {
    const rule = extractRule(html, sel);
    if (rule === null) throw new Error("Regra CSS congelada nao encontrada: " + sel);
    frozen.css[sel] = rule;
  }

  const fingerprints = { home: sha256(frozen.home) };
  for (const sel of FROZEN_CSS) fingerprints["css:" + sel] = sha256(frozen.css[sel]);

  return { html, home, frozen, fingerprints };
}

// ---------------------------------------------------------------------------
// Verificacoes extras (nao dependem do golden)
// ---------------------------------------------------------------------------

function checkSharedCss(html) {
  const failures = [];
  for (const sel of SHARED_SELECTORS) {
    if (!hasRule(html, sel)) failures.push("seletor compartilhado ausente: " + sel);
  }
  for (const v of REQUIRED_VARS) {
    if (!hasVar(html, v)) failures.push("variavel CSS ausente: " + v);
  }
  return failures;
}

function loadI18nDict() {
  if (!fs.existsSync(I18N_PATH)) return null;
  const code = fs.readFileSync(I18N_PATH, "utf8");
  const sandbox = { module: { exports: {} }, console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: I18N_PATH });
  const dict = sandbox.I18n && sandbox.I18n.dict ? sandbox.I18n.dict : null;
  return dict;
}

function checkI18n(home) {
  const dict = loadI18nDict();
  if (!dict) return { skipped: true, failures: [], values: null };

  const failures = [];
  const keys = homeI18nKeys(home);
  const values = {};
  for (const locale of LOCALES) {
    if (!dict[locale]) {
      failures.push("idioma ausente no dicionario i18n: " + locale);
      continue;
    }
    for (const key of keys) {
      const value = dict[locale][key];
      if (typeof value !== "string" || value.trim() === "") {
        failures.push(`i18n[${locale}] sem traducao para a chave da Home: "${key}"`);
      } else {
        (values[key] = values[key] || {})[locale] = value;
      }
    }
  }
  return { skipped: false, failures, keys, values };
}

/** Compara os textos da Home (pt/en/es) com o snapshot do golden master. */
function checkI18nSnapshot(values, expected) {
  const failures = [];
  if (!values || !expected) return failures;
  for (const key of Object.keys(expected)) {
    for (const locale of LOCALES) {
      const want = expected[key][locale];
      const got = values[key] ? values[key][locale] : undefined;
      if (got === undefined) {
        failures.push(`texto da Home ausente: i18n[${locale}].${key}`);
      } else if (got !== want) {
        failures.push(`TEXTO DA HOME MUDOU -> i18n[${locale}].${key}\n      esperado: ${JSON.stringify(want)}\n      atual:    ${JSON.stringify(got)}`);
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const problems = [];
  const notes = [];
  let state;
  try {
    state = collect();
  } catch (err) {
    console.error("FALHA na coleta:", err.message);
    process.exit(1);
  }

  const i18n = checkI18n(state.home);

  if (UPDATE) {
    const golden = {
      generatedAt: new Date().toISOString(),
      source: path.basename(HTML_PATH),
      frozen: state.frozen,
      fingerprints: state.fingerprints,
      sizes: {
        home: bytesOf(state.home),
        css: Object.fromEntries(FROZEN_CSS.map((s) => [s, bytesOf(state.frozen.css[s])])),
      },
      homeI18n: i18n.skipped ? null : i18n.values,
    };
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n", "utf8");
    console.log("Golden master regenerado em tests/home-golden.json");
    console.log("  home:", golden.fingerprints.home.slice(0, 16), "(" + golden.sizes.home + " bytes)");
    for (const sel of FROZEN_CSS) {
      console.log(
        "  css " + sel.padEnd(26) + golden.fingerprints["css:" + sel].slice(0, 16) +
          " (" + golden.sizes.css[sel] + " bytes)"
      );
    }
    console.log("  i18n da Home:", i18n.skipped ? "(js/i18n.js ausente)" : Object.keys(i18n.values).length + " chaves x " + LOCALES.length + " idiomas");
    return;
  }

  if (!fs.existsSync(GOLDEN_PATH)) {
    console.error("Golden master ausente. Rode: node tests/home-guard.test.js --update");
    process.exit(1);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));

  // 1) Fingerprints
  for (const [name, hash] of Object.entries(state.fingerprints)) {
    const expected = golden.fingerprints[name];
    if (!expected) {
      problems.push("fingerprint novo sem referencia no golden: " + name);
      continue;
    }
    if (hash !== expected) {
      problems.push(
        `HOME MUDOU -> ${name}\n      esperado: ${expected}\n      atual:    ${hash}`
      );
    }
  }
  for (const name of Object.keys(golden.fingerprints)) {
    if (!(name in state.fingerprints)) problems.push("fingerprint do golden nao encontrado: " + name);
  }

  // 2) CSS compartilhado / variaveis
  for (const f of checkSharedCss(state.html)) problems.push(f);

  // 3) i18n da Home
  if (i18n.skipped) {
    notes.push("js/i18n.js ainda nao existe — verificacao de traducao da Home ignorada.");
  } else {
    for (const f of i18n.failures) problems.push(f);
    for (const f of checkI18nSnapshot(i18n.values, golden.homeI18n)) problems.push(f);
  }

  // -------------------------------------------------------------------------
  console.log("=== HOME GUARD (golden master) ===");
  console.log("arquivo : " + path.relative(ROOT, HTML_PATH));
  console.log("home    : " + state.fingerprints.home.slice(0, 16) + "  (" + bytesOf(state.home) + " bytes)");
  for (const sel of FROZEN_CSS) {
    console.log(
      "css     : " + sel.padEnd(26) + state.fingerprints["css:" + sel].slice(0, 16) +
        "  (" + bytesOf(state.frozen.css[sel]) + " bytes)"
    );
  }
  console.log(
    "shared  : " + SHARED_SELECTORS.length + " seletores + " + REQUIRED_VARS.length + " variaveis verificados"
  );
  if (!i18n.skipped) {
    console.log("i18n    : " + i18n.keys.length + " chaves da Home em " + LOCALES.join("/") + " OK");
  }
  for (const n of notes) console.log("aviso   : " + n);

  if (problems.length) {
    console.log("\n--- FALHAS (" + problems.length + ") ---");
    for (const p of problems) console.log("  x " + p);
    console.log("\nA Home esta BLINDADA. Se a mudanca foi intencional, revise a regra de ouro.");
    process.exit(1);
  }

  console.log("\nOK — a Home (markup + CSS + i18n) nao foi alterada.");
}

main();
