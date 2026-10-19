"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/util";

/** Accessible modal built on the native <dialog> element (focus trap, Escape, top layer). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissable) onClose();
      }}
      className={cn("popover m-auto max-h-[88vh] w-[min(94vw,520px)] overflow-hidden p-0 text-ink open:animate-rise", wide && "w-[min(94vw,720px)]")}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex items-start gap-3 border-b border-line px-5 pb-3.5 pt-4">
            <div className="min-w-0 flex-1">
              <h2 id="dialog-title" className="serif text-[21px] font-medium leading-tight">
                {title}
              </h2>
              {description && <p className="mt-1 text-[13.5px] text-ink-3">{description}</p>}
            </div>
            {dismissable && (
              <button type="button" className="btn btn-ghost btn-sm btn-icon -mr-1.5" onClick={onClose} aria-label="Close">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  confirmDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      dismissable={!busy}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={cn("btn", danger ? "btn-danger" : "btn-primary")} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[14.5px] text-ink-2">{children}</div>
    </Dialog>
  );
}
