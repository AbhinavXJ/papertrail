import type { DateKind, Findings, FoundAmount, FoundDate } from "@/lib/types";
import { fold } from "@/lib/util";

/**
 * Finds dates and money amounts that are literally printed in a document's text.
 * Nothing is inferred or invented: every finding points at characters in the text, and the
 * surrounding words only produce a *hint* (e.g. "due" → bill due). The UI always presents
 * findings as unverified suggestions that the user can confirm.
 */

export type DateOrder = "mdy" | "dmy";

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?";

const RE_ISO = /(?<![\d.,/-])(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d]|[.,/-]\d)/g;
const RE_MDY_NAME = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi");
const RE_DMY_NAME = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?[\\s-]+${MONTH_RE},?[\\s-]+(\\d{4})\\b`, "gi");
const RE_NUMERIC = /(?<![\d.,/-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\d]|[.,/-]\d)/g;

function iso(y: number, m: number, d: number): string | null {
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** What the words just before a date suggest it is. */
export function dateHint(before: string): FoundDate["hint"] {
  const b = fold(before).replace(/\s+/g, " ");
  const tail = b.slice(-48);
  if (/warrant|guarantee|applecare|protection plan|coverage (?:ends|until)/.test(tail)) return "warranty";
  if (/renew/.test(tail)) return /polic|insur|premium|cover/.test(b) ? "insurance-renewal" : "subscription-renewal";
  if (/\bdue\b|pay by|payable by|payment date|due date/.test(tail)) return "bill-due";
  if (/expir|valid (?:until|thru|through|to)|exp\.? date|date of expiry/.test(tail)) return "document-expiry";
  if (/end date|ends on|\bends\b|terminat|lease end|term end|move.?out/.test(tail)) return "agreement-end";
  if (/invoice date|order date|date of issue|issue date|issued|purchase date|purchased|statement date|bill date|receipt date|transaction date|\bdated?\b|order placed/.test(tail)) return "issued";
  return null;
}

interface RawDate {
  index: number;
  length: number;
  date: string;
  ambiguous: boolean;
}

function collectDates(text: string, order: DateOrder): RawDate[] {
  const out: RawDate[] = [];
  const push = (m: RegExpExecArray, date: string | null, ambiguous = false) => {
    if (date) out.push({ index: m.index, length: m[0].length, date, ambiguous });
  };
  for (const m of text.matchAll(RE_ISO)) push(m, iso(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(RE_MDY_NAME)) push(m, iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  for (const m of text.matchAll(RE_DMY_NAME)) push(m, iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  for (const m of text.matchAll(RE_NUMERIC)) {
    const a = +m[1];
    const b = +m[3];
    if (m[4].length === 2 && m[2] !== "/") continue;
    const y = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    if (a > 12 && b <= 12) push(m, iso(y, b, a));
    else if (b > 12 && a <= 12) push(m, iso(y, a, b));
    else if (a <= 12 && b <= 12) push(m, order === "mdy" ? iso(y, a, b) : iso(y, b, a), a !== b);
  }
  // Drop matches nested inside a longer one (e.g. a numeric date inside an ISO timestamp).
  out.sort((x, y) => x.index - y.index || y.length - x.length);
  const kept: RawDate[] = [];
  for (const d of out) {
    const last = kept[kept.length - 1];
    if (last && d.index < last.index + last.length) continue;
    kept.push(d);
  }
  return kept;
}

export function findDates(text: string, order: DateOrder = "mdy", limit = 20): FoundDate[] {
  const out: FoundDate[] = [];
  const seen = new Set<string>();
  for (const r of collectDates(text, order)) {
    const lineStart = text.lastIndexOf("\n", r.index - 1) + 1;
    const before = text.slice(Math.max(lineStart, r.index - 60), r.index);
    const hint = dateHint(before.length >= 3 ? before : text.slice(Math.max(0, r.index - 60), r.index));
    const key = `${r.date}|${hint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ctxStart = Math.max(0, r.index - 48);
    const ctxEnd = Math.min(text.length, r.index + r.length + 16);
    out.push({
      date: r.date,
      display: text.slice(r.index, r.index + r.length),
      context: `${ctxStart > 0 ? "…" : ""}${text.slice(ctxStart, ctxEnd).replace(/\s+/g, " ").trim()}${ctxEnd < text.length ? "…" : ""}`,
      hint,
      ambiguous: r.ambiguous,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ── Amounts ────────────────────────────────────────────────────────────────

const CODES = "USD|EUR|GBP|INR|CAD|AUD|NZD|JPY|CHF|SEK|NOK|DKK|SGD|HKD|MXN|BRL|ZAR|CNY|AED";
const SYMBOLS: Record<string, string> = { $: "USD", "US$": "USD", "C$": "CAD", CA$: "CAD", A$: "AUD", AU$: "AUD", NZ$: "NZD", HK$: "HKD", S$: "SGD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", R$: "BRL" };
const NUM = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+(?:[.,]\\d{2})?)";
const RE_SYMBOL_BEFORE = new RegExp(`(US\\$|CA\\$|C\\$|AU\\$|A\\$|NZ\\$|HK\\$|S\\$|R\\$|\\$|€|£|¥|₹)\\s?${NUM}(?![\\d])`, "g");
const RE_CODE_BEFORE = new RegExp(`\\b(${CODES})\\s?${NUM}(?![\\d])`, "g");
const RE_AFTER = new RegExp(`(?<![\\d.,])${NUM}\\s?(€|£|\\b(?:${CODES})\\b)`, "g");
const RE_LABELED = /\b(grand total|total due|total|amount due|balance due|amount payable|subtotal|premium|monthly rent|rent)\b\s*:?\s*(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d])/gi;

const LABELS: Array<[RegExp, string]> = [
  [/grand total/, "Grand total"],
  [/total due|amount due|balance due|amount payable/, "Amount due"],
  [/subtotal/, "Subtotal"],
  [/\btotal\b/, "Total"],
  [/\b(?:sales )?tax\b|\bvat\b|\bgst\b/, "Tax"],
  [/premium/, "Premium"],
  [/deposit/, "Deposit"],
  [/\brent\b/, "Rent"],
  [/\bpaid\b|payment/, "Paid"],
  [/\bprice\b/, "Price"],
];

function parseNumber(s: string): number {
  if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^\d+,\d{2}$/.test(s)) return Number(s.replace(",", "."));
  return Number(s.replace(/,/g, ""));
}

