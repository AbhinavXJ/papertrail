"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { FlaskConical, Menu, Plus, X } from "lucide-react";
import { useApp, dismissToast } from "@/lib/store/store";
import { boot, discardSamples } from "@/lib/store/app";
import { filesFromDataTransfer, hasFiles } from "@/lib/ingest/drop";
import { cn } from "@/lib/util";
import { useSearchShortcut } from "@/lib/hooks";
import { requestSearchFocus } from "@/lib/store/library-view";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Status";
import { Sidebar } from "./Sidebar";
import { ImportTray } from "./ImportTray";
import { Wordmark } from "./Wordmark";
import { cancelPendingImport, confirmPendingImport, pickFiles, requestImport, usePendingImport } from "./import-request";

/** The first-run screen replaces the whole layout while the user's library is empty. */
export function useIsFirstRun(): boolean {
  const path = usePathname();
  const phase = useApp((s) => s.phase);
  const ws = useApp((s) => s.workspace);
  const empty = useApp((s) => s.docs.length === 0 && s.queue.length === 0 && !s.busy);
  return phase === "ready" && path === "/" && ws === "user" && empty;
}

function DropOverlay() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      // A drop zone inside the page handles its own drops.
      if ((e.target as HTMLElement | null)?.closest?.("[data-dropzone]")) return;
      requestImport(await filesFromDataTransfer(e.dataTransfer));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-paper/80 backdrop-blur-[2px]" aria-hidden>
      <div className="rounded-2xl border-2 border-dashed border-accent bg-card px-10 py-8 text-center shadow-[var(--shadow-pop)]">
        <div className="serif text-2xl">Drop to add to your library</div>
        <div className="mt-1 text-sm text-ink-3">Files stay on this device</div>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-3" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex max-w-[min(92vw,560px)] items-start gap-3 rounded-lg px-4 py-2.5 text-[14px] shadow-[var(--shadow-pop)] animate-rise",
            t.tone === "error" ? "bg-danger text-danger-ink" : "bg-ink text-paper",
          )}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SampleBanner() {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="border-b border-warn/25 bg-warn-soft text-warn" role="region" aria-label="Sample workspace">
      <div className="flex items-center gap-x-3 gap-y-2 px-4 py-2 text-[13.5px] sm:px-5 lg:px-10">
        <FlaskConical size={16} className="hidden shrink-0 sm:block" />
        <p className="min-w-0 flex-1 leading-snug">
          <strong className="font-semibold">Sample workspace.</strong> <span className="sm:hidden">Example documents, not yours.</span>
          <span className="hidden sm:inline">These are example documents, not yours. Nothing you do here touches your own library.</span>
        </p>
        <button type="button" className="btn btn-sm shrink-0 border-warn/40 bg-transparent text-warn shadow-none hover:bg-warn/10" onClick={() => setConfirm(true)}>
          <span className="sm:hidden">Start fresh</span>
          <span className="hidden sm:inline">Discard samples &amp; start fresh</span>
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        busy={busy}
        title="Discard the sample workspace?"
        confirmLabel="Discard samples"
        onConfirm={async () => {
          setBusy(true);
          await discardSamples();
          setBusy(false);
          setConfirm(false);
          router.push("/");
        }}
      >
        <p>All sample documents and their dates are deleted. Your own library isn’t affected.</p>
      </ConfirmDialog>
    </div>
  );
}

function PendingImportDialog() {
  const pending = usePendingImport();
  return (
    <ConfirmDialog
      open={!!pending}
      onClose={cancelPendingImport}
      onConfirm={() => void confirmPendingImport()}
      title="Add these files to your own library?"
      confirmLabel="Go to my library and add"
    >
      <p>You’re in the sample workspace. Your files go into your own library, separate from the samples, so the two are never mixed.</p>
      <p className="text-ink-3">{pending?.length === 1 ? `1 file: ${pending[0].name}` : `${pending?.length ?? 0} files`}</p>
    </ConfirmDialog>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const phase = useApp((s) => s.phase);
  const error = useApp((s) => s.error);
  const workspace = useApp((s) => s.workspace);
  const busy = useApp((s) => s.busy);
  const firstRun = useIsFirstRun();
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();

  const router = useRouter();

  useEffect(() => {
    void boot();
  }, []);
  useEffect(() => setDrawer(false), [path]);
  // "/" or Cmd/Ctrl+K from anywhere: focus the library search (navigating there if needed).
  useSearchShortcut(() => {
    const el = document.getElementById("library-search");
    if (el) el.focus();
    else {
      requestSearchFocus();
      router.push("/");
    }
  });

  if (phase === "error")
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-md text-center">
          <Wordmark className="justify-center" />
          <h1 className="serif mt-8 text-2xl">PAPERTRAIL can’t open its storage</h1>
          <p className="mt-3 text-ink-2">{error}</p>
          <button type="button" className="btn btn-primary mt-6" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );

  if (phase === "booting")
    return (
      <main className="grid min-h-dvh place-items-center" aria-busy="true">
        <div className="flex flex-col items-center gap-4 text-ink-3">
          <Wordmark />
          <Spinner />
          <span className="sr-only">Opening your library…</span>
        </div>
      </main>
    );

  return (
    <>
      {firstRun ? (
        children
      ) : (
        <div className="lg:grid lg:min-h-dvh lg:grid-cols-[256px_1fr]">
          <aside className="sticky top-0 hidden h-dvh border-r border-line bg-paper-2/50 lg:block">
            <Sidebar />
          </aside>
          {drawer && (
            <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
              <button type="button" className="absolute inset-0 bg-ink/30" aria-label="Close menu" onClick={() => setDrawer(false)} />
              <div className="absolute inset-y-0 left-0 w-[min(86vw,300px)] border-r border-line bg-paper shadow-[var(--shadow-pop)] animate-rise">
                <Sidebar onNavigate={() => setDrawer(false)} />
              </div>
            </div>
          )}
          <div className="min-w-0">
            <a href="#content" className="sr-only z-50 rounded-md bg-ink px-3 py-2 text-paper focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
              Skip to content
            </a>
            <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-paper/90 px-3 backdrop-blur lg:hidden">
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setDrawer(true)} aria-label="Open menu">
                <Menu size={19} />
              </button>
              <Link href="/" className="flex-1">
                <Wordmark />
              </Link>
              <button type="button" className="btn btn-primary btn-sm" onClick={pickFiles}>
                <Plus size={15} /> Add
              </button>
            </header>
            {workspace === "sample" && <SampleBanner />}
            {busy && (
              <div className="flex items-center gap-2 border-b border-line bg-card px-5 py-2 text-[13.5px] text-ink-2 lg:px-10">
                <Spinner size={14} /> {busy}
              </div>
            )}
            <div id="content" tabIndex={-1} className="outline-none">
              {children}
            </div>
          </div>
        </div>
      )}
      <ImportTray />
      <DropOverlay />
      <PendingImportDialog />
      <Toasts />
    </>
  );
}
