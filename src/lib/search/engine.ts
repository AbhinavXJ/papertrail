import { tokenize, terms as toTerms, type HighlightSpec, type Segment, type Token } from "./tokenize";

/**
 * A small, dependency-free full-text index (BM25F ranking) tuned for a personal library:
 * - fields are weighted (title ≫ tags > file name > notes/category > metadata > body text)
 * - every word must match (AND); if nothing matches every word, documents matching some words
 *   are returned and flagged with `matchedAll: false`
 * - the word being typed matches as a prefix ("warr" → "warranty")
 * - `"quoted phrases"` and joined tokens (INV-2026-0042, 1,299.00) must appear in order
 * - an unknown word of 4+ letters falls back to close spellings (one or two typos)
 * It is deliberately lexical: it finds words that are in the documents, nothing more.
 */

export const FIELDS = ["title", "fileName", "tags", "category", "notes", "meta", "body"] as const;
export type FieldName = (typeof FIELDS)[number];
const NF = FIELDS.length;
const BOOST = [6, 3, 4, 2.5, 2.5, 1.5, 1];
const BODY = FIELDS.indexOf("body");
const NOTES = FIELDS.indexOf("notes");
const K1 = 1.2;
const B = 0.75;
const MAX_PREFIX_EXPANSIONS = 60;
const MAX_FUZZY_EXPANSIONS = 8;
const TOKEN_CACHE = 48;

export interface IndexableDoc {
  id: string;
  fields: Record<FieldName, string>;
  pageOffsets?: number[];
}

interface DocState {
  id: string;
  num: number;
  fields: string[];
  lengths: number[];
  terms: string[];
  pageOffsets?: number[];
}

export interface QueryGroup {
  /** Normalized terms; more than one means they must appear consecutively. */
  terms: string[];
  /** The last term may still be being typed. */
  prefixLast: boolean;
  quoted: boolean;
}

interface Expansion {
  term: string;
  weight: number;
}

export interface SearchHit {
  id: string;
  score: number;
  fields: FieldName[];
}

export interface SearchResult {
  hits: SearchHit[];
  /** False when no document contained every word and partial matches are returned instead. */
  matchedAll: boolean;
  /** Some words had no exact match and were matched to similar spellings. */
  fuzzy: boolean;
  spec: HighlightSpec;
}

export interface Snippet {
  field: "body" | "notes";
  segments: Segment[];
  /** 1-based page number for PDFs. */
  page: number | null;
  /** Number of matching words in that field. */
  hits: number;
}

export function parseQuery(q: string): QueryGroup[] {
  const groups: QueryGroup[] = [];
  const endsWithSpace = /\s$/.test(q);
  const re = /"([^"]*)("?)|(\S+)/g;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    const quoted = m[1] !== undefined;
    const ts = toTerms(quoted ? m[1] : m[3]);
    if (!ts.length) continue;
    const atEnd = re.lastIndex >= q.length && !endsWithSpace;
    const unterminated = quoted && m[2] !== '"';
    const prefixLast = atEnd && (!quoted || unterminated);
    const key = ts.join(" ");
    if (groups.some((g) => g.terms.join(" ") === key && g.prefixLast === prefixLast)) continue;
    groups.push({ terms: ts, quoted, prefixLast });
  }
  return groups;
}

/**
 * Singular/plural forms of an English word ("warranty" ↔ "warranties", "receipt" ↔ "receipts").
 * Deliberately conservative — no general stemming, so unrelated words don't match.
 */
export function wordVariants(t: string): string[] {
  if (t.length < 3 || /\d/.test(t) || !/^[a-z]+$/.test(t)) return [];
  const v = new Set<string>();
  if (t.endsWith("ies") && t.length > 4) v.add(`${t.slice(0, -3)}y`);
  else if (/(ch|sh|ss|x|z)es$/.test(t)) v.add(t.slice(0, -2));
  else if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is") && t.length > 3) v.add(t.slice(0, -1));
  if (!t.endsWith("s") || t.endsWith("ss")) {
    if (/[^aeiou]y$/.test(t)) v.add(`${t.slice(0, -1)}ies`);
    else if (/(ch|sh|ss|x|z)$/.test(t)) v.add(`${t}es`);
    else v.add(`${t}s`);
  }
  v.delete(t);
  return [...v];
}

