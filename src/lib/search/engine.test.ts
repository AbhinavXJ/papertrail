import { describe, expect, it } from "vitest";
import { SearchIndex, editDistance, parseQuery, wordVariants } from "./engine";
import { highlightSegments, tokenize } from "./tokenize";
import { indexable } from "@/test/fixtures";

function library() {
  const idx = new SearchIndex();
  idx.add(indexable("lease", { title: "Apartment lease", fileName: "lease-14-elm", body: "This residential lease agreement is made between the landlord and the tenant. The security deposit is $2,150.00. The term ends on June 30, 2027." }));
  idx.add(indexable("bill", { title: "Electricity bill October", fileName: "northside-energy-oct", body: "Amount due $86.40. Payment due date November 12, 2026. Meter reading 4,512 kWh." }));
  idx.add(
    indexable(
      "laptop",
      { title: "Laptop receipt", fileName: "order-58213", tags: "electronics", body: "Order number INV-2026-0042\nAero 14 laptop, serial number C02XK1\nLimited warranty: one year from purchase.\n\nPage two: extended protection plan." },
      [0, 103],
    ),
  );
  idx.add(indexable("note", { title: "Passport checklist", notes: "Renew before the trip to Lisbon", body: "Passport expires March 3, 2027. Bring two photos." }));
  return idx;
}

describe("tokenize", () => {
  it("folds case, accents and ligatures, keeping original offsets", () => {
    const text = "Résumé ﬁnal";
    const toks = tokenize(text);
    expect(toks.map((t) => t.term)).toEqual(["resume", "final"]);
    expect(text.slice(toks[1].start, toks[1].end)).toBe("ﬁnal");
  });
  it("splits CJK into characters", () => {
    expect(tokenize("保証書").map((t) => t.term)).toEqual(["保", "証", "書"]);
  });
});

describe("parseQuery", () => {
  it("treats the last word as a prefix unless followed by a space", () => {
    expect(parseQuery("warr")[0].prefixLast).toBe(true);
    expect(parseQuery("warr ")[0].prefixLast).toBe(false);
    expect(parseQuery("lease agr").map((g) => g.prefixLast)).toEqual([false, true]);
  });
  it("keeps quoted phrases and joined tokens together", () => {
    const g = parseQuery('"security deposit" INV-2026-0042');
    expect(g[0]).toMatchObject({ terms: ["security", "deposit"], quoted: true });
    expect(g[1].terms).toEqual(["inv", "2026", "0042"]);
  });
});

