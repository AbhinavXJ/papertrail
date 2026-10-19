import { deleteDatabase, openDatabase, SAMPLE_DB, USER_DB, type DB } from "@/lib/db/schema";
import * as repo from "@/lib/db/repo";
import { StorageError } from "@/lib/db/repo";
import { createSearchService, type SearchService } from "@/lib/search/client";
import type { SearchResult, Snippet } from "@/lib/search/engine";
import type { HighlightSpec } from "@/lib/search/tokenize";
import { sha256Hex, sniff, SNIFF_BYTES } from "@/lib/ingest/sniff";
import { classify, ruleMatches } from "@/lib/organize/classify";
import { extractFindings, preferredDateOrder, suggestDocumentDate } from "@/lib/organize/findings";
import { BUILT_IN_IDS } from "@/lib/organize/categories";
import { dueNotifications, reminderKey } from "@/lib/dates/reminders";
import { DATE_KINDS } from "@/lib/dates/kinds";
import { backupFileName, buildBackup, inspectBackup, restoreBackup, type Inspection, type RestoreResult } from "@/lib/backup/backup";
import type { ZipReader } from "@/lib/backup/zip";
import { downloadBlob } from "@/lib/download";
import type { Category, DocumentRecord, ImportantDate, Rule, Settings, Tag } from "@/lib/types";
import { fold, formatBytes, isAbortError, newId, plural, titleFromFileName, todayISO } from "@/lib/util";
import { docsPatch, dropDocs, getState, putDocs, setState, tagsPatch, toast, type QueueItem, type Workspace } from "./store";

/**
 * The application controller: owns the IndexedDB connection for the active workspace, the
 * search worker and the processing queue. React components read state through `useApp` and
 * call these functions to change it. Every mutation writes IndexedDB first, then updates
 * in-memory state, then the search index — so a crash never leaves the UI ahead of storage.
 */

const WORKSPACE_KEY = "papertrail.workspace";
const MAX_ATTEMPTS = 3;

let db: DB | null = null;
let search: SearchService | null = null;
let channel: BroadcastChannel | null = null;
let closingOnPurpose = false;
let booted = false;
let reminderTimer: ReturnType<typeof setInterval> | null = null;

const pendingFiles = new Map<string, File>();
/** `explicit`: the user asked for this run (retry / OCR); otherwise it is skipped if another tab already did it. */
interface Job {
  key: string;
  docId: string;
  forceOcr: boolean;
  explicit: boolean;
  /** Encrypted PDFs: held in memory for this one run, never written anywhere. */
  password?: string;
}
const jobs: Job[] = [];
/** Jobs cancelled while waiting for another tab to release the processing lock. */
const cancelledKeys = new Set<string>();
let running = false;
let current: { key: string; docId: string; controller: AbortController } | null = null;

export const dbNameFor = (ws: Workspace) => (ws === "sample" ? SAMPLE_DB : USER_DB);

function requireDb(): DB {
  if (!db) throw new StorageError("unavailable", "Local storage isn't open. Reload the page and try again.");
  return db;
}

function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  return e instanceof StorageError ? e.message : e instanceof Error && e.name === "BackupError" ? e.message : fallback;
}

/** Called after any change: refreshes search for the given documents and tells other tabs. */
function changed(ids: readonly string[] = [], opts: { removed?: boolean } = {}) {
  setState((s) => ({ revision: s.revision + 1 }));
  if (ids.length && search) {
    (opts.removed ? search.remove(ids) : search.upsert(ids)).catch(() => setState({ searchError: "Search couldn't be updated. Reload the page to rebuild it." }));
  }
  channel?.postMessage({ type: "changed" });
}

// ── Boot & workspaces ──────────────────────────────────────────────────────

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  const ws: Workspace = localStorage.getItem(WORKSPACE_KEY) === "sample" ? "sample" : "user";
  await openWorkspace(ws);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void checkReminders());
}

