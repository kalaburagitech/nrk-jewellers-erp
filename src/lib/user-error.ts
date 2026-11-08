/** Convert Convex/runtime errors into clear text that makes sense to shop staff. */
export function getUserErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;

  let message = error.message.trim();
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
