"use client";

import { useMemo, useState } from "react";
import { HardDriveDownload, X } from "lucide-react";
import { useApp } from "@/lib/store/store";
import { exportBackup, setSetting } from "@/lib/store/app";
import { plural, timeAgo } from "@/lib/util";

const DAY = 86_400_000;

/** Reminds the user to export a backup when a meaningful part of the library isn't in one. */
export function BackupNudge() {
  const docs = useApp((s) => s.docs);
  const settings = useApp((s) => s.settings);
  const workspace = useApp((s) => s.workspace);
  const [busy, setBusy] = useState(false);
  const unbacked = useMemo(() => (settings.lastBackupAt ? docs.filter((d) => d.updatedAt > settings.lastBackupAt!).length : docs.length), [docs, settings.lastBackupAt]);
  const now = Date.now();
  const dismissed = settings.backupNudgeDismissedAt && now - settings.backupNudgeDismissedAt < 7 * DAY;
  const due = settings.lastBackupAt ? unbacked >= 10 || (unbacked > 0 && now - settings.lastBackupAt > 30 * DAY) : docs.length >= 3;
  if (workspace !== "user" || dismissed || !due) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[12px] border border-line-2 bg-card px-4 py-3 shadow-[var(--shadow-soft)]" role="region" aria-label="Backup reminder">
      <HardDriveDownload size={18} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink-2">
        <strong className="font-semibold text-ink">
          {settings.lastBackupAt ? `${plural(unbacked, "document")} changed since your last backup (${timeAgo(settings.lastBackupAt)}).` : `${plural(docs.length, "document")} aren’t backed up yet.`}
        </strong>{" "}
        Browser storage can be cleared, so keep a copy somewhere safe.
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await exportBackup();
            setBusy(false);
          }}
        >
          {busy ? "Preparing…" : "Export backup"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Remind me in a week" title="Remind me in a week" onClick={() => void setSetting("backupNudgeDismissedAt", Date.now())}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