async function openWorkspace(ws: Workspace): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") throw new StorageError("unavailable", "This browser doesn't provide local storage (IndexedDB), which PAPERTRAIL needs to keep your documents.");
    const name = dbNameFor(ws);
    db = await openDatabase(name, {
      onClosed: () => {
        db = null;
        if (!closingOnPurpose) setState({ phase: "error", error: "PAPERTRAIL was updated or reset in another tab. Reload this page to continue." });
      },
    });
    await repo.probeBlobSupport(db);
    const loaded = await repo.loadState(db);
    setState({
      phase: "ready",
      error: null,
      busy: null,
      workspace: ws,
      ...docsPatch(loaded.documents),
      ...tagsPatch(loaded.tags),
      categories: loaded.categories,
      rules: loaded.rules,
      dates: loaded.dates,
      settings: loaded.settings,
      queue: [],
      searchReady: false,
      searchError: null,
    });
    localStorage.setItem(WORKSPACE_KEY, ws);
    channel?.close();
    channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`papertrail:${name}`) : null;
    if (channel) channel.onmessage = () => scheduleReload();
    search ??= createSearchService();
    search
      .init(name)
      .then(() => setState({ searchReady: true, searchError: null }))
      .catch(() => setState({ searchError: "Search couldn't start. Documents are safe; reload the page to try again." }));
    void resumeInterrupted();
    void refreshStorage();
    reminderTimer ??= setInterval(() => void checkReminders(), 10 * 60_000);
    void checkReminders();
  } catch (e) {
    const msg =
      e instanceof StorageError
        ? e.message
        : "PAPERTRAIL couldn't open its local storage. If you're in a private window or your browser blocks site data, allow storage for this site and reload.";
    setState({ phase: "error", error: msg });
  }
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;

/** Another tab changed the library: reload metadata (cheap) and resync search. */
function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    if (!db) return;
    try {
      const loaded = await repo.loadState(db);
      setState((s) => ({
        ...docsPatch(loaded.documents),
        ...tagsPatch(loaded.tags),
        categories: loaded.categories,
        rules: loaded.rules,
        dates: loaded.dates,
        settings: loaded.settings,
        revision: s.revision + 1,
      }));
      await search?.init(dbNameFor(getState().workspace));
    } catch {
      /* the next change will retry */
    }
  }, 250);
}

async function closeWorkspace(): Promise<void> {
  stopProcessing();
  closingOnPurpose = true;
  db?.close();
  db = null;
  closingOnPurpose = false;
  channel?.close();
  channel = null;
  pendingFiles.clear();
}

export async function switchWorkspace(ws: Workspace): Promise<void> {
  if (getState().workspace === ws && db) return;
  await closeWorkspace();
  // Keep the current page mounted (e.g. Settings in the middle of a restore); just show progress.
  setState({ busy: ws === "sample" ? "Opening the sample workspace…" : "Opening your library…" });
  await openWorkspace(ws);
}

/** Opens the sample workspace (a separate database), creating the sample documents the first time. */
export async function enterSamples(): Promise<void> {
  await switchWorkspace("sample");
  if (getState().docs.length || getState().queue.length) return;
  setState({ busy: "Preparing sample documents…" });
  try {
    const { buildSampleFiles, applySampleExtras } = await import("@/lib/samples/samples");
    const files = await buildSampleFiles();
    await importFiles(files, { quiet: true });
    await applySampleExtras({ createTag, setTags: (ids, tagIds) => addTag(ids, tagIds), addDate, docs: () => getState().docs, waitForQueue });
  } catch {
    toast("The sample documents couldn't be created.", "error");
  } finally {
    setState({ busy: null });
  }
}

/** Deletes the sample workspace entirely and returns to the user's own library. */
export async function discardSamples(): Promise<void> {
  await closeWorkspace();
  setState({ phase: "booting" });
  await search?.init(USER_DB).catch(() => undefined);
  await deleteDatabase(SAMPLE_DB).catch(() => undefined);
  await openWorkspace("user");
}

// ── Storage & persistence ──────────────────────────────────────────────────

export async function refreshStorage(): Promise<void> {
  if (!navigator.storage?.estimate) return;
  try {
    const [est, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? Promise.resolve(null)]);
    setState({ storage: { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted } });
  } catch {
    /* estimates are optional */
  }
}

/**
 * Once the user has real documents stored, ask the browser not to evict them under storage
 * pressure. Chromium and Safari decide silently; Firefox shows its own permission prompt.
 */
async function askPersistenceOnce(): Promise<void> {
  const KEY = "papertrail.persistAsked";
  if (getState().workspace !== "user" || !navigator.storage?.persist || localStorage.getItem(KEY)) return;
  localStorage.setItem(KEY, String(Date.now()));
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* optional */
  }
  void refreshStorage();
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  const ok = await navigator.storage.persist().catch(() => false);
  await refreshStorage();
  toast(ok ? "Your browser will keep PAPERTRAIL's data unless you remove it yourself." : "Your browser declined. It may still keep the data, but it could clear it if disk space runs low — keep backups.", ok ? "success" : "info");
  return ok;
}

