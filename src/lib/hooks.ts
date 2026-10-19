"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { getDocumentPreview } from "@/lib/store/app";

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** An object URL for a Blob, revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

// Thumbnail URLs are shared and reference-counted so scrolling a grid doesn't recreate them,
// and unused ones are revoked once the cache is full.
const previewCache = new Map<string, { url: string | null; refs: number; promise: Promise<string | null> }>();
const PREVIEW_CACHE_MAX = 160;

function evictPreviews() {
  if (previewCache.size <= PREVIEW_CACHE_MAX) return;
  for (const [k, v] of previewCache) {
    if (previewCache.size <= PREVIEW_CACHE_MAX) break;
    if (v.refs === 0) {
      if (v.url) URL.revokeObjectURL(v.url);
      previewCache.delete(k);
    }
  }
}

export function usePreviewUrl(docId: string, version: number, enabled: boolean): string | null {
  const key = `${docId}:${version}`;
  const [url, setUrl] = useState<string | null>(() => previewCache.get(key)?.url ?? null);
  useEffect(() => {
    if (!enabled) return;
    let entry = previewCache.get(key);
    if (!entry) {
      const promise = getDocumentPreview(docId)
        .then((p) => (p ? URL.createObjectURL(p.blob) : null))
        .catch(() => null);
      entry = { url: null, refs: 0, promise };
      previewCache.set(key, entry);
      promise.then((u) => {
        const e = previewCache.get(key);
        if (e) e.url = u;
        else if (u) URL.revokeObjectURL(u);
      });
    }
    entry.refs++;
    let alive = true;
    entry.promise.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
      const e = previewCache.get(key);
      if (e) e.refs--;
      evictPreviews();
    };
  }, [key, docId, enabled]);
  return enabled ? url : null;
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Windowed rendering against the page scroll: only rows near the viewport are mounted, so a
 * library of thousands of documents stays fast. Rows have a fixed height.
 */
export function useWindowVirtual(ref: RefObject<HTMLElement | null>, count: number, rowHeight: number, overscan = 6) {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 30) });
  const frame = useRef(0);
  useIsoLayoutEffect(() => {
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const vh = window.innerHeight;
      const start = Math.max(0, Math.floor(-top / rowHeight) - overscan);
      const end = Math.min(count, Math.ceil((vh - top) / rowHeight) + overscan);
      setRange((r) => (r.start === start && r.end === Math.max(start, end) ? r : { start, end: Math.max(start, end) }));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref, count, rowHeight, overscan]);
  return { ...range, total: count * rowHeight };
}

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Runs `fn` on Cmd/Ctrl+K and "/" (when not typing in a field). */
export function useSearchShortcut(fn: () => void) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        cb.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
