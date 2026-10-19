"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { DocumentRecord } from "@/lib/types";
import { useApp } from "@/lib/store/store";
import { addTag, createTag, removeTag } from "@/lib/store/app";
import { cn, fold } from "@/lib/util";

/** Tag chips with a combobox to add an existing tag or create a new one. */
export function TagEditor({ doc }: { doc: DocumentRecord }) {
  const tags = useApp((s) => s.tags);
  const tagMap = useApp((s) => s.tagMap);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const options = useMemo(() => {
    const f = fold(value.trim());
    return tags.filter((t) => !doc.tagIds.includes(t.id) && (!f || fold(t.name).includes(f))).slice(0, 8);
  }, [tags, doc.tagIds, value]);
  const exact = tags.find((t) => fold(t.name) === fold(value.trim()));
  const canCreate = !!value.trim() && !exact;
  const items = [...options.map((t) => ({ key: t.id, label: t.name, run: () => addTag([doc.id], [t.id]) })), ...(canCreate ? [{ key: "__new", label: `Create “${value.trim()}”`, run: async () => { const t = await createTag(value); if (t) await addTag([doc.id], [t.id]); } }] : [])];

  const choose = async (i: number) => {
    const it = items[i];
    if (!it) return;
    await it.run();
    setValue("");
    setActive(0);
    input.current?.focus();
  };

  return (
    <div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
        {doc.tagIds.map((id) => {
          const t = tagMap.get(id);
          if (!t) return null;
          return (
            <li key={id} className="tag h-7 pr-1 text-[12.5px]">
              {t.name}
              <button type="button" className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink" onClick={() => void removeTag([doc.id], id)} aria-label={`Remove tag ${t.name}`}>
                <X size={12} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="relative mt-2">
        <Plus size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          ref={input}
          className="field h-8 min-h-0 pl-8 text-[13.5px]"
          placeholder="Add a tag"
          value={value}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls="tag-options"
          aria-autocomplete="list"
          aria-label="Add a tag"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setValue(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (exact && !doc.tagIds.includes(exact.id) && !options.length) void addTag([doc.id], [exact.id]).then(() => setValue(""));
              else void choose(active);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        {open && items.length > 0 && (
          <ul id="tag-options" role="listbox" className="popover absolute inset-x-0 top-[calc(100%+4px)] z-30 max-h-56 overflow-y-auto p-1">
            {items.map((it, i) => (
              <li
                key={it.key}
                role="option"
                aria-selected={i === active}
                className={cn("menu-item cursor-pointer text-[13.5px]", it.key === "__new" && "text-accent")}
                data-active={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void choose(i);
                }}
              >
                {it.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