// ── Import ─────────────────────────────────────────────────────────────────

function updateQueue(key: string, patch: Partial<QueueItem>) {
  setState((s) => ({ queue: s.queue.map((q) => (q.key === key ? { ...q, ...patch } : q)) }));
}

export function dismissQueueItem(key: string) {
  pendingFiles.delete(key);
  setState((s) => ({ queue: s.queue.filter((q) => q.key !== key) }));
}

export function clearFinished() {
  setState((s) => ({ queue: s.queue.filter((q) => q.phase === "checking" || q.phase === "queued" || q.phase === "processing") }));
  for (const k of [...pendingFiles.keys()]) if (!getState().queue.some((q) => q.key === k)) pendingFiles.delete(k);
}

function newRecord(file: File, kind: DocumentRecord["kind"], mime: string, sha256: string): DocumentRecord {
  const now = Date.now();
  const cls = classify({ fileName: file.name, text: "", rules: getState().rules });
  return {
    id: newId(),
    title: titleFromFileName(file.name),
    fileName: file.name,
    mimeType: mime,
    kind,
    size: file.size,
    sha256,
    fileModifiedAt: file.lastModified || null,
    importedAt: now,
    updatedAt: now,
    categoryId: cls.categoryId,
    categorySource: cls.categorySource,
    categoryReasons: cls.categoryReasons,
    tagIds: cls.tagIds,
    notes: "",
    documentDate: null,
    findings: null,
    extraction: { status: "queued", method: "none", attempts: 0, updatedAt: now },
    textLength: 0,
    hasPreview: false,
  };
}

/** Validates, de-duplicates and stores one file. The original is saved before any processing. */
async function admit(key: string, file: File, opts: { allowDuplicate: boolean; seen: Map<string, string> }): Promise<void> {
  const fail = (phase: "rejected" | "failed", message: string) => updateQueue(key, { phase, message });
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const s = sniff(head, file.name, file.size);
    if (!s.ok) return fail("rejected", s.reason);
    const st = getState().storage;
    if (st && st.quota && st.quota - st.usage < file.size * 1.1)
      return fail("rejected", `There isn't enough browser storage for this file (it needs ${formatBytes(file.size)}; about ${formatBytes(Math.max(0, st.quota - st.usage))} is free).`);
    const sha = await sha256Hex(await file.arrayBuffer());
    if (!opts.allowDuplicate) {
      const existing = (await repo.findBySha256(requireDb(), sha))[0];
      const inBatch = opts.seen.get(sha);
      if (existing || inBatch) {
        pendingFiles.set(key, file);
        const dup = existing ? { id: existing.id, title: existing.title } : { id: "", title: inBatch! };
        return updateQueue(key, { phase: "duplicate", duplicateOf: dup, message: existing ? `Already in your library as “${existing.title}”.` : "The same file was added twice in this batch." });
      }
    }
    const doc = newRecord(file, s.kind, s.mime, sha);
    opts.seen.set(sha, doc.title);
    // A File-backed slice: the browser copies it into storage without a second in-memory copy.
    await repo.addDocument(requireDb(), doc, file.slice(0, file.size, s.mime));
    pendingFiles.delete(key);
    putDocs([doc]);
    changed([doc.id]);
    updateQueue(key, { phase: "queued", docId: doc.id, message: undefined });
    void askPersistenceOnce();
    jobs.push({ key, docId: doc.id, forceOcr: false, explicit: false });
    void pump();
  } catch (e) {
    if (e instanceof StorageError) {
      fail("failed", e.message);
      if (e.code === "quota") void refreshStorage();
      return;
    }
    const name = (e as { name?: string })?.name;
    fail("failed", name === "NotReadableError" || name === "NotFoundError" ? "This file couldn't be read. It may have been moved or deleted, or it's still downloading from a cloud drive." : "This file couldn't be imported.");
  }
}

