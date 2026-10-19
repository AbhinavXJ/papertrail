"use client";

import Link from "next/link";
import type { DocumentRecord } from "@/lib/types";
import type { SearchHit, Snippet } from "@/lib/search/engine";
import type { HighlightSpec } from "@/lib/search/tokenize";
import { useApp } from "@/lib/store/store";
import { useLibraryView } from "@/lib/store/library-view";
import { categoryName } from "@/lib/organize/categories";
import { formatTimestamp, plural } from "@/lib/util";
import { StatusPill } from "@/components/ui/Status";
import { DocThumb, Highlighted, KIND_LABEL, docHref } from "./DocBits";
import { SelectBox, toggleSelected } from "./DocViews";

const FIELD_LABEL: Record<string, string> = { title: "title", fileName: "file name", tags: "tags", category: "category", notes: "notes", meta: "details", body: "text" };

export function SearchResults({
  q,
  hits,
  shown,
  snippets,
  spec,
  onShowMore,
  onExit,
}: {
  q: string;
  hits: SearchHit[];
  shown: number;
  snippets: Record<string, Snippet | null>;
  spec: HighlightSpec;
  onShowMore: () => void;
  /** Escape or ArrowUp past the first result returns focus to the search box. */
  onExit: () => void;
}) {
  const docMap = useApp((s) => s.docMap);
  const custom = useApp((s) => s.categories);
  const tagMap = useApp((s) => s.tagMap);
  const { selected } = useLibraryView();
  return (
    <>
      <ol
        className="mt-2 divide-y divide-line"
        id="search-results"
        aria-label={`Results for ${q}`}
        onKeyDown={(e) => {
          const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-result-link]")];
          const i = links.indexOf(document.activeElement as HTMLAnchorElement);
          if (i < 0) return;
          if (e.key === "ArrowDown" && i < links.length - 1) {
            e.preventDefault();
            links[i + 1].focus();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (i === 0) onExit();
            else links[i - 1].focus();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onExit();
          }
        }}
      >
        {hits.slice(0, shown).map((h, i) => {
          const d = docMap.get(h.id) as DocumentRecord;
          const s = snippets[h.id];
          const cat = categoryName(d.categoryId, custom);
          const other = h.fields.filter((f) => f !== "body" && f !== "title");
          const tags = d.tagIds.map((t) => tagMap.get(t)?.name).filter(Boolean) as string[];
          return (
            <li key={h.id} data-testid="search-result" className="group relative flex gap-4 px-3 py-4 transition-colors focus-within:bg-hover hover:bg-hover">
              <SelectBox checked={selected.has(d.id)} onChange={() => toggleSelected(d.id)} label={`Select ${d.title}`} className="relative z-[1] mt-1 hidden sm:grid" />
              <DocThumb doc={d} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <Link
                    href={docHref(d.id, q, s?.page)}
                    data-result-link
                    className="serif min-w-0 truncate text-[17.5px] font-medium leading-snug text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-accent"
                  >
                    <Highlighted text={d.title} spec={spec} />
                  </Link>
                  <span className="text-[12.5px] text-ink-3">{[cat, KIND_LABEL[d.kind]].filter(Boolean).join(" · ")}</span>
                </div>
                {s ? (
                  <p className="mt-1 line-clamp-2 text-[14px] leading-relaxed text-ink-2">
                    {s.field === "notes" && <span className="mr-1 text-ink-3">Note:</span>}
                    {s.segments.map(([t, hit], k) => (hit ? <mark key={k}>{t}</mark> : <span key={k}>{d.mimeType === "text/markdown" ? t.replace(/\*\*|__|`|(^|\s)#{1,6}(?=\s)/g, "$1") : t}</span>))}
                  </p>
                ) : (
                  other.length > 0 && (
                    <p className="mt-1 truncate text-[13.5px] text-ink-2">
                      {other.includes("fileName") ? <Highlighted text={d.fileName} spec={spec} /> : other.includes("tags") ? <Highlighted text={tags.join(" · ")} spec={spec} /> : null}
                    </p>
                  )
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                  {s?.page && <span className="font-medium text-ink-2">Page {s.page}</span>}
                  {s && s.hits > 1 && <span>{plural(s.hits, "match", "matches")}</span>}
                  {other.length > 0 && <span>Matched {other.map((f) => FIELD_LABEL[f]).join(", ")}</span>}
                  <span>Added {formatTimestamp(d.importedAt)}</span>
                  {d.extraction.status !== "completed" && <StatusPill status={d.extraction.status} className="relative h-5" />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {hits.length > shown && (
        <div className="mt-4 flex justify-center">
          <button type="button" className="btn" onClick={onShowMore}>
            Show more results ({hits.length - shown} more)
          </button>
        </div>
      )}
    </>
  );
}
