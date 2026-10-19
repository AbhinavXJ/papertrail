import type { ImportantDate } from "@/lib/types";
import { daysBetween } from "@/lib/util";

/**
 * passed     the date is in the past and the item is still active
 * due        inside the reminder window (or today)
 * upcoming   in the future, outside the reminder window
 * closed     marked done or dismissed
 */
export type ReminderState = "passed" | "due" | "upcoming" | "closed";

export function reminderState(d: ImportantDate, today: string): ReminderState {
  if (d.status !== "active") return "closed";
  const days = daysBetween(today, d.date);
  if (days < 0) return "passed";
  if (days === 0) return "due";
  if (d.remindDays !== null && days <= d.remindDays) return "due";
  return "upcoming";
}

/** Items that should draw attention in the app right now. */
export function needsAttention(d: ImportantDate, today: string): boolean {
  const s = reminderState(d, today);
  return s === "due" || s === "passed";
}

export interface DateGroup {
  key: string;
  label: string;
  items: ImportantDate[];
}

const byDate = (a: ImportantDate, b: ImportantDate) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt;

/** Upcoming view: attention first, then future items by month; closed items last. */
export function groupUpcoming(dates: readonly ImportantDate[], today: string, monthLabel: (iso: string) => string): DateGroup[] {
  const attention: ImportantDate[] = [];
  const future = new Map<string, ImportantDate[]>();
  const closed: ImportantDate[] = [];
  for (const d of [...dates].sort(byDate)) {
    const s = reminderState(d, today);
    if (s === "closed") closed.push(d);
    else if (s === "due" || s === "passed") attention.push(d);
    else {
      const k = d.date.slice(0, 7);
      future.set(k, [...(future.get(k) ?? []), d]);
    }
  }
  const groups: DateGroup[] = [];
  if (attention.length) groups.push({ key: "attention", label: "Needs attention", items: attention });
  for (const [k, items] of future) groups.push({ key: k, label: monthLabel(`${k}-01`), items });
  if (closed.length) groups.push({ key: "closed", label: "Done & dismissed", items: closed.reverse() });
  return groups;
}

/** Key identifying one reminder occurrence, so a notification is shown at most once. */
export function reminderKey(d: ImportantDate): string {
  return `${d.date}|${d.remindDays ?? "none"}`;
}

/** Dates that should trigger a browser notification now (in their window, not yet notified). */
export function dueNotifications(dates: readonly ImportantDate[], today: string): ImportantDate[] {
  return dates.filter((d) => d.remindDays !== null && reminderState(d, today) === "due" && d.notifiedKey !== reminderKey(d));
}
