import type { CategorySource, Rule } from "@/lib/types";
import { fold } from "@/lib/util";
import { terms } from "@/lib/search/tokenize";

/**
 * Transparent, local category suggestions. Each built-in category has a list of words and
 * phrases; a document scores points for each one it contains (more for the file name).
 * The result always carries the words that triggered it so the UI can say *why*.
 * Nothing here "understands" a document — it only counts words.
 */
const KEYWORDS: Record<string, Array<[phrase: string, weight: number]>> = {
  receipts: [
    ["receipt", 3], ["order confirmation", 3], ["order number", 2], ["order", 1], ["purchase", 2], ["purchased", 2], ["subtotal", 2],
    ["invoice", 2], ["paid", 1], ["payment method", 2], ["cashier", 2], ["qty", 1], ["thank you for your purchase", 3],
    ["thank you for shopping", 3], ["store", 1], ["sales tax", 1], ["vat", 1], ["change due", 2], ["visa", 1], ["mastercard", 1],
  ],
  bills: [
    ["bill", 2], ["utility", 3], ["utilities", 3], ["electricity", 3], ["electric", 2], ["energy", 1], ["kwh", 3], ["meter", 2], ["gas", 1],
    ["water", 1], ["sewer", 2], ["internet", 2], ["broadband", 3], ["mobile plan", 2], ["phone bill", 3], ["amount due", 3],
    ["due date", 2], ["billing period", 3], ["statement date", 1], ["account number", 1], ["service address", 2], ["usage", 1],
  ],
  warranties: [
    ["warranty", 4], ["guarantee", 3], ["limited warranty", 3], ["manual", 3], ["user guide", 3], ["owner s manual", 3],
    ["instructions", 2], ["serial number", 3], ["model number", 2], ["product registration", 3], ["applecare", 4],
    ["extended protection", 3], ["troubleshooting", 2], ["safety instructions", 2],
  ],
  insurance: [
    ["insurance", 4], ["policy", 2], ["policyholder", 4], ["policy number", 3], ["premium", 2], ["coverage", 2], ["insured", 3],
    ["deductible", 3], ["claim", 1], ["underwritten", 3], ["renewal", 1], ["insurer", 3], ["liability", 1],
  ],
  financial: [
    ["bank", 2], ["bank statement", 4], ["account statement", 3], ["tax", 2], ["tax return", 4], ["irs", 3], ["w 2", 3], ["1099", 3],
    ["payslip", 4], ["pay slip", 4], ["salary", 2], ["investment", 2], ["brokerage", 3], ["dividend", 2], ["pension", 3],
    ["loan", 2], ["interest rate", 2], ["credit card statement", 4], ["balance", 1], ["iban", 2], ["portfolio", 2],
  ],
  property: [
    ["lease", 4], ["lease agreement", 4], ["rental agreement", 4], ["tenancy", 4], ["landlord", 4], ["tenant", 4], ["rent", 2],
    ["property", 2], ["deed", 3], ["mortgage", 3], ["hoa", 2], ["apartment", 2], ["security deposit", 3], ["premises", 2],
  ],
  identity: [
    ["passport", 4], ["visa application", 3], ["driver s license", 4], ["drivers license", 4], ["driving licence", 4],
    ["identity card", 4], ["id card", 3], ["birth certificate", 4], ["boarding pass", 4], ["itinerary", 3], ["flight", 2],
    ["booking reference", 3], ["hotel", 2], ["reservation", 2], ["check in", 1], ["travel", 2], ["e ticket", 3],
  ],
};

export interface Suggestion {
  categoryId: string;
  score: number;
  reasons: string[];
}

/** Space-padded token string so phrases only match on whole words. */
function wordString(s: string): string {
  return ` ${terms(s).join(" ")} `;
}

function countPhrase(hay: string, phrase: string, cap: number): number {
  const needle = ` ${phrase} `;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < cap; i = hay.indexOf(needle, i + needle.length - 1)) n++;
  return n;
}

export function suggestCategory(fileName: string, text: string): Suggestion | null {
  const name = wordString(fileName.replace(/\.[^.]+$/, ""));
  const body = wordString(text.slice(0, 20000));
  const scored: Suggestion[] = [];
  for (const [categoryId, words] of Object.entries(KEYWORDS)) {
    let score = 0;
    const found: Array<[string, number]> = [];
    for (const [phrase, weight] of words) {
      const inName = countPhrase(name, phrase, 1);
      const inBody = countPhrase(body, phrase, 3);
      const s = weight * (inName * 2 + Math.min(inBody, 3) * (inBody > 1 ? 0.6 : 1));
      if (s > 0) {
        score += s;
        found.push([phrase, s]);
      }
    }
    if (score > 0)
      scored.push({
        categoryId,
        score,
        reasons: found
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([p]) => `“${p.replace(/ s /g, "’s ")}”`),
      });
  }
  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < 4) return null;
  if (second && best.score < second.score * 1.4) return null;
  return best;
}

export interface Classification {
  categoryId: string | null;
  categorySource: CategorySource | null;
  categoryReasons: string[];
  /** Tags added by rules. */
  tagIds: string[];
}

export function ruleMatches(rule: Rule, fileName: string, text: string): boolean {
  const needle = fold(rule.contains).trim();
  if (!needle) return false;
  const inName = fold(fileName).includes(needle);
  if (rule.field === "filename") return inName;
  const inText = fold(text).includes(needle);
  return rule.field === "text" ? inText : inName || inText;
}

/**
 * User rules win over heuristics. A category the user picked by hand is never replaced:
 * pass `current` so it can be kept.
 */
export function classify(
  input: { fileName: string; text: string; rules: readonly Rule[] },
  current?: { categoryId: string | null; categorySource: CategorySource | null },
): Classification {
  const tagIds: string[] = [];
  let ruleCategory: { id: string; reason: string } | null = null;
  for (const r of [...input.rules].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!ruleMatches(r, input.fileName, input.text)) continue;
    if (r.tagId && !tagIds.includes(r.tagId)) tagIds.push(r.tagId);
    if (r.categoryId && !ruleCategory) ruleCategory = { id: r.categoryId, reason: `${r.field === "filename" ? "file name" : r.field === "text" ? "text" : "file name or text"} contains “${r.contains}”` };
  }
  if (current?.categorySource === "user") return { categoryId: current.categoryId, categorySource: "user", categoryReasons: [], tagIds };
  if (ruleCategory) return { categoryId: ruleCategory.id, categorySource: "rule", categoryReasons: [ruleCategory.reason], tagIds };
  const s = suggestCategory(input.fileName, input.text);
  if (s) return { categoryId: s.categoryId, categorySource: "suggested", categoryReasons: s.reasons, tagIds };
  return { categoryId: null, categorySource: null, categoryReasons: [], tagIds };
}
