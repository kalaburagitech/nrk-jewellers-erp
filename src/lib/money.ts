/** Money is always stored/transmitted as an integer number of paise — never a float. */

export function rupeesToPaise(rupees: string | number): number | null {
  const value = typeof rupees === "number" ? rupees : Number(rupees);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function paiseToRupeesInput(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function percentToBasisPoints(percent: string | number): number | null {
  const value = typeof percent === "number" ? percent : Number(percent);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100);
}

// Settings → General → "Amount (upto decimal places)". Set once by the app shell from shop preferences.
let amountDecimals = 2;
export function setAmountDecimals(decimals: number) {
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 3) amountDecimals = decimals;
}

export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: amountDecimals,
    maximumFractionDigits: amountDecimals,
  })}`;
}