export async function importFiles(files: readonly File[], opts: { quiet?: boolean } = {}): Promise<void> {
  if (!files.length) return;
  const items: QueueItem[] = files.map((f) => ({ key: newId(), name: f.name, size: f.size, phase: "checking" }));
  setState((s) => ({ queue: [...s.queue, ...items] }));
  const seen = new Map<string, string>();
  for (let i = 0; i < files.length; i++) await admit(items[i].key, files[i], { allowDuplicate: false, seen });
  if (!opts.quiet) {
    const q = getState().queue.filter((x) => items.some((i) => i.key === x.key));
    const rejected = q.filter((x) => x.phase === "rejected" || x.phase === "failed").length;
    const dups = q.filter((x) => x.phase === "duplicate").length;
    if (rejected || dups) toast([rejected && `${plural(rejected, "file")} couldn't be imported`, dups && `${plural(dups, "duplicate")} skipped`].filter(Boolean).join(" · "), rejected ? "error" : "info");
  }
}

export async function importDuplicateAnyway(key: string): Promise<void> {
  const file = pendingFiles.get(key);
  if (!file) return dismissQueueItem(key);
  updateQueue(key, { phase: "checking", duplicateOf: undefined, message: undefined });
  await admit(key, file, { allowDuplicate: true, seen: new Map() });
}

// ── Processing ─────────────────────────────────────────────────────────────

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (jobs.length) {
      const job = jobs.shift()!;
      await withProcessingLock(() => runJob(job));
    }
  } finally {
    running = false;
  }
}

/** Resolves when the processing queue is empty. */
export async function waitForQueue(): Promise<void> {
  while (running || jobs.length) await new Promise((r) => setTimeout(r, 150));
}

/**
 * Only one tab processes documents at a time (Web Locks). Without this, two open tabs could both
 * resume the same interrupted document after a reload.
 */
function withProcessingLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request(`papertrail-processing:${dbNameFor(getState().workspace)}`, fn);
}

function stopProcessing() {
  jobs.length = 0;
  current?.controller.abort();
}

async function runJob(job: Job): Promise<void> {
  const d = db;
  if (cancelledKeys.delete(job.key) || !d) return;
  // Read the stored record (not in-memory state): another tab may have processed it meanwhile.
  const start = await repo.getDocument(d, job.docId).catch(() => undefined);
  if (!start) return dismissQueueItem(job.key);
  if (!job.explicit && start.extraction.status !== "queued" && start.extraction.status !== "processing") {
    putDocs([start]);
    return updateQueue(job.key, { phase: "done", result: start.extraction.status, message: start.extraction.message, progress: undefined });
  }
  const controller = new AbortController();
  current = { key: job.key, docId: job.docId, controller };
  updateQueue(job.key, { phase: "processing", progress: { label: "Starting…", ratio: null } });
  let lastProgress = 0;
  try {
    const doc = await repo.updateDocument(d, start.id, { extraction: { ...start.extraction, status: "processing", attempts: start.extraction.attempts + 1, updatedAt: Date.now() } });
    putDocs([doc]);
    const blob = await repo.getFile(d, doc.id);
    if (!blob) throw new StorageError("not-found", "The original file is missing from storage.");
    const { processFile } = await import("@/lib/ingest/process");
    const out = await processFile(doc, blob, {
      ocrEnabled: job.forceOcr || getState().settings.ocrEnabled,
      password: job.password,
      signal: controller.signal,
      onProgress: (label, ratio) => {
        const now = Date.now();
        if (now - lastProgress < 120 && ratio !== null) return;
        lastProgress = now;
        updateQueue(job.key, { progress: { label, ratio } });
      },
    });
    const text = out.text?.text ?? "";
    const findings = text ? extractFindings(text, preferredDateOrder()) : null;
    const suggested = suggestDocumentDate(findings);
    const rules = getState().rules;
    // Merged with the stored record inside the write transaction: edits made meanwhile are kept.
    const next = await repo.saveProcessed(
      d,
      doc.id,
      (latest) => {
        const cls = classify({ fileName: latest.fileName, text, rules }, latest);
        const untouchedTitle = latest.title === titleFromFileName(latest.fileName);
        return {
          ...latest,
          title: untouchedTitle && out.metaTitle ? out.metaTitle : latest.title,
          categoryId: cls.categoryId,
          categorySource: cls.categorySource,
          categoryReasons: cls.categoryReasons,
          tagIds: [...new Set([...latest.tagIds, ...cls.tagIds])],
          documentDate: latest.documentDate?.source === "user" ? latest.documentDate : suggested ? { value: suggested, source: "suggested" } : null,
          findings,
          extraction: { ...out.extraction, attempts: doc.extraction.attempts, updatedAt: Date.now() },
          textLength: text.length,
          hasPreview: out.preview ? true : latest.hasPreview,
          updatedAt: Date.now(),
        };
      },
      out.text,
      out.preview ?? undefined,
    );
    putDocs([next]);
    changed([next.id]);
    updateQueue(job.key, { phase: "done", result: next.extraction.status, message: next.extraction.message, progress: undefined });
  } catch (e) {
    if (e instanceof StorageError && e.code === "not-found" && !getState().docMap.has(job.docId)) return dismissQueueItem(job.key);
    const cancelled = isAbortError(e);
    const message = cancelled
      ? "Text reading was cancelled. You can run it again from the document page."
      : e instanceof StorageError
        ? e.message
        : "Something went wrong while reading this file. The original is stored; you can try again.";
    const latest = getState().docMap.get(job.docId);
    if (latest && db) {
      try {
        const marked = await repo.updateDocument(db, latest.id, { extraction: { ...latest.extraction, status: cancelled ? "partial" : "failed", message, updatedAt: Date.now() } });
        putDocs([marked]);
        changed();
      } catch {
        /* storage itself failed; the message below explains */
      }
    }
    updateQueue(job.key, { phase: cancelled ? "done" : "failed", result: cancelled ? "partial" : "failed", message, progress: undefined });
  } finally {
    current = null;
  }
}

