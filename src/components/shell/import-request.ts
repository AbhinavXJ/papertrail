"use client";

import { useSyncExternalStore } from "react";
import { ACCEPT } from "@/lib/ingest/sniff";
import { importFiles, switchWorkspace } from "@/lib/store/app";
import { getState } from "@/lib/store/store";

// Files dropped while the sample workspace is open wait here until the user confirms that they
// should go into their own library — samples and real documents are never mixed.
let pending: File[] | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function requestImport(files: File[]) {
  if (!files.length) return;
  if (getState().workspace === "sample") {
    pending = files;
    notify();
  } else void importFiles(files);
}

export function usePendingImport(): File[] | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
    () => null,
  );
}

export async function confirmPendingImport() {
  const files = pending;
  pending = null;
  notify();
  if (!files) return;
  await switchWorkspace("user");
  await importFiles(files);
}

export function cancelPendingImport() {
  pending = null;
  notify();
}

/** Opens the system file picker (must be called from a user gesture). */
export function pickFiles() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ACCEPT;
  input.style.display = "none";
  input.onchange = () => {
    requestImport([...(input.files ?? [])]);
    input.remove();
  };
  document.body.appendChild(input);
  input.click();
}
