# Papertrail

**Everything important you own, documented and searchable.**

Papertrail is a private, local-first document memory that runs entirely in the browser. Import receipts, bills, warranties, policies, leases, manuals and travel documents. Papertrail extracts their text on your device, keeps them in this browser's storage, makes them instantly searchable and helps you remember the dates that matter. There's no account and no server. We use Vercel Analytics for usage analytics. Your documents never leave your browser.

## Run it

Requirements: Node.js ≥ 22.13 and pnpm (9 or newer).

```bash
pnpm install        # also copies pdf.js + Tesseract assets into public/vendor/
pnpm dev            # http://localhost:3000
```

Production build and local preview (served with the same security headers as Vercel):

```bash
pnpm build          # static export → out/
pnpm start          # http://localhost:3000, sends the vercel.json headers (CSP etc.)
```

Checks:

```bash
pnpm typecheck      # TypeScript, strict
pnpm test           # unit tests (vitest + fake-indexeddb)
pnpm e2e            # browser end-to-end test against out/ (run pnpm build first)
pnpm e2e:webkit     # same suite in WebKit (Safari's engine)
pnpm e2e:firefox    # same suite in Firefox
pnpm a11y           # axe-core WCAG 2.1 A/AA audit of every screen, light + dark (after pnpm build)
pnpm verify         # all of the above
```

`pnpm e2e` and `pnpm a11y` use Playwright's cached Chromium (`~/Library/Caches/ms-playwright` or `~/.cache/ms-playwright`). You can also set `CHROMIUM_PATH=/path/to/chrome`. To install the browsers, run `npx playwright-core install chromium webkit firefox`. Test fixtures are always generated with Chromium.

## Deploy to Vercel

1. Push the repository to GitHub, GitLab or Bitbucket.
2. In Vercel, choose **Add New → Project** and import the repository. The framework preset is detected as **Next.js**. `vercel.json` already sets the install command (`pnpm install`) and the build command (`pnpm build`). You don't need any environment variables.
3. Deploy. `next.config.ts` uses `output: "export"`, so Vercel serves the static `out/` directory. It doesn't use any serverless functions.

From the command line: `npx vercel` (preview) or `npx vercel --prod`.

`vercel.json` sends these headers: a strict Content-Security-Policy (`connect-src 'self'`, so the page can only talk to its own origin), `frame-ancestors 'none'`, `nosniff`, `no-referrer`, a Permissions-Policy and COOP. The same CSP is also set as a `<meta>` tag in production builds for other static hosts. `/vendor/*` (the OCR and PDF engines) is cached for 7 days.

## Architecture

```
File ─► sniff (magic bytes, size) ─► SHA-256 ─► duplicate check ─► IndexedDB (metadata + original, one transaction)
                                                                         │
            ┌─────────────── processing queue (one at a time, cancellable, resumes after reload) ───┘
            ▼
  PDF:   pdf.js worker → per-page text (layout-aware join) → thumbnail → pages without text? → OCR
  Image: decode → thumbnail → Tesseract.js worker (OCR, lazy-loaded, local assets)
  Text:  UTF-8 / UTF-16 / Windows-1252 decode
            ▼
  findings (dates, amounts: unverified) + category suggestion/rules → saved in one transaction that
  merges with any edits made meanwhile → search worker re-indexes the document
```

