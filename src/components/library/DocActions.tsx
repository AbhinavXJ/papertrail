"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Download, ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { DocumentRecord } from "@/lib/types";
import { deleteDocuments, getDocumentFile, updateDocument } from "@/lib/store/app";
import { toast } from "@/lib/store/store";
import { downloadBlob } from "@/lib/download";
import { plural } from "@/lib/util";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { MenuItem, MenuSeparator, Popover } from "@/components/ui/Popover";
import { docHref } from "./DocBits";

export async function downloadOriginal(doc: DocumentRecord) {
  const blob = await getDocumentFile(doc.id).catch(() => null);
  if (!blob) return toast("The original file couldn't be read from storage.", "error");
  downloadBlob(blob, doc.fileName);
}

export function RenameDialog({ doc, open, onClose }: { doc: DocumentRecord; open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(doc.title);
  useEffect(() => {
    if (open) setTitle(doc.title);
  }, [open, doc.title]);
  const save = async () => {
    const t = title.trim();
    if (t && t !== doc.title) await updateDocument(doc.id, { title: t });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename document"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!title.trim()}>
            Save
          </button>
        </>
      }
    >
      <label className="block text-[13px] font-medium text-ink-2" htmlFor="rename-input">
        Title
      </label>
      <input
        id="rename-input"
        className="field mt-1.5"
        value={title}
        autoFocus
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      <p className="mt-2 text-[12.5px] text-ink-3">The original file name ({doc.fileName}) is kept and stays searchable.</p>
    </Dialog>
  );
}

export function DeleteDialog({ ids, open, onClose, onDeleted }: { ids: readonly string[]; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      danger
      busy={busy}
      title={ids.length === 1 ? "Delete this document?" : `Delete ${plural(ids.length, "document")}?`}
      confirmLabel="Delete permanently"
      onConfirm={async () => {
        setBusy(true);
        const ok = await deleteDocuments(ids);
        setBusy(false);
        if (ok) {
          toast(ids.length === 1 ? "Document deleted." : `${plural(ids.length, "document")} deleted.`, "success");
          onDeleted?.();
        }
        onClose();
      }}
    >
      <p>The original file, its extracted text, notes and important dates are removed from this browser. This can’t be undone unless you have a backup.</p>
    </ConfirmDialog>
  );
}

export function RowMenu({ doc }: { doc: DocumentRecord }) {
  const router = useRouter();
  const [rename, setRename] = useState(false);
  const [del, setDel] = useState(false);
  return (
    <>
      <Popover menu align="end" label={`Actions for ${doc.title}`} iconLabel={`Actions for ${doc.title}`} buttonClassName="btn btn-ghost btn-sm btn-icon" trigger={<MoreHorizontal size={16} />}>
        {(close) => (
          <>
            <MenuItem icon={<ExternalLink size={15} />} onSelect={() => router.push(docHref(doc.id))}>
              Open
            </MenuItem>
            <MenuItem
              icon={<Pencil size={15} />}
              onSelect={() => {
                close();
                setRename(true);
              }}
            >
              Rename…
            </MenuItem>
            <MenuItem
              icon={<Download size={15} />}
              onSelect={() => {
                close();
                void downloadOriginal(doc);
              }}
            >
              Download original
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              danger
              icon={<Trash2 size={15} />}
              onSelect={() => {
                close();
                setDel(true);
              }}
            >
              Delete…
            </MenuItem>
          </>
        )}
      </Popover>
      <RenameDialog doc={doc} open={rename} onClose={() => setRename(false)} />
      <DeleteDialog ids={[doc.id]} open={del} onClose={() => setDel(false)} />
    </>
  );
}
