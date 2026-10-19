"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, CalendarPlus, FileText } from "lucide-react";
import type { DocumentRecord, ImportantDate } from "@/lib/types";
import { useApp } from "@/lib/store/store";
import { enableNotifications, setSetting } from "@/lib/store/app";
import { groupUpcoming, reminderState } from "@/lib/dates/reminders";
import { DATE_KINDS } from "@/lib/dates/kinds";
import { HINT_TO_KIND } from "@/lib/organize/findings";
import { cn, formatISODate, formatMonth, plural, todayISO } from "@/lib/util";
import { DateRow, exportIcs } from "@/components/document/DatesEditor";
import { docHref } from "@/components/library/DocBits";
import { TabList, TabPanel } from "@/components/ui/Tabs";

type Tab = "upcoming" | "timeline";

function usePermission(): NotificationPermission | "unsupported" {
  return useSyncExternalStore(
    (cb) => {
      const t = setInterval(cb, 2000);
      return () => clearInterval(t);
    },
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    () => "default",
  );
}

function NotificationsCard() {
  const enabled = useApp((s) => s.settings.notificationsEnabled);
  const permission = usePermission();
  const on = enabled && permission === "granted";
  return (
    <div className="panel p-4">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5", on ? "text-accent" : "text-ink-3")}>{on ? <Bell size={18} /> : <BellOff size={18} />}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-semibold">Browser notifications {on ? "are on" : "are off"}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
            When a reminder is due, PAPERTRAIL can show a notification — <strong className="font-medium text-ink-2">but only while it’s open in a browser tab</strong>. Websites can’t reliably run in the background, so
            for reminders you can count on, add your dates to your calendar app.
          </p>
          {permission === "denied" && <p className="mt-2 text-[13px] text-danger">Notifications are blocked for this site in your browser settings.</p>}
          {permission === "unsupported" && <p className="mt-2 text-[13px] text-ink-3">This browser doesn’t support notifications.</p>}
        </div>
        {permission !== "unsupported" &&
          (on ? (
            <button type="button" className="btn btn-sm shrink-0" onClick={() => void setSetting("notificationsEnabled", false)}>
              Turn off
            </button>
          ) : (
            <button type="button" className="btn btn-sm shrink-0" disabled={permission === "denied"} onClick={() => void enableNotifications()}>
              Turn on
            </button>
          ))}
      </div>
    </div>
  );
}

function DocLink({ doc }: { doc: DocumentRecord | undefined }) {
  if (!doc) return null;
  return (
    <Link href={docHref(doc.id)} className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-accent hover:underline">
      <FileText size={12} className="shrink-0" /> <span className="truncate">{doc.title}</span>
    </Link>
  );
}

