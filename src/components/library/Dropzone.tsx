"use client";

import { useState, type ReactNode } from "react";
import { filesFromDataTransfer, hasFiles } from "@/lib/ingest/drop";
import { cn } from "@/lib/util";
import { pickFiles, requestImport } from "@/components/shell/import-request";

export function Dropzone({ children, className }: { children: ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  return (
    // A drop target for mouse users; the button inside is the keyboard/screen-reader control.
    <div
      data-dropzone
      data-over={over}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button,a")) return;
        pickFiles();
      }}
      onDragOver={(e) => {
        if (!hasFiles(e.nativeEvent)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        if (!hasFiles(e.nativeEvent)) return;
        e.preventDefault();
        setOver(false);
        requestImport(await filesFromDataTransfer(e.dataTransfer));
      }}
      className={cn(
        "group relative rounded-[18px] border border-dashed border-line-2 bg-card transition-[border-color,background-color,box-shadow] duration-150 hover:border-ink-4 data-[over=true]:border-accent data-[over=true]:bg-accent-soft data-[over=true]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_14%,transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