function labelBefore(text: string, index: number): string | null {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const before = fold(text.slice(Math.max(lineStart, index - 32), index));
  for (const [re, label] of LABELS) if (re.test(before)) return label;
  return null;
}

export function findAmounts(text: string, limit = 12): FoundAmount[] {
  const raw: Array<{ index: number; length: number; value: number; currency: string | null; display: string }> = [];
  for (const m of text.matchAll(RE_SYMBOL_BEFORE)) raw.push({ index: m.index, length: m[0].length, value: parseNumber(m[2]), currency: SYMBOLS[m[1]] ?? null, display: m[0] });
  for (const m of text.matchAll(RE_CODE_BEFORE)) raw.push({ index: m.index, length: m[0].length, value: parseNumber(m[2]), currency: m[1], display: m[0] });
  for (const m of text.matchAll(RE_AFTER)) raw.push({ index: m.index, length: m[0].length, value: parseNumber(m[1]), currency: SYMBOLS[m[2]] ?? m[2], display: m[0] });
  for (const m of text.matchAll(RE_LABELED)) {
    const at = m.index + m[0].lastIndexOf(m[2]);
    raw.push({ index: at, length: m[2].length, value: parseNumber(m[2]), currency: null, display: m[2] });
  }
  raw.sort((a, b) => a.index - b.index || b.length - a.length);
  const out: FoundAmount[] = [];
  const seen = new Set<string>();
  let lastEnd = -1;
  for (const r of raw) {
    if (r.index < lastEnd || !Number.isFinite(r.value) || r.value <= 0) continue;
    lastEnd = r.index + r.length;
    const label = labelBefore(text, r.index);
    const key = `${r.value}|${r.currency}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value: r.value, currency: r.currency, display: r.display.replace(/\s+/g, " ").trim(), label });
    if (out.length >= limit) break;
  }
  return out;
}

export function extractFindings(text: string, order: DateOrder = "mdy"): Findings {
  return { dates: findDates(text, order), amounts: findAmounts(text) };
}

/** A printed date that is probably the document's own date (issue/purchase date). Never a guess between several. */
export function suggestDocumentDate(findings: Findings | null): string | null {
  if (!findings?.dates.length) return null;
  const issued = findings.dates.find((d) => d.hint === "issued" && !d.ambiguous);
  if (issued) return issued.date;
  const unique = new Set(findings.dates.map((d) => d.date));
  const only = findings.dates[0];
  return unique.size === 1 && !only.ambiguous && only.hint === null ? only.date : null;
}

/** The most likely "total" amount, if one is labeled as such. */
export function primaryAmount(findings: Findings | null): FoundAmount | null {
  const a = findings?.amounts ?? [];
  const pick = (label: string) => [...a].reverse().find((x) => x.label === label);
  return pick("Grand total") ?? pick("Amount due") ?? pick("Total") ?? pick("Premium") ?? null;
}

export function preferredDateOrder(locale?: string): DateOrder {
  const l = locale ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
  return /^en-(US|PH)|^en$/i.test(l) ? "mdy" : "dmy";
}

export const HINT_TO_KIND: Record<NonNullable<FoundDate["hint"]>, DateKind | null> = {
  warranty: "warranty",
  "insurance-renewal": "insurance-renewal",
  "agreement-end": "agreement-end",
  "bill-due": "bill-due",
  "subscription-renewal": "subscription-renewal",
  "document-expiry": "document-expiry",
  other: "other",
  issued: null,
};
