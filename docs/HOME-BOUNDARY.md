# Contrato da Home (BLINDADA)

> **REGRA DE OURO:** a tela **Home** do `TreinoTracker_DeepSeek.html` está **FINALIZADA**.
> Nenhuma alteração — nem visual, nem de texto, nem de comportamento.

Este documento define exatamente o que está congelado, o que é permitido e como a
regra é verificada automaticamente.

---

## 1. O que está congelado (e é verificado por hash)

| Alvo | Onde | SHA-256 (16 primeiros) | Bytes |
|---|---|---|---|
| Bloco `<section id="screen-home">` | HTML, ~linha 384–408 | `1a2717d45953eb40` | 1705 |
| `.logo` | CSS | `79fcb28accd7748d` | 76 |
| `.logo span` | CSS | `f0baa141a1e3ee24` | 45 |
| `.card-highlight` | CSS | `cc0b1493568dfd1f` | 333 |
| `.card-highlight::before` | CSS | `24bd381cd9569d2a` | 159 |
| `.last-workout` | CSS | `6eb3d371e47c36ec` | 208 |
| 8 chaves i18n da Home × 3 idiomas | `js/i18n.js` | snapshot em `tests/home-golden.json` | — |

Além dos hashes, a guarda verifica que **continuam existindo**:

- **Seletores compartilhados** que a Home consome: `.screen`, `.screen.active`, `.btn`,
  `.btn-primary`, `.btn-sm`, `.text-muted`, `.history-status`
- **Variáveis CSS**: `--primary`, `--card-bg`, `--border-radius`, `--border-radius-sm`,
  `--text-main`, `--text-muted`, `--bg-color`, `--font-family`, `--nav-height`
- Os **textos exatos** da Home em pt/en/es

## 2. O que é PERMITIDO (Opção A)

✅ Adicionar tags `<script src="...">` e `<link>` no HTML (fora do bloco da Home).
✅ Adicionar/alterar módulos em `js/`, `services/`, `tests/`.
✅ Alterar o **script principal** (as outras 8 telas, utilidades, dados mock).
✅ Adicionar uma linha `Persistence.save*()` dentro de funções que **não** são da Home.

## 3. O que é PROIBIDO

🚫 Editar qualquer byte do bloco `<section id="screen-home">…</section>`.
🚫 Editar as regras CSS `.logo`, `.logo span`, `.card-highlight`, `.card-highlight::before`, `.last-workout`.
🚫 Renomear/remover os seletores compartilhados ou as variáveis CSS acima.
🚫 Mudar os textos da Home em qualquer idioma.
🚫 Inserir `<script>`/`<link>` **dentro** do bloco da Home.
🚫 Fazer a Home depender de `I18n.` / `Persistence.` / `StorageService.` / `TTUtils.` no markup.

> **Nota sobre o botão PT/EN:** ele continua com **2 estados** (`pt ↔ en`), exatamente como sempre foi.
> O idioma `es` existe em `js/i18n.js` e pode ser usado por telas futuras via `I18n.setLocale('es')`,
> mas **não** foi exposto na Home para não alterar seu comportamento.

## 4. Como a regra é verificada

```bash
npm run test:home     # guarda da Home (golden master)
npm test              # guarda da Home + testes unitários + smoke test de browser
```

Só use `npm run test:update` se a mudança da Home foi **aprovada explicitamente** — ele
regrava o golden master e "abençoa" a alteração.

Se `test:home` falhar com `HOME MUDOU -> ...`, a Home foi alterada. **Reverta a alteração.**

## 5. Manutenção do golden master

O arquivo `tests/home-golden.json` guarda o texto congelado + os hashes. Foi gerado a
partir do HTML **pristino** (61111 bytes de origem, `SHA-256 E97F3DDC…`) e nunca deve ser
regravado sem autorização.

Backup do HTML pristino (antes da Fase 1): arquivado **fora deste repositório**
(cópia local de trabalho) e também na branch `feature/sprint-5.2.1-ux` do
repo `TreinoTracker`.