/** Runs text extraction again (optionally forcing OCR even when it is switched off). */
export function reprocess(docId: string, opts: { forceOcr?: boolean; password?: string } = {}): void {
  const doc = getState().docMap.get(docId);
  if (!doc) return;
  if (current?.docId === docId || jobs.some((j) => j.docId === docId)) return;
  const key = newId();
  setState((s) => ({ queue: [...s.queue, { key, name: doc.title, size: doc.size, phase: "queued", docId, rerun: true }] }));
  jobs.push({ key, docId, forceOcr: !!opts.forceOcr, explicit: true, password: opts.password || undefined });
  void pump();
}

export function cancelProcessing(key: string): void {
  if (current?.key === key) return current.controller.abort();
  const i = jobs.findIndex((j) => j.key === key);
  const item = getState().queue.find((q) => q.key === key);
  if (i >= 0) jobs.splice(i, 1);
  else if (item?.phase === "queued") cancelledKeys.add(key); // waiting for another tab to finish
  else return;
  const doc = item?.docId ? getState().docMap.get(item.docId) : undefined;
  updateQueue(key, { phase: "done", result: "partial", message: "Skipped. The file is stored; you can read its text later from the document page." });
  if (doc && db && (doc.extraction.status === "queued" || doc.extraction.status === "processing")) {
    void repo
      .updateDocument(db, doc.id, { extraction: { ...doc.extraction, status: "partial", message: "Text reading was skipped. Run it from this page when you're ready.", updatedAt: Date.now() } })
      .then((m) => {
        putDocs([m]);
        changed();
      })
      .catch(() => undefined);
  }
}

/** After a reload, continue processing documents that were interrupted (with a retry limit). */
async function resumeInterrupted(): Promise<void> {
  const d = db;
  if (!d) return;
  const stuck = getState().docs.filter((x) => x.extraction.status === "queued" || x.extraction.status === "processing");
  for (const doc of stuck) {
    if (doc.extraction.attempts >= MAX_ATTEMPTS) {
      const failed = await repo
        .updateDocument(d, doc.id, { extraction: { ...doc.extraction, status: "failed", message: "Reading this file stopped unexpectedly several times. It may be too large or complex for this browser. The original is stored.", updatedAt: Date.now() } })
        .catch(() => null);
      if (failed) putDocs([failed]);
      continue;
    }
    const key = newId();
    setState((s) => ({ queue: [...s.queue, { key, name: doc.title, size: doc.size, phase: "queued", docId: doc.id, rerun: true, message: "Resuming after reload" }] }));
    jobs.push({ key, docId: doc.id, forceOcr: false, explicit: false });
  }
  void pump();
}

// ── Documents ──────────────────────────────────────────────────────────────