export function DatesPage() {
  const dates = useApp((s) => s.dates);
  const docMap = useApp((s) => s.docMap);
  const docs = useApp((s) => s.docs);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [withDocDates, setWithDocDates] = useState(true);
  const today = todayISO();
  const valid = useMemo(() => dates.filter((d) => docMap.has(d.docId)), [dates, docMap]);
  const groups = useMemo(() => groupUpcoming(valid, today, formatMonth), [valid, today]);
  const upcomingActive = valid.filter((d) => d.status === "active" && d.date >= today);

  const suggestions = useMemo(() => {
    const out: Array<{ doc: DocumentRecord; date: string; kind: ImportantDate["kind"]; context: string }> = [];
    for (const doc of docs) {
      const have = new Set(valid.filter((d) => d.docId === doc.id).map((d) => d.date));
      for (const f of doc.findings?.dates ?? []) {
        const kind = f.hint ? HINT_TO_KIND[f.hint] : null;
        if (kind && !have.has(f.date) && f.date >= today) out.push({ doc, date: f.date, kind, context: f.context });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  }, [docs, valid, today]);

  const timeline = useMemo(() => {
    type Ev = { key: string; date: string; el: React.ReactNode; past: boolean };
    const evs: Ev[] = valid.map((d) => ({ key: d.id, date: d.date, past: d.date < today, el: <DateRow d={d} docTitle={docMap.get(d.docId)!.title} showDoc={<DocLink doc={docMap.get(d.docId)} />} /> }));
    if (withDocDates)
      for (const doc of docs)
        if (doc.documentDate?.source === "user")
          evs.push({
            key: `doc-${doc.id}`,
            date: doc.documentDate.value,
            past: doc.documentDate.value < today,
            el: (
              <div className="flex items-center gap-3 px-3 py-1.5 text-[13.5px] text-ink-2">
                <span className="w-11 shrink-0 text-center text-[12px] text-ink-3 tnum">{Number(doc.documentDate.value.slice(8))}</span>
                <span className="text-ink-3">Document dated</span>
                <Link href={docHref(doc.id)} className="truncate text-accent hover:underline">
                  {doc.title}
                </Link>
              </div>
            ),
          });
    evs.sort((a, b) => b.date.localeCompare(a.date));
    const byMonth = new Map<string, Ev[]>();
    for (const e of evs) byMonth.set(e.date.slice(0, 7), [...(byMonth.get(e.date.slice(0, 7)) ?? []), e]);
    return [...byMonth];
  }, [valid, docs, docMap, withDocDates, today]);

  return (
    <main className="mx-auto max-w-[860px] px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pt-9">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="serif text-[32px] font-medium tracking-[-0.015em]">Important dates</h1>
          <p className="mt-1 text-[14.5px] text-ink-3">Warranty expiries, renewals, due dates and other deadlines attached to your documents.</p>
        </div>
        {upcomingActive.length > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => exportIcs(upcomingActive.map((d) => ({ date: d, documentTitle: docMap.get(d.docId)!.title })), "papertrail-upcoming-dates")}
            title="Download an .ics file you can open in Apple Calendar, Google Calendar or Outlook"
          >
            <CalendarPlus size={14} /> Add all upcoming to calendar
          </button>
        )}
      </div>

      <div className="mt-6">
        <NotificationsCard />
      </div>

      <div className="mt-7 flex items-end border-b border-line">
        <TabList
          prefix="dates"
          label="Dates view"
          className="border-b-0"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "upcoming", label: "Upcoming" },
            { id: "timeline", label: "Timeline" },
          ]}
        />
        {tab === "timeline" && (
          <label className="ml-auto flex items-center gap-2 pb-2 text-[13px] text-ink-3">
            <input type="checkbox" checked={withDocDates} onChange={(e) => setWithDocDates(e.target.checked)} className="accent-[var(--accent)]" />
            Show document dates
          </label>
        )}
      </div>

      {tab === "upcoming" ? (
        <TabPanel prefix="dates" id="upcoming" className="mt-5 space-y-8">
          {!valid.length && (
            <div className="rounded-[12px] border border-dashed border-line-2 px-6 py-12 text-center">
              <p className="serif text-[21px]">No important dates yet</p>
              <p className="mx-auto mt-2 max-w-[440px] text-[14px] leading-relaxed text-ink-3">Open a document and add a warranty expiry, renewal or due date. PAPERTRAIL never turns a printed date into a deadline on its own.</p>
            </div>
          )}
          {groups.map((g) =>
            g.key === "closed" ? (
              <details key={g.key} className="group">
                <summary className="eyebrow mb-3 list-none">
                  {g.label} ({g.items.length}) <span className="ml-1 text-ink-4 group-open:hidden">— show</span>
                </summary>
                <div className="space-y-2">
                  {g.items.map((d) => (
                    <DateRow key={d.id} d={d} docTitle={docMap.get(d.docId)!.title} showDoc={<DocLink doc={docMap.get(d.docId)} />} />
                  ))}
                </div>
              </details>
            ) : (
              <section key={g.key} aria-label={g.label}>
                <h2 className={cn("eyebrow mb-3", g.key === "attention" && "text-warn")}>{g.label}</h2>
                <div className="space-y-2">
                  {g.items.map((d) => (
                    <DateRow key={d.id} d={d} docTitle={docMap.get(d.docId)!.title} showDoc={<DocLink doc={docMap.get(d.docId)} />} />
                  ))}
                </div>
              </section>
            ),
          )}
          {suggestions.length > 0 && (
            <section aria-label="Dates found in your documents">
              <h2 className="eyebrow mb-1">Found in your documents · not verified</h2>
              <p className="mb-3 text-[13px] text-ink-3">These printed dates look like deadlines because of the words around them. Open a document to add one as a reminder.</p>
              <ul className="divide-y divide-line rounded-[10px] border border-line bg-card">
                {suggestions.map((s, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2.5 text-[13.5px]">
                    <span className="w-24 shrink-0 tnum text-ink-2">{formatISODate(s.date)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        Possible {DATE_KINDS[s.kind].label.toLowerCase()} ·{" "}
                        <Link href={docHref(s.doc.id)} className="text-accent hover:underline">
                          {s.doc.title}
                        </Link>
                      </div>
                      <div className="truncate text-[12px] text-ink-3">{s.context}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </TabPanel>
      ) : (
        <TabPanel prefix="dates" id="timeline" className="mt-5">
          {!timeline.length ? (
            <p className="py-10 text-center text-[14px] text-ink-3">Nothing on the timeline yet. Important dates and confirmed document dates appear here.</p>
          ) : (
            <ol className="relative space-y-7 border-l border-line pl-6">
              {timeline.map(([month, evs], i) => {
                const prev = timeline[i - 1]?.[0];
                const showToday = prev && prev > today.slice(0, 7) && month <= today.slice(0, 7);
                return (
                  <li key={month}>
                    {showToday && (
                      <div className="-ml-[31px] mb-6 flex items-center gap-2 text-[12px] font-semibold text-accent">
                        <span className="h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-paper" /> Today · {formatISODate(today)}
                      </div>
                    )}
                    <h2 className={cn("serif relative text-[18px] font-medium", month < today.slice(0, 7) && "text-ink-3")}>
                      <span className="absolute -left-[29px] top-2 h-2 w-2 rounded-full bg-line-2 ring-4 ring-paper" />
                      {formatMonth(`${month}-01`)}
                    </h2>
                    <div className={cn("mt-2 space-y-2", evs.every((e) => e.past) && "opacity-80")}>
                      {evs.map((e) => (
                        <div key={e.key}>{e.el}</div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-6 text-[12.5px] text-ink-3">
            {plural(valid.length, "important date")} · {plural(valid.filter((d) => reminderState(d, today) === "passed").length, "past item")} still open
          </p>
        </TabPanel>
      )}
    </main>
  );
}
