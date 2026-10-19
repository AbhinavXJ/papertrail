import { openDatabase, type DB } from "@/lib/db/schema";
import type { Tag } from "@/lib/types";
import { SearchIndex, type SearchResult, type Snippet } from "./engine";
import { toIndexable, type IndexContext } from "./document";
import type { HighlightSpec } from "./tokenize";

/**
 * Owns the in-memory index for one workspace and keeps it in step with IndexedDB.
 * Runs inside the search worker (or on the main thread when workers are unavailable).
 * It reads the database itself, so document text never has to be posted between threads.
 */
export class SearchHost {
  private index = new SearchIndex();
  private db: DB | null = null;
  private dbName: string | null = null;

  constructor(private readonly opener?: (name: string) => Promise<DB>) {}

  private async conn(): Promise<DB> {
    if (!this.dbName) throw new Error("Search index not initialised");
    this.db ??= await (this.opener ? this.opener(this.dbName) : openDatabase(this.dbName, { onClosed: () => (this.db = null) }));
    return this.db;
  }

  private async context(db: DB): Promise<IndexContext> {
    const [tags, categories, dates] = await Promise.all([db.getAll("tags"), db.getAll("categories"), db.getAll("dates")]);
    return { tags: new Map<string, Tag>(tags.map((t) => [t.id, t])), categories, dates };
  }

  /** (Re)builds the whole index from storage. */
  async init(dbName: string): Promise<{ count: number; ms: number }> {
    const t0 = Date.now();
    if (this.dbName !== dbName) {
      this.db?.close();
      this.db = null;
      this.dbName = dbName;
    }
    const db = await this.conn();
    const [docs, texts, ctx] = await Promise.all([db.getAll("documents"), db.getAll("texts"), this.context(db)]);
    const byId = new Map(texts.map((t) => [t.id, t]));
    this.index.clear();
    for (const d of docs) this.index.add(toIndexable(d, byId.get(d.id), ctx));
    return { count: this.index.size, ms: Date.now() - t0 };
  }

  /** Re-reads the given documents; ids that no longer exist are dropped from the index. */
  async upsert(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const db = await this.conn();
    const ctx = await this.context(db);
    for (const id of ids) {
      const [doc, text] = await Promise.all([db.get("documents", id), db.get("texts", id)]);
      if (doc) this.index.add(toIndexable(doc, text, ctx));
      else this.index.remove(id);
    }
  }

  remove(ids: readonly string[]): void {
    ids.forEach((id) => this.index.remove(id));
  }

  query(q: string, allowed: readonly string[] | null): SearchResult {
    return this.index.search(q, { allowed });
  }

  snippets(ids: readonly string[], spec: HighlightSpec): Record<string, Snippet | null> {
    const out: Record<string, Snippet | null> = {};
    for (const id of ids) out[id] = this.index.snippet(id, spec);
    return out;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  get size(): number {
    return this.index.size;
  }
}