export async function updateDocument(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord | null> {
  try {
    const doc = await repo.updateDocument(requireDb(), id, patch);
    putDocs([doc]);
    changed([id]);
    return doc;
  } catch (e) {
    toast(errorMessage(e, "The change couldn't be saved."), "error");
    return null;
  }
}

async function updateMany(ids: readonly string[], fn: (d: DocumentRecord) => DocumentRecord): Promise<boolean> {
  try {
    const docs = await repo.updateDocuments(requireDb(), ids, fn);
    putDocs(docs);
    changed(docs.map((d) => d.id));
    return true;
  } catch (e) {
    toast(errorMessage(e, "The change couldn't be saved."), "error");
    return false;
  }
}

export function setCategory(ids: readonly string[], categoryId: string | null) {
  return updateMany(ids, (d) => ({ ...d, categoryId, categorySource: categoryId ? "user" : null, categoryReasons: [] }));
}

export function confirmCategory(id: string) {
  return updateMany([id], (d) => ({ ...d, categorySource: d.categoryId ? "user" : null, categoryReasons: [] }));
}

export function addTag(ids: readonly string[], tagIds: readonly string[]) {
  return updateMany(ids, (d) => ({ ...d, tagIds: [...new Set([...d.tagIds, ...tagIds])] }));
}

export function removeTag(ids: readonly string[], tagId: string) {
  return updateMany(ids, (d) => ({ ...d, tagIds: d.tagIds.filter((t) => t !== tagId) }));
}

export async function deleteDocuments(ids: readonly string[]): Promise<boolean> {
  if (!ids.length) return true;
  const set = new Set(ids);
  if (current && set.has(current.docId)) current.controller.abort();
  for (let i = jobs.length - 1; i >= 0; i--) if (set.has(jobs[i].docId)) jobs.splice(i, 1);
  try {
    await repo.deleteDocuments(requireDb(), ids);
    dropDocs(ids);
    setState((s) => ({ queue: s.queue.filter((q) => !q.docId || !set.has(q.docId)) }));
    changed(ids, { removed: true });
    void refreshStorage();
    return true;
  } catch (e) {
    toast(errorMessage(e, "The documents couldn't be deleted."), "error");
    return false;
  }
}

export async function getDocumentFile(id: string): Promise<Blob | null> {
  return repo.getFile(requireDb(), id);
}

export async function getDocumentText(id: string) {
  return repo.getText(requireDb(), id);
}

export async function getDocumentPreview(id: string) {
  return repo.getPreview(requireDb(), id);
}

// ── Search ─────────────────────────────────────────────────────────────────

export async function runSearch(q: string, allowed: readonly string[] | null): Promise<SearchResult> {
  if (!search) throw new Error("Search isn't ready");
  return search.query(q, allowed);
}

export async function loadSnippets(ids: readonly string[], spec: HighlightSpec): Promise<Record<string, Snippet | null>> {
  if (!search || !ids.length) return {};
  return search.snippets(ids, spec);
}

// ── Tags, categories, rules ────────────────────────────────────────────────

export async function createTag(name: string): Promise<Tag | null> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return null;
  const existing = getState().tags.find((t) => fold(t.name) === fold(clean));
  if (existing) return existing;
  const tag: Tag = { id: newId(), name: clean, createdAt: Date.now() };
  try {
    await repo.putTag(requireDb(), tag);
    setState((s) => tagsPatch([...s.tags, tag]));
    changed();
    return tag;
  } catch (e) {
    toast(errorMessage(e, "The tag couldn't be created."), "error");
    return null;
  }
}

export async function renameTag(id: string, name: string): Promise<boolean> {
  const tag = getState().tagMap.get(id);
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!tag || !clean) return false;
  if (getState().tags.some((t) => t.id !== id && fold(t.name) === fold(clean))) {
    toast(`A tag called “${clean}” already exists.`, "error");
    return false;
  }
  try {
    await repo.putTag(requireDb(), { ...tag, name: clean });
    setState((s) => tagsPatch(s.tags.map((t) => (t.id === id ? { ...t, name: clean } : t))));
    changed(getState().docs.filter((d) => d.tagIds.includes(id)).map((d) => d.id));
    return true;
  } catch (e) {
    toast(errorMessage(e), "error");
    return false;
  }
}