/** Damerau–Levenshtein distance with an early exit once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

export class SearchIndex {
  private byNum = new Map<number, DocState>();
  private byId = new Map<string, number>();
  /** term → flat [docNum, field, tf, docNum, field, tf, …] */
  private postings = new Map<string, number[]>();
  /** term → number of documents containing it */
  private df = new Map<string, number>();
  private fieldTotals = new Array<number>(NF).fill(0);
  private nextNum = 1;
  private sortedVocab: string[] | null = null;
  private tokenCache = new Map<string, Token[]>();

  get size(): number {
    return this.byNum.size;
  }

  get vocabularySize(): number {
    return this.df.size;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  clear(): void {
    this.byNum.clear();
    this.byId.clear();
    this.postings.clear();
    this.df.clear();
    this.fieldTotals.fill(0);
    this.sortedVocab = null;
    this.tokenCache.clear();
  }

  /** Adds or replaces a document. */
  add(doc: IndexableDoc): void {
    if (this.byId.has(doc.id)) this.remove(doc.id);
    const num = this.nextNum++;
    const fields = FIELDS.map((f) => doc.fields[f] ?? "");
    const lengths = new Array<number>(NF).fill(0);
    const perTerm = new Map<string, number[]>();
    fields.forEach((text, f) => {
      const toks = tokenize(text);
      lengths[f] = toks.length;
      this.fieldTotals[f] += toks.length;
      for (const t of toks) {
        let tf = perTerm.get(t.term);
        if (!tf) perTerm.set(t.term, (tf = new Array<number>(NF).fill(0)));
        tf[f]++;
      }
    });
    for (const [term, tf] of perTerm) {
      let p = this.postings.get(term);
      if (!p) {
        this.postings.set(term, (p = []));
        this.sortedVocab = null;
      }
      for (let f = 0; f < NF; f++) if (tf[f]) p.push(num, f, tf[f]);
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
    const state: DocState = { id: doc.id, num, fields, lengths, terms: [...perTerm.keys()], pageOffsets: doc.pageOffsets };
    this.byNum.set(num, state);
    this.byId.set(doc.id, num);
  }

  remove(id: string): boolean {
    const num = this.byId.get(id);
    if (num === undefined) return false;
    const state = this.byNum.get(num)!;
    for (const term of state.terms) {
      const p = this.postings.get(term);
      if (p) {
        const kept: number[] = [];
        for (let i = 0; i < p.length; i += 3) if (p[i] !== num) kept.push(p[i], p[i + 1], p[i + 2]);
        if (kept.length) this.postings.set(term, kept);
        else {
          this.postings.delete(term);
          this.sortedVocab = null;
        }
      }
      const n = (this.df.get(term) ?? 1) - 1;
      if (n > 0) this.df.set(term, n);
      else this.df.delete(term);
    }
    state.lengths.forEach((l, f) => (this.fieldTotals[f] -= l));
    this.byNum.delete(num);
    this.byId.delete(id);
    this.tokenCache.forEach((_, k) => k.startsWith(`${num}:`) && this.tokenCache.delete(k));
    return true;
  }

  private vocab(): string[] {
    if (!this.sortedVocab) this.sortedVocab = [...this.postings.keys()].sort();
    return this.sortedVocab;
  }

  private expand(term: string, prefix: boolean): { list: Expansion[]; fuzzy: boolean } {
    const list: Expansion[] = [];
    if (this.df.has(term)) list.push({ term, weight: 1 });
    for (const v of wordVariants(term)) if (this.df.has(v)) list.push({ term: v, weight: 0.9 });
    if (prefix && term.length >= 2) {
      const vocab = this.vocab();
      let lo = 0;
      let hi = vocab.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (vocab[mid] < term) lo = mid + 1;
        else hi = mid;
      }
      const found: string[] = [];
      for (let i = lo; i < vocab.length && vocab[i].startsWith(term); i++) if (!list.some((e) => e.term === vocab[i])) found.push(vocab[i]);
      found
        .sort((a, b) => (this.df.get(b) ?? 0) - (this.df.get(a) ?? 0) || a.length - b.length)
        .slice(0, MAX_PREFIX_EXPANSIONS)
        .forEach((t) => list.push({ term: t, weight: 0.8 }));
    }
    if (list.length || term.length < 4 || /^\d+$/.test(term)) return { list, fuzzy: false };
    const max = term.length >= 8 ? 2 : 1;
    const close: Array<{ term: string; d: number }> = [];
    for (const v of this.vocab()) {
      if (Math.abs(v.length - term.length) > max || v[0] !== term[0]) continue;
      const d = editDistance(term, v, max);
      if (d <= max) close.push({ term: v, d });
    }
    close
      .sort((a, b) => a.d - b.d || (this.df.get(b.term) ?? 0) - (this.df.get(a.term) ?? 0))
      .slice(0, MAX_FUZZY_EXPANSIONS)
      .forEach((c) => list.push({ term: c.term, weight: c.d === 1 ? 0.5 : 0.3 }));
    return { list, fuzzy: close.length > 0 };
  }

  /** BM25F contribution of one vocabulary term to every document containing it. */
  private scoreTerm(term: string, weight: number, allowed: Set<number> | null, into: Map<number, { score: number; fields: number }>): void {
    const p = this.postings.get(term);
    if (!p) return;
    const N = this.byNum.size;
    const n = this.df.get(term) ?? 0;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    for (let i = 0; i < p.length; i += 3) {
      const d = p[i];
      if (allowed && !allowed.has(d)) continue;
      const f = p[i + 1];
      const tf = p[i + 2];
      const doc = this.byNum.get(d)!;
      const avg = Math.max(1, this.fieldTotals[f] / N);
      const s = (BOOST[f] * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.lengths[f]) / avg));
      const acc = into.get(d);
      if (acc) {
        acc.score += s * idf * weight;
        acc.fields |= 1 << f;
      } else into.set(d, { score: s * idf * weight, fields: 1 << f });
    }
  }

  private tokens(doc: DocState, f: number): Token[] {
    const key = `${doc.num}:${f}`;
    let t = this.tokenCache.get(key);
    if (t) {
      this.tokenCache.delete(key);
      this.tokenCache.set(key, t);
      return t;
    }
    t = tokenize(doc.fields[f]);
    this.tokenCache.set(key, t);
    if (this.tokenCache.size > TOKEN_CACHE) this.tokenCache.delete(this.tokenCache.keys().next().value!);
    return t;
  }

  /** Bitmask of fields in which the term sequence appears consecutively. */
  private phraseFields(doc: DocState, seq: Array<Set<string>>): number {
    let mask = 0;
    for (let f = 0; f < NF; f++) {
      if (!doc.lengths[f] || doc.lengths[f] < seq.length) continue;
      const toks = this.tokens(doc, f);
      outer: for (let i = 0; i + seq.length <= toks.length; i++) {
        for (let k = 0; k < seq.length; k++) if (!seq[k].has(toks[i + k].term)) continue outer;
        mask |= 1 << f;
        break;
      }
    }
    return mask;
  }

  search(query: string | QueryGroup[], opts: { allowed?: Iterable<string> | null; limit?: number } = {}): SearchResult {
    const groups = typeof query === "string" ? parseQuery(query) : query;
    const spec: HighlightSpec = { terms: [], prefixes: [] };
    if (!groups.length || !this.byNum.size) return { hits: [], matchedAll: true, fuzzy: false, spec };

    let allowed: Set<number> | null = null;
    if (opts.allowed) {
      allowed = new Set<number>();
      for (const id of opts.allowed) {
        const n = this.byId.get(id);
        if (n !== undefined) allowed.add(n);
      }
    }

    let fuzzy = false;
    const specTerms = new Set<string>();
    const groupScores: Array<Map<number, { score: number; fields: number }>> = [];
    const groupSets: Array<Array<Set<string>>> = [];

    for (const g of groups) {
      const perTerm = g.terms.map((t, i) => {
        const prefix = g.prefixLast && i === g.terms.length - 1;
        const { list, fuzzy: fz } = this.expand(t, prefix);
        fuzzy ||= fz;
        if (prefix && t.length >= 2) spec.prefixes.push(t);
        list.forEach((e) => specTerms.add(e.term));
        return list;
      });
      groupSets.push(perTerm.map((l) => new Set(l.map((e) => e.term))));
      // Per term: best weighted score per document across its expansions.
      const termMaps = perTerm.map((list) => {
        const best = new Map<number, { score: number; fields: number }>();
        for (const e of list) {
          const m = new Map<number, { score: number; fields: number }>();
          this.scoreTerm(e.term, e.weight, allowed, m);
          for (const [d, v] of m) {
            const cur = best.get(d);
            if (!cur) best.set(d, v);
            else {
              cur.fields |= v.fields;
              if (v.score > cur.score) cur.score = v.score;
            }
          }
        }
        return best;
      });
      const combined = new Map<number, { score: number; fields: number }>();
      if (termMaps.length === 1) termMaps[0].forEach((v, d) => combined.set(d, { ...v }));
      else {
        const [first, ...rest] = [...termMaps].sort((a, b) => a.size - b.size);
        for (const [d, v] of first) {
          if (!rest.every((m) => m.has(d))) continue;
          const doc = this.byNum.get(d)!;
          const mask = this.phraseFields(doc, groupSets[groupSets.length - 1]);
          if (!mask) continue;
          const score = termMaps.reduce((s, m) => s + m.get(d)!.score, 0) * 1.2;
          combined.set(d, { score, fields: mask | v.fields });
        }
      }
      groupScores.push(combined);
    }
    spec.terms = [...specTerms];

    const totals = new Map<number, { score: number; fields: number; matched: number }>();
    groupScores.forEach((m) => {
      for (const [d, v] of m) {
        const t = totals.get(d);
        if (t) {
          t.score += v.score;
          t.fields |= v.fields;
          t.matched++;
        } else totals.set(d, { score: v.score, fields: v.fields, matched: 1 });
      }
    });

    const G = groups.length;
    let entries = [...totals].filter(([, t]) => t.matched === G);
    let matchedAll = true;
    if (!entries.length && G > 1) {
      matchedAll = false;
      entries = [...totals].map(([d, t]) => [d, { ...t, score: t.score * (t.matched / G) }] as typeof entries[number]);
    }

    entries.sort((a, b) => (matchedAll ? 0 : b[1].matched - a[1].matched) || b[1].score - a[1].score || b[0] - a[0]);

    // Proximity bonus: separate words that also appear side by side rank higher.
    if (matchedAll && G > 1 && groups.every((g) => g.terms.length === 1)) {
      const seq = groupSets.map((s) => s[0]);
      const top = entries.slice(0, 50);
      for (const e of top) if (this.phraseFields(this.byNum.get(e[0])!, seq)) e[1].score *= 1.25;
      top.sort((a, b) => b[1].score - a[1].score || b[0] - a[0]);
      entries = [...top, ...entries.slice(50)];
    }

    const limit = opts.limit ?? Infinity;
    const hits = entries.slice(0, limit).map(([d, t]) => ({
      id: this.byNum.get(d)!.id,
      score: t.score,
      fields: FIELDS.filter((_, f) => t.fields & (1 << f)),
    }));
    return { hits, matchedAll, fuzzy, spec };
  }

  /** The most relevant passage of a document's text or notes for a highlight spec. */
  snippet(id: string, spec: HighlightSpec, maxChars = 200): Snippet | null {
    const num = this.byId.get(id);
    if (num === undefined) return null;
    const doc = this.byNum.get(num)!;
    const termSet = new Set(spec.terms);
    const keyOf = (term: string): string | null => {
      if (termSet.has(term)) {
        for (const p of spec.prefixes) if (term.startsWith(p)) return p;
        return term;
      }
      for (const p of spec.prefixes) if (term.startsWith(p)) return p;
      return null;
    };
    for (const f of [BODY, NOTES]) {
      if (!doc.lengths[f]) continue;
      const toks = this.tokens(doc, f);
      const hits: Array<{ i: number; key: string }> = [];
      toks.forEach((t, i) => {
        const k = keyOf(t.term);
        if (k) hits.push({ i, key: k });
      });
      if (!hits.length) continue;

      // Window of ≤ 24 tokens covering the most distinct query words.
      let best = { a: 0, b: 0, distinct: 0, count: 0 };
      const counts = new Map<string, number>();
      let a = 0;
      for (let b = 0; b < hits.length; b++) {
        counts.set(hits[b].key, (counts.get(hits[b].key) ?? 0) + 1);
        while (hits[b].i - hits[a].i > 24) {
          const k = hits[a].key;
          const c = counts.get(k)! - 1;
          if (c) counts.set(k, c);
          else counts.delete(k);
          a++;
        }
        const distinct = counts.size;
        const count = b - a + 1;
        if (distinct > best.distinct || (distinct === best.distinct && count > best.count)) best = { a, b, distinct, count };
      }

      const text = doc.fields[f];
      const ws = toks[hits[best.a].i].start;
      const we = toks[hits[best.b].i].end;
      const pad = Math.max(24, Math.floor((maxChars - (we - ws)) / 2));
      let start = Math.max(0, ws - pad);
      let end = Math.min(text.length, we + pad);
      if (start > 0) {
        const sp = text.slice(start, ws).search(/\s/);
        if (sp >= 0) start += sp + 1;
      }
      if (end < text.length) {
        const tail = text.slice(we, end);
        const sp = Math.max(tail.lastIndexOf(" "), tail.lastIndexOf("\n"));
        if (sp >= 0) end = we + sp;
      }
      const segments: Segment[] = [];
      const clean = (s: string) => s.replace(/\s+/g, " ");
      if (start > 0) segments.push(["…", false]);
      let pos = start;
      for (const h of hits) {
        const t = toks[h.i];
        if (t.start < start || t.end > end) continue;
        if (t.start > pos) segments.push([clean(text.slice(pos, t.start)), false]);
        segments.push([text.slice(t.start, t.end), true]);
        pos = t.end;
      }
      if (pos < end) segments.push([clean(text.slice(pos, end)), false]);
      if (end < text.length) segments.push(["…", false]);
      if (segments.length && !segments[0][1]) segments[0][0] = segments[0][0].replace(/^\s+/, "");

      let page: number | null = null;
      if (f === BODY && doc.pageOffsets?.length) {
        page = 1;
        for (let i = 0; i < doc.pageOffsets.length; i++) if (doc.pageOffsets[i] <= ws) page = i + 1;
      }
      return { field: f === BODY ? "body" : "notes", segments, page, hits: hits.length };
    }
    return null;
  }
}
