"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, ExternalLink, FlaskConical, Pencil, Trash2 } from "lucide-react";
import type { DocumentRecord, TextRecord } from "@/lib/types";
import type { HighlightSpec } from "@/lib/search/tokenize";
import { useApp } from "@/lib/store/store";
import { getDocumentFile, getDocumentText, runSearch, updateDocument } from "@/lib/store/app";
import { openBlob } from "@/lib/download";
import { useMediaQuery } from "@/lib/hooks";
import { categoryName } from "@/lib/organize/categories";
import { cn, formatBytes } from "@/lib/util";
import { Spinner, StatusPill } from "@/components/ui/Status";
import { DeleteDialog, downloadOriginal } from "@/components/library/DocActions";
import { KIND_LABEL } from "@/components/library/DocBits";
import { PdfViewer } from "./PdfViewer";
import { ExtractedText, ImageViewer, TextFileViewer } from "./Viewers";
import { DetailsPanel } from "./DetailsPanel";
import { TabList, panelId, tabId } from "@/components/ui/Tabs";

type Tab = "original" | "text" | "details";

/** The document title; click it (or the pencil) to rename. Enter saves, Escape cancels. */
function EditableTitle({ doc }: { doc: DocumentRecord }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(doc.title);
  const [saved, setSaved] = useState(false);
  const skipBlur = useRef(false);
  useEffect(() => {
    if (!editing) setV(doc.title);
  }, [doc.title, editing]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1800);
    return () => clearTimeout(t);
  }, [saved]);
  const save = async () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    const t = v.trim();
    setEditing(false);
    if (t && t !== doc.title && (await updateDocument(doc.id, { title: t }))) setSaved(true);
    else setV(doc.title);
  };
  const startEditing = () => {
    skipBlur.current = false;
    setEditing(true);
  };
  const cls = "serif text-[clamp(24px,3vw,32px)] font-medium leading-tight tracking-[-0.015em] text-ink";
  if (editing)
    return (
      <div className="mt-1">
        <label htmlFor="title-input" className="sr-only">
          Document title
        </label>
        <input
          id="title-input"
          data-testid="title-input"
          autoFocus
          value={v}
          maxLength={200}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              skipBlur.current = true;
              setV(doc.title);
              setEditing(false);
            }
          }}
          className={cn(cls, "-mx-2 w-[calc(100%+1rem)] rounded-md border border-accent bg-card px-2 py-0.5 shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_16%,transparent)] focus:outline-none")}
        />
        <p className="mt-1 text-[12px] text-ink-3">Enter to save · Esc to cancel · the original file name ({doc.fileName}) stays searchable</p>
      </div>
    );
  return (
    <div className="group mt-1 flex items-start gap-2">
      <h1 className={cn(cls, "min-w-0 cursor-text break-words")} data-testid="doc-title" onClick={startEditing}>
        {doc.title}
      </h1>
      <button type="button" className="btn btn-ghost btn-sm btn-icon mt-1 shrink-0 text-ink-3 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100" onClick={startEditing} aria-label="Rename document" data-testid="rename-title">
        <Pencil size={15} />
      </button>
      <span className={cn("mt-3 text-[12px] text-ok transition-opacity", saved ? "opacity-100" : "opacity-0")} aria-live="polite">
        {saved ? "Saved" : ""}
      </span>
    </div>
  );
}

