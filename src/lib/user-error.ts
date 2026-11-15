/** Convert Convex/runtime errors into clear text that makes sense to shop staff. */
export function getUserErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;

  // ConvexError carries the intended user-facing text in `data`.
  const data = (error as Error & { data?: unknown }).data;
  let message = (typeof data === "string" ? data : error.message).trim();
  if (/view-only access/i.test(message)) {
    return "Your login is view only. Ask the Owner to add, edit or delete records.";
  }
  if (/only the owner can change this setting/i.test(message)) {
    return "Only the Owner can change this setting.";
  }
  const uncaught = message.match(/(?:Server Error\s+)?Uncaught Error:\s*([\s\S]*?)(?=\s+at handler\b|\s+Called by client\b|$)/i);
  if (uncaught?.[1]) message = uncaught[1].trim();
  message = message
    .replace(/^Error:\s*/i, "")
    .replace(/\s+Called by client\s*$/i, "")
    .trim();

  const lower = message.toLowerCase();
  if (/box number/.test(lower) && /(already exists|already in use|duplicate)/.test(lower)) {
    return "That box number is already in use. Please choose a different number.";
  }
  if (/invoice number/.test(lower) && /(already exists|already in use|duplicate)/.test(lower)) {
    return "That invoice number is already in use. Please enter a different number.";
  }
  if (/invoice number/.test(lower) && /digits only/.test(lower)) {
    return "Use numbers only for the invoice serial number.";
  }
  if (/ticket number/.test(lower) && /(already exists|already in use|duplicate)/.test(lower)) {
    return "That ticket number is already in use. Please enter a different number.";
  }
  if (/already exists|duplicate/.test(lower)) {
    return "A record with those details already exists. Check the name or number and try again.";
  }
  if (/not authenticated|unauthorized|permission denied|only an? (owner|admin)|requires? (owner|admin|manager)|access denied/.test(lower)) {
    return "You don’t have permission to do that. Please ask an administrator for access.";
  }
  if (/\bnot found\b/.test(lower)) {
    return "We couldn’t find that record. Refresh the page and try again.";
  }
  if (!message || /server error|uncaught|request id|called by client|at handler|internal error|convex|fetch failed|network error/i.test(message)) {
    return fallback;
  }

  return message;
}
