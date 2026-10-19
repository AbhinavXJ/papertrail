import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentPage } from "@/components/document/DocumentPage";

export const metadata: Metadata = { title: "Document" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DocumentPage />
    </Suspense>
  );
}
