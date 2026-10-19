import { describe, expect, it } from "vitest";
import { dueNotifications, groupUpcoming, needsAttention, reminderKey, reminderState } from "./reminders";
import { buildIcs } from "./ics";
import type { ImportantDate } from "@/lib/types";

const today = "2026-10-18";
const d = (over: Partial<ImportantDate>): ImportantDate => ({
  id: Math.random().toString(36).slice(2),
  docId: "doc",
  kind: "warranty",
  date: "2026-12-01",
  note: "",
  remindDays: 30,
  status: "active",
  createdAt: 1,
  updatedAt: 1,
  notifiedKey: null,
  ...over,
});

describe("reminderState", () => {
  it("distinguishes passed, due (reminder window), upcoming and closed", () => {
    expect(reminderState(d({ date: "2026-10-01" }), today)).toBe("passed");
    expect(reminderState(d({ date: "2026-10-18", remindDays: null }), today)).toBe("due");
    expect(reminderState(d({ date: "2026-11-10", remindDays: 30 }), today)).toBe("due");
    expect(reminderState(d({ date: "2026-11-17", remindDays: 30 }), today)).toBe("due");
    expect(reminderState(d({ date: "2026-11-18", remindDays: 30 }), today)).toBe("upcoming");
    expect(reminderState(d({ date: "2026-11-10", remindDays: null }), today)).toBe("upcoming");
    expect(reminderState(d({ date: "2026-10-01", status: "done" }), today)).toBe("closed");
    expect(needsAttention(d({ date: "2026-10-01", status: "dismissed" }), today)).toBe(false);
  });
});

describe("groupUpcoming", () => {
  it("puts attention items first, then months in order, closed last", () => {
    const items = [d({ date: "2027-03-02" }), d({ date: "2026-10-20" }), d({ date: "2027-01-05" }), d({ date: "2027-01-01", status: "done" })];
    const groups = groupUpcoming(items, today, (iso) => iso.slice(0, 7));
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ["attention", 1],
      ["2027-01", 1],
      ["2027-03", 1],
      ["closed", 1],
    ]);
  });
});

describe("notifications", () => {
  it("notifies once per reminder occurrence", () => {
    const a = d({ date: "2026-10-25", remindDays: 7 });
    expect(dueNotifications([a], today)).toEqual([a]);
    const notified = { ...a, notifiedKey: reminderKey(a) };
    expect(dueNotifications([notified], today)).toEqual([]);
    // Moving the date creates a new occurrence.
    expect(dueNotifications([{ ...notified, date: "2026-10-24" }], today)).toHaveLength(1);
    expect(dueNotifications([d({ date: "2026-10-25", remindDays: null })], today)).toEqual([]);
  });
});

describe("buildIcs", () => {
  it("produces all-day events with alarms and escaped, folded text", () => {
    const ics = buildIcs([{ date: d({ id: "abc", date: "2027-01-31", note: "AppleCare+, extended" }), documentTitle: "Laptop receipt; Aero 14 — a very long title that needs folding because it goes on" }], Date.UTC(2026, 9, 18));
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("UID:abc@papertrail.local");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270131");
    expect(ics).toContain("DTEND;VALUE=DATE:20270201");
    expect(ics).toContain("TRIGGER:-P30D");
    expect(ics).toContain("Laptop receipt\\; Aero 14");
    expect(ics).toContain("AppleCare+\\, extended");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
