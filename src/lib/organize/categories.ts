import type { Category } from "@/lib/types";

export const BUILT_IN_CATEGORIES: readonly Category[] = [
  { id: "receipts", name: "Receipts & purchases", builtIn: true, createdAt: 0 },
  { id: "bills", name: "Bills & utilities", builtIn: true, createdAt: 0 },
  { id: "warranties", name: "Warranties & manuals", builtIn: true, createdAt: 0 },
  { id: "insurance", name: "Insurance", builtIn: true, createdAt: 0 },
  { id: "financial", name: "Financial", builtIn: true, createdAt: 0 },
  { id: "property", name: "Rental & property", builtIn: true, createdAt: 0 },
  { id: "identity", name: "Identity & travel", builtIn: true, createdAt: 0 },
  { id: "other", name: "Other", builtIn: true, createdAt: 0 },
];

export const BUILT_IN_IDS = new Set(BUILT_IN_CATEGORIES.map((c) => c.id));

export function allCategories(custom: readonly Category[]): Category[] {
  const others = BUILT_IN_CATEGORIES.filter((c) => c.id === "other");
  const main = BUILT_IN_CATEGORIES.filter((c) => c.id !== "other");
  return [...main, ...[...custom].sort((a, b) => a.name.localeCompare(b.name)), ...others];
}

export function categoryName(id: string | null, custom: readonly Category[]): string | null {
  if (!id) return null;
  return BUILT_IN_CATEGORIES.find((c) => c.id === id)?.name ?? custom.find((c) => c.id === id)?.name ?? null;
}
