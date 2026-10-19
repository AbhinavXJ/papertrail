import type { ImportantDate } from "@/lib/types";
import { addDays } from "@/lib/util";
import { DATE_KINDS } from "./kinds";

export interface IcsItem {
  date: ImportantDate;
  documentTitle: string;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds content lines to 75 octets as required by RFC 5545. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compact = (iso: string) => iso.replace(/-/g, "");

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** An iCalendar file with all-day events (and alarms) so a calendar app can remind reliably. */
export function buildIcs(items: readonly IcsItem[], now = Date.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PAPERTRAIL//Important dates//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const { date: d, documentTitle } of items) {
    const kind = DATE_KINDS[d.kind];
    const summary = `${d.kind === "other" && d.note ? d.note : kind.label} — ${documentTitle}`;
    const description = [d.note && d.kind !== "other" ? d.note : "", `Document: ${documentTitle}`, "Exported from PAPERTRAIL."].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d.id}@papertrail.local`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(d.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(d.date, 1))}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      "TRANSP:TRANSPARENT",
    );
    if (d.remindDays !== null) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(summary)}`, `TRIGGER:-P${d.remindDays}D`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
