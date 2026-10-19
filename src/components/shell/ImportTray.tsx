"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Copy, FileWarning, RotateCcw, X } from "lucide-react";
import { getState, useApp, type QueueItem } from "@/lib/store/store";
import { useMediaQuery } from "@/lib/hooks";
import { cancelProcessing, clearFinished, dismissQueueItem, importDuplicateAnyway, reprocess } from "@/lib/store/app";
import { formatBytes, plural } from "@/lib/util";
import { ProgressBar, StatusPill } from "@/components/ui/Status";

const ACTIVE = new Set(["checking", "queued", "processing"]);
const TRAY_MAX = 120;

function ItemRow({ item }: { item: QueueItem }) {
  const active = ACTIVE.has(item.phase);
  return (
    <li className="px-4 py-2.5" data-testid="queue-item" data-phase={item.phase}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-ink" title={item.name}>
            {item.docId && !active ? (
              <Link href={`/document/?id=${encodeURIComponent(item.docId)}`} className="hover:underline">
                {item.name}
              </Link>
            ) : (
              item.name
            )}
          </div>
          <div className="truncate text-[12px] text-ink-3">
            {item.phase === "checking" && "Checking…"}
            {item.phase === "queued" && (item.message ?? "Waiting to read text")}
            {item.phase === "processing" && (item.progress?.label ?? "Reading…")}
            {(item.phase === "done" || item.phase === "failed" || item.phase === "rejected" || item.phase === "duplicate") && (item.message ?? (item.result === "completed" ? `Added · ${formatBytes(item.size)}` : ""))}
          </div>
        </div>
        {item.phase === "done" && item.result && <StatusPill status={item.result} compact />}
        {item.phase === "failed" && <StatusPill status="failed" compact />}
        {item.phase === "rejected" && <FileWarning size={16} className="text-danger" aria-label="Not imported" />}
        {item.phase === "duplicate" && <Copy size={15} className="text-ink-3" aria-label="Duplicate" />}
        {(item.phase === "queued" || item.phase === "processing") && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancelProcessing(item.key)}>
            {item.phase === "processing" ? "Cancel" : "Skip"}
          </button>
        )}
        {!active && (
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => dismissQueueItem(item.key)} aria-label={`Dismiss ${item.name}`}>
            <X size={14} />
          </button>
        )}
      </div>
      {item.phase === "processing" && <ProgressBar ratio={item.progress?.ratio ?? null} className="mt-2" label={`Processing ${item.name}`} />}
      {item.phase === "duplicate" && (
        <div className="mt-1.5 flex gap-1.5">
          {item.duplicateOf?.id && (
            <Link className="btn btn-sm" href={`/document/?id=${encodeURIComponent(item.duplicateOf.id)}`}>
              Open existing
            </Link>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void importDuplicateAnyway(item.key)}>
            Import a copy anyway
          </button>
        </div>
      )}
      {(item.phase === "failed" || (item.phase === "done" && item.result !== "completed")) && item.docId && (
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" className="btn btn-sm" onClick={() => reprocess(item.docId!, { forceOcr: true })}>
            <RotateCcw size={13} /> Try again
          </button>
        </div>
      )}
    </li>
  );
}

/** Floating panel listing files being imported, with progress, cancel, retry and duplicate handling. */
export function ImportTray() {
  const queue = useApp((s) => s.queue);
  const wide = useMediaQuery("(min-width: 640px)");
  const [userToggle, setUserToggle] = useState<boolean | null>(null);
  const active = queue.filter((q) => ACTIVE.has(q.phase));
  const problems = queue.filter((q) => q.phase === "failed" || q.phase === "rejected" || q.phase === "duplicate" || (q.phase === "done" && q.result !== "completed"));
  const done = queue.filter((q) => q.phase === "done" && q.result === "completed");
  // Expanded while there is something to watch or decide (on small screens only for decisions).
  const collapsed = userToggle ?? !(problems.length > 0 || (wide && active.length > 0));

  useEffect(() => {
    if (!queue.length) setUserToggle(null);
  }, [queue.length]);
  // Successful imports clear themselves; anything that needs a decision stays.
  useEffect(() => {
    if (active.length || !done.length) return;
    const t = setTimeout(() => {
      getState()
        .queue.filter((q) => q.phase === "done" && q.result === "completed")
        .forEach((d) => dismissQueueItem(d.key));
    }, problems.length ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [active.length, done.length, problems.length]);

  if (!queue.length) return null;
  const current = active.find((q) => q.phase === "processing");
  const title = active.length
    ? `Adding ${plural(queue.filter((q) => ACTIVE.has(q.phase) || q.phase === "done").length, "document")}…`
    : problems.length
      ? `${plural(problems.length, "file")} need${problems.length === 1 ? "s" : ""} attention`
      : `${plural(done.length, "document")} added`;

  return (
    <section
      aria-label="Import progress"
      className="popover fixed inset-x-3 bottom-3 z-30 overflow-hidden sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px]"
      data-testid="import-tray"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1" aria-live="polite">
          <div className="text-[14px] font-semibold">{title}</div>
          {current && collapsed && <div className="truncate text-[12px] text-ink-3">{current.progress?.label}</div>}
        </div>
        {!active.length && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFinished}>
            Clear
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setUserToggle(!collapsed)} aria-label={collapsed ? "Expand" : "Collapse"} aria-expanded={!collapsed}>
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </header>
      {collapsed ? (
        current && <ProgressBar ratio={current.progress?.ratio ?? null} className="rounded-none" />
      ) : (
        <ul className="max-h-[min(45vh,420px)] divide-y divide-line overflow-y-auto">
          {/* Items needing a decision first, then the most recent. Very large batches are capped. */}
          {[...problems, ...queue.filter((q) => !problems.includes(q)).reverse()].slice(0, TRAY_MAX).map((q) => (
            <ItemRow key={q.key} item={q} />
          ))}
          {queue.length > TRAY_MAX && <li className="px-4 py-2.5 text-[12.5px] text-ink-3">…and {(queue.length - TRAY_MAX).toLocaleString()} more</li>}
        </ul>
      )}
    </section>
  );
}
