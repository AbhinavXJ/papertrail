"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, Download, FlaskConical, HardDrive, Pencil, ScanText, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import type { Rule, RuleField } from "@/lib/types";
import { useApp, toast } from "@/lib/store/store";
import {
  addRule,
  applyRestore,
  applyRule,
  cancelRestore,
  clearAllData,
  createCategory,
  deleteCategory,
  deleteRule,
  deleteTag,
  discardSamples,
  enterSamples,
  exportBackup,
  inspectRestore,
  refreshStorage,
  renameCategory,
  renameTag,
  requestPersistence,
  ruleCandidates,
  setSetting,
} from "@/lib/store/app";
import type { Inspection, RestoreResult } from "@/lib/backup/backup";
import { allCategories, BUILT_IN_CATEGORIES, categoryName } from "@/lib/organize/categories";
import { facetCounts } from "@/lib/library/query";
import { OCR_DOWNLOAD_MB } from "@/lib/ingest/ocr";
import { cn, formatBytes, plural, timeAgo } from "@/lib/util";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { ProgressBar } from "@/components/ui/Status";

function Card({ id, icon, title, description, children }: { id?: string; icon: ReactNode; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20 p-5 sm:p-6" aria-labelledby={`${id ?? title}-h`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-accent">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id ?? title}-h`} className="serif text-[21px] font-medium leading-tight">
            {title}
          </h2>
          {description && <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">{description}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function BackupCard() {
  const docs = useApp((s) => s.docs);
  const lastBackupAt = useApp((s) => s.settings.lastBackupAt);
  const workspace = useApp((s) => s.workspace);
  const [exporting, setExporting] = useState<number | null>(null);
  const [inspecting, setInspecting] = useState<number | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bytes = docs.reduce((s, d) => s + d.size, 0);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setInspecting(0);
    try {
      setInspection(await inspectRestore(file, (r) => setInspecting(r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This backup couldn't be read.");
    } finally {
      setInspecting(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const restore = async () => {
    setRestoring(0);
    try {
      const r = await applyRestore((p) => setRestoring(p));
      setResult(r);
      setInspection(null);
      if (r.restoredIds.length) toast(`Restored ${plural(r.restoredIds.length, "document")}.`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restoring failed.");
      setInspection(null);
    } finally {
      setRestoring(null);
    }
  };

  const problems = inspection?.checks.filter((c) => c.state !== "ok") ?? [];

  return (
    <Card
      id="backup"
      icon={<HardDrive size={20} />}
      title="Backup & restore"
      description="Your library lives only in this browser. Clearing site data, a browser reset or a lost device erases it. A backup is a ZIP file with every original plus titles, tags, notes and dates — you can restore it in any browser."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[10px] border border-line p-4">
          <h3 className="text-[14.5px] font-semibold">Export</h3>
          <p className="mt-1 text-[13px] text-ink-3">
            {plural(docs.length, "document")} · about {formatBytes(bytes)}
          </p>
          {workspace === "user" && (
            <p className={cn("mt-1 text-[13px]", lastBackupAt ? "text-ink-3" : "font-medium text-warn")}>{lastBackupAt ? `Last backup ${timeAgo(lastBackupAt)}` : "Never backed up"}</p>
          )}
          <button
            type="button"
            className="btn btn-primary mt-3"
            disabled={!docs.length || exporting !== null}
            data-testid="export-backup"
            onClick={async () => {
              setExporting(0);
              await exportBackup({ onProgress: (r) => setExporting(r) });
              setExporting(null);
            }}
          >
            <Download size={15} /> {exporting !== null ? "Preparing…" : "Export backup"}
          </button>
          {exporting !== null && <ProgressBar ratio={exporting} className="mt-3" label="Export progress" />}
        </div>
        <div className="rounded-[10px] border border-line p-4">
          <h3 className="text-[14.5px] font-semibold">Restore</h3>
          <p className="mt-1 text-[13px] text-ink-3">
            {workspace === "sample"
              ? "Restores into your own library (not this sample workspace), which opens automatically. Every file is checked before anything is saved."
              : "Adds a backup’s documents to this library. Documents you already have are skipped. Every file is checked before anything is saved."}
          </p>
          <input ref={fileInput} type="file" accept=".zip,application/zip" className="sr-only" id="restore-file" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="restore-input" />
          <label htmlFor="restore-file" className={cn("btn mt-3", inspecting !== null && "pointer-events-none opacity-50")}>
            <Upload size={15} /> {inspecting !== null ? "Checking backup…" : "Choose backup file…"}
          </label>
          {inspecting !== null && <ProgressBar ratio={inspecting} className="mt-3" label="Checking backup" />}
        </div>
      </div>
      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-[13.5px] text-danger" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {result && (
        <div className="mt-4 rounded-md bg-ok-soft px-3 py-2.5 text-[13.5px] text-ok" role="status" data-testid="restore-result">
          <p className="font-medium">
            Restored {plural(result.restoredIds.length, "document")} and {plural(result.dates, "important date")}.
          </p>
          {result.stoppedForQuota && <p className="mt-1 text-danger">Restoring stopped because the browser ran out of storage space. Free up space and restore again — documents already restored are skipped.</p>}
          {result.failed.map((f, i) => (
            <p key={i} className="mt-1 text-danger">
              “{f.title}”: {f.reason}
            </p>
          ))}
        </div>
      )}

      <Dialog
        open={!!inspection}
        onClose={() => {
          if (restoring !== null) return;
          cancelRestore();
          setInspection(null);
        }}
        dismissable={restoring === null}
        title="Restore this backup?"
        description={inspection ? `Created ${inspection.manifest.createdAt ? new Date(inspection.manifest.createdAt).toLocaleString() : "at an unknown time"}${inspection.manifest.scope === "selection" ? " · partial export" : ""} · ${formatBytes(inspection.bytes)}` : undefined}
        footer={
          <>
            <button
              type="button"
              className="btn"
              disabled={restoring !== null}
              onClick={() => {
                cancelRestore();
                setInspection(null);
              }}
            >
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!inspection?.counts.ok || restoring !== null} onClick={() => void restore()} data-testid="confirm-restore">
              {restoring !== null ? "Restoring…" : `Restore ${plural(inspection?.counts.ok ?? 0, "document")}`}
            </button>
          </>
        }
      >
        {inspection && (
          <div className="space-y-3 text-[14px]">
            <ul className="grid grid-cols-2 gap-2">
              <li className="rounded-md bg-ok-soft px-3 py-2 text-ok">
                <span className="block text-[20px] font-semibold tnum">{inspection.counts.ok}</span> ready to restore
              </li>
              <li className="rounded-md bg-paper-2 px-3 py-2 text-ink-2">
                <span className="block text-[20px] font-semibold tnum">{inspection.counts.duplicate}</span> already in your library
              </li>
              {inspection.counts.damaged + inspection.counts.unsupported > 0 && (
                <li className="col-span-2 rounded-md bg-danger-soft px-3 py-2 text-danger">
                  <span className="font-semibold tnum">{inspection.counts.damaged + inspection.counts.unsupported}</span> can’t be restored (details below)
                </li>
              )}
            </ul>
            {inspection.dates > 0 && <p className="text-ink-3">Includes {plural(inspection.dates, "important date")}.</p>}
            {problems.filter((p) => p.state !== "duplicate").length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-[13px]">
                {problems
                  .filter((p) => p.state !== "duplicate")
                  .map((p, i) => (
                    <li key={i}>
                      <span className="font-medium">{p.title}</span> — <span className="text-ink-3">{p.reason}</span>
                    </li>
                  ))}
              </ul>
            )}
            {restoring !== null && <ProgressBar ratio={restoring} label="Restore progress" />}
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function StorageCard() {
  const storage = useApp((s) => s.storage);
  const docs = useApp((s) => s.docs);
  useEffect(() => void refreshStorage(), []);
  const ratio = storage?.quota ? storage.usage / storage.quota : 0;
  return (
    <Card
      icon={<ShieldCheck size={20} />}
      title="Storage on this device"
      description="Documents are stored in this browser’s private storage for this site (IndexedDB). It isn’t encrypted, and anyone using this browser profile can open it."
    >
      {storage?.quota ? (
        <div>
          <div className="flex justify-between text-[13.5px]">
            <span>
              <strong className="font-semibold">{formatBytes(storage.usage)}</strong> used
            </span>
            <span className="text-ink-3">about {formatBytes(storage.quota)} available to this site</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
            <div className={cn("h-full rounded-full", ratio > 0.85 ? "bg-danger" : "bg-accent")} style={{ width: `${Math.max(1, Math.min(100, ratio * 100))}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">
            Originals: {formatBytes(docs.reduce((s, d) => s + d.size, 0))}. Browser figures are estimates and include extracted text, thumbnails and app files.
          </p>
        </div>
      ) : (
        <p className="text-[13.5px] text-ink-3">This browser doesn’t report storage usage.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-line p-3.5">
        <div className="min-w-0 flex-1 text-[13.5px]">
          <div className="font-medium">{storage?.persisted ? "Protected from automatic cleanup" : "May be cleared if disk space runs low"}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">
            {storage?.persisted
              ? "Your browser agreed to keep this site’s data until you delete it. Clearing browsing data still removes it."
              : "Browsers can evict site data under storage pressure (Safari may also clear it after weeks without a visit). Asking for persistent storage reduces that risk; backups remove it."}
          </div>
        </div>
        {!storage?.persisted && (
          <button type="button" className="btn btn-sm" onClick={() => void requestPersistence()}>
            Ask browser to keep data
          </button>
        )}
      </div>
    </Card>
  );
}

