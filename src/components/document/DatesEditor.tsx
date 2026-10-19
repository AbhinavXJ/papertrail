"use client";

import { useState } from "react";
import { CalendarPlus, Check, MoreHorizontal } from "lucide-react";
import type { DateKind, DocumentRecord, ImportantDate } from "@/lib/types";
import { addDate, deleteDate, updateDate } from "@/lib/store/app";
import { DATE_KINDS, DATE_KIND_ORDER, REMIND_OPTIONS } from "@/lib/dates/kinds";
import { reminderState } from "@/lib/dates/reminders";
import { buildIcs } from "@/lib/dates/ics";
import { downloadBlob } from "@/lib/download";
import { cn, daysBetween, formatISODate, isValidISODate, relativeDays, safeFileName, todayISO } from "@/lib/util";
import { MenuItem, MenuSeparator, Popover } from "@/components/ui/Popover";

export interface DateDraft {
  kind: DateKind;
  date: string;
  note: string;
  remindDays: number | null;
}

export function DateForm({ initial, onSave, onCancel, saveLabel = "Save date" }: { initial: DateDraft; onSave: (d: DateDraft) => Promise<unknown>; onCancel: () => void; saveLabel?: string }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const valid = isValidISODate(d.date);
  return (
    <form
      className="space-y-2.5 rounded-[10px] border border-line bg-paper/60 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        await onSave(d);
        setBusy(false);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[12px] font-medium text-ink-3">
          What is this date?
          <select className="field mt-1 h-8 min-h-0 py-0 text-[13.5px]" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as DateKind, remindDays: d.remindDays === DATE_KINDS[d.kind].remindDays ? DATE_KINDS[e.target.value as DateKind].remindDays : d.remindDays })}>
            {DATE_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {DATE_KINDS[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-medium text-ink-3">
          Date
          <input type="date" required className="field mt-1 h-8 min-h-0 px-2 text-[13.5px]" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
        </label>
        <label className="text-[12px] font-medium text-ink-3">
          Reminder
          <select className="field mt-1 h-8 min-h-0 py-0 text-[13.5px]" value={d.remindDays ?? ""} onChange={(e) => setD({ ...d, remindDays: e.target.value === "" ? null : Number(e.target.value) })}>
            {REMIND_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-[12px] font-medium text-ink-3">
          Note <span className="font-normal">(optional)</span>
          <input className="field mt-1 h-8 min-h-0 text-[13.5px]" value={d.note} maxLength={120} placeholder={d.kind === "other" ? "e.g. Car service due" : "e.g. AppleCare+"} onChange={(e) => setD({ ...d, note: e.target.value })} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || busy}>
          {saveLabel}
        </button>
      </div>
    </form>
  );
}

export function exportIcs(items: Array<{ date: ImportantDate; documentTitle: string }>, name: string) {
  downloadBlob(new Blob([buildIcs(items)], { type: "text/calendar" }), `${safeFileName(name)}.ics`);
}

export function DateRow({ d, docTitle, showDoc }: { d: ImportantDate; docTitle: string; showDoc?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const today = todayISO();
  const state = reminderState(d, today);
  const days = daysBetween(today, d.date);
  if (editing)
    return (
      <DateForm
        initial={{ kind: d.kind, date: d.date, note: d.note, remindDays: d.remindDays }}
        onCancel={() => setEditing(false)}
        onSave={async (v) => {
          if (await updateDate(d.id, { ...v, status: "active", notifiedKey: null })) setEditing(false);
        }}
      />
    );
  const info = DATE_KINDS[d.kind];
  return (
    <div className={cn("flex items-start gap-3 rounded-[10px] border px-3 py-2.5", state === "due" ? "border-warn/30 bg-warn-soft" : state === "passed" ? "border-danger/25 bg-danger-soft" : "border-line bg-card")} data-testid="date-row">
      <div className="w-11 shrink-0 text-center leading-none">
        <div className="eyebrow text-[10px]">{new Date(`${d.date}T00:00`).toLocaleDateString(undefined, { month: "short" })}</div>
        <div className={cn("serif mt-0.5 text-[22px] font-medium tnum", state === "closed" && "text-ink-3")}>{Number(d.date.slice(8))}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-[14px] font-medium", state === "closed" && "text-ink-3 line-through decoration-ink-4")}>{d.kind === "other" && d.note ? d.note : state === "passed" ? info.past : info.label}</div>
        {showDoc}
        <div className="mt-0.5 text-[12.5px] text-ink-3">
          {formatISODate(d.date)} · <span className={cn(state === "due" && "font-medium text-warn", state === "passed" && "font-medium text-danger")}>{relativeDays(days)}</span>
          {d.kind !== "other" && d.note && <> · {d.note}</>}
          {state !== "closed" && <> · {d.remindDays === null ? "No reminder" : d.remindDays === 0 ? "Reminder on the day" : `Reminder ${REMIND_OPTIONS.find((o) => o.value === d.remindDays)?.label.toLowerCase() ?? `${d.remindDays} days before`}`}</>}
          {d.status === "done" && " · Done"}
          {d.status === "dismissed" && " · Dismissed"}
        </div>
      </div>
      {d.status === "active" && (state === "due" || state === "passed") && (
        <button type="button" className="btn btn-sm shrink-0" onClick={() => void updateDate(d.id, { status: "done" })}>
          <Check size={13} /> Done
        </button>
      )}
      <Popover menu align="end" label="Date actions" iconLabel="Date actions" buttonClassName="btn btn-ghost btn-sm btn-icon shrink-0" trigger={<MoreHorizontal size={15} />}>
        {(close) => (
          <>
            <MenuItem
              onSelect={() => {
                close();
                setEditing(true);
              }}
            >
              Edit…
            </MenuItem>
            {d.status === "active" ? (
              <>
                <MenuItem onSelect={() => void updateDate(d.id, { status: "done" }).then(close)}>Mark as done</MenuItem>
                <MenuItem onSelect={() => void updateDate(d.id, { status: "dismissed" }).then(close)}>Dismiss reminder</MenuItem>
              </>
            ) : (
              <MenuItem onSelect={() => void updateDate(d.id, { status: "active", notifiedKey: null }).then(close)}>Reactivate</MenuItem>
            )}
            <MenuItem
              icon={<CalendarPlus size={14} />}
              onSelect={() => {
                close();
                exportIcs([{ date: d, documentTitle: docTitle }], `${info.label} - ${docTitle}`);
              }}
            >
              Add to calendar (.ics)
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => void deleteDate(d.id).then(close)}>
              Remove date
            </MenuItem>
          </>
        )}
      </Popover>
    </div>
  );
}

export function DatesEditor({ doc, dates, prefill, onPrefillUsed }: { doc: DocumentRecord; dates: ImportantDate[]; prefill: DateDraft | null; onPrefillUsed: () => void }) {
  const [adding, setAdding] = useState(false);
  const open = adding || !!prefill;
  const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="space-y-2">
      {sorted.map((d) => (
        <DateRow key={d.id} d={d} docTitle={doc.title} />
      ))}
      {open ? (
        <DateForm
          key={prefill ? `${prefill.date}${prefill.kind}` : "new"}
          initial={prefill ?? { kind: doc.categoryId === "bills" ? "bill-due" : doc.categoryId === "insurance" ? "insurance-renewal" : doc.categoryId === "property" ? "agreement-end" : doc.categoryId === "identity" ? "document-expiry" : "warranty", date: "", note: "", remindDays: 30 }}
          saveLabel="Add date"
          onCancel={() => {
            setAdding(false);
            onPrefillUsed();
          }}
          onSave={async (v) => {
            if (await addDate(doc.id, v)) {
              setAdding(false);
              onPrefillUsed();
            }
          }}
        />
      ) : (
        <button type="button" className="btn btn-sm w-full justify-center border-dashed shadow-none" onClick={() => setAdding(true)}>
          <CalendarPlus size={14} /> Add important date
        </button>
      )}
    </div>
  );
}
