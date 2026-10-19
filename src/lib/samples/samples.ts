import type { DocumentRecord, ImportantDate, Tag } from "@/lib/types";
import { addDays, todayISO } from "@/lib/util";
import { flow, makePdf } from "./pdf-writer";

/**
 * Sample documents for the "explore" workspace. They are generated in the browser (dates are
 * relative to today so reminders look realistic), stored in a separate database, and go
 * through exactly the same import pipeline as real files — PDF text extraction, OCR, search.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function long(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

type Block = Parameters<typeof flow>[0][number];
const h = (text: string, size = 17): Block => ({ text, size, bold: true, gap: 10 });
const p = (text: string, extra: Partial<{ bold: boolean; size: number; gray: number; gap: number }> = {}): Block => ({ text, ...extra });
const rule: Block = { rule: true };

function pdfFile(name: string, blocks: Block[], title: string): File {
  return new File([makePdf(flow(blocks), { title })], name, { type: "application/pdf", lastModified: Date.now() - 86400000 * 3 });
}

async function receiptImage(t: string): Promise<File> {
  const W = 900;
  const H = 1320;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  x.fillStyle = "#f3efe6";
  x.fillRect(0, 0, W, H);
  x.save();
  x.translate(W / 2, H / 2);
  x.rotate(-0.012);
  x.translate(-W / 2, -H / 2);
  x.fillStyle = "#fffdf8";
  x.shadowColor = "rgba(0,0,0,0.12)";
  x.shadowBlur = 24;
  x.fillRect(110, 60, 680, 1200);
  x.shadowBlur = 0;
  x.fillStyle = "#1d1c1a";
  const center = (s: string, y: number, font: string) => {
    x.font = font;
    x.fillText(s, W / 2 - x.measureText(s).width / 2, y);
  };
  const row = (l: string, r: string, y: number, bold = false) => {
    x.font = `${bold ? "bold " : ""}30px "Courier New", monospace`;
    x.fillText(l, 160, y);
    x.fillText(r, 740 - x.measureText(r).width, y);
  };
  center("CORNER CAFE", 170, 'bold 52px "Courier New", monospace');
  center("12 Market Street", 225, '30px "Courier New", monospace');
  center(`Date: ${t}`, 275, '30px "Courier New", monospace');
  x.fillRect(160, 315, 580, 3);
  row("Flat white", "4.50", 380);
  row("Almond croissant", "3.95", 435);
  row("Sparkling water", "2.80", 490);
  row("Oat cookie", "2.25", 545);
  x.fillRect(160, 590, 580, 3);
  row("Subtotal", "13.50", 650);
  row("Tax", "1.08", 705);
  row("TOTAL", "$14.58", 775, true);
  row("Paid by card", "VISA 4417", 845);
  center("Thank you for your purchase", 960, '30px "Courier New", monospace');
  center("Receipt 004512", 1015, '30px "Courier New", monospace');
  x.restore();
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
  return new File([blob], "IMG_2041.png", { type: "image/png", lastModified: Date.now() - 86400000 * 6 });
}

export async function buildSampleFiles(now = new Date()): Promise<File[]> {
  const today = todayISO(now);
  const bought = addDays(today, -41);
  const billDue = addDays(today, 5);
  const renewal = addDays(today, 44);
  const leaseStart = addDays(today, -165);
  const leaseEnd = addDays(today, 200);
  const passportExp = addDays(today, 70);
  const flight = addDays(today, 23);

  const files: File[] = [];

  files.push(
    pdfFile(
      "Brightline-order-58213.pdf",
      [
        h("Brightline Electronics", 20),
        p("Order confirmation and receipt", { gray: 0.35, gap: 14 }),
        p(`Order number: INV-${now.getFullYear()}-0042`),
        p(`Order date: ${long(bought)}`),
        p("Payment method: Visa ending 4417", { gap: 12 }),
        rule,
        p("Aero 14 Laptop (16 GB, 512 GB SSD)      1 x $1,180.00"),
        p("Serial number: C02XK1LMQ6", { gray: 0.35 }),
        p("USB-C travel adapter                     1 x $0.00 (included)", { gap: 10 }),
        rule,
        p("Subtotal $1,180.00"),
        p("Sales tax $119.00"),
        p("Total $1,299.00", { bold: true, gap: 16 }),
        p("Limited warranty", { bold: true }),
        p(
          "Your Aero 14 is covered by a one-year limited warranty from the date of purchase against defects in materials and workmanship. Keep this receipt as proof of purchase. Accidental damage is not covered.",
        ),
        p(`Warranty valid until ${long(addDays(bought, 365))}.`, { gap: 14 }),
        p("Thank you for your purchase.", { gray: 0.35 }),
      ],
      "Brightline order receipt",
    ),
  );

  files.push(
    pdfFile(
      "northside-energy-bill.pdf",
      [
        h("Northside Energy", 20),
        p("Electricity bill", { gray: 0.35, gap: 14 }),
        p("Account number: 7781 2290 41"),
        p("Service address: 14 Elm Street, Apt 3B"),
        p(`Statement date: ${long(addDays(today, -9))}`),
        p(`Billing period: ${long(addDays(today, -40))} to ${long(addDays(today, -10))}`, { gap: 12 }),
        rule,
        p("Meter reading (previous)      18,204 kWh"),
        p("Meter reading (current)       18,516 kWh"),
        p("Usage this period             312 kWh"),
        p("Energy charge                 $71.76"),
        p("Delivery and service fee      $14.64", { gap: 10 }),
        rule,
        p("Amount due $86.40", { bold: true }),
        p(`Payment due date: ${long(billDue)}`, { bold: true, gap: 16 }),
        p("Pay online, by phone or by direct debit. Late payments may incur a fee of $5.00.", { gray: 0.35 }),
      ],
      "Northside Energy electricity bill",
    ),
  );

  files.push(
    pdfFile(
      "HarborMutual-home-policy.pdf",
      [
        h("Harbor Mutual Insurance", 20),
        p("Home insurance policy schedule", { gray: 0.35, gap: 14 }),
        p("Policyholder: Alex Morgan"),
        p("Policy number: HM-2291-0087"),
        p("Insured property: 14 Elm Street, Apt 3B"),
        p(`Period of insurance: ${long(addDays(renewal, -365))} to ${long(addDays(renewal, -1))}`),
        p(`Renewal date: ${long(renewal)}`, { bold: true, gap: 12 }),
        rule,
        p("Coverage", { bold: true }),
        p("Contents cover up to $40,000. Personal liability up to $1,000,000. Accidental damage to electronics included. Deductible: $250 per claim."),
        p("Annual premium $384.00", { bold: true, gap: 14 }),
        p("How to make a claim", { bold: true }),
        p("Call our claims line within 30 days of the incident. Keep receipts for valuable items, and photos of damage. ".repeat(6)),
        p("This schedule forms part of your policy. Please read the policy wording for the full terms, conditions and exclusions that apply to your cover. ".repeat(12), { gray: 0.35 }),
      ],
      "Harbor Mutual home insurance policy",
    ),
  );

  files.push(
    pdfFile(
      "Lease-14-Elm-Street.pdf",
      [
        h("Residential Lease Agreement", 20),
        p(`This lease agreement is made on ${long(leaseStart)} between Elm Street Properties LLC (the landlord) and Alex Morgan (the tenant).`, { gap: 10 }),
        p("1. Premises", { bold: true }),
        p("The landlord rents to the tenant the apartment at 14 Elm Street, Apt 3B, including one parking space."),
        p("2. Term", { bold: true }),
        p(`The lease begins on ${long(leaseStart)}. The lease term ends on ${long(leaseEnd)}. The tenant must give 60 days' written notice before moving out.`),
        p("3. Rent", { bold: true }),
        p("Monthly rent $2,150.00 is due on the first day of each month."),
        p("4. Security deposit", { bold: true }),
        p("The tenant has paid a security deposit of $2,150.00, held by the landlord and returned within 21 days after the end of the lease, less any lawful deductions."),
        p("5. Maintenance", { bold: true }),
        p("The tenant shall keep the premises clean and report any damage promptly. The landlord is responsible for structural repairs and appliances supplied with the apartment. ".repeat(8)),
        p("6. Signatures", { bold: true }),
        p("Signed by the landlord and the tenant on the date above."),
      ],
      "Lease agreement — 14 Elm Street",
    ),
  );

  files.push(
    pdfFile(
      "Lisbon-trip-itinerary.pdf",
      [
        h("Trip itinerary — Lisbon", 20),
        p("Booking reference: TPX7Q2", { gap: 12 }),
        p("Flight", { bold: true }),
        p(`TP 1351 · ${long(flight)} · departs 07:40, arrives 10:05`),
        p(`TP 1356 · ${long(addDays(flight, 6))} · departs 18:20, arrives 22:45`, { gap: 10 }),
        p("Hotel", { bold: true }),
        p(`Casa do Rio, Rua das Flores 28 · check in ${long(flight)} · 6 nights`),
        p("Reservation number 88123. Breakfast included."),
      ],
      "Lisbon trip itinerary",
    ),
  );

  files.push(
    new File(
      [
        `# Dishwasher DW-500 — quick start

**Model number:** DW-500 · **Serial number:** 4D21-9917

## Warranty
Two-year manufacturer warranty from the date of purchase. Register the product online to keep the warranty card details on file.

## Troubleshooting
- **Dishes still dirty:** clean the filter at the bottom of the tub every month.
- **Error E4:** the water inlet is blocked. Check the hose for kinks.
- **White film on glasses:** refill the rinse aid.

## Care
Run an empty hot cycle with a cleaning tablet every three months.
`,
      ],
      "dishwasher-quick-start.md",
      { type: "text/markdown", lastModified: Date.now() - 86400000 * 90 },
    ),
  );

  files.push(
    new File(
      [
        `Passport renewal checklist

Passport number ends 4471
Passport expires on ${long(passportExp)}

Before applying:
- Renewal form completed and signed
- Two recent photos (35 x 45 mm)
- Current passport
- Fee: $130.00

Many countries require at least six months of validity left on your passport, so renew before booking international travel.
`,
      ],
      "passport-renewal.txt",
      { type: "text/plain", lastModified: Date.now() - 86400000 * 20 },
    ),
  );

  files.push(await receiptImage(long(addDays(today, -6))));
  return files;
}

export interface SampleApi {
  createTag(name: string): Promise<Tag | null>;
  setTags(ids: string[], tagIds: string[]): Promise<boolean>;
  addDate(docId: string, d: Pick<ImportantDate, "kind" | "date" | "note" | "remindDays">): Promise<ImportantDate | null>;
  docs(): DocumentRecord[];
  waitForQueue(): Promise<void>;
}

/** Adds the tags and important dates a person would typically set up for these documents. */
export async function applySampleExtras(api: SampleApi, now = new Date()): Promise<void> {
  const today = todayISO(now);
  const byFile = (name: string) => api.docs().find((d) => d.fileName === name);
  const home = await api.createTag("Home");
  const electronics = await api.createTag("Electronics");
  const travel = await api.createTag("Travel");
  const tag = async (file: string, t: Tag | null) => {
    const d = byFile(file);
    if (d && t) await api.setTags([d.id], [t.id]);
  };
  await tag("Lease-14-Elm-Street.pdf", home);
  await tag("HarborMutual-home-policy.pdf", home);
  await tag("northside-energy-bill.pdf", home);
  await tag("dishwasher-quick-start.md", home);
  await tag("Brightline-order-58213.pdf", electronics);
  await tag("Lisbon-trip-itinerary.pdf", travel);
  await tag("passport-renewal.txt", travel);

  const date = async (file: string, kind: ImportantDate["kind"], iso: string, note = "") => {
    const d = byFile(file);
    if (d) await api.addDate(d.id, { kind, date: iso, note, remindDays: kindDefaults[kind] });
  };
  const kindDefaults: Record<ImportantDate["kind"], number> = { warranty: 30, "insurance-renewal": 30, "agreement-end": 60, "bill-due": 7, "subscription-renewal": 7, "document-expiry": 90, other: 7 };
  await date("Brightline-order-58213.pdf", "warranty", addDays(addDays(today, -41), 365), "One-year limited warranty");
  await date("northside-energy-bill.pdf", "bill-due", addDays(today, 5));
  await date("HarborMutual-home-policy.pdf", "insurance-renewal", addDays(today, 44));
  await date("Lease-14-Elm-Street.pdf", "agreement-end", addDays(today, 200), "Give 60 days' notice");
  await date("passport-renewal.txt", "document-expiry", addDays(today, 70));
}