function OcrCard() {
  const on = useApp((s) => s.settings.ocrEnabled);
  return (
    <Card
      icon={<ScanText size={20} />}
      title="Text recognition (OCR)"
      description={`Reads text from photos and scanned PDFs so they become searchable. It runs entirely in this tab; the engine and English model (~${OCR_DOWNLOAD_MB} MB) are downloaded from this site the first time they’re needed — never your documents.`}
    >
      <label className="flex items-start gap-3 text-[14px]">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={on} onChange={(e) => void setSetting("ocrEnabled", e.target.checked)} data-testid="ocr-toggle" />
        <span>
          <span className="font-medium">Read text from images and scans automatically</span>
          <span className="mt-0.5 block text-[13px] text-ink-3">English only. Results depend on image quality; handwriting is rarely recognized. When off, you can still run it for a single document from its page.</span>
        </span>
      </label>
    </Card>
  );
}

function InlineRename({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (!editing)
    return (
      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => (setV(value), setEditing(true))} aria-label={`Rename ${label}`}>
        <Pencil size={13} />
      </button>
    );
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSave(v.trim());
        setEditing(false);
      }}
    >
      <input className="field h-7 min-h-0 w-40 text-[13px]" value={v} onChange={(e) => setV(e.target.value)} autoFocus aria-label={`New name for ${label}`} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
      <button type="submit" className="btn btn-sm btn-icon" aria-label="Save">
        <Check size={13} />
      </button>
    </form>
  );
}

