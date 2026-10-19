"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/util";

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/** WAI-ARIA tabs: arrow keys / Home / End move between tabs; only the selected tab is in the tab order. */
export function TabList<T extends string>({ tabs, value, onChange, label, prefix, className }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void; label: string; prefix: string; className?: string }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(tabId(prefix, tabs[next].id))?.focus();
  };
  return (
    <div className={cn("flex items-center gap-1 border-b border-line", className)} role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={tabId(prefix, t.id)}
          aria-selected={value === t.id}
          aria-controls={panelId(prefix, t.id)}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cn("-mb-px border-b-2 px-3 pb-2 pt-1 text-[14px] font-medium transition-colors", value === t.id ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ prefix, id, children, className }: { prefix: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={panelId(prefix, id)} aria-labelledby={tabId(prefix, id)} tabIndex={0} className={cn("outline-none", className)}>
      {children}
    </div>
  );
}
