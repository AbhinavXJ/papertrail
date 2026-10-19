import type { Worker as TesseractWorker } from "tesseract.js";
import { abortError } from "@/lib/util";

/**
 * On-device OCR with Tesseract.js. The engine (~4 MB for the device's build) and the English
 * model (~3 MB) are served from this site's /vendor/tesseract/ — never from a CDN — and are
 * only downloaded the first time text recognition is needed. Images are processed inside a
 * Web Worker in this tab and never leave the device.
 */
export { OCR_DOWNLOAD_MB } from "@/lib/constants";
const IDLE_MS = 90_000;

export interface OcrProgress {
  stage: "loading" | "recognizing";
  /** 0–1 */
  ratio: number;
}

export interface OcrResult {
  text: string;
  /** Mean word confidence, 0–100. */
  confidence: number;
}

let workerPromise: Promise<TesseractWorker> | null = null;
let progressListener: ((p: OcrProgress) => void) | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;

export function ocrEngineLoaded(): boolean {
  return loaded;
}

async function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM } = await import("tesseract.js");
    const worker = await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: "/vendor/tesseract/worker.min.js",
      corePath: "/vendor/tesseract/core",
      langPath: "/vendor/tesseract/lang",
      workerBlobURL: false,
      gzip: true,
      // The browser's HTTP cache already keeps the model; don't store another copy in IndexedDB.
      cacheMethod: "none",
      logger: (m: { status: string; progress: number }) => {
        if (!progressListener) return;
        if (m.status === "recognizing text") progressListener({ stage: "recognizing", ratio: m.progress });
        else progressListener({ stage: "loading", ratio: m.progress });
      },
    });
    loaded = true;
    return worker;
  })();
  try {
    return await workerPromise;
  } catch (e) {
    workerPromise = null;
    throw e;
  }
}

/** Frees the OCR engine's memory (~100 MB) and cancels any running job. */
export async function terminateOcr(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const p = workerPromise;
  workerPromise = null;
  if (p) await p.then((w) => w.terminate()).catch(() => undefined);
}

function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void terminateOcr(), IDLE_MS);
}

/**
 * Recognizes text in an image. Cancelling via `signal` terminates the engine (Tesseract jobs
 * can't be interrupted otherwise); it is reloaded on the next call.
 */
export async function recognize(image: HTMLCanvasElement | Blob, opts: { signal?: AbortSignal; onProgress?: (p: OcrProgress) => void } = {}): Promise<OcrResult> {
  if (opts.signal?.aborted) throw abortError();
  if (idleTimer) clearTimeout(idleTimer);
  progressListener = opts.onProgress ?? null;
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void terminateOcr();
      reject(abortError());
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const worker = await Promise.race([getWorker(), aborted]);
    const { data } = await Promise.race([worker.recognize(image), aborted]);
    return { text: (data.text ?? "").replace(/[ \t]+\n/g, "\n").trim(), confidence: data.confidence ?? 0 };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    await terminateOcr();
    const msg = String((e as Error)?.message ?? e);
    const offline = /network|fetch|failed to load|importScripts|NetworkError/i.test(msg) || (typeof navigator !== "undefined" && navigator.onLine === false);
    const err = new Error(offline ? "The text-recognition engine couldn't be downloaded from this site. Check your connection, then try again." : "Text recognition couldn't run in this browser.", { cause: e });
    err.name = "OcrError";
    throw err;
  } finally {
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    progressListener = null;
    scheduleIdle();
  }
}

/** True when OCR output has enough real words to be worth storing. */
export function usableOcrText(r: OcrResult): boolean {
  const words = r.text.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return words.length >= 2 && r.confidence >= 35;
}
