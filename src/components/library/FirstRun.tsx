"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarClock, FileSearch, HardDriveDownload, Lock, Upload } from "lucide-react";
import { enterSamples } from "@/lib/store/app";
import { SUPPORTED_LABEL } from "@/lib/ingest/sniff";
import { pickFiles } from "@/components/shell/import-request";
import { Wordmark } from "@/components/shell/Wordmark";
import { Dropzone } from "./Dropzone";

export function FirstRun() {
  const [loading, setLoading] = useState(false);
  return (
    <main className="min-h-dvh">
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-6 pt-6 sm:px-10">
        <Wordmark />
        <Link href="/privacy/" className="text-[14px] text-ink-2 hover:text-ink">
          How your data is handled
        </Link>
      </header>

      <section className="mx-auto max-w-[760px] px-6 pb-16 pt-[min(12vh,110px)] text-center sm:px-10">
        <h1 className="serif text-[clamp(38px,6.4vw,62px)] font-[450] leading-[1.04] tracking-[-0.025em] text-ink animate-rise">
          Your documents.
          <br />
          <em className="font-[400] text-ink-2">Finally, in one place.</em>
        </h1>
        <p className="mx-auto mt-5 max-w-[520px] text-[17px] leading-relaxed text-ink-2">Keep receipts, bills, warranties and important files searchable on your device.</p>

        <Dropzone className="mx-auto mt-10 max-w-[620px] px-6 py-10 text-left sm:px-10">
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
              <Upload size={21} />
            </span>
            <div>
              <div className="text-[17px] font-semibold text-ink">Drop files here to start your library</div>
              <div className="mt-1 text-[13.5px] text-ink-3">{SUPPORTED_LABEL} · multiple files or whole folders</div>
            </div>
            <button type="button" className="btn btn-primary btn-lg" onClick={pickFiles}>
              Choose files
            </button>
          </div>
        </Dropzone>

        <p className="mx-auto mt-5 flex max-w-[560px] items-start justify-center gap-2 text-left text-[13.5px] leading-relaxed text-ink-3">
          <Lock size={14} className="mt-[3px] shrink-0 text-ok" />
          <span>
            Files are read and stored in this browser on this device. Nothing is uploaded and there’s no account.{" "}
            <Link href="/privacy/" className="link">
              Details
            </Link>
          </span>
        </p>

        <div className="mt-9 flex flex-col items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost text-accent"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              await enterSamples();
            }}
          >
            {loading ? "Preparing samples…" : "Explore with sample documents"} <ArrowRight size={15} />
          </button>
          <span className="text-[12.5px] text-ink-3">Opens a separate sample workspace you can discard any time.</span>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1000px] gap-8 border-t border-line px-6 py-12 text-left sm:grid-cols-3 sm:px-10" aria-label="What Papertrail does">
        {[
          { icon: <FileSearch size={18} />, title: "Find anything", body: "Search the words inside your PDFs and scans, plus names, tags and notes — results show the matching passage." },
          { icon: <CalendarClock size={18} />, title: "Remember dates", body: "Mark warranty expiries, renewals and due dates, see what’s coming up, or add them to your calendar." },
          { icon: <HardDriveDownload size={18} />, title: "Keep a backup", body: "Export everything — originals and details — as one ZIP file you can restore in any browser." },
        ].map((f) => (
          <div key={f.title}>
            <div className="flex items-center gap-2 text-ink">
              <span className="text-accent">{f.icon}</span>
              <h2 className="text-[15px] font-semibold">{f.title}</h2>
            </div>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-3">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
