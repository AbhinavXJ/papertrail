/**
 * Minimal ZIP support for backups.
 *
 * Writer: "stored" (uncompressed) entries only. The archive is assembled as a Blob made of the
 * original file Blobs plus small header buffers, so exporting a large library doesn't need a
 * second in-memory copy of every file. Originals are mostly already compressed (PDF/JPEG/PNG).
 *
 * Reader: random access through the central directory. Supports stored and deflated entries
 * (so a backup re-zipped by another tool still restores), verifies CRC-32, and detects
 * archives that were cut off. ZIP64 (> 4 GB or > 65,535 entries) is not supported.
 */

export class ZipError extends Error {
  constructor(
    public readonly code: "not-zip" | "truncated" | "unsupported" | "corrupt" | "too-large",
    message: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export async function crc32Blob(blob: Blob, onBytes?: (n: number) => void): Promise<number> {
  let crc = 0;
  const reader = blob.stream().getReader();
  let lastYield = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32(value, crc);
    onBytes?.(value.length);
    // Yield regularly so checksumming a large library never freezes the page.
    if (Date.now() - lastYield > 12) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }
  return crc;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function buf(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(n));
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipInput {
  name: string;
  data: Blob | string;
  modified?: Date;
  /** Precomputed CRC-32 (when the caller already read the data to verify it). */
  crc?: number;
}

const MAX32 = 0xffffffff;

export async function createZip(inputs: readonly ZipInput[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  if (inputs.length > 0xffff) throw new ZipError("too-large", "Too many files for one backup archive.");
  const blobs = inputs.map((i) => (typeof i.data === "string" ? new Blob([i.data], { type: "text/plain" }) : i.data));
  const total = blobs.reduce((s, b) => s + b.size, 0);
  let done = 0;
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (let k = 0; k < inputs.length; k++) {
    const input = inputs[k];
    const blob = blobs[k];
    const name = utf8(input.name);
    if (blob.size > MAX32 || offset > MAX32) throw new ZipError("too-large", "This backup would be larger than 4 GB. Export a smaller selection of documents.");
    let crc: number;
    if (input.crc === undefined) crc = await crc32Blob(blob, (n) => onProgress?.((done += n), total));
    else {
      crc = input.crc;
      onProgress?.((done += blob.size), total);
    }
    const { time, date } = dosDateTime(input.modified ?? new Date());

    const local = buf(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, blob.size, true);
    lv.setUint32(22, blob.size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const cd = buf(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, blob.size, true);
    cv.setUint32(24, blob.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, blob);
    central.push(cd);
    offset += local.length + blob.size;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  if (offset > MAX32) throw new ZipError("too-large", "This backup would be larger than 4 GB. Export a smaller selection of documents.");
  const end = buf(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, inputs.length, true);
  ev.setUint16(10, inputs.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

async function bytesAt(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class ZipReader {
  private constructor(
    private readonly blob: Blob,
    readonly entries: Map<string, ZipEntry>,
  ) {}

  static async open(blob: Blob): Promise<ZipReader> {
    if (blob.size < 22) throw new ZipError("not-zip", "This file is too small to be a backup archive.");
    const head = await bytesAt(blob, 0, 4);
    const isZip = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5);
    const tailStart = Math.max(0, blob.size - 65557);
    const tail = await bytesAt(blob, tailStart, blob.size);
    const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      if (isZip) throw new ZipError("truncated", "This archive is incomplete — it appears to have been cut off before the end.");
      throw new ZipError("not-zip", "This file isn't a ZIP archive.");
    }
    const count = tv.getUint16(eocd + 10, true);
    const cdSize = tv.getUint32(eocd + 12, true);
    const cdOffset = tv.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === MAX32 || cdSize === MAX32) throw new ZipError("unsupported", "This archive uses ZIP64, which isn't supported.");
    if (cdOffset + cdSize > blob.size) throw new ZipError("truncated", "This archive is incomplete — its file index is missing.");
    const cd = await bytesAt(blob, cdOffset, cdOffset + cdSize);
    const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const entries = new Map<string, ZipEntry>();
    let p = 0;
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (p + 46 > cd.length || v.getUint32(p, true) !== 0x02014b50) throw new ZipError("corrupt", "This archive's file index is damaged.");
      const flags = v.getUint16(p + 8, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true);
      const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
      const name = flags & 0x0800 ? dec.decode(nameBytes) : String.fromCharCode(...nameBytes);
      const entry: ZipEntry = {
        name,
        method: v.getUint16(p + 10, true),
        crc: v.getUint32(p + 16, true),
        compressedSize: v.getUint32(p + 20, true),
        size: v.getUint32(p + 24, true),
        localOffset: v.getUint32(p + 42, true),
      };
      if (flags & 0x1) throw new ZipError("unsupported", "This archive is encrypted.");
      if (!name.endsWith("/")) entries.set(name, entry);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipReader(blob, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  private async dataRange(e: ZipEntry): Promise<[number, number]> {
    const h = await bytesAt(this.blob, e.localOffset, e.localOffset + 30);
    const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    if (h.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw new ZipError("corrupt", `“${e.name}” is damaged inside the archive.`);
    const start = e.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
    const end = start + e.compressedSize;
    if (end > this.blob.size) throw new ZipError("truncated", `“${e.name}” is incomplete — the archive was cut off.`);
    return [start, end];
  }

  /** Reads and CRC-checks an entry. */
  async read(name: string): Promise<Uint8Array> {
    const e = this.entries.get(name);
    if (!e) throw new ZipError("corrupt", `“${name}” is missing from the archive.`);
    const [start, end] = await this.dataRange(e);
    let data = await bytesAt(this.blob, start, end);
    if (e.method === 8) data = await inflateRaw(data);
    else if (e.method !== 0) throw new ZipError("unsupported", `“${name}” uses an unsupported compression method.`);
    if (data.length !== e.size || crc32(data) !== e.crc) throw new ZipError("corrupt", `“${name}” is corrupted.`);
    return data;
  }

  async readText(name: string): Promise<string> {
    return new TextDecoder().decode(await this.read(name));
  }

  /** A Blob of the entry's contents. Stored entries are sliced from the archive without copying. */
  async readBlob(name: string, type: string): Promise<Blob> {
    const e = this.entries.get(name);
    if (!e) throw new ZipError("corrupt", `“${name}” is missing from the archive.`);
    if (e.method === 0) {
      const [start, end] = await this.dataRange(e);
      return this.blob.slice(start, end, type);
    }
    return new Blob([(await this.read(name)) as Uint8Array<ArrayBuffer>], { type });
  }
}
