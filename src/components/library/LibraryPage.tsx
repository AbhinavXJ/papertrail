"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { ImportantDate } from "@/lib/types";
import type { SearchResult, Snippet } from "@/lib/search/engine";
import { useApp } from "@/lib/store/store";
import { consumeSearchFocus, getView, setView, useLibraryView } from "@/lib/store/library-view";
import { loadSnippets, runSearch } from "@/lib/store/app";
import { filterDocuments, isFilterActive, sortDocuments, EMPTY_FILTER } from "@/lib/library/query";
import { useDebounced } from "@/lib/hooks";
import { cn, plural } from "@/lib/util";
import { Spinner } from "@/components/ui/Status";
import { useIsFirstRun } from "@/components/shell/AppShell";
import { pickFiles } from "@/components/shell/import-request";
import { FirstRun } from "./FirstRun";
import { FilterBar } from "./FilterBar";
import { DocGrid, DocList } from "./DocViews";
import { SearchResults } from "./SearchResults";
import { BulkBar } from "./BulkBar";
import { docHref } from "./DocBits";
import { BackupNudge } from "./BackupNudge";

const PAGE = 30;

export function LibraryPage() {
  const firstRun = useIsFirstRun();
  if (firstRun) return <FirstRun />;
  return <Library />;
}

