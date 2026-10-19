"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, LayoutGrid, List, X } from "lucide-react";
import { useApp } from "@/lib/store/store";
import { setFilter, setView, useLibraryView } from "@/lib/store/library-view";
import { setSetting } from "@/lib/store/app";
import { allCategories } from "@/lib/organize/categories";
import { EMPTY_FILTER, SORT_LABELS, UNCATEGORIZED, facetCounts, isFilterActive, needsAttention, type DatePreset, type SortKey } from "@/lib/library/query";
import type { DocKind } from "@/lib/types";
import { cn, fold } from "@/lib/util";
import { Popover } from "@/components/ui/Popover";

function CheckRow({ checked, onToggle, label, count }: { checked: boolean; onToggle: () => void; label: string; count?: number }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} className="menu-item" onClick={onToggle}>
      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border", checked ? "border-accent bg-accent text-accent-ink" : "border-line-2")}>{checked && <Check size={11} strokeWidth={3} />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[12px] text-ink-3 tnum">{count}</span>}
    </button>
  );
}

const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const DATE_PRESETS: Array<[DatePreset, string]> = [
  ["any", "Any time"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["12m", "Last 12 months"],
  ["custom", "Custom range"],
];

export function FilterBar({ searching }: { searching: boolean }) {
  const docs = useApp((s) => s.docs);
  const tags = useApp((s) => s.tags);
  const custom = useApp((s) => s.categories);
  const hasDates = useApp((s) => s.dates.some((d) => d.status === "active"));
  const viewMode = useApp((s) => s.settings.view);
  const { filter, sort, browseSort } = useLibraryView();
  const [tagQuery, setTagQuery] = useState("");
  const counts = useMemo(() => facetCounts(docs), [docs]);
  const attention = useMemo(() => docs.filter(needsAttention).length, [docs]);
  const cats = allCategories(custom);
  const active = isFilterActive(filter);
  const catLabel = filter.categoryIds.length === 1 ? (filter.categoryIds[0] === UNCATEGORIZED ? "Uncategorized" : cats.find((c) => c.id === filter.categoryIds[0])?.name) : filter.categoryIds.length ? `${filter.categoryIds.length} categories` : null;
  const tagLabel = filter.tagIds.length === 1 ? tags.find((t) => t.id === filter.tagIds[0])?.name : filter.tagIds.length ? `${filter.tagIds.length} tags` : null;
  const kindLabel = filter.kinds.length ? filter.kinds.map((k) => ({ pdf: "PDF", image: "Images", text: "Text" })[k]).join(", ") : null;
  const dateLabel = filter.datePreset === "any" ? null : `${filter.dateField === "document" ? "Dated" : "Added"} ${DATE_PRESETS.find(([p]) => p === filter.datePreset)![1].toLowerCase()}`;
  const currentSort = searching ? sort : browseSort;
  const sorts = (Object.keys(SORT_LABELS) as SortKey[]).filter((k) => searching || k !== "relevance");

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filters and view">
      <Popover menu label="Filter by category" buttonClassName={cn("chip", catLabel && "chip-on")} trigger={<FilterChip label="Category" value={catLabel} />}>
        <div className="max-h-[320px] overflow-y-auto">
          {[...cats, { id: UNCATEGORIZED, name: "Uncategorized" }].map((c) => (
            <CheckRow key={c.id} label={c.name} count={counts.categories.get(c.id) ?? 0} checked={filter.categoryIds.includes(c.id)} onToggle={() => setFilter({ categoryIds: toggle(filter.categoryIds, c.id) })} />
          ))}
        </div>
      </Popover>

      <Popover menu label="Filter by tag" buttonClassName={cn("chip", tagLabel && "chip-on")} trigger={<FilterChip label="Tags" value={tagLabel} />} className="w-64">
        {tags.length ? (
          <>
            {tags.length > 8 && <input className="field mb-1.5 h-8 min-h-0 text-[13px]" placeholder="Find a tag" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} aria-label="Find a tag" />}
            <div className="max-h-[280px] overflow-y-auto">
              {tags
                .filter((t) => !tagQuery || fold(t.name).includes(fold(tagQuery)))
                .map((t) => (
                  <CheckRow key={t.id} label={t.name} count={counts.tags.get(t.id) ?? 0} checked={filter.tagIds.includes(t.id)} onToggle={() => setFilter({ tagIds: toggle(filter.tagIds, t.id) })} />
                ))}
            </div>
            {filter.tagIds.length > 1 && <p className="px-2 pb-1 pt-1.5 text-[12px] text-ink-3">Showing documents with all selected tags.</p>}
          </>
        ) : (
          <p className="px-2 py-1.5 text-[13px] text-ink-3">No tags yet. Add tags from a document’s details.</p>
        )}
      </Popover>

      <Popover menu label="Filter by type" buttonClassName={cn("chip", kindLabel && "chip-on")} trigger={<FilterChip label="Type" value={kindLabel} />}>
        {(["pdf", "image", "text"] as DocKind[]).map((k) => (
          <CheckRow key={k} label={{ pdf: "PDF", image: "Images", text: "Text & Markdown" }[k]} count={docs.filter((d) => d.kind === k).length} checked={filter.kinds.includes(k)} onToggle={() => setFilter({ kinds: toggle(filter.kinds, k) })} />
        ))}
      </Popover>

      <Popover label="Filter by date" buttonClassName={cn("chip", dateLabel && "chip-on")} trigger={<FilterChip label="Date" value={dateLabel} />} className="w-72 p-3">
        <div className="mb-2.5 grid grid-cols-2 gap-1 rounded-md bg-paper-2 p-0.5 text-[13px]">
          {(["imported", "document"] as const).map((f) => (
            <button key={f} type="button" className={cn("h-7 rounded-[5px] font-medium", filter.dateField === f ? "bg-card text-ink shadow-[var(--shadow-soft)]" : "text-ink-3")} onClick={() => setFilter({ dateField: f })} aria-pressed={filter.dateField === f}>
              {f === "imported" ? "Date added" : "Document date"}
            </button>
          ))}
        </div>
        <div className="space-y-0.5" role="radiogroup" aria-label="Date range">
          {DATE_PRESETS.map(([p, label]) => (
            <label key={p} className="menu-item">
              <input type="radio" name="date-preset" className="accent-[var(--accent)]" checked={filter.datePreset === p} onChange={() => setFilter({ datePreset: p })} />
              {label}
            </label>
          ))}
        </div>
        {filter.datePreset === "custom" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[12px] text-ink-3">
              From
              <input type="date" className="field mt-1 h-8 min-h-0 px-2 text-[13px]" value={filter.from} onChange={(e) => setFilter({ from: e.target.value })} />
            </label>
            <label className="text-[12px] text-ink-3">
              To
              <input type="date" className="field mt-1 h-8 min-h-0 px-2 text-[13px]" value={filter.to} onChange={(e) => setFilter({ to: e.target.value })} />
            </label>
          </div>
        )}
        {filter.dateField === "document" && <p className="mt-2 text-[12px] text-ink-3">Only documents with a known document date are included.</p>}
      </Popover>

      {attention > 0 && (
        <button type="button" className="chip" aria-pressed={filter.attention} onClick={() => setFilter({ attention: !filter.attention })}>
          Needs attention <span className="tnum opacity-70">{attention}</span>
        </button>
      )}
      {(hasDates || filter.withDates) && (
        <button type="button" className="chip" aria-pressed={filter.withDates} onClick={() => setFilter({ withDates: !filter.withDates })}>
          Has important dates
        </button>
      )}
      {active && (
        <button type="button" className="btn btn-ghost btn-sm text-ink-3" onClick={() => setView({ filter: EMPTY_FILTER })}>
          <X size={14} /> Clear filters
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <label className="sr-only" htmlFor="sort">
          Sort
        </label>
        <select
          id="sort"
          className="field h-8 min-h-0 w-auto py-0 pl-2.5 text-[13px]"
          value={currentSort}
          onChange={(e) => setView(searching ? { sort: e.target.value as SortKey } : { browseSort: e.target.value as SortKey })}
        >
          {sorts.map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
        {!searching && (
          <div className="flex rounded-md border border-line-2 bg-card p-0.5" role="group" aria-label="Layout">
            {(["list", "grid"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={cn("grid h-7 w-8 place-items-center rounded-[5px] text-ink-3", viewMode === m && "bg-paper-2 text-ink")}
                aria-pressed={viewMode === m}
                aria-label={m === "list" ? "List view" : "Grid view"}
                onClick={() => void setSetting("view", m)}
              >
                {m === "list" ? <List size={16} /> : <LayoutGrid size={15} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1">
      {value ? (
        <>
          <span className="opacity-75">{label}:</span> <span className="max-w-[10rem] truncate font-semibold">{value}</span>
        </>
      ) : (
        label
      )}
      <ChevronDown size={13} className="opacity-60" />
    </span>
  );
}