describe("SearchIndex", () => {
  it("finds a phrase that appears only inside the extracted text", () => {
    const r = library().search('"security deposit"');
    expect(r.hits.map((h) => h.id)).toEqual(["lease"]);
    expect(r.hits[0].fields).toContain("body");
  });

  it("requires every word (AND) and ranks title matches above body matches", () => {
    const idx = library();
    expect(idx.search("lease landlord").hits.map((h) => h.id)).toEqual(["lease"]);
    idx.add(indexable("x", { title: "Warranty card", body: "nothing else" }));
    const ids = idx.search("warranty").hits.map((h) => h.id);
    expect(ids[0]).toBe("x");
    expect(ids).toContain("laptop");
  });

  it("matches the word being typed as a prefix", () => {
    expect(library().search("warr").hits.map((h) => h.id)).toEqual(["laptop"]);
  });

  it("matches joined identifiers in order", () => {
    const idx = library();
    expect(idx.search("INV-2026-0042").hits.map((h) => h.id)).toEqual(["laptop"]);
    expect(idx.search("0042-2026-inv ").hits).toHaveLength(0);
  });

  it("matches singular and plural forms", () => {
    const idx = library();
    idx.add(indexable("r", { title: "Shoebox", body: "Two receipts and three warranties, plus boxes" }));
    expect(idx.search("warranties ").hits.map((h) => h.id).sort()).toEqual(["laptop", "r"]);
    expect(idx.search("receipts ").hits.map((h) => h.id).sort()).toEqual(["laptop", "r"]);
    expect(idx.search("box ").hits.map((h) => h.id)).toEqual(["r"]);
    expect(wordVariants("policies")).toEqual(["policy"]);
    expect(wordVariants("bus")).toEqual([]);
    expect(wordVariants("glass")).toEqual(["glasses"]);
    expect(wordVariants("2026")).toEqual([]);
  });

  it("tolerates small typos for longer words", () => {
    const r = library().search("pasport ");
    expect(r.hits.map((h) => h.id)).toEqual(["note"]);
    expect(r.fuzzy).toBe(true);
  });

  it("falls back to partial matches and says so", () => {
    const r = library().search("passport zebra ");
    expect(r.matchedAll).toBe(false);
    expect(r.hits[0].id).toBe("note");
  });

  it("searches tags, notes and file names", () => {
    const idx = library();
    expect(idx.search("electronics").hits[0].id).toBe("laptop");
    expect(idx.search("lisbon").hits[0]).toMatchObject({ id: "note", fields: ["notes"] });
    expect(idx.search("58213").hits[0].id).toBe("laptop");
  });

  it("restricts results to an allowed set (filters)", () => {
    expect(library().search("due", { allowed: ["lease"] }).hits).toHaveLength(0);
  });

  it("updates when a document is replaced or removed", () => {
    const idx = library();
    idx.add(indexable("bill", { title: "Water bill", body: "Water usage" }));
    expect(idx.search("electricity").hits).toHaveLength(0);
    expect(idx.search("water").hits.map((h) => h.id)).toEqual(["bill"]);
    expect(idx.remove("bill")).toBe(true);
    expect(idx.search("water").hits).toHaveLength(0);
    expect(idx.size).toBe(3);
    expect(idx.search("kwh").hits).toHaveLength(0);
  });

  it("builds highlighted snippets with page numbers", () => {
    const idx = library();
    const r = idx.search("protection plan");
    const s = idx.snippet("laptop", r.spec)!;
    expect(s.page).toBe(2);
    expect(s.segments.filter(([, hit]) => hit).map(([t]) => t)).toEqual(["protection", "plan"]);
    const text = s.segments.map(([t]) => t).join("");
    expect(text).toContain("extended protection plan");
  });

  it("returns a notes snippet when the match is only in notes", () => {
    const idx = library();
    const r = idx.search("lisbon");
    expect(idx.snippet("note", r.spec)?.field).toBe("notes");
  });

  it("handles empty queries and empty indexes", () => {
    expect(new SearchIndex().search("anything").hits).toEqual([]);
    expect(library().search("   ").hits).toEqual([]);
  });

  it("stays fast for hundreds of documents", () => {
    const idx = new SearchIndex();
    const words = "invoice receipt warranty policy lease bill payment amount total due renewal coverage tenant meter energy order serial".split(" ");
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      const body = Array.from({ length: 1500 }, (_, k) => words[(i * 7 + k * 13) % words.length] + (k % 50 === 0 ? ` w${i}x${k}` : "")).join(" ");
      idx.add(indexable(`d${i}`, { title: `Document ${i}`, body }));
    }
    const build = performance.now() - t0;
    const t1 = performance.now();
    const r = idx.search("warranty renew");
    const query = performance.now() - t1;
    expect(r.hits.length).toBeGreaterThan(100);
    expect(idx.search("w599x1450").hits.map((h) => h.id)).toEqual(["d599"]);
    expect(build).toBeLessThan(5000);
    expect(query).toBeLessThan(300);
  });
});

describe("helpers", () => {
  it("editDistance counts transpositions as one edit", () => {
    expect(editDistance("recieve", "receive", 2)).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
  it("highlightSegments marks exact terms and prefixes", () => {
    expect(highlightSegments("Warranty and warranties", { terms: ["warranty"], prefixes: [] })).toEqual([
      ["Warranty", true],
      [" and warranties", false],
    ]);
    expect(highlightSegments("Warranty and warranties", { terms: [], prefixes: ["warrant"] }).filter(([, h]) => h)).toHaveLength(2);
  });
});
