<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PAPERTRAIL — private, local-first document memory

A static Next.js 16 app (`output: "export"`). No backend, no API routes, no server actions,
no auth, no analytics, no third-party requests. Documents never leave the browser.

## Commands

| Task | Command |
| --- | --- |
| Install (postinstall copies pdf.js + Tesseract assets to `public/vendor/`) | `pnpm install` |
| Dev server | `pnpm dev` |
| Type-check | `pnpm typecheck` |
| Unit tests (vitest + fake-indexeddb, node) | `pnpm test` |
| Production build → `out/` | `pnpm build` |
| Serve `out/` with the vercel.json headers (CSP) | `pnpm start` |
| End-to-end browser test (needs `pnpm build`; Playwright-cached Chromium or `CHROMIUM_PATH`) | `pnpm e2e` |
| Same suite in WebKit / Firefox (`npx playwright-core install webkit firefox`) | `pnpm e2e:webkit` / `pnpm e2e:firefox` |
| Accessibility audit (axe-core, WCAG 2.1 A/AA, light + dark; needs `pnpm build`) | `pnpm a11y` |
| Screenshots for visual review | `node scripts/screenshots.mjs [outDir]` |

Before finishing a change: `pnpm verify` (= typecheck + test + build + e2e + a11y). The e2e test fails
on any console error and on any request to a non-local origin.

## Architecture

- `src/lib/db/` — the only code that touches IndexedDB. `schema.ts` (versioned, one DB per
  workspace: `papertrail`, `papertrail-sample`), `repo.ts` (atomic transactions, quota errors →
  `StorageError`). Add migrations as `if (oldVersion < N)` blocks; never edit old ones.
- `src/lib/ingest/` — `sniff.ts` (type by magic bytes, size limits, SHA-256), `pdf.ts` (pdf.js,
  layout-aware text join), `ocr.ts` (Tesseract.js, lazy, local assets, cancel = terminate),
  `process.ts` (file → text/preview/status; never throws for bad files), `drop.ts` (folders).
- `src/lib/search/` — `engine.ts` (BM25F index, prefix/plural/fuzzy/phrase, snippets),
  `host.ts` (index ↔ IndexedDB), `search.worker.ts` + `client.ts` (worker with inline fallback).
  The index is derived data rebuilt at startup; it is never persisted.
- `src/lib/organize/` — built-in categories, keyword suggestions with reasons, user rules,
  `findings.ts` (dates/amounts printed in text — always unverified suggestions).
- `src/lib/dates/` — reminder states, grouping, `.ics` export.
- `src/lib/backup/` — `zip.ts` (store-only writer composed from Blobs; central-directory reader
  with CRC + truncation checks), `backup.ts` (manifest v1, validate-before-write restore).
- `src/lib/store/` — `store.ts` (state + `useApp`), `app.ts` (controller: boot, import queue,
  processing, every mutation: IndexedDB first → state → search index → BroadcastChannel).
- `src/components/` — `shell/`, `library/`, `document/`, `dates/`, `settings/`, `ui/`.

## Gotchas

- Workers must be created with a literal `new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })`.
- pdf.js 6: release documents with `pdf.loadingTask.destroy()` (`closePdf`), not `pdf.destroy()`.
  pdf.js transfers its input buffer — always pass a copy (`openPdf` does).
- Text-layer CSS in `globals.css` mirrors pdf.js `pdf_viewer.css` (`--scale-factor` on `.pdf-page`).
- Never claim more than the code does in UI copy: suggestions are labeled, OCR results show
  confidence, reminders only fire while the app is open.
- CSP lives in `vercel.json` (headers) and in `src/app/layout.tsx` (meta, production only). Keep
  them in sync; OCR needs `'wasm-unsafe-eval'`; `object-src blob:` lets "Open original" show PDFs.
- Next 16 error boundaries receive `retry` (not `reset`).
- Processing runs under a Web Lock (`papertrail-processing:<db>`); non-explicit jobs re-read the
  stored record and skip documents another tab already finished.
- Switching workspaces keeps the current page mounted (`busy` state), so flows like restore survive it.
- Playwright auto-scrolls elements into view before clicking; tests that depend on scroll position
  click via `elementFromPoint` instead.
- WebKit can't store Blobs in IndexedDB in Private Browsing. `openWorkspace` runs `probeBlobSupport`
  first; binary writes go through `packBlob` + `withBlobFallback` and reads through `unpackBlob`.
  Pack before opening a transaction (awaiting non-IDB work inside one auto-commits it), and use
  `settle()` so a failed write aborts the whole transaction.
- Password-protected PDFs: the password lives only in a processing job or the viewer's state —
  never in IndexedDB, localStorage or logs (the e2e test checks this).