export async function deleteTag(id: string): Promise<void> {
  try {
    const affected = await repo.deleteTag(requireDb(), id);
    setState((s) => ({
      ...tagsPatch(s.tags.filter((t) => t.id !== id)),
      ...docsPatch(s.docs.map((d) => (d.tagIds.includes(id) ? { ...d, tagIds: d.tagIds.filter((t) => t !== id) } : d))),
      rules: s.rules.flatMap((r) => (r.tagId !== id ? [r] : r.categoryId ? [{ ...r, tagId: null }] : [])),
    }));
    changed(affected);
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

export async function createCategory(name: string): Promise<Category | null> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 48);
  if (!clean) return null;
  const { allCategories } = await import("@/lib/organize/categories");
  const existing = allCategories(getState().categories).find((c) => fold(c.name) === fold(clean));
  if (existing) return existing;
  const cat: Category = { id: newId(), name: clean, builtIn: false, createdAt: Date.now() };
  try {
    await repo.putCategory(requireDb(), cat);
    setState((s) => ({ categories: [...s.categories, cat] }));
    changed();
    return cat;
  } catch (e) {
    toast(errorMessage(e), "error");
    return null;
  }
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const cat = getState().categories.find((c) => c.id === id);
  const clean = name.trim().slice(0, 48);
  if (!cat || !clean || BUILT_IN_IDS.has(id)) return;
  try {
    await repo.putCategory(requireDb(), { ...cat, name: clean });
    setState((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, name: clean } : c)) }));
    changed(getState().docs.filter((d) => d.categoryId === id).map((d) => d.id));
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