export function DocumentPage() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || null;
  const router = useRouter();
  const doc = useApp((s) => s.docMap.get(id));
  const allDates = useApp((s) => s.dates);
  const custom = useApp((s) => s.categories);
  const workspace = useApp((s) => s.workspace);
  const searchReady = useApp((s) => s.searchReady);
  const revision = useApp((s) => s.revision);
  const dates = useMemo(() => allDates.filter((d) => d.docId === id), [allDates, id]);

  const [blob, setBlob] = useState<Blob | null | undefined>(undefined);
  const [text, setText] = useState<TextRecord | null | undefined>(undefined);
  const [spec, setSpec] = useState<HighlightSpec | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("original");
  const [del, setDel] = useState(false);
  const wide = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    setBlob(undefined);
    setViewError(null);
    if (!id) return;
    let alive = true;
    getDocumentFile(id)
      .then((b) => alive && setBlob(b))
      .catch(() => alive && setBlob(null));
    return () => {
      alive = false;
    };
  }, [id]);

  const textVersion = doc?.extraction.updatedAt;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    getDocumentText(id)
      .then((t) => alive && setText(t))
      .catch(() => alive && setText(null));
    return () => {
      alive = false;
    };
  }, [id, textVersion]);

  // Highlight the words of the search that led here (same matching rules as search).
  useEffect(() => {
    if (!q || !searchReady || !id) return setSpec(null);
    let alive = true;
    runSearch(q, [id])
      .then((r) => alive && setSpec(r.spec))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [q, id, searchReady, revision]);

  const onViewError = useCallback((m: string) => setViewError(m), []);

  if (!doc)
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="serif text-2xl">Document not found</h1>
        <p className="mt-2 text-ink-3">It may have been deleted{workspace === "sample" ? ", or it belongs to your own library rather than the sample workspace" : ""}.</p>
        <Link href="/" className="btn btn-primary mt-6">
          Back to library
        </Link>
      </main>
    );

  const cat = categoryName(doc.categoryId, custom);
  const back = q ? `/?q=${encodeURIComponent(q)}` : "/";
  // Text files are their own extracted text. On narrow screens the details move into a tab
  // so editing doesn't require scrolling past the whole document.
  const tabs: Array<[Tab, string]> = [[ "original", doc.kind === "pdf" ? "PDF" : doc.kind === "image" ? "Image" : "Document" ]];
  if (doc.kind !== "text") tabs.push(["text", "Extracted text"]);
  if (!wide) tabs.push(["details", "Details"]);
  const showTabs = tabs.length > 1;
  const activeTab: Tab = tabs.some(([t]) => t === tab) ? tab : "original";

  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-20 pt-5 sm:px-6 lg:px-10">
      <div className="flex flex-wrap items-center gap-2">
        {/* scroll={false}: the library restores its own scroll position. */}
        <Link href={back} scroll={false} className="btn btn-ghost btn-sm -ml-2 text-ink-2">
          <ArrowLeft size={15} /> {q ? `Results for “${q}”` : "Library"}
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="btn btn-sm" onClick={() => void downloadOriginal(doc)}>
            <Download size={14} /> <span className="hidden sm:inline">Download</span>
          </button>
          <button type="button" className="btn btn-sm" disabled={!blob} onClick={() => blob && openBlob(blob)} title="Open the original in a new tab">
            <ExternalLink size={14} /> <span className="hidden sm:inline">Open original</span>
          </button>
          <button type="button" className="btn btn-sm text-danger" onClick={() => setDel(true)}>
            <Trash2 size={14} /> <span className="hidden sm:inline">Delete</span>
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start xl:gap-10">
        <div className="min-w-0">
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
              {workspace === "sample" && (
                <span className="inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-warn">
                  <FlaskConical size={11} /> Sample
                </span>
              )}
              <span>{KIND_LABEL[doc.kind]}</span>
              <span aria-hidden>·</span>
              <span>{formatBytes(doc.size)}</span>
              {doc.extraction.pageCount !== undefined && (
                <>
                  <span aria-hidden>·</span>
                  <span>{doc.extraction.pageCount} {doc.extraction.pageCount === 1 ? "page" : "pages"}</span>
                </>
              )}
              {cat && (
                <>
                  <span aria-hidden>·</span>
                  <span>{cat}</span>
                </>
              )}
              {doc.extraction.status !== "completed" && <StatusPill status={doc.extraction.status} className="ml-1" />}
            </div>
            <EditableTitle doc={doc} />
          </div>

          {showTabs && (
            <TabList
              prefix="doc"
              label="View"
              className="mb-4"
              value={activeTab}
              onChange={setTab}
              tabs={tabs.map(([t, label]) => ({
                id: t,
                label: (
                  <>
                    {label}
                    {t === "text" && doc.textLength > 0 && <span className="ml-1.5 text-[12px] font-normal text-ink-3 tnum">{doc.textLength.toLocaleString()}</span>}
                  </>
                ),
              }))}
            />
          )}

          <div
            id={showTabs ? panelId("doc", activeTab) : undefined}
            role={showTabs ? "tabpanel" : undefined}
            aria-labelledby={showTabs ? tabId("doc", activeTab) : undefined}
          >
            {activeTab === "details" ? (
              <div className="card overflow-hidden">
                <DetailsPanel doc={doc} dates={dates} />
              </div>
            ) : activeTab === "text" ? (
              text === undefined ? (
                <Spinner />
              ) : (
                <ExtractedText text={text} spec={spec} kind={doc.kind} />
              )
            ) : blob === undefined ? (
              <div className="flex items-center gap-2 py-16 text-[14px] text-ink-3">
                <Spinner /> Loading original…
              </div>
            ) : blob === null ? (
              <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-5 py-8 text-center text-[14px] text-danger">The original file is missing from this browser’s storage. If you have a backup, restore it from Settings.</div>
            ) : viewError ? (
              <div className="rounded-[10px] border border-dashed border-line-2 px-6 py-12 text-center">
                <p className="text-[14.5px] text-ink-2">{viewError}</p>
                <p className="mt-1 text-[13.5px] text-ink-3">The preview isn’t available, but the original file is stored unchanged.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => void downloadOriginal(doc)}>
                    <Download size={14} /> Download
                  </button>
                  {doc.textLength > 0 && (
                    <button type="button" className="btn btn-sm" onClick={() => setTab("text")}>
                      View extracted text
                    </button>
                  )}
                </div>
              </div>
            ) : doc.kind === "pdf" ? (
              <PdfViewer blob={blob} spec={spec} initialPage={page} onError={onViewError} />
            ) : doc.kind === "image" ? (
              <ImageViewer blob={blob} alt={doc.title} />
            ) : (
              <TextFileViewer blob={blob} doc={doc} spec={spec} />
            )}
          </div>
        </div>

        {wide && (
          <aside className="card sticky top-5 max-h-[calc(100dvh-2.5rem)] overflow-hidden overflow-y-auto" aria-label="Document details">
            <DetailsPanel doc={doc} dates={dates} />
          </aside>
        )}
      </div>
      <DeleteDialog ids={[doc.id]} open={del} onClose={() => setDel(false)} onDeleted={() => router.push("/")} />
    </main>
  );
}
