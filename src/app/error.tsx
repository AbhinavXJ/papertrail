"use client";

import Link from "next/link";

/** Shown when a page crashes while rendering. The library in IndexedDB is not affected. */
export default function PageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center" role="alert">
      <h1 className="serif text-[26px] font-medium">This page ran into a problem</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">Your documents are safe — they’re stored in this browser and weren’t changed. Try again, or go back to your library.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/" className="btn">
          Library
        </Link>
      </div>
    </main>
  );
}