- **Storage (IndexedDB, schema v1)**: separate stores for `documents` (metadata), `files` (original blobs), `texts` (extracted text + page offsets), `previews`, `tags`, `categories`, `rules`, `dates` and `settings`. Each workspace has its own database. The sample workspace (`papertrail-sample`) never mixes with your library (`papertrail`): even restoring a backup from the sample workspace goes into your own library. Where a browser can't store Blobs in IndexedDB (Safari Private Browsing, detected once with an isolated probe), originals and thumbnails are stored as bytes plus MIME type instead, transparently. Failed writes are explicitly aborted, so nothing is half-saved. Deletes remove every derived record in one transaction. Quota errors become plain-language messages. Other open tabs are kept in sync with BroadcastChannel, and a Web Lock ensures only one tab processes documents at a time. After the first import, the app asks the browser for persistent storage once.
- **Search**: a dependency-free BM25F inverted index runs in a Web Worker. It reads documents and text straight from IndexedDB, so text is never posted between threads. Fields are weighted (title, tags, file name, notes, category, metadata, body). Every word must match, and the word you're typing matches as a prefix. Singular and plural forms match, and you get typo tolerance for longer words. `"quoted phrases"` and joined tokens (`INV-2026-0042`, `1,299.00`) are matched in order. Snippets come with highlights and page numbers. When no document contains every word, partial matches are shown and labeled as such. The index is derived data: it's rebuilt at startup and never persisted, so it can't drift from storage. Search is lexical: it finds words that are actually in your documents and makes no claims to semantic understanding.
- **Viewer**: pdf.js renders pages lazily, with the selectable text layer on top. Search terms are highlighted in the PDF itself, and opening a result jumps to the matching page. Images get fit and actual-size views. Markdown is rendered with marked + DOMPurify (remote images blocked). Extracted text has page markers and match navigation.
- **Backup**: a plain ZIP (store-only) containing `README.txt`, `manifest.json` (format `papertrail-backup` v1), the originals byte-for-byte, the extracted text and thumbnails. The archive is assembled from the stored Blobs, so exporting doesn't duplicate your whole library in memory. Restore reads the ZIP's central directory and validates everything before writing: format and version, structure, presence of each file, CRC-32, size, SHA-256 against the manifest, and supported file type. It then shows a summary (ready / already present / damaged). Each document is written in its own transaction. Tags and categories are merged by name, and conflicting ids are remapped.
- **UI**: Next.js 16 App Router (static export), React 19, Tailwind CSS 4 with a small token-based design system (Newsreader + Inter, bundled locally), lucide icons. The library list and grid are virtualized.

## What's implemented

- First-run screen with drag and drop (files or whole folders), a file picker, a privacy note and a clearly labeled sample workspace you can discard.
- Imports PDF, JPEG, PNG, WebP, TXT, Markdown and CSV. File types are detected from content, not file names. Unsupported files (Word, HEIC, ZIP…) are rejected with a reason and advice. Size limits apply.
- Duplicate detection by SHA-256. Duplicates are shown with "Open existing" and "Import a copy anyway" options, never silently dropped.
- PDF text extraction for multi-page documents. Scanned pages are detected and read with on-device OCR (up to 25 pages per PDF). Images are read with OCR, and confidence is shown. OCR can be switched off, or run once per document.
- Password-protected PDFs: enter the password in the viewer to view the PDF, or in the details panel to extract its text so search can find it. The password is used once, in memory, and never stored.
- Processing states: queued, processing (with progress), completed, partially read, failed. You can cancel or skip, and retry from the import tray or the document page. Interrupted processing resumes after a reload, with a retry limit.
- Library with list and grid views, search, filters (category, tags (all must match), type, added date or document date with presets or a custom range, needs attention, has dates), sorting, bulk selection, bulk tag, bulk category, bulk export (ZIP) and bulk delete. Per-document rename, download and delete.
- Document page with the original viewer (PDF, image, text and Markdown), an extracted-text tab, download, open the original in a new tab, and editable title, category (with suggestion reasons and confirm), tags, document date, notes, important dates, unverified findings (amounts and dates, with "add as…" shortcuts), extraction details and file info. On small screens, the details move into a tab.
- Category suggestions from transparent keyword heuristics (always shown with the words that triggered them). User rules can set a category and/or tag and can be applied to existing documents. Custom categories and tags can be created, renamed and deleted.
- Important dates: typed (warranty, insurance renewal, agreement end, bill due, subscription renewal, document expiry, other) with reminder windows. Views: upcoming (needs attention, by month, done and dismissed) and a chronological timeline. You can mark dates done, dismiss, reactivate, edit or remove them. A nav badge shows how many need attention. Optional browser notifications (only after you grant permission, and only while the app is open). Export dates to `.ics` for any calendar app.
- Backup and restore as described above, a proactive backup reminder, the last-backup status, a storage-usage indicator, a persistent-storage request, and delete-all with a typed confirmation.
- Privacy page describing exactly what's stored, what's downloaded and from where, and what isn't protected.
- Light and dark themes (follows the system). Keyboard search from any page (`/` or ⌘K), Enter opens the best match, ↓ moves through results. Coming back to the library restores your scroll position. Skip link, accessible tabs and menus. Error boundaries keep a rendering bug from blanking the app.

