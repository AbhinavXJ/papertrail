"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/util";

/**
 * A button that opens a floating panel. Closes on outside click and Escape and returns focus
 * to the trigger. `menu` adds arrow-key navigation over [role=menuitem] children.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  className,
  menu,
  label,
  iconLabel,
  buttonClassName,
  disabled,
}: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  className?: string;
  menu?: boolean;
  /** Accessible name of the floating panel. */
  label?: string;
  /** Accessible name of the trigger — only for icon-only triggers (visible text names itself). */
  iconLabel?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    const first = panel.current?.querySelector<HTMLElement>(menu ? '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]' : "input, button, select, [tabindex]");
    first?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, menu]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close();
      return;
    }
    if (!menu || !open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div ref={root} className="relative inline-flex" onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className={buttonClassName ?? "btn btn-sm"}
        aria-haspopup={menu ? "menu" : "dialog"}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={iconLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role={menu ? "menu" : "dialog"}
          aria-label={label}
          className={cn("popover absolute top-[calc(100%+6px)] z-40 min-w-[13rem] p-1.5 animate-rise", align === "end" ? "right-0" : "left-0", className)}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onSelect, danger, disabled, icon }: { children: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" role="menuitem" className={cn("menu-item", danger && "text-danger")} onClick={onSelect} disabled={disabled}>
      {icon && <span className="flex w-4 shrink-0 justify-center text-ink-3">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}
