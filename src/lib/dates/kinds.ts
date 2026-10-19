import type { DateKind } from "@/lib/types";

export interface DateKindInfo {
  label: string;
  /** Phrase used once the date has passed. */
  past: string;
  /** Default number of days before the date to start reminding. */
  remindDays: number;
}

export const DATE_KINDS: Record<DateKind, DateKindInfo> = {
  warranty: { label: "Warranty expires", past: "Warranty expired", remindDays: 30 },
  "insurance-renewal": { label: "Insurance renewal", past: "Renewal date passed", remindDays: 30 },
  "agreement-end": { label: "Agreement ends", past: "Agreement ended", remindDays: 60 },
  "bill-due": { label: "Bill due", past: "Due date passed", remindDays: 7 },
  "subscription-renewal": { label: "Subscription renews", past: "Renewed", remindDays: 7 },
  "document-expiry": { label: "Document expires", past: "Expired", remindDays: 90 },
  other: { label: "Important date", past: "Date passed", remindDays: 7 },
};

export const DATE_KIND_ORDER: DateKind[] = [
  "warranty",
  "insurance-renewal",
  "agreement-end",
  "bill-due",
  "subscription-renewal",
  "document-expiry",
  "other",
];

export const REMIND_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: "No reminder" },
  { value: 0, label: "On the day" },
  { value: 1, label: "1 day before" },
  { value: 3, label: "3 days before" },
  { value: 7, label: "1 week before" },
  { value: 14, label: "2 weeks before" },
  { value: 30, label: "1 month before" },
  { value: 60, label: "2 months before" },
  { value: 90, label: "3 months before" },
];
