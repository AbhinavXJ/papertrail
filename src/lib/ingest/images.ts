// Browser-only image helpers (Canvas). Used for thumbnails and OCR input.

export const PREVIEW_WIDTH = 480;

export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    const e = new Error("This image couldn't be decoded. It may be damaged or use an unsupported encoding.");
    e.name = "ImageDecodeError";
    throw e;
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode image"))), type, quality));
}

export function drawScaled(source: CanvasImageSource, srcW: number, srcH: number, width: number): HTMLCanvasElement {
  const scale = width / srcW;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function thumbnailFrom(source: CanvasImageSource, srcW: number, srcH: number): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = drawScaled(source, srcW, srcH, Math.min(PREVIEW_WIDTH, srcW));
  const blob = await canvasToBlob(canvas);
  const out = { blob, width: canvas.width, height: canvas.height };
  canvas.width = canvas.height = 0;
  return out;
}

/** Scales an image to a size Tesseract reads well (long side ~1600–3000 px). */
export function ocrCanvas(source: CanvasImageSource, srcW: number, srcH: number): HTMLCanvasElement {
  const long = Math.max(srcW, srcH);
  const scale = long > 3000 ? 3000 / long : long < 1600 ? Math.min(2, 1600 / long) : 1;
  return drawScaled(source, srcW, srcH, srcW * scale);
}

export function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = c.height = 0;
}
