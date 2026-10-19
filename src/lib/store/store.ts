import { useSyncExternalStore } from "react";
import type { Category, DocumentRecord, ExtractionStatus, ImportantDate, Rule, Settings, Tag } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";

export type Workspace = "user" | "sample";

export type QueuePhase = "checking" | "rejected" | "duplicate" | "queued" | "processing" | "done" | "failed";

export interface QueueItem {
  key: string;
  name: string;
  size: number;
  phase: QueuePhase;
  docId?: string;
  duplicateOf?: { id: string; title: string };
  /** Plain-language status or reason. Never contains document content. */
  message?: string;
  progress?: { label: string; ratio: number | null };
  /** Final extraction status once done. */
  result?: ExtractionStatus;
  /** Re-processing an existing document rather than importing a new file. */
  rerun?: boolean;
}

export interface Toast {
  id: string;
  message: string;
  tone: "info" | "success" | "error";
  action?: { label: string; run: () => void };
}

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean | null;
}

export interface AppState {
  phase: "booting" | "ready" | "error";
  error: string | null;
  workspace: Workspace;
  docs: DocumentRecord[];
  docMap: ReadonlyMap<string, DocumentRecord>;
  tags: Tag[];
  tagMap: ReadonlyMap<string, Tag>;
  /** Custom categories only; built-ins live in lib/organize/categories. */
  categories: Category[];
  rules: Rule[];
  dates: ImportantDate[];
  settings: Settings;
  queue: QueueItem[];
  searchReady: boolean;
  searchError: string | null;
  /** Bumped on every data change; used to refresh search results. */
  revision: number;
  toasts: Toast[];
  storage: StorageInfo | null;
  busy: string | null;
}

export const INITIAL_STATE: AppState = {
  phase: "booting",
  error: null,
  workspace: "user",
  docs: [],
  docMap: new Map(),
  tags: [],
  tagMap: new Map(),
  categories: [],
  rules: [],
  dates: [],
  settings: DEFAULT_SETTINGS,
  queue: [],
  searchReady: false,
  searchError: null,
  revision: 0,
  toasts: [],
  storage: null,
  busy: null,
};

let state: AppState = INITIAL_STATE;
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Subscribe to a slice of app state. Selectors must return stored references (or primitives). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(INITIAL_STATE),
  );
}

export function docsPatch(docs: DocumentRecord[]): Pick<AppState, "docs" | "docMap"> {
  const sorted = [...docs].sort((a, b) => b.importedAt - a.importedAt);
  return { docs: sorted, docMap: new Map(sorted.map((d) => [d.id, d])) };
}

export function tagsPatch(tags: Tag[]): Pick<AppState, "tags" | "tagMap"> {
  const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));
  return { tags: sorted, tagMap: new Map(sorted.map((t) => [t.id, t])) };
}

/** Replaces (or adds) documents in state. */
export function putDocs(next: DocumentRecord[]): void {
  if (!next.length) return;
  setState((s) => {
    const map = new Map(s.docMap);
    next.forEach((d) => map.set(d.id, d));
    return docsPatch([...map.values()]);
  });
}

export function dropDocs(ids: readonly string[]): void {
  const gone = new Set(ids);
  setState((s) => ({
    ...docsPatch(s.docs.filter((d) => !gone.has(d.id))),
    dates: s.dates.filter((d) => !gone.has(d.docId)),
  }));
}

let toastSeq = 0;

export function toast(message: string, tone: Toast["tone"] = "info", action?: Toast["action"]): void {
  const id = `t${++toastSeq}`;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone, action }] }));
  setTimeout(() => dismissToast(id), tone === "error" ? 9000 : action ? 7000 : 4500);
}

export function dismissToast(id: string): void {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
