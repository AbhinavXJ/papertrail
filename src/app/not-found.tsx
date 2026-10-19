import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="serif text-3xl">Page not found</h1>
      <p className="mt-2 text-ink-3">This page doesn’t exist.</p>
      <Link href="/" className="btn btn-primary mt-6">
        Go to your library
      </Link>
    </main>
  );
}
