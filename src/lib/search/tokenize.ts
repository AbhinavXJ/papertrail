import { fold } from "@/lib/util";

export interface Token {
  /** Normalized (lowercased, accent-folded) form used for matching. */
  term: string;
  /** Offsets into the original string. */
  start: number;
  end: number;
}

// Han / Kana are written without spaces, so each character is its own token; phrase
// matching then finds multi-character words. Everything else splits on non-letter/number.
const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;
const MAX_TOKEN = 64;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  if (!text) return out;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const raw = m[0];
    if (raw.length > MAX_TOKEN) continue;
    const term = fold(raw);
    if (term) out.push({ term, start: m.index, end: m.index + raw.length });
  }
  return out;
}

export function terms(text: string): string[] {
  return tokenize(text).map((t) => t.term);
}

/** What to highlight for a query: exact vocabulary terms plus prefixes still being typed. */
export interface HighlightSpec {
  terms: string[];
  prefixes: string[];
}

export const EMPTY_SPEC: HighlightSpec = { terms: [], prefixes: [] };

export function matchesSpec(term: string, spec: HighlightSpec, termSet?: Set<string>): boolean {
  if ((termSet ?? new Set(spec.terms)).has(term)) return true;
  for (const p of spec.prefixes) if (term.startsWith(p)) return true;
  return false;
}

export type Segment = [text: string, hit: boolean];

/** Splits `text` into plain and highlighted runs according to `spec`. */
export function highlightSegments(text: string, spec: HighlightSpec): Segment[] {
  if (!text) return [];
  if (!spec.terms.length && !spec.prefixes.length) return [[text, false]];
  const set = new Set(spec.terms);
  const out: Segment[] = [];
  let pos = 0;
  for (const t of tokenize(text)) {
    if (!matchesSpec(t.term, spec, set)) continue;
    if (t.start > pos) out.push([text.slice(pos, t.start), false]);
    out.push([text.slice(t.start, t.end), true]);
    pos = t.end;
  }
  if (pos < text.length) out.push([text.slice(pos), false]);
  return out;
}

/** Character ranges [start, end) of every highlighted token in `text`. */
export function highlightRanges(text: string, spec: HighlightSpec): Array<[number, number]> {
  const set = new Set(spec.terms);
  return tokenize(text)
    .filter((t) => matchesSpec(t.term, spec, set))
    .map((t) => [t.start, t.end] as [number, number]);
}