function OrganizationCard() {
  const docs = useApp((s) => s.docs);
  const tags = useApp((s) => s.tags);
  const tagMap = useApp((s) => s.tagMap);
  const custom = useApp((s) => s.categories);
  const rules = useApp((s) => s.rules);
  const counts = useMemo(() => facetCounts(docs), [docs]);
  const [newCat, setNewCat] = useState("");
  const [ruleDraft, setRuleDraft] = useState<{ field: RuleField; contains: string; categoryId: string; tagName: string }>({ field: "anywhere", contains: "", categoryId: "", tagName: "" });
  const [offer, setOffer] = useState<{ rule: Rule; ids: string[] } | null>(null);
  const [delTag, setDelTag] = useState<string | null>(null);
  const cats = allCategories(custom);

  return (
    <Card icon={<Pencil size={20} />} title="Categories, tags & rules" description="Categories group documents; tags are free-form labels. Rules sort new documents automatically using words in their file name or text.">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="eyebrow mb-2">Categories</h3>
          <ul className="divide-y divide-line rounded-[10px] border border-line text-[14px]">
            {cats.map((c) => (
              <li key={c.id} className="flex min-h-10 items-center gap-2 px-3 py-1">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-[12px] text-ink-3 tnum">{counts.categories.get(c.id) ?? 0}</span>
                {!c.builtIn && (
                  <>
                    <InlineRename value={c.name} label={c.name} onSave={(v) => void renameCategory(c.id, v)} />
                    <button type="button" className="btn btn-ghost btn-sm btn-icon text-ink-3" onClick={() => void deleteCategory(c.id)} aria-label={`Delete category ${c.name}`}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await createCategory(newCat)) setNewCat("");
            }}
          >
            <input className="field h-8 min-h-0 text-[13.5px]" placeholder="New category, e.g. Car" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="New category name" />
            <button type="submit" className="btn btn-sm" disabled={!newCat.trim()}>
              Add
            </button>
          </form>
          <p className="mt-1.5 text-[12px] text-ink-3">{BUILT_IN_CATEGORIES.length} built-in categories can’t be renamed.</p>
        </div>

        <div>
          <h3 className="eyebrow mb-2">Tags</h3>
          {tags.length ? (
            <ul className="divide-y divide-line rounded-[10px] border border-line text-[14px]">
              {tags.map((t) => (
                <li key={t.id} className="flex min-h-10 items-center gap-2 px-3 py-1">
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="text-[12px] text-ink-3 tnum">{counts.tags.get(t.id) ?? 0}</span>
                  <InlineRename value={t.name} label={t.name} onSave={(v) => void renameTag(t.id, v)} />
                  <button type="button" className="btn btn-ghost btn-sm btn-icon text-ink-3" onClick={() => setDelTag(t.id)} aria-label={`Delete tag ${t.name}`}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-[10px] border border-dashed border-line-2 px-3 py-4 text-[13px] text-ink-3">No tags yet. Add them from a document’s page or with bulk actions in the library.</p>
          )}
        </div>
      </div>

      <div className="mt-7">
        <h3 className="eyebrow mb-2">Automatic rules</h3>
        {rules.length > 0 && (
          <ul className="mb-3 divide-y divide-line rounded-[10px] border border-line text-[13.5px]">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  If {r.field === "filename" ? "the file name" : r.field === "text" ? "the text" : "the file name or text"} contains <strong className="font-semibold">“{r.contains}”</strong>
                  <ArrowRight size={12} className="mx-1.5 inline text-ink-3" />
                  {[r.categoryId && categoryName(r.categoryId, custom), r.tagId && `tag “${tagMap.get(r.tagId)?.name}”`].filter(Boolean).join(" + ")}
                </span>
                <button type="button" className="btn btn-ghost btn-sm btn-icon text-ink-3" onClick={() => void deleteRule(r.id)} aria-label="Delete rule">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-2 rounded-[10px] border border-line bg-paper/50 p-3 text-[13.5px] sm:grid-cols-[auto_1fr_auto_auto_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const { createTag } = await import("@/lib/store/app");
            const tag = ruleDraft.tagName.trim() ? await createTag(ruleDraft.tagName) : null;
            const r = await addRule({ field: ruleDraft.field, contains: ruleDraft.contains, categoryId: ruleDraft.categoryId || null, tagId: tag?.id ?? null });
            if (!r) return;
            setRuleDraft({ field: "anywhere", contains: "", categoryId: "", tagName: "" });
            const ids = await ruleCandidates(r);
            if (ids.length) setOffer({ rule: r, ids });
            else toast("Rule added. It applies to documents you add from now on.", "success");
          }}
        >
          <select className="field h-8 min-h-0 py-0 text-[13px]" value={ruleDraft.field} onChange={(e) => setRuleDraft({ ...ruleDraft, field: e.target.value as RuleField })} aria-label="Where to look">
            <option value="anywhere">File name or text contains</option>
            <option value="filename">File name contains</option>
            <option value="text">Text contains</option>
          </select>
          <input className="field h-8 min-h-0 text-[13px]" placeholder="e.g. Northside Energy" value={ruleDraft.contains} onChange={(e) => setRuleDraft({ ...ruleDraft, contains: e.target.value })} aria-label="Words to look for" />
          <select className="field h-8 min-h-0 py-0 text-[13px]" value={ruleDraft.categoryId} onChange={(e) => setRuleDraft({ ...ruleDraft, categoryId: e.target.value })} aria-label="Set category">
            <option value="">No category</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input className="field h-8 min-h-0 text-[13px] sm:w-32" placeholder="Add tag" value={ruleDraft.tagName} onChange={(e) => setRuleDraft({ ...ruleDraft, tagName: e.target.value })} aria-label="Add tag" />
          <button type="submit" className="btn btn-sm h-8" disabled={!ruleDraft.contains.trim() || (!ruleDraft.categoryId && !ruleDraft.tagName.trim())}>
            Add rule
          </button>
        </form>
        <p className="mt-1.5 text-[12px] text-ink-3">Rules never change a category you picked yourself.</p>
      </div>

      <ConfirmDialog
        open={!!offer}
        onClose={() => setOffer(null)}
        title="Apply the new rule to existing documents?"
        confirmLabel={`Apply to ${plural(offer?.ids.length ?? 0, "document")}`}
        onConfirm={async () => {
          if (offer && (await applyRule(offer.rule, offer.ids))) toast(`Rule applied to ${plural(offer.ids.length, "document")}.`, "success");
          setOffer(null);
        }}
      >
        <p>{plural(offer?.ids.length ?? 0, "document")} in your library match. Documents whose category you chose yourself keep it.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!delTag}
        onClose={() => setDelTag(null)}
        danger
        title={`Delete the tag “${delTag ? tagMap.get(delTag)?.name : ""}”?`}
        confirmLabel="Delete tag"
        onConfirm={async () => {
          if (delTag) await deleteTag(delTag);
          setDelTag(null);
        }}
      >
        <p>It’s removed from {plural(delTag ? (counts.tags.get(delTag) ?? 0) : 0, "document")}. The documents themselves aren’t affected.</p>
      </ConfirmDialog>
    </Card>
  );
}

function DataCard() {
  const workspace = useApp((s) => s.workspace);
  const docs = useApp((s) => s.docs);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card icon={<Trash2 size={20} />} title={workspace === "sample" ? "Sample workspace" : "Delete data"} description={workspace === "sample" ? "You’re viewing sample documents in a separate workspace." : "Remove everything PAPERTRAIL has stored in this browser."}>
      {workspace === "sample" ? (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await discardSamples();
            router.push("/");
          }}
        >
          <FlaskConical size={15} /> Discard samples and go to my library
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-danger" disabled={!docs.length} onClick={() => setOpen(true)} data-testid="delete-all">
            <Trash2 size={15} /> Delete all documents and data
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await enterSamples();
              router.push("/");
            }}
          >
            <FlaskConical size={15} /> Open sample workspace
          </button>
        </div>
      )}
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setTyped("");
        }}
        danger
        busy={busy}
        confirmDisabled={typed !== "DELETE"}
        title="Delete everything?"
        confirmLabel="Delete all data"
        onConfirm={async () => {
          setBusy(true);
          const ok = await clearAllData();
          setBusy(false);
          setOpen(false);
          setTyped("");
          if (ok) {
            toast("All documents and data were deleted from this browser.", "success");
            router.push("/");
          }
        }}
      >
        <p>
          All {plural(docs.length, "document")}, extracted text, tags, categories, rules, dates and settings are permanently removed from this browser. Backup files you downloaded are not affected.
        </p>
        <label className="block text-[13px] font-medium text-ink-2">
          Type DELETE to confirm
          <input className="field mt-1.5" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="delete-confirm-input" />
        </label>
      </ConfirmDialog>
    </Card>
  );
}

export function SettingsPage() {
  useEffect(() => {
    if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView();
  }, []);
  return (
    <main className="mx-auto max-w-[860px] space-y-5 px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pt-9">
      <div className="mb-2">
        <h1 className="serif text-[32px] font-medium tracking-[-0.015em]">Settings</h1>
        <p className="mt-1 text-[14.5px] text-ink-3">
          Everything here applies to this browser only.{" "}
          <Link href="/privacy/" className="link">
            How your data is handled
          </Link>
        </p>
      </div>
      <BackupCard />
      <StorageCard />
      <OcrCard />
      <OrganizationCard />
      <DataCard />
    </main>
  );
}