## Tests performed

**Unit tests**: `pnpm test` runs 89 tests, all passing. They cover:

- Storage: persistence across reopen, atomic writes, the ArrayBuffer fallback for browsers that reject Blobs, duplicate ids, metadata updates, deletion cascading to files, text, previews and dates, the tag, category and rule cascades, settings, clear-all, quota and unavailable-storage errors, and edits made during processing being preserved.
- Search: phrase-only-in-body, AND semantics and ranking, prefix, plural, typo tolerance, partial-match fallback, tag, notes and file-name fields, filters, updates and removals, snippets with page numbers, a 600-document performance check, and the index following edits and deletions through IndexedDB.
- Ingestion: content sniffing, invalid, oversized and unsupported files, text decoding, SHA-256, real PDF extraction with pdf.js (multi-page, no-text pages, damaged PDFs, cancellation, Unicode metadata), and encrypted AES-128 and RC4-40 PDFs (no, wrong and right password).
- Organization: date and amount findings (including ambiguity and "never invent" cases), document-date suggestion, category heuristics and rules.
- Dates: reminder states, grouping, notification de-duplication, ICS escaping and line folding.
- Backup: ZIP round-trip, CRC, `unzip -t` interoperability, truncated and non-ZIP files, full restore into a clean DB, duplicates, id conflicts, selection export, an unreadable stored file, invalid, newer and damaged manifests, missing, corrupted and unsupported entries, and running out of storage mid-restore.
- Library filters and sorting, plus utilities.

**End-to-end**: `pnpm e2e` runs 25 checks, all passing in Chromium, WebKit (`pnpm e2e:webkit`) and Firefox (`pnpm e2e:firefox`). It runs a production build under the production CSP, with real PDFs generated by Chromium (embedded fonts), a scanned image-only PDF and a receipt image:

1. Launches with no account and shows the first-run screen.
2. Imports a real text-based PDF.
3. Verifies the extracted text, including the page markers.
4. Searches for a phrase that is only inside the PDF. Gets one result with a highlighted snippet and "Page 2".
5. Opens it with the keyboard. The correct document opens and the matches are highlighted in the rendered PDF.
6. Renames it and adds a tag.
7–8. Reloads. The title and tag persist, and search by tag and title works.
9. Exports a backup. `unzip -l` and `unzip -t` accept it.
10. Restores it in a clean browser profile, after validation.
11. The restored document is found by the phrase, opens, renders, and keeps its title and tag.
12. Deletes it. It no longer appears in search, and IndexedDB has 0 documents, files, texts, previews and dates.

The e2e test also checks:

- An invalid PDF and a `.docx` are rejected with reasons.
- A duplicate is flagged.
- OCR on a receipt PNG works: the document is found by "quartz hardware" and "cordless drill".
- OCR on a scanned PDF works: found by "wood glue".
- A 120-page PDF survives a reload mid-processing. Text on page 117 is found and labeled "Page 117", and the longest main-thread stall during processing was 19 ms.
- Filters and sorting work, and an important date shows up in the upcoming view.
- The sample workspace stays separate and is fully deleted when discarded. Restoring a backup while it's open goes into the user's own library.
- An edit in one tab shows up in another open tab without a reload. `/` on another page jumps to the library search.
- A password-protected PDF (AES-128) shows "Couldn't read" after import. A wrong password gets a clear message. The right one renders it in the viewer, extracts "Hello secret world" and makes it searchable. The password is absent from IndexedDB, localStorage and sessionStorage.
- 400 documents imported at once: about 3 s, longest main-thread stall about 60–65 ms, 15 rows in the DOM thanks to virtualization, search answered in about 190 ms including the debounce. Opening a document and coming back restores the scroll position.
- There were no console errors and no requests to any other origin.

