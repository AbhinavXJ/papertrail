import type { Metadata } from "next";
import { DatesPage } from "@/components/dates/DatesPage";

export const metadata: Metadata = { title: "Important dates" };

export default function Page() {
  return <DatesPage />;
}
