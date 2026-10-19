import type { Metadata } from "next";
import Link from "next/link";
import { OCR_DOWNLOAD_MB } from "@/lib/constants";

export const metadata: Metadata = { title: "How your data is handled" };

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-6 first:border-t-0">
      <h2 className="serif text-[21px] font-medium">{title}</h2>
      <div className="mt-2 space-y-2.5 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[720px] px-5 pb-24 pt-8 sm:px-8 lg:pt-12">
      <p className="eyebrow">Privacy</p>
      <h1 className="serif mt-2 text-[clamp(30px,4vw,40px)] font-medium leading-tight tracking-[-0.02em]">How your data is handled</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
        PAPERTRAIL is a website that runs entirely in your browser. It has no server-side component of its own, no accounts and no analytics. Here is exactly what happens to your documents.
      </p>

      <div className="mt-8">
        <Item title="Your files stay in this browser">
          <p>
            When you add a document, your browser reads it and stores the original file, its extracted text, a small thumbnail and the details you add (title, tags, notes, dates) in this site’s
            local database (IndexedDB) on this device. None of it is uploaded anywhere.
          </p>
          <p>
            The page’s Content Security Policy only allows network connections to this website’s own address, so the app itself can’t send document data to other servers.
          </p>
        </Item>

        <Item title="What is downloaded, and from where">
          <p>
            The app’s code, fonts and the PDF reader come from this website. If you use text recognition (OCR), the recognition engine and the English language model (about {OCR_DOWNLOAD_MB} MB) are
            downloaded from this website the first time they’re needed. Your documents are processed inside your browser and are never sent with these requests.
          </p>
          <p>Like any website, the server hosting PAPERTRAIL can see ordinary request information (such as your IP address and which app files were loaded). It never receives your documents or their contents.</p>
        </Item>

        <Item title="What PAPERTRAIL does — and doesn’t — understand">
          <p>
            Search finds the words that are actually in your documents. Category suggestions, amounts and dates come from simple, local pattern matching, are labeled as suggestions, and are
            never treated as confirmed until you accept them. There is no AI service involved.
          </p>
        </Item>

        <Item title="Password-protected PDFs">
          <p>
            If a PDF is password-protected, you can type its password to view it or to read its text. The password is used in this tab only and is never saved. Text read from such a PDF is stored
            like any other document’s text — unencrypted — so that search can find it.
          </p>
        </Item>

        <Item title="This is not an encrypted vault">
          <p>
            Browser storage isn’t encrypted by PAPERTRAIL. Anyone who can use this browser profile on this device — or software with access to it — can open your library. Use your device’s lock
            screen and account protection, and avoid shared or public computers for sensitive documents.
          </p>
        </Item>

        <Item title="Browser storage can disappear">
          <p>
            Your library is deleted if you clear this site’s data or your browsing history, reset or uninstall the browser, or lose the device. In private/incognito windows it disappears when the
            window closes. Browsers may also remove site data when disk space runs low, and Safari can remove it for sites you haven’t visited for several weeks.
          </p>
          <p>
            <strong className="font-semibold text-ink">Export a backup regularly</strong> from{" "}
            <Link href="/settings/#backup" className="link">
              Settings → Backup & restore
            </Link>
            . The backup is a normal ZIP file with your original files and a manifest; it isn’t encrypted, so store it somewhere you trust. Your library doesn’t sync between devices — to move it,
            export a backup and restore it in the other browser.
          </p>
        </Item>

        <Item title="Reminders">
          <p>
            Reminders appear inside the app. If you turn on browser notifications, they’re shown only while PAPERTRAIL is open in a tab — websites can’t reliably run in the background. For
            reminders you can depend on, use “Add to calendar” to export dates as an .ics file for your calendar app.
          </p>
        </Item>

        <Item title="Deleting your data">
          <p>
            Deleting a document removes its file, text, thumbnail, notes and dates from this browser. You can delete everything at once from{" "}
            <Link href="/settings/" className="link">
              Settings
            </Link>
            . Backup files you downloaded are separate files on your device and are not affected.
          </p>
        </Item>
      </div>

      <Link href="/" className="btn mt-4">
        Back to Papertrail
      </Link>
    </main>
  );
}