Responsiveness is measured with an event-loop heartbeat, and the test first proves it detects a deliberate 150 ms block.

**Cross-browser**: running the suite in WebKit found a real bug that would have broken Safari Private Browsing. WebKit refuses to store Blobs in IndexedDB in ephemeral sessions ("Error preparing Blob/File data to be stored in object store"), so every import failed, and it didn't recover cleanly when that happened inside a larger transaction. It's fixed with an upfront probe and a bytes-based fallback, and the whole suite now passes in WebKit. Two Firefox-only test issues turned out to be Playwright driver quirks, not app bugs: a missed navigation event for a second tab that had fully loaded, and errors raised inside the driver itself. The suite works around them.

**Accessibility**: `pnpm a11y` runs axe-core (WCAG 2.1 A and AA rules) on 13 screens in light and dark mode, plus the password-protected PDF screen: first run, privacy, library list and grid, an open filter menu, search results, the PDF document view, extracted text, the delete dialog, upcoming dates, the timeline and settings. It finds no violations. It caught and led to fixes for a tablist containing a checkbox, trigger labels that didn't match their visible text, and two dark-mode contrast failures.

**Manual browser checks**: "Open original" was checked under the production CSP: Chrome's built-in PDF viewer displays the stored file. The dev server (`pnpm dev`) was also checked: the sample flow, search and PDF highlighting ran with no console errors. Screenshots of every screen at desktop and mobile sizes, in light and dark mode, were reviewed (`node scripts/screenshots.mjs`).

## Known limitations

- **Browser storage isn't permanent or encrypted.** It can be cleared by the user, the browser (under storage pressure; Safari after weeks without a visit) or a profile reset. Anyone with access to the browser profile can read it. Back up regularly; the app reminds you.
- **No sync.** You move a library between browsers or devices by exporting and restoring a backup.
- **OCR is English-only** (Tesseract `eng`, best-int model). Accuracy depends on image quality, and handwriting is rarely recognized. The first use downloads about 7 MB from the site itself. Scanned PDFs are OCR'd up to 25 pages. OCR runs one document at a time.
- **Reminders** only fire as browser notifications while Papertrail is open in a tab. Use the `.ics` export for reliable reminders.
- **Password-protected PDFs** need their password each time you view them (it's never saved). Once you've entered it to extract the text, that text is stored unencrypted like any other document's, so search works. Damaged PDFs are stored, and you can retry them.
- **Formats**: no DOCX, XLSX, HEIC, TIFF or GIF. iOS usually converts HEIC to JPEG when you pick photos. File size limits: PDF 200 MB, images 40 MB, text 10 MB.
- **Findings and categories** come from pattern and keyword matching (English). They're shown as suggestions and can be wrong. Numeric dates like 03/04/2026 are flagged as ambiguous.
- **Backups** use ZIP without ZIP64: up to 4 GB and 65,535 entries per archive (export a selection if your library is larger). Restore reads one file at a time, but export builds a single Blob, which very large libraries on low-memory phones may struggle with.
- **Search** is lexical, with light English plural handling only. It doesn't do synonyms or semantic search. The index is rebuilt in a worker on every start, which is fast for hundreds of documents (see the measurements above) but grows with the total amount of text.
- **Browser coverage**: the full end-to-end suite passes in Playwright's Chromium, WebKit and Firefox builds on macOS. WebKit closely approximates Safari but isn't the same as testing on real iPhones and iPads, which hasn't been done.