function Library() {
  const router = useRouter();
  const docs = useApp((s) => s.docs);
  const docMap = useApp((s) => s.docMap);
  const dates = useApp((s) => s.dates);
  const revision = useApp((s) => s.revision);
  const searchReady = useApp((s) => s.searchReady);
  const searchError = useApp((s) => s.searchError);
  const viewMode = useApp((s) => s.settings.view);
  const busy = useApp((s) => s.busy);
  const { q, filter, sort, browseSort } = useLibraryView();
  const input = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q, 110);
  const searching = q.trim().length > 0;

  // Return to where the user was (e.g. after opening a document and coming back).
  // The position is saved at the moment a link is clicked (capture phase, before Next.js handles
  // the navigation and scrolls the outgoing page to the top), then restored on return.
  useEffect(() => {
    if (consumeSearchFocus()) input.current?.focus();
    const y = getView().scrollY;
    let raf = 0;
    if (y) raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => window.scrollTo(0, y))));
    const save = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("a[href]")) setView({ scrollY: window.scrollY });
    };
    document.addEventListener("click", save, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", save, true);
    };
  }, []);

  // Keep the query in the URL so reloading or sharing the page keeps the search.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("q");
    if (fromUrl && !q) setView({ q: fromUrl });
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (dq.trim()) url.searchParams.set("q", dq.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, [dq]);

  const filtered = useMemo(() => filterDocuments(docs, filter, { dates }), [docs, filter, dates]);
  const datesByDoc = useMemo(() => {
    const m = new Map<string, ImportantDate[]>();
    for (const d of dates) m.set(d.docId, [...(m.get(d.docId) ?? []), d]);
    return m;
  }, [dates]);

  // ── Search ──
  const [result, setResult] = useState<{ q: string; r: SearchResult } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!dq.trim() || !searchReady) return;
    let alive = true;
    const allowed = isFilterActive(filter) ? filtered.map((d) => d.id) : null;
    runSearch(dq, allowed)
      .then((r) => {
        if (!alive) return;
        setResult({ q: dq, r });
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [dq, searchReady, filtered, filter, revision]);

  const hits = useMemo(() => {
    if (!result) return [];
    const valid = result.r.hits.filter((h) => docMap.has(h.id));
    if (sort === "relevance") return valid;
    const byId = new Map(valid.map((h) => [h.id, h]));
    return sortDocuments(
      valid.map((h) => docMap.get(h.id)!),
      sort,
    ).map((d) => byId.get(d.id)!);
  }, [result, docMap, sort]);

  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [dq, filter, sort]);

  const [snippets, setSnippets] = useState<Record<string, Snippet | null>>({});
  const snippetKey = useRef("");
  useEffect(() => {
    if (!result) return;
    const key = `${result.q}|${revision}`;
    if (snippetKey.current !== key) {
      snippetKey.current = key;
      setSnippets({});
    }
    const ids = hits.slice(0, shown).map((h) => h.id);
    let alive = true;
    loadSnippets(ids, result.r.spec)
      .then((s) => alive && setSnippets((prev) => ({ ...prev, ...s })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [result, hits, shown, revision]);

  const stale = searching && (!result || result.q !== dq || q !== dq);
  const browse = useMemo(() => sortDocuments(filtered, browseSort), [filtered, browseSort]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (q) setView({ q: "" });
      else input.current?.blur();
      return;
    }
    if (!searching || !hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      document.querySelector<HTMLAnchorElement>("#search-results a[data-result-link]")?.focus();
    } else if (e.key === "Enter") {
      // Enter in the search box opens the best match.
      e.preventDefault();
      const h = hits[0];
      if (!h) return;
      setView({ scrollY: window.scrollY });
      router.push(docHref(h.id, dq, snippets[h.id]?.page));
    }
  };

  return (
    <main className="mx-auto max-w-[1180px] px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pt-9">
      <h1 className="sr-only">Library</h1>
      <BackupNudge />
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          ref={input}
          id="library-search"
          type="search"
          aria-label="Search documents"
          aria-describedby="search-help"
          aria-controls={searching ? "search-results" : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={docs.length ? `Search ${plural(docs.length, "document")} — names, text inside, tags, notes` : "Search your documents"}
          value={q}
          onChange={(e) => setView({ q: e.target.value })}
          onKeyDown={onKeyDown}
          className="h-[52px] w-full rounded-[12px] border border-line-2 bg-card pl-12 pr-24 text-[17px] text-ink shadow-[var(--shadow-soft)] transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_14%,transparent)] focus:outline-none"
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {searching && stale && searchReady && <Spinner size={15} />}
          {q ? (
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setView({ q: "" })} aria-label="Clear search">
              <X size={16} />
            </button>
          ) : (
            <span className="hidden items-center gap-1 sm:flex" aria-hidden>
              <kbd className="kbd">/</kbd>
            </span>
          )}
        </div>
      </div>

      <p id="search-help" className="sr-only">
        Results update as you type. Press Enter to open the best match, or the down arrow to move through results.
      </p>
      <div className="mt-4">
        <FilterBar searching={searching} />
      </div>

      {searchError && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-[13.5px] text-danger">{searchError}</p>}

      {searching ? (
        <section aria-label="Search results" className="mt-5">
          {!searchReady ? (
            <p className="flex items-center gap-2 py-10 text-[14.5px] text-ink-3">
              <Spinner size={15} /> Preparing search — reading your library’s text…
            </p>
          ) : failed ? (
            <p className="py-10 text-[14.5px] text-danger">Search failed. Reload the page to rebuild the search index.</p>
          ) : result && hits.length === 0 && !stale ? (
            <NoResults q={result.q} filtered={isFilterActive(filter)} />
          ) : result ? (
            <>
              <div className={cn("flex flex-wrap items-baseline gap-x-3 text-[13.5px] text-ink-3 transition-opacity", stale && "opacity-60")} aria-live="polite">
                <span>
                  <strong className="font-semibold text-ink tnum">{hits.length.toLocaleString()}</strong> {hits.length === 1 ? "document" : "documents"} {result.r.matchedAll ? "match" : "match some of your words"}
                  {isFilterActive(filter) && " with these filters"}
                </span>
                {!result.r.matchedAll && <span>No document contains every word, so partial matches are shown.</span>}
                {result.r.fuzzy && <span>Includes similar spellings.</span>}
                <span className="ml-auto hidden text-[12px] sm:inline" aria-hidden>
                  <kbd className="kbd">Enter</kbd> opens the best match · <kbd className="kbd">↓</kbd> moves through results
                </span>
              </div>
              <SearchResults q={result.q} hits={hits} shown={shown} snippets={snippets} spec={result.r.spec} onShowMore={() => setShown((s) => s + PAGE)} onExit={() => input.current?.focus()} />
            </>
          ) : null}
        </section>
      ) : (
        <section aria-label="Documents" className="mt-5">
          <div className="flex items-baseline justify-between text-[13.5px] text-ink-3">
            <span aria-live="polite">
              {isFilterActive(filter) ? (
                <>
                  <strong className="font-semibold text-ink tnum">{browse.length.toLocaleString()}</strong> of {plural(docs.length, "document")}
                </>
              ) : (
                <>
                  <strong className="font-semibold text-ink tnum">{docs.length.toLocaleString()}</strong> {docs.length === 1 ? "document" : "documents"}
                </>
              )}
            </span>
          </div>
          {browse.length === 0 ? (
            docs.length === 0 ? (
              busy ? (
                <p className="mt-10 flex items-center justify-center gap-2 text-[14px] text-ink-3">
                  <Spinner size={15} /> Loading…
                </p>
              ) : (
                <EmptyLibrary />
              )
            ) : (
              <div className="mt-6 rounded-[12px] border border-dashed border-line-2 px-6 py-14 text-center">
                <p className="serif text-[20px]">No documents match these filters</p>
                <button type="button" className="btn mt-4" onClick={() => setView({ filter: EMPTY_FILTER })}>
                  Clear filters
                </button>
              </div>
            )
          ) : viewMode === "grid" ? (
            <DocGrid docs={browse} datesByDoc={datesByDoc} />
          ) : (
            <DocList docs={browse} datesByDoc={datesByDoc} />
          )}
        </section>
      )}
      <BulkBar />
    </main>
  );
}

function NoResults({ q, filtered }: { q: string; filtered: boolean }) {
  return (
    <div className="rounded-[12px] border border-dashed border-line-2 px-6 py-12 text-center" data-testid="no-results">
      <p className="serif text-[21px]">Nothing found for “{q}”</p>
      <p className="mx-auto mt-2 max-w-[460px] text-[14px] leading-relaxed text-ink-3">
        Search looks at titles, file names, the text inside your documents, tags, notes and categories. Scans and photos become searchable once text recognition has read them.
      </p>
      {filtered && (
        <button type="button" className="btn mt-4" onClick={() => setView({ filter: EMPTY_FILTER })}>
          Search without filters
        </button>
      )}
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="mt-6 rounded-[12px] border border-dashed border-line-2 px-6 py-14 text-center">
      <p className="serif text-[21px]">This workspace is empty</p>
      <p className="mt-2 text-[14px] text-ink-3">Add receipts, bills, warranties or any important file.</p>
      <button type="button" className="btn btn-primary mt-4" onClick={pickFiles}>
        Add documents
      </button>
    </div>
  );
}
