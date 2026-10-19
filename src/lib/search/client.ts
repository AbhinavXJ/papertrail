import type { SearchResult, Snippet } from "./engine";
import type { HighlightSpec } from "./tokenize";
import { SearchHost } from "./host";

export interface SearchService {
  init(dbName: string): Promise<{ count: number; ms: number }>;
  upsert(ids: readonly string[]): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  query(q: string, allowed: readonly string[] | null): Promise<SearchResult>;
  snippets(ids: readonly string[], spec: HighlightSpec): Promise<Record<string, Snippet | null>>;
  close(): Promise<void>;
}

/** Runs the index in a Web Worker so indexing and searching never block typing or scrolling. */
function workerService(): SearchService {
  const worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module", name: "papertrail-search" });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = () => {
    pending.forEach((p) => p.reject(new Error("The search worker stopped.")));
    pending.clear();
  };
  const call = <T>(method: string, ...args: unknown[]) =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, method, args });
    });
  return {
    init: (n) => call("init", n),
    upsert: (ids) => call("upsert", [...ids]),
    remove: (ids) => call("remove", [...ids]),
    query: (q, allowed) => call("query", q, allowed ? [...allowed] : null),
    snippets: (ids, spec) => call("snippets", [...ids], spec),
    close: async () => {
      await call("close").catch(() => undefined);
      worker.terminate();
    },
  };
}

function inlineService(): SearchService {
  const host = new SearchHost();
  return {
    init: (n) => host.init(n),
    upsert: (ids) => host.upsert(ids),
    remove: async (ids) => host.remove(ids),
    query: async (q, allowed) => host.query(q, allowed),
    snippets: async (ids, spec) => host.snippets(ids, spec),
    close: async () => host.close(),
  };
}

export function createSearchService(): SearchService {
  if (typeof Worker !== "undefined") {
    try {
      return workerService();
    } catch {
      // Fall through: some embedded browsers forbid module workers.
    }
  }
  return inlineService();
}
