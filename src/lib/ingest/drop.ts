/** Collects files from a drop, including the contents of dropped folders (recursively). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items]
    .filter((i) => i.kind === "file")
    .map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null));
  if (!entries.some((e) => e?.isDirectory)) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (depth > 8 || out.length > 2000) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((r) => (entry as FileSystemFileEntry).file(r, () => r(null)));
      if (file && !file.name.startsWith(".")) out.push(file);
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((r) => reader.readEntries(r, () => r([])));
      if (!batch.length) break;
      for (const e of batch) await walk(e, depth + 1);
    }
  };
  for (const e of entries) if (e) await walk(e, 0);
  return out;
}

export function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
}