export async function deleteCategory(id: string): Promise<void> {
  if (BUILT_IN_IDS.has(id)) return;
  try {
    const affected = await repo.deleteCategory(requireDb(), id);
    const loaded = await repo.loadState(requireDb());
    setState({ ...docsPatch(loaded.documents), categories: loaded.categories, rules: loaded.rules });
    changed(affected);
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

export async function addRule(rule: Omit<Rule, "id" | "createdAt">): Promise<Rule | null> {
  const r: Rule = { ...rule, contains: rule.contains.trim(), id: newId(), createdAt: Date.now() };
  if (!r.contains || (!r.categoryId && !r.tagId)) return null;
  try {
    await repo.putRule(requireDb(), r);
    setState((s) => ({ rules: [...s.rules, r] }));
    changed();
    return r;
  } catch (e) {
    toast(errorMessage(e), "error");
    return null;
  }
}

export async function deleteRule(id: string): Promise<void> {
  try {
    await repo.deleteRule(requireDb(), id);
    setState((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
    changed();
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

/** Documents a rule would change now (category not chosen by hand, or tag missing). */
export async function ruleCandidates(rule: Rule): Promise<string[]> {
  const out: string[] = [];
  for (const d of getState().docs) {
    const needsCat = rule.categoryId && d.categorySource !== "user" && d.categoryId !== rule.categoryId;
    const needsTag = rule.tagId && !d.tagIds.includes(rule.tagId);
    if (!needsCat && !needsTag) continue;
    const text = rule.field === "filename" ? "" : ((await repo.getText(requireDb(), d.id))?.text ?? "");
    if (ruleMatches(rule, d.fileName, text)) out.push(d.id);
  }
  return out;
}

export async function applyRule(rule: Rule, ids: readonly string[]): Promise<boolean> {
  const reason = `${rule.field === "filename" ? "file name" : rule.field === "text" ? "text" : "file name or text"} contains “${rule.contains}”`;
  return updateMany(ids, (d) => ({
    ...d,
    ...(rule.categoryId && d.categorySource !== "user" ? { categoryId: rule.categoryId, categorySource: "rule" as const, categoryReasons: [reason] } : {}),
    tagIds: rule.tagId ? [...new Set([...d.tagIds, rule.tagId])] : d.tagIds,
  }));
}

// ── Important dates ────────────────────────────────────────────────────────

export async function addDate(docId: string, data: Pick<ImportantDate, "kind" | "date" | "note" | "remindDays">): Promise<ImportantDate | null> {
  const now = Date.now();
  const d: ImportantDate = { id: newId(), docId, ...data, note: data.note.trim(), status: "active", createdAt: now, updatedAt: now, notifiedKey: null };
  try {
    await repo.putDate(requireDb(), d);
    setState((s) => ({ dates: [...s.dates, d] }));
    changed([docId]);
    void checkReminders();
    return d;
  } catch (e) {
    toast(errorMessage(e, "The date couldn't be saved."), "error");
    return null;
  }
}

export async function updateDate(id: string, patch: Partial<Omit<ImportantDate, "id" | "docId">>): Promise<boolean> {
  const cur = getState().dates.find((d) => d.id === id);
  if (!cur) return false;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  try {
    await repo.putDate(requireDb(), next);
    setState((s) => ({ dates: s.dates.map((d) => (d.id === id ? next : d)) }));
    changed([cur.docId]);
    return true;
  } catch (e) {
    toast(errorMessage(e, "The date couldn't be saved."), "error");
    return false;
  }
}

export async function deleteDate(id: string): Promise<void> {
  const cur = getState().dates.find((d) => d.id === id);
  if (!cur) return;
  try {
    await repo.deleteDate(requireDb(), id);
    setState((s) => ({ dates: s.dates.filter((d) => d.id !== id) }));
    changed([cur.docId]);
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

// ── Reminders (browser notifications while the app is open) ────────────────

export async function enableNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") {
    toast("This browser doesn't support notifications.", "error");
    return false;
  }
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") {
    toast("Notifications are blocked for this site. You can allow them in your browser's site settings.", "error");
    await setSetting("notificationsEnabled", false);
    return false;
  }
  await setSetting("notificationsEnabled", true);
  void checkReminders();
  return true;
}

async function checkReminders(): Promise<void> {
  const s = getState();
  if (!db || !s.settings.notificationsEnabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const due = dueNotifications(s.dates, todayISO());
  for (const d of due.slice(0, 5)) {
    const doc = s.docMap.get(d.docId);
    if (!doc) continue;
    try {
      const n = new Notification(`${DATE_KINDS[d.kind].label}: ${doc.title}`, { body: `${d.date}${d.note ? ` · ${d.note}` : ""}`, tag: `papertrail-${d.id}` });
      n.onclick = () => {
        window.focus();
        window.location.assign(`/document/?id=${encodeURIComponent(doc.id)}`);
      };
    } catch {
      return;
    }
    await updateDate(d.id, { notifiedKey: reminderKey(d) });
  }
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  try {
    await repo.putSetting(requireDb(), key, value);
    setState((s) => ({ settings: { ...s.settings, [key]: value } }));
  } catch (e) {
    toast(errorMessage(e, "The setting couldn't be saved."), "error");
  }
}

// ── Backup & restore ───────────────────────────────────────────────────────

export async function exportBackup(opts: { ids?: readonly string[]; onProgress?: (r: number) => void } = {}): Promise<boolean> {
  try {
    const { blob, documents, skipped } = await buildBackup(requireDb(), opts);
    downloadBlob(blob, backupFileName());
    if (!opts.ids && getState().workspace === "user") await setSetting("lastBackupAt", Date.now());
    toast(`Backup of ${plural(documents, "document")} downloaded (${formatBytes(blob.size)}). Keep it somewhere safe.${skipped.length ? ` ${plural(skipped.length, "document")} couldn't be included.` : ""}`, "success");
    return true;
  } catch (e) {
    toast(e instanceof Error && e.name === "ZipError" ? e.message : errorMessage(e, "The backup couldn't be created."), "error");
    return false;
  }
}

let pendingRestore: { reader: ZipReader; inspection: Inspection } | null = null;

export async function inspectRestore(file: File, onProgress?: (r: number) => void): Promise<Inspection> {
  // A backup holds real documents: never restore it into the disposable sample workspace.
  if (getState().workspace === "sample") await switchWorkspace("user");
  const { inspection, reader } = await inspectBackup(requireDb(), file, onProgress);
  pendingRestore = { inspection, reader };
  return inspection;
}

export function cancelRestore() {
  pendingRestore = null;
}

export async function applyRestore(onProgress?: (r: number) => void): Promise<RestoreResult> {
  if (!pendingRestore) throw new Error("Nothing to restore");
  const { reader, inspection } = pendingRestore;
  pendingRestore = null;
  const result = await restoreBackup(requireDb(), reader, inspection, { onProgress });
  const loaded = await repo.loadState(requireDb());
  setState((s) => ({
    ...docsPatch(loaded.documents),
    ...tagsPatch(loaded.tags),
    categories: loaded.categories,
    rules: loaded.rules,
    dates: loaded.dates,
    revision: s.revision + 1,
  }));
  await search?.init(dbNameFor(getState().workspace));
  channel?.postMessage({ type: "changed" });
  void refreshStorage();
  void resumeInterrupted();
  return result;
}

export async function clearAllData(): Promise<boolean> {
  stopProcessing();
  try {
    await repo.clearAll(requireDb());
    setState({ ...docsPatch([]), ...tagsPatch([]), categories: [], rules: [], dates: [], queue: [], settings: (await repo.getSettings(requireDb())) as Settings });
    await search?.init(dbNameFor(getState().workspace));
    changed();
    void refreshStorage();
    return true;
  } catch (e) {
    toast(errorMessage(e, "Data couldn't be deleted."), "error");
    return false;
  }
}
