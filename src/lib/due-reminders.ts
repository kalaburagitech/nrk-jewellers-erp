import { formatPaise } from "./money";

/** How many days before the due date a balance starts showing as "due soon". */
export const DUE_SOON_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DueStatus = "overdue" | "due_today" | "due_soon" | "later" | "no_date";

/** Start of the local calendar day, so "due today" means the whole day, not a timestamp. */
function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole days from today until the due date (negative = days overdue). */
export function daysUntilDue(dueDateMs: number, now = Date.now()) {
  return Math.round((startOfDay(dueDateMs) - startOfDay(now)) / DAY_MS);
}

export function dueStatus(dueDateMs: number | undefined, now = Date.now()): DueStatus {
  if (dueDateMs === undefined) return "no_date";
  const days = daysUntilDue(dueDateMs, now);
  if (days < 0) return "overdue";
  if (days === 0) return "due_today";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return "later";
}

export function dueStatusLabel(dueDateMs: number | undefined, now = Date.now()) {
  if (dueDateMs === undefined) return "No due date";
  const days = daysUntilDue(dueDateMs, now);
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Customers to remind now: an unpaid balance whose due date has passed or
 * falls within the next DUE_SOON_DAYS days — so the reminder goes out before
 * the deadline, not after. Most urgent first.
 */
export function customersToRemind<T extends { outstandingPaise: number; dueDateMs?: number }>(customers: T[], now = Date.now()) {
  return customers
    .filter((c) => c.outstandingPaise > 0 && c.dueDateMs !== undefined)
    .filter((c) => {
      const status = dueStatus(c.dueDateMs, now);
      return status === "overdue" || status === "due_today" || status === "due_soon";
    })
    .sort((a, b) => (a.dueDateMs ?? 0) - (b.dueDateMs ?? 0));
}

/** WhatsApp link with a polite reminder that names the amount and the due date. */
export function reminderWhatsAppUrl(phone: string | undefined, name: string, outstandingPaise: number, dueDateMs: number | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;
  const dueText = dueDateMs ? ` by ${new Date(dueDateMs).toLocaleDateString("en-IN")}` : "";
  const message = `Hello ${name}, a gentle reminder that ${formatPaise(outstandingPaise)} is due${dueText} at NRK Jewellers. Please clear it at your earliest convenience. Thank you!`;
  const base = withCountryCode ? `https://wa.me/${withCountryCode}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}
