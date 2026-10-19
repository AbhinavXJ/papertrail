"use client";

import "./globals.css";

/** Last-resort boundary for errors in the root layout itself. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-md px-6 py-24 text-center" role="alert">
          <h1 className="serif text-[26px] font-medium">Papertrail ran into a problem</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">Your documents are safe in this browser’s storage. Reload the page to continue.</p>
          <div className="mt-6 flex justify-center gap-2">
            <button type="button" className="btn btn-primary" onClick={() => retry()}>
              Try again
            </button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
