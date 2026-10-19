import { useSyncExternalStore } from "react";
import { EMPTY_FILTER, type LibraryFilter, type SortKey } from "@/lib/library/query";

/** Library UI state (query, filters, sort, selection) — kept in memory across page navigation. */
export interface LibraryView {
  q: string;
  filter: LibraryFilter;
  sort: SortKey;
  /** Sort used when there is no query (relevance is meaningless then). */
  browseSort: SortKey;
  selected: ReadonlySet<string>;
  /** Page scroll position when the library was left, restored on return. */
  scrollY: number;
}

const INITIAL: LibraryView = { q: "", filter: EMPTY_FILTER, sort: "relevance", browseSort: "imported-desc", selected: new Set(), scrollY: 0 };
let view: LibraryView = INITIAL;
const listeners = new Set<() => void>();

export function getView(): LibraryView {
  return view;
}

export function setView(patch: Partial<LibraryView> | ((v: LibraryView) => Partial<LibraryView>)) {
  view = { ...view, ...(typeof patch === "function" ? patch(view) : patch) };
  listeners.forEach((l) => l());
}

export function setFilter(patch: Partial<LibraryFilter>) {
  setView((v) => ({ filter: { ...v.filter, ...patch } }));
}

export function resetView() {
  setView({ q: "", filter: EMPTY_FILTER, selected: new Set(), scrollY: 0 });
}

// "/" or Cmd/Ctrl+K pressed on another page: focus the library search once it mounts.
let focusSearchPending = false;
export function requestSearchFocus() {
  focusSearchPending = true;
}
export function consumeSearchFocus(): boolean {
  const v = focusSearchPending;
  focusSearchPending = false;
  return v;
}

export function useLibraryView(): LibraryView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
    () => INITIAL,
  );
}
