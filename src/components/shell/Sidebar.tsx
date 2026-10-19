"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { CalendarClock, Library, Plus, Settings, ShieldCheck, TriangleAlert } from "lucide-react";
import { useApp } from "@/lib/store/store";
import { setView, useLibraryView } from "@/lib/store/library-view";
import { allCategories } from "@/lib/organize/categories";
import { facetCounts, EMPTY_FILTER } from "@/lib/library/query";
import { needsAttention } from "@/lib/dates/reminders";
import { cn, formatBytes, timeAgo, todayISO } from "@/lib/util";
import { pickFiles } from "./import-request";
import { Wordmark } from "./Wordmark";

function NavLink({ href, icon, label, count, badge, onNavigate }: { href: string; icon: React.ReactNode; label: string; count?: number; badge?: number; onNavigate?: () => void }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[14.5px] text-ink-2 transition-colors hover:bg-hover hover:text-ink", active && "bg-hover font-medium text-ink")}
    >
      <span className="text-ink-3">{icon}</span>
      <span className="flex-1">{label}</span>
      {!!badge && (
        <span className="rounded-full bg-warn px-1.5 text-[11.5px] font-semibold leading-[18px] text-paper tnum" aria-label={`${badge} need attention`}>
          {badge}
        </span>
      )}
      {count !== undefined && <span className="text-[12.5px] text-ink-3 tnum">{count.toLocaleString()}</span>}
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const docs = useApp((s) => s.docs);
  const tags = useApp((s) => s.tags);
  const custom = useApp((s) => s.categories);
  const dates = useApp((s) => s.dates);
  const storage = useApp((s) => s.storage);
  const settings = useApp((s) => s.settings);
  const workspace = useApp((s) => s.workspace);
  const view = useLibraryView();
  const router = useRouter();
  const path = usePathname();

  const counts = useMemo(() => facetCounts(docs), [docs]);
  const attention = useMemo(() => {
    const today = todayISO();
    return dates.filter((d) => needsAttention(d, today)).length;
  }, [dates]);
  const cats = allCategories(custom).filter((c) => counts.categories.get(c.id));
  const usedTags = tags.filter((t) => counts.tags.get(t.id)).sort((a, b) => (counts.tags.get(b.id) ?? 0) - (counts.tags.get(a.id) ?? 0));
  const docBytes = useMemo(() => docs.reduce((s, d) => s + d.size, 0), [docs]);
  const changedSinceBackup = useMemo(() => (settings.lastBackupAt ? docs.filter((d) => d.updatedAt > settings.lastBackupAt!).length : docs.length), [docs, settings.lastBackupAt]);

  const goFilter = (patch: Partial<typeof EMPTY_FILTER>) => {
    setView({ filter: { ...EMPTY_FILTER, ...patch }, q: "", selected: new Set(), scrollY: 0 });
    window.scrollTo(0, 0);
    if (path !== "/") router.push("/");
    onNavigate?.();
  };
  const onlyCat = path === "/" && !view.q && view.filter.categoryIds.length === 1 && !view.filter.tagIds.length ? view.filter.categoryIds[0] : null;
  const onlyTag = path === "/" && !view.q && view.filter.tagIds.length === 1 && !view.filter.categoryIds.length ? view.filter.tagIds[0] : null;

  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-5 overflow-y-auto px-3 pb-4 pt-5">
      <div className="px-2">
        <Link href="/" onClick={() => goFilter({})} aria-label="Papertrail — library">
          <Wordmark />
        </Link>
      </div>
      <button type="button" className="btn btn-primary mx-1 justify-start" onClick={pickFiles}>
        <Plus size={16} /> Add documents
      </button>
      <div className="space-y-0.5">
        <NavLink href="/" icon={<Library size={17} />} label="Library" count={docs.length} onNavigate={() => goFilter({})} />
        <NavLink href="/dates/" icon={<CalendarClock size={17} />} label="Important dates" badge={attention} onNavigate={onNavigate} />
        <NavLink href="/settings/" icon={<Settings size={17} />} label="Settings" onNavigate={onNavigate} />
      </div>

      {cats.length > 0 && (
        <div>
          <h2 className="eyebrow mb-1.5 px-2.5">Categories</h2>
          <ul className="space-y-px">
            {cats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => goFilter({ categoryIds: [c.id] })}
                  aria-pressed={onlyCat === c.id}
                  className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[14px] text-ink-2 hover:bg-hover hover:text-ink", onlyCat === c.id && "bg-hover font-medium text-ink")}
                >
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-[12.5px] text-ink-3 tnum">{counts.categories.get(c.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {usedTags.length > 0 && (
        <div>
          <h2 className="eyebrow mb-1.5 px-2.5">Tags</h2>
          <ul className="flex flex-wrap gap-1.5 px-2">
            {usedTags.slice(0, 24).map((t) => (
              <li key={t.id}>
                <button type="button" className="chip h-7 px-2.5 text-[12.5px]" data-on={onlyTag === t.id} onClick={() => goFilter({ tagIds: [t.id] })}>
                  {t.name}
                  <span className="opacity-60 tnum">{counts.tags.get(t.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto space-y-2 px-2 pt-2 text-[12.5px] leading-snug text-ink-3">
        {workspace === "user" && docs.length > 0 && (
          <Link href="/settings/#backup" onClick={onNavigate} className={cn("flex items-start gap-2 rounded-md p-2 hover:bg-hover", !settings.lastBackupAt && "bg-warn-soft text-warn hover:bg-warn-soft")}>
            {!settings.lastBackupAt && <TriangleAlert size={14} className="mt-px shrink-0" />}
            <span>
              {settings.lastBackupAt ? (
                <>
                  Backed up {timeAgo(settings.lastBackupAt)}
                  {changedSinceBackup > 0 && <span className="block">{changedSinceBackup} changed since</span>}
                </>
              ) : (
                <>No backup yet. Browser storage can be cleared — export a backup.</>
              )}
            </span>
          </Link>
        )}
        <Link href="/settings/" onClick={onNavigate} className="block px-2 hover:text-ink" title={storage?.quota ? `Browser estimate: ${formatBytes(storage.usage)} used of about ${formatBytes(storage.quota)}` : undefined}>
          {formatBytes(docBytes)} in {docs.length === 1 ? "1 document" : `${docs.length.toLocaleString()} documents`}
        </Link>
        <Link href="/privacy/" onClick={onNavigate} className="flex items-center gap-1.5 px-2 hover:text-ink">
          <ShieldCheck size={14} /> Stored only in this browser
        </Link>
      </div>
    </nav>
  );
}
