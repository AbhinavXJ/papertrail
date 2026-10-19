"use client";

import { useState } from "react";
import { Download, FolderInput, Tag as TagIcon, Trash2, X } from "lucide-react";
import { useApp, toast } from "@/lib/store/store";
import { setView, useLibraryView } from "@/lib/store/library-view";
import { addTag, createTag, exportBackup, removeTag, setCategory } from "@/lib/store/app";
import { allCategories } from "@/lib/organize/categories";
import { fold, plural } from "@/lib/util";
import { Popover } from "@/components/ui/Popover";
import { DeleteDialog } from "./DocActions";

export function BulkBar() {
  const { selected } = useLibraryView();
  const docMap = useApp((s) => s.docMap);
  const tags = useApp((s) => s.tags);
  const custom = useApp((s) => s.categories);
  const [newTag, setNewTag] = useState("");
  const [del, setDel] = useState(false);
  const [exporting, setExporting] = useState(false);
  const ids = [...selected].filter((id) => docMap.has(id));
  if (!ids.length) return null;
  const clear = () => setView({ selected: new Set() });
  const hasTag = (tagId: string) => ids.filter((id) => docMap.get(id)!.tagIds.includes(tagId)).length;

  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-6 flex justify-center" role="region" aria-label="Bulk actions">
      <div className="popover pointer-events-auto flex flex-wrap items-center gap-1 px-2 py-1.5 animate-rise">
        <span className="px-2 text-[13.5px] font-semibold tnum" aria-live="polite">
          {plural(ids.length, "selected", "selected")}
        </span>
        <Popover label="Tag selected documents" buttonClassName="btn btn-ghost btn-sm" trigger={<><TagIcon size={14} /> Tag</>} className="bottom-[calc(100%+6px)] top-auto w-64">
          {(close) => (
            <div>
              <form
                className="mb-1.5 flex gap-1.5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const t = await createTag(newTag);
                  if (t && (await addTag(ids, [t.id]))) {
                    toast(`Tagged ${plural(ids.length, "document")} “${t.name}”.`, "success");
                    setNewTag("");
                    close();
                  }
                }}
              >
                <input className="field h-8 min-h-0 text-[13px]" placeholder="New or existing tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} aria-label="Tag name" />
                <button type="submit" className="btn btn-sm btn-primary" disabled={!newTag.trim()}>
                  Add
                </button>
              </form>
              <div className="max-h-56 overflow-y-auto">
                {tags
                  .filter((t) => !newTag || fold(t.name).includes(fold(newTag)))
                  .map((t) => {
                    const n = hasTag(t.id);
                    const all = n === ids.length;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className="menu-item"
                        onClick={async () => {
                          if (all) await removeTag(ids, t.id);
                          else await addTag(ids, [t.id]);
                        }}
                      >
                        <span className="flex-1 truncate">{t.name}</span>
                        <span className="text-[12px] text-ink-3">{all ? "Remove" : n ? `Add to ${ids.length - n} more` : "Add"}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </Popover>
        <Popover menu label="Set category" buttonClassName="btn btn-ghost btn-sm" trigger={<><FolderInput size={14} /> Category</>} className="bottom-[calc(100%+6px)] top-auto max-h-80 overflow-y-auto">
          {(close) => (
            <>
              {allCategories(custom).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={async () => {
                    close();
                    if (await setCategory(ids, c.id)) toast(`Moved ${plural(ids.length, "document")} to ${c.name}.`, "success");
                  }}
                >
                  {c.name}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="menu-item text-ink-3"
                onClick={async () => {
                  close();
                  await setCategory(ids, null);
                }}
              >
                Remove category
              </button>
            </>
          )}
        </Popover>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            await exportBackup({ ids });
            setExporting(false);
          }}
          title="Download the selected originals and their details as a ZIP backup"
        >
          <Download size={14} /> {exporting ? "Exporting…" : "Export"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setDel(true)}>
          <Trash2 size={14} /> Delete
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={clear} aria-label="Clear selection">
          <X size={15} />
        </button>
      </div>
      <DeleteDialog ids={ids} open={del} onClose={() => setDel(false)} onDeleted={clear} />
    </div>
  );
}
